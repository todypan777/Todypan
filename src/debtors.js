import { firestoreDb } from './firebase'
import {
  doc,
  collection,
  updateDoc,
  serverTimestamp,
  query,
  where,
  onSnapshot,
  arrayUnion,
  getDoc,
  getDocs,
  writeBatch,
  increment,
  runTransaction,
} from 'firebase/firestore'
import { addDocOffline } from './utils/firestoreOffline'

const debtorsCol = () => collection(firestoreDb, 'debtors')
const debtorRef = (id) => doc(firestoreDb, 'debtors', id)

/** Normaliza nombre para matching (lowercase + sin tildes). */
export function normalizeName(name) {
  return (name || '').toString()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quitar tildes
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * Suma el balance real del deudor desde su historial. ESTA es la fuente de
 * verdad. El campo `totalOwed` es un cache denormalizado que históricamente
 * se desincronizaba por (a) clamps Math.max(0,...) que descartaban sobrepagos
 * y (b) carreras entre lectura+escritura en addDebtSale. Usar este helper
 * para mostrar la deuda en cualquier UI.
 *
 * Devuelve la deuda neta:
 *   - positivo: el cliente debe esa cantidad.
 *   - 0: saldado.
 *   - negativo: el cliente tiene saldo a favor.
 *
 * Fallback a totalOwed si no hay historial (deudores muy viejos).
 */
export function computeDebtorOwed(debtor) {
  const h = debtor?.history
  if (!Array.isArray(h) || h.length === 0) return Number(debtor?.totalOwed) || 0
  return h.reduce((acc, e) => {
    if (e?.type === 'payment') return acc - (Number(e.amount) || 0)
    if (e?.type === 'adjustment') return acc + (Number(e.delta) || 0)
    return acc + (Number(e?.amount) || 0)
  }, 0)
}

/** Suscripción a todos los deudores. */
export function watchDebtors(callback, branchIds = null) {
  // Si el usuario tiene panaderias asignadas, la consulta DEBE pedir solo
  // esas: las reglas validan documento por documento y rechazan la consulta
  // entera si pudiera devolver algo que no puede leer. Sin este filtro
  // recibiria permission-denied en vez de una lista recortada.
  //
  // Los deudores historicos no traen `branchId`, asi que quedan fuera de esa
  // consulta — que es lo correcto: son clientes de cuando el negocio era uno
  // solo, y las reglas los tratan como de Panaderia Iglesia.
  const q = Array.isArray(branchIds) && branchIds.length > 0
    ? query(debtorsCol(), where('branchId', 'in', branchIds))
    : query(debtorsCol())
  return onSnapshot(
    q,
    snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => {
      console.error('[debtors] watchDebtors error:', err)
      callback([])
    }
  )
}

/**
 * Registra una venta de tipo deuda:
 * - Si el deudor existe (matchea por normalizedName), actualiza totalOwed y agrega
 *   entry al history.
 * - Si no existe, crea uno nuevo.
 *
 * Devuelve el id del deudor (existente o creado).
 */
export async function addDebtSale(existingDebtors, { name, amount, saleId, date, branchId }) {
  const normalized = normalizeName(name)
  // Ignorar deudores fusionados (mergedInto): si no, una venta con el nombre
  // viejo "resucitaría" un tombstone en vez de ir al deudor superviviente.
  const existing = existingDebtors
    .filter(d => !d.mergedInto)
    .find(d => normalizeName(d.name) === normalized)

  if (existing) {
    const amt = Number(amount) || 0
    // Fire-and-forget: en modo ahorro `await updateDoc` se cuelga.
    // Usamos increment() en vez de leer existing.totalOwed y sumarle el monto:
    // el snapshot local de watchDebtors puede estar atrasado (offline, otras
    // pestañas, otros dispositivos) y dos ventas concurrentes podían
    // sobreescribir totalOwed perdiendo una. increment() es atómico server-side.
    // Una venta nueva siempre activa al deudor — la cantidad real se sabe luego.
    updateDoc(debtorRef(existing.id), {
      totalOwed: increment(amt),
      status: 'active',
      lastUpdate: serverTimestamp(),
      history: arrayUnion({
        type: 'sale',
        saleId,
        amount: amt,
        date,
        createdAt: Date.now(),
      }),
    }).catch(err => console.warn('[debtors] update deferred:', err?.message || err))
    return existing.id
  } else {
    const ref = addDocOffline(debtorsCol(), {
      name: name.trim(),
      normalizedName: normalized,
      totalOwed: Number(amount) || 0,
      // Panaderia donde se fio. Sin esto no se puede separar el fiado de un
      // dueño del del otro.
      ...(branchId != null ? { branchId } : {}),
      status: 'active',
      lastUpdate: serverTimestamp(),
      createdAt: serverTimestamp(),
      history: [{
        type: 'sale',
        saleId,
        amount: Number(amount) || 0,
        date,
        createdAt: Date.now(),
      }],
    })
    return ref.id
  }
}

/**
 * Solo admin: registra un abono o pago de un deudor.
 *
 * payload:
 *   - amount (positivo, lo que paga el deudor)
 *   - method: 'efectivo' | 'nequi' | 'daviplata'
 *   - photoUrl?: foto del comprobante (opcional)
 *   - note?: nota interna
 *   - registeredBy: uid del admin
 */
export async function registerDebtorPayment(debtorId, payload) {
  const ref = debtorRef(debtorId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('Deudor no encontrado')

  const debtor = snap.data()
  const amount = Number(payload.amount) || 0
  if (amount <= 0) throw new Error('El monto debe ser mayor a 0')

  // Antes había `Math.max(0, currentOwed - amount)`: si el abono excedía la
  // deuda, el sobrante se perdía y ventas posteriores se inflaban. Ahora
  // usamos increment(-amount) sin clamp: si paga de más, queda saldo a favor
  // (totalOwed negativo). El status se computa best-effort desde el snapshot;
  // la verdad la calcula computeDebtorOwed() desde history.
  const projectedOwed = (Number(debtor.totalOwed) || 0) - amount

  const paymentEntry = {
    type: 'payment',
    amount,
    method: payload.method || 'efectivo',
    date: payload.date || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }),
    registeredBy: payload.registeredBy || null,
    createdAt: Date.now(),
  }
  if (payload.photoUrl) paymentEntry.photoUrl = payload.photoUrl
  if (payload.note) paymentEntry.note = payload.note

  await updateDoc(ref, {
    totalOwed: increment(-amount),
    lastUpdate: serverTimestamp(),
    history: arrayUnion(paymentEntry),
    status: projectedOwed > 0 ? 'active' : 'paid',
  })

  return { newOwed: projectedOwed, fullyPaid: projectedOwed <= 0 }
}

/**
 * Solo admin: ajusta el totalOwed de un deudor cuando se edita o elimina
 * una venta a crédito. delta = newAmount - oldAmount.
 *  - delta negativo: deudor debe menos (clamp a 0)
 *  - delta positivo: deudor debe más
 */
export async function adjustDebtorForSaleChange(debtorId, { saleId, oldAmount, newAmount, byUid, reason }) {
  const ref = debtorRef(debtorId)
  const snap = await getDoc(ref)
  if (!snap.exists()) return null
  const debtor = snap.data()

  const delta = (Number(newAmount) || 0) - (Number(oldAmount) || 0)
  // Igual que registerDebtorPayment: increment() atómico sin clamp Math.max(0,...).
  // Si el ajuste deja al deudor con saldo a favor, queda negativo en vez
  // de descartarse silenciosamente.
  const projectedOwed = (Number(debtor.totalOwed) || 0) + delta

  const adjustEntry = {
    type: 'adjustment',
    saleId: saleId || null,
    delta,
    oldAmount: Number(oldAmount) || 0,
    newAmount: Number(newAmount) || 0,
    reason: reason || (newAmount === 0 ? 'venta eliminada' : 'venta editada'),
    registeredBy: byUid || null,
    date: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }),
    createdAt: Date.now(),
  }

  await updateDoc(ref, {
    totalOwed: increment(delta),
    lastUpdate: serverTimestamp(),
    history: arrayUnion(adjustEntry),
    status: projectedOwed > 0 ? 'active' : 'paid',
  })

  return { newOwed: projectedOwed, delta }
}

/**
 * Solo admin: FUSIONA varios deudores en uno solo. Resuelve el problema de
 * que una cajera registró a la misma persona con varios nombres distintos.
 *
 * Cómo funciona (operación ATÓMICA con writeBatch — todo o nada):
 *   - `survivorId`: el deudor que sobrevive y queda con el nombre final.
 *   - El resto ("losers") se marcan con `mergedInto: survivorId` y `status:
 *     'merged'`. NO se borran ni se vacían: quedan ocultos por filtro pero con
 *     sus datos intactos para auditoría (y por si hay que revertir).
 *   - La deuda de los losers se SUMA al superviviente con `increment()` (a
 *     prueba de carreras) y su historial se anexa con `arrayUnion()`.
 *   - TODAS las ventas a crédito de los deudores seleccionados se re-apuntan
 *     al superviviente (`debtorId`) y se renombran (`debtorName`), para que el
 *     detalle, los reportes y los ajustes de venta sigan cuadrando.
 *
 * Importante: los consumidores de la lista de deudores (pantalla Deudores,
 * sugerencias del POS, matching de `addDebtSale`) deben filtrar `mergedInto`.
 *
 * @param {object} p
 * @param {string[]} p.debtorIds  ids seleccionados (incluye al superviviente)
 * @param {string}   p.survivorId id del deudor que sobrevive
 * @param {string}   p.finalName  nombre final del deudor fusionado
 * @param {string}   p.byUid      uid del admin que ejecuta
 * @returns {{ survivorId, addedOwed, salesRepointed, mergedCount }}
 */
export async function mergeDebtors({ debtorIds, survivorId, finalName, byUid }) {
  if (!Array.isArray(debtorIds) || debtorIds.length < 2) {
    throw new Error('Selecciona al menos 2 deudores para fusionar.')
  }
  if (!survivorId || !debtorIds.includes(survivorId)) {
    throw new Error('Debes elegir cuál deudor queda como principal.')
  }
  const cleanName = (finalName || '').trim()
  if (cleanName.length < 2) {
    throw new Error('Escribe un nombre válido para el deudor fusionado.')
  }

  const loserIds = debtorIds.filter(id => id !== survivorId)

  // Confirmar que el superviviente existe.
  const survivorSnap = await getDoc(debtorRef(survivorId))
  if (!survivorSnap.exists()) throw new Error('El deudor principal ya no existe.')
  const survivorOwed = Number(survivorSnap.data()?.totalOwed) || 0

  // Leer losers: sumar su deuda y juntar su historial.
  const loserSnaps = await Promise.all(loserIds.map(id => getDoc(debtorRef(id))))
  let addedOwed = 0
  let addedHistory = []
  for (const s of loserSnaps) {
    if (!s.exists()) continue
    const d = s.data()
    addedOwed += Number(d.totalOwed) || 0
    if (Array.isArray(d.history)) addedHistory = addedHistory.concat(d.history)
  }

  // Recolectar TODAS las ventas a crédito de los deudores seleccionados.
  // (Las del superviviente también, para renombrarlas al nombre final.)
  const saleRefs = []
  for (const id of debtorIds) {
    const qs = await getDocs(query(debtorsSalesCol(), where('debtorId', '==', id)))
    qs.forEach(docSnap => saleRefs.push(docSnap.ref))
  }

  // Límite de Firestore: 500 operaciones por batch. Dejamos margen.
  const totalOps = 1 + loserIds.length + saleRefs.length
  if (totalOps > 450) {
    throw new Error('Hay demasiados registros para fusionar de una vez. Fusiona en grupos más pequeños.')
  }

  const combinedOwed = survivorOwed + addedOwed
  const batch = writeBatch(firestoreDb)

  // Superviviente: nombre final + deuda sumada (increment) + historial anexado.
  const survivorUpdate = {
    name: cleanName,
    normalizedName: normalizeName(cleanName),
    totalOwed: increment(addedOwed),
    // status usa totalOwed como verdad en la UI, así que esto es best-effort.
    status: combinedOwed > 0 ? 'active' : 'paid',
    lastUpdate: serverTimestamp(),
    mergedAt: serverTimestamp(),
    mergedBy: byUid || null,
  }
  if (addedHistory.length > 0) {
    survivorUpdate.history = arrayUnion(...addedHistory)
  }
  batch.update(debtorRef(survivorId), survivorUpdate)

  // Losers: marcar como fusionados (ocultos por filtro). Datos intactos.
  for (const id of loserIds) {
    batch.update(debtorRef(id), {
      mergedInto: survivorId,
      status: 'merged',
      lastUpdate: serverTimestamp(),
    })
  }

  // Re-apuntar todas las ventas al superviviente con el nombre final.
  for (const ref of saleRefs) {
    batch.update(ref, { debtorId: survivorId, debtorName: cleanName })
  }

  await batch.commit()
  return {
    survivorId,
    addedOwed,
    salesRepointed: saleRefs.length,
    mergedCount: loserIds.length,
  }
}

/** Colección de ventas (local a este módulo, para la fusión). */
function debtorsSalesCol() {
  return collection(firestoreDb, 'sales')
}

// ─── Editar / eliminar movimientos del historial (solo admin) ─────────────
//
// El historial es la fuente de verdad del saldo (computeDebtorOwed). Estas
// funciones operan SOLO sobre entradas tipo 'payment' (abono) y 'adjustment'
// (ajuste), que son "propias" del deudor. Las entradas tipo 'sale' NO se tocan
// aquí: viven en la colección `sales` y se editan/eliminan con
// deleteSaleAsAdmin/editSaleItems + adjustDebtorForSaleChange (vía el modal de
// venta), para no descuadrar reportes ni cierres.

/** Suma neta de una lista de entradas de historial (robusto a lista vacía). */
function sumDebtorHistory(history) {
  return (history || []).reduce((acc, e) => {
    if (e?.type === 'payment') return acc - (Number(e.amount) || 0)
    if (e?.type === 'adjustment') return acc + (Number(e.delta) || 0)
    return acc + (Number(e?.amount) || 0)
  }, 0)
}

/**
 * ¿Son la MISMA entrada de historial? Compara los campos identificadores. Para
 * dos entradas idénticas (ej. un abono duplicado), findIndex con este matcher
 * devuelve la PRIMERA — así se elimina/edita exactamente UNA, no ambas.
 */
function sameHistoryEntry(a, b) {
  if (!a || !b) return false
  return a.type === b.type
    && (a.createdAt ?? null) === (b.createdAt ?? null)
    && (a.date ?? null) === (b.date ?? null)
    && (Number(a.amount) || 0) === (Number(b.amount) || 0)
    && (Number(a.delta) || 0) === (Number(b.delta) || 0)
    && (a.method ?? null) === (b.method ?? null)
    && (a.saleId ?? null) === (b.saleId ?? null)
    && (a.note ?? null) === (b.note ?? null)
}

/**
 * Solo admin: ELIMINA una entrada (payment | adjustment) del historial del
 * deudor y recalcula el saldo. Transacción atómica (read+write) para no chocar
 * con escrituras concurrentes. Guarda la entrada removida en `auditLog`.
 *
 * Lanza si la entrada no se encuentra (alguien la modificó antes) o si es de
 * tipo 'sale' (esas se manejan desde el modal de venta).
 */
export async function deleteDebtorHistoryEntry(debtorId, targetEntry, { byUid } = {}) {
  if (!debtorId || !targetEntry) throw new Error('Datos incompletos.')
  if (targetEntry.type === 'sale') {
    throw new Error('Las ventas se editan o eliminan desde el detalle de la venta.')
  }
  const ref = debtorRef(debtorId)
  return runTransaction(firestoreDb, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('Deudor no encontrado.')
    const data = snap.data()
    const history = Array.isArray(data.history) ? data.history : []
    const idx = history.findIndex(e => sameHistoryEntry(e, targetEntry))
    if (idx === -1) {
      throw new Error('No se encontró el movimiento (quizá ya cambió). Cierra y vuelve a abrir.')
    }
    const removed = history[idx]
    const newHistory = [...history.slice(0, idx), ...history.slice(idx + 1)]
    const newOwed = sumDebtorHistory(newHistory)
    tx.update(ref, {
      history: newHistory,
      totalOwed: newOwed,
      status: newOwed > 0 ? 'active' : 'paid',
      lastUpdate: serverTimestamp(),
      auditLog: arrayUnion({
        action: 'delete_entry',
        entry: removed,
        by: byUid || null,
        at: Date.now(),
      }),
    })
    return { newOwed }
  })
}

/**
 * Solo admin: edita el MONTO de un abono (payment) del historial y recalcula
 * el saldo. Transacción atómica. Guarda el antes/después en `auditLog`.
 * Solo aplica a 'payment' (un ajuste se corrige eliminándolo; una venta, desde
 * su modal).
 */
export async function editDebtorPaymentAmount(debtorId, targetEntry, newAmount, { byUid } = {}) {
  if (!debtorId || !targetEntry) throw new Error('Datos incompletos.')
  if (targetEntry.type !== 'payment') {
    throw new Error('Solo se puede editar el monto de un abono.')
  }
  const amt = Number(newAmount) || 0
  if (amt <= 0) throw new Error('El monto debe ser mayor a 0.')
  const ref = debtorRef(debtorId)
  return runTransaction(firestoreDb, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('Deudor no encontrado.')
    const data = snap.data()
    const history = Array.isArray(data.history) ? data.history : []
    const idx = history.findIndex(e => sameHistoryEntry(e, targetEntry))
    if (idx === -1) {
      throw new Error('No se encontró el movimiento (quizá ya cambió). Cierra y vuelve a abrir.')
    }
    const before = history[idx]
    const after = { ...before, amount: amt, editedAt: Date.now(), editedBy: byUid || null }
    const newHistory = [...history]
    newHistory[idx] = after
    const newOwed = sumDebtorHistory(newHistory)
    tx.update(ref, {
      history: newHistory,
      totalOwed: newOwed,
      status: newOwed > 0 ? 'active' : 'paid',
      lastUpdate: serverTimestamp(),
      auditLog: arrayUnion({
        action: 'edit_entry',
        before,
        after,
        by: byUid || null,
        at: Date.now(),
      }),
    })
    return { newOwed }
  })
}

/**
 * Solo admin: ELIMINA una venta a crédito desde el historial del deudor.
 * A diferencia del flujo de Movimientos (que conserva la venta y agrega un
 * ajuste), aquí la quitamos del historial para que desaparezca y la deuda baje
 * de inmediato; y además marcamos la venta como `deleted` en la colección
 * `sales` (best-effort) para que reportes y cierres no la cuenten.
 *
 * El recálculo del saldo es atómico (transacción) y NO depende de que la venta
 * tuviera bien seteado debtorId/paymentMethod — opera sobre la entrada visible.
 */
export async function deleteDebtorSaleEntry(debtorId, targetEntry, { byUid } = {}) {
  if (!debtorId || !targetEntry || targetEntry.type !== 'sale') {
    throw new Error('Movimiento inválido.')
  }
  const targetSaleId = targetEntry.saleId || null
  const ref = debtorRef(debtorId)
  const result = await runTransaction(firestoreDb, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('Deudor no encontrado.')
    const data = snap.data()
    const history = Array.isArray(data.history) ? data.history : []

    // Quitamos: (1) la entrada de venta exacta (primera coincidencia) y
    // (2) cualquier 'adjustment' ligado al mismo saleId. Esto evita el
    // doble descuento si una eliminación/edición previa ya había dejado un
    // ajuste para esa venta: en ese caso venta(+X)+ajuste(−X) se van juntos
    // (cambio neto 0); si NO había ajuste, se va solo la venta (−X). Correcto
    // en ambos escenarios.
    let saleMatched = false
    const removed = []
    const newHistory = history.filter(e => {
      if (!saleMatched && sameHistoryEntry(e, targetEntry)) {
        saleMatched = true
        removed.push(e)
        return false
      }
      if (targetSaleId && e?.type === 'adjustment' && (e.saleId ?? null) === targetSaleId) {
        removed.push(e)
        return false
      }
      return true
    })
    if (!saleMatched) {
      throw new Error('No se encontró el movimiento (quizá ya cambió). Cierra y vuelve a abrir.')
    }
    const newOwed = sumDebtorHistory(newHistory)
    tx.update(ref, {
      history: newHistory,
      totalOwed: newOwed,
      status: newOwed > 0 ? 'active' : 'paid',
      lastUpdate: serverTimestamp(),
      auditLog: arrayUnion({
        action: 'delete_sale_entry',
        entry: removed,
        by: byUid || null,
        at: Date.now(),
      }),
    })
    return { newOwed }
  })

  // Marcar la venta como eliminada en `sales` (para reportes/cierres). Si falla,
  // la deuda ya quedó corregida; solo avisamos por consola.
  if (targetEntry.saleId) {
    try {
      await updateDoc(doc(firestoreDb, 'sales', targetEntry.saleId), {
        status: 'deleted',
        deletedAt: serverTimestamp(),
        deletedBy: byUid || null,
        deleteReason: 'eliminada desde el historial del deudor',
      })
    } catch (err) {
      console.warn('[debtors] venta quitada del deudor, pero no se pudo marcar deleted en sales:', err?.message || err)
    }
  }
  return result
}

/**
 * Solo admin: re-sincroniza `totalOwed` desde el historial para TODOS los
 * deudores vivos. Repara drift acumulado por bugs viejos:
 *   - `Math.max(0, ...)` que descartaba sobrepagos silenciosamente.
 *   - Race condition de addDebtSale (snapshot stale + escritura absoluta).
 *
 * Idempotente: correrla varias veces da el mismo resultado si nadie escribió
 * en medio. Devuelve { scanned, fixed, drifts: [{id,name,stored,real,diff}] }.
 */
export async function recomputeAllDebtorBalances() {
  const snap = await getDocs(debtorsCol())
  let scanned = 0
  let fixed = 0
  const drifts = []
  for (const docSnap of snap.docs) {
    scanned++
    const debtor = { id: docSnap.id, ...docSnap.data() }
    if (debtor.mergedInto) continue
    const stored = Number(debtor.totalOwed) || 0
    const real = computeDebtorOwed(debtor)
    if (Math.abs(stored - real) < 0.5) continue
    drifts.push({ id: debtor.id, name: debtor.name, stored, real, diff: stored - real })
    fixed++
    await updateDoc(debtorRef(debtor.id), {
      totalOwed: real,
      status: real > 0 ? 'active' : 'paid',
      lastUpdate: serverTimestamp(),
    })
  }
  return { scanned, fixed, drifts }
}

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
  deleteField,
} from 'firebase/firestore'
import { getClientTimestamp } from './utils/network'
import { addDocOffline } from './utils/firestoreOffline'
import { digitalAmount } from './utils/payment'

// Tolerancia de valor para emparejar una transferencia con una venta (±pesos).
export const TRANSFER_VALUE_TOLERANCE = 500
// Tolerancia de tiempo (minutos) al buscar una venta mal marcada por su hora.
export const TRANSFER_TIME_TOLERANCE = 15

const saleRef = (id) => doc(firestoreDb, 'sales', id)

const salesCol = () => collection(firestoreDb, 'sales')

/**
 * Devuelve los millis de un doc para ordenar.
 * Prefiere createdAt (server) si ya sincronizo; cae a createdAtClient
 * mientras la venta esta en cola offline.
 */
function timeOf(doc) {
  return doc.createdAt?.toMillis?.() ?? doc.createdAtClient ?? 0
}

/**
 * Crea una venta nueva. payload:
 *  - sessionId, branchId, cashierUid, cashierName
 *  - items: [{ productId, source: 'admin'|'cashier'|'inline', name, qty, unitPrice, subtotal }]
 *  - total
 *  - paymentMethod: 'efectivo' | 'nequi' | 'daviplata' | 'deuda' | 'mixto'
 *  - paymentSplit?  (solo si paymentMethod === 'mixto') ej: { efectivo: 10000, nequi: 5000 }
 *  - cashReceived?  (solo efectivo)
 *  - photoUrl?      (solo nequi/daviplata o mixto con porción digital, Fase 4)
 *  - debtorId?, debtorName?  (solo deuda)
 *  - recordedByUid?, recordedByName?, recordedByRole?
 *      → cuando admin asiste un turno: la venta SE CONTABILIZA a la cajera
 *        (cashierUid de ella) pero se marca quién la registró.
 */
export async function createSale(payload) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
  const data = {
    date: today,
    createdAt: serverTimestamp(),
    createdAtClient: getClientTimestamp(),
    sessionId: payload.sessionId,
    branchId: payload.branchId,
    cashierUid: payload.cashierUid,
    cashierName: payload.cashierName,
    items: payload.items,
    total: Number(payload.total) || 0,
    paymentMethod: payload.paymentMethod,
    status: 'active',
    notes: [],
  }
  if (payload.cashReceived !== undefined && payload.cashReceived !== null) {
    data.cashReceived = Number(payload.cashReceived) || 0
  }
  // Recargo por pago digital (NEQUI/DAVIPLATA). Se suma al total; lo guardamos
  // aparte para que el admin entienda por qué el total supera la suma de items.
  if (payload.digitalSurcharge) {
    data.digitalSurcharge = Number(payload.digitalSurcharge) || 0
  }
  // Pago dividido: el desglose por método. Solo se guarda si la venta
  // realmente es 'mixto' — para el resto de métodos queda ausente y los
  // consumidores que no conocen split siguen funcionando como antes.
  if (payload.paymentMethod === 'mixto' && payload.paymentSplit) {
    data.paymentSplit = {}
    for (const [m, amt] of Object.entries(payload.paymentSplit)) {
      const a = Number(amt) || 0
      if (a > 0) data.paymentSplit[m] = a
    }
  }
  if (payload.photoUrl) {
    data.photoUrl = payload.photoUrl
    data.photoStatus = 'uploaded'
  } else if (payload.photoLocalId) {
    // Foto encolada en IndexedDB: el worker la subira cuando haya red.
    data.photoStatus = 'pending'
    data.photoLocalId = payload.photoLocalId
  }
  if (payload.debtorId) {
    data.debtorId = payload.debtorId
    data.debtorName = payload.debtorName
  }
  // Modo asistir: admin registra venta en turno de otra persona
  if (payload.recordedByUid && payload.recordedByUid !== payload.cashierUid) {
    data.recordedByUid = payload.recordedByUid
    data.recordedByName = payload.recordedByName || null
    data.recordedByRole = payload.recordedByRole || 'admin'
  }
  // Fire-and-forget: el ID se genera local; la escritura se encola y
  // resuelve cuando haya red. Crítico para modo ahorro de datos donde
  // `await addDoc()` se cuelga indefinidamente.
  const ref = addDocOffline(salesCol(), data)
  return ref.id
}

/**
 * Suscripción a las ventas a crédito asociadas a un deudor específico.
 * Usado por el modal de detalle del deudor para mostrar qué productos
 * compró en cada venta.
 */
export function watchSalesByDebtor(debtorId, callback) {
  if (!debtorId) { callback([]); return () => {} }
  const q = query(salesCol(), where('debtorId', '==', debtorId))
  return onSnapshot(
    q,
    snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      list.sort((a, b) => timeOf(b) - timeOf(a))
      callback(list)
    },
    err => {
      console.error('[sales] watchSalesByDebtor error:', err)
      callback([])
    }
  )
}

/** Suscripción a las ventas de una sesión específica (para vista cajera). */
export function watchSessionSales(sessionId, callback) {
  if (!sessionId) { callback([]); return () => {} }
  const q = query(salesCol(), where('sessionId', '==', sessionId))
  return onSnapshot(
    q,
    snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      // Ordenar por createdAt descendente (más recientes primero)
      // Usa createdAtClient como fallback mientras la venta esta en cola offline.
      list.sort((a, b) => timeOf(b) - timeOf(a))
      callback(list)
    },
    err => {
      console.error('[sales] watchSessionSales error:', err)
      callback([])
    }
  )
}

/**
 * La cajera marca una venta como "tiene un error". Solo añade nota y cambia
 * status a 'flagged'. NO modifica items, total, ni nada del contenido.
 * El admin verá en su pestaña Ventas qué decidir (Fase 7).
 */
export async function flagSale(saleId, { note, byUid, byName }) {
  const newNote = {
    by: byUid,
    byName: byName || null,
    at: Date.now(),
    message: note.trim(),
  }
  // Fire-and-forget para modo ahorro: `await updateDoc` se cuelga y dejaba el
  // modal de "Reportar error" atrapado en "Enviando...". Se encola y sube luego.
  updateDoc(saleRef(saleId), {
    status: 'flagged',
    notes: arrayUnion(newNote),
  }).catch(err => console.warn('[sales] flagSale deferred:', err?.message || err))
}

/**
 * Solo admin: marca una venta como eliminada. Si era deuda, ajusta al deudor
 * (reduce el totalOwed por el monto de la venta).
 *
 * Devuelve el resultado del ajuste de deuda si aplica.
 */
export async function deleteSaleAsAdmin(saleId, { byUid, reason } = {}) {
  const ref = saleRef(saleId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('Venta no encontrada')
  const sale = snap.data()
  if (sale.status === 'deleted') return { alreadyDeleted: true }

  await updateDoc(ref, {
    status: 'deleted',
    deletedAt: serverTimestamp(),
    deletedBy: byUid || null,
    deleteReason: reason || null,
  })
  return { sale }
}

/**
 * Solo admin: edita los items de una venta (cantidades, productos).
 * Recalcula total. Si era deuda, devuelve los datos para que el caller
 * ajuste el deudor.
 *
 * payload: { items, total, byUid, note? }
 */
export async function editSaleItems(saleId, payload) {
  const ref = saleRef(saleId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('Venta no encontrada')
  const sale = snap.data()

  const oldTotal = Number(sale.total) || 0
  const newTotal = Number(payload.total) || 0

  const editEntry = {
    by: payload.byUid || null,
    at: Date.now(),
    oldTotal,
    newTotal,
    note: payload.note || null,
  }

  await updateDoc(ref, {
    items: payload.items,
    total: newTotal,
    editedAt: serverTimestamp(),
    editedBy: payload.byUid || null,
    editHistory: arrayUnion(editEntry),
  })

  return { oldTotal, newTotal, sale }
}

/**
 * Suscripción a las ventas de UNA cajera específica para UN día específico.
 * Usada por la pantalla "Mis ventas" (Fase 9) — historial read-only.
 *
 * Filtramos por cashierUid + date (YYYY-MM-DD, zona Bogotá).
 * Ordena por hora descendente (más reciente primero).
 *
 * IMPORTANTE: aunque las ventas tengan total, la UI debe NO mostrarlo
 * (D21 anti-fraude). Esta función solo trae los docs; el filtrado visual
 * lo hace la pantalla.
 */
export function watchCashierSalesByDate(cashierUid, dateStr, callback) {
  if (!cashierUid || !dateStr) { callback([]); return () => {} }
  const q = query(
    salesCol(),
    where('cashierUid', '==', cashierUid),
    where('date', '==', dateStr),
  )
  return onSnapshot(
    q,
    snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      list.sort((a, b) => timeOf(b) - timeOf(a))
      callback(list)
    },
    err => {
      console.error('[sales] watchCashierSalesByDate error:', err)
      callback([])
    }
  )
}

/**
 * READ-ONLY (diagnóstico admin): todas las ventas de UNA fecha (zona Bogotá),
 * sin importar cajera ni sesión. Sirve para auditar descuadres comparando el
 * `sessionId`/`cashierUid` real de cada venta contra la sesión que el admin
 * cierra. Filtro de campo único (`date`) → Firestore lo indexa solo, no
 * requiere índice compuesto. No muta nada.
 */
export function watchSalesByDate(dateStr, callback) {
  if (!dateStr) { callback([]); return () => {} }
  const q = query(salesCol(), where('date', '==', dateStr))
  return onSnapshot(
    q,
    snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      list.sort((a, b) => timeOf(b) - timeOf(a))
      callback(list)
    },
    err => {
      console.error('[sales] watchSalesByDate error:', err)
      callback([])
    }
  )
}

// ──────────────────────────────────────────────────────────────
// Confirmación de transferencias (admin revisa Nequi/Daviplata del día)
// ──────────────────────────────────────────────────────────────

/**
 * Admin confirma que una transferencia (nequi/daviplata) SÍ llegó a su cuenta.
 * Marca la venta con transferConfirmation.status = 'confirmed'.
 */
export async function confirmTransfer(saleId, { byUid, byName, note, source, movementId, discrepancyAmount } = {}) {
  const confirmation = {
    status: 'confirmed',
    reviewedBy: byUid || null,
    reviewedByName: byName || null,
    reviewedAt: serverTimestamp(),
    reviewedAtClient: Date.now(),
    note: note?.trim() || null,
  }
  // Origen 'movement' = conciliada automáticamente desde un movimiento del admin.
  if (source) confirmation.source = source
  if (movementId) confirmation.movementId = movementId
  // Desfase respecto al monto registrado (ej. venta $19.500 vs registrado $19.000).
  if (discrepancyAmount) confirmation.discrepancyAmount = Number(discrepancyAmount) || 0
  await updateDoc(saleRef(saleId), { transferConfirmation: confirmation })
}

/** Deshace la confirmación (vuelve a quedar pendiente). */
export async function unconfirmTransfer(saleId) {
  await updateDoc(saleRef(saleId), { transferConfirmation: deleteField() })
}

/**
 * Reclasifica una venta (típicamente marcada EFECTIVO por error) a una
 * transferencia digital (nequi/daviplata) y la deja confirmada — el admin
 * acaba de verificarla contra su app. Deja rastro en paymentReclass.
 *
 * Nota: cambia los reportes (que leen ventas en vivo). El cuadre de un turno
 * YA cerrado queda congelado y no se recalcula solo.
 */
export async function reclassifySaleToTransfer(saleId, { method, byUid, byName, note } = {}) {
  const snap = await getDoc(saleRef(saleId))
  if (!snap.exists()) throw new Error('Venta no encontrada')
  const sale = snap.data()
  await updateDoc(saleRef(saleId), {
    paymentMethod: method,
    paymentSplit: deleteField(),
    cashReceived: deleteField(),
    paymentReclass: {
      from: sale.paymentMethod || 'efectivo',
      to: method,
      by: byUid || null,
      byName: byName || null,
      at: serverTimestamp(),
      atClient: Date.now(),
    },
    transferConfirmation: {
      status: 'confirmed',
      reviewedBy: byUid || null,
      reviewedByName: byName || null,
      reviewedAt: serverTimestamp(),
      reviewedAtClient: Date.now(),
      note: note?.trim() || null,
      reclassified: true,
    },
  })
  return { from: sale.paymentMethod || 'efectivo' }
}

/**
 * La transferencia NO llegó: el admin la pasa a EFECTIVO (el cliente pagó en
 * efectivo). Si era mixto, mueve toda la porción digital a efectivo.
 */
export async function convertTransferToCash(saleId, { byUid, byName } = {}) {
  const snap = await getDoc(saleRef(saleId))
  if (!snap.exists()) throw new Error('Venta no encontrada')
  const sale = snap.data()
  const update = {
    paymentMethod: 'efectivo',
    transferConfirmation: deleteField(),
    paymentReclass: {
      from: sale.paymentMethod || 'nequi',
      to: 'efectivo',
      by: byUid || null,
      byName: byName || null,
      at: serverTimestamp(),
      atClient: Date.now(),
      reason: 'transfer_not_received',
    },
  }
  if (sale.paymentMethod === 'mixto' && sale.paymentSplit) {
    const sum = Object.values(sale.paymentSplit).reduce((s, a) => s + (Number(a) || 0), 0)
    update.paymentSplit = deleteField()
    update.cashReceived = sum
  }
  await updateDoc(saleRef(saleId), update)
}

/** Suscripción a TODAS las ventas (para admin, futuras fases). */
export function watchAllSales(callback) {
  const q = query(salesCol())
  return onSnapshot(
    q,
    snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => {
      console.error('[sales] watchAllSales error:', err)
      callback([])
    }
  )
}

/**
 * Suscripción SOLO a las ventas marcadas (status == 'flagged'). La campana de
 * notificaciones únicamente necesita esto: leer la colección entera para luego
 * filtrar en cliente disparaba miles de lecturas en cada arranque (agotaba la
 * cuota diaria de Firestore). Filtro de campo único → no requiere índice.
 */
// ──────────────────────────────────────────────────────────────
// Conciliación AUTOMÁTICA de transferencias (desde un movimiento del admin)
// ──────────────────────────────────────────────────────────────

/** Lectura puntual (one-shot) de las ventas de una fecha. */
export async function getSalesByDateOnce(dateStr) {
  if (!dateStr) return []
  const snap = await getDocs(query(salesCol(), where('date', '==', dateStr)))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

/**
 * Lectura puntual de las ventas DESDE una fecha (inclusive) hacia adelante.
 * Permite conciliar transferencias de días anteriores (ej. el admin registra
 * mañana lo de hoy). `date` es string ISO → la comparación lexicográfica es
 * cronológica; campo único → Firestore lo indexa solo.
 */
export async function getSalesSinceOnce(sinceDate) {
  if (!sinceDate) return []
  const snap = await getDocs(query(salesCol(), where('date', '>=', sinceDate)))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

function saleTimeMs(s) {
  return s.createdAt?.toMillis?.() ?? s.createdAtClient ?? 0
}

/** Minutos del dia (Bogota) de una venta, o null si aun no tiene timestamp. */
function saleMinutesOf(s) {
  const d = s.createdAt?.toDate?.()
  if (!d) return null
  const hhmm = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Bogota' })
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/**
 * El admin registro un ingreso por transferencia (NEQUI/DAVIPLATA) de `amount`.
 * Busca la venta a chulear, en orden viejo->nuevo, con tolerancia +-$500:
 *   1. La transferencia pendiente MAS VIEJA: si coincide (exacta o +-500) -> esa.
 *   2. Si la mas vieja no coincide, busca adelante una exacta; si no, una +-500.
 *      (al saltarse las de antes, esas quedan "saltadas" = se calculan en rojo).
 * Devuelve { matched: sale|null, discrepancy }.
 */
export async function autoMatchTransferByMovement({ method, amount, sinceDate, movementId, byUid, byName }) {
  const amt = Number(amount) || 0
  const all = await getSalesSinceOnce(sinceDate)
  const pending = all
    .filter(s => (s.status || 'active') !== 'deleted')
    .filter(s => s.transferConfirmation?.status !== 'confirmed')
    .filter(s => digitalAmount(s, method) > 0)
    .sort((a, b) => saleTimeMs(a) - saleTimeMs(b))

  if (pending.length === 0) return { matched: null, reason: 'no_pending' }

  const diffOf = (s) => digitalAmount(s, method) - amt
  let chosen = null
  let discrepancy = 0

  const s0 = pending[0]
  if (Math.abs(diffOf(s0)) <= TRANSFER_VALUE_TOLERANCE) {
    chosen = s0
    discrepancy = diffOf(s0)
  } else {
    chosen = pending.find(s => digitalAmount(s, method) === amt) || null
    if (chosen) discrepancy = 0
    else {
      chosen = pending.find(s => Math.abs(diffOf(s)) <= TRANSFER_VALUE_TOLERANCE) || null
      if (chosen) discrepancy = diffOf(chosen)
    }
  }

  if (!chosen) return { matched: null, reason: 'no_match' }

  await confirmTransfer(chosen.id, {
    byUid, byName, source: 'movement', movementId,
    discrepancyAmount: discrepancy || 0,
  })
  return { matched: chosen, discrepancy }
}

/**
 * Busca ventas que pudieron quedar MAL MARCADAS (ej. como efectivo) para una
 * transferencia que el admin no encontro: por monto (+-$500) y hora (+-15 min).
 * Excluye deuda y las que ya son de ese metodo digital. Ordena por cercania.
 */
export async function findMismarkedTransferCandidates({ sinceDate, method, amount, targetMinutes }) {
  const amt = Number(amount) || 0
  if (amt <= 0) return []
  const all = await getSalesSinceOnce(sinceDate)
  return all
    .filter(s => (s.status || 'active') !== 'deleted')
    .filter(s => s.paymentMethod !== 'deuda')
    .filter(s => digitalAmount(s, method) === 0)
    .filter(s => Math.abs((Number(s.total) || 0) - amt) <= TRANSFER_VALUE_TOLERANCE)
    .filter(s => {
      if (targetMinutes == null) return true
      const sm = saleMinutesOf(s)
      return sm != null && Math.abs(sm - targetMinutes) <= TRANSFER_TIME_TOLERANCE
    })
    .map(s => ({
      sale: s,
      dv: Math.abs((Number(s.total) || 0) - amt),
      dt: targetMinutes != null && saleMinutesOf(s) != null ? Math.abs(saleMinutesOf(s) - targetMinutes) : 999,
    }))
    .sort((a, b) => (a.dt - b.dt) || (a.dv - b.dv))
    .map(x => x.sale)
}

export function watchFlaggedSales(callback) {
  const q = query(salesCol(), where('status', '==', 'flagged'))
  return onSnapshot(
    q,
    snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => {
      console.error('[sales] watchFlaggedSales error:', err)
      callback([])
    }
  )
}

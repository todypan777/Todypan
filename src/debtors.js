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

/** Suscripción a todos los deudores. */
export function watchDebtors(callback) {
  const q = query(debtorsCol())
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
export async function addDebtSale(existingDebtors, { name, amount, saleId, date }) {
  const normalized = normalizeName(name)
  // Ignorar deudores fusionados (mergedInto): si no, una venta con el nombre
  // viejo "resucitaría" un tombstone en vez de ir al deudor superviviente.
  const existing = existingDebtors
    .filter(d => !d.mergedInto)
    .find(d => normalizeName(d.name) === normalized)

  if (existing) {
    const newTotal = (Number(existing.totalOwed) || 0) + (Number(amount) || 0)
    // Fire-and-forget: en modo ahorro `await updateDoc` se cuelga.
    // Importante: re-calculamos `status`. Si el deudor estaba en 'paid' por
    // haber saldado, una nueva deuda lo devuelve a 'active' — sin esto se
    // quedaba en la pestaña "Ya pagaron" para siempre aunque debiera plata.
    updateDoc(debtorRef(existing.id), {
      totalOwed: newTotal,
      status: newTotal > 0 ? 'active' : 'paid',
      lastUpdate: serverTimestamp(),
      history: arrayUnion({
        type: 'sale',
        saleId,
        amount: Number(amount) || 0,
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

  const currentOwed = Number(debtor.totalOwed) || 0
  const newOwed = Math.max(0, currentOwed - amount)

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
    totalOwed: newOwed,
    lastUpdate: serverTimestamp(),
    history: arrayUnion(paymentEntry),
    status: newOwed === 0 ? 'paid' : 'active',
  })

  return { newOwed, fullyPaid: newOwed === 0 }
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
  const newOwed = Math.max(0, (Number(debtor.totalOwed) || 0) + delta)

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
    totalOwed: newOwed,
    lastUpdate: serverTimestamp(),
    history: arrayUnion(adjustEntry),
    status: newOwed === 0 ? 'paid' : 'active',
  })

  return { newOwed, delta }
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

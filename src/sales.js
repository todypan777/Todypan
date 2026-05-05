import { firestoreDb } from './firebase'
import {
  doc,
  collection,
  addDoc,
  updateDoc,
  serverTimestamp,
  query,
  where,
  onSnapshot,
  arrayUnion,
  getDoc,
} from 'firebase/firestore'

const saleRef = (id) => doc(firestoreDb, 'sales', id)

const salesCol = () => collection(firestoreDb, 'sales')

/**
 * Crea una venta nueva. payload:
 *  - sessionId, branchId, cashierUid, cashierName
 *  - items: [{ productId, source: 'admin'|'cashier'|'inline', name, qty, unitPrice, subtotal }]
 *  - total
 *  - paymentMethod: 'efectivo' | 'nequi' | 'daviplata' | 'deuda'
 *  - cashReceived?  (solo efectivo)
 *  - photoUrl?      (solo nequi/daviplata, Fase 4)
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
  if (payload.photoUrl) {
    data.photoUrl = payload.photoUrl
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
  const ref = await addDoc(salesCol(), data)
  return ref.id
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
      list.sort((a, b) => {
        const ta = a.createdAt?.toMillis?.() ?? 0
        const tb = b.createdAt?.toMillis?.() ?? 0
        return tb - ta
      })
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
  await updateDoc(saleRef(saleId), {
    status: 'flagged',
    notes: arrayUnion(newNote),
  })
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

import { firestoreDb } from './firebase'
import {
  doc,
  collection,
  addDoc,
  serverTimestamp,
  query,
  where,
  onSnapshot,
} from 'firebase/firestore'

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

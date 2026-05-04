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
} from 'firebase/firestore'

const expensesCol = () => collection(firestoreDb, 'cashExpenses')
const expenseRef = (id) => doc(firestoreDb, 'cashExpenses', id)

/**
 * Crea un gasto de caja. La cajera lo registra; queda como 'pending'
 * hasta que el admin lo apruebe o rechace en su pestaña Pendientes (Fase 6).
 *
 * payload:
 *   - sessionId, branchId, branchName, cashierUid, cashierName
 *   - description (string, requerido)
 *   - amount (number, > 0)
 *   - photoUrl (opcional)
 */
export async function createCashExpense(payload) {
  const data = {
    sessionId: payload.sessionId,
    branchId: payload.branchId,
    branchName: payload.branchName || null,
    cashierUid: payload.cashierUid,
    cashierName: payload.cashierName,
    description: payload.description.trim(),
    amount: Number(payload.amount) || 0,
    createdAt: serverTimestamp(),
    status: 'pending',
  }
  if (payload.photoUrl) {
    data.photoUrl = payload.photoUrl
  }
  const ref = await addDoc(expensesCol(), data)
  return ref.id
}

/** Suscripción a los gastos de una sesión específica (vista cajera). */
export function watchSessionExpenses(sessionId, callback) {
  if (!sessionId) { callback([]); return () => {} }
  const q = query(expensesCol(), where('sessionId', '==', sessionId))
  return onSnapshot(
    q,
    snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      list.sort((a, b) => {
        const ta = a.createdAt?.toMillis?.() ?? 0
        const tb = b.createdAt?.toMillis?.() ?? 0
        return tb - ta
      })
      callback(list)
    },
    err => {
      console.error('[cashExpenses] watchSessionExpenses error:', err)
      callback([])
    }
  )
}

/** Suscripción a TODOS los gastos pendientes (para admin). */
export function watchPendingExpenses(callback) {
  const q = query(expensesCol(), where('status', '==', 'pending'))
  return onSnapshot(
    q,
    snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => {
      console.error('[cashExpenses] watchPendingExpenses error:', err)
      callback([])
    }
  )
}

/**
 * Solo admin: aprueba un gasto. En Fase 6 se llamará desde la pestaña
 * Pendientes y crearía un movement asociado. Por ahora solo cambia status.
 */
export async function approveCashExpense(id, { reviewedBy, movementId }) {
  await updateDoc(expenseRef(id), {
    status: 'approved',
    reviewedBy: reviewedBy || null,
    reviewedAt: serverTimestamp(),
    movementId: movementId || null,
  })
}

/** Solo admin: rechaza un gasto con nota. */
export async function rejectCashExpense(id, { reviewedBy, reviewNote }) {
  await updateDoc(expenseRef(id), {
    status: 'rejected',
    reviewedBy: reviewedBy || null,
    reviewedAt: serverTimestamp(),
    reviewNote: reviewNote || null,
  })
}

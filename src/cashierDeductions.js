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

/**
 * Descuentos pendientes que se aplicarán al próximo pago de nómina de la cajera.
 * Origen típico: falta de cierre de caja que el admin decidió cobrar.
 * Vive en /cashierDeductions/{id} (solo admin via reglas wildcard).
 *
 * En Fase 6.5 el flujo de pago de nómina los descontará automáticamente.
 */

const deductionsCol = () => collection(firestoreDb, 'cashierDeductions')
const deductionRef = (id) => doc(firestoreDb, 'cashierDeductions', id)

export async function createDeduction({
  cashierUid,
  cashierName,
  employeeId,
  amount,
  reason,
  sessionId,
  createdBy,
}) {
  const data = {
    cashierUid,
    cashierName,
    employeeId: employeeId || null,
    amount: Number(amount) || 0,
    reason: reason || 'cash_shortage',
    sessionId: sessionId || null,
    createdBy: createdBy || null,
    createdAt: serverTimestamp(),
    status: 'pending',
  }
  const ref = await addDoc(deductionsCol(), data)
  return ref.id
}

/** Watcher de descuentos pendientes (todos o de una cajera específica). */
export function watchPendingDeductions(callback, { cashierUid } = {}) {
  let q
  if (cashierUid) {
    q = query(
      deductionsCol(),
      where('status', '==', 'pending'),
      where('cashierUid', '==', cashierUid),
    )
  } else {
    q = query(deductionsCol(), where('status', '==', 'pending'))
  }
  return onSnapshot(
    q,
    snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => {
      console.error('[deductions] watchPendingDeductions error:', err)
      callback([])
    }
  )
}

/** Marcar descuento como aplicado (en el flujo de pago de nómina, Fase 6.5). */
export async function markDeductionApplied(id, paymentDate) {
  await updateDoc(deductionRef(id), {
    status: 'applied',
    appliedAt: serverTimestamp(),
    appliedToPaymentDate: paymentDate || null,
  })
}

/** Cancelar un descuento (admin se arrepintió antes de aplicarlo). */
export async function cancelDeduction(id, reason) {
  await updateDoc(deductionRef(id), {
    status: 'cancelled',
    cancelledAt: serverTimestamp(),
    cancelReason: reason || null,
  })
}

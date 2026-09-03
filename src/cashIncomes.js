import { firestoreDb } from './firebase'
import {
  doc,
  collection,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  query,
  where,
  onSnapshot,
} from 'firebase/firestore'
import { getClientTimestamp } from './utils/network'
import { addDocOffline } from './utils/firestoreOffline'

// ────────────────────────────────────────────────────────────────────────────
// INGRESOS DE CAJA — espejo de cashExpenses.
//
// La cajera registra plata que ENTRA a la caja fuera de las ventas: un abono a
// una deuda, un préstamo de la dueña, una devolución, etc. Queda 'pending'
// hasta que el admin lo apruebe/rechace al cerrar el turno (igual que los
// gastos). Al aprobar:
//   - se crea un movement tipo 'income' con origin 'caja';
//   - si el ingreso quedó enlazado a un deudor (debtorId), el admin además
//     abona esa deuda (lo aplica registerDebtorPayment desde el cierre).
//
// El ingreso SUMA al efectivo esperado en el cuadre (al revés de un gasto).
//
// Offline: addDocOffline (fire-and-forget) + la cola de fotos genérica
// (photoQueue, target.collection = 'cashIncomes'). La cajera NO toca deudores
// sin red: el debtorId queda guardado como intención y el abono se aplica
// cuando el admin aprueba (online).
// ────────────────────────────────────────────────────────────────────────────

const incomesCol = () => collection(firestoreDb, 'cashIncomes')
const incomeRef = (id) => doc(firestoreDb, 'cashIncomes', id)

function timeOf(doc) {
  return doc.createdAt?.toMillis?.() ?? doc.createdAtClient ?? 0
}

/**
 * Crea un ingreso de caja. payload:
 *   - sessionId, branchId, branchName, cashierUid, cashierName
 *   - description (string, requerido)
 *   - amount (number, > 0)
 *   - debtorId?, debtorName?  (si es abono a una deuda existente)
 *   - photoUrl? / photoLocalId?  (foto opcional, igual que los gastos)
 *   - recordedByUid/Name/Role?  (modo asistir del admin)
 */
export async function createCashIncome(payload) {
  const data = {
    sessionId: payload.sessionId,
    branchId: payload.branchId,
    branchName: payload.branchName || null,
    cashierUid: payload.cashierUid,
    cashierName: payload.cashierName,
    description: payload.description.trim(),
    amount: Number(payload.amount) || 0,
    createdAt: serverTimestamp(),
    createdAtClient: getClientTimestamp(),
    status: 'pending',
  }
  if (payload.debtorId) {
    data.debtorId = payload.debtorId
    data.debtorName = payload.debtorName || null
  }
  if (payload.photoUrl) {
    data.photoUrl = payload.photoUrl
    data.photoStatus = 'uploaded'
  } else if (payload.photoLocalId) {
    data.photoStatus = 'pending'
    data.photoLocalId = payload.photoLocalId
  }
  if (payload.recordedByUid) {
    data.recordedByUid = payload.recordedByUid
    data.recordedByName = payload.recordedByName || null
    data.recordedByRole = payload.recordedByRole || 'admin'
  }
  const ref = addDocOffline(incomesCol(), data)
  return ref.id
}

/** Suscripción a los ingresos de una sesión (vista cajera y cierre admin). */
export function watchSessionIncomes(sessionId, callback) {
  if (!sessionId) { callback([]); return () => {} }
  const q = query(incomesCol(), where('sessionId', '==', sessionId))
  return onSnapshot(
    q,
    { includeMetadataChanges: true },
    snap => {
      const list = snap.docs.map(d => ({
        id: d.id,
        ...d.data(),
        _pendingWrite: d.metadata.hasPendingWrites,
      }))
      list.sort((a, b) => timeOf(b) - timeOf(a))
      callback(list)
    },
    err => {
      console.error('[cashIncomes] watchSessionIncomes error:', err)
      callback([])
    }
  )
}

/**
 * La CAJERA edita un ingreso propio que sigue 'pending'. Solo descripción y
 * monto (el resto lo protege la regla). Fire-and-forget (offline / modo ahorro).
 */
export function updateCashIncome(id, { description, amount }) {
  const data = {
    description: String(description || '').trim(),
    amount: Number(amount) || 0,
    editedAt: serverTimestamp(),
    editedAtClient: getClientTimestamp(),
  }
  updateDoc(incomeRef(id), data).catch(err => {
    console.warn('[cashIncomes] updateCashIncome deferred:', err?.message || err)
  })
}

/** La CAJERA elimina un ingreso propio que sigue 'pending' (lo subió por error). */
export function deleteCashIncome(id) {
  deleteDoc(incomeRef(id)).catch(err => {
    console.warn('[cashIncomes] deleteCashIncome deferred:', err?.message || err)
  })
}


/**
 * Solo admin: aprueba un ingreso. Liga el movement creado (movementId) y, si
 * aplicó abono a deuda, el id del deudor abonado (debtorPaymentApplied).
 */
export async function approveCashIncome(id, { reviewedBy, movementId, debtorPaymentApplied } = {}) {
  const update = {
    status: 'approved',
    reviewedBy: reviewedBy || null,
    reviewedAt: serverTimestamp(),
    movementId: movementId || null,
  }
  if (debtorPaymentApplied) update.debtorPaymentApplied = true
  await updateDoc(incomeRef(id), update)
}

/** Solo admin: rechaza un ingreso con nota. */
export async function rejectCashIncome(id, { reviewedBy, reviewNote } = {}) {
  await updateDoc(incomeRef(id), {
    status: 'rejected',
    reviewedBy: reviewedBy || null,
    reviewedAt: serverTimestamp(),
    reviewNote: reviewNote || null,
  })
}

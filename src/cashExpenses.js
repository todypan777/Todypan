import { firestoreDb } from './firebase'
import {
  doc,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  query,
  where,
  onSnapshot,
} from 'firebase/firestore'
import { getClientTimestamp } from './utils/network'
import { addDocOffline } from './utils/firestoreOffline'

const expensesCol = () => collection(firestoreDb, 'cashExpenses')
const expenseRef = (id) => doc(firestoreDb, 'cashExpenses', id)

function timeOf(doc) {
  return doc.createdAt?.toMillis?.() ?? doc.createdAtClient ?? 0
}

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
    createdAtClient: getClientTimestamp(),
    status: 'pending',
  }
  if (payload.photoUrl) {
    data.photoUrl = payload.photoUrl
    data.photoStatus = 'uploaded'
  } else if (payload.photoLocalId) {
    data.photoStatus = 'pending'
    data.photoLocalId = payload.photoLocalId
  }
  // Modo asistir: el admin registra el gasto en el turno de la cajera. El
  // gasto sigue siendo del turno (cashierUid/Name = la cajera) pero dejamos
  // traza de que lo hizo el admin — igual que las ventas asistidas.
  if (payload.recordedByUid) {
    data.recordedByUid = payload.recordedByUid
    data.recordedByName = payload.recordedByName || null
    data.recordedByRole = payload.recordedByRole || 'admin'
  }
  // Fire-and-forget para modo ahorro / offline (ver firestoreOffline.js).
  const ref = addDocOffline(expensesCol(), data)
  return ref.id
}

/**
 * Suscripción a los gastos de una sesión específica (vista cajera y cierre admin).
 *
 * Cada gasto trae `_pendingWrite`: true si el doc tiene cambios locales que el
 * servidor TODAVÍA no confirmó (creado/editado offline o en modo ahorro). Es la
 * señal que la cajera necesita para saber qué gastos aún NO han subido — si
 * cierra el turno con alguno sin subir, el admin no lo vería. Por eso pedimos
 * includeMetadataChanges (sin él, hasPendingWrites no se actualiza solo).
 */
export function watchSessionExpenses(sessionId, callback) {
  if (!sessionId) { callback([]); return () => {} }
  const q = query(expensesCol(), where('sessionId', '==', sessionId))
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
      console.error('[cashExpenses] watchSessionExpenses error:', err)
      callback([])
    }
  )
}

/**
 * La CAJERA edita un gasto propio que sigue 'pending' (antes de que el admin lo
 * apruebe/rechace). Solo descripción y monto — el resto de campos los protege la
 * regla de Firestore. Fire-and-forget: no se cuelga en modo ahorro / offline; el
 * watcher refleja el cambio desde la caché local al instante.
 */
export function updateCashExpense(id, { description, amount }) {
  const data = {
    description: String(description || '').trim(),
    amount: Number(amount) || 0,
    editedAt: serverTimestamp(),
    editedAtClient: getClientTimestamp(),
  }
  updateDoc(expenseRef(id), data).catch(err => {
    console.warn('[cashExpenses] updateCashExpense deferred:', err?.message || err)
  })
}

/**
 * La CAJERA elimina un gasto propio que sigue 'pending' (lo subió por error).
 * Fire-and-forget por el mismo motivo que updateCashExpense.
 */
export function deleteCashExpense(id) {
  deleteDoc(expenseRef(id)).catch(err => {
    console.warn('[cashExpenses] deleteCashExpense deferred:', err?.message || err)
  })
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

import { firestoreDb } from './firebase'
import {
  doc,
  collection,
  addDoc,
  updateDoc,
  deleteField,
  serverTimestamp,
  query,
  where,
  onSnapshot,
} from 'firebase/firestore'
import { getClientTimestamp } from './utils/network'

// ────────────────────────────────────────────────────────────────────────────
// Tareas asignadas por el admin a las cajeras.
//
// Modelo:
//   tasks/{id}
//     assignedToUid, assignedToName     (cajera responsable)
//     createdBy, createdByName          (admin)
//     title, description?
//     branchId?, branchName?            (limitar a una panadería; opcional)
//     dueDate?                          (YYYY-MM-DD; opcional)
//     status: 'pending' | 'done' | 'cancelled'
//     createdAt, createdAtClient
//     completedAt?, completedAtClient?
//     completedInSessionId?             (para que el cierre antiguo las liste)
//     completedNote?
//     cancelledAt?, cancelledBy?, cancelReason?
//
// Reglas de visibilidad:
//   - Admin ve todas
//   - Cajera ve solo las propias (assignedToUid == su uid)
// ────────────────────────────────────────────────────────────────────────────

const tasksCol = () => collection(firestoreDb, 'tasks')
const taskRef = (id) => doc(firestoreDb, 'tasks', id)

function timeOf(t) {
  return t.createdAt?.toMillis?.() ?? t.createdAtClient ?? 0
}

/**
 * Crea una tarea (la llama el admin).
 *
 * payload:
 *   - assignedToUid, assignedToName  (cajera asignada — requerido)
 *   - createdBy, createdByName       (admin — requerido)
 *   - title (string, requerido)
 *   - description? (string)
 *   - branchId?, branchName?
 *   - dueDate? (YYYY-MM-DD)
 */
export async function createTask(payload) {
  const data = {
    assignedToUid: payload.assignedToUid,
    assignedToName: payload.assignedToName || null,
    createdBy: payload.createdBy,
    createdByName: payload.createdByName || null,
    title: (payload.title || '').trim(),
    description: payload.description?.trim() || null,
    branchId: payload.branchId ?? null,
    branchName: payload.branchName || null,
    dueDate: payload.dueDate || null,
    status: 'pending',
    createdAt: serverTimestamp(),
    createdAtClient: getClientTimestamp(),
  }
  const ref = await addDoc(tasksCol(), data)
  return ref.id
}

/**
 * Cajera marca una tarea como hecha.
 *
 * sessionId: el turno actual de la cajera (queda registrado para que se
 * pueda mostrar en el cierre antiguo).
 */
export async function markTaskDone(taskId, { sessionId, note } = {}) {
  await updateDoc(taskRef(taskId), {
    status: 'done',
    completedAt: serverTimestamp(),
    completedAtClient: getClientTimestamp(),
    completedInSessionId: sessionId || null,
    completedNote: note?.trim() || null,
  })
}

/**
 * Cajera des-chulea una tarea (mientras el turno siga abierto). Vuelve a
 * 'pending' y borra los campos de completada.
 */
export async function unmarkTaskDone(taskId) {
  await updateDoc(taskRef(taskId), {
    status: 'pending',
    completedAt: deleteField(),
    completedAtClient: deleteField(),
    completedInSessionId: deleteField(),
    completedNote: deleteField(),
  })
}

/** Admin cancela una tarea (no se completó pero ya no aplica). */
export async function cancelTask(taskId, { adminUid, reason } = {}) {
  await updateDoc(taskRef(taskId), {
    status: 'cancelled',
    cancelledAt: serverTimestamp(),
    cancelledBy: adminUid || null,
    cancelReason: reason?.trim() || null,
  })
}

/** Admin reactiva una tarea cancelada (vuelve a pending). */
export async function reopenTask(taskId) {
  await updateDoc(taskRef(taskId), {
    status: 'pending',
    cancelledAt: deleteField(),
    cancelledBy: deleteField(),
    cancelReason: deleteField(),
  })
}

/** Admin edita título/descripción/dueDate de una tarea pendiente. */
export async function editTask(taskId, patch) {
  const update = {}
  if (patch.title != null) update.title = patch.title.trim()
  if (patch.description !== undefined) update.description = patch.description?.trim() || null
  if (patch.dueDate !== undefined) update.dueDate = patch.dueDate || null
  if (patch.branchId !== undefined) {
    update.branchId = patch.branchId ?? null
    update.branchName = patch.branchName || null
  }
  if (Object.keys(update).length === 0) return
  await updateDoc(taskRef(taskId), update)
}

/**
 * Suscripción a TODAS las tareas (admin). Ordenadas por createdAt desc.
 */
export function watchAllTasks(callback) {
  const q = query(tasksCol())
  return onSnapshot(
    q,
    snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      list.sort((a, b) => timeOf(b) - timeOf(a))
      callback(list)
    },
    err => {
      console.error('[tasks] watchAllTasks error:', err)
      callback([])
    }
  )
}

/**
 * Suscripción a las tareas de una cajera específica (vista cajera).
 * Mantiene el último valor en error transitorio (igual que watchMyOpenSession)
 * para que la cajera no vea su lista vaciarse al perder señal.
 */
export function watchTasksForCashier(uid, callback) {
  if (!uid) { callback([]); return () => {} }
  const q = query(tasksCol(), where('assignedToUid', '==', uid))
  return onSnapshot(
    q,
    snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      list.sort((a, b) => timeOf(b) - timeOf(a))
      callback(list)
    },
    err => {
      console.error('[tasks] watchTasksForCashier error (manteniendo último valor):', err?.message || err)
    }
  )
}

/**
 * Tareas que se completaron dentro de una sesión específica
 * (para mostrar en el modal de cierre antiguo).
 */
export function watchTasksCompletedInSession(sessionId, callback) {
  if (!sessionId) { callback([]); return () => {} }
  const q = query(tasksCol(), where('completedInSessionId', '==', sessionId))
  return onSnapshot(
    q,
    snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      list.sort((a, b) => {
        const ta = a.completedAt?.toMillis?.() ?? a.completedAtClient ?? 0
        const tb = b.completedAt?.toMillis?.() ?? b.completedAtClient ?? 0
        return ta - tb
      })
      callback(list)
    },
    err => {
      console.error('[tasks] watchTasksCompletedInSession error:', err)
      callback([])
    }
  )
}

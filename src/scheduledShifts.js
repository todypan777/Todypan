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

// ────────────────────────────────────────────────────────────────────────────
// Turnos PLANIFICADOS (no en vivo). El admin asigna a cada empleado un rol
// + horario para una fecha específica. Es solo plan: NO abre el turno real
// (eso lo sigue haciendo el admin desde el Dashboard).
//
// Modelo:
//   /scheduledShifts/{id}
//     date: 'YYYY-MM-DD'          fecha del turno (no de creación)
//     employeeId: 'eXXXXXX'       id en data.employees
//     personName: 'María López'   denormalizado para mostrar
//     branchId: 1                 panadería asignada
//     branchName: 'Panadería A'   denormalizado
//     role: 'cash' | 'kitchen' | 'waitress'
//     startTime: 'HH:MM'          24h interno (la UI muestra 12h con am/pm)
//     endTime: 'HH:MM'            24h interno
//     createdAt, createdBy
//     updatedAt? (al editar)
// ────────────────────────────────────────────────────────────────────────────

const shiftsCol = () => collection(firestoreDb, 'scheduledShifts')
const shiftRef = (id) => doc(firestoreDb, 'scheduledShifts', id)

/** Crear un turno planificado. */
export async function createScheduledShift(data) {
  const payload = {
    date: data.date,
    employeeId: data.employeeId,
    personName: data.personName,
    branchId: data.branchId,
    branchName: data.branchName || null,
    role: data.role,
    startTime: data.startTime,
    endTime: data.endTime,
    createdAt: serverTimestamp(),
    createdBy: data.createdBy || null,
  }
  const ref = await addDoc(shiftsCol(), payload)
  return ref.id
}

/** Actualizar un turno planificado. */
export async function updateScheduledShift(id, patch) {
  await updateDoc(shiftRef(id), {
    ...patch,
    updatedAt: serverTimestamp(),
  })
}

/** Eliminar un turno planificado. */
export async function deleteScheduledShift(id) {
  await deleteDoc(shiftRef(id))
}

/** Suscripción a los turnos planificados de una fecha. */
export function watchShiftsForDate(date, callback) {
  if (!date) { callback([]); return () => {} }
  const q = query(shiftsCol(), where('date', '==', date))
  return onSnapshot(
    q,
    snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      // Ordenar por hora de inicio.
      list.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''))
      callback(list)
    },
    err => {
      console.error('[scheduledShifts] watchShiftsForDate error:', err)
      callback([])
    }
  )
}

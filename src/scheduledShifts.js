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

/** Suscripción a los turnos planificados de una fecha, acotada por panadería. */
export function watchShiftsForDate(date, callback, branchIds = null) {
  if (!date) { callback([]); return () => {} }
  // La escritura ya estaba acotada por panaderia; la lectura no. Sin este
  // filtro un dueño ve los turnos del otro (nombre del empleado, sede y
  // horario), y a uno con `branchIds` las reglas le rechazan la consulta
  // entera —el catch de abajo emite una lista vacia y la pantalla se queda
  // sin turnos, sin decir por que.
  //
  // Dos igualdades (date + branchId): no necesita indice compuesto.
  const parts = [where('date', '==', date)]
  if (Array.isArray(branchIds) && branchIds.length > 0) {
    parts.push(where('branchId', 'in', branchIds))
  }
  const q = query(shiftsCol(), ...parts)
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

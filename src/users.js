import { firestoreDb } from './firebase'
import { ADMIN_EMAIL } from './auth'
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore'
import { addEmployee } from './db'

const usersCol = () => collection(firestoreDb, 'users')
const userRef = (uid) => doc(firestoreDb, 'users', uid)

/** Suscripción al doc del usuario actual. callback(userDoc | null). */
export function watchUserDoc(uid, callback) {
  if (!uid) {
    callback(null)
    return () => {}
  }
  return onSnapshot(
    userRef(uid),
    snap => callback(snap.exists() ? { uid: snap.id, ...snap.data() } : null),
    err => {
      console.error('[users] error en watchUserDoc:', err)
      callback(null)
    }
  )
}

/** Suscripción a TODOS los usuarios (solo admin). */
export function watchAllUsers(callback) {
  const q = query(usersCol(), orderBy('createdAt', 'desc'))
  return onSnapshot(
    q,
    snap => callback(snap.docs.map(d => ({ uid: d.id, ...d.data() }))),
    err => {
      console.error('[users] error en watchAllUsers:', err)
      callback([])
    }
  )
}

/** Crea un user pendiente (cajera nueva auto-registrándose). */
export async function createPendingUser(authUser, nombre, apellido) {
  const data = {
    email: authUser.email,
    photoURL: authUser.photoURL || null,
    nombre: nombre.trim(),
    apellido: apellido.trim(),
    role: 'cashier',
    status: 'pending',
    createdAt: serverTimestamp(),
  }
  await setDoc(userRef(authUser.uid), data)
}

/**
 * Bootstrap del admin: si el correo coincide con ADMIN_EMAIL y aún no tiene doc,
 * lo crea con role=admin status=approved automáticamente.
 * Idempotente: si el doc ya existe, no hace nada.
 */
export async function bootstrapAdminIfNeeded(authUser) {
  if (!authUser || authUser.email !== ADMIN_EMAIL) return
  const snap = await getDoc(userRef(authUser.uid))
  if (snap.exists()) return

  const data = {
    email: authUser.email,
    photoURL: authUser.photoURL || null,
    nombre: authUser.displayName?.split(' ')[0] || 'Jhonatan',
    apellido: authUser.displayName?.split(' ').slice(1).join(' ') || 'Miranda',
    role: 'admin',
    status: 'approved',
    createdAt: serverTimestamp(),
    approvedAt: serverTimestamp(),
    approvedBy: authUser.uid,
  }
  await setDoc(userRef(authUser.uid), data)
}

/**
 * Aprueba un user pendiente y crea su empleado vinculado.
 * employeeData: { nombre, apellido, telefono, rate? }
 */
export async function approveUserAndCreateEmployee(uid, employeeData, approvedByUid) {
  const fullName = `${employeeData.nombre.trim()} ${employeeData.apellido.trim()}`.trim()
  const empPayload = {
    name: fullName,
    phone: employeeData.telefono.trim(),
    rate: Number(employeeData.rate) || 0,
    type: 'regular',
    workHours: 9,
    linkedUserId: uid,
  }
  const employeeId = addEmployee(empPayload)

  await updateDoc(userRef(uid), {
    nombre: employeeData.nombre.trim(),
    apellido: employeeData.apellido.trim(),
    status: 'approved',
    approvedAt: serverTimestamp(),
    approvedBy: approvedByUid,
    linkedEmployeeId: employeeId,
  })

  return employeeId
}

/** Desactiva un usuario (sin borrar). */
export async function deactivateUser(uid) {
  await updateDoc(userRef(uid), {
    status: 'inactive',
    deactivatedAt: serverTimestamp(),
  })
}

/** Reactiva un usuario inactivo. */
export async function reactivateUser(uid) {
  await updateDoc(userRef(uid), {
    status: 'approved',
    deactivatedAt: null,
  })
}

/** Rechaza un user pendiente (lo marca como inactive, sin crear empleado). */
export async function rejectPendingUser(uid) {
  await updateDoc(userRef(uid), {
    status: 'inactive',
    deactivatedAt: serverTimestamp(),
  })
}

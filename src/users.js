import { firestoreDb } from './firebase'
import { isRootEmail } from './auth'
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
      // CRÍTICO: NO llamamos callback(null) aquí. Antes lo hacíamos y eso
      // causaba que cuando la cajera se quedaba sin internet en medio del
      // turno, este listener disparara error → AuthCtx recibía null →
      // setUserDoc(null) → la app la mandaba a RegistrationForm o Login
      // y "le cerraba la sesión" desde su perspectiva. El error suele ser
      // transitorio (red caída, lock momentáneo, etc.) — el snapshot
      // posterior trae el doc real. Mantener el último valor del callback
      // permite que la cajera siga trabajando offline.
      console.error('[users] watchUserDoc error (manteniendo último valor):', err?.message || err)
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

/**
 * Crea un user pendiente. Todos los miembros del equipo son 'staff' — el rol
 * funcional (caja / cocina / mesera) se decide por turno, no es permanente.
 */
export async function createPendingUser(authUser, nombre, apellido) {
  const data = {
    email: authUser.email,
    photoURL: authUser.photoURL || null,
    nombre: nombre.trim(),
    apellido: apellido.trim(),
    role: 'staff',
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
  if (!authUser || !isRootEmail(authUser.email)) return
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
 * employeeData: { nombre, apellido, telefono }
 *
 * El rol del usuario queda como 'staff'. El "rol funcional" (caja, cocina,
 * mesera) se asigna por turno, no es permanente.
 */
export async function approveUserAndCreateEmployee(uid, employeeData, approvedByUid) {
  const fullName = `${employeeData.nombre.trim()} ${employeeData.apellido.trim()}`.trim()
  const empPayload = {
    name: fullName,
    phone: employeeData.telefono.trim(),
    linkedUserId: uid,
  }
  const employeeId = addEmployee(empPayload)

  await updateDoc(userRef(uid), {
    nombre: employeeData.nombre.trim(),
    apellido: employeeData.apellido.trim(),
    role: 'staff',
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

/**
 * Asigna a un usuario las panaderías que puede ver.
 *
 * `branchIds` vacío o ausente = SIN restricción (ve todo), que es como se
 * comporto la app siempre. Por eso asignar sedes es una accion explicita: al
 * publicar este cambio nadie queda restringido de golpe, y el equipo que ya
 * venia trabajando sigue igual hasta que se le asigne su panaderia.
 *
 * Las reglas de Firestore aplican el mismo criterio sobre este mismo campo.
 */
export async function setUserBranches(uid, branchIds) {
  const clean = Array.isArray(branchIds) ? branchIds.filter(b => b != null) : []
  await updateDoc(doc(firestoreDb, 'users', uid), { branchIds: clean })
}

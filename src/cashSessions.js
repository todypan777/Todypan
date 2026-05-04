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
  getDocs,
} from 'firebase/firestore'

const sessionsCol = () => collection(firestoreDb, 'cashSessions')
const sessionRef = (id) => doc(firestoreDb, 'cashSessions', id)

/** Suscripción a TODAS las sesiones abiertas (para bloquear panaderías ocupadas). */
export function watchOpenSessions(callback) {
  const q = query(sessionsCol(), where('status', '==', 'open'))
  return onSnapshot(
    q,
    snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => {
      console.error('[cashSessions] watchOpenSessions error:', err)
      callback([])
    }
  )
}

/** Suscripción a la sesión abierta del usuario actual (cajera). null si no tiene. */
export function watchMyOpenSession(uid, callback) {
  if (!uid) { callback(null); return () => {} }
  const q = query(
    sessionsCol(),
    where('status', '==', 'open'),
    where('cashierUid', '==', uid),
  )
  return onSnapshot(
    q,
    snap => {
      if (snap.docs.length === 0) callback(null)
      else callback({ id: snap.docs[0].id, ...snap.docs[0].data() })
    },
    err => {
      console.error('[cashSessions] watchMyOpenSession error:', err)
      callback(null)
    }
  )
}

/**
 * Última sesión cerrada de una panadería específica.
 * Se usa para detectar handover pendiente hacia la cajera actual.
 * Filtramos por branchId+status, ordenamos en cliente (evita índice compuesto).
 */
export async function getLatestClosedSessionForBranch(branchId) {
  const q = query(
    sessionsCol(),
    where('branchId', '==', branchId),
    where('status', '==', 'closed'),
  )
  const snap = await getDocs(q)
  if (snap.empty) return null
  const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
  list.sort((a, b) => {
    const ta = a.closedAt?.toMillis?.() ?? 0
    const tb = b.closedAt?.toMillis?.() ?? 0
    return tb - ta
  })
  return list[0]
}

/**
 * Abre un nuevo turno.
 * Si openingSource = handover, indica de qué sesión viene el dinero.
 */
export async function openSession({
  branchId,
  branchName,
  cashierUid,
  cashierName,
  openingFloat,
  openingSource,   // { type: 'manual' | 'handover', fromSessionId?, fromCashierName? }
}) {
  const data = {
    branchId,
    branchName: branchName || null,
    cashierUid,
    cashierName,
    openingFloat: Number(openingFloat) || 0,
    openingSource: openingSource || { type: 'manual' },
    openedAt: serverTimestamp(),
    status: 'open',
  }
  const ref = await addDoc(sessionsCol(), data)
  return ref.id
}

/**
 * Cierra un turno con cuadre + handover.
 * payload: { declaredClosingCash, expectedCash, difference, handover }
 * handover: { type: 'admin' | 'cashier', toUid?, toName, amount }
 */
export async function closeSession(sessionId, payload) {
  await updateDoc(sessionRef(sessionId), {
    declaredClosingCash: Number(payload.declaredClosingCash) || 0,
    expectedCash: Number(payload.expectedCash) || 0,
    difference: Number(payload.difference) || 0,
    handover: payload.handover,
    closedAt: serverTimestamp(),
    status: 'closed',
  })
}

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
 * - openingSource describe de dónde viene el dinero inicial:
 *     { type: 'empty' | 'handover' | 'handover_disputed', fromSessionId?, fromCashierName? }
 * - openingDispute (opcional): si la cajera receptora declara monto distinto al esperado.
 *     { expected, declared, difference, status: 'pending' }
 */
export async function openSession({
  branchId,
  branchName,
  cashierUid,
  cashierName,
  openingFloat,
  openingSource,
  openingDispute,
}) {
  const data = {
    branchId,
    branchName: branchName || null,
    cashierUid,
    cashierName,
    openingFloat: Number(openingFloat) || 0,
    openingSource: openingSource || { type: 'empty' },
    openedAt: serverTimestamp(),
    status: 'open',
  }
  if (openingDispute) {
    data.openingDispute = {
      expected: Number(openingDispute.expected) || 0,
      declared: Number(openingDispute.declared) || 0,
      difference: Number(openingDispute.expected || 0) - Number(openingDispute.declared || 0),
      status: 'pending',
      reportedAt: serverTimestamp(),
    }
  }
  const ref = await addDoc(sessionsCol(), data)
  return ref.id
}

/**
 * Resuelve una disputa de apertura (solo admin).
 * resolution: 'accept' (admin acepta el monto declarado por cajera receptora)
 *           | 'reject' (admin rechaza, cajera receptora debe asumir la diferencia)
 */
export async function resolveOpeningDispute(sessionId, resolution, note, adminUid) {
  const status = resolution === 'accept' ? 'resolved' : 'rejected'
  await updateDoc(sessionRef(sessionId), {
    'openingDispute.status': status,
    'openingDispute.note': note || null,
    'openingDispute.reviewedBy': adminUid,
    'openingDispute.reviewedAt': serverTimestamp(),
  })
}

/**
 * Cierra un turno con cuadre + handover.
 * payload: {
 *   declaredClosingCash, expectedCash, difference, handover,
 *   closingNote?,                    ← nota opcional de la cajera
 *   closingDiscrepancy?              ← cuando declarado != esperado
 * }
 * handover: { type: 'admin' | 'cashier', toUid?, toName, amount }
 *
 * closingDiscrepancy:
 *   { type: 'shortage' | 'surplus', amount, status, note? }
 *   status: 'resolved' (sobras absorbidas en fondo) | 'pending' (faltas requieren admin)
 */
export async function closeSession(sessionId, payload) {
  const data = {
    declaredClosingCash: Number(payload.declaredClosingCash) || 0,
    expectedCash: Number(payload.expectedCash) || 0,
    difference: Number(payload.difference) || 0,
    handover: payload.handover,
    closedAt: serverTimestamp(),
    status: 'closed',
  }
  if (payload.closingNote) {
    data.closingNote = payload.closingNote
  }
  if (payload.closingDiscrepancy) {
    data.closingDiscrepancy = {
      type: payload.closingDiscrepancy.type,
      amount: Number(payload.closingDiscrepancy.amount) || 0,
      status: payload.closingDiscrepancy.status,
      note: payload.closingDiscrepancy.note || null,
      reportedAt: serverTimestamp(),
    }
  }
  await updateDoc(sessionRef(sessionId), data)
}

/**
 * Watcher que devuelve cualquier sesión (abierta o cerrada) con un
 * elemento que requiera acción del admin: openingDispute pendiente o
 * closingDiscrepancy de tipo shortage pendiente.
 */
export function watchSessionsWithPendingReview(callback) {
  const q = query(sessionsCol())
  return onSnapshot(
    q,
    snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      const filtered = all.filter(s =>
        s.openingDispute?.status === 'pending' ||
        s.closingDiscrepancy?.status === 'pending'
      )
      callback(filtered)
    },
    err => {
      console.error('[cashSessions] watchSessionsWithPendingReview error:', err)
      callback([])
    }
  )
}

/**
 * Calcula el saldo del fondo de sobras a partir de las sesiones cerradas.
 * Para Fase 2: solo suma sobras. En Fase 6 se restarán los retiros del fondo
 * (cuando admin lo use para cubrir una falta).
 */
export function watchSurplusFundBalance(callback) {
  const q = query(sessionsCol(), where('status', '==', 'closed'))
  return onSnapshot(
    q,
    snap => {
      let balance = 0
      snap.docs.forEach(d => {
        const data = d.data()
        if (data.closingDiscrepancy?.type === 'surplus') {
          balance += Number(data.closingDiscrepancy.amount) || 0
        }
      })
      callback(balance)
    },
    err => {
      console.error('[cashSessions] watchSurplusFundBalance error:', err)
      callback(0)
    }
  )
}

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

/**
 * Suscripción a TODAS las sesiones que bloquean la panadería:
 *  - 'open': cajera todavía atendiendo
 *  - 'pending_close': cajera ya cerró pero admin no ha aprobado
 *
 * Una panadería con cualquiera de estos estados NO puede recibir un nuevo turno.
 */
export function watchOpenSessions(callback) {
  const q = query(sessionsCol(), where('status', 'in', ['open', 'pending_close']))
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
 * Resuelve una falta de cierre (closingDiscrepancy con type='shortage').
 * resolution:
 *   - 'business_loss': el negocio asume la pérdida, no afecta cajera ni fondo
 *   - 'covered_by_fund': se descuenta del fondo de sobras (admin debe verificar saldo antes)
 *   - 'cashier_deduction': se le cobra a la cajera (crea entrada en cashierDeductions)
 *
 * payload:
 *   - resolution
 *   - note? (opcional)
 *   - reviewedBy (uid admin)
 *   - deductionId? (id en cashierDeductions, si resolution === 'cashier_deduction')
 */
export async function resolveClosingDiscrepancy(sessionId, payload) {
  await updateDoc(sessionRef(sessionId), {
    'closingDiscrepancy.status': payload.resolution === 'business_loss' ? 'absorbed'
                                : payload.resolution === 'covered_by_fund' ? 'fundCovered'
                                : 'deducted',
    'closingDiscrepancy.resolution': payload.resolution,
    'closingDiscrepancy.reviewNote': payload.note || null,
    'closingDiscrepancy.reviewedBy': payload.reviewedBy,
    'closingDiscrepancy.reviewedAt': serverTimestamp(),
    'closingDiscrepancy.deductionId': payload.deductionId || null,
  })
}

/**
 * La cajera cierra un turno con cuadre + handover.
 *
 * IMPORTANTE: el status NO pasa a 'closed' directo. Pasa a 'pending_close'
 * y la panadería sigue bloqueada hasta que el admin apruebe en Pendientes.
 *
 * payload: {
 *   declaredClosingCash, expectedCash, difference, handover,
 *   closingNote?,                    ← nota opcional de la cajera
 *   closingDiscrepancy?              ← cuando declarado != esperado
 * }
 * handover: { type: 'admin' | 'cashier', toUid?, toName, amount }
 *
 * closingDiscrepancy:
 *   { type: 'shortage' | 'surplus', amount, status, note? }
 *   status: 'pending' siempre al cerrar (admin resuelve junto con el cierre)
 */
export async function closeSession(sessionId, payload) {
  const data = {
    declaredClosingCash: Number(payload.declaredClosingCash) || 0,
    expectedCash: Number(payload.expectedCash) || 0,
    difference: Number(payload.difference) || 0,
    handover: payload.handover,
    closedAt: serverTimestamp(),
    status: 'pending_close',  // ← antes era 'closed'
  }
  if (payload.closingNote) {
    data.closingNote = payload.closingNote
  }
  if (payload.closingDiscrepancy) {
    data.closingDiscrepancy = {
      type: payload.closingDiscrepancy.type,
      amount: Number(payload.closingDiscrepancy.amount) || 0,
      status: 'pending',  // siempre pending hasta que admin apruebe
      note: payload.closingDiscrepancy.note || null,
      reportedAt: serverTimestamp(),
    }
  }
  await updateDoc(sessionRef(sessionId), data)
}

/**
 * Solo admin: aprueba el cierre de un turno (y opcionalmente resuelve la
 * discrepancia si aplica). Esta acción libera la panadería para nueva apertura.
 *
 * payload (todos opcionales según el caso):
 *   - reviewedBy: uid del admin
 *   - approveNote?: nota interna
 *   - resolution?: 'business_loss' | 'covered_by_fund' | 'cashier_deduction'
 *                  (solo si hay closingDiscrepancy.type === 'shortage')
 *   - deductionId?: id en cashierDeductions (si resolution === 'cashier_deduction')
 */
export async function approveSessionClose(sessionId, payload = {}) {
  const data = {
    status: 'closed',
    closeApprovedAt: serverTimestamp(),
    closeApprovedBy: payload.reviewedBy || null,
  }
  if (payload.approveNote) {
    data.closeApproveNote = payload.approveNote
  }

  if (payload.resolution) {
    data['closingDiscrepancy.status'] =
      payload.resolution === 'business_loss' ? 'absorbed'
      : payload.resolution === 'covered_by_fund' ? 'fundCovered'
      : payload.resolution === 'cashier_deduction' ? 'deducted'
      : 'resolved'
    data['closingDiscrepancy.resolution'] = payload.resolution
    data['closingDiscrepancy.reviewedBy'] = payload.reviewedBy || null
    data['closingDiscrepancy.reviewedAt'] = serverTimestamp()
    if (payload.deductionId) {
      data['closingDiscrepancy.deductionId'] = payload.deductionId
    }
    if (payload.approveNote) {
      data['closingDiscrepancy.reviewNote'] = payload.approveNote
    }
  } else {
    // Si hay surplus pero no hay resolution explícita, marcar como resuelto al fondo
    // (esto se procesa al aprobar el cierre).
    data['closingDiscrepancy.status'] = 'resolved'
    data['closingDiscrepancy.reviewedAt'] = serverTimestamp()
    data['closingDiscrepancy.reviewedBy'] = payload.reviewedBy || null
  }

  await updateDoc(sessionRef(sessionId), data)
}

/**
 * Watcher de sesiones que requieren acción del admin:
 *  - status 'pending_close': cierre esperando aprobación
 *  - openingDispute pendiente: disputa de apertura
 *  - closingDiscrepancy.shortage pendiente: residuos de cierres antiguos
 */
export function watchSessionsWithPendingReview(callback) {
  const q = query(sessionsCol())
  return onSnapshot(
    q,
    snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      const filtered = all.filter(s =>
        s.status === 'pending_close' ||
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
 * Calcula el saldo del fondo de sobras a partir de las sesiones cerradas:
 *  + sobras (closingDiscrepancy.type === 'surplus')
 *  − faltas cubiertas con fondo (resolution === 'covered_by_fund')
 */
export function watchSurplusFundBalance(callback) {
  const q = query(sessionsCol(), where('status', '==', 'closed'))
  return onSnapshot(
    q,
    snap => {
      let balance = 0
      snap.docs.forEach(d => {
        const data = d.data()
        const cd = data.closingDiscrepancy
        if (!cd) return
        if (cd.type === 'surplus') {
          balance += Number(cd.amount) || 0
        }
        if (cd.resolution === 'covered_by_fund') {
          balance -= Number(cd.amount) || 0
        }
      })
      callback(Math.max(0, balance))
    },
    err => {
      console.error('[cashSessions] watchSurplusFundBalance error:', err)
      callback(0)
    }
  )
}

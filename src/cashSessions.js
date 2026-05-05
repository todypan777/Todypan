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
import { addMovement, getBogotaDateStr } from './db'

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
 *   - 'business_loss': el negocio asume la pérdida, no afecta cajera
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
    'closingDiscrepancy.status': payload.resolution === 'business_loss' ? 'absorbed' : 'deducted',
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
  // Cierre desde la cajera: solo persiste lo declarado y a quien entrega.
  // El expectedCash, difference y closingDiscrepancy los calcula el admin
  // al aprobar (en ApproveCloseModal con desglose real de ventas y gastos).
  const data = {
    declaredClosingCash: Number(payload.declaredClosingCash) || 0,
    handover: payload.handover,
    closedAt: serverTimestamp(),
    status: 'pending_close',
  }
  if (payload.closingNote) {
    data.closingNote = payload.closingNote
  }
  await updateDoc(sessionRef(sessionId), data)
}

/**
 * Solo admin: aprueba el cierre de un turno. El admin calcula expectedCash
 * en vivo (con desglose real de ventas + gastos del turno) y lo manda aquí.
 *
 * Esta función:
 *  - Persiste expectedCash y difference calculados por el admin.
 *  - Crea closingDiscrepancy si hay diferencia (sobra o falta).
 *  - Si hay SOBRA: crea automáticamente un movimiento de ingreso
 *    (cat: 'sobra_caja') por el monto excedente.
 *  - Si hay FALTA con resolution='cashier_deduction': el caller debe
 *    crear la deduction antes y pasar deductionId.
 *  - Cambia status a 'closed' (libera la panadería para nuevo turno).
 *
 * payload:
 *   - reviewedBy: uid del admin (requerido)
 *   - expectedCash: number calculado por el admin (apertura + ventas efectivo - gastos aprobados)
 *   - approveNote?: nota interna del admin
 *   - resolution?: 'business_loss' | 'cashier_deduction' (solo si hay falta)
 *   - deductionId?: id en cashierDeductions (si resolution === 'cashier_deduction')
 *   - session: el doc de la sesión (necesario para movimientos / nombres)
 */
export async function approveSessionClose(sessionId, payload = {}) {
  const session = payload.session || {}
  const expectedCash = Number(payload.expectedCash) || 0
  const declared = Number(session.declaredClosingCash) || 0
  const difference = declared - expectedCash
  const isSurplus = difference > 0
  const isShortage = difference < 0

  const data = {
    status: 'closed',
    expectedCash,
    difference,
    closeApprovedAt: serverTimestamp(),
    closeApprovedBy: payload.reviewedBy || null,
  }
  if (payload.approveNote) {
    data.closeApproveNote = payload.approveNote
  }

  // Construir closingDiscrepancy según el resultado del cuadre
  if (isSurplus) {
    data.closingDiscrepancy = {
      type: 'surplus',
      amount: Math.abs(difference),
      status: 'resolved_as_income',
      reviewedBy: payload.reviewedBy || null,
      reviewedAt: serverTimestamp(),
    }
  } else if (isShortage) {
    if (!payload.resolution) {
      throw new Error('Se requiere resolution (business_loss | cashier_deduction) para aprobar un cierre con FALTA')
    }
    data.closingDiscrepancy = {
      type: 'shortage',
      amount: Math.abs(difference),
      status: payload.resolution === 'business_loss' ? 'absorbed' : 'deducted',
      resolution: payload.resolution,
      reviewedBy: payload.reviewedBy || null,
      reviewedAt: serverTimestamp(),
      reviewNote: payload.approveNote || null,
      deductionId: payload.deductionId || null,
    }
  }
  // Si difference === 0: cuadre exacto, no se crea closingDiscrepancy.

  // Si hay SOBRA, crear movimiento de ingreso "Sobra de cierre"
  let surplusMovementId = null
  if (isSurplus) {
    try {
      surplusMovementId = addMovement({
        type: 'income',
        amount: Math.abs(difference),
        date: getBogotaDateStr(),
        cat: 'sobra_caja',
        branch: session.branchId || 'both',
        origin: 'caja',
        sessionId,
        cashierName: session.cashierName,
        note: `Sobra de cierre · ${session.cashierName || 'cajera'}${session.branchName ? ' · ' + session.branchName : ''}`,
      })
      data.closingDiscrepancy.surplusMovementId = surplusMovementId
    } catch (e) {
      console.warn('[cashSessions] No se pudo registrar el movimiento de sobra:', e)
    }
  }

  await updateDoc(sessionRef(sessionId), data)
  return { surplusMovementId, difference, expectedCash }
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
 * Suscripción a las sesiones cerradas o pendientes de cierre cuyo cierre cae
 * en una fecha específica (zona Bogotá). Usado por la pantalla Registro para
 * mostrar el historial de cierres del día.
 *
 * Filtramos en cliente porque closedAt es Timestamp (no string).
 */
export function watchClosedSessionsForDate(dateStr, callback) {
  if (!dateStr) { callback([]); return () => {} }
  const q = query(sessionsCol(), where('status', 'in', ['closed', 'pending_close']))
  return onSnapshot(
    q,
    snap => {
      const list = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(s => {
          const ts = s.closedAt?.toDate?.()
          if (!ts) return false
          // Convertir a fecha Bogotá (YYYY-MM-DD)
          const bogotaDate = ts.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
          return bogotaDate === dateStr
        })
        .sort((a, b) => (b.closedAt?.toMillis?.() ?? 0) - (a.closedAt?.toMillis?.() ?? 0))
      callback(list)
    },
    err => {
      console.error('[cashSessions] watchClosedSessionsForDate error:', err)
      callback([])
    }
  )
}

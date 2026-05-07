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
import { addMovement, getBogotaDateStr, setCashFloor } from './db'
import { getClientTimestamp } from './utils/network'

// ────────────────────────────────────────────────────────────────────────────
// Modelo de turnos (D25 — actualizado 2026-05-06)
//
// El ADMIN abre y cierra todos los turnos. La cajera solo vende y registra
// gastos. No declara montos, no decide handover, no deja notas de cierre.
//
// Estados:
//   - 'open'         → turno activo (cajera atendiendo, admin asistiendo o ambos)
//   - 'closed'       → cerrado por el admin
//   - 'pending_close'→ LEGACY: sesiones cerradas por la cajera antes del cambio
//                      de modelo. El admin las puede cerrar desde el panel
//                      central con la misma UI que las nuevas.
// ────────────────────────────────────────────────────────────────────────────

const sessionsCol = () => collection(firestoreDb, 'cashSessions')
const sessionRef = (id) => doc(firestoreDb, 'cashSessions', id)

/**
 * Suscripción a TODAS las sesiones que bloquean la panadería:
 *  - 'open': turno activo
 *  - 'pending_close': LEGACY (cierre antiguo aún no procesado por el admin)
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
      // Mismo razonamiento que watchUserDoc: no llamamos callback(null) en
      // error porque eso le diría a CashierApp "no hay turno" → se mostraría
      // pantalla "Sin turno asignado" aunque la cajera SÍ tenga turno abierto.
      // Mantener el último valor permite seguir vendiendo offline.
      console.error('[cashSessions] watchMyOpenSession error (manteniendo último valor):', err?.message || err)
    }
  )
}

/**
 * Última sesión cerrada de una panadería (para mostrarle al admin el contexto
 * cuando va a abrir un nuevo turno).
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
 * Abre un nuevo turno. La llama el ADMIN desde el panel central.
 *
 * - openingFloat: monto físicamente en caja al abrir (default = base $200k).
 * - openingSource: { type: 'empty' | 'handover', fromSessionId?, fromCashierName? }
 *     'empty'    → caja arranca con la base sola ($200k). openingFloat = 0.
 *     'handover' → arranca con dinero ya presente (relevo en cadena por admin).
 *                  openingFloat = lo físicamente recibido (incluye base).
 */
export async function openSession({
  branchId,
  branchName,
  cashierUid,
  cashierName,
  openingFloat,
  openingSource,
}) {
  const data = {
    branchId,
    branchName: branchName || null,
    cashierUid,
    cashierName,
    openingFloat: Number(openingFloat) || 0,
    openingSource: openingSource || { type: 'empty' },
    openedAt: serverTimestamp(),
    openedAtClient: getClientTimestamp(),
    status: 'open',
  }
  const ref = await addDoc(sessionsCol(), data)
  return ref.id
}

/**
 * Resuelve una falta de cierre (closingDiscrepancy con type='shortage').
 * LEGACY: solo se usa para discrepancias antiguas que quedaron en 'pending'
 * antes del cambio de modelo. En el flujo nuevo el admin resuelve la
 * discrepancia dentro de adminCloseSession.
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
 * Lee de Firestore las sales y cashExpenses del turno y devuelve el snapshot:
 *  - salesBreakdown: { efectivo, nequi, daviplata, deuda, total, count }
 *  - expensesAtClose: { approvedTotal, pendingTotal, count }
 *
 * Lectura puntual (getDocs), no watcher.
 */
async function buildSessionSnapshot(sessionId) {
  const salesQ = query(collection(firestoreDb, 'sales'), where('sessionId', '==', sessionId))
  const expensesQ = query(collection(firestoreDb, 'cashExpenses'), where('sessionId', '==', sessionId))
  const [salesSnap, expensesSnap] = await Promise.all([getDocs(salesQ), getDocs(expensesQ)])

  const salesBreakdown = { efectivo: 0, nequi: 0, daviplata: 0, deuda: 0, total: 0, count: 0 }
  salesSnap.docs.forEach(d => {
    const s = d.data()
    if ((s.status || 'active') === 'deleted') return
    const m = s.paymentMethod || 'efectivo'
    const t = Number(s.total) || 0
    salesBreakdown[m] = (salesBreakdown[m] || 0) + t
    salesBreakdown.total += t
    salesBreakdown.count += 1
  })

  const expensesAtClose = { approvedTotal: 0, pendingTotal: 0, rejectedTotal: 0, count: 0 }
  expensesSnap.docs.forEach(d => {
    const e = d.data()
    const a = Number(e.amount) || 0
    if (e.status === 'approved') expensesAtClose.approvedTotal += a
    else if (e.status === 'rejected') expensesAtClose.rejectedTotal += a
    else expensesAtClose.pendingTotal += a
    expensesAtClose.count += 1
  })

  return { salesBreakdown, expensesAtClose }
}

/**
 * EL ADMIN cierra un turno (D25). Reemplaza a closeSession + approveSessionClose
 * del modelo viejo: una sola operación que hace todo.
 *
 * Pasos:
 *  - Persiste declaredClosingCash (lo que admin contó), handover, expectedCash, difference.
 *  - Crea closingDiscrepancy si hay sobra/falta.
 *  - Si hay SOBRA: registra movimiento de ingreso 'sobra_caja'.
 *  - Si hay FALTA con resolution='cashier_deduction': caller debe pasar deductionId.
 *  - Cambia status a 'closed' (libera la panadería).
 *
 * payload requerido:
 *   - reviewedBy: uid del admin
 *   - declaredClosingCash: monto que contó físicamente el admin
 *   - expectedCash: monto que el sistema calculó como esperado
 *   - handover: { type: 'admin' | 'cashier' | 'none', toUid?, toName?, amount }
 *       'admin'  → admin se lleva (declared - cashFloor), deja base
 *       'cashier'→ admin transfiere todo a otra cajera (no recoge)
 *       'none'   → admin deja todo intacto (sin cajera siguiente todavía)
 *   - session: el doc de la sesión (necesario para cashierName, branch)
 *
 * payload opcional:
 *   - approveNote: nota interna del admin
 *   - resolution: 'business_loss' | 'cashier_deduction' (requerido si hay falta)
 *   - deductionId: id en cashierDeductions (si resolution === 'cashier_deduction')
 *   - nextCashFloor: si se pasa, persiste el cashFloor de la panadería
 */
export async function adminCloseSession(sessionId, payload = {}) {
  const session = payload.session || {}
  const declared = Number(payload.declaredClosingCash) || 0
  const expectedCash = Number(payload.expectedCash) || 0
  const difference = declared - expectedCash
  const isSurplus = difference > 0
  const isShortage = difference < 0

  // Snapshot final (después de que el admin aprobó/rechazó gastos pendientes)
  const finalSnapshot = await buildSessionSnapshot(sessionId)

  const data = {
    status: 'closed',
    declaredClosingCash: declared,
    expectedCash,
    difference,
    handover: payload.handover || { type: 'none', amount: declared },
    closedAt: serverTimestamp(),
    closedAtClient: getClientTimestamp(),
    closeApprovedAt: serverTimestamp(),
    closeApprovedBy: payload.reviewedBy || null,
    salesBreakdown: finalSnapshot.salesBreakdown,
    expensesAtClose: finalSnapshot.expensesAtClose,
  }
  if (payload.approveNote) {
    data.closeApproveNote = payload.approveNote
  }

  // closingDiscrepancy según el resultado del cuadre
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
      throw new Error('Se requiere resolution (business_loss | cashier_deduction) para cerrar un turno con FALTA')
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

  // Si hay SOBRA, registrar ingreso "Sobra de cierre"
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

  // Persistir cashFloor si admin cambió la base de la panadería
  if (payload.nextCashFloor != null && session.branchId != null) {
    try {
      setCashFloor(session.branchId, Number(payload.nextCashFloor))
    } catch (e) {
      console.warn('[cashSessions] No se pudo persistir nextCashFloor:', e)
    }
  }

  return { surplusMovementId, difference, expectedCash }
}

/**
 * Watcher de items que requieren acción del admin en la pestaña Pendientes:
 *  - closingDiscrepancy.shortage pendiente: faltas legacy sin resolver
 *
 * (En el modelo D25 los cierres se resuelven en una sola operación desde
 * el panel central, así que ya no aparecen aquí. Este watcher queda para
 * limpiar discrepancias antiguas que quedaron pendientes.)
 */
export function watchSessionsWithPendingReview(callback) {
  const q = query(sessionsCol())
  return onSnapshot(
    q,
    snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      const filtered = all.filter(s =>
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
 * Sesiones cerradas (o pending_close legacy) cuyo cierre cae en una fecha
 * específica (zona Bogotá). Usado por la pantalla Registro.
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

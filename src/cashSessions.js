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
  getDoc,
  getDocs,
  writeBatch,
} from 'firebase/firestore'
import { addMovement, deleteMovement, getBogotaDateStr, setCashFloor, CASH_FLOOR_DEFAULT } from './db'
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
 * Suscripción a la sesión de CAJA abierta de una panadería (única por D5).
 * La usa la mesera para enganchar sus mesas/almuerzos a la caja de su
 * panadería. callback(session | null).
 *
 * Acepta sesiones type 'cash' y legacy sin type (todas las viejas eran caja).
 * Ignora kitchen/waitress. Mantiene el último valor en error (offline-safe).
 */
export function watchOpenCashSessionForBranch(branchId, callback) {
  if (branchId == null) { callback(null); return () => {} }
  const q = query(
    sessionsCol(),
    where('status', '==', 'open'),
    where('branchId', '==', branchId),
  )
  return onSnapshot(
    q,
    snap => {
      const cash = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .find(s => !s.type || s.type === 'cash')
      callback(cash || null)
    },
    err => {
      console.error('[cashSessions] watchOpenCashSessionForBranch error (manteniendo último valor):', err?.message || err)
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
 * - shiftType: 'cash' | 'kitchen' | 'waitress'  (default 'cash' por compat).
 *     'cash'     → turno de caja (POS, base $200k, cierre con cuadre).
 *     'kitchen'  → turno de cocina (cola de pedidos). No maneja dinero.
 *     'waitress' → turno de domiciliaria/mesera. Pantalla por definir.
 * - openingFloat: monto físicamente en caja al abrir (solo aplica si cash).
 * - openingSource: { type: 'empty' | 'handover', ... }. Solo aplica si cash.
 * - openingAmount: total físico que el admin dice dejar en la caja (lo que la
 *     cajera debe contar y confirmar). A diferencia de openingFloat, este es el
 *     monto bruto que el admin digitó (incluida la base), no el "sobre la base".
 *     Solo aplica si cash; sirve para la pantalla de confirmación de la cajera.
 */
export async function openSession({
  branchId,
  branchName,
  cashierUid,
  cashierName,
  openingFloat,
  openingSource,
  openingAmount,
  shiftType,
}) {
  const type = shiftType === 'kitchen' || shiftType === 'waitress' ? shiftType : 'cash'
  const data = {
    branchId,
    branchName: branchName || null,
    cashierUid,
    cashierName,
    type,
    openingFloat: type === 'cash' ? (Number(openingFloat) || 0) : 0,
    openingSource: type === 'cash' ? (openingSource || { type: 'empty' }) : { type: 'empty' },
    openedAt: serverTimestamp(),
    openedAtClient: getClientTimestamp(),
    status: 'open',
  }
  // Turnos de caja: la cajera debe contar y confirmar el monto antes de vender.
  // Guardamos el monto físico y dejamos la confirmación en 'pending'. Los turnos
  // legacy (sin este campo) no piden confirmación, así no se interrumpe un turno
  // ya abierto cuando se despliega este cambio.
  if (type === 'cash') {
    data.openingAmount = Number(openingAmount) || 0
    data.openingConfirmation = { status: 'pending' }
  }
  const ref = await addDoc(sessionsCol(), data)
  return ref.id
}

/**
 * La CAJERA confirma que contó el efectivo y coincide con lo que abrió el admin.
 * Desbloquea la venta (openingConfirmation.status pasa de 'pending' a 'confirmed').
 */
export async function confirmOpeningAmount(sessionId, { byUid, byName } = {}) {
  await updateDoc(sessionRef(sessionId), {
    openingConfirmation: {
      status: 'confirmed',
      confirmedBy: byUid || null,
      confirmedByName: byName || null,
      confirmedAt: serverTimestamp(),
      confirmedAtClient: getClientTimestamp(),
    },
  })
}

/**
 * La CAJERA reporta que el efectivo contado NO coincide con lo que abrió el admin.
 * Crea un openingDispute pendiente (lo ve el admin en Pendientes) pero igual
 * desbloquea la venta — no la dejamos parada esperando al admin.
 */
export async function reportOpeningDispute(sessionId, { expected, declared, byUid, byName, note } = {}) {
  const exp = Number(expected) || 0
  const dec = Number(declared) || 0
  await updateDoc(sessionRef(sessionId), {
    openingConfirmation: {
      status: 'reported',
      confirmedBy: byUid || null,
      confirmedByName: byName || null,
      confirmedAt: serverTimestamp(),
      confirmedAtClient: getClientTimestamp(),
    },
    openingDispute: {
      expected: exp,
      declared: dec,
      difference: dec - exp,
      status: 'pending',
      note: note || null,
      reportedBy: byUid || null,
      reportedByName: byName || null,
      reportedAt: serverTimestamp(),
      reportedAtClient: getClientTimestamp(),
    },
  })
}

/**
 * EL ADMIN resuelve una disputa de apertura desde Pendientes.
 *  - resolution 'accept' → da por buena la cuenta de la cajera (status 'resolved').
 *  - resolution 'reject' → mantiene el monto original (status 'rejected').
 * No mueve dinero ni nómina: es un registro/aclaración. Si el admin quiere
 * corregir el monto físico, lo hace cerrando/reabriendo el turno como siempre.
 */
export async function resolveOpeningDispute(sessionId, { resolution, note, reviewedBy } = {}) {
  await updateDoc(sessionRef(sessionId), {
    'openingDispute.status': resolution === 'accept' ? 'resolved' : 'rejected',
    'openingDispute.resolution': resolution || null,
    'openingDispute.reviewNote': note || null,
    'openingDispute.reviewedBy': reviewedBy || null,
    'openingDispute.reviewedAt': serverTimestamp(),
  })
}

/**
 * Cierra un turno NO-caja (cocina / domiciliaria). Simple: solo marca como
 * cerrado, sin cuadre ni cashFloor ni discrepancia. Se llama desde el panel
 * central cuando el admin cierra un turno de cocinera/mesera.
 */
export async function adminCloseNonCashSession(sessionId, { reviewedBy } = {}) {
  await updateDoc(sessionRef(sessionId), {
    status: 'closed',
    closedAt: serverTimestamp(),
    closedAtClient: getClientTimestamp(),
    closeApprovedAt: serverTimestamp(),
    closeApprovedBy: reviewedBy || null,
  })
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

  // Para ventas con paymentSplit (pago dividido efectivo + digital), cada
  // porción se suma a su categoría para que el cuadre sea exacto. Las ventas
  // 'mixto' sin paymentSplit (no debería pasar) caen al else por seguridad.
  const salesBreakdown = { efectivo: 0, nequi: 0, daviplata: 0, deuda: 0, total: 0, count: 0 }
  salesSnap.docs.forEach(d => {
    const s = d.data()
    if ((s.status || 'active') === 'deleted') return
    const t = Number(s.total) || 0
    if (s.paymentSplit) {
      for (const [m, amt] of Object.entries(s.paymentSplit)) {
        const a = Number(amt) || 0
        if (a > 0) salesBreakdown[m] = (salesBreakdown[m] || 0) + a
      }
    } else {
      const m = s.paymentMethod || 'efectivo'
      salesBreakdown[m] = (salesBreakdown[m] || 0) + t
    }
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
        s.closingDiscrepancy?.status === 'pending' ||
        s.openingDispute?.status === 'pending'
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
          if (s.mergedIntoSession) return false // turno absorbido en otra combinación
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

// ────────────────────────────────────────────────────────────────────────────
// COMBINAR TURNOS (corrección de cierres fantasma)
//
// Cuando un turno se cerró con ventas sin sincronizar (cierre en cero) y luego
// se abrió otro turno de la misma cajera/caja, el día queda partido en dos. Esta
// herramienta los une en UNO solo, recalculando el cuadre con TODAS las ventas y
// gastos reales. El admin revisa el antes/después y confirma antes de escribir.
// ────────────────────────────────────────────────────────────────────────────

/** Construye el breakdown de ventas/gastos a partir de docs ya leídos. */
function snapshotFromDocs(saleDocs, expenseDocs) {
  const salesBreakdown = { efectivo: 0, nequi: 0, daviplata: 0, deuda: 0, total: 0, count: 0 }
  saleDocs.forEach(s => {
    if ((s.status || 'active') === 'deleted') return
    const t = Number(s.total) || 0
    if (s.paymentSplit) {
      for (const [m, amt] of Object.entries(s.paymentSplit)) {
        const a = Number(amt) || 0
        if (a > 0) salesBreakdown[m] = (salesBreakdown[m] || 0) + a
      }
    } else {
      const m = s.paymentMethod || 'efectivo'
      salesBreakdown[m] = (salesBreakdown[m] || 0) + t
    }
    salesBreakdown.total += t
    salesBreakdown.count += 1
  })
  const expensesAtClose = { approvedTotal: 0, pendingTotal: 0, rejectedTotal: 0, count: 0 }
  expenseDocs.forEach(e => {
    const a = Number(e.amount) || 0
    if (e.status === 'approved') expensesAtClose.approvedTotal += a
    else if (e.status === 'rejected') expensesAtClose.rejectedTotal += a
    else expensesAtClose.pendingTotal += a
    expensesAtClose.count += 1
  })
  return { salesBreakdown, expensesAtClose }
}

/** Lee ventas y gastos (con su ref) de varios turnos. */
async function readSessionsData(sessionIds) {
  const saleRefs = [], expenseRefs = []
  const saleDocs = [], expenseDocs = []
  for (const id of sessionIds) {
    const ss = await getDocs(query(collection(firestoreDb, 'sales'), where('sessionId', '==', id)))
    ss.forEach(d => { saleRefs.push(d.ref); saleDocs.push(d.data()) })
    const es = await getDocs(query(collection(firestoreDb, 'cashExpenses'), where('sessionId', '==', id)))
    es.forEach(d => { expenseRefs.push(d.ref); expenseDocs.push(d.data()) })
  }
  return { saleRefs, expenseRefs, saleDocs, expenseDocs }
}

function computeMergeResult(survivor, saleDocs, expenseDocs) {
  const { salesBreakdown, expensesAtClose } = snapshotFromDocs(saleDocs, expenseDocs)
  const baseAtOpen = survivor.openingSource?.type === 'empty' ? CASH_FLOOR_DEFAULT : 0
  const openingFloat = Number(survivor.openingFloat) || 0
  const expectedCash = baseAtOpen + openingFloat + (salesBreakdown.efectivo || 0) - expensesAtClose.approvedTotal
  const declared = Number(survivor.declaredClosingCash) || 0
  const difference = declared - expectedCash
  return { salesBreakdown, expensesAtClose, baseAtOpen, openingFloat, expectedCash, declared, difference }
}

/**
 * READ-ONLY: calcula cómo quedaría el turno combinado SIN escribir nada.
 * Devuelve el antes (cada turno) y el después (combinado).
 */
export async function previewMergeCashSessions({ survivorId, loserIds }) {
  if (!survivorId || !Array.isArray(loserIds) || loserIds.length === 0) {
    throw new Error('Faltan turnos para combinar.')
  }
  const allIds = [survivorId, ...loserIds]
  const snaps = await Promise.all(allIds.map(id => getDoc(sessionRef(id))))
  const sessionsById = {}
  snaps.forEach((s, i) => { if (s.exists()) sessionsById[allIds[i]] = { id: allIds[i], ...s.data() } })
  const survivor = sessionsById[survivorId]
  if (!survivor) throw new Error('El turno principal ya no existe.')

  const { saleDocs, expenseDocs } = await readSessionsData(allIds)
  const result = computeMergeResult(survivor, saleDocs, expenseDocs)

  const earliestOpenedAt = allIds
    .map(id => sessionsById[id]?.openedAt?.toMillis?.() ?? null)
    .filter(v => v != null)
    .sort((a, b) => a - b)[0] ?? null

  return {
    survivor,
    losers: loserIds.map(id => sessionsById[id]).filter(Boolean),
    ...result,
    earliestOpenedAt,
  }
}

/**
 * ESCRIBE: combina los turnos `loserIds` dentro de `survivorId`.
 *  - Re-apunta TODAS las ventas y gastos de los perdedores al superviviente.
 *  - Recalcula salesBreakdown / expectedCash / difference / closingDiscrepancy
 *    del superviviente con TODO junto.
 *  - Ajusta el movimiento de "sobra" (borra los viejos, crea el correcto).
 *  - Marca los perdedores con `mergedIntoSession` (ocultos en Registro).
 *
 * El cambio de ventas/gastos/sesiones es ATÓMICO (writeBatch). El ajuste del
 * movimiento contable va después (otro almacén); si fallara, el turno ya quedó
 * bien y se reporta para reintentar.
 */
export async function mergeCashSessions({ survivorId, loserIds, byUid }) {
  if (!survivorId || !Array.isArray(loserIds) || loserIds.length === 0) {
    throw new Error('Faltan turnos para combinar.')
  }
  const allIds = [survivorId, ...loserIds]

  const snaps = await Promise.all(allIds.map(id => getDoc(sessionRef(id))))
  const sessionsById = {}
  snaps.forEach((s, i) => { if (s.exists()) sessionsById[allIds[i]] = { id: allIds[i], ...s.data() } })
  const survivor = sessionsById[survivorId]
  if (!survivor) throw new Error('El turno principal ya no existe.')

  const { saleRefs, expenseRefs, saleDocs, expenseDocs } = await readSessionsData(allIds)
  const { salesBreakdown, expensesAtClose, expectedCash, declared, difference } =
    computeMergeResult(survivor, saleDocs, expenseDocs)

  const isSurplus = difference > 0
  const isShortage = difference < 0

  // Movimientos de "sobra" viejos a eliminar (del superviviente y perdedores).
  const oldSobraIds = allIds
    .map(id => sessionsById[id]?.closingDiscrepancy?.surplusMovementId)
    .filter(Boolean)

  // openedAt más temprano → el turno combinado abarca todo el día.
  const earliestOpenedAt = allIds
    .map(id => ({ id, ms: sessionsById[id]?.openedAt?.toMillis?.() ?? Infinity }))
    .sort((a, b) => a.ms - b.ms)[0]
  const earliestSession = earliestOpenedAt ? sessionsById[earliestOpenedAt.id] : null

  // closingDiscrepancy recalculado.
  let closingDiscrepancy = null
  if (isSurplus) {
    closingDiscrepancy = {
      type: 'surplus',
      amount: Math.abs(difference),
      status: 'resolved_as_income',
      reviewedBy: byUid || null,
      reviewedAt: serverTimestamp(),
      note: 'Recalculado al combinar turnos',
    }
  } else if (isShortage) {
    closingDiscrepancy = {
      type: 'shortage',
      amount: Math.abs(difference),
      status: 'absorbed',
      resolution: 'business_loss',
      reviewedBy: byUid || null,
      reviewedAt: serverTimestamp(),
      note: 'Recalculado al combinar turnos',
    }
  }

  // ── 1. Batch atómico: ventas + gastos + superviviente + perdedores ──
  const batch = writeBatch(firestoreDb)
  for (const ref of saleRefs) batch.update(ref, { sessionId: survivorId })
  for (const ref of expenseRefs) batch.update(ref, { sessionId: survivorId })

  const survivorUpdate = {
    salesBreakdown,
    expensesAtClose,
    expectedCash,
    difference,
    mergedFrom: loserIds,
    mergedAt: serverTimestamp(),
    mergedBy: byUid || null,
  }
  if (earliestSession?.openedAt) survivorUpdate.openedAt = earliestSession.openedAt
  if (earliestSession?.openedAtClient) survivorUpdate.openedAtClient = earliestSession.openedAtClient
  survivorUpdate.closingDiscrepancy = closingDiscrepancy
  batch.update(sessionRef(survivorId), survivorUpdate)

  for (const id of loserIds) {
    batch.update(sessionRef(id), {
      mergedIntoSession: survivorId,
      lastUpdate: serverTimestamp(),
    })
  }
  await batch.commit()

  // ── 2. Ajustar el movimiento contable de "sobra" (otro almacén) ──
  let newSobraMovementId = null
  let movementError = null
  try {
    for (const mid of oldSobraIds) deleteMovement(mid)
    if (isSurplus) {
      newSobraMovementId = addMovement({
        type: 'income',
        amount: Math.abs(difference),
        date: getBogotaDateStr(),
        cat: 'sobra_caja',
        branch: survivor.branchId || 'both',
        origin: 'caja',
        sessionId: survivorId,
        cashierName: survivor.cashierName,
        note: `Sobra de cierre (turnos combinados) · ${survivor.cashierName || 'cajera'}`,
      })
      // Guardar el id del nuevo movimiento en el cierre.
      await updateDoc(sessionRef(survivorId), {
        'closingDiscrepancy.surplusMovementId': newSobraMovementId,
      })
    }
  } catch (e) {
    movementError = e?.message || 'No se pudo ajustar el movimiento de sobra'
    console.error('[cashSessions] mergeCashSessions movimiento:', e)
  }

  return {
    survivorId,
    mergedCount: loserIds.length,
    salesRepointed: saleRefs.length,
    expensesRepointed: expenseRefs.length,
    expectedCash,
    declared,
    difference,
    newSobraMovementId,
    movementError,
  }
}

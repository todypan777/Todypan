import { useEffect, useMemo, useState } from 'react'
import { T } from '../tokens'
import { fmtCOP, fmtDate } from '../utils/format'
import { Card } from '../components/Atoms'
import { ScreenHeader } from '../components/Nav'
import { getBogotaDateStr, getCashFloor } from '../db'
import { useAuth } from '../context/AuthCtx'
import { watchClosedSessionsForDate, discardEmptySession, recomputeClosedSession } from '../cashSessions'
import { watchSessionSales, editSaleItems, deleteSaleAsAdmin } from '../sales'
import { adjustDebtorForSaleChange } from '../debtors'
import { watchSessionExpenses } from '../cashExpenses'
import { watchTasksCompletedInSession, watchTasksForCashier } from '../tasks'
import { paymentIcon } from '../utils/payment'

// Registro = visualización del historial de cierres de caja por día.

export default function Registro() {
  const todayStr = getBogotaDateStr()
  const [date, setDate] = useState(todayStr)
  const [closures, setClosures] = useState([])

  useEffect(() => watchClosedSessionsForDate(date, setClosures), [date])

  const isToday = date === todayStr
  const isFuture = date > todayStr

  function changeDate(delta) {
    const d = new Date(date + 'T12:00:00')
    d.setDate(d.getDate() + delta)
    const next = d.toISOString().slice(0, 10)
    if (next <= todayStr) setDate(next)
  }

  const displayDate = fmtDate(date, { weekday: true })

  return (
    <div style={{ paddingBottom: 110 }}>
      <ScreenHeader title="Cierres de caja"/>

      {/* Navegador de fecha */}
      <div style={{ padding: '0 16px 16px' }}>
        <div style={{ borderRadius: 18, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <div style={{
            background: T.neutral[900], padding: '16px 20px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <button onClick={() => changeDate(-1)} style={navBtn}>
              <svg width="8" height="14" viewBox="0 0 8 14"><path d="M6 1 L1 7 L6 13" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: T.copper[300], letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 4 }}>
                {isToday ? 'Hoy' : 'Fecha seleccionada'}
              </div>
              <div style={{ fontSize: 19, fontWeight: 700, color: '#fff', textTransform: 'capitalize' }}>
                {displayDate}
              </div>
            </div>
            <button onClick={() => changeDate(1)} disabled={isToday} style={{ ...navBtn, opacity: isToday ? 0.2 : 1, cursor: isToday ? 'default' : 'pointer' }}>
              <svg width="8" height="14" viewBox="0 0 8 14"><path d="M2 1 L7 7 L2 13" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </div>
        </div>
      </div>

      {/* Historial de cierres del día */}
      {isFuture ? (
        <div style={{ padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 36 }}>📅</div>
          <div style={{ fontSize: 14, color: T.neutral[400], marginTop: 12 }}>Fecha futura</div>
        </div>
      ) : closures.length === 0 ? (
        <div style={{ padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 36 }}>📭</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: T.neutral[600], marginTop: 12 }}>Sin cierres este día</div>
        </div>
      ) : (
        <ClosuresHistory closures={closures} />
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Historial de cierres de caja del día seleccionado
// ──────────────────────────────────────────────────────────────
function ClosuresHistory({ closures }) {
  return (
    <div style={{ padding: '0 16px' }}>
      <div style={{
        fontSize: 12, fontWeight: 700, color: T.neutral[500],
        textTransform: 'uppercase', letterSpacing: 0.5,
        paddingLeft: 4, marginBottom: 10,
      }}>
        Cierres de caja · {closures.length}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {closures.map(s => <ClosureCard key={s.id} session={s} />)}
      </div>
    </div>
  )
}

function ClosureCard({ session }) {
  const cd = session.closingDiscrepancy
  const hasShortage = cd?.type === 'shortage'
  const hasSurplus = cd?.type === 'surplus'
  const isPending = session.status === 'pending_close'
  const [showDetail, setShowDetail] = useState(false)

  const tone = isPending
    ? { border: '#F0D9A0', bg: '#FFF8EC', label: 'Cierre pendiente (legacy)', labelColor: '#7A5C00' }
    : hasShortage
      ? { border: `${T.bad}33`, bg: '#fff', label: null, labelColor: null }
      : hasSurplus
        ? { border: `${T.ok}35`, bg: '#fff', label: null, labelColor: null }
        : { border: T.neutral[100], bg: '#fff', label: null, labelColor: null }

  const opened = session.openedAt?.toDate?.()
  const closed = session.closedAt?.toDate?.()
  const fmtTime = (d) => d
    ? d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Bogota' })
    : '—'

  const resolutionLabel = hasShortage && cd.resolution
    ? cd.resolution === 'business_loss' ? 'Asumido como pérdida'
      : cd.resolution === 'cashier_deduction' ? 'Descontado a la cajera'
      : cd.resolution === 'covered_by_fund' ? 'Cubierto con fondo (legacy)'
      : null
    : null

  return (
    <>
    <Card
      padding={14}
      style={{ border: `1.5px solid ${tone.border}`, background: tone.bg, cursor: 'pointer' }}
      onClick={() => setShowDetail(true)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.neutral[900] }}>
            {session.cashierName || 'Cajera'}
          </div>
          <div style={{ fontSize: 12, color: T.neutral[500], marginTop: 2 }}>
            {session.branchName || 'Sin nombre'} · {fmtTime(opened)} → {fmtTime(closed)}
          </div>
        </div>
        {tone.label && (
          <div style={{
            padding: '3px 9px', borderRadius: 999,
            background: '#F4E0BC', color: tone.labelColor,
            fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
            flexShrink: 0,
          }}>
            {tone.label}
          </div>
        )}
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6,
        padding: '8px 10px', borderRadius: 10,
        background: T.neutral[50],
      }}>
        <Stat label="Apertura" value={fmtCOP(session.openingFloat || 0)} />
        <Stat label="Esperado" value={fmtCOP(session.expectedCash || 0)} />
        <Stat label="Declaró" value={fmtCOP(session.declaredClosingCash || 0)} />
      </div>

      <div style={{ marginTop: 10 }}>
        {!cd && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 13, fontWeight: 700, color: T.ok,
          }}>
            ✓ Cuadre exacto
          </div>
        )}
        {hasSurplus && (
          <div style={{ fontSize: 13, fontWeight: 700, color: T.ok }}>
            ✓ Sobra {fmtCOP(cd.amount)} <span style={{ fontWeight: 500, color: T.neutral[600] }}>· registrada como ingreso</span>
          </div>
        )}
        {hasShortage && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.bad }}>
              ✗ Falta {fmtCOP(cd.amount)}
            </div>
            {resolutionLabel && (
              <div style={{ fontSize: 11.5, color: T.neutral[600], marginTop: 2 }}>
                {resolutionLabel}
              </div>
            )}
          </div>
        )}
      </div>

      {session.handover && (
        <div style={{
          marginTop: 10, paddingTop: 10, borderTop: `0.5px solid ${T.neutral[100]}`,
          fontSize: 11.5, color: T.neutral[600],
        }}>
          Entregó <b style={{ color: T.neutral[800] }}>{fmtCOP(session.handover.amount)}</b> a {session.handover.toName}
          {session.handover.type === 'admin' && ' (admin)'}
        </div>
      )}

      {(session.closingNote || cd?.note) && (
        <div style={{
          marginTop: 8, padding: '8px 10px', borderRadius: 8,
          background: '#FFF7E6', border: `1px solid #F4E0BC`,
          fontSize: 11.5, color: T.neutral[700], fontStyle: 'italic', lineHeight: 1.4,
        }}>
          <b style={{ fontStyle: 'normal', color: T.warn }}>Cajera:</b> "{cd?.note || session.closingNote}"
        </div>
      )}
      {cd?.reviewNote && (
        <div style={{
          marginTop: 6, padding: '8px 10px', borderRadius: 8,
          background: T.neutral[50], border: `1px solid ${T.neutral[100]}`,
          fontSize: 11.5, color: T.neutral[700], fontStyle: 'italic', lineHeight: 1.4,
        }}>
          <b style={{ fontStyle: 'normal', color: T.neutral[600] }}>Admin:</b> "{cd.reviewNote}"
        </div>
      )}

      <div style={{
        marginTop: 10, paddingTop: 8, borderTop: `0.5px dashed ${T.neutral[200]}`,
        fontSize: 11, color: T.neutral[500], textAlign: 'center', fontWeight: 600,
      }}>
        Toca para ver el detalle del turno →
      </div>
    </Card>
    {showDetail && <ClosureDetailModal session={session} onClose={() => setShowDetail(false)} />}
    </>
  )
}

function ClosureDetailModal({ session, onClose }) {
  const { authUser } = useAuth()
  const adminUid = authUser?.uid || null
  const [sales, setSales] = useState([])
  const [expenses, setExpenses] = useState([])
  const [completedTasks, setCompletedTasks] = useState([])
  const [pendingTasksForCashier, setPendingTasksForCashier] = useState([])
  // Borrado de turno vacío (cerrado por error, sin actividad).
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState(null)

  useEffect(() => watchSessionSales(session.id, setSales), [session.id])
  useEffect(() => watchSessionExpenses(session.id, setExpenses), [session.id])
  useEffect(() => watchTasksCompletedInSession(session.id, setCompletedTasks), [session.id])
  useEffect(() => {
    if (!session.cashierUid) { setPendingTasksForCashier([]); return undefined }
    return watchTasksForCashier(session.cashierUid, setPendingTasksForCashier)
  }, [session.cashierUid])

  const closedAtMs = session.closedAt?.toMillis?.() ?? Number.MAX_SAFE_INTEGER
  const unfinishedTasks = useMemo(() => {
    return pendingTasksForCashier.filter(t => {
      if (t.status !== 'pending') return false
      const branchOk = !t.branchId || String(t.branchId) === String(session.branchId)
      const createdMs = t.createdAt?.toMillis?.() ?? t.createdAtClient ?? 0
      return branchOk && createdMs <= closedAtMs
    })
  }, [pendingTasksForCashier, session.branchId, closedAtMs])

  const liveBreakdown = useMemo(() => {
    const acc = { efectivo: 0, nequi: 0, daviplata: 0, deuda: 0, total: 0, count: 0 }
    sales.forEach(s => {
      if ((s.status || 'active') === 'deleted') return
      const t = Number(s.total) || 0
      if (s.paymentSplit) {
        for (const [m, amt] of Object.entries(s.paymentSplit)) {
          const a = Number(amt) || 0
          if (a > 0) acc[m] = (acc[m] || 0) + a
        }
      } else {
        const m = s.paymentMethod || 'efectivo'
        acc[m] = (acc[m] || 0) + t
      }
      acc.total += t
      acc.count += 1
    })
    return acc
  }, [sales])

  const breakdown = session.salesBreakdown || liveBreakdown
  const expensesAtClose = session.expensesAtClose || {
    approvedTotal: expenses.filter(e => e.status === 'approved').reduce((a, e) => a + (Number(e.amount) || 0), 0),
    pendingTotal: expenses.filter(e => e.status === 'pending').reduce((a, e) => a + (Number(e.amount) || 0), 0),
    rejectedTotal: expenses.filter(e => e.status === 'rejected').reduce((a, e) => a + (Number(e.amount) || 0), 0),
    count: expenses.length,
  }

  const cashFloor = getCashFloor(session.branchId)
  const openingFloat = Number(session.openingFloat) || 0
  const baseAtOpen = session.openingSource?.type === 'empty' ? cashFloor : 0
  const declared = Number(session.declaredClosingCash) || 0
  const expectedCash = baseAtOpen + openingFloat + (breakdown.efectivo || 0) - (expensesAtClose.approvedTotal || 0)
  const difference = declared - expectedCash
  const isPending = session.status === 'pending_close'

  const opened = session.openedAt?.toDate?.()
  const closed = session.closedAt?.toDate?.()
  const fmtTime = (d) => d
    ? d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Bogota' })
    : '—'

  const baseLowered = declared < cashFloor
  const overBase = declared - cashFloor

  // En escritorio el modal se centra con scroll interno; en móvil es una hoja
  // inferior (bottom-sheet). Sin esto, en computador el contenido largo se
  // salía de la pantalla y no dejaba bajar.
  const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 1024

  // Turno VACÍO = sin ventas reales y sin gastos. Se puede borrar AUNQUE
  // muestre falta/sobra: si no hubo ventas ni gastos, esa diferencia es
  // fantasma (ej. cerró declarando $0 sobre la base), no se movió plata real.
  // Al borrar, discardEmptySession limpia el descuento/movimiento que esa
  // discrepancia hubiera generado, para no dejar nada colgando.
  const realSalesCount = sales.filter(s => (s.status || 'active') !== 'deleted').length
  const canDelete = realSalesCount === 0 && expenses.length === 0

  async function handleDeleteEmpty() {
    setDeleting(true)
    setDeleteError(null)
    try {
      await discardEmptySession(session.id)
      onClose()
    } catch (err) {
      setDeleteError(err?.message || 'No se pudo borrar el turno.')
      setDeleting(false)
    }
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
      display: 'flex', alignItems: isDesktop ? 'center' : 'flex-end',
      justifyContent: 'center',
      padding: isDesktop ? 24 : 0,
      boxSizing: 'border-box',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 480,
        maxHeight: isDesktop ? '88vh' : '92vh', overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        background: '#fff',
        borderRadius: isDesktop ? 20 : '20px 20px 0 0',
        boxShadow: '0 -8px 32px rgba(0,0,0,0.15)',
      }}>
        <div style={{
          position: 'sticky', top: 0, background: '#fff', zIndex: 2,
          padding: '18px 20px 14px', borderBottom: `1px solid ${T.neutral[100]}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 800, color: T.neutral[900] }}>
                {session.cashierName || 'Cajera'}
              </div>
              <div style={{ fontSize: 12.5, color: T.neutral[500], marginTop: 2 }}>
                {session.branchName || 'Sin nombre'} · {fmtTime(opened)} → {fmtTime(closed)}
              </div>
            </div>
            <button onClick={onClose} style={{
              width: 32, height: 32, borderRadius: 999, border: 'none',
              background: T.neutral[100], color: T.neutral[700],
              cursor: 'pointer', fontSize: 18, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'inherit',
            }}>×</button>
          </div>
          {isPending && (
            <div style={{
              marginTop: 8, padding: '6px 10px', borderRadius: 8,
              background: '#FFF8EC', border: `1px solid #F0D9A0`,
              fontSize: 11.5, color: '#7A5C00', fontWeight: 700, textAlign: 'center',
            }}>
              ⏳ Pendiente de aprobación del admin
            </div>
          )}
        </div>

        <div style={{ padding: '16px 20px 24px' }}>
          <DetailSectionLabel>Por qué da este precio</DetailSectionLabel>
          <div style={{
            padding: '14px 16px', borderRadius: 12,
            background: T.neutral[50], marginBottom: 16,
          }}>
            {baseAtOpen > 0 && <DetailRow label="Base de caja" value={fmtCOP(baseAtOpen)} muted />}
            {openingFloat > 0 && <DetailRow label="Apertura (recibido)" value={fmtCOP(openingFloat)} muted />}
            <DetailRow label="+ Ventas en efectivo" value={fmtCOP(breakdown.efectivo || 0)} muted />
            {(expensesAtClose.approvedTotal || 0) > 0 && (
              <DetailRow label="− Gastos aprobados" value={fmtCOP(expensesAtClose.approvedTotal)} muted negative />
            )}
            <div style={{ borderTop: `1px solid ${T.neutral[200]}`, marginTop: 8, paddingTop: 8 }}>
              <DetailRow label="Esperado" value={fmtCOP(expectedCash)} bold />
              <DetailRow label="Declaró la cajera" value={fmtCOP(declared)} bold />
              {!isPending && (
                <DetailRow
                  label={difference === 0 ? '✓ Cuadre exacto' : difference > 0 ? 'Sobra' : 'Falta'}
                  value={fmtCOP(Math.abs(difference))}
                  highlight
                  tone={difference < 0 ? 'bad' : 'ok'}
                />
              )}
            </div>
          </div>

          <DetailSectionLabel>
            Ventas del turno · {breakdown.count} {breakdown.count === 1 ? 'venta' : 'ventas'} · {fmtCOP(breakdown.total || 0)}
          </DetailSectionLabel>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6,
            marginBottom: 12,
          }}>
            <MethodChip label="Efectivo" amount={breakdown.efectivo || 0} icon="💵" />
            <MethodChip label="Nequi" amount={breakdown.nequi || 0} icon="📱" />
            <MethodChip label="Daviplata" amount={breakdown.daviplata || 0} icon="📲" />
            <MethodChip label="Deuda" amount={breakdown.deuda || 0} icon="📋" />
          </div>

          {sales.length > 0 ? (
            <SalesList sales={sales} sessionId={session.id} adminUid={adminUid} />
          ) : (
            <div style={{
              padding: '14px', textAlign: 'center', borderRadius: 10,
              background: T.neutral[50], color: T.neutral[500], fontSize: 12.5, marginBottom: 16,
            }}>
              Sin ventas en este turno
            </div>
          )}

          <DetailSectionLabel>
            Gastos del turno · {expensesAtClose.count || 0}
          </DetailSectionLabel>
          {expenses.length === 0 ? (
            <div style={{
              padding: '14px', textAlign: 'center', borderRadius: 10,
              background: T.neutral[50], color: T.neutral[500], fontSize: 12.5, marginBottom: 16,
            }}>
              Sin gastos en este turno
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
              {expenses.map(e => <ExpenseDetailRow key={e.id} expense={e} />)}
            </div>
          )}

          {(completedTasks.length > 0 || unfinishedTasks.length > 0) && (
            <ClosureTasksSection
              completedTasks={completedTasks}
              unfinishedTasks={unfinishedTasks}
            />
          )}

          <DetailSectionLabel>Acción al cerrar</DetailSectionLabel>
          <div style={{
            padding: '14px 16px', borderRadius: 12,
            background: baseLowered ? '#FBE9E5' : '#E8F4E8',
            border: `1.5px solid ${baseLowered ? T.bad + '55' : T.ok + '55'}`,
            marginBottom: 16,
          }}>
            {baseLowered ? (
              <>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.neutral[900], lineHeight: 1.4, marginBottom: 4 }}>
                  La caja quedó en <span style={{ color: T.bad, fontVariantNumeric: 'tabular-nums' }}>{fmtCOP(declared)}</span>.
                </div>
                <div style={{ fontSize: 13, color: T.neutral[700], lineHeight: 1.5 }}>
                  Repón <b style={{ color: T.bad, fontVariantNumeric: 'tabular-nums' }}>{fmtCOP(cashFloor - declared)}</b> para volver a los {fmtCOP(cashFloor)} de base.
                </div>
              </>
            ) : session.handover?.type === 'cashier' ? (
              <>
                <div style={{ fontSize: 14, color: T.neutral[800], lineHeight: 1.5 }}>
                  La caja se transfiere completa a <b>{session.handover.toName}</b>: <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtCOP(declared)}</span>.
                </div>
                <div style={{ fontSize: 12.5, color: T.neutral[600], lineHeight: 1.5, marginTop: 6 }}>
                  Incluye los {fmtCOP(cashFloor)} de base + <b style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtCOP(overBase)}</b> de ventas no entregadas.
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.neutral[900], lineHeight: 1.4 }}>
                  Llévate <span style={{ color: T.ok, fontVariantNumeric: 'tabular-nums' }}>{fmtCOP(overBase)}</span>.
                </div>
                <div style={{ fontSize: 13, color: T.neutral[600], lineHeight: 1.5, marginTop: 4 }}>
                  Deja los <b>{fmtCOP(cashFloor)}</b> de base intactos.
                </div>
              </>
            )}
          </div>

          {session.closingNote && (
            <div style={{
              padding: '10px 12px', borderRadius: 10,
              background: '#FFF7E6', border: `1px solid #F4E0BC`,
              fontSize: 12.5, color: T.neutral[700], fontStyle: 'italic', lineHeight: 1.5,
              marginBottom: 8,
            }}>
              <b style={{ fontStyle: 'normal', color: T.warn }}>Nota de la cajera:</b> "{session.closingNote}"
            </div>
          )}
          {session.closeApproveNote && (
            <div style={{
              padding: '10px 12px', borderRadius: 10,
              background: T.neutral[50], border: `1px solid ${T.neutral[100]}`,
              fontSize: 12.5, color: T.neutral[700], fontStyle: 'italic', lineHeight: 1.5,
            }}>
              <b style={{ fontStyle: 'normal', color: T.neutral[600] }}>Nota del admin:</b> "{session.closeApproveNote}"
            </div>
          )}

          {/* Borrar turno vacío (cerrado por error, sin actividad) */}
          {canDelete && (
            <div style={{
              marginTop: 18, paddingTop: 16, borderTop: `1px dashed ${T.neutral[200]}`,
            }}>
              {deleteError && (
                <div style={{
                  marginBottom: 10, padding: '10px 12px', borderRadius: 10,
                  background: '#FBE9E5', border: `1px solid #F0C8BE`,
                  fontSize: 12, color: T.bad, fontWeight: 600, lineHeight: 1.4,
                }}>
                  {deleteError}
                </div>
              )}
              {!confirmDelete ? (
                <button
                  onClick={() => setConfirmDelete(true)}
                  style={{
                    width: '100%', padding: '12px', borderRadius: 12,
                    background: 'transparent', color: T.bad,
                    border: `1.5px solid ${T.bad}55`,
                    cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700,
                  }}
                >
                  Borrar este turno (estuvo vacío)
                </button>
              ) : (
                <div>
                  <div style={{ fontSize: 12.5, color: T.neutral[700], lineHeight: 1.5, marginBottom: 10, textAlign: 'center' }}>
                    Se borra sin dejar registro. No tuvo ventas ni gastos.
                    {difference !== 0 && ' La falta/sobra de este turno es fantasma y también se deshace (no afecta a la cajera).'}
                    {' '}¿Seguro?
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button
                      onClick={() => { setConfirmDelete(false); setDeleteError(null) }}
                      disabled={deleting}
                      style={{
                        flex: 1, padding: '12px', borderRadius: 12,
                        background: '#fff', color: T.neutral[700],
                        border: `1px solid ${T.neutral[200]}`,
                        cursor: deleting ? 'wait' : 'pointer', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700,
                      }}
                    >
                      No
                    </button>
                    <button
                      onClick={handleDeleteEmpty}
                      disabled={deleting}
                      style={{
                        flex: 1.3, padding: '12px', borderRadius: 12,
                        background: T.bad, color: '#fff',
                        border: 'none', cursor: deleting ? 'wait' : 'pointer', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 800,
                      }}
                    >
                      {deleting ? 'Borrando...' : 'Sí, borrar'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function DetailSectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, color: T.neutral[500],
      textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginTop: 2,
    }}>
      {children}
    </div>
  )
}

function DetailRow({ label, value, muted, bold, highlight, tone, negative }) {
  const valueColor = highlight
    ? tone === 'bad' ? T.bad : tone === 'ok' ? T.ok : T.neutral[900]
    : negative
      ? T.bad
      : muted
        ? T.neutral[600]
        : T.neutral[900]
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '4px 0',
      fontSize: highlight ? 14 : 13,
      fontWeight: highlight || bold ? 700 : 500,
    }}>
      <span style={{ color: muted ? T.neutral[600] : T.neutral[800] }}>{label}</span>
      <span style={{ color: valueColor, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  )
}

function MethodChip({ label, amount, icon }) {
  const isZero = !amount || amount === 0
  return (
    <div style={{
      padding: '10px 12px', borderRadius: 10,
      background: isZero ? T.neutral[50] : '#fff',
      border: `1px solid ${isZero ? T.neutral[100] : T.copper[100]}`,
      opacity: isZero ? 0.55 : 1,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.neutral[600], marginBottom: 2 }}>
        <span style={{ marginRight: 4 }}>{icon}</span>{label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: T.neutral[900], fontVariantNumeric: 'tabular-nums' }}>
        {fmtCOP(amount || 0)}
      </div>
    </div>
  )
}

function SalesList({ sales, sessionId, adminUid }) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? sales : sales.slice(0, 5)
  const hasMore = sales.length > 5

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        borderRadius: 10, background: T.neutral[50],
        border: `1px solid ${T.neutral[100]}`, overflow: 'hidden',
      }}>
        {visible.map((s, i) => (
          <SaleDetailRow key={s.id} sale={s} isLast={i === visible.length - 1} sessionId={sessionId} adminUid={adminUid} />
        ))}
      </div>
      {hasMore && (
        <button onClick={() => setExpanded(!expanded)} style={{
          width: '100%', marginTop: 6, padding: '8px',
          background: 'transparent', color: T.copper[600],
          border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 12, fontWeight: 700,
        }}>
          {expanded ? 'Mostrar menos ▲' : `Ver ${sales.length - 5} ventas más ▼`}
        </button>
      )}
    </div>
  )
}

function SaleDetailRow({ sale, isLast, sessionId, adminUid }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState([])
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState(null)
  const [confirmDel, setConfirmDel] = useState(false)
  const time = sale.createdAt?.toDate?.() || sale.createdAtClient
  const timeStr = time
    ? new Date(time).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Bogota' })
    : '—'
  const methodIcon = paymentIcon(sale)
  const isDeleted = sale.status === 'deleted'
  const isFlagged = sale.status === 'flagged'
  const items = sale.items || []
  const isDebt = sale.paymentMethod === 'deuda'

  const draftTotal = draft.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0)

  function startEdit() {
    setDraft(items.map(it => ({ ...it, qty: Number(it.qty) || 0 })))
    setActionError(null)
    setEditing(true)
  }
  function changeQty(idx, delta) {
    setDraft(prev => prev.map((it, i) => i === idx ? { ...it, qty: Math.max(0, (Number(it.qty) || 0) + delta) } : it))
  }
  function removeDraftItem(idx) {
    setDraft(prev => prev.filter((_, i) => i !== idx))
  }

  async function handleSaveEdit() {
    const cleanItems = draft
      .filter(it => (Number(it.qty) || 0) > 0)
      .map(it => {
        const qty = Number(it.qty) || 0
        const unitPrice = Number(it.unitPrice) || 0
        return {
          productId: it.productId || null,
          source: it.source || 'inline',
          name: it.name || 'Producto',
          qty,
          unitPrice,
          subtotal: qty * unitPrice,
        }
      })
    if (cleanItems.length === 0) {
      setActionError('Si quitas todo, mejor elimina la venta.')
      return
    }
    const newTotal = cleanItems.reduce((s, it) => s + it.subtotal, 0)
    setBusy(true); setActionError(null)
    try {
      const { oldTotal } = await editSaleItems(sale.id, {
        items: cleanItems, total: newTotal, byUid: adminUid, note: 'Editado desde cierre',
      })
      if (isDebt && sale.debtorId) {
        await adjustDebtorForSaleChange(sale.debtorId, {
          saleId: sale.id, oldAmount: oldTotal, newAmount: newTotal,
          byUid: adminUid, reason: 'venta editada desde cierre',
        })
      }
      await recomputeClosedSession(sessionId, { byUid: adminUid })
      setEditing(false)
    } catch (err) {
      console.error(err)
      setActionError('No se pudo guardar el cambio.')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    setBusy(true); setActionError(null)
    try {
      await deleteSaleAsAdmin(sale.id, { byUid: adminUid, reason: 'Corrección desde cierre' })
      if (isDebt && sale.debtorId) {
        await adjustDebtorForSaleChange(sale.debtorId, {
          saleId: sale.id, oldAmount: sale.total || 0, newAmount: 0,
          byUid: adminUid, reason: 'venta eliminada desde cierre',
        })
      }
      await recomputeClosedSession(sessionId, { byUid: adminUid })
      setConfirmDel(false)
    } catch (err) {
      console.error(err)
      setActionError('No se pudo eliminar la venta.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ borderBottom: isLast ? 'none' : `0.5px solid ${T.neutral[100]}` }}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o) } }}
        style={{
          padding: '10px 12px',
          display: 'flex', alignItems: 'center', gap: 10,
          opacity: isDeleted ? 0.5 : 1,
          cursor: 'pointer',
        }}
      >
        <div style={{ fontSize: 14, flexShrink: 0 }}>{methodIcon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 12.5, fontWeight: 600, color: T.neutral[800],
            textDecoration: isDeleted ? 'line-through' : 'none',
          }}>
            {timeStr} · {items.length} producto{items.length === 1 ? '' : 's'}
            {isFlagged && <span style={{ color: T.warn, marginLeft: 6, fontWeight: 700 }}>⚠ reportada</span>}
            {isDeleted && <span style={{ color: T.bad, marginLeft: 6, fontWeight: 700 }}>eliminada</span>}
          </div>
          {sale.debtorName && (
            <div style={{ fontSize: 11, color: T.neutral[500], marginTop: 1 }}>
              Deudor: {sale.debtorName}
            </div>
          )}
        </div>
        <div style={{
          fontSize: 13, fontWeight: 700, color: T.neutral[900],
          fontVariantNumeric: 'tabular-nums', flexShrink: 0,
          textDecoration: isDeleted ? 'line-through' : 'none',
        }}>
          {fmtCOP(sale.total || 0)}
        </div>
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none" style={{
          flexShrink: 0, transition: 'transform 0.18s',
          transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
        }}>
          <path d="M3 5 L7 9 L11 5" stroke={T.neutral[400]} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {open && (
        <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {!editing && (items.length === 0 ? (
            <div style={{ fontSize: 12, color: T.neutral[500], padding: '6px 0' }}>Sin detalle de productos.</div>
          ) : items.map((it, i) => {
            const qty = Number(it.qty) || 0
            const unit = Number(it.unitPrice) || 0
            const sub = Number(it.subtotal) || qty * unit
            return (
              <div key={i} style={{
                display: 'flex', alignItems: 'baseline', gap: 8,
                fontSize: 12.5, color: T.neutral[700],
                padding: '6px 10px', borderRadius: 8,
                background: '#fff', border: `0.5px solid ${T.neutral[200]}`,
              }}>
                <span style={{ flexShrink: 0, fontWeight: 700, color: T.neutral[800], fontVariantNumeric: 'tabular-nums' }}>
                  {qty}×
                </span>
                <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>
                  {it.name || 'Producto'}
                  {unit > 0 && <span style={{ color: T.neutral[400] }}> · {fmtCOP(unit)} c/u</span>}
                </span>
                <span style={{ flexShrink: 0, fontWeight: 700, color: T.neutral[900], fontVariantNumeric: 'tabular-nums' }}>
                  {fmtCOP(sub)}
                </span>
              </div>
            )
          }))}

          {/* Editor de items (admin, corrección de descuadres) */}
          {editing && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {draft.map((it, i) => {
                const qty = Number(it.qty) || 0
                const unit = Number(it.unitPrice) || 0
                return (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 8px', borderRadius: 8,
                    background: '#fff', border: `0.5px solid ${T.neutral[200]}`,
                  }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: T.neutral[800], wordBreak: 'break-word' }}>
                      {it.name || 'Producto'}
                      {unit > 0 && <span style={{ color: T.neutral[400] }}> · {fmtCOP(unit)} c/u</span>}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 0, background: T.neutral[100], borderRadius: 999, padding: 2, flexShrink: 0 }}>
                      <button onClick={() => changeQty(i, -1)} disabled={busy} style={qtyBtnSmall()}>−</button>
                      <span style={{ minWidth: 22, textAlign: 'center', fontSize: 13, fontWeight: 700, color: T.neutral[900], fontVariantNumeric: 'tabular-nums' }}>{qty}</span>
                      <button onClick={() => changeQty(i, +1)} disabled={busy} style={qtyBtnSmall()}>+</button>
                    </div>
                    <button onClick={() => removeDraftItem(i)} disabled={busy} title="Quitar" style={{
                      width: 26, height: 26, borderRadius: 999, flexShrink: 0,
                      background: 'transparent', border: 'none', cursor: 'pointer', color: T.bad, fontWeight: 800,
                    }}>✕</button>
                  </div>
                )
              })}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '4px 4px 0' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: T.neutral[600] }}>Nuevo total</span>
                <span style={{ fontSize: 16, fontWeight: 800, color: T.neutral[900], fontVariantNumeric: 'tabular-nums' }}>{fmtCOP(draftTotal)}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button onClick={() => { setEditing(false); setActionError(null) }} disabled={busy} style={{
                  flex: 1, padding: '10px', borderRadius: 10, background: '#fff', color: T.neutral[700],
                  border: `1px solid ${T.neutral[200]}`, cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
                }}>Cancelar</button>
                <button onClick={handleSaveEdit} disabled={busy} style={{
                  flex: 1.4, padding: '10px', borderRadius: 10, background: T.copper[500], color: '#fff',
                  border: 'none', cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 800,
                }}>{busy ? 'Guardando...' : 'Guardar cambios'}</button>
              </div>
            </div>
          )}

          <div style={{ fontSize: 11.5, color: T.neutral[500], marginTop: 2 }}>
            {paymentLabelFor(sale)}
            {sale.cashReceived != null && sale.paymentMethod === 'efectivo' && (
              <> · recibió {fmtCOP(sale.cashReceived)}</>
            )}
            {sale.photoUrl && (
              <> · <a href={sale.photoUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                style={{ color: T.copper[600], fontWeight: 600 }}>📎 comprobante</a></>
            )}
          </div>
          {(sale.notes || []).length > 0 && (
            <div style={{
              marginTop: 4, padding: '7px 10px', borderRadius: 8,
              background: '#FFF7E6', border: `1px solid #F4E0BC`,
              fontSize: 11.5, color: '#7A5C00', lineHeight: 1.4,
            }}>
              {sale.notes.map((n, i) => (
                <div key={i}>📝 {n.message}{n.byName ? ` — ${n.byName}` : ''}</div>
              ))}
            </div>
          )}

          {actionError && (
            <div style={{
              marginTop: 4, padding: '8px 10px', borderRadius: 8,
              background: '#FBE9E5', border: `1px solid #F0C8BE`,
              fontSize: 12, color: T.bad, fontWeight: 600,
            }}>
              {actionError}
            </div>
          )}

          {/* Acciones admin: corregir descuadres. Recalcula el cuadre del turno
              sin tocar la plata ya entregada. */}
          {!isDeleted && !editing && (
            confirmDel ? (
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 12, color: T.neutral[700], lineHeight: 1.4 }}>
                  ¿Eliminar esta venta? Se recalcula el cuadre del turno.
                  {isDebt && ' Se ajusta el saldo del deudor.'}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setConfirmDel(false)} disabled={busy} style={{
                    flex: 1, padding: '9px', borderRadius: 10, background: '#fff', color: T.neutral[700],
                    border: `1px solid ${T.neutral[200]}`, cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700,
                  }}>No</button>
                  <button onClick={handleDelete} disabled={busy} style={{
                    flex: 1.3, padding: '9px', borderRadius: 10, background: T.bad, color: '#fff',
                    border: 'none', cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 800,
                  }}>{busy ? 'Eliminando...' : 'Sí, eliminar'}</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={startEdit} style={{
                  flex: 1, padding: '9px', borderRadius: 10, background: '#fff', color: T.copper[700],
                  border: `1px solid ${T.copper[200]}`, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700,
                }}>Editar</button>
                <button onClick={() => setConfirmDel(true)} style={{
                  flex: 1, padding: '9px', borderRadius: 10, background: 'transparent', color: T.bad,
                  border: `1px solid ${T.bad}55`, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700,
                }}>Eliminar</button>
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}

function qtyBtnSmall() {
  return {
    width: 26, height: 26, borderRadius: 999,
    background: 'transparent', border: 'none', cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 16, fontWeight: 800, color: T.neutral[700],
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  }
}

// Etiqueta legible del método de pago de una venta (para el detalle).
function paymentLabelFor(sale) {
  if (sale.paymentSplit) {
    return 'Mixto: ' + Object.entries(sale.paymentSplit)
      .filter(([, v]) => Number(v) > 0)
      .map(([m, v]) => `${m} ${fmtCOP(Number(v))}`)
      .join(' + ')
  }
  const m = sale.paymentMethod || 'efectivo'
  return m.charAt(0).toUpperCase() + m.slice(1)
}

function ExpenseDetailRow({ expense }) {
  const isApproved = expense.status === 'approved'
  const isRejected = expense.status === 'rejected'
  const tone = isApproved
    ? { bg: '#E8F4E8', border: '#C2DDC1', label: '✓ Aprobado', labelColor: T.ok }
    : isRejected
      ? { bg: '#FBE9E5', border: '#F0C8BE', label: '✗ Rechazado', labelColor: T.bad }
      : { bg: '#FFF7E6', border: '#F4E0BC', label: 'Pendiente', labelColor: T.warn }

  return (
    <div style={{
      padding: '10px 12px', borderRadius: 10,
      background: tone.bg, border: `1px solid ${tone.border}`,
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 700, color: T.neutral[900],
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {expense.description}
        </div>
        <div style={{ fontSize: 11.5, color: T.neutral[600], marginTop: 2, display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
            {fmtCOP(expense.amount || 0)}
          </span>
          {expense.photoUrl && (
            <a
              href={expense.photoUrl}
              target="_blank"
              rel="noreferrer"
              onClick={e => e.stopPropagation()}
              style={{ color: T.copper[600], fontWeight: 600, textDecoration: 'underline' }}
            >
              📎 ver foto
            </a>
          )}
        </div>
      </div>
      <div style={{
        padding: '3px 8px', borderRadius: 999,
        background: tone.labelColor, color: '#fff',
        fontSize: 10, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase',
        flexShrink: 0,
      }}>
        {tone.label}
      </div>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{
        fontSize: 9.5, fontWeight: 700, color: T.neutral[500],
        textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 12.5, fontWeight: 700, color: T.neutral[800],
        fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </div>
    </div>
  )
}

const navBtn = {
  width: 38, height: 38, borderRadius: 999, border: 'none', cursor: 'pointer',
  background: 'rgba(255,255,255,0.12)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}

function ClosureTasksSection({ completedTasks, unfinishedTasks }) {
  const total = completedTasks.length + unfinishedTasks.length
  return (
    <>
      <DetailSectionLabel>
        Tareas del turno · {completedTasks.length}/{total} completadas
      </DetailSectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
        {completedTasks.map(t => (
          <ClosureTaskRow key={t.id} task={t} done />
        ))}
        {unfinishedTasks.map(t => (
          <ClosureTaskRow key={t.id} task={t} done={false} />
        ))}
      </div>
    </>
  )
}

function ClosureTaskRow({ task, done }) {
  const completedAt = task.completedAt?.toDate?.()
  const completedTime = completedAt
    ? completedAt.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Bogota' })
    : null

  const tone = done
    ? { bg: '#E8F4E8', border: '#C2DDC1', icon: '✓', iconColor: T.ok, label: 'Hecha', labelColor: T.ok }
    : { bg: '#FFF7E6', border: '#F4E0BC', icon: '⏳', iconColor: T.warn, label: 'Pendiente', labelColor: T.warn }

  return (
    <div style={{
      padding: '10px 12px', borderRadius: 10,
      background: tone.bg, border: `1px solid ${tone.border}`,
      display: 'flex', alignItems: 'flex-start', gap: 10,
    }}>
      <div style={{
        width: 22, height: 22, borderRadius: 999, flexShrink: 0,
        background: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 800, color: tone.iconColor,
      }}>
        {tone.icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 700, color: T.neutral[900],
          textDecoration: done ? 'line-through' : 'none',
          opacity: done ? 0.7 : 1,
          lineHeight: 1.35,
        }}>
          {task.title}
        </div>
        {(completedTime || task.completedNote) && (
          <div style={{ fontSize: 11.5, color: T.neutral[600], marginTop: 3, lineHeight: 1.4 }}>
            {completedTime && <>Hecha a las {completedTime}</>}
            {task.completedNote && <> · "{task.completedNote}"</>}
          </div>
        )}
      </div>
      <span style={{
        padding: '3px 8px', borderRadius: 999,
        background: tone.labelColor, color: '#fff',
        fontSize: 10, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase',
        flexShrink: 0,
      }}>
        {tone.label}
      </span>
    </div>
  )
}

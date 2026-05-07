import { useEffect, useMemo, useState } from 'react'
import { T } from '../tokens'
import { fmtCOP, fmtDate } from '../utils/format'
import { Card, BranchChip } from '../components/Atoms'
import { ScreenHeader } from '../components/Nav'
import { getBogotaDateStr, isDayConfirmed, calcHourRate, getCashFloor } from '../db'
import { watchClosedSessionsForDate } from '../cashSessions'
import { watchSessionSales } from '../sales'
import { watchSessionExpenses } from '../cashExpenses'
import { watchTasksCompletedInSession, watchTasksForCashier } from '../tasks'

// Registro es solo VISUALIZACIÓN + acceso al formulario de confirmación.
// No permite edición inline — toda edición pasa por DailyConfirmation o DayEditModal.

export default function Registro({ employees, attendance, onRefresh, onConfirmDay, onEditDay }) {
  const todayStr = getBogotaDateStr()
  const [date, setDate] = useState(todayStr)
  const [closures, setClosures] = useState([])

  useEffect(() => watchClosedSessionsForDate(date, setClosures), [date])

  const confirmed = isDayConfirmed(date)
  const isToday = date === todayStr
  const isFuture = date > todayStr
  const dayOfWeek = new Date(date + 'T00:00:00').getDay()

  // Empleados regulares programados para esta fecha
  const scheduled = employees.filter(e => e.type !== 'occasional' && e.restDay !== dayOfWeek)

  // Para días confirmados: también mostrar ocasionales que trabajaron
  const occasionalsWorked = confirmed
    ? employees.filter(e => e.type === 'occasional' && attendance[e.id]?.[date]?.worked)
    : []

  const allForDate = [...scheduled, ...occasionalsWorked]

  function changeDate(delta) {
    const d = new Date(date + 'T12:00:00')
    d.setDate(d.getDate() + delta)
    const next = d.toISOString().slice(0, 10)
    if (next <= todayStr) setDate(next)
  }

  // Busca quién reemplazó a un empleado en esta fecha
  function getReplacerFor(absentEmpId) {
    for (const [empId, dates] of Object.entries(attendance)) {
      if (empId !== absentEmpId && dates[date]?.replacedFor === absentEmpId) {
        return employees.find(e => e.id === empId)
      }
    }
    return null
  }

  const displayDate = fmtDate(date, { weekday: true })

  return (
    <div style={{ paddingBottom: 110 }}>
      <ScreenHeader title="Registro"/>

      {/* Navegador de fecha */}
      <div style={{ padding: '0 16px 16px' }}>
        <div style={{ borderRadius: 18, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          {/* Barra de fecha */}
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

          {/* Estado del día */}
          <div style={{
            padding: '10px 20px',
            background: confirmed ? '#EEF6EE' : isFuture ? T.neutral[50] : '#FFF8EC',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 8, height: 8, borderRadius: 999,
                background: confirmed ? T.ok : isFuture ? T.neutral[200] : '#E8A800',
              }}/>
              <span style={{ fontSize: 12, fontWeight: 600, color: confirmed ? T.ok : isFuture ? T.neutral[400] : '#7A5C00' }}>
                {confirmed ? 'Día confirmado' : isFuture ? 'Fecha futura' : 'Sin confirmar'}
              </span>
            </div>
            {/* Botón acción según estado */}
            {!isFuture && (
              confirmed
                ? <button onClick={() => onEditDay(date)} style={actionBtn('#fff', T.neutral[700], T.neutral[200])}>
                    Editar
                  </button>
                : <button onClick={() => onConfirmDay(date)} style={actionBtn(T.copper[500], '#fff', 'transparent')}>
                    {isToday ? 'Confirmar hoy' : 'Confirmar este día'}
                  </button>
            )}
          </div>
        </div>
      </div>

      {/* Contenido según estado */}
      {isFuture ? (
        <div style={{ padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 36 }}>📅</div>
          <div style={{ fontSize: 14, color: T.neutral[400], marginTop: 12 }}>Fecha futura</div>
        </div>
      ) : allForDate.length === 0 ? (
        <div style={{ padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 36 }}>😴</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: T.neutral[600], marginTop: 12 }}>Todos descansan este día</div>
        </div>
      ) : confirmed ? (
        /* ── DÍA CONFIRMADO: mostrar datos estáticos ── */
        <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {allForDate.map(emp => {
            const a = attendance[emp.id]?.[date]
            const worked = a?.worked || false
            const replacer = !worked ? getReplacerFor(emp.id) : null
            const extraPay = a?.extras || 0

            return (
              <Card key={emp.id} padding={16} style={{
                border: worked
                  ? `1.5px solid ${T.ok}35`
                  : replacer
                    ? `1.5px solid ${T.copper[200]}`
                    : `1px solid ${T.neutral[100]}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {/* Avatar */}
                  <div style={{
                    width: 40, height: 40, borderRadius: 999, flexShrink: 0,
                    background: T.branch[emp.branch]?.tagBg || T.neutral[100],
                    color: T.branch[emp.branch]?.tag || T.neutral[600],
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 700, fontSize: 14,
                  }}>
                    {emp.name.split(' ').map(p => p[0]).slice(0, 2).join('')}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: T.neutral[900] }}>
                      {emp.name.split(' ').slice(0, 2).join(' ')}
                    </div>
                    <div style={{ fontSize: 12, color: T.neutral[500], marginTop: 1, display: 'flex', gap: 5, alignItems: 'center' }}>
                      {emp.role} · <BranchChip branch={emp.branch} size="sm"/>
                    </div>
                  </div>
                  {/* Badge trabajó / no trabajó */}
                  <div style={{
                    padding: '4px 10px', borderRadius: 999,
                    background: worked ? `${T.ok}18` : '#FBF0EE',
                    color: worked ? T.ok : T.bad,
                    fontSize: 12, fontWeight: 700,
                  }}>
                    {worked ? '✓ Fue' : '✗ No fue'}
                  </div>
                </div>

                {/* Detalles si trabajó */}
                {worked && (
                  <div style={{
                    marginTop: 10, paddingTop: 10, borderTop: `0.5px solid ${T.neutral[100]}`,
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}>
                    <div style={{ fontSize: 12, color: T.neutral[500] }}>
                      {a?.extraHours !== 0
                        ? `${a.extraHours > 0 ? '+' : ''}${a.extraHours}h extra`
                        : 'Sin horas extra'}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: T.neutral[800], fontVariantNumeric: 'tabular-nums' }}>
                        {fmtCOP(emp.rate + extraPay)}
                      </div>
                      <div style={{ fontSize: 11, color: a?.paid ? T.ok : T.copper[500], fontWeight: 600, marginTop: 1 }}>
                        {a?.paid ? 'Pagado' : 'Pendiente'}
                      </div>
                    </div>
                  </div>
                )}

                {/* Detalles si no trabajó */}
                {!worked && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: `0.5px solid ${T.neutral[100]}` }}>
                    {replacer ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{
                          width: 28, height: 28, borderRadius: 999,
                          background: T.branch[replacer.branch]?.tagBg || T.neutral[100],
                          color: T.branch[replacer.branch]?.tag || T.neutral[600],
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontWeight: 700, fontSize: 10, flexShrink: 0,
                        }}>
                          {replacer.name.split(' ').map(p => p[0]).slice(0, 2).join('')}
                        </div>
                        <div style={{ fontSize: 12, color: T.neutral[600] }}>
                          Reemplazado por <strong>{replacer.name.split(' ').slice(0, 2).join(' ')}</strong>
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: T.neutral[400] }}>Sin reemplazo asignado · no se paga</div>
                    )}
                  </div>
                )}
              </Card>
            )
          })}

          {/* Botón editar al final */}
          <button onClick={() => onEditDay(date)} style={{
            padding: '13px', borderRadius: 14, border: `1px solid ${T.neutral[200]}`,
            background: '#fff', color: T.neutral[700],
            fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 3 L13 6 L6 13 H3 V10 Z" stroke={T.neutral[500]} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Editar asistencia de este día
          </button>
        </div>
      ) : (
        /* ── DÍA SIN CONFIRMAR: solo informativo + botón confirmar ── */
        <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{
            padding: '14px 16px', borderRadius: 14,
            background: '#FFF8EC', border: `1px solid #F0D9A0`,
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#7A5C00', marginBottom: 4 }}>
              {isToday ? 'Este día aún no ha sido confirmado' : 'Este día no fue confirmado'}
            </div>
            <div style={{ fontSize: 12, color: '#9A7200' }}>
              {isToday
                ? 'Usa el botón "Confirmar hoy" para registrar la asistencia del día.'
                : 'Puedes registrar la asistencia retroactivamente con el botón de arriba.'}
            </div>
          </div>

          {/* Lista de quiénes deberían trabajar hoy */}
          <div style={{ fontSize: 12, fontWeight: 600, color: T.neutral[500], paddingLeft: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Empleados programados · {allForDate.length}
          </div>
          {allForDate.map(emp => (
            <Card key={emp.id} padding={14}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 38, height: 38, borderRadius: 999, flexShrink: 0,
                  background: T.branch[emp.branch]?.tagBg || T.neutral[100],
                  color: T.branch[emp.branch]?.tag || T.neutral[600],
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, fontSize: 13,
                }}>
                  {emp.name.split(' ').map(p => p[0]).slice(0, 2).join('')}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: T.neutral[800] }}>
                    {emp.name.split(' ').slice(0, 2).join(' ')}
                  </div>
                  <div style={{ fontSize: 12, color: T.neutral[500], marginTop: 2, display: 'flex', gap: 5, alignItems: 'center' }}>
                    {emp.role} · <BranchChip branch={emp.branch} size="sm"/>
                  </div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.neutral[700], fontVariantNumeric: 'tabular-nums' }}>
                  {fmtCOP(emp.rate)}
                </div>
              </div>
            </Card>
          ))}

          {/* Botón principal confirmar */}
          <button onClick={() => onConfirmDay(date)} style={{
            padding: '15px', borderRadius: 14, border: 'none',
            background: T.neutral[900], color: '#fff',
            fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            marginTop: 4,
          }}>
            {isToday ? '✓ Confirmar asistencia de hoy' : '✓ Registrar asistencia de este día'}
          </button>
        </div>
      )}

      {/* ── Historial de cierres del día ── */}
      {!isFuture && closures.length > 0 && <ClosuresHistory closures={closures} />}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Historial de cierres de caja del día seleccionado
// ──────────────────────────────────────────────────────────────
function ClosuresHistory({ closures }) {
  return (
    <div style={{ padding: '24px 16px 0' }}>
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

  // Estado y color de borde
  // (isPending solo aparece para sesiones legacy — en D25 el admin cierra desde
  //  el panel central y va directo a 'closed'.)
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

  // Texto de resolución de la falta
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
      {/* Header: cajera + panadería + hora */}
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

      {/* Cifras: apertura · esperado · declarado */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6,
        padding: '8px 10px', borderRadius: 10,
        background: T.neutral[50],
      }}>
        <Stat label="Apertura" value={fmtCOP(session.openingFloat || 0)} />
        <Stat label="Esperado" value={fmtCOP(session.expectedCash || 0)} />
        <Stat label="Declaró" value={fmtCOP(session.declaredClosingCash || 0)} />
      </div>

      {/* Resultado */}
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
          <div style={{
            fontSize: 13, fontWeight: 700, color: T.ok,
          }}>
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

      {/* Handover (a quién entregó) */}
      {session.handover && (
        <div style={{
          marginTop: 10, paddingTop: 10, borderTop: `0.5px solid ${T.neutral[100]}`,
          fontSize: 11.5, color: T.neutral[600],
        }}>
          Entregó <b style={{ color: T.neutral[800] }}>{fmtCOP(session.handover.amount)}</b> a {session.handover.toName}
          {session.handover.type === 'admin' && ' (admin)'}
        </div>
      )}

      {/* Notas */}
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

      {/* Hint de "tap para ver más" */}
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

// ──────────────────────────────────────────────────────────────
// Modal: Detalle completo de un cierre de turno
// Muestra ventas individuales, gastos, desglose por método, fórmula
// del esperado y la acción que el admin debe tomar.
// ──────────────────────────────────────────────────────────────
function ClosureDetailModal({ session, onClose }) {
  const [sales, setSales] = useState([])
  const [expenses, setExpenses] = useState([])
  const [completedTasks, setCompletedTasks] = useState([])
  const [pendingTasksForCashier, setPendingTasksForCashier] = useState([])

  useEffect(() => watchSessionSales(session.id, setSales), [session.id])
  useEffect(() => watchSessionExpenses(session.id, setExpenses), [session.id])
  useEffect(() => watchTasksCompletedInSession(session.id, setCompletedTasks), [session.id])
  useEffect(() => {
    if (!session.cashierUid) { setPendingTasksForCashier([]); return undefined }
    return watchTasksForCashier(session.cashierUid, setPendingTasksForCashier)
  }, [session.cashierUid])

  // Tareas que quedaron sin hacer al cerrar el turno: pendientes asignadas
  // a esta cajera, que aplicaban a esta panadería (o sin filtro de panadería)
  // y que se crearon ANTES del cierre.
  const closedAtMs = session.closedAt?.toMillis?.() ?? Number.MAX_SAFE_INTEGER
  const unfinishedTasks = useMemo(() => {
    return pendingTasksForCashier.filter(t => {
      if (t.status !== 'pending') return false
      const branchOk = !t.branchId || String(t.branchId) === String(session.branchId)
      const createdMs = t.createdAt?.toMillis?.() ?? t.createdAtClient ?? 0
      return branchOk && createdMs <= closedAtMs
    })
  }, [pendingTasksForCashier, session.branchId, closedAtMs])

  // Si la sesión tiene snapshot persistido, lo usamos. Si no, calculamos en vivo.
  const liveBreakdown = useMemo(() => {
    const acc = { efectivo: 0, nequi: 0, daviplata: 0, deuda: 0, total: 0, count: 0 }
    sales.forEach(s => {
      if ((s.status || 'active') === 'deleted') return
      const m = s.paymentMethod || 'efectivo'
      const t = Number(s.total) || 0
      acc[m] = (acc[m] || 0) + t
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

  // Acción al cerrar
  const baseLowered = declared < cashFloor
  const overBase = declared - cashFloor

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 480, maxHeight: '92vh', overflowY: 'auto',
        background: '#fff', borderRadius: '20px 20px 0 0',
        boxShadow: '0 -8px 32px rgba(0,0,0,0.15)',
      }}>
        {/* Header sticky */}
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
          {/* Sección: Cómo se llega al esperado */}
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

          {/* Sección: Ventas del turno con desglose por método */}
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

          {/* Lista de ventas individuales (colapsable) */}
          {sales.length > 0 ? (
            <SalesList sales={sales} />
          ) : (
            <div style={{
              padding: '14px', textAlign: 'center', borderRadius: 10,
              background: T.neutral[50], color: T.neutral[500], fontSize: 12.5, marginBottom: 16,
            }}>
              Sin ventas en este turno
            </div>
          )}

          {/* Sección: Gastos del turno */}
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

          {/* Tareas del turno */}
          {(completedTasks.length > 0 || unfinishedTasks.length > 0) && (
            <ClosureTasksSection
              completedTasks={completedTasks}
              unfinishedTasks={unfinishedTasks}
            />
          )}

          {/* Acción al cerrar */}
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

          {/* Notas */}
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

function SalesList({ sales }) {
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
          <SaleDetailRow key={s.id} sale={s} isLast={i === visible.length - 1} />
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

function SaleDetailRow({ sale, isLast }) {
  const time = sale.createdAt?.toDate?.() || sale.createdAtClient
  const timeStr = time
    ? new Date(time).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Bogota' })
    : '—'
  const methodIcon = { efectivo: '💵', nequi: '📱', daviplata: '📲', deuda: '📋' }[sale.paymentMethod] || '·'
  const isDeleted = sale.status === 'deleted'
  const isFlagged = sale.status === 'flagged'

  return (
    <div style={{
      padding: '10px 12px',
      borderBottom: isLast ? 'none' : `0.5px solid ${T.neutral[100]}`,
      display: 'flex', alignItems: 'center', gap: 10,
      opacity: isDeleted ? 0.5 : 1,
      textDecoration: isDeleted ? 'line-through' : 'none',
    }}>
      <div style={{ fontSize: 14, flexShrink: 0 }}>{methodIcon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: T.neutral[800] }}>
          {timeStr} · {sale.items?.length || 0} producto{sale.items?.length === 1 ? '' : 's'}
          {isFlagged && <span style={{ color: T.warn, marginLeft: 6, fontWeight: 700 }}>⚠ reportada</span>}
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
      }}>
        {fmtCOP(sale.total || 0)}
      </div>
    </div>
  )
}

function ExpenseDetailRow({ expense }) {
  const isApproved = expense.status === 'approved'
  const isRejected = expense.status === 'rejected'
  const isPending = expense.status === 'pending'
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

function actionBtn(bg, color, border) {
  return {
    padding: '6px 14px', borderRadius: 999,
    border: `1px solid ${border}`,
    background: bg, color,
    fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
  }
}

// ──────────────────────────────────────────────────────────────
// Sección de tareas dentro del cierre antiguo
// ──────────────────────────────────────────────────────────────
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

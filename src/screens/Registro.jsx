import { useEffect, useState } from 'react'
import { T } from '../tokens'
import { fmtCOP, fmtDate } from '../utils/format'
import { Card, BranchChip } from '../components/Atoms'
import { ScreenHeader } from '../components/Nav'
import { getBogotaDateStr, isDayConfirmed, calcHourRate } from '../db'
import { watchClosedSessionsForDate } from '../cashSessions'

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

  // Estado y color de borde
  const tone = isPending
    ? { border: '#F0D9A0', bg: '#FFF8EC', label: 'Pendiente de aprobación', labelColor: '#7A5C00' }
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
    <Card padding={14} style={{ border: `1.5px solid ${tone.border}`, background: tone.bg }}>
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
    </Card>
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

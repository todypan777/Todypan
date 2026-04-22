import { useState, useMemo } from 'react'
import { T } from '../tokens'
import { fmtCOP, fmtDate, todayStr, currentMonth, fmtMonthLabel } from '../utils/format'
import { Card, SectionHeader, Chip, BranchChip, Amount, CatIcon, IconButton } from '../components/Atoms'
import { ScreenHeader } from '../components/Nav'
import { getBogotaHour, getBogotaDateStr, isDayConfirmed, getData } from '../db'

export default function Dashboard({ onNav, filter, setFilter, movements, employees, attendance, reminders, onConfirmDay }) {
  const today = todayStr()
  const month = currentMonth()

  const matchesBranch = (m) => filter === 'all' || m.branch === filter || m.branch === 'both'
  const monthMovs = movements.filter(m => m.date.startsWith(month) && matchesBranch(m))

  const income = monthMovs.filter(m => m.type === 'income').reduce((s, m) => s + m.amount, 0)
  const expense = monthMovs.filter(m => m.type === 'expense').reduce((s, m) => s + m.amount, 0)

  const pendingByEmp = employees
    .filter(e => filter === 'all' || e.branch === filter)
    .map(e => {
      const att = attendance[e.id] || {}
      const unpaid = Object.entries(att).filter(([, a]) => a.worked && !a.paid)
      const owed = unpaid.reduce((s, [, a]) => s + e.rate + (a.extras || 0), 0)
      return { emp: e, days: unpaid.length, owed }
    })
    .filter(x => x.owed > 0)
  const totalPayroll = pendingByEmp.reduce((s, x) => s + x.owed, 0)
  const net = income - expense - totalPayroll

  // Upcoming reminders
  const upcoming = reminders
    .filter(r => !r.paid && (filter === 'all' || r.branch === filter || r.branch === 'both'))
    .sort((a, b) => a.due.localeCompare(b.due))
    .slice(0, 3)

  // Alert reminders (overdue or due today)
  const alerts = reminders.filter(r => {
    if (r.paid) return false
    const daysLeft = Math.ceil((new Date(r.due) - new Date(today + 'T00:00:00')) / 86400000)
    return daysLeft <= 0
  })
  const todayReminders = reminders.filter(r => {
    if (r.paid) return false
    const daysLeft = Math.ceil((new Date(r.due) - new Date(today + 'T00:00:00')) / 86400000)
    return daysLeft === 0
  })

  // Daily bars last 14 days
  const dates = []
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today + 'T00:00:00')
    d.setDate(d.getDate() - i)
    dates.push(d.toISOString().slice(0, 10))
  }
  const byDay = dates.map(d => {
    const day = movements.filter(m => m.date === d && matchesBranch(m))
    return {
      d,
      inc: day.filter(m => m.type === 'income').reduce((s, m) => s + m.amount, 0),
      exp: day.filter(m => m.type === 'expense').reduce((s, m) => s + m.amount, 0),
    }
  })
  const maxDay = Math.max(1, ...byDay.map(x => Math.max(x.inc, x.exp)))

  const monthLabel = fmtMonthLabel(month)
  const now = new Date()
  const greetings = ['Buen domingo', 'Buen lunes', 'Buen martes', 'Buen miércoles', 'Buen jueves', 'Buen viernes', 'Buen sábado']
  const greeting = greetings[now.getDay()]

  const showConfirmBanner = getBogotaHour() >= 20 && !isDayConfirmed(getBogotaDateStr()) && employees.some(e => e.type !== 'occasional')

  return (
    <div style={{ paddingBottom: 110 }}>
      {/* Alert banner */}
      {showConfirmBanner && (
        <div onClick={onConfirmDay} style={{
          margin: '12px 16px 0',
          padding: '12px 16px', borderRadius: 14,
          background: T.neutral[900],
          display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 999, flexShrink: 0,
            background: T.copper[500],
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M9 3 V9 L12.5 11.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              <circle cx="9" cy="9" r="7" stroke="#fff" strokeWidth="1.5"/>
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Confirmar asistencia de hoy</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 1 }}>
              Pendiente · toca para registrar
            </div>
          </div>
          <svg width="7" height="12" viewBox="0 0 7 12">
            <path d="M1 1 L6 6 L1 11" stroke={T.copper[400]} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      )}

      {(alerts.length > 0 || todayReminders.length > 0) && (
        <div onClick={() => onNav('reminders')} style={{
          margin: '12px 16px 0',
          padding: '12px 16px', borderRadius: 14,
          background: alerts.length > 0 ? '#FBEAE6' : '#FFF8EC',
          border: `1px solid ${alerts.length > 0 ? '#E8C4BC' : '#F0D9A0'}`,
          display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 999, flexShrink: 0,
            background: alerts.length > 0 ? T.bad : T.warn,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 2 L14 13 H2 Z" stroke="#fff" strokeWidth="1.4" fill="none" strokeLinejoin="round"/>
              <path d="M8 6 V9 M8 11 V11.5" stroke="#fff" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: alerts.length > 0 ? T.bad : '#7A5C00' }}>
              {alerts.length > 0
                ? `${alerts.length} pago${alerts.length > 1 ? 's' : ''} vencido${alerts.length > 1 ? 's' : ''}`
                : `${todayReminders.length} pago${todayReminders.length > 1 ? 's' : ''} vence hoy`}
            </div>
            <div style={{ fontSize: 11, color: alerts.length > 0 ? '#8B3A2E' : '#5C4500', marginTop: 1 }}>
              {alerts.map(r => r.title).join(', ')}
              {todayReminders.length > 0 && !alerts.length && todayReminders.map(r => r.title).join(', ')}
            </div>
          </div>
          <svg width="7" height="12" viewBox="0 0 7 12">
            <path d="M1 1 L6 6 L1 11" stroke={alerts.length > 0 ? T.bad : T.warn} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      )}

      <ScreenHeader
        title={monthLabel}
        subtitle={greeting}
        right={
          <IconButton>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M3 6 H15 M5 9 H13 M7 12 H11" stroke={T.neutral[600]} strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
          </IconButton>
        }
      />

      {/* Branch filter */}
      <div style={{ padding: '4px 20px 16px', display: 'flex', gap: 8, overflowX: 'auto' }}>
        <Chip label="Ambas" active={filter === 'all'} onClick={() => setFilter('all')} />
        {getData().branches.map(br => (
          <Chip key={br.id} label={br.name} active={filter === br.id} onClick={() => setFilter(br.id)} />
        ))}
      </div>

      {/* Balance hero card */}
      <div style={{ padding: '0 16px' }}>
        <Card padding={20} style={{
          background: `linear-gradient(145deg, ${T.neutral[800]} 0%, ${T.neutral[900]} 100%)`,
          color: '#fff',
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: 0.8, color: T.copper[300], textTransform: 'uppercase' }}>
            Balance del mes
          </div>
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{
              fontSize: 36, fontWeight: 700, letterSpacing: -1.2,
              fontVariantNumeric: 'tabular-nums',
              color: net >= 0 ? '#fff' : '#E8A090',
            }}>{fmtCOP(net, { sign: true })}</span>
          </div>
          <div style={{
            marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
            gap: 14, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.1)',
          }}>
            {[
              { label: 'Ingresos', value: income },
              { label: 'Gastos', value: expense },
              { label: 'Nómina', value: totalPayroll },
            ].map(({ label, value }) => (
              <div key={label}>
                <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600 }}>{label}</div>
                <div style={{ fontSize: 14, fontWeight: 600, marginTop: 3, fontVariantNumeric: 'tabular-nums', color: '#fff' }}>
                  {fmtCOP(value, { compact: true })}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Daily flow chart */}
      <div style={{ padding: '12px 16px 0' }}>
        <Card padding={16}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.neutral[600], letterSpacing: 0.3 }}>Últimos 14 días</div>
            <div style={{ display: 'flex', gap: 12, fontSize: 11, color: T.neutral[500] }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 7, height: 7, borderRadius: 2, background: T.ok }}/>Ingreso
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 7, height: 7, borderRadius: 2, background: T.copper[400] }}/>Gasto
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 70 }}>
            {byDay.map((x) => (
              <div key={x.d} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, justifyContent: 'flex-end' }}>
                <div style={{ width: '100%', display: 'flex', gap: 1, alignItems: 'flex-end', height: 60 }}>
                  <div style={{ flex: 1, background: T.ok, opacity: 0.85, borderRadius: '2px 2px 0 0', height: `${(x.inc / maxDay) * 100}%`, minHeight: x.inc > 0 ? 2 : 0 }}/>
                  <div style={{ flex: 1, background: T.copper[400], opacity: 0.85, borderRadius: '2px 2px 0 0', height: `${(x.exp / maxDay) * 100}%`, minHeight: x.exp > 0 ? 2 : 0 }}/>
                </div>
                <div style={{ fontSize: 9, color: T.neutral[400], fontWeight: 500 }}>
                  {new Date(x.d + 'T00:00:00').getDate()}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Pending payroll */}
      {pendingByEmp.length > 0 && (
        <>
          <SectionHeader title="Nómina pendiente" action="Ver todo" onAction={() => onNav('team')} />
          <div style={{ padding: '0 16px' }}>
            <Card padding={0}>
              {pendingByEmp.slice(0, 3).map((x, i) => (
                <div key={x.emp.id} onClick={() => onNav('emp', { empId: x.emp.id })}
                  style={{
                    padding: '14px 16px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 12,
                    borderBottom: i < Math.min(pendingByEmp.length, 3) - 1 ? `0.5px solid ${T.neutral[100]}` : 'none',
                  }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 999,
                    background: T.branch[x.emp.branch]?.tagBg || T.neutral[100],
                    color: T.branch[x.emp.branch]?.tag || T.neutral[600],
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 700, fontSize: 14,
                  }}>
                    {x.emp.name.split(' ').map(p => p[0]).slice(0, 2).join('')}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: T.neutral[800] }}>
                      {x.emp.name.split(' ').slice(0, 2).join(' ')}
                    </div>
                    <div style={{ fontSize: 12, color: T.neutral[500], marginTop: 2 }}>
                      {x.days} {x.days === 1 ? 'día' : 'días'} pendiente{x.days !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <Amount value={x.owed} size={15} weight={700} color={T.neutral[900]}/>
                </div>
              ))}
            </Card>
          </div>
        </>
      )}

      {/* Upcoming reminders */}
      {upcoming.length > 0 && (
        <>
          <SectionHeader title="Próximos pagos" action="Ver todo" onAction={() => onNav('reminders')} />
          <div style={{ padding: '0 16px' }}>
            <Card padding={0}>
              {upcoming.map((r, i) => {
                const daysLeft = Math.ceil((new Date(r.due) - new Date(today + 'T00:00:00')) / 86400000)
                const urgent = daysLeft <= 3
                return (
                  <div key={r.id} style={{
                    padding: '14px 16px',
                    display: 'flex', alignItems: 'center', gap: 12,
                    borderBottom: i < upcoming.length - 1 ? `0.5px solid ${T.neutral[100]}` : 'none',
                  }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 10,
                      background: urgent ? '#FBEAE6' : T.neutral[50],
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <CatIcon cat={r.cat} size={18} color={urgent ? T.bad : T.neutral[600]}/>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 600, color: T.neutral[800] }}>{r.title}</div>
                      <div style={{ fontSize: 12, color: urgent ? T.bad : T.neutral[500], marginTop: 2 }}>
                        {daysLeft === 0 ? 'Hoy' : daysLeft === 1 ? 'Mañana' : daysLeft < 0 ? 'Vencido' : `En ${daysLeft} días`}
                        {r.branch !== 'both' && <> · <BranchChip branch={r.branch} size="sm"/></>}
                      </div>
                    </div>
                    <Amount value={r.amount} size={15} weight={700}/>
                  </div>
                )
              })}
            </Card>
          </div>
        </>
      )}

      {/* Quick actions */}
      <SectionHeader title="Acciones rápidas" />
      <div style={{ padding: '0 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <QuickAction label="Registrar ingreso" color={T.ok} onClick={() => onNav('add', { kind: 'income' })}
          icon={<svg width="20" height="20" viewBox="0 0 20 20"><path d="M10 4 V16 M5 9 L10 4 L15 9" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}/>
        <QuickAction label="Registrar gasto" color={T.copper[500]} onClick={() => onNav('add', { kind: 'expense' })}
          icon={<svg width="20" height="20" viewBox="0 0 20 20"><path d="M10 4 V16 M5 11 L10 16 L15 11" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}/>
      </div>

      {/* Today summary */}
      {(() => {
        const todayMovs = movements.filter(m => m.date === today && matchesBranch(m))
        const todayInc = todayMovs.filter(m => m.type === 'income').reduce((s, m) => s + m.amount, 0)
        const todayExp = todayMovs.filter(m => m.type === 'expense').reduce((s, m) => s + m.amount, 0)
        if (todayInc === 0 && todayExp === 0) return null
        return (
          <>
            <SectionHeader title="Hoy" />
            <div style={{ padding: '0 16px' }}>
              <Card padding={16}>
                <div style={{ display: 'flex', gap: 20 }}>
                  <div>
                    <div style={{ fontSize: 11, color: T.neutral[400], fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Ingresos</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: T.ok, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{fmtCOP(todayInc, { compact: true })}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: T.neutral[400], fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Gastos</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: T.copper[500], marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{fmtCOP(todayExp, { compact: true })}</div>
                  </div>
                </div>
              </Card>
            </div>
          </>
        )
      })()}
    </div>
  )
}

function QuickAction({ label, color, icon, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: '14px', borderRadius: 16, border: 'none', background: '#fff',
      boxShadow: '0 1px 2px rgba(45,35,25,0.04), 0 0 0 1px rgba(45,35,25,0.05)',
      display: 'flex', alignItems: 'center', gap: 10,
      cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
    }}>
      <div style={{ width: 38, height: 38, borderRadius: 10, background: color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {icon}
      </div>
      <span style={{ fontSize: 13.5, fontWeight: 600, color: T.neutral[800] }}>{label}</span>
    </button>
  )
}

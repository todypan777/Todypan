import { useEffect, useState } from 'react'
import { T } from '../tokens'
import { fmtCOP, todayStr, currentMonth, fmtMonthLabel } from '../utils/format'
import { Card, SectionHeader, Chip, BranchChip, Amount, CatIcon } from '../components/Atoms'
import { ScreenHeader } from '../components/Nav'
import { getData } from '../db'
import { watchAllSales } from '../sales'
import ActiveTurnsCard from '../components/ActiveTurnsCard'
import { visibleBranches, movementMatchesBranch } from '../utils/branchScope'
import CookAssistCard from '../components/CookAssistCard'

export default function Dashboard({ onNav, filter, setFilter, movements, reminders, userDoc }) {
  const today = todayStr()
  const month = currentMonth()

  const [sales, setSales] = useState([])
  useEffect(() => watchAllSales(setSales), [])

  // Panaderías visibles. En modo "ver como" queda una sola, y entonces el
  // filtro se fija en ella: dejarlo en "Ambas" mostraría totales de las dos y
  // la pantalla mentiría sobre lo que ve el dueño de esa sede.
  const misSedes = visibleBranches(userDoc, getData().branches || [])
  const sedeUnica = misSedes.length === 1 ? misSedes[0].id : null
  const filtroReal = sedeUnica != null ? sedeUnica : filter

  const matchesBranch = (m) => movementMatchesBranch(m, filtroReal)
  const matchesSaleBranch = (s) => filtroReal === 'all' || String(s.branchId) === String(filtroReal)
  const isActiveSale = (s) => (s.status || 'active') !== 'deleted'

  const upcoming = reminders
    .filter(r => !r.paid && (filtroReal === 'all' || r.branch === filtroReal || r.branch === 'both'))
    .sort((a, b) => a.due.localeCompare(b.due))
    .slice(0, 3)

  const monthLabel = fmtMonthLabel(month)
  const now = new Date()
  const greetings = ['Buen domingo', 'Buen lunes', 'Buen martes', 'Buen miércoles', 'Buen jueves', 'Buen viernes', 'Buen sábado']
  const greeting = greetings[now.getDay()]

  return (
    <div style={{ paddingBottom: 110 }}>
      <ScreenHeader
        title={monthLabel}
        subtitle={greeting}
      />

      <div style={{ padding: '4px 20px 16px', display: 'flex', gap: 8, overflowX: 'auto' }}>
        {misSedes.length > 1 && (
          <Chip label="Ambas" active={filter === 'all'} onClick={() => setFilter('all')} />
        )}
        {misSedes.map(br => (
          <Chip key={br.id} label={br.name} active={filter === br.id} onClick={() => setFilter(br.id)} />
        ))}
      </div>

      <ActiveTurnsCard viewUserDoc={userDoc} />

      <CookAssistCard />

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

      <SectionHeader title="Acciones rápidas" />
      <div style={{ padding: '0 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <QuickAction label="Registrar ingreso" color={T.ok} onClick={() => onNav('add', { kind: 'income' })}
          icon={<svg width="20" height="20" viewBox="0 0 20 20"><path d="M10 4 V16 M5 9 L10 4 L15 9" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}/>
        <QuickAction label="Registrar gasto" color={T.copper[500]} onClick={() => onNav('add', { kind: 'expense' })}
          icon={<svg width="20" height="20" viewBox="0 0 20 20"><path d="M10 4 V16 M5 11 L10 16 L15 11" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}/>
      </div>

      {(() => {
        const todayMovs = movements.filter(m => m.date === today && matchesBranch(m))
        const todaySales = sales.filter(s => s.date === today && isActiveSale(s) && matchesSaleBranch(s))
        const todayInc = todayMovs.filter(m => m.type === 'income').reduce((s, m) => s + m.amount, 0)
                       + todaySales.reduce((s, x) => s + (Number(x.total) || 0), 0)
        const todayExp = todayMovs.filter(m => m.type === 'expense').reduce((s, m) => s + m.amount, 0)
        const todayNet = todayInc - todayExp
        return (
          <>
            <SectionHeader title="Hoy" />
            <div style={{ padding: '0 16px' }}>
              <Card padding={16}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 11, color: T.neutral[400], fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Ingresos</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: T.ok, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{fmtCOP(todayInc)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: T.neutral[400], fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Gastos</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: T.copper[500], marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{fmtCOP(todayExp)}</div>
                  </div>
                  <div style={{ paddingLeft: 12, borderLeft: `1px solid ${T.neutral[100]}` }}>
                    <div style={{ fontSize: 11, color: T.neutral[400], fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Ganancia</div>
                    <div style={{
                      fontSize: 18, fontWeight: 700, marginTop: 3, fontVariantNumeric: 'tabular-nums',
                      color: todayNet > 0 ? T.ok : todayNet < 0 ? T.bad : T.neutral[500],
                    }}>{fmtCOP(todayNet, { sign: todayNet !== 0 })}</div>
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

import { useEffect, useState } from 'react'
import { T } from '../tokens'
import { fmtCOP, fmtMonthLabel, currentMonth } from '../utils/format'
import { Card, SectionHeader, Chip, BranchChip, Amount, CatIcon, BackButton } from '../components/Atoms'
import { ScreenHeader } from '../components/Nav'
import { getData } from '../db'
import { watchAllSales } from '../sales'

function catLabel(cat, incomeCats, expenseCats) {
  if (cat === 'ventas_cajera') return 'Ventas (cajera)'
  const all = [...incomeCats, ...expenseCats.proveedores, ...expenseCats.operacion, ...expenseCats.empresa]
  return all.find(c => c.id === cat)?.label || cat
}

export default function Reports({ filter, setFilter, movements, employees, attendance, incomeCats, expenseCats, onBack }) {
  const [month, setMonth] = useState(currentMonth())
  const [sales, setSales] = useState([])
  useEffect(() => watchAllSales(setSales), [])

  function changeMonth(delta) {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setMonth(d.toISOString().slice(0, 7))
  }

  const match = (m) => filter === 'all' || m.branch === filter || m.branch === 'both'
  const matchSale = (s) => filter === 'all' || String(s.branchId) === String(filter)
  const isActiveSale = (s) => (s.status || 'active') !== 'deleted'

  const movs = movements.filter(m => m.date.startsWith(month) && match(m))
  const monthSales = sales.filter(s =>
    isActiveSale(s) && s.date?.startsWith(month) && matchSale(s)
  )

  const movIncome = movs.filter(m => m.type === 'income').reduce((s, m) => s + m.amount, 0)
  const salesIncome = monthSales.reduce((s, x) => s + (Number(x.total) || 0), 0)
  const income = movIncome + salesIncome
  const expense = movs.filter(m => m.type === 'expense').reduce((s, m) => s + m.amount, 0)

  // Payroll
  const monthPayroll = employees
    .filter(e => filter === 'all' || e.branch === filter)
    .reduce((total, e) => {
      const att = attendance[e.id] || {}
      return total + Object.entries(att)
        .filter(([d, a]) => d.startsWith(month) && a.worked)
        .reduce((s, [, a]) => s + e.rate + (a.extras || 0), 0)
    }, 0)

  // Expense by group
  const byGroup = { proveedores: 0, operacion: 0, empresa: 0 }
  movs.filter(m => m.type === 'expense').forEach(m => { if (m.group) byGroup[m.group] = (byGroup[m.group] || 0) + m.amount })

  // Income by branch (movements + sales)
  const byBranchInc = { 1: 0, 2: 0 }
  movs.filter(m => m.type === 'income').forEach(m => {
    if (m.branch === 1) byBranchInc[1] += m.amount
    if (m.branch === 2) byBranchInc[2] += m.amount
    if (m.branch === 'both') { byBranchInc[1] += m.amount / 2; byBranchInc[2] += m.amount / 2 }
  })
  monthSales.forEach(s => {
    const bid = Number(s.branchId)
    if (bid === 1 || bid === 2) byBranchInc[bid] = (byBranchInc[bid] || 0) + (Number(s.total) || 0)
  })

  // Top expense categories
  const byCat = {}
  movs.filter(m => m.type === 'expense').forEach(m => { byCat[m.cat] = (byCat[m.cat] || 0) + m.amount })
  const topCats = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 6)

  // Income categories (movements + ventas cajera consolidadas como 'ventas_cajera')
  const byIncCat = {}
  movs.filter(m => m.type === 'income').forEach(m => { byIncCat[m.cat] = (byIncCat[m.cat] || 0) + m.amount })
  if (salesIncome > 0) byIncCat['ventas_cajera'] = (byIncCat['ventas_cajera'] || 0) + salesIncome
  const topIncCats = Object.entries(byIncCat).sort((a, b) => b[1] - a[1])

  const net = income - expense - monthPayroll

  return (
    <div style={{ paddingBottom: 110 }}>
      <ScreenHeader title="Reportes" subtitle={fmtMonthLabel(month)}/>

      {/* Month nav */}
      <div style={{ padding: '0 20px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button onClick={() => changeMonth(-1)} style={{ background: 'none', border: 'none', padding: '8px 12px', cursor: 'pointer', color: T.copper[500], fontFamily: 'inherit', fontSize: 13, fontWeight: 600 }}>‹ Anterior</button>
        <div style={{ fontSize: 14, fontWeight: 600, color: T.neutral[700] }}>{fmtMonthLabel(month)}</div>
        <button onClick={() => changeMonth(1)} disabled={month >= currentMonth()} style={{ background: 'none', border: 'none', padding: '8px 12px', cursor: month >= currentMonth() ? 'default' : 'pointer', color: month >= currentMonth() ? T.neutral[300] : T.copper[500], fontFamily: 'inherit', fontSize: 13, fontWeight: 600 }}>Siguiente ›</button>
      </div>

      <div style={{ padding: '0 20px 12px', display: 'flex', gap: 8, overflowX: 'auto' }}>
        <Chip label="Ambas" active={filter === 'all'} onClick={() => setFilter('all')} />
        {getData().branches.map(br => (
          <Chip key={br.id} label={br.name} active={filter === br.id} onClick={() => setFilter(br.id)} />
        ))}
      </div>

      {/* Net summary */}
      <div style={{ padding: '0 16px' }}>
        <Card padding={20} style={{
          background: `linear-gradient(145deg, ${T.neutral[800]} 0%, ${T.neutral[900]} 100%)`,
          color: '#fff',
        }}>
          <div style={{ fontSize: 11, color: T.copper[300], fontWeight: 600, letterSpacing: 0.8, textTransform: 'uppercase' }}>Utilidad neta</div>
          <div style={{ fontSize: 34, fontWeight: 700, marginTop: 6, fontVariantNumeric: 'tabular-nums', letterSpacing: -1, color: net >= 0 ? '#fff' : '#E8A090' }}>
            {fmtCOP(net, { sign: true })}
          </div>
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.1)', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            {[
              { l: 'Ingresos', v: income, c: T.ok },
              { l: 'Gastos', v: expense, c: T.copper[300] },
              { l: 'Nómina', v: monthPayroll, c: '#A89E90' },
            ].map(({ l, v, c }) => (
              <div key={l}>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{l}</div>
                <div style={{ fontSize: 13, fontWeight: 700, marginTop: 3, color: c, fontVariantNumeric: 'tabular-nums' }}>{fmtCOP(v, { compact: true })}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Income vs Expense bar */}
      <SectionHeader title="Ingresos vs Gastos"/>
      <div style={{ padding: '0 16px' }}>
        <Card padding={18}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 11, color: T.neutral[500], fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase' }}>Ingresos</div>
              <div style={{ marginTop: 4, fontSize: 22, fontWeight: 700, color: T.ok, fontVariantNumeric: 'tabular-nums', letterSpacing: -0.5 }}>{fmtCOP(income, { compact: true })}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: T.neutral[500], fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase' }}>Gastos</div>
              <div style={{ marginTop: 4, fontSize: 22, fontWeight: 700, color: T.copper[600], fontVariantNumeric: 'tabular-nums', letterSpacing: -0.5 }}>{fmtCOP(expense, { compact: true })}</div>
            </div>
          </div>
          <div style={{ height: 10, borderRadius: 6, display: 'flex', overflow: 'hidden', background: T.neutral[100] }}>
            <div style={{ flex: income || 1, background: T.ok, transition: 'flex 0.4s' }}/>
            <div style={{ flex: expense || 0, background: T.copper[400], transition: 'flex 0.4s' }}/>
          </div>
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: `0.5px solid ${T.neutral[100]}`, display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, color: T.neutral[600], fontWeight: 500 }}>Margen bruto</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: income - expense >= 0 ? T.ok : T.bad, fontVariantNumeric: 'tabular-nums' }}>
              {fmtCOP(income - expense, { sign: true })}
            </span>
          </div>
        </Card>
      </div>

      {/* Expense by type */}
      {expense > 0 && (
        <>
          <SectionHeader title="Gastos por tipo"/>
          <div style={{ padding: '0 16px' }}>
            <Card padding={16}>
              {[
                { id: 'proveedores', label: 'Proveedores', color: T.copper[400] },
                { id: 'operacion',   label: 'Operación',   color: T.copper[600] },
                { id: 'empresa',     label: 'Empresa',     color: T.copper[300] },
              ].map((g, i, arr) => {
                const pct = expense > 0 ? (byGroup[g.id] / expense) * 100 : 0
                return (
                  <div key={g.id} style={{ marginBottom: i < arr.length - 1 ? 16 : 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: T.neutral[700], display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: g.color }}/>
                        {g.label}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: T.neutral[800], fontVariantNumeric: 'tabular-nums' }}>
                        {fmtCOP(byGroup[g.id], { compact: true })}
                        <span style={{ color: T.neutral[400], fontWeight: 500 }}> · {pct.toFixed(0)}%</span>
                      </span>
                    </div>
                    <div style={{ height: 6, borderRadius: 3, background: T.neutral[100], overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: g.color, borderRadius: 3, transition: 'width 0.4s' }}/>
                    </div>
                  </div>
                )
              })}
            </Card>
          </div>
        </>
      )}

      {/* Branch comparison */}
      {filter === 'all' && (byBranchInc[1] > 0 || byBranchInc[2] > 0) && (
        <>
          <SectionHeader title="Ingresos por panadería"/>
          <div style={{ padding: '0 16px' }}>
            <Card padding={16}>
              {[1, 2].map((b, i) => {
                const val = byBranchInc[b]
                const total = byBranchInc[1] + byBranchInc[2]
                const pct = total > 0 ? (val / total) * 100 : 0
                return (
                  <div key={b} style={{ marginBottom: i === 0 ? 16 : 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <BranchChip branch={b}/>
                      <span style={{ fontSize: 13, fontWeight: 600, color: T.neutral[800], fontVariantNumeric: 'tabular-nums' }}>
                        {fmtCOP(val, { compact: true })}
                        <span style={{ color: T.neutral[400], fontWeight: 500 }}> · {pct.toFixed(0)}%</span>
                      </span>
                    </div>
                    <div style={{ height: 6, borderRadius: 3, background: T.neutral[100], overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: T.branch[b].tag, borderRadius: 3, transition: 'width 0.4s' }}/>
                    </div>
                  </div>
                )
              })}
            </Card>
          </div>
        </>
      )}

      {/* Top income categories */}
      {topIncCats.length > 0 && (
        <>
          <SectionHeader title="Ingresos por categoría"/>
          <div style={{ padding: '0 16px' }}>
            <Card padding={0}>
              {topIncCats.map(([cat, amt], i) => (
                <div key={cat} style={{
                  padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12,
                  borderBottom: i < topIncCats.length - 1 ? `0.5px solid ${T.neutral[100]}` : 'none',
                }}>
                  <div style={{ width: 32, height: 32, borderRadius: 9, background: `${T.ok}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <CatIcon cat={cat} size={16} color={T.ok}/>
                  </div>
                  <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: T.neutral[800] }}>{catLabel(cat, incomeCats, expenseCats)}</div>
                  <Amount value={amt} size={14} weight={700} color={T.ok}/>
                </div>
              ))}
            </Card>
          </div>
        </>
      )}

      {/* Top expense categories */}
      {topCats.length > 0 && (
        <>
          <SectionHeader title="Mayores gastos"/>
          <div style={{ padding: '0 16px' }}>
            <Card padding={0}>
              {topCats.map(([cat, amt], i) => (
                <div key={cat} style={{
                  padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12,
                  borderBottom: i < topCats.length - 1 ? `0.5px solid ${T.neutral[100]}` : 'none',
                }}>
                  <div style={{ width: 32, height: 32, borderRadius: 9, background: T.copper[50], display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <CatIcon cat={cat} size={16} color={T.copper[600]}/>
                  </div>
                  <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: T.neutral[800] }}>{catLabel(cat, incomeCats, expenseCats)}</div>
                  <Amount value={amt} size={14} weight={700}/>
                </div>
              ))}
            </Card>
          </div>
        </>
      )}

      {movs.length === 0 && (
        <div style={{ padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 36 }}>📊</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: T.neutral[600], marginTop: 12 }}>Sin datos este mes</div>
          <div style={{ fontSize: 13, color: T.neutral[400], marginTop: 6 }}>Registra movimientos para ver reportes</div>
        </div>
      )}
    </div>
  )
}

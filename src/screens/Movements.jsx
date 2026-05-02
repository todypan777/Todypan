import { useState } from 'react'
import { T } from '../tokens'
import { fmtCOP, fmtDate, currentMonth, fmtMonthLabel } from '../utils/format'
import { Card, SectionHeader, Chip, BranchChip, Amount, CatIcon } from '../components/Atoms'
import { ScreenHeader } from '../components/Nav'
import { deleteMovement, getIncomeCats, getExpenseCats, getData } from '../db'

function allCatLabel(cat, incomeCats, expenseCats) {
  const all = [
    ...incomeCats,
    ...expenseCats.proveedores,
    ...expenseCats.operacion,
    ...expenseCats.empresa,
  ]
  return all.find(c => c.id === cat)?.label || cat
}

function groupLabel(group) {
  if (group === 'proveedores') return 'Proveedores'
  if (group === 'operacion') return 'Operación'
  if (group === 'empresa') return 'Empresa'
  return ''
}

export default function Movements({ filter, setFilter, movements, incomeCats, expenseCats, onNav, onRefresh }) {
  const [typeFilter, setTypeFilter] = useState('all')
  const [month, setMonth] = useState(currentMonth())
  const [confirmDel, setConfirmDel] = useState(null)

  const filtered = movements.filter(m => {
    const matchBranch = filter === 'all' || m.branch === filter || m.branch === 'both'
    const matchType = typeFilter === 'all' || m.type === typeFilter
    const matchMonth = m.date.startsWith(month)
    return matchBranch && matchType && matchMonth
  })

  // Group by date
  const byDate = {}
  filtered.forEach(m => {
    if (!byDate[m.date]) byDate[m.date] = []
    byDate[m.date].push(m)
  })
  const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a))

  const totalInc = filtered.filter(m => m.type === 'income').reduce((s, m) => s + m.amount, 0)
  const totalExp = filtered.filter(m => m.type === 'expense').reduce((s, m) => s + m.amount, 0)

  function changeMonth(delta) {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setMonth(d.toISOString().slice(0, 7))
  }

  function handleDelete(id) {
    deleteMovement(id)
    setConfirmDel(null)
    onRefresh()
  }

  return (
    <div style={{ paddingBottom: 110 }}>
      <ScreenHeader title="Movimientos" />

      {/* Month nav */}
      <div style={{ padding: '0 20px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button onClick={() => changeMonth(-1)} style={monthBtnStyle}>
          <svg width="8" height="14" viewBox="0 0 8 14"><path d="M6 1 L1 7 L6 13" stroke={T.copper[500]} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <div style={{ fontSize: 15, fontWeight: 700, color: T.neutral[800] }}>{fmtMonthLabel(month)}</div>
        <button onClick={() => changeMonth(1)} style={monthBtnStyle} disabled={month >= currentMonth()}>
          <svg width="8" height="14" viewBox="0 0 8 14"><path d="M2 1 L7 7 L2 13" stroke={month >= currentMonth() ? T.neutral[300] : T.copper[500]} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
      </div>

      {/* Filters */}
      <div style={{ padding: '4px 20px 10px', display: 'flex', gap: 8, overflowX: 'auto' }}>
        <Chip label="Todo" active={typeFilter === 'all'} onClick={() => setTypeFilter('all')} />
        <Chip label="Ingresos" active={typeFilter === 'income'} onClick={() => setTypeFilter('income')} />
        <Chip label="Gastos" active={typeFilter === 'expense'} onClick={() => setTypeFilter('expense')} />
      </div>
      <div style={{ padding: '0 20px 12px', display: 'flex', gap: 8, overflowX: 'auto' }}>
        <Chip label="Ambas" active={filter === 'all'} onClick={() => setFilter('all')} />
        {getData().branches.map(br => (
          <Chip key={br.id} label={br.name} active={filter === br.id} onClick={() => setFilter(br.id)} />
        ))}
      </div>

      {/* Summary bar */}
      <div style={{ padding: '0 16px 12px' }}>
        <Card padding={14}>
          <div style={{ display: 'flex', gap: 24 }}>
            <div>
              <div style={{ fontSize: 10.5, color: T.neutral[400], fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Ingresos</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: T.ok, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{fmtCOP(totalInc)}</div>
            </div>
            <div>
              <div style={{ fontSize: 10.5, color: T.neutral[400], fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Gastos</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: T.copper[500], marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{fmtCOP(totalExp)}</div>
            </div>
            <div>
              <div style={{ fontSize: 10.5, color: T.neutral[400], fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Neto</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: totalInc - totalExp >= 0 ? T.ok : T.bad, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{fmtCOP(totalInc - totalExp)}</div>
            </div>
          </div>
        </Card>
      </div>

      {dates.length === 0 && (
        <div style={{ padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 36 }}>📋</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: T.neutral[600], marginTop: 12 }}>Sin movimientos</div>
          <div style={{ fontSize: 13, color: T.neutral[400], marginTop: 6 }}>Registra un ingreso o gasto con el botón +</div>
        </div>
      )}

      {dates.map(date => {
        const items = byDate[date]
        const dayInc = items.filter(m => m.type === 'income').reduce((s, m) => s + m.amount, 0)
        const dayExp = items.filter(m => m.type === 'expense').reduce((s, m) => s + m.amount, 0)
        return (
          <div key={date}>
            <div style={{
              padding: '8px 20px 6px',
              display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: T.neutral[500], textTransform: 'capitalize' }}>
                {fmtDate(date, { weekday: true })}
              </div>
              <div style={{ fontSize: 12, color: T.neutral[400], display: 'flex', gap: 10 }}>
                {dayInc > 0 && <span style={{ color: T.ok, fontWeight: 600 }}>+{fmtCOP(dayInc)}</span>}
                {dayExp > 0 && <span style={{ color: T.copper[500], fontWeight: 600 }}>−{fmtCOP(dayExp)}</span>}
              </div>
            </div>
            <div style={{ padding: '0 16px', marginBottom: 4 }}>
              <Card padding={0}>
                {items.map((m, i) => (
                  <div key={m.id}
                    onContextMenu={e => { e.preventDefault(); setConfirmDel(m.id) }}
                    style={{
                      padding: '13px 16px',
                      display: 'flex', alignItems: 'center', gap: 12,
                      borderBottom: i < items.length - 1 ? `0.5px solid ${T.neutral[100]}` : 'none',
                    }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                      background: m.type === 'income' ? `${T.ok}18` : T.copper[50],
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <CatIcon cat={m.cat} size={18} color={m.type === 'income' ? T.ok : T.copper[600]}/>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: m.note ? T.neutral[800] : T.neutral[500] }}>
                        {m.note || allCatLabel(m.cat, incomeCats, expenseCats)}
                      </div>
                      <div style={{ fontSize: 11, color: T.neutral[400], marginTop: 2, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <BranchChip branch={m.branch} size="sm"/>
                        {m.group && <span>{groupLabel(m.group)}</span>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: m.type === 'income' ? T.ok : T.neutral[800], fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
                        {m.type === 'income' ? '+' : '−'}{fmtCOP(m.amount)}
                      </div>
                      <button onClick={() => setConfirmDel(m.id)} style={{
                        background: T.neutral[100], border: 'none', borderRadius: 8,
                        width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', flexShrink: 0,
                      }}>
                        <svg width="15" height="15" viewBox="0 0 20 20" fill="none">
                          <path d="M4 6h12M8 6V4h4v2M7 9v6M13 9v6M5 6l1 11h8l1-11" stroke={T.neutral[400]} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </Card>
            </div>
          </div>
        )
      })}

      {/* Delete confirm */}
      {confirmDel && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }} onClick={() => setConfirmDel(null)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#fff', borderRadius: 20, padding: 24, width: '100%', maxWidth: 320,
          }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: T.neutral[900], marginBottom: 8 }}>¿Eliminar movimiento?</div>
            <div style={{ fontSize: 14, color: T.neutral[500], marginBottom: 24 }}>Esta acción no se puede deshacer.</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setConfirmDel(null)} style={{
                flex: 1, padding: 13, borderRadius: 12, border: 'none',
                background: T.neutral[100], color: T.neutral[700],
                fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              }}>Cancelar</button>
              <button onClick={() => handleDelete(confirmDel)} style={{
                flex: 1, padding: 13, borderRadius: 12, border: 'none',
                background: T.bad, color: '#fff',
                fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              }}>Eliminar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const monthBtnStyle = {
  background: 'none', border: 'none', padding: '8px 12px', cursor: 'pointer',
}

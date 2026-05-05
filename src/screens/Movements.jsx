import { useEffect, useMemo, useState } from 'react'
import { T } from '../tokens'
import { fmtCOP, fmtDate, currentMonth, fmtMonthLabel } from '../utils/format'
import { Card, Chip, BranchChip, CatIcon } from '../components/Atoms'
import { ScreenHeader } from '../components/Nav'
import { deleteMovement, getData } from '../db'
import { watchAllSales } from '../sales'
import { SaleDetailModal } from './Ventas'

function allCatLabel(cat, incomeCats, expenseCats) {
  if (cat === 'ventas_cajera') return 'Venta cajera'
  if (cat === 'venta_credito') return 'Venta a crédito'
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
  const [originFilter, setOriginFilter] = useState('all')  // all | manual | cashier
  const [month, setMonth] = useState(currentMonth())
  const [confirmDel, setConfirmDel] = useState(null)
  const [openSale, setOpenSale] = useState(null)

  // Ventas en tiempo real (modelo devengado)
  const [sales, setSales] = useState([])
  useEffect(() => watchAllSales(setSales), [])

  const branches = getData().branches || []

  // ── Convertir ventas en items unificados ──
  const saleItems = useMemo(
    () => sales
      .filter(s => (s.status || 'active') !== 'deleted')
      .map(s => ({
        id: 'sale_' + s.id,
        source: 'sale',
        type: 'income',
        date: s.date,
        amount: Number(s.total) || 0,
        branch: s.branchId,
        cat: s.paymentMethod === 'deuda' ? 'venta_credito' : 'ventas_cajera',
        cashierName: s.cashierName,
        paymentMethod: s.paymentMethod,
        debtorName: s.debtorName,
        itemsCount: s.items?.length || 0,
        flagged: s.status === 'flagged',
        edited: !!s.editedAt,
        raw: s,
        createdMs: s.createdAt?.toMillis?.() ?? new Date(s.date + 'T12:00:00').getTime(),
      })),
    [sales]
  )

  const movementItems = useMemo(
    () => movements.map(m => ({
      id: 'mov_' + m.id,
      source: 'manual',
      type: m.type,
      date: m.date,
      amount: Number(m.amount) || 0,
      branch: m.branch,
      cat: m.cat,
      group: m.group,
      note: m.note,
      origin: m.origin,           // 'caja' si vino de gasto cajera aprobado
      cashierName: m.cashierName,
      raw: m,
      createdMs: new Date(m.date + 'T12:00:00').getTime(),
    })),
    [movements]
  )

  // ── Lista unificada con filtros ──
  const filtered = useMemo(() => {
    const all = [...movementItems, ...saleItems]
    return all.filter(it => {
      if (!it.date?.startsWith(month)) return false
      // Branch
      if (filter !== 'all') {
        if (it.source === 'sale') {
          if (String(it.branch) !== String(filter)) return false
        } else {
          if (it.branch !== filter && it.branch !== 'both') return false
        }
      }
      // Type
      if (typeFilter !== 'all' && it.type !== typeFilter) return false
      // Origin
      if (originFilter === 'manual' && it.source !== 'manual') return false
      if (originFilter === 'cashier' && it.source !== 'sale') return false
      return true
    }).sort((a, b) => {
      // Más reciente primero
      const dateCompare = b.date.localeCompare(a.date)
      if (dateCompare !== 0) return dateCompare
      return b.createdMs - a.createdMs
    })
  }, [movementItems, saleItems, month, filter, typeFilter, originFilter])

  const totalInc = filtered.filter(x => x.type === 'income').reduce((s, x) => s + x.amount, 0)
  const totalExp = filtered.filter(x => x.type === 'expense').reduce((s, x) => s + x.amount, 0)

  // Agrupar por fecha
  const byDate = {}
  filtered.forEach(x => {
    if (!byDate[x.date]) byDate[x.date] = []
    byDate[x.date].push(x)
  })
  const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a))

  function changeMonth(delta) {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setMonth(d.toISOString().slice(0, 7))
  }

  function handleDelete(id) {
    deleteMovement(id)
    setConfirmDel(null)
    onRefresh?.()
  }

  const isPrevMonth = () => true
  const isNextMonth = month >= currentMonth()
  const net = totalInc - totalExp

  return (
    <div style={{ paddingBottom: 110 }}>
      <ScreenHeader title="Movimientos" />

      {/* Card hero: balance del mes con navegador integrado */}
      <div style={{ padding: '0 16px 12px' }}>
        <Card padding={0} style={{
          background: `linear-gradient(145deg, ${T.neutral[800]} 0%, ${T.neutral[900]} 100%)`,
          color: '#fff',
          overflow: 'hidden',
        }}>
          {/* Navegador de mes */}
          <div style={{
            padding: '12px 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}>
            <button onClick={() => changeMonth(-1)} style={navBtnStyle()}>
              <svg width="8" height="14" viewBox="0 0 8 14"><path d="M6 1 L1 7 L6 13" stroke={T.copper[300]} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <div style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: 0.2, textTransform: 'capitalize' }}>
              {fmtMonthLabel(month)}
            </div>
            <button onClick={() => changeMonth(1)} disabled={isNextMonth} style={{ ...navBtnStyle(), opacity: isNextMonth ? 0.3 : 1 }}>
              <svg width="8" height="14" viewBox="0 0 8 14"><path d="M2 1 L7 7 L2 13" stroke={T.copper[300]} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </div>

          {/* Hero: neto en grande */}
          <div style={{ padding: '18px 20px 14px' }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, color: T.copper[300], textTransform: 'uppercase' }}>
              Balance del mes
            </div>
            <div style={{
              fontSize: 36, fontWeight: 800, letterSpacing: -1.2, marginTop: 4,
              fontVariantNumeric: 'tabular-nums',
              color: net >= 0 ? '#fff' : '#FFB4A8',
            }}>
              {net >= 0 ? '+ ' : '− '}{fmtCOP(Math.abs(net))}
            </div>
          </div>

          {/* Desglose ingresos / gastos */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr',
            borderTop: '1px solid rgba(255,255,255,0.08)',
          }}>
            <div style={{ padding: '14px 16px', borderRight: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase' }}>
                Ingresos
              </div>
              <div style={{ fontSize: 17, fontWeight: 800, marginTop: 4, color: '#9DCC9C', fontVariantNumeric: 'tabular-nums', letterSpacing: -0.4 }}>
                {fmtCOP(totalInc)}
              </div>
            </div>
            <div style={{ padding: '14px 16px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase' }}>
                Gastos
              </div>
              <div style={{ fontSize: 17, fontWeight: 800, marginTop: 4, color: T.copper[300], fontVariantNumeric: 'tabular-nums', letterSpacing: -0.4 }}>
                {fmtCOP(totalExp)}
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Toolbar de filtros (1 fila compacta) */}
      <div style={{ padding: '0 16px 14px' }}>
        <div style={{
          background: '#fff',
          border: `1px solid ${T.neutral[100]}`,
          borderRadius: 14,
          padding: '10px 12px',
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        }}>
          <CompactSelect
            value={typeFilter}
            onChange={setTypeFilter}
            options={[
              { value: 'all', label: 'Todo' },
              { value: 'income', label: 'Ingresos' },
              { value: 'expense', label: 'Gastos' },
            ]}
          />
          <CompactSelect
            value={originFilter}
            onChange={setOriginFilter}
            options={[
              { value: 'all', label: 'Todo origen' },
              { value: 'manual', label: '📝 Manuales' },
              { value: 'cashier', label: '🛒 Cajeras' },
            ]}
          />
          <CompactSelect
            value={String(filter)}
            onChange={v => setFilter(v === 'all' ? 'all' : Number(v))}
            options={[
              { value: 'all', label: 'Todas las panaderías' },
              ...branches.map(br => ({ value: String(br.id), label: br.name })),
            ]}
          />
        </div>
      </div>

      {dates.length === 0 && (
        <div style={{ padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 36 }}>📋</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: T.neutral[600], marginTop: 12 }}>Sin movimientos</div>
          <div style={{ fontSize: 13, color: T.neutral[400], marginTop: 6 }}>
            Cuando registres ingresos/gastos o las cajeras hagan ventas aparecerán aquí.
          </div>
        </div>
      )}

      {dates.map(date => {
        const items = byDate[date]
        const dayInc = items.filter(x => x.type === 'income').reduce((s, x) => s + x.amount, 0)
        const dayExp = items.filter(x => x.type === 'expense').reduce((s, x) => s + x.amount, 0)
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
                {items.map((it, i) => (
                  <ItemRow
                    key={it.id}
                    item={it}
                    isLast={i === items.length - 1}
                    incomeCats={incomeCats}
                    expenseCats={expenseCats}
                    onClickSale={() => setOpenSale(it.raw)}
                    onDeleteMovement={() => setConfirmDel(it.raw.id)}
                  />
                ))}
              </Card>
            </div>
          </div>
        )
      })}

      {/* Confirmar borrado de movement manual */}
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

      {/* Modal de venta (reutiliza el de Ventas.jsx) */}
      {openSale && (
        <SaleDetailModal
          sale={openSale}
          branches={branches}
          onClose={() => setOpenSale(null)}
          onUpdated={() => setOpenSale(null)}
        />
      )}
    </div>
  )

  function ItemRow({ item, isLast, incomeCats, expenseCats, onClickSale, onDeleteMovement }) {
    const it = item
    const isSale = it.source === 'sale'
    const cajaOrigin = it.origin === 'caja'  // gasto de caja aprobado

    // Subtítulo según tipo
    let subtitle
    if (isSale) {
      if (it.paymentMethod === 'deuda') {
        subtitle = `Crédito a ${it.debtorName || 'sin nombre'}`
      } else {
        subtitle = `${it.itemsCount} ${it.itemsCount === 1 ? 'producto' : 'productos'}`
      }
    } else if (cajaOrigin) {
      subtitle = `Caja${it.cashierName ? ` · ${it.cashierName}` : ''}`
    } else {
      subtitle = it.note || allCatLabel(it.cat, incomeCats, expenseCats)
    }

    // Icono / chip de origen
    const originBadge = isSale
      ? { label: it.paymentMethod === 'deuda' ? '🤝' : '🛒', tip: 'Cajera' }
      : cajaOrigin
        ? { label: '🏪', tip: 'Caja' }
        : { label: '📝', tip: 'Manual' }

    return (
      <div
        onClick={isSale ? onClickSale : undefined}
        onContextMenu={!isSale ? (e => { e.preventDefault(); onDeleteMovement() }) : undefined}
        style={{
          padding: '13px 16px',
          display: 'flex', alignItems: 'center', gap: 12,
          borderBottom: isLast ? 'none' : `0.5px solid ${T.neutral[100]}`,
          cursor: isSale ? 'pointer' : 'default',
        }}
      >
        <div style={{
          width: 36, height: 36, borderRadius: 10, flexShrink: 0,
          background: it.type === 'income' ? `${T.ok}18` : T.copper[50],
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18,
          position: 'relative',
        }}>
          {isSale
            ? originBadge.label
            : <CatIcon cat={it.cat} size={18} color={it.type === 'income' ? T.ok : T.copper[600]}/>
          }
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14, fontWeight: 600, color: T.neutral[800],
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            {isSale && it.cashierName ? it.cashierName : allCatLabel(it.cat, incomeCats, expenseCats)}
            {isSale && it.flagged && (
              <span style={{
                fontSize: 9.5, fontWeight: 700, color: T.warn,
                background: '#FFF7E6', padding: '1px 6px', borderRadius: 999,
                letterSpacing: 0.4, textTransform: 'uppercase',
              }}>Marcada</span>
            )}
            {isSale && it.edited && (
              <span style={{
                fontSize: 9.5, fontWeight: 700, color: T.copper[700],
                background: T.copper[50], padding: '1px 6px', borderRadius: 999,
                letterSpacing: 0.4, textTransform: 'uppercase',
              }}>Editada</span>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: T.neutral[500], marginTop: 2, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <BranchChip branch={it.branch} size="sm"/>
            <span style={{
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              minWidth: 0,
            }}>
              {subtitle}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <div style={{
            fontSize: 15, fontWeight: 700,
            color: it.type === 'income' ? T.ok : T.neutral[800],
            fontVariantNumeric: 'tabular-nums', textAlign: 'right',
          }}>
            {it.type === 'income' ? '+' : '−'}{fmtCOP(it.amount)}
          </div>
          {!isSale ? (
            <button
              onClick={onDeleteMovement}
              style={{
                background: T.neutral[100], border: 'none', borderRadius: 8,
                width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', flexShrink: 0,
              }}
            >
              <svg width="15" height="15" viewBox="0 0 20 20" fill="none">
                <path d="M4 6h12M8 6V4h4v2M7 9v6M13 9v6M5 6l1 11h8l1-11" stroke={T.neutral[400]} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          ) : (
            <svg width="8" height="14" viewBox="0 0 7 12" style={{ flexShrink: 0 }}>
              <path d="M1 1 L6 6 L1 11" stroke={T.neutral[300]} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </div>
      </div>
    )
  }
}

const monthBtnStyle = {
  background: 'none', border: 'none', padding: '8px 12px', cursor: 'pointer',
}

function navBtnStyle() {
  return {
    width: 32, height: 32, borderRadius: 999,
    background: 'rgba(255,255,255,0.08)', border: 'none',
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'background 0.15s',
  }
}

function CompactSelect({ value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        padding: '7px 28px 7px 12px', borderRadius: 10,
        border: `1px solid ${T.neutral[200]}`,
        fontSize: 12.5, fontFamily: 'inherit', fontWeight: 600,
        background: '#fff', color: T.neutral[800],
        outline: 'none', cursor: 'pointer',
        appearance: 'none', WebkitAppearance: 'none',
        backgroundImage: `url("data:image/svg+xml;charset=US-ASCII,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M3 5L6 8L9 5' stroke='%237A7163' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 8px center',
        backgroundSize: '12px',
      }}
    >
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

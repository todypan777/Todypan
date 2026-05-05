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

  return (
    <div style={{ paddingBottom: 110 }}>
      <ScreenHeader title="Movimientos" subtitle={fmtMonthLabel(month)} />

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

      {/* Filtros */}
      <div style={{ padding: '4px 20px 8px', display: 'flex', gap: 8, overflowX: 'auto' }}>
        <Chip label="Todo" active={typeFilter === 'all'} onClick={() => setTypeFilter('all')} />
        <Chip label="Ingresos" active={typeFilter === 'income'} onClick={() => setTypeFilter('income')} />
        <Chip label="Gastos" active={typeFilter === 'expense'} onClick={() => setTypeFilter('expense')} />
      </div>
      <div style={{ padding: '0 20px 8px', display: 'flex', gap: 8, overflowX: 'auto' }}>
        <Chip label="Todo origen" active={originFilter === 'all'} onClick={() => setOriginFilter('all')} />
        <Chip label="📝 Manuales" active={originFilter === 'manual'} onClick={() => setOriginFilter('manual')} />
        <Chip label="🛒 Cajeras" active={originFilter === 'cashier'} onClick={() => setOriginFilter('cashier')} />
      </div>
      <div style={{ padding: '0 20px 12px', display: 'flex', gap: 8, overflowX: 'auto' }}>
        <Chip label="Ambas" active={filter === 'all'} onClick={() => setFilter('all')} />
        {branches.map(br => (
          <Chip key={br.id} label={br.name} active={filter === br.id} onClick={() => setFilter(br.id)} />
        ))}
      </div>

      {/* Resumen */}
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

import { useEffect, useMemo, useState } from 'react'
import { T } from '../tokens'
import { fmtCOP, fmtDate } from '../utils/format'
import { Card, Chip } from '../components/Atoms'
import { ScreenHeader } from '../components/Nav'
import { useIsDesktop } from '../context/DesktopCtx'
import { watchAllSales } from '../sales'
import { getData } from '../db'
import { watchAllUsers } from '../users'

const METHODS = [
  { id: 'efectivo',  label: 'Efectivo',  icon: '💵' },
  { id: 'nequi',     label: 'NEQUI',     icon: '📱' },
  { id: 'daviplata', label: 'DAVIPLATA', icon: '📱' },
  { id: 'deuda',     label: 'Deuda',     icon: '🤝' },
]

const STATUSES = [
  { id: 'active',  label: 'Activas',     color: T.ok },
  { id: 'flagged', label: 'Marcadas',    color: T.warn },
  { id: 'deleted', label: 'Eliminadas',  color: T.bad },
]

export default function Ventas({ onBack }) {
  const isDesktop = useIsDesktop()
  const [sales, setSales] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState(null)

  // Filtros
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
  const monthStart = today.slice(0, 8) + '01'
  const [from, setFrom] = useState(monthStart)
  const [to, setTo] = useState(today)
  const [cashierUid, setCashierUid] = useState('all')
  const [branchId, setBranchId] = useState('all')
  const [methodFilter, setMethodFilter] = useState(null) // null = todos
  const [statusFilter, setStatusFilter] = useState('active')

  useEffect(() => {
    const unsub = watchAllSales(list => {
      setSales(list)
      setLoading(false)
    })
    return unsub
  }, [])

  useEffect(() => watchAllUsers(setUsers), [])

  const branches = getData().branches || []
  const cashiers = useMemo(
    () => users.filter(u => u.role === 'cashier'),
    [users]
  )

  const filtered = useMemo(() => {
    let list = sales.filter(s => {
      if (s.date < from || s.date > to) return false
      if (cashierUid !== 'all' && s.cashierUid !== cashierUid) return false
      if (branchId !== 'all' && String(s.branchId) !== String(branchId)) return false
      if (methodFilter && s.paymentMethod !== methodFilter) return false
      if (statusFilter && (s.status || 'active') !== statusFilter) return false
      return true
    })
    list.sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() ?? 0
      const tb = b.createdAt?.toMillis?.() ?? 0
      return tb - ta
    })
    return list
  }, [sales, from, to, cashierUid, branchId, methodFilter, statusFilter])

  const totalShown = filtered.reduce((s, x) => s + (Number(x.total) || 0), 0)

  return (
    <div style={{ paddingBottom: isDesktop ? 0 : 110 }}>
      <ScreenHeader
        title="Ventas"
        subtitle={loading
          ? 'Cargando...'
          : `${filtered.length} ${filtered.length === 1 ? 'venta' : 'ventas'} · ${fmtCOP(totalShown)}`
        }
      />

      {/* Filtros (toolbar compacta) */}
      <FilterToolbar
        from={from} to={to} setFrom={setFrom} setTo={setTo}
        today={today} monthStart={monthStart}
        cashierUid={cashierUid} setCashierUid={setCashierUid} cashiers={cashiers}
        branchId={branchId} setBranchId={setBranchId} branches={branches}
        methodFilter={methodFilter} setMethodFilter={setMethodFilter}
        statusFilter={statusFilter} setStatusFilter={setStatusFilter}
      />

      {/* Lista de ventas */}
      <div style={{ padding: '0 16px' }}>
        {loading ? (
          <Card>
            <div style={{ padding: '24px 0', textAlign: 'center', color: T.neutral[500], fontSize: 13 }}>
              Cargando ventas...
            </div>
          </Card>
        ) : filtered.length === 0 ? (
          <Card>
            <div style={{ padding: '40px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>📭</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: T.neutral[700] }}>
                Sin ventas con estos filtros
              </div>
              <div style={{ fontSize: 12, color: T.neutral[500], marginTop: 4 }}>
                Cambia el rango o método para ver más resultados.
              </div>
            </div>
          </Card>
        ) : isDesktop ? (
          <SalesTable sales={filtered} branches={branches} onClick={setDetail} />
        ) : (
          <SalesList sales={filtered} branches={branches} onClick={setDetail} />
        )}
      </div>

      {detail && (
        <SaleDetailModal
          sale={detail}
          branches={branches}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Toolbar de filtros (compacta, una sola fila en desktop)
// ──────────────────────────────────────────────────────────────
function FilterToolbar({
  from, to, setFrom, setTo, today, monthStart,
  cashierUid, setCashierUid, cashiers,
  branchId, setBranchId, branches,
  methodFilter, setMethodFilter,
  statusFilter, setStatusFilter,
}) {
  const isDesktop = useIsDesktop()
  const [moreOpen, setMoreOpen] = useState(false)

  // Detectar shortcut activo
  const isToday = from === today && to === today
  const isThisMonth = from === monthStart && to === today

  // Resumen de filtros activos (chip con count)
  const activeCount =
    (cashierUid !== 'all' ? 1 : 0) +
    (branchId !== 'all' ? 1 : 0) +
    (methodFilter ? 1 : 0)

  return (
    <div style={{ padding: '0 16px 12px' }}>
      <div style={{
        background: '#fff',
        border: `1px solid ${T.neutral[100]}`,
        borderRadius: 16,
        padding: '10px 12px',
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      }}>
        {/* Date range */}
        <DateInput value={from} onChange={setFrom} />
        <span style={{ color: T.neutral[400], fontSize: 13 }}>→</span>
        <DateInput value={to} onChange={setTo} />

        {/* Shortcuts */}
        <button
          onClick={() => { setFrom(today); setTo(today) }}
          style={shortcutBtn(isToday)}
        >Hoy</button>
        <button
          onClick={() => { setFrom(monthStart); setTo(today) }}
          style={shortcutBtn(isThisMonth)}
        >Mes</button>

        <div style={{ flex: 1, minWidth: 8 }}/>

        {/* Estado siempre visible */}
        <CompactSelect
          value={statusFilter}
          onChange={setStatusFilter}
          options={STATUSES.map(s => ({ value: s.id, label: s.label }))}
        />

        {/* Botón "Más filtros" */}
        <button
          onClick={() => setMoreOpen(v => !v)}
          style={{
            padding: '7px 12px', borderRadius: 10,
            background: activeCount > 0 ? T.copper[50] : T.neutral[100],
            color: activeCount > 0 ? T.copper[700] : T.neutral[700],
            border: activeCount > 0 ? `1px solid ${T.copper[200]}` : 'none',
            cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 12.5, fontWeight: 700,
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 3 H10 M3 6 H9 M4 9 H8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
          Filtros{activeCount > 0 ? ` · ${activeCount}` : ''}
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ transform: moreOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
            <path d="M2 3.5 L5 6.5 L8 3.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      {/* Panel expandible con filtros adicionales */}
      {moreOpen && (
        <div style={{
          marginTop: 8,
          background: '#fff',
          border: `1px solid ${T.neutral[100]}`,
          borderRadius: 16,
          padding: '12px 14px',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          {/* Cajera + Panadería en fila */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <FilterRow label="Cajera">
              <CompactSelect
                value={cashierUid}
                onChange={setCashierUid}
                options={[
                  { value: 'all', label: 'Todas' },
                  ...cashiers.map(c => ({
                    value: c.uid,
                    label: `${c.nombre} ${c.apellido}`.trim(),
                  })),
                ]}
              />
            </FilterRow>
            <FilterRow label="Panadería">
              <CompactSelect
                value={branchId}
                onChange={setBranchId}
                options={[
                  { value: 'all', label: 'Todas' },
                  ...branches.map(b => ({ value: String(b.id), label: b.name })),
                ]}
              />
            </FilterRow>
          </div>

          {/* Método como chips */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={filterLabelStyle()}>Método</span>
            <Chip label="Todos" active={!methodFilter} onClick={() => setMethodFilter(null)} />
            {METHODS.map(m => (
              <Chip
                key={m.id}
                label={`${m.icon} ${m.label}`}
                active={methodFilter === m.id}
                onClick={() => setMethodFilter(methodFilter === m.id ? null : m.id)}
              />
            ))}
          </div>

          {/* Botón limpiar */}
          {activeCount > 0 && (
            <button
              onClick={() => { setCashierUid('all'); setBranchId('all'); setMethodFilter(null) }}
              style={{
                alignSelf: 'flex-end',
                padding: '6px 12px', borderRadius: 10,
                background: 'transparent', color: T.neutral[600],
                border: `1px solid ${T.neutral[200]}`,
                cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 11.5, fontWeight: 700,
              }}
            >
              Limpiar filtros
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function shortcutBtn(active) {
  return {
    padding: '6px 12px', borderRadius: 999,
    background: active ? T.copper[500] : T.neutral[100],
    color: active ? '#fff' : T.neutral[700],
    border: 'none', cursor: 'pointer', fontFamily: 'inherit',
    fontSize: 12, fontWeight: 700,
  }
}

function FilterRow({ label, children }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={filterLabelStyle()}>{label}</span>
      {children}
    </label>
  )
}

function filterLabelStyle() {
  return {
    fontSize: 11, fontWeight: 700, color: T.neutral[500],
    letterSpacing: 0.4, textTransform: 'uppercase',
  }
}

function CompactSelect({ value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        padding: '6px 28px 6px 10px', borderRadius: 10,
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

// ──────────────────────────────────────────────────────────────
// Tabla desktop
// ──────────────────────────────────────────────────────────────
function SalesTable({ sales, branches, onClick }) {
  const cols = '90px 64px 1.6fr 1fr 60px 110px 90px'
  return (
    <Card padding={0} style={{ overflow: 'hidden' }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: cols,
        padding: '10px 14px',
        background: T.neutral[25],
        borderBottom: `1px solid ${T.neutral[100]}`,
        fontSize: 11, fontWeight: 700, color: T.neutral[400],
        textTransform: 'uppercase', letterSpacing: 0.5,
        gap: 10,
      }}>
        <div>Fecha</div>
        <div>Hora</div>
        <div>Registró</div>
        <div>Panadería</div>
        <div style={{ textAlign: 'center' }}>Pago</div>
        <div style={{ textAlign: 'right' }}>Total</div>
        <div style={{ textAlign: 'right' }}>Estado</div>
      </div>
      {sales.map((s, i) => {
        const branch = branches.find(b => String(b.id) === String(s.branchId))
        return (
          <button
            key={s.id}
            onClick={() => onClick(s)}
            style={{
              display: 'grid',
              gridTemplateColumns: cols,
              padding: '12px 14px', width: '100%',
              background: 'transparent', border: 'none',
              borderBottom: i < sales.length - 1 ? `0.5px solid ${T.neutral[100]}` : 'none',
              cursor: 'pointer', fontFamily: 'inherit',
              alignItems: 'center', textAlign: 'left', gap: 10,
            }}
            onMouseEnter={e => e.currentTarget.style.background = T.neutral[25]}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <div style={{ fontSize: 12, color: T.neutral[700], fontWeight: 600 }}>
              {fmtDate(s.date)}
            </div>
            <div style={{ fontSize: 12, color: T.neutral[500], fontVariantNumeric: 'tabular-nums' }}>
              {timeOf(s)}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <CashierAvatar name={s.cashierName} />
              <div style={{
                fontSize: 13, color: T.neutral[900], fontWeight: 700,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {s.cashierName}
              </div>
            </div>
            <div style={{
              fontSize: 12, color: T.neutral[600],
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {branch?.name || '—'}
            </div>
            <div style={{ fontSize: 16, textAlign: 'center' }} title={s.paymentMethod}>
              {methodIcon(s.paymentMethod)}
            </div>
            <div style={{
              fontSize: 13.5, fontWeight: 800, color: T.neutral[900],
              fontVariantNumeric: 'tabular-nums', textAlign: 'right',
            }}>
              {fmtCOP(s.total)}
            </div>
            <div style={{ textAlign: 'right' }}>
              <StatusBadge status={s.status || 'active'} small />
            </div>
          </button>
        )
      })}
    </Card>
  )
}

function CashierAvatar({ name }) {
  const initials = (name || '?').split(' ').map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
  return (
    <div style={{
      width: 26, height: 26, borderRadius: 999, flexShrink: 0,
      background: T.copper[100], color: T.copper[700],
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 10, fontWeight: 800, letterSpacing: 0.3,
    }}>
      {initials}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Lista móvil
// ──────────────────────────────────────────────────────────────
function SalesList({ sales, branches, onClick }) {
  return (
    <Card padding={0} style={{ overflow: 'hidden' }}>
      {sales.map((s, i) => {
        const branch = branches.find(b => String(b.id) === String(s.branchId))
        return (
          <button
            key={s.id}
            onClick={() => onClick(s)}
            style={{
              width: '100%', padding: '12px 14px',
              background: 'transparent', border: 'none',
              borderBottom: i < sales.length - 1 ? `0.5px solid ${T.neutral[100]}` : 'none',
              cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
              display: 'flex', alignItems: 'center', gap: 12,
            }}
          >
            <CashierAvatar name={s.cashierName} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 14, fontWeight: 700, color: T.neutral[900],
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                {s.cashierName}
                <span style={{ fontSize: 14 }}>{methodIcon(s.paymentMethod)}</span>
              </div>
              <div style={{ fontSize: 11.5, color: T.neutral[500], marginTop: 2 }}>
                {fmtDate(s.date)} · {timeOf(s)} · {branch?.name || '—'}
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: T.neutral[900], fontVariantNumeric: 'tabular-nums' }}>
                {fmtCOP(s.total)}
              </div>
              <div style={{ marginTop: 4 }}>
                <StatusBadge status={s.status || 'active'} small />
              </div>
            </div>
          </button>
        )
      })}
    </Card>
  )
}

// ──────────────────────────────────────────────────────────────
// Modal de detalle
// ──────────────────────────────────────────────────────────────
function SaleDetailModal({ sale, branches, onClose }) {
  const branch = branches.find(b => String(b.id) === String(sale.branchId))
  const time = sale.createdAt?.toDate?.()
  const timeStr = time
    ? time.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false })
    : '—'

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 90,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 480,
        background: '#fff', borderRadius: 22,
        boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
        animation: 'fadeScaleIn 0.2s ease',
        maxHeight: '92vh', overflowY: 'auto',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 22px 14px', borderBottom: `1px solid ${T.neutral[100]}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3 }}>
                Venta del {fmtDate(sale.date)}
              </div>
              <div style={{ fontSize: 12.5, color: T.neutral[500], marginTop: 2 }}>
                {timeStr} · {sale.cashierName} · {branch?.name || '—'}
              </div>
            </div>
            <StatusBadge status={sale.status || 'active'} />
          </div>
        </div>

        {/* Items */}
        <div style={{ padding: '14px 22px' }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: T.neutral[500], letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 8 }}>
            Productos ({sale.items?.length || 0})
          </div>
          <div style={{
            background: T.neutral[50], borderRadius: 12,
            padding: '10px 12px', maxHeight: 240, overflowY: 'auto',
          }}>
            {sale.items?.map((it, i) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', gap: 8,
                padding: '6px 0',
                borderBottom: i < (sale.items.length - 1) ? `0.5px solid ${T.neutral[100]}` : 'none',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13, color: T.neutral[800], fontWeight: 500 }}>
                    {it.qty}× {it.name}
                  </span>
                  <span style={{ fontSize: 11, color: T.neutral[500], marginLeft: 6 }}>
                    @ {fmtCOP(it.unitPrice)}
                  </span>
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.neutral[800], fontVariantNumeric: 'tabular-nums' }}>
                  {fmtCOP(it.subtotal)}
                </span>
              </div>
            ))}
          </div>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
            marginTop: 10, padding: '0 4px',
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: T.neutral[700] }}>Total</span>
            <span style={{ fontSize: 22, fontWeight: 800, color: T.neutral[900], fontVariantNumeric: 'tabular-nums', letterSpacing: -0.4 }}>
              {fmtCOP(sale.total)}
            </span>
          </div>
        </div>

        {/* Pago */}
        <div style={{ padding: '0 22px 14px' }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: T.neutral[500], letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 8 }}>
            Pago
          </div>
          <div style={{
            background: T.copper[50], border: `1px solid ${T.copper[100]}`,
            borderRadius: 12, padding: '12px 14px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 22 }}>{methodIcon(sale.paymentMethod)}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.copper[700], textTransform: 'capitalize' }}>
                  {sale.paymentMethod}
                </div>
                {sale.paymentMethod === 'efectivo' && sale.cashReceived !== undefined && (
                  <div style={{ fontSize: 12, color: T.neutral[600], marginTop: 2 }}>
                    Recibió {fmtCOP(sale.cashReceived)} · vuelto {fmtCOP(sale.cashReceived - sale.total)}
                  </div>
                )}
                {sale.paymentMethod === 'deuda' && sale.debtorName && (
                  <div style={{ fontSize: 12, color: T.neutral[600], marginTop: 2 }}>
                    Deudor: <b>{sale.debtorName}</b>
                  </div>
                )}
              </div>
            </div>
            {sale.photoUrl && (
              <a
                href={sale.photoUrl} target="_blank" rel="noreferrer"
                style={{ display: 'block', marginTop: 10, borderRadius: 10, overflow: 'hidden' }}
              >
                <img
                  src={sale.photoUrl}
                  alt="Comprobante"
                  style={{
                    display: 'block', width: '100%', maxHeight: 220,
                    objectFit: 'contain', background: T.neutral[900],
                    borderRadius: 10,
                  }}
                />
              </a>
            )}
          </div>
        </div>

        {/* Notas */}
        {sale.notes?.length > 0 && (
          <div style={{ padding: '0 22px 14px' }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: T.warn, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 8 }}>
              Notas / Reportes
            </div>
            <div style={{
              background: '#FFF7E6', border: `1px solid #F4E0BC`,
              borderRadius: 12, padding: '10px 12px',
            }}>
              {sale.notes.map((n, i) => (
                <div key={i} style={{
                  padding: '6px 0',
                  borderBottom: i < (sale.notes.length - 1) ? `0.5px solid #F4E0BC` : 'none',
                  fontSize: 12.5, color: T.neutral[700],
                }}>
                  <div style={{ fontWeight: 700, color: T.warn, marginBottom: 2 }}>
                    {n.byName || 'Cajera'}
                    {n.at && <span style={{ fontWeight: 400, color: T.neutral[500], marginLeft: 6 }}>
                      · {new Date(n.at).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>}
                  </div>
                  <div style={{ fontStyle: 'italic' }}>"{n.message}"</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Cerrar */}
        <div style={{ padding: '8px 22px 22px' }}>
          <button onClick={onClose} style={{
            width: '100%', padding: '12px', borderRadius: 12,
            background: T.neutral[100], color: T.neutral[700],
            border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 14, fontWeight: 700,
          }}>
            Cerrar
          </button>
          <div style={{ fontSize: 11, color: T.neutral[400], textAlign: 'center', marginTop: 10 }}>
            Para resolver una venta marcada, ve a la pestaña <b>Pendientes</b>.
          </div>
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────
function timeOf(sale) {
  const t = sale.createdAt?.toDate?.()
  if (!t) return '—'
  return t.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function methodIcon(m) {
  return { efectivo: '💵', nequi: '📱', daviplata: '📱', deuda: '🤝' }[m] || '?'
}

function StatusBadge({ status, small }) {
  const map = {
    active:  { label: 'Activa',     color: T.ok, bg: '#E8F4E8' },
    flagged: { label: 'Marcada',    color: T.warn, bg: '#FFF7E6' },
    deleted: { label: 'Eliminada',  color: T.bad, bg: '#FBE9E5' },
  }
  const s = map[status] || map.active
  return (
    <span style={{
      fontSize: small ? 9.5 : 10.5, fontWeight: 700, color: s.color, background: s.bg,
      padding: small ? '2px 6px' : '3px 8px', borderRadius: 999,
      letterSpacing: 0.4, textTransform: 'uppercase', whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  )
}

function DateInput({ value, onChange }) {
  return (
    <input
      type="date"
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        padding: '6px 10px', borderRadius: 10,
        border: `1px solid ${T.neutral[200]}`,
        fontSize: 13, fontFamily: 'inherit',
        background: '#fff', color: T.neutral[800],
        outline: 'none',
      }}
    />
  )
}

function SelectFilter({ label, value, onChange, options }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: T.neutral[500], letterSpacing: 0.4, textTransform: 'uppercase' }}>
        {label}
      </span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          padding: '6px 10px', borderRadius: 10,
          border: `1px solid ${T.neutral[200]}`,
          fontSize: 13, fontFamily: 'inherit',
          background: '#fff', color: T.neutral[800],
          outline: 'none', cursor: 'pointer',
        }}
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  )
}

function miniBtn() {
  return {
    padding: '5px 10px', borderRadius: 999,
    background: T.neutral[100], color: T.neutral[700],
    border: 'none', cursor: 'pointer', fontFamily: 'inherit',
    fontSize: 11.5, fontWeight: 700,
  }
}

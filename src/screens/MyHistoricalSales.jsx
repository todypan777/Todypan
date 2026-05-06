import { useEffect, useMemo, useState } from 'react'
import { T } from '../tokens'
import { watchCashierSalesByDate } from '../sales'

// ──────────────────────────────────────────────────────────────
// Pantalla: "Mis ventas" para cajera (Fase 9, alineada a D6 + D21)
//
// - Default: ventas de hoy
// - Selector de fecha para días anteriores
// - Read-only: solo se ve qué se vendió, NO los montos (D21)
// - Botón "Reportar problema" abre ReportSaleModal (mismo del home)
//   que solo deja nota — D6.
//
// Antifraude D21 aplica:
//  - No se muestra total por venta
//  - No se muestra unitPrice ni subtotal por item
//  - No se muestra suma agregada del día
//  - SI se muestra el conteo "N ventas" (es número, no monto)
// ──────────────────────────────────────────────────────────────

const METHOD_INFO = {
  efectivo:  { icon: '💵', label: 'Efectivo' },
  nequi:     { icon: '📱', label: 'NEQUI' },
  daviplata: { icon: '📱', label: 'DAVIPLATA' },
  deuda:     { icon: '🤝', label: 'Deuda' },
}

function bogotaToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
}

function bogotaTimeFromSale(sale) {
  // createdAt (server) preferido; createdAtClient fallback offline.
  const t = sale.createdAt?.toDate?.()
    || (sale.createdAtClient ? new Date(sale.createdAtClient) : null)
  if (!t) return '—'
  return t.toLocaleTimeString('es-CO', {
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: 'America/Bogota',
  })
}

function fmtFecha(dateStr) {
  // dateStr en formato YYYY-MM-DD. Sin construir Date para evitar timezones raros.
  const [y, m, d] = dateStr.split('-').map(Number)
  if (!y || !m || !d) return dateStr
  const dt = new Date(y, m - 1, d)
  return dt.toLocaleDateString('es-CO', {
    weekday: 'long', day: 'numeric', month: 'long',
  })
}

/**
 * Pantalla de historial cajera.
 * `onReport(sale)` lo provee el padre (CashierApp) — al solicitarlo, el
 * padre monta su propio ReportSaleModal encima. Asi evitamos un ciclo
 * de imports entre pantallas.
 */
export default function MyHistoricalSales({ authUser, userDoc, onClose, onReport }) {
  const today = bogotaToday()
  const [date, setDate] = useState(today)
  const [sales, setSales] = useState([])
  const [methodFilter, setMethodFilter] = useState(null)
  // Guardamos solo el id; el sale se deriva del array en vivo para que
  // si llega una nota nueva mientras esta abierto, la UI se actualice.
  const [selectedSaleId, setSelectedSaleId] = useState(null)

  useEffect(() => {
    if (!authUser?.uid || !date) return
    return watchCashierSalesByDate(authUser.uid, date, setSales)
  }, [authUser?.uid, date])

  const filtered = useMemo(() => {
    if (!methodFilter) return sales
    return sales.filter(s => s.paymentMethod === methodFilter)
  }, [sales, methodFilter])

  const selectedSale = useMemo(
    () => selectedSaleId ? sales.find(s => s.id === selectedSaleId) || null : null,
    [sales, selectedSaleId],
  )

  const isToday = date === today

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 60,
      background: T.neutral[50],
      display: 'flex', flexDirection: 'column',
      animation: 'slideUp 0.25s cubic-bezier(0.2,0.9,0.3,1.05)',
    }}>
      {/* Header sticky */}
      <div style={{
        padding: '14px 16px',
        background: '#fff',
        borderBottom: `1px solid ${T.neutral[100]}`,
        display: 'flex', alignItems: 'center', gap: 12,
        flexShrink: 0,
      }}>
        <button
          onClick={onClose}
          style={{
            width: 36, height: 36, borderRadius: 999,
            border: 'none', background: T.neutral[100],
            cursor: 'pointer', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
          aria-label="Volver"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M15 6 L9 12 L15 18" stroke={T.neutral[700]} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 16, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3,
          }}>
            Mis ventas
          </div>
          <div style={{
            fontSize: 11, color: T.neutral[500],
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {userDoc?.nombre} {userDoc?.apellido}
          </div>
        </div>
      </div>

      {/* Selector de fecha */}
      <div style={{
        padding: '14px 16px',
        background: '#fff',
        borderBottom: `1px solid ${T.neutral[100]}`,
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <input
            type="date"
            value={date}
            max={today}
            onChange={e => {
              const v = e.target.value
              if (v) setDate(v)
            }}
            style={{
              flex: 1,
              padding: '11px 14px', borderRadius: 12,
              border: `1.5px solid ${T.neutral[200]}`,
              background: '#fff',
              fontSize: 14.5, color: T.neutral[900],
              fontFamily: 'inherit', outline: 'none',
            }}
          />
          {!isToday && (
            <button
              onClick={() => setDate(today)}
              style={{
                padding: '10px 14px', borderRadius: 12,
                background: T.neutral[100], color: T.neutral[700],
                border: 'none', fontFamily: 'inherit',
                fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              Hoy
            </button>
          )}
        </div>
        <div style={{ fontSize: 12.5, color: T.neutral[600], fontWeight: 600 }}>
          {fmtFecha(date)}
        </div>
      </div>

      {/* Filtros por método */}
      <div style={{
        padding: '12px 16px 8px',
        background: T.neutral[25],
        borderBottom: `1px solid ${T.neutral[100]}`,
        display: 'flex', gap: 7, overflowX: 'auto',
        flexShrink: 0,
      }}>
        <Chip
          label="Todas"
          active={methodFilter === null}
          onClick={() => setMethodFilter(null)}
        />
        {['efectivo', 'nequi', 'daviplata', 'deuda'].map(m => (
          <Chip
            key={m}
            label={`${METHOD_INFO[m].icon} ${METHOD_INFO[m].label}`}
            active={methodFilter === m}
            onClick={() => setMethodFilter(methodFilter === m ? null : m)}
          />
        ))}
      </div>

      {/* Subtítulo (cantidad — D21: sin monto) */}
      <div style={{
        padding: '12px 16px 6px',
        background: T.neutral[25],
        fontSize: 12, fontWeight: 700, color: T.neutral[500],
        letterSpacing: 0.4, textTransform: 'uppercase',
        flexShrink: 0,
      }}>
        {filtered.length} {filtered.length === 1 ? 'venta' : 'ventas'}
      </div>

      {/* Lista */}
      <div style={{
        flex: 1, overflowY: 'auto',
        background: T.neutral[25],
        padding: '0 16px 24px',
      }}>
        {filtered.length === 0 ? (
          <div style={{
            padding: '40px 16px', textAlign: 'center',
            color: T.neutral[400], fontSize: 13,
          }}>
            {sales.length === 0
              ? 'Aún no tienes ventas registradas en esta fecha.'
              : 'No hay ventas con ese método de pago.'}
          </div>
        ) : (
          <div style={{
            background: '#fff', borderRadius: 14,
            overflow: 'hidden',
            border: `1px solid ${T.neutral[100]}`,
          }}>
            {filtered.map((s, i) => (
              <SaleRow
                key={s.id}
                sale={s}
                last={i === filtered.length - 1}
                onClick={() => setSelectedSaleId(s.id)}
              />
            ))}
          </div>
        )}
      </div>

      {selectedSale && (
        <SaleDetailModal
          sale={selectedSale}
          onClose={() => setSelectedSaleId(null)}
          onReport={() => {
            // Cerramos el modal de detalle y delegamos al padre.
            // El padre monta ReportSaleModal sobre esta pantalla.
            const sale = selectedSale
            setSelectedSaleId(null)
            if (onReport) onReport(sale)
          }}
        />
      )}

      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); opacity: 0.9; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Fila de la lista (sin montos — D21)
// ──────────────────────────────────────────────────────────────
function SaleRow({ sale, last, onClick }) {
  const time = bogotaTimeFromSale(sale)
  const info = METHOD_INFO[sale.paymentMethod] || { icon: '?', label: sale.paymentMethod }
  const totalQty = (sale.items || []).reduce((s, it) => s + (Number(it.qty) || 0), 0)
  const firstItem = sale.items?.[0]?.name || 'Sin productos'
  const moreCount = Math.max(0, (sale.items?.length || 0) - 1)

  const isFlagged = sale.status === 'flagged'
  const photoPending = !sale.photoUrl && sale.photoStatus === 'pending'
  const photoFailed = !sale.photoUrl && sale.photoStatus === 'failed'

  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', padding: '13px 14px',
        background: 'transparent', border: 'none',
        borderBottom: last ? 'none' : `0.5px solid ${T.neutral[100]}`,
        cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
        display: 'flex', alignItems: 'center', gap: 12,
      }}
    >
      <div style={{
        width: 38, height: 38, borderRadius: 10,
        background: T.copper[50],
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 18, flexShrink: 0,
      }}>
        {info.icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13.5, fontWeight: 700, color: T.neutral[900],
          marginBottom: 2,
          display: 'flex', alignItems: 'center', gap: 6,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {totalQty}× {firstItem}{moreCount > 0 ? ` +${moreCount}` : ''}
          {photoPending && <span title="Foto pendiente" style={{ fontSize: 11 }}>⏳</span>}
          {photoFailed && <span title="Foto no se pudo subir" style={{ fontSize: 11 }}>⚠</span>}
          {isFlagged && (
            <span style={{
              fontSize: 9.5, fontWeight: 700, color: '#7A5C00',
              background: '#FFF7E6', border: `1px solid #F4E0BC`,
              padding: '1px 6px', borderRadius: 999,
              letterSpacing: 0.3, textTransform: 'uppercase',
            }}>
              Reportada
            </span>
          )}
        </div>
        <div style={{
          fontSize: 11.5, color: T.neutral[500],
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {time} · {info.label}
          {sale.paymentMethod === 'deuda' && sale.debtorName ? ` · ${sale.debtorName}` : ''}
        </div>
      </div>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
        <path d="M5 3 L9 7 L5 11" stroke={T.neutral[400]} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </button>
  )
}

// ──────────────────────────────────────────────────────────────
// Modal: detalle de venta — read-only, SIN montos (D21)
// ──────────────────────────────────────────────────────────────
function SaleDetailModal({ sale, onClose, onReport }) {
  const time = bogotaTimeFromSale(sale)
  const info = METHOD_INFO[sale.paymentMethod] || { icon: '?', label: sale.paymentMethod }
  const isFlagged = sale.status === 'flagged'
  const photoPending = !sale.photoUrl && sale.photoStatus === 'pending'
  const photoFailed = !sale.photoUrl && sale.photoStatus === 'failed'

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 70,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 480,
          background: '#fff',
          borderTopLeftRadius: 22, borderTopRightRadius: 22,
          maxHeight: '92vh', overflowY: 'auto',
          animation: 'slideUp 0.25s cubic-bezier(0.2,0.9,0.3,1.05)',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '18px 20px 12px',
          borderBottom: `1px solid ${T.neutral[100]}`,
          display: 'flex', alignItems: 'flex-start', gap: 12,
        }}>
          <div style={{ fontSize: 32, lineHeight: 1, flexShrink: 0 }}>
            {info.icon}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3 }}>
              {info.label}
            </div>
            <div style={{ fontSize: 12.5, color: T.neutral[500], marginTop: 2 }}>
              Venta de las {time}
            </div>
            {isFlagged && (
              <div style={{
                marginTop: 8,
                display: 'inline-block',
                fontSize: 10.5, fontWeight: 700, color: '#7A5C00',
                background: '#FFF7E6', border: `1px solid #F4E0BC`,
                padding: '3px 9px', borderRadius: 999,
                letterSpacing: 0.4, textTransform: 'uppercase',
              }}>
                Reportada al admin
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              width: 32, height: 32, borderRadius: 999,
              background: T.neutral[100], border: 'none',
              cursor: 'pointer', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            aria-label="Cerrar"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 3 L11 11 M11 3 L3 11" stroke={T.neutral[600]} strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Productos */}
        <div style={{ padding: '14px 20px' }}>
          <div style={{
            fontSize: 11.5, fontWeight: 700, color: T.neutral[500],
            letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 8,
          }}>
            Productos
          </div>
          <div style={{
            background: T.neutral[50], borderRadius: 12,
            padding: '10px 14px',
          }}>
            {(sale.items || []).map((it, i) => (
              <div key={i} style={{
                fontSize: 13.5, color: T.neutral[800],
                padding: '5px 0',
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <span style={{
                  flexShrink: 0, fontWeight: 700, color: T.copper[600],
                  fontVariantNumeric: 'tabular-nums', minWidth: 28,
                }}>
                  {it.qty}×
                </span>
                <span>{it.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Deuda → nombre del deudor */}
        {sale.paymentMethod === 'deuda' && sale.debtorName && (
          <div style={{ padding: '0 20px 14px' }}>
            <div style={{
              fontSize: 11.5, fontWeight: 700, color: T.neutral[500],
              letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 6,
            }}>
              Deudor
            </div>
            <div style={{
              padding: '10px 14px', borderRadius: 12,
              background: '#FFF7E6', border: `1px solid #F4E0BC`,
              fontSize: 13.5, color: T.neutral[900], fontWeight: 600,
            }}>
              {sale.debtorName}
            </div>
          </div>
        )}

        {/* Foto del comprobante */}
        {(sale.paymentMethod === 'nequi' || sale.paymentMethod === 'daviplata') && (
          <div style={{ padding: '0 20px 14px' }}>
            <div style={{
              fontSize: 11.5, fontWeight: 700, color: T.neutral[500],
              letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 6,
            }}>
              Comprobante
            </div>
            {sale.photoUrl && (
              <a
                href={sale.photoUrl} target="_blank" rel="noreferrer"
                style={{ display: 'block', borderRadius: 12, overflow: 'hidden' }}
              >
                <img
                  src={sale.photoUrl} alt="Comprobante"
                  style={{
                    display: 'block', width: '100%', maxHeight: 280,
                    objectFit: 'contain', background: T.neutral[900],
                  }}
                />
              </a>
            )}
            {photoPending && (
              <div style={{
                padding: '11px 14px', borderRadius: 12,
                background: '#FFF7E6', border: `1px solid #F4E0BC`,
                fontSize: 12.5, color: T.warn, fontWeight: 600, lineHeight: 1.5,
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span style={{ fontSize: 16 }}>⏳</span>
                La foto se subirá automáticamente al volver la red.
              </div>
            )}
            {photoFailed && (
              <div style={{
                padding: '11px 14px', borderRadius: 12,
                background: '#FBE9E5', border: `1px solid #F0C8BE`,
                fontSize: 12.5, color: T.bad, fontWeight: 600, lineHeight: 1.5,
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span style={{ fontSize: 16 }}>⚠</span>
                La foto no se pudo subir. El admin revisará el caso.
              </div>
            )}
          </div>
        )}

        {/* Notas / reportes */}
        {sale.notes?.length > 0 && (
          <div style={{ padding: '0 20px 14px' }}>
            <div style={{
              fontSize: 11.5, fontWeight: 700, color: T.warn,
              letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 8,
            }}>
              Notas / Reportes
            </div>
            <div style={{
              background: '#FFF7E6', borderRadius: 12,
              border: `1px solid #F4E0BC`,
              padding: '10px 14px',
            }}>
              {sale.notes.map((n, i) => (
                <div key={i} style={{
                  padding: '6px 0',
                  borderBottom: i < (sale.notes.length - 1) ? `0.5px solid #E8C9A0` : 'none',
                  fontSize: 12.5, color: T.neutral[800], lineHeight: 1.5,
                }}>
                  <div style={{ fontWeight: 700, color: T.neutral[900], marginBottom: 2 }}>
                    {n.byName || 'Cajera'}
                  </div>
                  <div>{n.message}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Acciones */}
        <div style={{
          padding: '14px 20px 22px',
          borderTop: `1px solid ${T.neutral[100]}`,
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <button
            onClick={onReport}
            style={{
              padding: '12px 14px', borderRadius: 12,
              background: T.warn, color: '#fff',
              border: 'none', fontFamily: 'inherit',
              fontSize: 14, fontWeight: 700, cursor: 'pointer',
            }}
          >
            {isFlagged ? 'Ver / agregar nota al admin' : 'Reportar problema'}
          </button>
          <button
            onClick={onClose}
            style={{
              padding: '12px 14px', borderRadius: 12,
              background: T.neutral[100], color: T.neutral[700],
              border: 'none', fontFamily: 'inherit',
              fontSize: 14, fontWeight: 700, cursor: 'pointer',
            }}
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}

function Chip({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '7px 13px', borderRadius: 999,
        background: active ? T.copper[500] : '#fff',
        color: active ? '#fff' : T.neutral[700],
        border: `1px solid ${active ? T.copper[500] : T.neutral[200]}`,
        cursor: 'pointer', fontFamily: 'inherit',
        fontSize: 12.5, fontWeight: 700,
        whiteSpace: 'nowrap', flexShrink: 0,
      }}
    >
      {label}
    </button>
  )
}

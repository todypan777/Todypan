import { useEffect, useMemo, useRef, useState } from 'react'
import { T } from '../tokens'
import { fmtCOP, fmtDate } from '../utils/format'
import { Card } from '../components/Atoms'
import { ScreenHeader } from '../components/Nav'
import { useIsDesktop } from '../context/DesktopCtx'
import { watchDebtors, registerDebtorPayment } from '../debtors'
import { compressAndUpload } from '../utils/imagebb'
import { useAuth } from '../context/AuthCtx'

export default function Deudores({ onBack }) {
  const isDesktop = useIsDesktop()
  const [debtors, setDebtors] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('active')
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    const unsub = watchDebtors(list => {
      setDebtors(list)
      setLoading(false)
    })
    return unsub
  }, [])

  const filtered = useMemo(() => {
    const list = debtors.filter(d => {
      if (tab === 'active' && (d.status === 'paid' || (d.totalOwed || 0) <= 0)) return false
      if (tab === 'paid' && (d.status !== 'paid' && (d.totalOwed || 0) > 0)) return false
      if (search.trim()) {
        const q = search.toLowerCase().trim()
        if (!(d.name || '').toLowerCase().includes(q)) return false
      }
      return true
    })
    list.sort((a, b) => (b.totalOwed || 0) - (a.totalOwed || 0))
    return list
  }, [debtors, tab, search])

  const totalActive = debtors
    .filter(d => d.status !== 'paid' && (d.totalOwed || 0) > 0)
    .reduce((s, d) => s + (d.totalOwed || 0), 0)
  const activeCount = debtors.filter(d => d.status !== 'paid' && (d.totalOwed || 0) > 0).length
  const paidCount = debtors.filter(d => d.status === 'paid' || (d.totalOwed || 0) <= 0).length

  return (
    <div style={{ paddingBottom: isDesktop ? 0 : 110 }}>
      <ScreenHeader
        title="Deudores"
        subtitle={loading
          ? 'Cargando...'
          : activeCount > 0
            ? `${activeCount} ${activeCount === 1 ? 'deudor' : 'deudores'} · deben ${fmtCOP(totalActive)}`
            : 'Sin deudores activos'
        }
      />

      {/* Tarjeta resumen */}
      {activeCount > 0 && (
        <div style={{ padding: '0 16px 12px' }}>
          <Card style={{
            background: `linear-gradient(145deg, ${T.neutral[800]} 0%, ${T.neutral[900]} 100%)`,
            color: '#fff',
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: T.copper[300], textTransform: 'uppercase' }}>
              Total adeudado
            </div>
            <div style={{ fontSize: 32, fontWeight: 800, marginTop: 4, letterSpacing: -0.8, fontVariantNumeric: 'tabular-nums' }}>
              {fmtCOP(totalActive)}
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', marginTop: 4 }}>
              Distribuido entre {activeCount} {activeCount === 1 ? 'persona' : 'personas'}
            </div>
          </Card>
        </div>
      )}

      {/* Tabs + Search */}
      <div style={{ padding: '0 16px 12px' }}>
        <div style={{
          display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
          background: '#fff', border: `1px solid ${T.neutral[100]}`,
          borderRadius: 16, padding: '10px 12px',
        }}>
          {/* Search */}
          <div style={{
            flex: 1, minWidth: 160, display: 'flex', alignItems: 'center', gap: 6,
            background: T.neutral[50], borderRadius: 10, padding: '6px 12px',
          }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="4.5" stroke={T.neutral[400]} strokeWidth="1.5"/>
              <path d="M10.5 10.5 L14 14" stroke={T.neutral[400]} strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nombre..."
              style={{
                border: 'none', outline: 'none', background: 'transparent',
                fontSize: 13, color: T.neutral[800], fontFamily: 'inherit', width: '100%',
              }}
            />
          </div>

          {/* Status tabs */}
          <div style={{ display: 'flex', gap: 4 }}>
            {[
              { id: 'active', label: `Activos${activeCount > 0 ? ` · ${activeCount}` : ''}` },
              { id: 'paid', label: `Pagados${paidCount > 0 ? ` · ${paidCount}` : ''}` },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  padding: '7px 12px', borderRadius: 999,
                  background: tab === t.id ? T.copper[500] : 'transparent',
                  color: tab === t.id ? '#fff' : T.neutral[600],
                  border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 12, fontWeight: 700,
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Lista de deudores */}
      <div style={{ padding: '0 16px' }}>
        {loading ? (
          <Card>
            <div style={{ padding: '24px 0', textAlign: 'center', color: T.neutral[500], fontSize: 13 }}>
              Cargando deudores...
            </div>
          </Card>
        ) : filtered.length === 0 ? (
          <Card>
            <div style={{ padding: '40px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 42, marginBottom: 8 }}>{tab === 'paid' ? '✅' : '🤝'}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.neutral[700] }}>
                {tab === 'active'
                  ? (search ? 'Sin resultados' : 'Sin deudores activos')
                  : 'Aún no hay deudas saldadas'}
              </div>
              <div style={{ fontSize: 12, color: T.neutral[500], marginTop: 4 }}>
                {tab === 'active'
                  ? 'Cuando una cajera registre una venta como deuda aparecerá aquí.'
                  : 'Cuando alguien termine de pagar su deuda aparecerá aquí.'}
              </div>
            </div>
          </Card>
        ) : (
          <Card padding={0} style={{ overflow: 'hidden' }}>
            {filtered.map((d, i) => (
              <DebtorRow
                key={d.id}
                debtor={d}
                isLast={i === filtered.length - 1}
                onClick={() => setSelected(d)}
              />
            ))}
          </Card>
        )}
      </div>

      {selected && (
        <DebtorDetailModal
          debtor={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

function DebtorRow({ debtor, isLast, onClick }) {
  const isPaid = debtor.status === 'paid' || (debtor.totalOwed || 0) <= 0
  const initials = (debtor.name || '?').split(' ').map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()

  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', padding: '12px 14px',
        background: 'transparent', border: 'none',
        borderBottom: isLast ? 'none' : `0.5px solid ${T.neutral[100]}`,
        cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
        display: 'flex', alignItems: 'center', gap: 12,
      }}
    >
      <div style={{
        width: 38, height: 38, borderRadius: 999, flexShrink: 0,
        background: isPaid ? T.neutral[100] : T.copper[100],
        color: isPaid ? T.neutral[500] : T.copper[700],
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, fontWeight: 800,
      }}>
        {initials}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14, fontWeight: 700, color: T.neutral[900],
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {debtor.name}
        </div>
        <div style={{ fontSize: 11.5, color: T.neutral[500], marginTop: 2 }}>
          {(debtor.history?.length || 0)} {debtor.history?.length === 1 ? 'movimiento' : 'movimientos'}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        {isPaid ? (
          <div style={{
            display: 'inline-block',
            fontSize: 10.5, fontWeight: 700, color: T.ok, background: '#E8F4E8',
            padding: '3px 10px', borderRadius: 999,
            letterSpacing: 0.4, textTransform: 'uppercase',
          }}>
            Pagado
          </div>
        ) : (
          <>
            <div style={{
              fontSize: 15, fontWeight: 800, color: T.bad,
              fontVariantNumeric: 'tabular-nums', letterSpacing: -0.3,
            }}>
              {fmtCOP(debtor.totalOwed || 0)}
            </div>
            <div style={{ fontSize: 10.5, color: T.neutral[500], marginTop: 2 }}>
              debe
            </div>
          </>
        )}
      </div>
    </button>
  )
}

// ──────────────────────────────────────────────────────────────
// Modal de detalle del deudor
// ──────────────────────────────────────────────────────────────
function DebtorDetailModal({ debtor, onClose }) {
  const [paying, setPaying] = useState(false)
  const isPaid = debtor.status === 'paid' || (debtor.totalOwed || 0) <= 0

  // Historial ordenado por fecha desc
  const history = (debtor.history || []).slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 90,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 480,
        background: '#fff', borderRadius: 22,
        boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
        maxHeight: '92vh', overflowY: 'auto',
      }}>
        {/* Header */}
        <div style={{
          padding: '22px 22px 16px',
          background: isPaid
            ? `linear-gradient(135deg, ${T.ok} 0%, #4A7549 100%)`
            : `linear-gradient(135deg, ${T.copper[500]} 0%, ${T.copper[700]} 100%)`,
          color: '#fff',
        }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: 'rgba(255,255,255,0.8)', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 }}>
            {isPaid ? 'Deuda saldada' : 'Total adeudado'}
          </div>
          <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.8, fontVariantNumeric: 'tabular-nums' }}>
            {isPaid ? '✅ Pagado' : fmtCOP(debtor.totalOwed || 0)}
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, marginTop: 8 }}>
            {debtor.name}
          </div>
        </div>

        {/* Botón registrar pago */}
        {!isPaid && !paying && (
          <div style={{ padding: '14px 22px 0' }}>
            <button
              onClick={() => setPaying(true)}
              style={{
                width: '100%', padding: '13px', borderRadius: 14,
                background: T.copper[500], color: '#fff',
                border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 14.5, fontWeight: 700,
                boxShadow: '0 3px 10px rgba(184,122,86,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              💰 Registrar abono o pago
            </button>
          </div>
        )}

        {paying && (
          <PaymentForm
            debtor={debtor}
            onCancel={() => setPaying(false)}
            onDone={() => setPaying(false)}
          />
        )}

        {/* Historial */}
        <div style={{ padding: '16px 22px 22px' }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: T.neutral[500], letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8 }}>
            Historial ({history.length})
          </div>
          {history.length === 0 ? (
            <div style={{ padding: '20px 0', textAlign: 'center', color: T.neutral[500], fontSize: 12.5 }}>
              Sin movimientos.
            </div>
          ) : (
            <div style={{
              background: T.neutral[50], borderRadius: 12,
              padding: '4px 0', maxHeight: 320, overflowY: 'auto',
            }}>
              {history.map((h, i) => (
                <HistoryItem key={i} entry={h} isLast={i === history.length - 1} />
              ))}
            </div>
          )}
        </div>

        <div style={{ padding: '0 22px 22px' }}>
          <button onClick={onClose} style={{
            width: '100%', padding: '12px', borderRadius: 12,
            background: T.neutral[100], color: T.neutral[700],
            border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 14, fontWeight: 700,
          }}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}

function HistoryItem({ entry, isLast }) {
  const isPayment = entry.type === 'payment'
  const date = entry.date
    ? new Date(entry.date + 'T00:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—'
  const methodLabel = entry.method
    ? { efectivo: '💵 Efectivo', nequi: '📱 NEQUI', daviplata: '📱 DAVIPLATA' }[entry.method] || entry.method
    : null

  return (
    <div style={{
      padding: '10px 12px',
      borderBottom: isLast ? 'none' : `0.5px solid ${T.neutral[100]}`,
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: 999, flexShrink: 0,
        background: isPayment ? '#E8F4E8' : '#FBE9E5',
        color: isPayment ? T.ok : T.bad,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14, fontWeight: 800,
      }}>
        {isPayment ? '↓' : '↑'}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: T.neutral[900] }}>
          {isPayment ? 'Abono / Pago' : 'Venta a crédito'}
        </div>
        <div style={{ fontSize: 11, color: T.neutral[500], marginTop: 1 }}>
          {date}
          {methodLabel && ` · ${methodLabel}`}
        </div>
        {entry.note && (
          <div style={{ fontSize: 11.5, color: T.neutral[600], fontStyle: 'italic', marginTop: 3 }}>
            "{entry.note}"
          </div>
        )}
        {entry.photoUrl && (
          <a href={entry.photoUrl} target="_blank" rel="noreferrer" style={{
            fontSize: 11, color: T.copper[600], textDecoration: 'underline', fontWeight: 600,
            marginTop: 3, display: 'inline-block',
          }}>
            📎 Ver comprobante
          </a>
        )}
      </div>
      <div style={{
        fontSize: 14, fontWeight: 800,
        color: isPayment ? T.ok : T.bad,
        fontVariantNumeric: 'tabular-nums', flexShrink: 0,
      }}>
        {isPayment ? '−' : '+'}{fmtCOP(entry.amount)}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Form de registro de pago
// ──────────────────────────────────────────────────────────────
function PaymentForm({ debtor, onCancel, onDone }) {
  const { authUser } = useAuth()
  const [amountStr, setAmountStr] = useState('')
  const [method, setMethod] = useState('efectivo')
  const [note, setNote] = useState('')
  const [photoUrl, setPhotoUrl] = useState(null)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoError, setPhotoError] = useState(null)
  const fileInputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const amount = Number(amountStr) || 0
  const totalOwed = debtor.totalOwed || 0
  const exceeds = amount > totalOwed
  const valid = amount > 0 && !photoUploading

  async function handleFileSelected(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setPhotoError(null)
    setPhotoUploading(true)
    try {
      const result = await compressAndUpload(file)
      setPhotoUrl(result.url)
    } catch (err) {
      console.error(err)
      setPhotoError(err.message || 'No pudimos subir la foto.')
      setPhotoUrl(null)
    } finally {
      setPhotoUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleSubmit() {
    if (!valid || busy) return
    setBusy(true); setError(null)
    try {
      await registerDebtorPayment(debtor.id, {
        amount,
        method,
        note: note.trim() || undefined,
        photoUrl: photoUrl || undefined,
        registeredBy: authUser.uid,
      })
      onDone()
    } catch (err) {
      console.error(err)
      setError(err.message || 'No pudimos registrar el pago.')
      setBusy(false)
    }
  }

  return (
    <div style={{
      margin: '14px 22px 0', padding: '14px 16px',
      background: T.neutral[50], borderRadius: 14,
      border: `1px solid ${T.neutral[100]}`,
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: T.neutral[800], marginBottom: 10 }}>
        Registrar abono o pago
      </div>

      {/* Monto */}
      <Label>Monto</Label>
      <div style={moneyInputWrap()}>
        <span style={moneyPrefix()}>$</span>
        <input
          type="text"
          inputMode="numeric"
          value={amountStr === '0' ? '' : amountStr}
          onChange={e => setAmountStr(e.target.value.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, ''))}
          placeholder="0"
          autoFocus
          disabled={busy}
          style={moneyInput()}
        />
      </div>

      {amount > 0 && (
        <div style={{
          marginTop: -8, marginBottom: 12,
          padding: '8px 12px', borderRadius: 10,
          background: exceeds ? '#FBE9E5' : '#E8F4E8',
          fontSize: 12, color: exceeds ? T.bad : T.ok, fontWeight: 600,
          display: 'flex', justifyContent: 'space-between',
        }}>
          <span>{exceeds ? 'Excede la deuda' : 'Quedaría debiendo'}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 800 }}>
            {fmtCOP(Math.max(0, totalOwed - amount))}
          </span>
        </div>
      )}

      {/* Botones de quick-fill */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        <button
          onClick={() => setAmountStr(String(totalOwed))}
          disabled={busy}
          style={quickBtn(amount === totalOwed)}
        >
          Pagar todo · {fmtCOP(totalOwed)}
        </button>
        {totalOwed >= 10000 && (
          <button
            onClick={() => setAmountStr(String(Math.floor(totalOwed / 2)))}
            disabled={busy}
            style={quickBtn(false)}
          >
            Mitad
          </button>
        )}
      </div>

      {/* Método */}
      <Label>Método</Label>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {[
          { id: 'efectivo', label: '💵 Efectivo' },
          { id: 'nequi', label: '📱 NEQUI' },
          { id: 'daviplata', label: '📱 DAVIPLATA' },
        ].map(m => (
          <button
            key={m.id}
            onClick={() => setMethod(m.id)}
            disabled={busy}
            style={methodBtn(method === m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Foto opcional */}
      <Label>Comprobante (opcional)</Label>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileSelected}
        style={{ display: 'none' }}
      />
      {!photoUrl && !photoUploading && !photoError && (
        <button
          onClick={() => fileInputRef.current?.click()}
          style={{
            width: '100%', padding: '11px', borderRadius: 12, marginBottom: 12,
            background: '#fff', color: T.neutral[600],
            border: `1.5px dashed ${T.neutral[300]}`,
            cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 12.5, fontWeight: 600,
          }}
        >
          📸 Adjuntar foto
        </button>
      )}
      {photoUploading && (
        <div style={{
          padding: '11px', borderRadius: 12, marginBottom: 12, textAlign: 'center',
          background: '#fff', border: `1px solid ${T.neutral[200]}`,
          fontSize: 12.5, color: T.neutral[600], fontWeight: 600,
        }}>
          Subiendo foto...
        </div>
      )}
      {photoError && !photoUploading && (
        <div style={{
          padding: '10px 12px', borderRadius: 10, marginBottom: 12,
          background: '#FBE9E5', border: `1px solid #F0C8BE`,
          fontSize: 12, color: T.bad, fontWeight: 500,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        }}>
          <span style={{ flex: 1 }}>{photoError}</span>
          <button onClick={() => fileInputRef.current?.click()} style={{
            padding: '5px 10px', borderRadius: 8,
            background: T.bad, color: '#fff', border: 'none',
            fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
          }}>Reintentar</button>
        </div>
      )}
      {photoUrl && !photoUploading && (
        <div style={{
          marginBottom: 12, borderRadius: 10, overflow: 'hidden',
          border: `1.5px solid ${T.ok}66`,
        }}>
          <img src={photoUrl} alt="" style={{
            display: 'block', width: '100%', maxHeight: 140,
            objectFit: 'contain', background: T.neutral[900],
          }}/>
          <button onClick={() => setPhotoUrl(null)} style={{
            width: '100%', padding: '7px',
            background: '#fff', border: 'none', borderTop: `1px solid ${T.neutral[100]}`,
            cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 11.5, fontWeight: 600, color: T.neutral[600],
          }}>Quitar foto</button>
        </div>
      )}

      {/* Nota */}
      <Label>Nota interna (opcional)</Label>
      <textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        placeholder="Ej: Pagó por nequi al 3001234567"
        rows={2}
        disabled={busy}
        style={{
          width: '100%', padding: '10px 12px', borderRadius: 12,
          border: `1px solid ${T.neutral[200]}`, background: '#fff',
          fontFamily: 'inherit', fontSize: 13, color: T.neutral[800],
          outline: 'none', resize: 'vertical', minHeight: 50,
          marginBottom: 12, boxSizing: 'border-box',
        }}
      />

      {error && (
        <div style={{
          padding: '10px 12px', borderRadius: 10, marginBottom: 10,
          background: '#FBE9E5', border: `1px solid #F0C8BE`, color: T.bad,
          fontSize: 12.5, fontWeight: 500, textAlign: 'center',
        }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onCancel} disabled={busy} style={{
          flex: 1, padding: '11px', borderRadius: 12,
          background: '#fff', color: T.neutral[700],
          border: `1px solid ${T.neutral[200]}`,
          cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
          fontSize: 13.5, fontWeight: 700,
        }}>Cancelar</button>
        <button
          onClick={handleSubmit}
          disabled={!valid || busy}
          style={{
            flex: 1.4, padding: '11px', borderRadius: 12,
            background: valid && !busy ? T.ok : T.neutral[200],
            color: valid && !busy ? '#fff' : T.neutral[400],
            border: 'none', cursor: valid && !busy ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700,
          }}
        >
          {busy ? 'Guardando...' : 'Registrar pago'}
        </button>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Helpers de estilo
// ──────────────────────────────────────────────────────────────
function Label({ children }) {
  return (
    <label style={{
      display: 'block',
      fontSize: 11, fontWeight: 700, color: T.neutral[600],
      letterSpacing: 0.4, textTransform: 'uppercase',
      marginBottom: 5,
    }}>
      {children}
    </label>
  )
}

function moneyInputWrap() {
  return {
    display: 'flex', alignItems: 'center',
    border: `1px solid ${T.neutral[200]}`, borderRadius: 12,
    background: '#fff', marginBottom: 12,
  }
}
function moneyPrefix() {
  return { paddingLeft: 12, color: T.neutral[500], fontSize: 14, fontWeight: 600 }
}
function moneyInput() {
  return {
    width: '100%', padding: '11px 14px 11px 6px',
    border: 'none', outline: 'none',
    fontFamily: 'inherit', fontSize: 16, fontWeight: 700,
    color: T.neutral[900], background: 'transparent',
    fontVariantNumeric: 'tabular-nums',
  }
}
function quickBtn(active) {
  return {
    padding: '6px 12px', borderRadius: 999,
    background: active ? T.copper[500] : T.neutral[100],
    color: active ? '#fff' : T.neutral[700],
    border: 'none', cursor: 'pointer', fontFamily: 'inherit',
    fontSize: 11.5, fontWeight: 700,
  }
}
function methodBtn(active) {
  return {
    flex: 1, padding: '8px 10px', borderRadius: 10,
    background: active ? T.copper[50] : '#fff',
    color: active ? T.copper[700] : T.neutral[600],
    border: `1px solid ${active ? T.copper[400] : T.neutral[200]}`,
    cursor: 'pointer', fontFamily: 'inherit',
    fontSize: 12, fontWeight: 700,
    minWidth: 80,
  }
}

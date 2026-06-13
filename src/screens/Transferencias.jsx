import { useEffect, useMemo, useState } from 'react'
import { T } from '../tokens'
import { fmtCOP, fmtDate } from '../utils/format'
import { Card } from '../components/Atoms'
import { ScreenHeader } from '../components/Nav'
import { doc, getDoc } from 'firebase/firestore'
import { firestoreDb } from '../firebase'
import { getBogotaDateStr, getData, getTransfersStartDate, ensureTransfersStartDate } from '../db'
import { useAuth } from '../context/AuthCtx'
import {
  watchSalesByDate,
  confirmTransfer,
  unconfirmTransfer,
  reclassifySaleToTransfer,
  convertTransferToCash,
  deleteSaleAsAdmin,
} from '../sales'
import { recomputeClosedSession } from '../cashSessions'
import { digitalAmount } from '../utils/payment'

// ─────────────────────────────────────────────────────────────────────────────
// Confirmación de transferencias (admin)
//
// Cada día le llega al admin la lista de ventas por transferencia (NEQUI y
// DAVIPLATA, separadas). Abre su app, confirma las que llegaron y resuelve las
// que no. Si ve una transferencia en su app que no aparece, usa el buscador
// (±$500 y ±15 min) para encontrar una venta que la cajera marcó mal (ej. como
// efectivo) y corregirla.
// ─────────────────────────────────────────────────────────────────────────────

const METHODS = [
  { id: 'nequi',     label: 'NEQUI',     icon: '📱', accent: '#5B2A86' },
  { id: 'daviplata', label: 'DAVIPLATA', icon: '📲', accent: '#E1251B' },
]

const VALUE_TOLERANCE = 500   // pesos hacia arriba/abajo
const TIME_TOLERANCE = 15     // minutos hacia adelante/atrás

export default function Transferencias() {
  const todayStr = getBogotaDateStr()
  const [date, setDate] = useState(todayStr)
  const [sales, setSales] = useState([])
  const [detail, setDetail] = useState(null)   // venta a revisar
  const [searchMethod, setSearchMethod] = useState(null) // 'nequi' | 'daviplata' para el buscador
  const branches = getData().branches || []

  // Control automático: se fija la fecha de inicio la primera vez que se abre.
  useEffect(() => { ensureTransfersStartDate() }, [])
  const startDate = getTransfersStartDate() || todayStr
  // Antes del inicio del control automático = solo historial (sin pendientes/rojo).
  const beforeStart = date < startDate

  useEffect(() => watchSalesByDate(date, setSales), [date])

  const isToday = date === todayStr
  const isFuture = date > todayStr

  function changeDate(delta) {
    const d = new Date(date + 'T12:00:00')
    d.setDate(d.getDate() + delta)
    const next = d.toISOString().slice(0, 10)
    if (next <= todayStr) setDate(next)
  }

  // Ventas activas del día (no eliminadas)
  const activeSales = useMemo(
    () => sales.filter(s => (s.status || 'active') !== 'deleted'),
    [sales],
  )

  const displayDate = fmtDate(date, { weekday: true })

  return (
    <div style={{ paddingBottom: 110 }}>
      <ScreenHeader title="Transferencias" />

      {/* Navegador de fecha (mismo patrón que Cierres de caja) */}
      <div style={{ padding: '0 16px 16px' }}>
        <div style={{ borderRadius: 18, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
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
        </div>
      </div>

      {isFuture ? (
        <EmptyState icon="📅" text="Fecha futura" />
      ) : (
        <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {beforeStart && (
            <div style={{
              padding: '11px 14px', borderRadius: 12,
              background: T.neutral[50], border: `1px solid ${T.neutral[100]}`,
              fontSize: 12.5, color: T.neutral[500], fontWeight: 600, lineHeight: 1.5, textAlign: 'center',
            }}>
              Historial · el control automático de transferencias empezó el {fmtDate(startDate, { weekday: true })}.
            </div>
          )}
          {METHODS.map(m => (
            <MethodSection
              key={m.id}
              method={m}
              sales={activeSales}
              branches={branches}
              beforeStart={beforeStart}
              onReview={setDetail}
              onSearch={() => setSearchMethod(m.id)}
            />
          ))}
        </div>
      )}

      {detail && (
        <TransferReviewModal
          sale={detail}
          branches={branches}
          onClose={() => setDetail(null)}
        />
      )}

      {searchMethod && (
        <SearchSaleModal
          method={searchMethod}
          sales={activeSales}
          date={date}
          branches={branches}
          onClose={() => setSearchMethod(null)}
        />
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Sección por método (NEQUI / DAVIPLATA)
// ──────────────────────────────────────────────────────────────
function MethodSection({ method, sales, branches, beforeStart = false, onReview, onSearch }) {
  // Ventas que llevan plata por este método (puras o porción de un mixto)
  const items = useMemo(
    () => sales
      .map(s => ({ sale: s, amount: digitalAmount(s, method.id) }))
      .filter(x => x.amount > 0)
      .sort((a, b) => timeMs(a.sale) - timeMs(b.sale)),
    [sales, method.id],
  )

  const total = items.reduce((s, x) => s + x.amount, 0)
  const pending = items.filter(x => !isConfirmed(x.sale))
  const allDone = items.length > 0 && pending.length === 0

  // Estados derivados (solo desde el inicio del control automático):
  //  - SALTADA (rojo): pendiente con una transferencia MÁS NUEVA ya confirmada
  //    (el admin registró las de después → esta se la saltó).
  //  - DESFASE (⚠): confirmada con discrepancyAmount != 0.
  const maxConfirmedTime = useMemo(
    () => items.reduce((mx, x) => isConfirmed(x.sale) ? Math.max(mx, timeMs(x.sale)) : mx, 0),
    [items],
  )
  function flagsFor(sale) {
    if (beforeStart) return { skipped: false, discrepancy: 0 }
    const confirmed = isConfirmed(sale)
    const discrepancy = confirmed ? (Number(sale.transferConfirmation?.discrepancyAmount) || 0) : 0
    const skipped = !confirmed && maxConfirmedTime > 0 && timeMs(sale) < maxConfirmedTime
    return { skipped, discrepancy }
  }
  const reviewCount = beforeStart ? 0 : items.filter(x => {
    const f = flagsFor(x.sale)
    return f.skipped || f.discrepancy
  }).length

  return (
    <Card padding={0} style={{ overflow: 'hidden', border: `1px solid ${T.neutral[100]}` }}>
      {/* Header de la sección */}
      <div style={{
        padding: '14px 16px',
        display: 'flex', alignItems: 'center', gap: 12,
        borderBottom: items.length > 0 ? `1px solid ${T.neutral[100]}` : 'none',
        background: T.neutral[25],
      }}>
        <div style={{
          width: 38, height: 38, borderRadius: 11, flexShrink: 0,
          background: '#fff', border: `1px solid ${T.neutral[100]}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
        }}>{method.icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: T.neutral[900], letterSpacing: 0.2 }}>
            {method.label}
          </div>
          <div style={{ fontSize: 12, color: T.neutral[500], marginTop: 1 }}>
            {items.length} {items.length === 1 ? 'transferencia' : 'transferencias'} · {fmtCOP(total)}
          </div>
        </div>
        {items.length > 0 && !beforeStart && (
          reviewCount > 0 ? (
            <div style={{
              padding: '5px 10px', borderRadius: 999,
              background: '#FBE9E5', color: T.bad,
              fontSize: 11.5, fontWeight: 800, flexShrink: 0,
            }}>
              {reviewCount} por revisar
            </div>
          ) : allDone ? (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '5px 10px', borderRadius: 999,
              background: '#E8F4E8', color: T.ok,
              fontSize: 11.5, fontWeight: 800, letterSpacing: 0.2, flexShrink: 0,
            }}>
              <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 6.5 L5 9 L10 3" stroke={T.ok} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Todas revisadas
            </div>
          ) : (
            <div style={{
              padding: '5px 10px', borderRadius: 999,
              background: '#FFF7E6', color: T.warn,
              fontSize: 11.5, fontWeight: 800, flexShrink: 0,
            }}>
              {pending.length} sin confirmar
            </div>
          )
        )}
      </div>

      {/* Lista */}
      {items.length === 0 ? (
        <div style={{ padding: '22px 16px', textAlign: 'center', color: T.neutral[400], fontSize: 13 }}>
          Sin transferencias por {method.label} este día.
        </div>
      ) : (
        items.map((x, i) => {
          const f = flagsFor(x.sale)
          return (
            <TransferRow
              key={x.sale.id}
              sale={x.sale}
              amount={x.amount}
              branches={branches}
              isLast={i === items.length - 1}
              skipped={f.skipped}
              discrepancy={f.discrepancy}
              onClick={() => onReview(x.sale)}
            />
          )
        })
      )}

      {/* Buscador */}
      <button onClick={onSearch} style={{
        width: '100%', padding: '12px 16px',
        borderTop: `1px solid ${T.neutral[100]}`,
        background: '#fff', cursor: 'pointer', fontFamily: 'inherit',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        fontSize: 12.5, fontWeight: 700, color: T.copper[700],
      }}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <circle cx="7" cy="7" r="4.5" stroke={T.copper[600]} strokeWidth="1.6"/>
          <path d="M10.5 10.5 L14 14" stroke={T.copper[600]} strokeWidth="1.6" strokeLinecap="round"/>
        </svg>
        ¿Ves una transferencia que no aparece? Búscala
      </button>
    </Card>
  )
}

function TransferRow({ sale, amount, branches, isLast, skipped = false, discrepancy = 0, onClick }) {
  const branch = branches.find(b => String(b.id) === String(sale.branchId))
  const confirmed = isConfirmed(sale)
  const reclassified = sale.transferConfirmation?.reclassified
  const hasPhoto = !!sale.photoUrl
  return (
    <button onClick={onClick} style={{
      width: '100%', padding: '12px 16px',
      borderBottom: isLast ? 'none' : `0.5px solid ${T.neutral[100]}`,
      background: skipped ? '#FBE9E5' : 'transparent', border: 'none', cursor: 'pointer',
      fontFamily: 'inherit', textAlign: 'left',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      {/* Check / pendiente / saltada */}
      <div style={{
        width: 26, height: 26, borderRadius: 999, flexShrink: 0,
        border: confirmed ? 'none' : `2px solid ${skipped ? T.bad : T.neutral[200]}`,
        background: confirmed ? T.ok : 'transparent',
        color: T.bad, fontSize: 14, fontWeight: 900,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {confirmed
          ? <svg width="13" height="13" viewBox="0 0 12 12"><path d="M2 6.5 L5 9 L10 3" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
          : skipped ? '!' : null}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14, fontWeight: 700, color: T.neutral[900],
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          {sale.cashierName || 'Cajera'}
          {reclassified && (
            <span style={{
              fontSize: 9, fontWeight: 800, color: T.copper[700], background: T.copper[50],
              padding: '1px 5px', borderRadius: 999, letterSpacing: 0.3, textTransform: 'uppercase',
            }}>corregida</span>
          )}
          {skipped && (
            <span style={{
              fontSize: 9, fontWeight: 800, color: T.bad, background: '#F7D9D2',
              padding: '1px 5px', borderRadius: 999, letterSpacing: 0.3, textTransform: 'uppercase',
            }}>saltada</span>
          )}
          {!!discrepancy && (
            <span style={{
              fontSize: 9, fontWeight: 800, color: '#8A6A1A', background: '#FBEFCF',
              padding: '1px 5px', borderRadius: 999, letterSpacing: 0.3, textTransform: 'uppercase',
            }}>desfase {fmtCOP(Math.abs(discrepancy))}</span>
          )}
        </div>
        <div style={{ fontSize: 11.5, color: T.neutral[500], marginTop: 2 }}>
          {timeStr(sale)} · {branch?.name || '—'}
          {sale.paymentMethod === 'mixto' && ' · porción de mixto'}
        </div>
      </div>
      {hasPhoto && (
        <span title="Tiene comprobante" style={{ flexShrink: 0, opacity: 0.6 }}>
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
            <rect x="2.5" y="4.5" width="15" height="11" rx="2" stroke={T.neutral[400]} strokeWidth="1.4"/>
            <circle cx="10" cy="10" r="2.6" stroke={T.neutral[400]} strokeWidth="1.4"/>
          </svg>
        </span>
      )}
      <div style={{
        fontSize: 14.5, fontWeight: 800, color: T.neutral[900],
        fontVariantNumeric: 'tabular-nums', textAlign: 'right', flexShrink: 0,
      }}>
        {fmtCOP(amount)}
      </div>
    </button>
  )
}

// ──────────────────────────────────────────────────────────────
// Modal: revisar una transferencia (confirmar / no llegó)
// ──────────────────────────────────────────────────────────────
function TransferReviewModal({ sale, branches, onClose }) {
  const { authUser, userDoc } = useAuth()
  const adminName = `${userDoc?.nombre || ''} ${userDoc?.apellido || ''}`.trim() || 'Admin'
  const branch = branches.find(b => String(b.id) === String(sale.branchId))
  const confirmed = isConfirmed(sale)
  const method = sale.paymentMethod === 'daviplata' || sale.paymentSplit?.daviplata ? 'daviplata' : 'nequi'
  const amount = digitalAmount(sale, method)

  const [mode, setMode] = useState(null)   // null | 'notReceived'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function run(fn, recompute = false) {
    if (busy) return
    setBusy(true); setError(null)
    try {
      await fn()
      // Si la corrección cambió cómo entra la plata (efectivo ⇄ digital) o
      // borró la venta, y el turno YA estaba cerrado, recalculamos su cuadre:
      // así una falta fantasma de cierre se corrige sola y queda "cuadre exacto".
      if (recompute) await recomputeAffectedSession(sale.sessionId, authUser.uid)
      onClose()
    } catch (err) {
      console.error(err)
      setError('No se pudo guardar. Revisa tu conexión.')
      setBusy(false)
    }
  }

  const handleConfirm = () => run(() =>
    confirmTransfer(sale.id, { byUid: authUser.uid, byName: adminName }))
  const handleUnconfirm = () => run(() => unconfirmTransfer(sale.id))
  const handleToCash = () => run(() =>
    convertTransferToCash(sale.id, { byUid: authUser.uid, byName: adminName }), true)
  const handleDelete = () => run(() =>
    deleteSaleAsAdmin(sale.id, { byUid: authUser.uid, reason: 'transferencia no llegó' }), true)

  return (
    <ModalOverlay onClose={busy ? undefined : onClose}>
      <ModalCard>
        <div style={{ fontSize: 18, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3 }}>
          {method === 'daviplata' ? 'DAVIPLATA' : 'NEQUI'} · {fmtCOP(amount)}
        </div>
        <div style={{ fontSize: 12.5, color: T.neutral[500], marginTop: 2, marginBottom: 16 }}>
          {timeStr(sale)} · {sale.cashierName || 'Cajera'} · {branch?.name || '—'}
        </div>

        {/* Comprobante */}
        {sale.photoUrl ? (
          <a href={sale.photoUrl} target="_blank" rel="noreferrer" style={{ display: 'block', marginBottom: 14, borderRadius: 12, overflow: 'hidden' }}>
            <img src={sale.photoUrl} alt="Comprobante" style={{
              display: 'block', width: '100%', maxHeight: 260, objectFit: 'contain',
              background: T.neutral[900], borderRadius: 12,
            }} />
          </a>
        ) : (
          <div style={{
            marginBottom: 14, padding: '12px 14px', borderRadius: 10,
            background: T.neutral[50], color: T.neutral[500], fontSize: 12.5, textAlign: 'center',
          }}>
            Sin foto de comprobante.
          </div>
        )}

        {/* Estado confirmado */}
        {confirmed && mode === null && (
          <div style={{
            padding: '12px 14px', borderRadius: 12, marginBottom: 14,
            background: '#E8F4E8', border: `1px solid ${T.ok}40`,
          }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: T.ok, display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="14" height="14" viewBox="0 0 12 12"><path d="M2 6.5 L5 9 L10 3" stroke={T.ok} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Confirmada
            </div>
            {sale.transferConfirmation?.reviewedByName && (
              <div style={{ fontSize: 11.5, color: T.neutral[600], marginTop: 3 }}>
                Por {sale.transferConfirmation.reviewedByName}
              </div>
            )}
          </div>
        )}

        {error && <ErrorBox>{error}</ErrorBox>}

        {/* Acciones */}
        {mode === 'notReceived' ? (
          <>
            <div style={{ fontSize: 12.5, color: T.neutral[600], marginBottom: 10, lineHeight: 1.5 }}>
              La plata no llegó a tu {method === 'daviplata' ? 'Daviplata' : 'Nequi'}. ¿Qué hacemos con esta venta?
            </div>
            <ActionBtn
              color={T.copper[600]} disabled={busy} onClick={handleToCash}
              title="Pasar a efectivo"
              subtitle="El cliente pagó en efectivo. La venta cuenta como efectivo."
            />
            <ActionBtn
              color={T.bad} disabled={busy} onClick={handleDelete}
              title="Eliminar venta"
              subtitle="La venta nunca debió existir. Se marca como eliminada."
            />
            <button onClick={() => setMode(null)} disabled={busy} style={ghostBtn}>
              Volver
            </button>
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {confirmed ? (
              <button onClick={handleUnconfirm} disabled={busy} style={{
                ...solidBtn(T.neutral[200]), color: T.neutral[700],
              }}>
                {busy ? 'Guardando...' : 'Deshacer confirmación'}
              </button>
            ) : (
              <button onClick={handleConfirm} disabled={busy} style={solidBtn(T.ok)}>
                {busy ? 'Guardando...' : '✓ Sí llegó'}
              </button>
            )}
            <button onClick={() => setMode('notReceived')} disabled={busy} style={{
              ...solidBtn('#fff'), color: T.bad, border: `1.5px solid ${T.bad}55`,
            }}>
              ✗ No llegó
            </button>
            <button onClick={onClose} disabled={busy} style={ghostBtn}>
              Cerrar
            </button>
          </div>
        )}
      </ModalCard>
    </ModalOverlay>
  )
}

// ──────────────────────────────────────────────────────────────
// Modal: buscar venta mal marcada (±$500 y ±15 min)
// ──────────────────────────────────────────────────────────────
function SearchSaleModal({ method, sales, date, branches, onClose }) {
  const { authUser, userDoc } = useAuth()
  const adminName = `${userDoc?.nombre || ''} ${userDoc?.apellido || ''}`.trim() || 'Admin'
  const methodLabel = method === 'daviplata' ? 'DAVIPLATA' : 'NEQUI'

  const [valueStr, setValueStr] = useState('')
  const [timeStrInput, setTimeStrInput] = useState(defaultTimeInput(date))
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState(null)

  const value = Number(valueStr) || 0
  const targetMin = parseTimeInput(timeStrInput)

  // Candidatas: ventas activas que NO son ya de este método digital y cuyo
  // monto y hora caen dentro de la tolerancia. Excluimos deuda (no es plata
  // que entre por transferencia) y la propia familia del método.
  const candidates = useMemo(() => {
    if (value <= 0) return []
    return sales
      .filter(s => {
        if (s.paymentMethod === 'deuda') return false
        if (digitalAmount(s, method) > 0) return false  // ya es de este método
        const amt = Number(s.total) || 0
        if (Math.abs(amt - value) > VALUE_TOLERANCE) return false
        if (targetMin != null) {
          const sm = saleMinutes(s)
          if (sm == null || Math.abs(sm - targetMin) > TIME_TOLERANCE) return false
        }
        return true
      })
      .map(s => ({
        sale: s,
        dv: Math.abs((Number(s.total) || 0) - value),
        dt: targetMin != null && saleMinutes(s) != null ? Math.abs(saleMinutes(s) - targetMin) : 999,
      }))
      .sort((a, b) => (a.dt - b.dt) || (a.dv - b.dv))
  }, [sales, value, targetMin, method])

  async function pick(sale) {
    if (busyId) return
    setBusyId(sale.id); setError(null)
    try {
      await reclassifySaleToTransfer(sale.id, { method, byUid: authUser.uid, byName: adminName })
      // La venta dejó de ser efectivo → si su turno ya estaba cerrado, el
      // esperado en caja baja y una falta fantasma se corrige a cuadre exacto.
      await recomputeAffectedSession(sale.sessionId, authUser.uid)
      onClose()
    } catch (err) {
      console.error(err)
      setError('No se pudo corregir la venta.')
      setBusyId(null)
    }
  }

  return (
    <ModalOverlay onClose={busyId ? undefined : onClose}>
      <ModalCard>
        <div style={{ fontSize: 18, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3 }}>
          Buscar venta · {methodLabel}
        </div>
        <div style={{ fontSize: 12.5, color: T.neutral[500], marginTop: 2, marginBottom: 16, lineHeight: 1.5 }}>
          Escribe el valor y la hora de la transferencia que ves en tu app. Buscamos ventas
          parecidas (±{fmtCOP(VALUE_TOLERANCE)} y ±{TIME_TOLERANCE} min) que la cajera pudo
          marcar mal (ej. como efectivo).
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          <div style={{ flex: 1.4 }}>
            <FieldLabel>Valor</FieldLabel>
            <input
              type="number" inputMode="numeric" autoFocus
              value={valueStr} onChange={e => setValueStr(e.target.value)}
              placeholder="Ej. 12000"
              style={inputStyle}
            />
          </div>
          <div style={{ flex: 1 }}>
            <FieldLabel>Hora</FieldLabel>
            <input
              type="time"
              value={timeStrInput} onChange={e => setTimeStrInput(e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>

        {error && <ErrorBox>{error}</ErrorBox>}

        {/* Resultados */}
        <div style={{ marginBottom: 6 }}>
          {value <= 0 ? (
            <div style={{ padding: '18px', textAlign: 'center', color: T.neutral[400], fontSize: 12.5 }}>
              Escribe un valor para buscar.
            </div>
          ) : candidates.length === 0 ? (
            <div style={{ padding: '18px', textAlign: 'center', color: T.neutral[500], fontSize: 12.5 }}>
              No hay ventas parecidas en ese rango. Prueba ampliar la hora o revisa el valor.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 280, overflowY: 'auto' }}>
              {candidates.map(({ sale }) => {
                const branch = branches.find(b => String(b.id) === String(sale.branchId))
                return (
                  <div key={sale.id} style={{
                    border: `1px solid ${T.neutral[200]}`, borderRadius: 12,
                    padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 13.5, fontWeight: 700, color: T.neutral[900],
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {fmtCOP(sale.total)} · {methodTag(sale)}
                      </div>
                      <div style={{
                        fontSize: 11.5, color: T.neutral[500], marginTop: 2,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {timeStr(sale)} · {sale.cashierName || 'Cajera'} · {branch?.name || '—'}
                      </div>
                    </div>
                    <button onClick={() => pick(sale)} disabled={!!busyId} style={{
                      ...solidBtn(T.copper[500]),
                      width: 'auto', flexShrink: 0, whiteSpace: 'nowrap',
                      padding: '8px 16px', fontSize: 12.5,
                    }}>
                      {busyId === sale.id ? '...' : 'Es esta'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <button onClick={onClose} disabled={!!busyId} style={{ ...ghostBtn, marginTop: 6 }}>
          Cerrar
        </button>
      </ModalCard>
    </ModalOverlay>
  )
}

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────
function isConfirmed(sale) {
  return sale?.transferConfirmation?.status === 'confirmed'
}

/**
 * Recalcula el cuadre del turno de una venta SOLO si ya está cerrado.
 * En turnos abiertos no hacemos nada: el cuadre se calcula al cerrarlos.
 * Tolerante a fallos: si no se puede, la corrección de la venta igual quedó.
 */
async function recomputeAffectedSession(sessionId, byUid) {
  if (!sessionId) return
  try {
    const snap = await getDoc(doc(firestoreDb, 'cashSessions', sessionId))
    if (!snap.exists()) return
    const st = snap.data().status
    if (st === 'closed' || st === 'pending_close') {
      await recomputeClosedSession(sessionId, { byUid })
    }
  } catch (e) {
    console.warn('[transferencias] no se pudo recalcular el cierre:', e?.message || e)
  }
}

function timeMs(sale) {
  return sale.createdAt?.toMillis?.() ?? sale.createdAtClient ?? 0
}

function timeStr(sale) {
  const d = sale.createdAt?.toDate?.()
  if (!d) return '—'
  return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Bogota' })
}

/** Minutos del día (zona Bogotá) de una venta, o null. */
function saleMinutes(sale) {
  const d = sale.createdAt?.toDate?.()
  if (!d) return null
  const hhmm = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Bogota' })
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function parseTimeInput(str) {
  if (!str || !/^\d{1,2}:\d{2}$/.test(str)) return null
  const [h, m] = str.split(':').map(Number)
  return h * 60 + m
}

function defaultTimeInput(date) {
  const todayStr = getBogotaDateStr()
  if (date !== todayStr) return '12:00'
  const now = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Bogota' })
  return now
}

function methodTag(sale) {
  const map = { efectivo: 'Efectivo', nequi: 'NEQUI', daviplata: 'DAVIPLATA', mixto: 'Mixto', deuda: 'Deuda' }
  return map[sale.paymentMethod] || sale.paymentMethod
}

function EmptyState({ icon, text }) {
  return (
    <div style={{ padding: '48px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 36 }}>{icon}</div>
      <div style={{ fontSize: 14, color: T.neutral[400], marginTop: 12 }}>{text}</div>
    </div>
  )
}

const navBtn = {
  width: 36, height: 36, borderRadius: 999,
  background: 'rgba(255,255,255,0.12)', border: 'none',
  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
}

const inputStyle = {
  width: '100%', padding: '10px 12px', borderRadius: 10,
  border: `1px solid ${T.neutral[200]}`, background: '#fff',
  fontFamily: 'inherit', fontSize: 14, color: T.neutral[900],
  outline: 'none', boxSizing: 'border-box',
}

function FieldLabel({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: T.neutral[500], letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 5 }}>
      {children}
    </div>
  )
}

function ActionBtn({ color, title, subtitle, onClick, disabled }) {
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled} style={{
      width: '100%', padding: '12px 14px', borderRadius: 12, marginBottom: 8,
      background: '#fff', border: `1.5px solid ${color}55`,
      cursor: disabled ? 'wait' : 'pointer', fontFamily: 'inherit', textAlign: 'left',
      opacity: disabled ? 0.6 : 1,
    }}>
      <div style={{ fontSize: 14, fontWeight: 800, color }}>{title}</div>
      <div style={{ fontSize: 11.5, color: T.neutral[500], marginTop: 2, lineHeight: 1.4 }}>{subtitle}</div>
    </button>
  )
}

function solidBtn(bg) {
  return {
    width: '100%', padding: '12px', borderRadius: 12, border: 'none',
    background: bg, color: '#fff', cursor: 'pointer', fontFamily: 'inherit',
    fontSize: 14, fontWeight: 700,
  }
}

const ghostBtn = {
  width: '100%', padding: '12px', borderRadius: 12, border: 'none',
  background: T.neutral[100], color: T.neutral[700], cursor: 'pointer',
  fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
}

function ErrorBox({ children }) {
  return (
    <div style={{
      marginBottom: 12, padding: '10px 12px', borderRadius: 10,
      background: '#FBE9E5', border: `1px solid #F0C8BE`, color: T.bad,
      fontSize: 12.5, fontWeight: 500, textAlign: 'center',
    }}>
      {children}
    </div>
  )
}

function ModalOverlay({ onClose, children }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 90,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      {children}
    </div>
  )
}

function ModalCard({ children }) {
  return (
    <div onClick={e => e.stopPropagation()} style={{
      width: '100%', maxWidth: 440, background: '#fff', borderRadius: 22,
      padding: '22px 20px 20px', boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
      animation: 'fadeScaleIn 0.2s ease', maxHeight: '92vh', overflowY: 'auto',
    }}>
      {children}
    </div>
  )
}

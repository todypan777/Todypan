import { useEffect, useMemo, useRef, useState } from 'react'
import { T } from '../tokens'
import { fmtCOP, fmtDate } from '../utils/format'
import { Card } from '../components/Atoms'
import { ScreenHeader } from '../components/Nav'
import { useIsDesktop } from '../context/DesktopCtx'
import { watchDebtors, registerDebtorPayment, mergeDebtors, computeDebtorOwed, recomputeAllDebtorBalances, deleteDebtorHistoryEntry, editDebtorPaymentAmount, deleteDebtorSaleEntry } from '../debtors'
import { watchSalesByDebtor } from '../sales'
import { compressAndUpload } from '../utils/imagebb'
import { useAuth } from '../context/AuthCtx'
import { getData } from '../db'
import { SaleDetailModal } from './Ventas'

export default function Deudores({ onBack }) {
  const isDesktop = useIsDesktop()
  const { isAdmin } = useAuth()
  const [debtors, setDebtors] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('active')
  const [selected, setSelected] = useState(null)
  // Modo fusión: seleccionar varios deudores para unirlos en uno.
  const [mergeMode, setMergeMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState([])
  const [mergeModalOpen, setMergeModalOpen] = useState(false)
  // Reparación de balances drifteados (admin-only).
  const [repairing, setRepairing] = useState(false)
  const [repairResult, setRepairResult] = useState(null)
  // Venta a gestionar (editar/eliminar) desde el historial de un deudor.
  // Reutiliza el SaleDetailModal de Ventas para no descuadrar la colección sales.
  const [saleToManage, setSaleToManage] = useState(null)
  const branches = getData().branches || []

  useEffect(() => {
    const unsub = watchDebtors(list => {
      setDebtors(list)
      setLoading(false)
    })
    return unsub
  }, [])

  // Deudores "vivos": excluimos los fusionados (mergedInto). Son tombstones
  // ocultos que solo existen para auditoría; no deben listarse, contarse ni
  // sumarse en ningún lado.
  // Enriquecemos cada deudor con `owed` = balance real desde el historial,
  // porque `totalOwed` es un cache denormalizado que históricamente se
  // desincronizaba (clamps de pagos, races en addDebtSale).
  const liveDebtors = useMemo(
    () => debtors
      .filter(d => !d.mergedInto)
      .map(d => ({ ...d, owed: computeDebtorOwed(d) })),
    [debtors],
  )

  // Deudor seleccionado SIEMPRE en vivo: cuando watchDebtors trae cambios
  // (tras editar/borrar un movimiento), el modal de detalle se refresca solo
  // en vez de quedar con el snapshot viejo del momento del click.
  const selectedLive = useMemo(
    () => selected ? (liveDebtors.find(d => d.id === selected.id) || selected) : null,
    [selected, liveDebtors],
  )

  // Drift detectado: deudores cuyo totalOwed cached difiere del balance real.
  // Solo el admin ve el botón para repararlos (escribir el real en Firestore).
  const driftCount = useMemo(
    () => liveDebtors.filter(d => Math.abs((Number(d.totalOwed) || 0) - d.owed) >= 0.5).length,
    [liveDebtors],
  )

  // Filtros y conteos basados en el balance real (`owed` derivado del historial).
  const filtered = useMemo(() => {
    const list = liveDebtors.filter(d => {
      if (tab === 'active' && d.owed <= 0) return false
      if (tab === 'paid' && d.owed > 0) return false
      if (search.trim()) {
        const q = search.toLowerCase().trim()
        if (!(d.name || '').toLowerCase().includes(q)) return false
      }
      return true
    })
    list.sort((a, b) => b.owed - a.owed)
    return list
  }, [liveDebtors, tab, search])

  const totalActive = liveDebtors.filter(d => d.owed > 0).reduce((s, d) => s + d.owed, 0)
  const activeCount = liveDebtors.filter(d => d.owed > 0).length
  const paidCount = liveDebtors.filter(d => d.owed <= 0).length

  async function handleRepair() {
    if (!isAdmin || repairing) return
    if (!window.confirm(`¿Recalcular el balance de ${driftCount} deudor${driftCount === 1 ? '' : 'es'} desde su historial?\n\nEsto reescribe el campo totalOwed de Firestore para que coincida con la suma real del historial. Es seguro y reversible (los movimientos no se tocan).`)) return
    setRepairing(true); setRepairResult(null)
    try {
      const result = await recomputeAllDebtorBalances()
      setRepairResult(result)
    } catch (err) {
      console.error('[debtors] repair error:', err)
      setRepairResult({ error: err?.message || 'No se pudo reparar.' })
    } finally {
      setRepairing(false)
    }
  }

  const selectedDebtors = useMemo(
    () => liveDebtors.filter(d => selectedIds.includes(d.id)),
    [liveDebtors, selectedIds]
  )

  function toggleSelect(id) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }
  function exitMergeMode() {
    setMergeMode(false)
    setSelectedIds([])
    setMergeModalOpen(false)
  }

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

        {/* Botón fusionar duplicados */}
        {!loading && liveDebtors.length >= 2 && (
          <button
            onClick={() => mergeMode ? exitMergeMode() : setMergeMode(true)}
            style={{
              marginTop: 8, width: '100%', padding: '10px',
              borderRadius: 12,
              background: mergeMode ? '#FBE9E5' : '#fff',
              color: mergeMode ? T.bad : T.copper[700],
              border: `1px solid ${mergeMode ? '#F0C8BE' : T.neutral[200]}`,
              cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 12.5, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            {mergeMode
              ? '✕ Cancelar fusión'
              : '🔗 Fusionar deudores repetidos'}
          </button>
        )}
        {mergeMode && (
          <div style={{
            marginTop: 6, fontSize: 11.5, color: T.neutral[500],
            textAlign: 'center', lineHeight: 1.4,
          }}>
            Marca los nombres que son la misma persona y toca <b>Fusionar</b>.
          </div>
        )}

        {/* Reparar balances desincronizados (admin) */}
        {isAdmin && !loading && driftCount > 0 && !mergeMode && (
          <button
            onClick={handleRepair}
            disabled={repairing}
            style={{
              marginTop: 8, width: '100%', padding: '10px',
              borderRadius: 12,
              background: '#FFF7E6', color: '#8A6A1A',
              border: '1px solid #F4E0BC',
              cursor: repairing ? 'wait' : 'pointer', fontFamily: 'inherit',
              fontSize: 12.5, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            {repairing
              ? 'Recalculando...'
              : `🔧 Reparar ${driftCount} balance${driftCount === 1 ? '' : 's'} desincronizado${driftCount === 1 ? '' : 's'}`}
          </button>
        )}
        {repairResult && (
          <div style={{
            marginTop: 6, padding: '8px 12px', borderRadius: 10,
            background: repairResult.error ? '#FBE9E5' : '#E8F4E8',
            border: `1px solid ${repairResult.error ? '#F0C8BE' : '#C5E0C5'}`,
            color: repairResult.error ? T.bad : T.ok,
            fontSize: 11.5, fontWeight: 600, lineHeight: 1.4,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          }}>
            <span>
              {repairResult.error
                ? `Error: ${repairResult.error}`
                : `✓ ${repairResult.fixed} reparado${repairResult.fixed === 1 ? '' : 's'} de ${repairResult.scanned} revisados.`}
            </span>
            <button onClick={() => setRepairResult(null)} style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'inherit', fontSize: 14, fontWeight: 800, padding: '0 4px',
            }}>×</button>
          </div>
        )}
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
                selectable={mergeMode}
                selected={selectedIds.includes(d.id)}
                onClick={() => mergeMode ? toggleSelect(d.id) : setSelected(d)}
              />
            ))}
          </Card>
        )}
      </div>

      {selectedLive && !mergeMode && (
        <DebtorDetailModal
          debtor={selectedLive}
          onClose={() => setSelected(null)}
          onManageSale={(sale) => setSaleToManage(sale)}
        />
      )}

      {/* Editar/eliminar una VENTA a crédito desde el historial del deudor.
          Reutiliza el modal de Ventas: él sincroniza la colección sales y
          ajusta la deuda (adjustDebtorForSaleChange). Se renderiza por encima
          del detalle del deudor. */}
      {saleToManage && (
        <SaleDetailModal
          sale={saleToManage}
          branches={branches}
          hideDelete
          onClose={() => setSaleToManage(null)}
          onUpdated={() => setSaleToManage(null)}
        />
      )}

      {/* Barra flotante en modo fusión */}
      {mergeMode && (
        <div style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 80,
          padding: '12px 16px calc(12px + env(safe-area-inset-bottom))',
          background: 'rgba(255,255,255,0.96)',
          backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
          borderTop: `1px solid ${T.neutral[200]}`,
          display: 'flex', alignItems: 'center', gap: 10,
          maxWidth: 720, margin: '0 auto',
        }}>
          <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: T.neutral[700] }}>
            {selectedIds.length === 0
              ? 'Ninguno seleccionado'
              : `${selectedIds.length} seleccionado${selectedIds.length === 1 ? '' : 's'}`}
          </div>
          <button
            onClick={() => setMergeModalOpen(true)}
            disabled={selectedIds.length < 2}
            style={{
              padding: '11px 20px', borderRadius: 12,
              background: selectedIds.length >= 2 ? T.copper[500] : T.neutral[200],
              color: selectedIds.length >= 2 ? '#fff' : T.neutral[400],
              border: 'none', fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
              cursor: selectedIds.length >= 2 ? 'pointer' : 'not-allowed',
              boxShadow: selectedIds.length >= 2 ? '0 3px 10px rgba(184,122,86,0.3)' : 'none',
            }}
          >
            Fusionar
          </button>
        </div>
      )}

      {mergeModalOpen && (
        <MergeModal
          debtors={selectedDebtors}
          onCancel={() => setMergeModalOpen(false)}
          onDone={exitMergeMode}
        />
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Modal de confirmación de fusión
// ──────────────────────────────────────────────────────────────
function MergeModal({ debtors, onCancel, onDone }) {
  const { authUser } = useAuth()
  // `debtors` ya viene enriquecido con `owed` (balance real desde history).
  // Superviviente sugerido: el de mayor deuda (suele ser el "real").
  const suggested = useMemo(() => {
    return [...debtors].sort((a, b) => (Number(b.owed) || 0) - (Number(a.owed) || 0))[0]
  }, [debtors])

  const [survivorId, setSurvivorId] = useState(suggested?.id || null)
  const [finalName, setFinalName] = useState(suggested?.name || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const combinedOwed = debtors.reduce((s, d) => s + (Number(d.owed) || 0), 0)
  const totalMovs = debtors.reduce((s, d) => s + (d.history?.length || 0), 0)
  const valid = finalName.trim().length >= 2 && survivorId && debtors.length >= 2

  // Cuando el admin elige otro principal, sugerimos su nombre (si no tocó el campo).
  function pickSurvivor(id) {
    const prevName = debtors.find(d => d.id === survivorId)?.name || ''
    setSurvivorId(id)
    if (finalName.trim() === prevName.trim()) {
      setFinalName(debtors.find(d => d.id === id)?.name || finalName)
    }
  }

  async function handleConfirm() {
    if (!valid || busy) return
    setBusy(true); setError(null)
    try {
      await mergeDebtors({
        debtorIds: debtors.map(d => d.id),
        survivorId,
        finalName: finalName.trim(),
        byUid: authUser?.uid,
      })
      onDone()
    } catch (err) {
      console.error('[merge] error:', err)
      const code = err?.code || ''
      setError(code === 'permission-denied'
        ? 'Las reglas de Firestore no permiten esta acción. Avisa al administrador del sistema.'
        : (err?.message || 'No se pudo fusionar. Intenta de nuevo.'))
      setBusy(false)
    }
  }

  return (
    <div onClick={busy ? undefined : onCancel} style={{
      position: 'fixed', inset: 0, zIndex: 95,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 460, background: '#fff', borderRadius: 22,
        boxShadow: '0 16px 48px rgba(0,0,0,0.2)', maxHeight: '92vh', overflowY: 'auto',
      }}>
        <div style={{ padding: '22px 22px 4px' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3 }}>
            Fusionar {debtors.length} deudores
          </div>
          <div style={{ fontSize: 12.5, color: T.neutral[500], marginTop: 4, lineHeight: 1.5 }}>
            Se unirán en un solo deudor. Las deudas se suman y todos los movimientos
            quedan bajo el nombre que elijas. Esta acción no se deshace fácilmente.
          </div>
        </div>

        {/* Quién queda como principal */}
        <div style={{ padding: '14px 22px 0' }}>
          <Label>Deudor principal (sobre el que se unen)</Label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
            {[...debtors]
              .sort((a, b) => (Number(b.owed) || 0) - (Number(a.owed) || 0))
              .map(d => {
                const active = d.id === survivorId
                return (
                  <button
                    key={d.id}
                    onClick={() => pickSurvivor(d.id)}
                    disabled={busy}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                      padding: '10px 12px', borderRadius: 12, textAlign: 'left',
                      background: active ? T.copper[50] : '#fff',
                      border: `1.5px solid ${active ? T.copper[400] : T.neutral[200]}`,
                      cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span style={{
                        width: 16, height: 16, borderRadius: 999, flexShrink: 0,
                        border: `2px solid ${active ? T.copper[500] : T.neutral[300]}`,
                        background: active ? T.copper[500] : '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {active && <span style={{ width: 6, height: 6, borderRadius: 999, background: '#fff' }} />}
                      </span>
                      <span style={{
                        fontSize: 13.5, fontWeight: 700, color: T.neutral[900],
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {d.name}
                      </span>
                    </span>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: T.bad, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                      {fmtCOP(d.owed || 0)}
                    </span>
                  </button>
                )
              })}
          </div>

          <Label>Nombre final</Label>
          <input
            value={finalName}
            onChange={e => setFinalName(e.target.value)}
            placeholder="Nombre del deudor"
            disabled={busy}
            style={{
              width: '100%', padding: '11px 12px', borderRadius: 12,
              border: `1px solid ${T.neutral[200]}`, background: '#fff',
              fontFamily: 'inherit', fontSize: 14, fontWeight: 600,
              color: T.neutral[900], outline: 'none', boxSizing: 'border-box',
              marginBottom: 12,
            }}
          />

          {/* Resumen */}
          <div style={{
            padding: '12px 14px', borderRadius: 12, marginBottom: 4,
            background: T.neutral[50], border: `1px solid ${T.neutral[100]}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: T.neutral[600], marginBottom: 4 }}>
              <span>Deuda combinada</span>
              <span style={{ fontWeight: 800, color: T.bad, fontVariantNumeric: 'tabular-nums' }}>{fmtCOP(combinedOwed)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: T.neutral[600] }}>
              <span>Movimientos totales</span>
              <span style={{ fontWeight: 700, color: T.neutral[800] }}>{totalMovs}</span>
            </div>
          </div>
        </div>

        {error && (
          <div style={{ padding: '0 22px' }}>
            <div style={{
              marginTop: 12, padding: '10px 12px', borderRadius: 10,
              background: '#FBE9E5', border: `1px solid #F0C8BE`, color: T.bad,
              fontSize: 12.5, fontWeight: 500, textAlign: 'center',
            }}>
              {error}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, padding: '16px 22px 22px' }}>
          <button onClick={onCancel} disabled={busy} style={{
            flex: 1, padding: '12px', borderRadius: 12,
            background: '#fff', color: T.neutral[700],
            border: `1px solid ${T.neutral[200]}`,
            cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
            fontSize: 14, fontWeight: 700,
          }}>Cancelar</button>
          <button
            onClick={handleConfirm}
            disabled={!valid || busy}
            style={{
              flex: 1.4, padding: '12px', borderRadius: 12,
              background: valid && !busy ? T.copper[500] : T.neutral[200],
              color: valid && !busy ? '#fff' : T.neutral[400],
              border: 'none', cursor: valid && !busy ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
            }}
          >
            {busy ? 'Fusionando...' : 'Fusionar'}
          </button>
        </div>
      </div>
    </div>
  )
}

function DebtorRow({ debtor, isLast, onClick, selectable = false, selected = false }) {
  // `debtor.owed` viene enriquecido en liveDebtors (computeDebtorOwed del
  // historial); fallback a totalOwed si por alguna razón no estuviera.
  const owed = debtor.owed != null ? debtor.owed : (Number(debtor.totalOwed) || 0)
  const isPaid = owed <= 0
  const initials = (debtor.name || '?').split(' ').map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()

  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', padding: '12px 14px',
        background: selected ? T.copper[50] : 'transparent', border: 'none',
        borderBottom: isLast ? 'none' : `0.5px solid ${T.neutral[100]}`,
        cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
        display: 'flex', alignItems: 'center', gap: 12,
        transition: 'background 0.12s',
      }}
    >
      {selectable && (
        <div style={{
          width: 20, height: 20, borderRadius: 999, flexShrink: 0,
          border: `2px solid ${selected ? T.copper[500] : T.neutral[300]}`,
          background: selected ? T.copper[500] : '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: 12, fontWeight: 800,
        }}>
          {selected ? '✓' : ''}
        </div>
      )}
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
              {fmtCOP(owed)}
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
function DebtorDetailModal({ debtor, onClose, onManageSale }) {
  const { isAdmin, authUser } = useAuth()
  const [paying, setPaying] = useState(false)
  const [debtorSales, setDebtorSales] = useState([])

  // Solo admin: borrar/editar movimientos. Estas lanzan en error; HistoryItem
  // captura y muestra el mensaje inline.
  async function handleDeleteEntry(entry) {
    // Ventas: quitar del historial + marcar deleted en sales (baja la deuda y
    // desaparece). Abonos/ajustes: quitar del historial directo.
    if (entry.type === 'sale') {
      await deleteDebtorSaleEntry(debtor.id, entry, { byUid: authUser?.uid })
    } else {
      await deleteDebtorHistoryEntry(debtor.id, entry, { byUid: authUser?.uid })
    }
  }
  async function handleEditAmount(entry, newAmount) {
    await editDebtorPaymentAmount(debtor.id, entry, newAmount, { byUid: authUser?.uid })
  }
  // Balance real desde el historial (computeDebtorOwed). El `debtor` que llega
  // suele venir enriquecido con `owed`; recalculamos por seguridad en caso de
  // que el modal se haya abierto desde otro flujo.
  const owed = debtor.owed != null ? debtor.owed : computeDebtorOwed(debtor)
  const isPaid = owed <= 0

  // Cargar ventas asociadas al deudor para mostrar qué productos compró
  // en cada entry de historial.
  useEffect(() => watchSalesByDebtor(debtor.id, setDebtorSales), [debtor.id])

  const salesById = useMemo(() => {
    const map = {}
    debtorSales.forEach(s => { map[s.id] = s })
    return map
  }, [debtorSales])

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
            {isPaid ? '✅ Pagado' : fmtCOP(owed)}
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
                <HistoryItem
                  key={i}
                  entry={h}
                  sale={h.saleId ? salesById[h.saleId] : null}
                  isLast={i === history.length - 1}
                  isAdmin={isAdmin}
                  onDelete={handleDeleteEntry}
                  onEditAmount={handleEditAmount}
                  onManageSale={onManageSale}
                />
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

function HistoryItem({ entry, sale, isLast, isAdmin = false, onDelete, onEditAmount, onManageSale }) {
  const isPayment = entry.type === 'payment'
  const isSale = entry.type === 'sale'
  const isAdjustment = entry.type === 'adjustment'
  const [expanded, setExpanded] = useState(false)
  // UI de acciones admin (borrar/editar). mode: 'idle' | 'confirmDelete' | 'editAmount'.
  const [mode, setMode] = useState('idle')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [amtStr, setAmtStr] = useState('')

  // Los items del historial usan key por índice. Tras borrar, el componente en
  // un índice puede pasar a representar OTRA entrada: reseteamos la UI inline
  // cuando cambia la entrada para que el estado (busy/mode) no se "pegue" mal.
  const entrySig = `${entry.type}|${entry.createdAt ?? ''}|${entry.amount ?? ''}|${entry.delta ?? ''}`
  useEffect(() => {
    setMode('idle'); setBusy(false); setErr(null); setAmtStr('')
  }, [entrySig])

  async function doDelete() {
    if (busy) return
    setBusy(true); setErr(null)
    try {
      await onDelete?.(entry)
      // Éxito: el snapshot en vivo refresca la lista; este nodo se desmonta o
      // su `entry` cambia (efecto de arriba resetea). No tocamos estado aquí.
    } catch (e) {
      setErr(e?.message || 'No se pudo eliminar.')
      setBusy(false)
    }
  }
  async function doSaveAmount() {
    if (busy) return
    const n = Number(String(amtStr).replace(/[^0-9]/g, '')) || 0
    if (n <= 0) { setErr('El monto debe ser mayor a 0.'); return }
    setBusy(true); setErr(null)
    try {
      await onEditAmount?.(entry, n)
    } catch (e) {
      setErr(e?.message || 'No se pudo guardar.')
      setBusy(false)
    }
  }

  const date = entry.date
    ? new Date(entry.date + 'T00:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—'
  const methodLabel = entry.method
    ? { efectivo: '💵 Efectivo', nequi: '📱 NEQUI', daviplata: '📱 DAVIPLATA' }[entry.method] || entry.method
    : null

  const items = isSale && sale?.items ? sale.items : null
  const hasItems = items && items.length > 0
  const itemsSummary = hasItems
    ? items.map(it => `${it.qty}× ${it.name}`).join(' · ')
    : null

  // Solo es clickeable si tiene items para expandir
  const clickable = hasItems

  // Color e icono según tipo
  const tone = isPayment
    ? { bg: '#E8F4E8', color: T.ok, icon: '↓' }
    : isAdjustment
      ? { bg: T.neutral[100], color: T.neutral[600], icon: '✎' }
      : { bg: '#FBE9E5', color: T.bad, icon: '↑' }

  const titleLabel = isPayment
    ? 'Abono / Pago'
    : isAdjustment
      ? 'Ajuste'
      : 'Venta a crédito'

  return (
    <div
      onClick={clickable ? () => setExpanded(v => !v) : undefined}
      style={{
        padding: '10px 12px',
        borderBottom: isLast ? 'none' : `0.5px solid ${T.neutral[100]}`,
        cursor: clickable ? 'pointer' : 'default',
        transition: 'background 0.12s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 999, flexShrink: 0,
          background: tone.bg, color: tone.color,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 800, marginTop: 1,
        }}>
          {tone.icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: T.neutral[900] }}>
              {titleLabel}
            </span>
            {hasItems && !expanded && (
              <span style={{
                fontSize: 10.5, fontWeight: 700, color: T.copper[700],
                background: T.copper[50], padding: '1px 7px', borderRadius: 999,
              }}>
                {items.length} {items.length === 1 ? 'producto' : 'productos'}
              </span>
            )}
          </div>

          <div style={{ fontSize: 11, color: T.neutral[500], marginTop: 2 }}>
            {date}
            {methodLabel && ` · ${methodLabel}`}
            {clickable && (
              <span style={{ marginLeft: 6, color: T.copper[600], fontWeight: 600 }}>
                {expanded ? '▴ Ocultar' : '▾ Ver productos'}
              </span>
            )}
          </div>

          {/* Resumen compacto cuando NO está expandido */}
          {hasItems && !expanded && (
            <div style={{
              fontSize: 12, color: T.neutral[700], marginTop: 4, lineHeight: 1.4,
              display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}>
              {itemsSummary}
            </div>
          )}

          {/* Lista detallada cuando está expandido */}
          {hasItems && expanded && (
            <div style={{
              marginTop: 8, padding: '8px 10px', borderRadius: 10,
              background: '#fff', border: `1px solid ${T.neutral[100]}`,
            }}>
              {items.map((it, i) => (
                <div key={i} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                  padding: '3px 0',
                  borderBottom: i < items.length - 1 ? `0.5px dashed ${T.neutral[100]}` : 'none',
                  gap: 8,
                }}>
                  <span style={{ fontSize: 12, color: T.neutral[800], minWidth: 0 }}>
                    <span style={{ fontWeight: 700, color: T.copper[700], marginRight: 6 }}>
                      {it.qty}×
                    </span>
                    {it.name}
                  </span>
                  <span style={{
                    fontSize: 12, color: T.neutral[600], fontVariantNumeric: 'tabular-nums',
                    flexShrink: 0,
                  }}>
                    {fmtCOP(it.subtotal || 0)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {entry.note && (
            <div style={{ fontSize: 11.5, color: T.neutral[600], fontStyle: 'italic', marginTop: 3 }}>
              "{entry.note}"
            </div>
          )}
          {entry.photoUrl && (
            <a
              href={entry.photoUrl}
              target="_blank"
              rel="noreferrer"
              onClick={e => e.stopPropagation()}
              style={{
                fontSize: 11, color: T.copper[600], textDecoration: 'underline', fontWeight: 600,
                marginTop: 3, display: 'inline-block',
              }}
            >
              📎 Ver comprobante
            </a>
          )}
        </div>
        <div style={{
          fontSize: 14, fontWeight: 800,
          color: isPayment ? T.ok : isAdjustment ? T.neutral[600] : T.bad,
          fontVariantNumeric: 'tabular-nums', flexShrink: 0,
        }}>
          {isPayment ? '−' : isAdjustment && entry.delta < 0 ? '−' : '+'}{fmtCOP(Math.abs(entry.amount || entry.delta || 0))}
        </div>
      </div>

      {/* Acciones admin: editar/eliminar movimiento. stopPropagation para no
          disparar el expand de productos del item. */}
      {isAdmin && (
        <div onClick={e => e.stopPropagation()} style={{ marginTop: 8, marginLeft: 42 }}>
          {mode === 'idle' && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {isSale ? (
                <>
                  {sale && (
                    <button onClick={() => onManageSale?.(sale)} style={histActionBtn(false)}>
                      ✎ Editar venta
                    </button>
                  )}
                  <button onClick={() => { setErr(null); setMode('confirmDelete') }} style={histActionBtn(true)}>
                    🗑 Eliminar
                  </button>
                </>
              ) : (
                <>
                  {isPayment && (
                    <button
                      onClick={() => { setAmtStr(String(Math.round(Number(entry.amount) || 0))); setErr(null); setMode('editAmount') }}
                      style={histActionBtn(false)}
                    >
                      ✎ Editar monto
                    </button>
                  )}
                  <button onClick={() => { setErr(null); setMode('confirmDelete') }} style={histActionBtn(true)}>
                    🗑 Eliminar
                  </button>
                </>
              )}
            </div>
          )}

          {mode === 'confirmDelete' && (
            <div style={{ padding: '8px 10px', borderRadius: 10, background: '#FBE9E5', border: '1px solid #F0C8BE' }}>
              <div style={{ fontSize: 11.5, color: T.bad, fontWeight: 600, marginBottom: 8, lineHeight: 1.4 }}>
                {isSale
                  ? '¿Eliminar esta venta a crédito? Se quita del historial, la deuda baja y la venta queda marcada como eliminada en reportes.'
                  : isAdjustment
                    ? '¿Eliminar este ajuste? El saldo se recalcula. Si correspondía a una venta editada, podría descuadrar esa corrección.'
                    : '¿Eliminar este abono? El saldo del deudor se recalcula automáticamente.'}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button disabled={busy} onClick={doDelete} style={{ ...histActionBtn(true), opacity: busy ? 0.6 : 1 }}>
                  {busy ? 'Eliminando…' : 'Sí, eliminar'}
                </button>
                <button disabled={busy} onClick={() => setMode('idle')} style={histActionBtn(false)}>
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {mode === 'editAmount' && (
            <div style={{ padding: '8px 10px', borderRadius: 10, background: '#fff', border: `1px solid ${T.neutral[200]}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <span style={{ color: T.neutral[500], fontSize: 13, fontWeight: 600 }}>$</span>
                <input
                  type="text" inputMode="numeric" autoFocus disabled={busy}
                  value={amtStr}
                  onChange={e => setAmtStr(e.target.value.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, ''))}
                  style={{
                    flex: 1, minWidth: 0, padding: '7px 10px', borderRadius: 8,
                    border: `1px solid ${T.neutral[200]}`, outline: 'none',
                    fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
                    color: T.neutral[900], fontVariantNumeric: 'tabular-nums', boxSizing: 'border-box',
                  }}
                />
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button disabled={busy} onClick={doSaveAmount} style={{ ...histActionBtn(false), background: T.ok, color: '#fff', border: 'none', opacity: busy ? 0.6 : 1 }}>
                  {busy ? 'Guardando…' : 'Guardar'}
                </button>
                <button disabled={busy} onClick={() => setMode('idle')} style={histActionBtn(false)}>
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {err && (
            <div style={{ marginTop: 6, fontSize: 11, color: T.bad, fontWeight: 600 }}>
              {err}
            </div>
          )}
        </div>
      )}
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
  // Balance real desde el historial — no usar el cache `totalOwed`.
  const totalOwed = debtor.owed != null ? debtor.owed : computeDebtorOwed(debtor)
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
function histActionBtn(danger) {
  return {
    padding: '6px 10px', borderRadius: 8,
    background: danger ? '#FBE9E5' : T.neutral[100],
    color: danger ? T.bad : T.neutral[700],
    border: danger ? '1px solid #F0C8BE' : `1px solid ${T.neutral[200]}`,
    cursor: 'pointer', fontFamily: 'inherit',
    fontSize: 11.5, fontWeight: 700,
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

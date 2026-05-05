import { useEffect, useMemo, useState } from 'react'
import { T } from '../tokens'
import { fmtCOP } from '../utils/format'
import { getData } from '../db'
import {
  watchCashierProducts,
  mergeProductCatalogs,
} from '../products'
import { normalizeName } from '../debtors'
import {
  watchPendingChangeRequestForProduct,
  createChangeRequest,
} from '../productChangeRequests'

/**
 * Catálogo completo de productos para la cajera. Acceso desde el menú del
 * avatar. Permite buscar y solicitar cambios (nombre / precios) que el
 * admin debe aprobar.
 */
export default function ProductCatalogPanel({
  branchId, branchName, branches,
  cashierUid, cashierName,
  onClose,
}) {
  const [cashierProducts, setCashierProducts] = useState([])
  useEffect(() => watchCashierProducts(setCashierProducts), [])

  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(null)

  const adminProducts = getData().products || []
  const catalog = useMemo(
    () => mergeProductCatalogs(adminProducts, cashierProducts),
    [adminProducts, cashierProducts],
  )

  const filtered = useMemo(() => {
    const q = normalizeName(query)
    if (!q) return catalog
    return catalog.filter(p => normalizeName(p.name).includes(q))
  }, [catalog, query])

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 70,
      background: T.neutral[50],
      display: 'flex', flexDirection: 'column',
      animation: 'slideUp 0.25s cubic-bezier(0.2,0.9,0.3,1.05)',
    }}>
      <div style={{
        background: '#fff', borderBottom: `1px solid ${T.neutral[100]}`,
        position: 'sticky', top: 0, zIndex: 5,
      }}>
        <div style={{
          maxWidth: 640, margin: '0 auto',
          padding: '16px 18px',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <button onClick={onClose} style={{
            width: 36, height: 36, borderRadius: 999,
            background: T.neutral[100], border: 'none',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M11 4 L5 9 L11 14" stroke={T.neutral[700]} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: T.neutral[900], letterSpacing: -0.2 }}>
              Catálogo de productos
            </div>
            <div style={{ fontSize: 12, color: T.neutral[500] }}>
              Toca un producto si necesitas reportar un cambio
            </div>
          </div>
        </div>

        {/* Buscador */}
        <div style={{ padding: '0 18px 14px', maxWidth: 640, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
          <div style={{
            border: `1.5px solid ${T.neutral[200]}`, borderRadius: 14, background: '#fff',
            display: 'flex', alignItems: 'center',
          }}>
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" style={{ marginLeft: 14 }}>
              <circle cx="9" cy="9" r="6" stroke={T.neutral[400]} strokeWidth="1.7" fill="none"/>
              <path d="M14 14 L18 18" stroke={T.neutral[400]} strokeWidth="1.7" strokeLinecap="round"/>
            </svg>
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Buscar producto..."
              style={{
                width: '100%', padding: '12px 14px', border: 'none', outline: 'none',
                fontFamily: 'inherit', fontSize: 14.5, color: T.neutral[900],
                background: 'transparent',
              }}
            />
          </div>
        </div>
      </div>

      {/* Lista */}
      <div style={{
        flex: 1, padding: '12px 16px 24px',
        maxWidth: 640, margin: '0 auto', width: '100%',
        boxSizing: 'border-box', overflowY: 'auto',
      }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '40px 24px', textAlign: 'center', color: T.neutral[500], fontSize: 13 }}>
            Sin resultados
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map(p => (
              <CatalogRow
                key={p.source + '_' + p.id}
                product={p}
                branches={branches}
                onTap={() => setEditing(p)}
              />
            ))}
          </div>
        )}
      </div>

      {editing && (
        <ChangeRequestModal
          product={editing}
          branches={branches}
          branchId={branchId}
          branchName={branchName}
          cashierUid={cashierUid}
          cashierName={cashierName}
          onCancel={() => setEditing(null)}
          onSent={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function CatalogRow({ product, branches, onTap }) {
  const breakdown = (branches || [])
    .map(b => {
      const v = product.pricesByBranch?.[String(b.id)]
      return v && Number(v) > 0 ? { name: b.name, price: Number(v) } : null
    })
    .filter(Boolean)

  return (
    <button
      onClick={onTap}
      style={{
        width: '100%', padding: '12px 14px',
        background: '#fff', border: `1px solid ${T.neutral[100]}`,
        borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit',
        textAlign: 'left',
      }}
    >
      <div style={{ fontSize: 14.5, fontWeight: 700, color: T.neutral[900] }}>
        {product.name}
      </div>
      <div style={{ fontSize: 11.5, color: T.neutral[500], marginTop: 3 }}>
        {breakdown.length === 0
          ? <span style={{ fontStyle: 'italic' }}>sin precios definidos</span>
          : breakdown.map(b => `${b.name}: ${fmtCOP(b.price)}`).join(' · ')}
      </div>
    </button>
  )
}

// ──────────────────────────────────────────────────────────────
// MODAL: Solicitar cambio de producto
// ──────────────────────────────────────────────────────────────
function ChangeRequestModal({
  product, branches, branchId, branchName,
  cashierUid, cashierName,
  onCancel, onSent,
}) {
  const [name, setName] = useState(product.name || '')
  const [priceInputs, setPriceInputs] = useState(() => {
    const init = {}
    ;(branches || []).forEach(b => {
      const v = product.pricesByBranch?.[String(b.id)]
      init[String(b.id)] = v && Number(v) > 0 ? String(v) : ''
    })
    return init
  })
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // Verificar si ya hay una solicitud pendiente para este producto
  const [existingReq, setExistingReq] = useState(undefined) // undefined = cargando
  useEffect(
    () => watchPendingChangeRequestForProduct(product.id, setExistingReq),
    [product.id],
  )

  function setPriceFor(bid, val) {
    setPriceInputs(prev => ({ ...prev, [String(bid)]: val.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '') }))
  }

  // Construir el mapa de precios solicitado (entradas con valor > 0)
  const requestedPrices = useMemo(() => {
    const out = {}
    Object.entries(priceInputs).forEach(([bid, val]) => {
      const num = Number(val)
      if (num > 0) out[bid] = num
    })
    return out
  }, [priceInputs])

  // Detectar si hay algún cambio respecto al producto actual
  const nameChanged = (name || '').trim() !== (product.name || '').trim()
  const pricesChanged = useMemo(() => {
    const cur = product.pricesByBranch || {}
    const req = requestedPrices
    const allKeys = new Set([...Object.keys(cur), ...Object.keys(req)])
    for (const k of allKeys) {
      if (Number(cur[k] || 0) !== Number(req[k] || 0)) return true
    }
    return false
  }, [product.pricesByBranch, requestedPrices])

  const hasChanges = nameChanged || pricesChanged
  const canSubmit = !busy && hasChanges && (name || '').trim().length >= 2 && !existingReq

  async function handleSubmit() {
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      await createChangeRequest({
        productId: product.id,
        source: product.source || 'admin',
        currentName: product.name || '',
        requestedName: name.trim(),
        currentPricesByBranch: product.pricesByBranch || {},
        requestedPricesByBranch: requestedPrices,
        cashierUid, cashierName,
        branchId, branchName,
        reason,
      })
      onSent()
    } catch (err) {
      console.error('[changeReq] create failed:', err)
      const code = err?.code || ''
      if (code === 'permission-denied') {
        setError('Las reglas de Firestore bloquean esta acción. El admin debe habilitar /productChangeRequests.')
      } else {
        setError('No se pudo enviar la solicitud. Intenta de nuevo.')
      }
      setBusy(false)
    }
  }

  return (
    <ModalOverlay onClose={busy ? undefined : onCancel}>
      <div onClick={e => e.stopPropagation()} style={modalCard()}>
        <div style={{ fontSize: 18, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3, marginBottom: 4 }}>
          Reportar cambio
        </div>
        <div style={{ fontSize: 12.5, color: T.neutral[500], marginBottom: 16, lineHeight: 1.5 }}>
          El admin recibe la solicitud y decide si la aplica.
        </div>

        {existingReq && (
          <div style={{
            padding: '12px 14px', borderRadius: 12,
            background: '#FFF7E6', border: `1px solid #F4E0BC`,
            fontSize: 12.5, color: T.warn, fontWeight: 600, lineHeight: 1.5,
            marginBottom: 14,
          }}>
            Ya hay una solicitud pendiente para este producto
            {existingReq.cashierName ? ` (enviada por ${existingReq.cashierName})` : ''}.
            Espera a que el admin la responda.
          </div>
        )}

        <FieldLabel>Nombre</FieldLabel>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          disabled={busy || !!existingReq}
          style={inputStyle(nameChanged)}
        />

        <div style={{ height: 12 }} />

        <FieldLabel>Precios por panadería</FieldLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(branches || []).map(b => {
            const cur = Number(product.pricesByBranch?.[String(b.id)]) || 0
            const req = Number(priceInputs[String(b.id)]) || 0
            const changed = cur !== req
            return (
              <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  flex: 1, fontSize: 13, fontWeight: 600, color: T.neutral[700],
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {b.name}
                </div>
                <div style={{
                  flex: 1, maxWidth: 160, display: 'flex', alignItems: 'center',
                  border: `1.5px solid ${changed ? T.copper[400] : T.neutral[200]}`,
                  borderRadius: 12, background: '#fff',
                }}>
                  <span style={{ paddingLeft: 12, color: T.neutral[500], fontSize: 14, fontWeight: 600 }}>$</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={priceInputs[String(b.id)] || ''}
                    onChange={e => setPriceFor(b.id, e.target.value)}
                    placeholder="0"
                    disabled={busy || !!existingReq}
                    style={{
                      width: '100%', padding: '10px 12px 10px 6px', border: 'none', outline: 'none',
                      fontFamily: 'inherit', fontSize: 15, color: T.neutral[900],
                      background: 'transparent', borderRadius: 12,
                      fontVariantNumeric: 'tabular-nums', fontWeight: 600,
                    }}
                  />
                </div>
              </div>
            )
          })}
        </div>

        <div style={{ height: 12 }} />

        <FieldLabel>Motivo (opcional)</FieldLabel>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="Ej: nombre mal escrito, subió el costo, etc."
          disabled={busy || !!existingReq}
          rows={2}
          style={{
            ...inputStyle(false),
            resize: 'vertical', minHeight: 56, lineHeight: 1.4,
          }}
        />

        {error && (
          <div style={{
            marginTop: 10, padding: '10px 12px', borderRadius: 10,
            background: '#FBE9E5', border: `1px solid #F0C8BE`, color: T.bad,
            fontSize: 12.5, fontWeight: 500, textAlign: 'center',
          }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button onClick={onCancel} disabled={busy} style={btnSecondary()}>Cancelar</button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{
              ...btnPrimary(canSubmit ? T.copper[500] : T.neutral[200]),
              flex: 1.4,
              color: canSubmit ? '#fff' : T.neutral[400],
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              boxShadow: canSubmit ? '0 3px 10px rgba(184,122,86,0.3)' : 'none',
            }}
          >
            {busy ? 'Enviando...' : 'Enviar solicitud'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

// ── Helpers de UI ─────────────────────────────────────────────
function FieldLabel({ children }) {
  return (
    <label style={{
      fontSize: 12, fontWeight: 600, color: T.neutral[600],
      display: 'block', marginBottom: 6,
    }}>
      {children}
    </label>
  )
}

function inputStyle(highlighted) {
  return {
    width: '100%', padding: '11px 14px',
    border: `1.5px solid ${highlighted ? T.copper[400] : T.neutral[200]}`,
    borderRadius: 12, background: '#fff',
    fontFamily: 'inherit', fontSize: 14.5, color: T.neutral[900],
    outline: 'none', boxSizing: 'border-box',
  }
}

function btnPrimary(bg) {
  return {
    flex: 1, padding: '12px', borderRadius: 14, border: 'none',
    background: bg, fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
  }
}

function btnSecondary() {
  return {
    flex: 1, padding: '12px', borderRadius: 14, border: 'none',
    background: T.neutral[100], color: T.neutral[700],
    cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
  }
}

function ModalOverlay({ onClose, children }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 90,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      {children}
    </div>
  )
}

function modalCard() {
  return {
    width: '100%', maxWidth: 460,
    background: '#fff', borderRadius: 22,
    padding: '24px 22px 22px',
    boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
    animation: 'fadeScaleIn 0.2s ease',
    maxHeight: '92vh', overflowY: 'auto',
  }
}

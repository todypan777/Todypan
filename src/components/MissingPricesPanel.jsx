import { useEffect, useMemo, useState } from 'react'
import { T } from '../tokens'
import { fmtCOP } from '../utils/format'
import { getData, setProductPriceForBranch } from '../db'
import {
  watchCashierProducts,
  mergeProductCatalogs,
  setCashierProductPriceForBranch,
  getProductPrice,
} from '../products'

/**
 * Panel modal "¿Tiempo libre?" — lista los productos del catálogo que NO
 * tienen precio en la panadería activa, y permite a la cajera ponerles
 * precio rápidamente sin tener que hacer una venta.
 *
 * Props:
 *   - branchId, branchName: panadería activa
 *   - branches: lista de panaderías para mostrar precios de referencia
 *   - onClose
 */
export default function MissingPricesPanel({ branchId, branchName, branches, onClose }) {
  const [cashierProducts, setCashierProducts] = useState([])
  useEffect(() => watchCashierProducts(setCashierProducts), [])

  const adminProducts = getData().products || []
  const catalog = useMemo(
    () => mergeProductCatalogs(adminProducts, cashierProducts),
    [adminProducts, cashierProducts],
  )

  // Excluir productos de venta libre — no necesitan precio
  const missing = useMemo(
    () => catalog.filter(p => !p.freeAmount && getProductPrice(p, branchId) === null),
    [catalog, branchId],
  )

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 70,
      background: T.neutral[50],
      display: 'flex', flexDirection: 'column',
      animation: 'slideUp 0.25s cubic-bezier(0.2,0.9,0.3,1.05)',
    }}>
      {/* Header */}
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
              ¡Aprovecha tu tiempo!
            </div>
            <div style={{ fontSize: 12, color: T.neutral[500] }}>
              {missing.length > 0
                ? `Te falta poner precio a ${missing.length} producto${missing.length === 1 ? '' : 's'}`
                : `Todo al día en ${branchName || 'tu panadería'}`}
            </div>
          </div>
        </div>
      </div>

      {/* Contenido */}
      <div style={{
        flex: 1, padding: '14px 16px 24px',
        maxWidth: 640, margin: '0 auto', width: '100%',
        boxSizing: 'border-box', overflowY: 'auto',
      }}>
        {missing.length === 0 ? (
          <div style={{
            marginTop: 60, textAlign: 'center',
            padding: '32px 24px',
            background: '#E8F4E8', border: `1px solid #C2DDC1`,
            borderRadius: 18,
          }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: T.ok, marginBottom: 4 }}>
              ¡Todo al día!
            </div>
            <div style={{ fontSize: 13, color: T.neutral[600], lineHeight: 1.5 }}>
              Todos los productos tienen precio en {branchName || 'tu panadería'}.
            </div>
            <button onClick={onClose} style={{
              marginTop: 22, padding: '12px 28px', borderRadius: 14,
              background: T.ok, color: '#fff', border: 'none',
              cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 14.5, fontWeight: 700,
              boxShadow: `0 3px 10px ${T.ok}55`,
            }}>
              Cerrar
            </button>
          </div>
        ) : (
          <>
            <div style={{
              padding: '12px 14px', borderRadius: 12,
              background: T.copper[50], border: `1px solid ${T.copper[100]}`,
              fontSize: 12.5, color: T.copper[700], lineHeight: 1.55,
              marginBottom: 14,
            }}>
              💡 Estos productos los crearon en otra panadería. Pónles tu precio
              para que aparezcan al hacer ventas.
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {missing.map(p => (
                <MissingPriceRow
                  key={p.source + '_' + p.id}
                  product={p}
                  branchId={branchId}
                  branchName={branchName}
                  branches={branches}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function MissingPriceRow({ product, branchId, branchName, branches }) {
  const [priceStr, setPriceStr] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)

  // Mostrar el precio que tiene en otras panaderías (referencia)
  const otherPrices = (branches || [])
    .filter(b => String(b.id) !== String(branchId))
    .map(b => {
      const v = product.pricesByBranch?.[String(b.id)]
      return v && Number(v) > 0 ? { name: b.name, price: Number(v) } : null
    })
    .filter(Boolean)

  function sanitize(raw) {
    return raw.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '')
  }

  async function handleSave() {
    const num = Number(priceStr)
    if (!num || num <= 0 || busy) return
    setBusy(true)
    setError(null)
    try {
      if (product.source === 'admin') {
        setProductPriceForBranch(product.id, branchId, num)
      } else {
        await setCashierProductPriceForBranch(product.id, branchId, num)
      }
      setSaved(true)
      // Pequeño delay visual antes de que se filtre fuera de la lista
    } catch (err) {
      console.error('[MissingPrices] no se pudo guardar precio:', err)
      setError('No se pudo guardar. Intenta de nuevo.')
      setBusy(false)
    }
  }

  return (
    <div style={{
      padding: '14px 14px 12px', borderRadius: 14,
      background: '#fff', border: `1px solid ${saved ? '#C2DDC1' : T.neutral[100]}`,
      transition: 'opacity 0.3s, border-color 0.2s',
      opacity: saved ? 0.6 : 1,
    }}>
      <div style={{
        fontSize: 14.5, fontWeight: 700, color: T.neutral[900],
        marginBottom: 4,
      }}>
        {product.name}
      </div>
      {otherPrices.length > 0 && (
        <div style={{ fontSize: 11.5, color: T.neutral[500], marginBottom: 10 }}>
          Precio de referencia: {otherPrices.map(o => `${o.name} ${fmtCOP(o.price)}`).join(' · ')}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center',
          border: `1.5px solid ${T.neutral[200]}`, borderRadius: 12, background: '#fff',
        }}>
          <span style={{ paddingLeft: 14, color: T.neutral[500], fontSize: 15, fontWeight: 600 }}>$</span>
          <input
            type="text"
            inputMode="numeric"
            value={priceStr}
            onChange={e => { setPriceStr(sanitize(e.target.value)); setError(null) }}
            placeholder="0"
            disabled={busy || saved}
            style={{
              width: '100%', padding: '11px 14px 11px 8px', border: 'none', outline: 'none',
              fontFamily: 'inherit', fontSize: 16, color: T.neutral[900],
              background: 'transparent', borderRadius: 12,
              fontVariantNumeric: 'tabular-nums', fontWeight: 700,
            }}
          />
        </div>
        <button
          onClick={handleSave}
          disabled={!priceStr || Number(priceStr) <= 0 || busy || saved}
          style={{
            padding: '0 18px', borderRadius: 12, border: 'none',
            background: saved ? T.ok : (priceStr && Number(priceStr) > 0 && !busy ? T.copper[500] : T.neutral[200]),
            color: saved || (priceStr && Number(priceStr) > 0 && !busy) ? '#fff' : T.neutral[400],
            cursor: priceStr && !busy && !saved ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700,
            flexShrink: 0,
            boxShadow: priceStr && Number(priceStr) > 0 && !busy && !saved
              ? '0 2px 8px rgba(184,122,86,0.3)' : 'none',
          }}
        >
          {saved ? '✓' : busy ? '...' : 'Guardar'}
        </button>
      </div>
      {error && (
        <div style={{
          marginTop: 8, fontSize: 11.5, color: T.bad, fontWeight: 500,
        }}>
          {error}
        </div>
      )}
    </div>
  )
}

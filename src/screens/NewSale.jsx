import { useEffect, useMemo, useState, useRef } from 'react'
import { T } from '../tokens'
import { fmtCOP } from '../utils/format'
import { Card } from '../components/Atoms'
import { getData, setProductPriceForBranch } from '../db'
import {
  watchCashierProducts,
  mergeProductCatalogs,
  createCashierProduct,
  setCashierProductPriceForBranch,
  getProductPrice,
} from '../products'
import { watchDebtors, addDebtSale, normalizeName } from '../debtors'
import { createSale } from '../sales'
import { compressAndUpload } from '../utils/imagebb'

/**
 * Pantalla "Nueva venta" para cajera.
 * Flow:
 *  1. Buscar producto en catálogo (admin + cajera)
 *  2. Click → añadir al carrito
 *  3. Si no existe el producto buscado → modal "Crear al vuelo"
 *  4. Editar cantidades en carrito
 *  5. Botón "Cobrar" → modal de método de pago
 *  6. Confirmar → guarda venta en Firestore
 */
export default function NewSale({ session, authUser, userDoc, onCancel, onSaved }) {
  const cashierProducts = useCashierProducts()
  const adminProducts = getData().products || []
  const catalog = useMemo(
    () => mergeProductCatalogs(adminProducts, cashierProducts),
    [adminProducts, cashierProducts],
  )

  const [query, setQuery] = useState('')
  const [cart, setCart] = useState([]) // [{ key, productId, source, name, qty, unitPrice }]
  const [createOpen, setCreateOpen] = useState(false)
  const [createInitialName, setCreateInitialName] = useState('')
  const [paymentOpen, setPaymentOpen] = useState(false)
  // Modal "primera vez": producto que falta precio en la panaderia activa
  const [missingPriceProduct, setMissingPriceProduct] = useState(null)

  const branchId = session.branchId

  const total = cart.reduce((s, it) => s + it.qty * it.unitPrice, 0)

  const filtered = useMemo(() => {
    const q = normalizeName(query)
    if (!q) return catalog.slice(0, 12)
    return catalog
      .filter(p => normalizeName(p.name).includes(q))
      .slice(0, 30)
  }, [catalog, query])

  const exactMatch = filtered.some(p => normalizeName(p.name) === normalizeName(query))
  const showCreateOption = query.trim().length >= 2 && !exactMatch

  function addProductToCart(product, unitPrice) {
    setCart(prev => {
      const existing = prev.findIndex(it => it.productId === product.id && it.source === product.source)
      if (existing >= 0) {
        const next = [...prev]
        next[existing] = { ...next[existing], qty: next[existing].qty + 1 }
        return next
      }
      return [
        ...prev,
        {
          key: `${product.source}_${product.id}`,
          productId: product.id,
          source: product.source,
          name: product.name,
          qty: 1,
          unitPrice: Number(unitPrice) || 0,
        },
      ]
    })
    setQuery('')
  }

  function handleSelectProduct(product) {
    const price = getProductPrice(product, branchId)
    if (price !== null) {
      addProductToCart(product, price)
    } else {
      // Primera vez en esta panaderia: pedir precio
      setMissingPriceProduct(product)
    }
  }

  async function handleConfirmFirstTimePrice(price) {
    const product = missingPriceProduct
    if (!product || !price || Number(price) <= 0) return
    const num = Number(price)
    try {
      if (product.source === 'admin') {
        setProductPriceForBranch(product.id, branchId, num)
      } else if (product.source === 'cashier') {
        await setCashierProductPriceForBranch(product.id, branchId, num)
      }
      addProductToCart(product, num)
    } finally {
      setMissingPriceProduct(null)
    }
  }

  function addInlineToCart({ name, salePrice, productId }) {
    setCart(prev => [
      ...prev,
      {
        key: `inline_${Date.now()}`,
        productId: productId || null,
        source: productId ? 'cashier' : 'inline',
        name,
        qty: 1,
        unitPrice: Number(salePrice) || 0,
      },
    ])
    setQuery('')
  }

  function updateQty(key, delta) {
    setCart(prev => prev
      .map(it => it.key === key ? { ...it, qty: Math.max(0, it.qty + delta) } : it)
      .filter(it => it.qty > 0)
    )
  }

  function removeItem(key) {
    setCart(prev => prev.filter(it => it.key !== key))
  }

  return (
    <div style={{
      minHeight: '100dvh', background: T.neutral[50],
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header (fondo full-width, contenido en maxWidth) */}
      <div style={{
        background: '#fff', borderBottom: `1px solid ${T.neutral[100]}`,
        position: 'sticky', top: 0, zIndex: 20,
      }}>
        <div style={{
          maxWidth: 640, margin: '0 auto',
          padding: '16px 18px',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <button onClick={onCancel} style={{
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
              Nueva venta
            </div>
            <div style={{ fontSize: 12, color: T.neutral[500] }}>
              {session.branchName || 'Panadería'}
            </div>
          </div>
        </div>
      </div>

      {/* Buscador */}
      <div style={{ padding: '14px 18px 6px', maxWidth: 640, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Buscar producto..."
        />

        {/* Resultados de búsqueda */}
        {query.trim().length > 0 && (
          <div style={{
            background: '#fff', borderRadius: 16, border: `1px solid ${T.neutral[100]}`,
            marginTop: 8, overflow: 'hidden',
          }}>
            {filtered.length === 0 && !showCreateOption && (
              <div style={{ padding: '20px 16px', textAlign: 'center', color: T.neutral[500], fontSize: 13 }}>
                Sin resultados
              </div>
            )}
            {filtered.map((p, i) => {
              const priceHere = getProductPrice(p, branchId)
              const needsPrice = priceHere === null
              return (
                <button
                  key={p.source + '_' + p.id}
                  onClick={() => handleSelectProduct(p)}
                  style={{
                    width: '100%', padding: '12px 16px',
                    background: 'transparent', border: 'none',
                    borderBottom: i < filtered.length - 1 || showCreateOption ? `0.5px solid ${T.neutral[100]}` : 'none',
                    cursor: 'pointer', fontFamily: 'inherit',
                    display: 'flex', alignItems: 'center', gap: 12,
                    textAlign: 'left',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 14, fontWeight: 600, color: T.neutral[900],
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {p.name}
                    </div>
                    {p.needsCostReview && (
                      <div style={{ fontSize: 10.5, color: T.warn, marginTop: 2 }}>
                        pendiente de revisión por admin
                      </div>
                    )}
                  </div>
                  {needsPrice ? (
                    <div style={{
                      fontSize: 11, fontWeight: 700, color: T.copper[700],
                      background: T.copper[50], padding: '4px 10px', borderRadius: 999,
                      letterSpacing: 0.3, flexShrink: 0,
                    }}>
                      Poner precio
                    </div>
                  ) : (
                    <div style={{ fontSize: 14, fontWeight: 700, color: T.neutral[800], fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                      {fmtCOP(priceHere)}
                    </div>
                  )}
                </button>
              )
            })}
            {showCreateOption && (
              <button
                onClick={() => { setCreateInitialName(query); setCreateOpen(true) }}
                style={{
                  width: '100%', padding: '12px 16px',
                  background: T.copper[50], border: 'none',
                  cursor: 'pointer', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', gap: 10,
                  color: T.copper[700], fontSize: 13.5, fontWeight: 700,
                  textAlign: 'left',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
                  <circle cx="8" cy="8" r="7" stroke={T.copper[700]} strokeWidth="1.5" fill="none"/>
                  <path d="M8 5 V11 M5 8 H11" stroke={T.copper[700]} strokeWidth="1.6" strokeLinecap="round"/>
                </svg>
                Crear producto: "{query.trim()}"
              </button>
            )}
          </div>
        )}
      </div>

      {/* Carrito */}
      <div style={{ flex: 1, padding: '8px 18px 24px', maxWidth: 640, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        {cart.length === 0 ? (
          <div style={{
            marginTop: 20, padding: '32px 20px', textAlign: 'center',
            background: '#fff', borderRadius: 16, border: `1px dashed ${T.neutral[200]}`,
          }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>🛒</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.neutral[700], marginBottom: 4 }}>
              El carrito está vacío
            </div>
            <div style={{ fontSize: 12, color: T.neutral[500] }}>
              Busca productos arriba para agregarlos.
            </div>
          </div>
        ) : (
          <Card padding={0} style={{ marginTop: 8, overflow: 'hidden' }}>
            {cart.map((it, i) => (
              <CartItem
                key={it.key}
                item={it}
                isLast={i === cart.length - 1}
                onMinus={() => updateQty(it.key, -1)}
                onPlus={() => updateQty(it.key, +1)}
                onRemove={() => removeItem(it.key)}
              />
            ))}
          </Card>
        )}
      </div>

      {/* Footer con total + botón Cobrar (fondo full-width, contenido en maxWidth) */}
      {cart.length > 0 && (
        <div style={{
          background: '#fff', borderTop: `1px solid ${T.neutral[100]}`,
          position: 'sticky', bottom: 0,
        }}>
          <div style={{
            maxWidth: 640, margin: '0 auto',
            padding: '14px 18px',
            paddingBottom: 'calc(14px + env(safe-area-inset-bottom, 0px))',
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: T.neutral[600] }}>Total</span>
              <span style={{ fontSize: 28, fontWeight: 800, color: T.neutral[900], fontVariantNumeric: 'tabular-nums', letterSpacing: -0.5 }}>
                {fmtCOP(total)}
              </span>
            </div>
            <button
              onClick={() => setPaymentOpen(true)}
              style={{
                width: '100%', padding: '15px', borderRadius: 16,
                background: T.copper[500], color: '#fff',
                border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 15.5, fontWeight: 700,
                boxShadow: '0 4px 14px rgba(184,122,86,0.35)',
              }}
            >
              Cobrar {fmtCOP(total)}
            </button>
          </div>
        </div>
      )}

      {createOpen && (
        <CreateProductModal
          initialName={createInitialName}
          authUser={authUser}
          userDoc={userDoc}
          branchId={branchId}
          branchName={session.branchName}
          onCancel={() => setCreateOpen(false)}
          onCreated={({ name, salePrice, productId }) => {
            addInlineToCart({ name, salePrice, productId })
            setCreateOpen(false)
          }}
        />
      )}

      {missingPriceProduct && (
        <FirstTimePriceModal
          product={missingPriceProduct}
          branchName={session.branchName}
          onCancel={() => setMissingPriceProduct(null)}
          onConfirm={handleConfirmFirstTimePrice}
        />
      )}

      {paymentOpen && (
        <PaymentModal
          session={session}
          authUser={authUser}
          userDoc={userDoc}
          cart={cart}
          total={total}
          onCancel={() => setPaymentOpen(false)}
          onConfirmed={() => {
            setPaymentOpen(false)
            onSaved?.()
          }}
        />
      )}
    </div>
  )
}

function useCashierProducts() {
  const [list, setList] = useState([])
  useEffect(() => {
    const unsub = watchCashierProducts(setList)
    return unsub
  }, [])
  return list
}

function SearchInput({ value, onChange, placeholder }) {
  const [focused, setFocused] = useState(false)
  return (
    <div style={{
      border: `1.5px solid ${focused ? T.copper[400] : T.neutral[200]}`,
      borderRadius: 14, background: '#fff',
      transition: 'border-color 0.12s',
      display: 'flex', alignItems: 'center',
    }}>
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" style={{ marginLeft: 14 }}>
        <circle cx="9" cy="9" r="6" stroke={T.neutral[400]} strokeWidth="1.6" fill="none"/>
        <path d="M14 14 L17 17" stroke={T.neutral[400]} strokeWidth="1.6" strokeLinecap="round"/>
      </svg>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        autoFocus
        style={{
          flex: 1, padding: '14px 16px 14px 12px', border: 'none', outline: 'none',
          fontFamily: 'inherit', fontSize: 15, color: T.neutral[900],
          background: 'transparent', borderRadius: 14,
        }}
      />
      {value && (
        <button
          onClick={() => onChange('')}
          style={{
            width: 36, height: 36, marginRight: 6, borderRadius: 999,
            background: 'transparent', border: 'none',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 3 L11 11 M11 3 L3 11" stroke={T.neutral[400]} strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        </button>
      )}
    </div>
  )
}

function CartItem({ item, isLast, onMinus, onPlus, onRemove }) {
  const subtotal = item.qty * item.unitPrice
  return (
    <div style={{
      padding: '12px 16px',
      display: 'flex', alignItems: 'center', gap: 10,
      borderBottom: isLast ? 'none' : `0.5px solid ${T.neutral[100]}`,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14, fontWeight: 600, color: T.neutral[900],
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {item.name}
        </div>
        <div style={{ fontSize: 11.5, color: T.neutral[500], marginTop: 2 }}>
          {fmtCOP(item.unitPrice)} c/u
        </div>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 0,
        background: T.neutral[100], borderRadius: 999, padding: 2,
      }}>
        <button onClick={onMinus} style={qtyBtn()}>
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 6 H10" stroke={T.neutral[700]} strokeWidth="2" strokeLinecap="round"/></svg>
        </button>
        <span style={{
          minWidth: 28, textAlign: 'center', fontSize: 14, fontWeight: 700,
          color: T.neutral[900], fontVariantNumeric: 'tabular-nums',
        }}>
          {item.qty}
        </span>
        <button onClick={onPlus} style={qtyBtn()}>
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 2 V10 M2 6 H10" stroke={T.neutral[700]} strokeWidth="2" strokeLinecap="round"/></svg>
        </button>
      </div>

      <div style={{
        minWidth: 70, textAlign: 'right',
        fontSize: 14, fontWeight: 700, color: T.neutral[900], fontVariantNumeric: 'tabular-nums',
      }}>
        {fmtCOP(subtotal)}
      </div>

      <button onClick={onRemove} style={{
        width: 32, height: 32, borderRadius: 999, marginLeft: 4,
        background: 'transparent', border: 'none',
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M3 3 L11 11 M11 3 L3 11" stroke={T.neutral[400]} strokeWidth="1.6" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  )
}

function qtyBtn() {
  return {
    width: 30, height: 30, borderRadius: 999,
    background: 'transparent', border: 'none',
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
  }
}

// ──────────────────────────────────────────────────────────────
// MODAL: Crear producto al vuelo
// ──────────────────────────────────────────────────────────────
function CreateProductModal({ initialName, authUser, userDoc, branchId, branchName, onCancel, onCreated }) {
  const [name, setName] = useState(initialName || '')
  const [priceStr, setPriceStr] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const valid = name.trim().length >= 2 && Number(priceStr) > 0

  async function handleCreate() {
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    try {
      const cashierName = `${userDoc?.nombre || ''} ${userDoc?.apellido || ''}`.trim()
      const productId = await createCashierProduct({
        name: name.trim(),
        salePrice: Number(priceStr) || 0,
        branchId,
        createdByUid: authUser.uid,
        createdByName: cashierName,
      })
      onCreated({ name: name.trim(), salePrice: Number(priceStr) || 0, productId })
    } catch (err) {
      console.error(err)
      setError('No pudimos crear el producto. Intenta de nuevo.')
      setBusy(false)
    }
  }

  return (
    <ModalOverlay onClose={busy ? undefined : onCancel}>
      <div onClick={e => e.stopPropagation()} style={modalCard()}>
        <div style={{ fontSize: 18, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3, marginBottom: 4 }}>
          Crear producto
        </div>
        <div style={{ fontSize: 12.5, color: T.neutral[500], marginBottom: 16 }}>
          Quedará en el catálogo. El precio que pongas es solo para <b>{branchName || 'esta panadería'}</b>; otra cajera ingresará el suyo en su panadería.
        </div>

        <ModalInput
          label="Nombre"
          value={name}
          onChange={setName}
          placeholder="Ej. Pan croissant"
          disabled={busy}
        />

        <ModalNumberInput
          label={`Precio en ${branchName || 'esta panadería'}`}
          value={priceStr}
          onChange={setPriceStr}
          disabled={busy}
        />

        {error && <ErrorBox text={error} />}

        <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
          <button onClick={onCancel} disabled={busy} style={btnSecondary()}>Cancelar</button>
          <button
            onClick={handleCreate}
            disabled={!valid || busy}
            style={{
              ...btnPrimary(valid && !busy ? T.copper[500] : T.neutral[200]),
              flex: 1.4,
              color: valid && !busy ? '#fff' : T.neutral[400],
              cursor: valid && !busy ? 'pointer' : 'not-allowed',
              boxShadow: valid && !busy ? '0 3px 10px rgba(184,122,86,0.3)' : 'none',
            }}
          >
            {busy ? 'Creando...' : 'Crear y agregar'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

// ──────────────────────────────────────────────────────────────
// MODAL: Primera vez vendiendo este producto en esta panadería
// ──────────────────────────────────────────────────────────────
function FirstTimePriceModal({ product, branchName, onCancel, onConfirm }) {
  const [priceStr, setPriceStr] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const valid = Number(priceStr) > 0

  async function handleConfirm() {
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    try {
      await onConfirm(Number(priceStr))
    } catch (err) {
      console.error(err)
      setError('No pudimos guardar el precio. Intenta de nuevo.')
      setBusy(false)
    }
  }

  return (
    <ModalOverlay onClose={busy ? undefined : onCancel}>
      <div onClick={e => e.stopPropagation()} style={modalCard()}>
        <div style={{ fontSize: 18, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3, marginBottom: 4 }}>
          Primera venta de este producto
        </div>
        <div style={{ fontSize: 12.5, color: T.neutral[500], marginBottom: 16, lineHeight: 1.5 }}>
          <b style={{ color: T.neutral[800] }}>{product.name}</b> aún no tiene precio en <b style={{ color: T.neutral[800] }}>{branchName || 'esta panadería'}</b>. Pon el precio una sola vez y queda guardado para próximas ventas.
        </div>

        <ModalNumberInput
          label={`Precio en ${branchName || 'esta panadería'}`}
          value={priceStr}
          onChange={setPriceStr}
          disabled={busy}
        />

        {error && <ErrorBox text={error} />}

        <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
          <button onClick={onCancel} disabled={busy} style={btnSecondary()}>Cancelar</button>
          <button
            onClick={handleConfirm}
            disabled={!valid || busy}
            style={{
              ...btnPrimary(valid && !busy ? T.copper[500] : T.neutral[200]),
              flex: 1.4,
              color: valid && !busy ? '#fff' : T.neutral[400],
              cursor: valid && !busy ? 'pointer' : 'not-allowed',
              boxShadow: valid && !busy ? '0 3px 10px rgba(184,122,86,0.3)' : 'none',
            }}
          >
            {busy ? 'Guardando...' : 'Guardar y agregar'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

// ──────────────────────────────────────────────────────────────
// MODAL: Método de pago
// ──────────────────────────────────────────────────────────────
function PaymentModal({ session, authUser, userDoc, cart, total, onCancel, onConfirmed }) {
  const [method, setMethod] = useState(null) // 'efectivo' | 'deuda' | 'nequi' | 'daviplata'
  const [cashReceivedStr, setCashReceivedStr] = useState('')
  const [debtorName, setDebtorName] = useState('')
  const [debtors, setDebtors] = useState([])
  const [photoUrl, setPhotoUrl] = useState(null)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoError, setPhotoError] = useState(null)
  const fileInputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    const unsub = watchDebtors(setDebtors)
    return unsub
  }, [])

  const cashReceived = Number(cashReceivedStr) || 0
  const change = cashReceived - total

  // Sugerencias de deudores existentes
  const debtorSuggestions = useMemo(() => {
    if (!debtorName.trim()) return []
    const q = normalizeName(debtorName)
    return debtors
      .filter(d => normalizeName(d.name).includes(q))
      .slice(0, 5)
  }, [debtors, debtorName])

  const isDigital = method === 'nequi' || method === 'daviplata'

  const canConfirm = (() => {
    if (!method) return false
    if (method === 'deuda') return debtorName.trim().length >= 2 && !busy
    if (method === 'efectivo') return !busy
    if (isDigital) return !!photoUrl && !photoUploading && !busy
    return false
  })()

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
      // Reset el input para permitir reintentar con el mismo archivo
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function openCamera() {
    setPhotoError(null)
    fileInputRef.current?.click()
  }

  // Si la cajera cambia de método después de tomar foto, limpiamos
  function selectMethod(m) {
    setMethod(m)
    if (m !== 'nequi' && m !== 'daviplata') {
      setPhotoUrl(null)
      setPhotoError(null)
    }
  }

  async function handleConfirm() {
    if (!canConfirm || busy) return
    setBusy(true)
    setError(null)
    try {
      const cashierName = `${userDoc?.nombre || ''} ${userDoc?.apellido || ''}`.trim() || authUser.email
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })

      const payload = {
        sessionId: session.id,
        branchId: session.branchId,
        cashierUid: authUser.uid,
        cashierName,
        items: cart.map(it => ({
          productId: it.productId,
          source: it.source,
          name: it.name,
          qty: it.qty,
          unitPrice: it.unitPrice,
          subtotal: it.qty * it.unitPrice,
        })),
        total,
        paymentMethod: method,
      }

      if (method === 'efectivo' && cashReceivedStr) {
        payload.cashReceived = cashReceived
      }

      if (isDigital && photoUrl) {
        payload.photoUrl = photoUrl
      }

      if (method === 'deuda') {
        // Crear o actualizar deudor primero (necesitamos saleId después,
        // así que registraremos el deudor sin saleId y luego actualizamos).
        // Para Fase 3 mantenemos simple: registramos deudor con saleId temporal.
        // Mejor: creamos sale primero, luego registramos deuda con saleId.
        // Pero entonces si el registro de deudor falla, queda sale huérfana.
        // Solución: orden inverso — registrar deudor primero con saleId pendiente,
        // crear sale con debtorId, luego actualizar history del debtor.
        // Para Fase 3 simple: guardamos el nombre en la sale y registramos debtor
        // con saleId después de crear la sale.
      }

      // Crear venta
      const saleId = await createSale(payload)

      // Si es deuda, registrar en debtors y guardar debtorId en la sale
      if (method === 'deuda') {
        const debtorId = await addDebtSale(debtors, {
          name: debtorName.trim(),
          amount: total,
          saleId,
          date: today,
        })
        // Backfill: agregar debtorId a la sale para futuras ediciones del admin
        try {
          const { doc, updateDoc } = await import('firebase/firestore')
          const { firestoreDb } = await import('../firebase')
          await updateDoc(doc(firestoreDb, 'sales', saleId), { debtorId })
        } catch (err) {
          console.warn('No se pudo backfill debtorId en venta:', err)
        }
      }

      onConfirmed()
    } catch (err) {
      console.error(err)
      setError('No pudimos guardar la venta. Intenta de nuevo.')
      setBusy(false)
    }
  }

  return (
    <ModalOverlay onClose={busy ? undefined : onCancel}>
      <div onClick={e => e.stopPropagation()} style={modalCard()}>
        <div style={{ fontSize: 18, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3, marginBottom: 4 }}>
          Cobrar
        </div>
        <div style={{
          fontSize: 28, fontWeight: 800, color: T.copper[600],
          fontVariantNumeric: 'tabular-nums', letterSpacing: -0.5, marginBottom: 16,
        }}>
          {fmtCOP(total)}
        </div>

        <div style={{ fontSize: 13, fontWeight: 600, color: T.neutral[600], marginBottom: 10 }}>
          Método de pago
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          <PaymentOption icon="💵" label="Efectivo" selected={method === 'efectivo'} onClick={() => selectMethod('efectivo')} />
          <PaymentOption icon="🤝" label="Deuda" selected={method === 'deuda'} onClick={() => selectMethod('deuda')} />
          <PaymentOption icon="📱" label="NEQUI" selected={method === 'nequi'} onClick={() => selectMethod('nequi')} />
          <PaymentOption icon="📱" label="DAVIPLATA" selected={method === 'daviplata'} onClick={() => selectMethod('daviplata')} />
        </div>

        {/* Detalles según método */}
        {method === 'efectivo' && (
          <>
            <ModalNumberInput
              label="¿Cuánto recibió? (opcional)"
              value={cashReceivedStr}
              onChange={setCashReceivedStr}
              disabled={busy}
              hint="Si lo digitas, te calcula el vuelto."
            />
            {cashReceivedStr && cashReceived >= total && (
              <div style={{
                padding: '12px 14px', borderRadius: 12,
                background: '#E8F4E8', border: `1px solid #C2DDC1`,
                marginBottom: 12,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.ok }}>Vuelto</span>
                <span style={{ fontSize: 18, fontWeight: 800, color: T.ok, fontVariantNumeric: 'tabular-nums' }}>
                  {fmtCOP(change)}
                </span>
              </div>
            )}
            {cashReceivedStr && cashReceived < total && (
              <div style={{
                padding: '10px 14px', borderRadius: 12,
                background: '#FBE9E5', border: `1px solid #F0C8BE`,
                marginBottom: 12, fontSize: 13, color: T.bad, fontWeight: 600,
              }}>
                El monto recibido es menor al total.
              </div>
            )}
          </>
        )}

        {method === 'deuda' && (
          <>
            <ModalInput
              label="Nombre del deudor"
              value={debtorName}
              onChange={setDebtorName}
              placeholder="Ej. María Pérez"
              disabled={busy}
              autoFocus
            />
            {debtorSuggestions.length > 0 && (
              <div style={{
                marginTop: -6, marginBottom: 12, background: '#fff',
                borderRadius: 10, border: `1px solid ${T.neutral[100]}`, overflow: 'hidden',
              }}>
                {debtorSuggestions.map((d, i) => (
                  <button
                    key={d.id}
                    onClick={() => setDebtorName(d.name)}
                    style={{
                      width: '100%', padding: '8px 12px',
                      background: 'transparent', border: 'none',
                      borderBottom: i < debtorSuggestions.length - 1 ? `0.5px solid ${T.neutral[100]}` : 'none',
                      cursor: 'pointer', fontFamily: 'inherit',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      fontSize: 12.5, color: T.neutral[700], textAlign: 'left',
                    }}
                  >
                    <span>{d.name}</span>
                    <span style={{ color: T.neutral[400], fontSize: 11 }}>
                      debe {fmtCOP(d.totalOwed)}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div style={{
              padding: '10px 12px', borderRadius: 10,
              background: '#FFF7E6', border: `1px solid #F4E0BC`,
              fontSize: 12, color: T.warn, fontWeight: 500, lineHeight: 1.5, marginBottom: 12,
            }}>
              Esta venta queda registrada como deuda. El admin gestiona los pagos.
            </div>
          </>
        )}

        {isDigital && (
          <PhotoCapture
            method={method}
            photoUrl={photoUrl}
            uploading={photoUploading}
            error={photoError}
            onTake={openCamera}
            onRetry={openCamera}
            onClear={() => { setPhotoUrl(null); setPhotoError(null) }}
            fileInputRef={fileInputRef}
            onFileSelected={handleFileSelected}
          />
        )}

        {error && <ErrorBox text={error} />}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCancel} disabled={busy} style={btnSecondary()}>Cancelar</button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm || busy}
            style={{
              ...btnPrimary(canConfirm && !busy ? T.copper[500] : T.neutral[200]),
              flex: 1.4,
              color: canConfirm && !busy ? '#fff' : T.neutral[400],
              cursor: canConfirm && !busy ? 'pointer' : 'not-allowed',
              boxShadow: canConfirm && !busy ? '0 3px 10px rgba(184,122,86,0.3)' : 'none',
            }}
          >
            {busy ? 'Guardando...' : 'Confirmar venta'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

// ──────────────────────────────────────────────────────────────
// Captura de foto del comprobante (NEQUI / DAVIPLATA)
// ──────────────────────────────────────────────────────────────
function PhotoCapture({ method, photoUrl, uploading, error, onTake, onRetry, onClear, fileInputRef, onFileSelected }) {
  const methodName = method === 'nequi' ? 'NEQUI' : 'DAVIPLATA'

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: T.neutral[600], marginBottom: 6 }}>
        Foto del comprobante de {methodName}
      </div>

      {/* Input file oculto, capture camera nativa */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onFileSelected}
        style={{ display: 'none' }}
      />

      {!photoUrl && !uploading && !error && (
        <button
          onClick={onTake}
          style={{
            width: '100%', padding: '20px 14px', borderRadius: 14,
            background: '#fff', color: T.neutral[700],
            border: `1.5px dashed ${T.copper[300]}`,
            cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
          }}
        >
          <svg width="34" height="34" viewBox="0 0 32 32" fill="none">
            <rect x="3" y="9" width="26" height="19" rx="3" stroke={T.copper[500]} strokeWidth="1.8" fill="none"/>
            <path d="M11 9 L13 6 H19 L21 9" stroke={T.copper[500]} strokeWidth="1.8" fill="none" strokeLinejoin="round"/>
            <circle cx="16" cy="18" r="5" stroke={T.copper[500]} strokeWidth="1.8" fill="none"/>
          </svg>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.copper[700] }}>
            Tomar foto del comprobante
          </div>
          <div style={{ fontSize: 11.5, color: T.neutral[500] }}>
            Obligatorio para confirmar la venta
          </div>
        </button>
      )}

      {uploading && (
        <div style={{
          padding: '20px 14px', borderRadius: 14,
          background: T.neutral[50], border: `1.5px solid ${T.neutral[200]}`,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: 999,
            border: `3px solid ${T.copper[100]}`,
            borderTopColor: T.copper[500],
            animation: 'spin 0.8s linear infinite',
          }}/>
          <div style={{ fontSize: 13, color: T.neutral[600], fontWeight: 600 }}>
            Subiendo foto...
          </div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {error && !uploading && (
        <div style={{
          padding: '14px', borderRadius: 14,
          background: '#FBE9E5', border: `1.5px solid #F0C8BE`,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        }}>
          <div style={{ fontSize: 13, color: T.bad, fontWeight: 600, textAlign: 'center' }}>
            {error}
          </div>
          <button
            onClick={onRetry}
            style={{
              padding: '8px 16px', borderRadius: 10,
              background: T.bad, color: '#fff',
              border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 13, fontWeight: 700,
            }}
          >
            Reintentar
          </button>
        </div>
      )}

      {photoUrl && !uploading && (
        <div style={{
          borderRadius: 14, overflow: 'hidden',
          border: `1.5px solid ${T.ok}66`,
          background: '#fff',
        }}>
          <div style={{
            position: 'relative',
            background: T.neutral[100],
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <img
              src={photoUrl}
              alt="Comprobante"
              style={{
                display: 'block', width: '100%',
                maxHeight: 240, objectFit: 'contain',
                background: T.neutral[900],
              }}
            />
            <div style={{
              position: 'absolute', top: 8, right: 8,
              background: T.ok, color: '#fff',
              padding: '4px 10px', borderRadius: 999,
              fontSize: 11, fontWeight: 700, letterSpacing: 0.3,
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <svg width="10" height="10" viewBox="0 0 10 10">
                <path d="M2 5 L4 7 L8 3" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Subida
            </div>
          </div>
          <button
            onClick={onClear}
            style={{
              width: '100%', padding: '10px',
              background: 'transparent', border: 'none', borderTop: `1px solid ${T.neutral[100]}`,
              cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 12.5, fontWeight: 600, color: T.neutral[600],
            }}
          >
            Cambiar foto
          </button>
        </div>
      )}
    </div>
  )
}

function PaymentOption({ icon, label, subtitle, selected, onClick, disabled }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        padding: '14px 12px', borderRadius: 14,
        background: selected ? T.copper[50] : '#fff',
        border: `1.5px solid ${selected ? T.copper[400] : T.neutral[200]}`,
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
        opacity: disabled ? 0.45 : 1,
        transition: 'all 0.12s',
      }}
    >
      <div style={{ fontSize: 24 }}>{icon}</div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: selected ? T.copper[700] : T.neutral[800] }}>
        {label}
      </div>
      {subtitle && (
        <div style={{ fontSize: 10, color: T.neutral[400], fontWeight: 500 }}>{subtitle}</div>
      )}
    </button>
  )
}

// ──────────────────────────────────────────────────────────────
// Componentes utilitarios
// ──────────────────────────────────────────────────────────────
function ModalInput({ label, value, onChange, placeholder, disabled, autoFocus }) {
  const [focused, setFocused] = useState(false)
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: T.neutral[600], display: 'block', marginBottom: 6 }}>
        {label}
      </label>
      <div style={{
        border: `1.5px solid ${focused ? T.copper[400] : T.neutral[200]}`,
        borderRadius: 12, background: '#fff', transition: 'border-color 0.12s',
      }}>
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            width: '100%', padding: '12px 14px', border: 'none', outline: 'none',
            fontFamily: 'inherit', fontSize: 14.5, color: T.neutral[900],
            background: 'transparent', borderRadius: 12,
            opacity: disabled ? 0.6 : 1,
          }}
        />
      </div>
    </div>
  )
}

function ModalNumberInput({ label, value, onChange, disabled, hint }) {
  const [focused, setFocused] = useState(false)
  function sanitize(raw) {
    return raw.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '')
  }
  const display = value === '0' ? '' : value
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: T.neutral[600], display: 'block', marginBottom: 6 }}>
        {label}
      </label>
      <div style={{
        border: `1.5px solid ${focused ? T.copper[400] : T.neutral[200]}`,
        borderRadius: 12, background: '#fff', transition: 'border-color 0.12s',
        display: 'flex', alignItems: 'center',
      }}>
        <span style={{ paddingLeft: 14, color: T.neutral[500], fontSize: 15, fontWeight: 600 }}>$</span>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={display}
          onChange={e => onChange(sanitize(e.target.value))}
          placeholder="0"
          disabled={disabled}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            width: '100%', padding: '12px 14px 12px 8px', border: 'none', outline: 'none',
            fontFamily: 'inherit', fontSize: 16, color: T.neutral[900],
            background: 'transparent', borderRadius: 12,
            opacity: disabled ? 0.6 : 1,
            fontVariantNumeric: 'tabular-nums', fontWeight: 600,
          }}
        />
      </div>
      {hint && (
        <div style={{ fontSize: 11.5, color: T.neutral[400], marginTop: 4, lineHeight: 1.45 }}>{hint}</div>
      )}
    </div>
  )
}

function ErrorBox({ text }) {
  return (
    <div style={{
      marginBottom: 10, padding: '10px 12px', borderRadius: 10,
      background: '#FBE9E5', border: `1px solid #F0C8BE`, color: T.bad,
      fontSize: 12.5, fontWeight: 500, textAlign: 'center',
    }}>
      {text}
    </div>
  )
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
    width: '100%', maxWidth: 420,
    background: '#fff', borderRadius: 22,
    padding: '24px 22px 22px',
    boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
    animation: 'fadeScaleIn 0.2s ease',
    maxHeight: '92vh', overflowY: 'auto',
  }
}

function btnPrimary(bg) {
  return {
    flex: 1, padding: '12px', borderRadius: 12,
    background: bg, color: '#fff',
    border: 'none', cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
  }
}
function btnSecondary() {
  return {
    flex: 1, padding: '12px', borderRadius: 12,
    background: T.neutral[100], color: T.neutral[700],
    border: 'none', cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
  }
}

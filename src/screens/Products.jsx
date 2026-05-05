import { useState, useMemo, useEffect } from 'react'
import { T } from '../tokens'
import { fmtCOP } from '../utils/format'
import { Card, Modal, InputField, PrimaryButton, BackButton } from '../components/Atoms'
import { ScreenHeader } from '../components/Nav'
import { addProduct, updateProduct, deleteProduct, getData } from '../db'
import { useIsDesktop } from '../context/DesktopCtx'
import { watchCashierProducts, deleteCashierProduct } from '../products'

// ── Helpers de cálculo ─────────────────────────────────────────
function calcProduct(p) {
  const costPerUnit = p.byPackage
    ? (p.unitsPerPackage > 0 ? p.packageCost / p.unitsPerPackage : 0)
    : p.packageCost
  // Precios por panadería: tomamos los valores definidos
  const prices = Object.values(p.pricesByBranch || {}).map(Number).filter(n => n > 0)
  const minPrice = prices.length > 0 ? Math.min(...prices) : 0
  const maxPrice = prices.length > 0 ? Math.max(...prices) : 0
  const avgPrice = prices.length > 0 ? prices.reduce((s, n) => s + n, 0) / prices.length : 0
  // Margen y ganancia se calculan sobre el promedio (referencial)
  const profit = avgPrice - costPerUnit
  const margin = avgPrice > 0 ? (profit / avgPrice) * 100 : 0
  return { costPerUnit, profit, margin, minPrice, maxPrice, avgPrice, prices }
}

// Lista de "Iglesia: $5.000 · Esquina: $5.500" — solo branches con precio
function priceBreakdown(p) {
  const branches = getData().branches || []
  return branches
    .map(b => {
      const v = p.pricesByBranch?.[String(b.id)]
      return v && Number(v) > 0 ? { name: b.name, price: Number(v) } : null
    })
    .filter(Boolean)
}

// Lista de panaderías que SÍ tienen precio
function branchesWithPrice(p) {
  const branches = getData().branches || []
  return branches.filter(b => {
    const v = p.pricesByBranch?.[String(b.id)]
    return v && Number(v) > 0
  })
}

// Lista de panaderías que NO tienen precio aún
function branchesMissingPrice(p) {
  const branches = getData().branches || []
  return branches.filter(b => {
    const v = p.pricesByBranch?.[String(b.id)]
    return !v || Number(v) <= 0
  })
}

function marginColor(m) {
  if (m >= 40) return T.ok
  if (m >= 20) return T.warn
  return T.bad
}

function marginBg(m) {
  if (m >= 40) return '#EBF5EB'
  if (m >= 20) return '#FBF4E8'
  return '#FAE8E6'
}

// ── Ícono producto ─────────────────────────────────────────────
function ProductIcon({ color = T.copper[400] }) {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
      <rect x="3" y="8" width="14" height="9" rx="2" stroke={color} strokeWidth="1.6" fill="none"/>
      <path d="M6 8 Q6 4 10 4 Q14 4 14 8" stroke={color} strokeWidth="1.6" fill="none"/>
      <path d="M7 12 H13 M9 10.5 V13.5" stroke={color} strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  )
}

// ── Badge de margen ────────────────────────────────────────────
function MarginBadge({ margin }) {
  const c = marginColor(margin)
  const bg = marginBg(margin)
  return (
    <span style={{
      display: 'inline-block', padding: '3px 8px', borderRadius: 999,
      background: bg, color: c, fontSize: 12, fontWeight: 700,
      fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
    }}>
      {margin >= 0 ? '+' : ''}{margin.toFixed(1)}%
    </span>
  )
}

// ── Precios por panadería (compacto inline para tabla desktop) ─
function PricesByBranchInline({ product }) {
  if (product.freeAmount) {
    return (
      <span style={{
        fontSize: 11.5, fontWeight: 700, color: T.copper[700],
        background: T.copper[50], padding: '4px 10px', borderRadius: 999,
        letterSpacing: 0.3, textTransform: 'uppercase',
      }}>
        Venta libre
      </span>
    )
  }
  const breakdown = priceBreakdown(product)
  const missing = branchesMissingPrice(product)
  if (breakdown.length === 0) {
    return (
      <span style={{ fontSize: 12, color: T.copper[700], fontStyle: 'italic' }}>
        Sin precios — la cajera los pondrá al usar
      </span>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
      {breakdown.map(b => (
        <div key={b.name} style={{ fontSize: 12, fontWeight: 600, color: T.neutral[700] }}>
          <span style={{ color: T.neutral[500] }}>{b.name}: </span>
          <span style={{ color: T.neutral[900], fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {fmtCOP(b.price)}
          </span>
        </div>
      ))}
      {missing.length > 0 && (
        <div style={{ fontSize: 11, color: T.copper[700], fontStyle: 'italic', marginTop: 2 }}>
          falta en {missing.map(b => b.name).join(', ')}
        </div>
      )}
    </div>
  )
}

// ── Precios por panadería (bloque para card móvil) ──────────────
function PricesByBranchBlock({ product }) {
  if (product.freeAmount) {
    return (
      <div style={{
        fontSize: 12, fontWeight: 700, color: T.copper[700],
        textAlign: 'center', letterSpacing: 0.3, textTransform: 'uppercase',
      }}>
        Venta libre · cajera escribe el monto
      </div>
    )
  }
  const breakdown = priceBreakdown(product)
  const missing = branchesMissingPrice(product)
  if (breakdown.length === 0) {
    return (
      <div style={{ fontSize: 12, color: T.copper[700], textAlign: 'center', fontStyle: 'italic' }}>
        Sin precios — la cajera los pondrá al usar
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {breakdown.map(b => (
        <div key={b.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
          <span style={{ color: T.neutral[600], fontWeight: 600 }}>{b.name}</span>
          <span style={{ color: T.neutral[900], fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {fmtCOP(b.price)}
          </span>
        </div>
      ))}
      {missing.length > 0 && (
        <div style={{ fontSize: 11, color: T.copper[700], fontStyle: 'italic', marginTop: 2 }}>
          Falta precio en {missing.map(b => b.name).join(', ')}
        </div>
      )}
    </div>
  )
}

// ── Badge de sucursal ──────────────────────────────────────────
function BranchTag({ branch }) {
  const colors = {
    both: { bg: T.neutral[100], text: T.neutral[500] },
    1:    { bg: T.copper[100],  text: T.copper[700]  },
    2:    { bg: '#E6EBE0',      text: '#4A5840'       },
  }
  const labels = { both: 'Ambas', 1: 'Iglesia', 2: 'Esquina' }
  const s = colors[branch] || colors.both
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 999,
      background: s.bg, color: s.text,
      fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
    }}>
      {labels[branch] || branch}
    </span>
  )
}

// ── Componente principal ───────────────────────────────────────
export default function Products({ products, onBack, onRefresh }) {
  const isDesktop = useIsDesktop()
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [editId, setEditId] = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)
  const [sortBy, setSortBy] = useState('margin') // 'margin' | 'name' | 'profit'
  const [cashierProducts, setCashierProducts] = useState([])
  const [confirmDelCashier, setConfirmDelCashier] = useState(null)
  const [acceptingCashier, setAcceptingCashier] = useState(null)
  const [cleanupOpen, setCleanupOpen] = useState(false)

  useEffect(() => {
    const unsub = watchCashierProducts(setCashierProducts)
    return unsub
  }, [])

  const enriched = useMemo(() =>
    products.map(p => ({ ...p, ...calcProduct(p) })),
    [products]
  )

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    const list = q ? enriched.filter(p => p.name.toLowerCase().includes(q)) : enriched
    return [...list].sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name)
      if (sortBy === 'profit') return b.profit - a.profit
      return b.margin - a.margin
    })
  }, [enriched, search, sortBy])

  // Resumen global
  const avgMargin = enriched.length
    ? enriched.reduce((s, p) => s + p.margin, 0) / enriched.length
    : 0
  const bestProduct = enriched.length
    ? enriched.reduce((best, p) => p.margin > best.margin ? p : best, enriched[0])
    : null

  function handleDelete(id) {
    deleteProduct(id)
    setConfirmDel(null)
    onRefresh()
  }

  const editTarget = editId ? products.find(p => p.id === editId) : null

  return (
    <div style={{ paddingBottom: 110 }}>
      <ScreenHeader
        title="Productos"
        subtitle={isDesktop ? undefined : undefined}
        right={
          <button onClick={() => setShowAdd(true)} style={{
            display: 'flex', alignItems: 'center', gap: 7,
            padding: '9px 16px', borderRadius: 12,
            background: T.copper[500], color: '#fff',
            border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 14, fontWeight: 700,
            boxShadow: '0 3px 10px rgba(184,122,86,0.3)',
          }}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M6.5 1 V12 M1 6.5 H12" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/>
            </svg>
            Agregar
          </button>
        }
      />

      {/* Resumen de métricas */}
      {enriched.length > 0 && (
        <div style={{ padding: '0 16px 16px', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{
            flex: 1, minWidth: 130, padding: '14px 16px', borderRadius: 14,
            background: T.neutral[900], color: '#fff',
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, color: T.copper[300], textTransform: 'uppercase' }}>
              Productos
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4, letterSpacing: -0.8 }}>
              {enriched.length}
            </div>
          </div>
          <div style={{
            flex: 1, minWidth: 130, padding: '14px 16px', borderRadius: 14,
            background: marginBg(avgMargin), border: `1px solid ${marginColor(avgMargin)}22`,
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, color: T.neutral[500], textTransform: 'uppercase' }}>
              Margen prom.
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4, letterSpacing: -0.8, color: marginColor(avgMargin) }}>
              {avgMargin.toFixed(1)}%
            </div>
          </div>
          {bestProduct && (
            <div style={{
              flex: 2, minWidth: 160, padding: '14px 16px', borderRadius: 14,
              background: T.copper[50], border: `1px solid ${T.copper[100]}`,
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, color: T.copper[600], textTransform: 'uppercase' }}>
                Más rentable
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, marginTop: 4, color: T.neutral[800], letterSpacing: -0.3 }}>
                {bestProduct.name}
              </div>
              <div style={{ fontSize: 12, color: T.copper[600], fontWeight: 600 }}>
                {bestProduct.margin.toFixed(1)}% · {fmtCOP(bestProduct.profit)}/u
              </div>
            </div>
          )}
        </div>
      )}

      {/* Productos creados por cajera (pendientes de revisión) */}
      {cashierProducts.length > 0 && (
        <div style={{ padding: '0 16px 16px' }}>
          <Card padding={0} style={{
            border: `1px solid ${T.warn}33`,
            background: '#FFF7E6',
          }}>
            <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 28, height: 28, borderRadius: 999, flexShrink: 0,
                background: T.warn, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M7 3 V8 M7 10.5 V11" stroke="#fff" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: T.warn }}>
                  Pendientes de revisión ({cashierProducts.length})
                </div>
                <div style={{ fontSize: 11.5, color: T.neutral[600], marginTop: 1 }}>
                  Productos creados por cajeras. Asígnales costo o elimínalos.
                </div>
              </div>
              {cashierProducts.some(p => /pan/i.test(p.name || '')) && (
                <button
                  onClick={() => setCleanupOpen(true)}
                  title="Limpiar productos duplicados con la palabra 'Pan'"
                  style={{
                    padding: '6px 11px', borderRadius: 8,
                    background: 'transparent', color: T.bad,
                    border: `1px solid ${T.bad}55`,
                    cursor: 'pointer', fontFamily: 'inherit',
                    fontSize: 11.5, fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  🧹 Limpiar Pan
                </button>
              )}
            </div>
            <div style={{ borderTop: `1px solid ${T.warn}22` }}>
              {cashierProducts.map((p, i) => (
                <div key={p.id} style={{
                  padding: '12px 14px',
                  display: 'flex', alignItems: 'center', gap: 12,
                  borderBottom: i < cashierProducts.length - 1 ? `1px solid ${T.warn}22` : 'none',
                  background: '#fff',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 14, fontWeight: 700, color: T.neutral[900],
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {p.name}
                    </div>
                    <div style={{ fontSize: 11.5, color: T.neutral[500], marginTop: 2 }}>
                      {priceBreakdown(p).map(b => (
                        <span key={b.name} style={{ marginRight: 8 }}>
                          {b.name}: <b style={{ color: T.neutral[700] }}>{fmtCOP(b.price)}</b>
                        </span>
                      ))}
                      {priceBreakdown(p).length === 0 && (
                        <span style={{ fontStyle: 'italic' }}>sin precios todavía</span>
                      )}
                      {p.createdByName && (
                        <div style={{ marginTop: 1 }}>por {p.createdByName}</div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button
                      onClick={() => setAcceptingCashier(p)}
                      style={{
                        padding: '7px 12px', borderRadius: 10,
                        background: T.copper[500], color: '#fff',
                        border: 'none',
                        cursor: 'pointer', fontFamily: 'inherit',
                        fontSize: 12.5, fontWeight: 700,
                        boxShadow: '0 2px 6px rgba(184,122,86,0.3)',
                      }}
                    >
                      Aceptar
                    </button>
                    <button
                      onClick={() => setConfirmDelCashier(p)}
                      style={{
                        padding: '7px 12px', borderRadius: 10,
                        background: 'transparent', color: T.bad,
                        border: `1px solid ${T.bad}33`,
                        cursor: 'pointer', fontFamily: 'inherit',
                        fontSize: 12.5, fontWeight: 600,
                      }}
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* Barra de búsqueda y ordenación */}
      <div style={{ padding: '0 16px 12px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Search */}
        <div style={{
          flex: 1, minWidth: 180, display: 'flex', alignItems: 'center', gap: 8,
          background: '#fff', border: `1px solid ${T.neutral[200]}`,
          borderRadius: 12, padding: '10px 14px',
        }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="4.5" stroke={T.neutral[400]} strokeWidth="1.5"/>
            <path d="M10.5 10.5 L14 14" stroke={T.neutral[400]} strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar producto..."
            style={{
              border: 'none', outline: 'none', background: 'transparent',
              fontSize: 14, color: T.neutral[800], fontFamily: 'inherit', width: '100%',
            }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{
              border: 'none', background: 'none', cursor: 'pointer', padding: 0,
              color: T.neutral[400], fontSize: 16, lineHeight: 1,
            }}>×</button>
          )}
        </div>

        {/* Sort pills */}
        <div style={{ display: 'flex', gap: 5 }}>
          {[
            { id: 'margin', label: 'Margen' },
            { id: 'profit', label: 'Ganancia' },
            { id: 'name',   label: 'A–Z' },
          ].map(s => (
            <button key={s.id} onClick={() => setSortBy(s.id)} style={{
              padding: '8px 12px', borderRadius: 999, border: 'none', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
              background: sortBy === s.id ? T.copper[500] : T.neutral[100],
              color: sortBy === s.id ? '#fff' : T.neutral[600],
              transition: 'background 0.15s',
            }}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Estado vacío */}
      {products.length === 0 && (
        <div style={{ padding: '64px 24px', textAlign: 'center' }}>
          <div style={{
            width: 64, height: 64, borderRadius: 20, background: T.copper[50],
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px',
          }}>
            <ProductIcon color={T.copper[400]}/>
          </div>
          <div style={{ fontSize: 17, fontWeight: 700, color: T.neutral[700] }}>Sin productos aún</div>
          <div style={{ fontSize: 13, color: T.neutral[400], marginTop: 6, maxWidth: 260, margin: '6px auto 0' }}>
            Agrega tus productos para ver costos, precios y márgenes de ganancia
          </div>
          <button onClick={() => setShowAdd(true)} style={{
            marginTop: 20, padding: '11px 24px', borderRadius: 12,
            background: T.copper[500], color: '#fff', border: 'none',
            cursor: 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 700,
          }}>
            Agregar primer producto
          </button>
        </div>
      )}

      {/* Sin resultados de búsqueda */}
      {products.length > 0 && filtered.length === 0 && (
        <div style={{ padding: '40px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: T.neutral[400] }}>
            No se encontró ningún producto con "{search}"
          </div>
        </div>
      )}

      {/* Tabla / Lista */}
      {filtered.length > 0 && (
        isDesktop
          ? <ProductTable products={filtered} onEdit={setEditId} onDelete={setConfirmDel}/>
          : <ProductCards products={filtered} onEdit={setEditId} onDelete={setConfirmDel}/>
      )}

      {/* Modal agregar */}
      {showAdd && (
        <ProductForm
          onClose={() => setShowAdd(false)}
          onSave={() => { setShowAdd(false); onRefresh() }}
        />
      )}

      {/* Modal editar */}
      {editTarget && (
        <ProductForm
          initial={editTarget}
          isEdit
          onClose={() => setEditId(null)}
          onSave={() => { setEditId(null); onRefresh() }}
        />
      )}

      {/* Confirmar eliminar */}
      {confirmDel && (
        <Modal onClose={() => setConfirmDel(null)} title="¿Eliminar producto?">
          <div style={{ fontSize: 14, color: T.neutral[500], marginBottom: 20 }}>
            Esta acción no se puede deshacer.
          </div>
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
        </Modal>
      )}

      {/* Aceptar producto cajera (asignar costo y promover al catálogo) */}
      {acceptingCashier && (
        <AcceptCashierProductModal
          product={acceptingCashier}
          onCancel={() => setAcceptingCashier(null)}
          onDone={() => { setAcceptingCashier(null); onRefresh() }}
        />
      )}

      {/* Modal: limpiar duplicados con la palabra "Pan" */}
      {cleanupOpen && (
        <CleanupPanProductsModal
          cashierProducts={cashierProducts}
          onCancel={() => setCleanupOpen(false)}
          onDone={() => setCleanupOpen(false)}
        />
      )}

      {/* Confirmar eliminar producto cajera */}
      {confirmDelCashier && (
        <Modal onClose={() => setConfirmDelCashier(null)} title="¿Eliminar producto?">
          <div style={{ fontSize: 14, color: T.neutral[600], marginBottom: 8 }}>
            <b>{confirmDelCashier.name}</b>
          </div>
          <div style={{ fontSize: 13, color: T.neutral[500], marginBottom: 20, lineHeight: 1.5 }}>
            Este producto fue creado por una cajera. Se eliminará del catálogo y ya no aparecerá en futuras búsquedas. Las ventas que ya lo usaron no se ven afectadas.
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setConfirmDelCashier(null)} style={{
              flex: 1, padding: 13, borderRadius: 12, border: 'none',
              background: T.neutral[100], color: T.neutral[700],
              fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}>Cancelar</button>
            <button
              onClick={async () => {
                await deleteCashierProduct(confirmDelCashier.id)
                setConfirmDelCashier(null)
              }}
              style={{
                flex: 1, padding: 13, borderRadius: 12, border: 'none',
                background: T.bad, color: '#fff',
                fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Eliminar
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── Vista tabla (desktop) ──────────────────────────────────────
function ProductTable({ products, onEdit, onDelete }) {
  const cols = [
    { label: 'Producto',          flex: 2.5 },
    { label: 'Costo/unidad',      flex: 1.2 },
    { label: 'Precios por panadería', flex: 2.2 },
    { label: 'Ganancia/u',        flex: 1.2 },
    { label: 'Margen',            flex: 1   },
    { label: '',                  flex: 0.7 },
  ]

  return (
    <div style={{ padding: '0 16px' }}>
      <Card padding={0}>
        {/* Header tabla */}
        <div style={{
          display: 'flex', padding: '10px 16px',
          borderBottom: `1px solid ${T.neutral[100]}`,
          background: T.neutral[25],
          borderRadius: '16px 16px 0 0',
        }}>
          {cols.map((c, i) => (
            <div key={i} style={{
              flex: c.flex, fontSize: 11, fontWeight: 700,
              color: T.neutral[400], textTransform: 'uppercase', letterSpacing: 0.5,
              textAlign: i > 1 && i < 6 ? 'right' : 'left',
              paddingRight: i < cols.length - 1 ? 8 : 0,
            }}>
              {c.label}
            </div>
          ))}
        </div>

        {/* Filas */}
        {products.map((p, i) => (
          <div key={p.id} style={{
            display: 'flex', alignItems: 'center',
            padding: '13px 16px',
            borderBottom: i < products.length - 1 ? `0.5px solid ${T.neutral[100]}` : 'none',
            transition: 'background 0.1s',
          }}
            onMouseEnter={e => e.currentTarget.style.background = T.neutral[25]}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            {/* Nombre */}
            <div style={{ flex: 2.5, display: 'flex', alignItems: 'center', gap: 10, paddingRight: 8 }}>
              <div style={{
                width: 34, height: 34, borderRadius: 9, flexShrink: 0,
                background: T.copper[50],
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <ProductIcon color={T.copper[500]}/>
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: T.neutral[800] }}>{p.name}</div>
                {p.byPackage && (
                  <div style={{ fontSize: 11, color: T.neutral[400] }}>
                    Paquete × {p.unitsPerPackage}u · {fmtCOP(p.packageCost)}
                  </div>
                )}
                {p.notes && (
                  <div style={{ fontSize: 11, color: T.neutral[400], fontStyle: 'italic' }}>{p.notes}</div>
                )}
              </div>
            </div>

            {/* Costo/u */}
            <div style={{ flex: 1.2, textAlign: 'right', paddingRight: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: T.neutral[600], fontVariantNumeric: 'tabular-nums' }}>
                {fmtCOP(p.costPerUnit)}
              </span>
            </div>

            {/* Precios por panaderia */}
            <div style={{ flex: 2.2, textAlign: 'right', paddingRight: 8 }}>
              <PricesByBranchInline product={p}/>
            </div>

            {/* Ganancia/u */}
            <div style={{ flex: 1.2, textAlign: 'right', paddingRight: 8 }}>
              <span style={{
                fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                color: p.profit >= 0 ? T.ok : T.bad,
              }}>
                {p.profit >= 0 ? '+' : ''}{fmtCOP(p.profit)}
              </span>
            </div>

            {/* Margen */}
            <div style={{ flex: 1, textAlign: 'right', paddingRight: 8 }}>
              <MarginBadge margin={p.margin}/>
            </div>

            {/* Acciones */}
            <div style={{ flex: 0.7, display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
              <button onClick={() => onEdit(p.id)} style={{
                width: 30, height: 30, borderRadius: 8, border: 'none',
                background: T.neutral[100], color: T.neutral[600],
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                  <path d="M1.5 11 L4 10 L11.5 2.5 Q12.5 1.5 11.5 0.5 Q10.5 -0.5 9.5 0.5 L2 8 Z" stroke={T.neutral[500]} strokeWidth="1.2" fill="none" strokeLinejoin="round"/>
                </svg>
              </button>
              <button onClick={() => onDelete(p.id)} style={{
                width: 30, height: 30, borderRadius: 8, border: 'none',
                background: '#FAE8E6', color: T.bad,
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 3 H10 M4.5 3 V1.5 H7.5 V3 M4 5 V9.5 M8 5 V9.5 M2.5 3 L3 10 Q3 11 4 11 H8 Q9 11 9 10 L9.5 3" stroke={T.bad} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                </svg>
              </button>
            </div>
          </div>
        ))}
      </Card>
    </div>
  )
}

// ── Vista tarjetas (móvil) ─────────────────────────────────────
function ProductCards({ products, onEdit, onDelete }) {
  return (
    <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {products.map(p => (
        <Card key={p.id} padding={0}>
          <div style={{ padding: '14px 16px' }}>
            {/* Fila 1: nombre + badge margen */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                  background: T.copper[50],
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <ProductIcon color={T.copper[500]}/>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: T.neutral[800], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.name}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 3, alignItems: 'center' }}>
                    {p.byPackage && (
                      <span style={{ fontSize: 11, color: T.neutral[400] }}>
                        Paq × {p.unitsPerPackage}u
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <MarginBadge margin={p.margin}/>
            </div>

            {/* Fila 2: métricas + precios por panadería */}
            <div style={{
              background: T.neutral[50], borderRadius: 10, padding: '10px 12px',
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 6 }}>
                <MetricCell label="Costo/u" value={fmtCOP(p.costPerUnit)} color={T.neutral[600]}/>
                <MetricCell
                  label="Ganancia/u"
                  value={(p.profit >= 0 ? '+' : '') + fmtCOP(p.profit)}
                  color={p.profit >= 0 ? T.ok : T.bad}
                />
              </div>
              <div style={{ borderTop: `0.5px solid ${T.neutral[200]}`, paddingTop: 8 }}>
                <PricesByBranchBlock product={p}/>
              </div>
            </div>

            {/* Fila 3: si viene en paquete */}
            {p.byPackage && (
              <div style={{ marginTop: 8, fontSize: 11, color: T.neutral[400] }}>
                Paquete: {fmtCOP(p.packageCost)} · {p.unitsPerPackage} unidades
                {' · '}Ganancia por paquete:{' '}
                <span style={{ fontWeight: 700, color: p.profit >= 0 ? T.ok : T.bad }}>
                  {fmtCOP(p.profit * p.unitsPerPackage)}
                </span>
              </div>
            )}

            {p.notes && (
              <div style={{ marginTop: 6, fontSize: 11, color: T.neutral[400], fontStyle: 'italic' }}>
                {p.notes}
              </div>
            )}

            {/* Acciones */}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={() => onEdit(p.id)} style={{
                flex: 1, padding: '8px', borderRadius: 10, border: 'none',
                background: T.neutral[100], color: T.neutral[600],
                fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              }}>Editar</button>
              <button onClick={() => onDelete(p.id)} style={{
                flex: 1, padding: '8px', borderRadius: 10, border: 'none',
                background: '#FAE8E6', color: T.bad,
                fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              }}>Eliminar</button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}

function MetricCell({ label, value, color }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: T.neutral[400], textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
    </div>
  )
}

// ── Formulario agregar / editar ────────────────────────────────
function ProductForm({ initial, isEdit, onClose, onSave }) {
  const branches = getData().branches || []
  const [name,            setName]            = useState(initial?.name || '')
  const [freeAmount,      setFreeAmount]      = useState(initial?.freeAmount === true)
  const [byPackage,       setByPackage]        = useState(initial?.byPackage ?? true)
  const [packageCost,     setPackageCost]      = useState(initial?.packageCost != null ? String(initial.packageCost) : '')
  const [unitsPerPackage, setUnitsPerPackage]  = useState(initial?.unitsPerPackage != null ? String(initial.unitsPerPackage) : '')
  const [notes,           setNotes]            = useState(initial?.notes || '')
  // Precios por panadería: estado como mapa { [branchId]: stringValue }
  const [priceInputs, setPriceInputs] = useState(() => {
    const init = {}
    branches.forEach(b => {
      const v = initial?.pricesByBranch?.[String(b.id)]
      init[String(b.id)] = v && Number(v) > 0 ? String(v) : ''
    })
    return init
  })

  function setPriceFor(bid, val) {
    setPriceInputs(prev => ({ ...prev, [String(bid)]: val }))
  }

  const pc = Number(packageCost) || 0
  const up = Number(unitsPerPackage) || 1
  const costPerUnit = byPackage ? (up > 0 ? pc / up : 0) : pc

  // Precios numéricos válidos
  const definedPrices = Object.values(priceInputs).map(Number).filter(n => n > 0)
  const avgPrice = definedPrices.length > 0
    ? definedPrices.reduce((s, n) => s + n, 0) / definedPrices.length
    : 0
  const profit = avgPrice - costPerUnit
  const margin = avgPrice > 0 ? (profit / avgPrice) * 100 : 0

  // Solo requiere nombre + costo. Los precios son opcionales (cajera los pone al usar).
  // Si es venta libre: NO requiere costo (el costo lo decide la cajera al venderlo).
  const canSave = name.trim() && (freeAmount || (pc > 0 && (!byPackage || up > 0)))

  function handleSave() {
    if (!canSave) return
    // Si es venta libre: NO se guardan precios ni costo (el monto lo elige la cajera).
    if (freeAmount) {
      const data = {
        name: name.trim(),
        freeAmount: true,
        pricesByBranch: {},
        packageCost: 0,
        unitsPerPackage: 1,
        byPackage: false,
        notes: notes.trim(),
      }
      if (isEdit) {
        updateProduct(initial.id, data)
      } else {
        addProduct(data)
      }
      onSave()
      return
    }
    // Construir pricesByBranch limpio (solo entradas con valor > 0)
    const pricesByBranch = {}
    Object.entries(priceInputs).forEach(([bid, val]) => {
      const num = Number(val)
      if (num > 0) pricesByBranch[bid] = num
    })
    const data = {
      name: name.trim(),
      freeAmount: false,
      byPackage,
      packageCost: pc,
      unitsPerPackage: byPackage ? up : 1,
      pricesByBranch,
      notes: notes.trim(),
    }
    if (isEdit) {
      updateProduct(initial.id, data)
    } else {
      addProduct(data)
    }
    onSave()
  }

  return (
    <Modal onClose={onClose} title={isEdit ? 'Editar producto' : 'Nuevo producto'}>
      {/* Nombre */}
      <InputField
        label="Nombre del producto"
        value={name}
        onChange={setName}
        placeholder="Ej: Pan tajado, Croissant..."
      />

      {/* Toggle Venta libre */}
      <div style={{ marginBottom: 14 }}>
        <button
          onClick={() => setFreeAmount(v => !v)}
          style={{
            width: '100%', padding: '14px',
            background: freeAmount ? T.copper[50] : '#fff',
            border: `1.5px solid ${freeAmount ? T.copper[400] : T.neutral[200]}`,
            borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left',
          }}
        >
          <div style={{
            width: 22, height: 22, borderRadius: 6,
            background: freeAmount ? T.copper[500] : T.neutral[100],
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            {freeAmount && (
              <svg width="14" height="14" viewBox="0 0 14 14">
                <path d="M3 7 L6 10 L11 4" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: freeAmount ? T.copper[700] : T.neutral[800] }}>
              Venta libre
            </div>
            <div style={{ fontSize: 11.5, color: T.neutral[500], marginTop: 2, lineHeight: 1.4 }}>
              El cliente dice de cuánto quiere (ej: "$2.000 de pan"). La cajera escribe el monto al vender.
            </div>
          </div>
        </button>
      </div>

      {/* Si es venta libre, NO mostrar costo ni precios — saltamos directo a notas */}
      {freeAmount ? (
        <div style={{
          padding: '12px 14px', borderRadius: 12,
          background: T.copper[50], border: `1px solid ${T.copper[100]}`,
          fontSize: 12.5, color: T.copper[700], lineHeight: 1.5, marginBottom: 14,
        }}>
          ✓ Producto de venta libre. La cajera escribirá el monto al vender (mínimo $400).
          No requiere precio ni costo.
        </div>
      ) : (
      <>
      {/* Toggle paquete */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.neutral[500], textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
          ¿Cómo lo compras?
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[
            { val: true,  label: 'Por paquete / bulto' },
            { val: false, label: 'Por unidad directa' },
          ].map(o => (
            <button key={String(o.val)} onClick={() => setByPackage(o.val)} style={{
              flex: 1, padding: '10px 8px', borderRadius: 10, border: 'none',
              cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
              background: byPackage === o.val ? T.copper[500] : T.neutral[100],
              color: byPackage === o.val ? '#fff' : T.neutral[600],
              transition: 'background 0.15s',
            }}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Costo */}
      {byPackage ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.neutral[500], textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
              Costo del paquete ($)
            </div>
            <input
              type="number" min="0" value={packageCost}
              onChange={e => setPackageCost(e.target.value)}
              placeholder="Ej: 18000"
              style={inputStyle}
            />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.neutral[500], textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
              Unidades por paquete
            </div>
            <input
              type="number" min="1" value={unitsPerPackage}
              onChange={e => setUnitsPerPackage(e.target.value)}
              placeholder="Ej: 12"
              style={inputStyle}
            />
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.neutral[500], textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
            Costo por unidad ($)
          </div>
          <input
            type="number" min="0" value={packageCost}
            onChange={e => setPackageCost(e.target.value)}
            placeholder="Ej: 1500"
            style={inputStyle}
          />
        </div>
      )}

      {/* Precios por panadería */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.neutral[500], textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
          Precio de venta por panadería ($)
        </div>
        <div style={{ fontSize: 11.5, color: T.neutral[500], marginBottom: 8, lineHeight: 1.4 }}>
          Si dejas alguno vacío, la cajera de esa panadería pondrá el precio la primera vez que lo venda.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {branches.map(b => (
            <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                flex: 1, fontSize: 13, fontWeight: 600, color: T.neutral[700],
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {b.name}
              </div>
              <input
                type="number" min="0"
                value={priceInputs[String(b.id)] || ''}
                onChange={e => setPriceFor(b.id, e.target.value)}
                placeholder="Precio o vacío"
                style={{ ...inputStyle, flex: 1, maxWidth: 180 }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Preview de ganancia en tiempo real */}
      {pc > 0 && avgPrice > 0 && (
        <div style={{
          marginBottom: 16, padding: '12px 14px', borderRadius: 12,
          background: marginBg(margin),
          border: `1px solid ${marginColor(margin)}22`,
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.neutral[500], textTransform: 'uppercase', letterSpacing: 0.4 }}>Costo/u</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.neutral[700], marginTop: 2 }}>{fmtCOP(costPerUnit)}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.neutral[500], textTransform: 'uppercase', letterSpacing: 0.4 }}>Ganancia</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: marginColor(margin), marginTop: 2 }}>
                {profit >= 0 ? '+' : ''}{fmtCOP(profit)}
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.neutral[500], textTransform: 'uppercase', letterSpacing: 0.4 }}>Margen</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: marginColor(margin), marginTop: 2 }}>
                {margin >= 0 ? '+' : ''}{margin.toFixed(1)}%
              </div>
            </div>
          </div>
          {byPackage && up > 0 && (
            <div style={{ marginTop: 8, textAlign: 'center', fontSize: 12, color: T.neutral[500] }}>
              Ganancia por paquete completo:
              {' '}
              <strong style={{ color: marginColor(margin) }}>
                {profit >= 0 ? '+' : ''}{fmtCOP(profit * up)}
              </strong>
            </div>
          )}
        </div>
      )}
      </>
      )}

      {/* Notas opcionales */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.neutral[500], textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
          Notas <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(opcional)</span>
        </div>
        <input
          type="text" value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Ej: Proveedor Harinera Central..."
          style={inputStyle}
        />
      </div>

      <PrimaryButton
        label={isEdit ? 'Guardar cambios' : 'Agregar producto'}
        onClick={handleSave}
        disabled={!canSave}
      />
    </Modal>
  )
}

const inputStyle = {
  width: '100%', padding: '12px 14px', borderRadius: 12,
  border: `1px solid ${T.neutral[200]}`, background: '#fff',
  fontSize: 15, color: T.neutral[800], fontFamily: 'inherit',
  outline: 'none', boxSizing: 'border-box',
}

// ── Modal: Aceptar producto creado por cajera ─────────────────
function AcceptCashierProductModal({ product, onCancel, onDone }) {
  const branches = getData().branches || []
  // Pre-llenar precios con lo que ya tenga el producto cajera
  const [priceInputs, setPriceInputs] = useState(() => {
    const init = {}
    branches.forEach(b => {
      const v = product?.pricesByBranch?.[String(b.id)]
      init[String(b.id)] = v && Number(v) > 0 ? String(v) : ''
    })
    return init
  })
  const [byPackage, setByPackage] = useState(false)
  const [packageCost, setPackageCost] = useState('')
  const [unitsPerPackage, setUnitsPerPackage] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  function setPriceFor(bid, val) {
    setPriceInputs(prev => ({ ...prev, [String(bid)]: val.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '') }))
  }

  // Costo unitario
  const cost = byPackage
    ? (Number(unitsPerPackage) > 0 ? (Number(packageCost) || 0) / Number(unitsPerPackage) : 0)
    : (Number(unitCost) || 0)

  const definedPrices = Object.values(priceInputs).map(Number).filter(n => n > 0)
  const avgPrice = definedPrices.length > 0
    ? definedPrices.reduce((s, n) => s + n, 0) / definedPrices.length
    : 0
  const profit = avgPrice - cost
  const margin = avgPrice > 0 ? (profit / avgPrice) * 100 : 0

  // Solo requiere costo. Los precios son opcionales (pueden quedar para que cajera los ponga).
  const valid = byPackage
    ? (Number(packageCost) > 0 && Number(unitsPerPackage) > 0)
    : Number(unitCost) > 0

  async function handleAccept() {
    if (!valid || busy) return
    setBusy(true); setError(null)
    try {
      const pricesByBranch = {}
      Object.entries(priceInputs).forEach(([bid, val]) => {
        const num = Number(val)
        if (num > 0) pricesByBranch[bid] = num
      })
      // 1. Crear el producto en /todypan/data.products (catálogo del admin)
      addProduct({
        name: product.name,
        pricesByBranch,
        packageCost: byPackage ? Number(packageCost) : Number(unitCost),
        byPackage,
        unitsPerPackage: byPackage ? Number(unitsPerPackage) : 0,
      })
      // 2. Eliminar el producto cajera (se "promovió")
      await deleteCashierProduct(product.id)
      onDone()
    } catch (err) {
      console.error(err)
      setError('No pudimos aceptar el producto. Intenta de nuevo.')
      setBusy(false)
    }
  }

  return (
    <Modal onClose={busy ? undefined : onCancel} title="Aceptar producto">
      <div style={{
        padding: '10px 12px', borderRadius: 10,
        background: T.copper[50], border: `1px solid ${T.copper[100]}`,
        marginBottom: 14,
      }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: T.copper[700], letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 4 }}>
          Producto creado por
        </div>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: T.neutral[900] }}>
          {product.name}
        </div>
        <div style={{ fontSize: 12, color: T.neutral[600], marginTop: 2 }}>
          {product.createdByName || 'Cajera'}
        </div>
      </div>

      {/* Precios por panadería */}
      <label style={fieldLabel()}>Precios por panadería</label>
      <div style={{ fontSize: 11.5, color: T.neutral[500], marginBottom: 8, lineHeight: 1.4 }}>
        Si dejas alguno vacío, la cajera de esa panadería pondrá el precio la primera vez que lo venda.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
        {branches.map(b => (
          <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              flex: 1, fontSize: 13, fontWeight: 600, color: T.neutral[700],
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {b.name}
            </div>
            <div style={{ ...moneyInputWrap(), flex: 1, maxWidth: 180, marginBottom: 0 }}>
              <span style={moneyPrefix()}>$</span>
              <input
                type="text"
                inputMode="numeric"
                value={priceInputs[String(b.id)] || ''}
                onChange={e => setPriceFor(b.id, e.target.value)}
                placeholder="0"
                disabled={busy}
                style={moneyInput()}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Toggle modo de costo */}
      <label style={fieldLabel()}>¿Cómo lo compras?</label>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button
          onClick={() => setByPackage(false)}
          disabled={busy}
          style={toggleBtn(!byPackage)}
        >
          Por unidad
        </button>
        <button
          onClick={() => setByPackage(true)}
          disabled={busy}
          style={toggleBtn(byPackage)}
        >
          Por paquete
        </button>
      </div>

      {byPackage ? (
        <>
          <label style={fieldLabel()}>Unidades por paquete</label>
          <input
            type="text"
            inputMode="numeric"
            value={unitsPerPackage}
            onChange={e => setUnitsPerPackage(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="Ej. 24"
            disabled={busy}
            style={{ ...inputStyle, marginBottom: 12 }}
          />
          <label style={fieldLabel()}>Costo del paquete</label>
          <div style={moneyInputWrap()}>
            <span style={moneyPrefix()}>$</span>
            <input
              type="text"
              inputMode="numeric"
              value={packageCost === '0' ? '' : packageCost}
              onChange={e => setPackageCost(e.target.value.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, ''))}
              placeholder="0"
              disabled={busy}
              style={moneyInput()}
            />
          </div>
        </>
      ) : (
        <>
          <label style={fieldLabel()}>Costo por unidad</label>
          <div style={moneyInputWrap()}>
            <span style={moneyPrefix()}>$</span>
            <input
              type="text"
              inputMode="numeric"
              value={unitCost === '0' ? '' : unitCost}
              onChange={e => setUnitCost(e.target.value.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, ''))}
              placeholder="0"
              disabled={busy}
              style={moneyInput()}
            />
          </div>
        </>
      )}

      {/* Resumen de margen */}
      {valid && avgPrice > 0 && (
        <div style={{
          padding: '10px 12px', borderRadius: 10,
          background: T.neutral[50], marginBottom: 14,
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.neutral[500], letterSpacing: 0.4, textTransform: 'uppercase' }}>
              Ganancia / unidad
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: profit >= 0 ? T.ok : T.bad, fontVariantNumeric: 'tabular-nums' }}>
              {fmtCOP(profit)}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.neutral[500], letterSpacing: 0.4, textTransform: 'uppercase' }}>
              Margen
            </div>
            <div style={{
              fontSize: 16, fontWeight: 800,
              color: margin >= 40 ? T.ok : margin >= 20 ? T.warn : T.bad,
              fontVariantNumeric: 'tabular-nums',
            }}>
              {margin.toFixed(1)}%
            </div>
          </div>
        </div>
      )}

      {error && (
        <div style={{
          marginBottom: 10, padding: '10px 12px', borderRadius: 10,
          background: '#FBE9E5', border: `1px solid #F0C8BE`, color: T.bad,
          fontSize: 12.5, fontWeight: 500, textAlign: 'center',
        }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onCancel} disabled={busy} style={{
          flex: 1, padding: 13, borderRadius: 12, border: 'none',
          background: T.neutral[100], color: T.neutral[700],
          fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
        }}>Cancelar</button>
        <button
          onClick={handleAccept}
          disabled={!valid || busy}
          style={{
            flex: 1.4, padding: 13, borderRadius: 12, border: 'none',
            background: valid && !busy ? T.copper[500] : T.neutral[200],
            color: valid && !busy ? '#fff' : T.neutral[400],
            fontSize: 15, fontWeight: 700,
            cursor: valid && !busy ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit',
            boxShadow: valid && !busy ? '0 3px 10px rgba(184,122,86,0.3)' : 'none',
          }}
        >
          {busy ? 'Aceptando...' : 'Aceptar y agregar al catálogo'}
        </button>
      </div>
    </Modal>
  )
}

function fieldLabel() {
  return {
    display: 'block',
    fontSize: 12, fontWeight: 700, color: T.neutral[600],
    letterSpacing: 0.3, textTransform: 'uppercase',
    marginBottom: 6,
  }
}
function moneyInputWrap() {
  return {
    display: 'flex', alignItems: 'center',
    border: `1px solid ${T.neutral[200]}`, borderRadius: 12,
    background: '#fff', marginBottom: 12,
  }
}
function moneyPrefix() {
  return {
    paddingLeft: 14, color: T.neutral[500], fontSize: 15, fontWeight: 600,
  }
}
function moneyInput() {
  return {
    width: '100%', padding: '12px 14px 12px 8px',
    border: 'none', outline: 'none',
    fontFamily: 'inherit', fontSize: 16, fontWeight: 600,
    color: T.neutral[900], background: 'transparent',
    fontVariantNumeric: 'tabular-nums',
  }
}
function toggleBtn(active) {
  return {
    flex: 1, padding: '10px', borderRadius: 12,
    background: active ? T.copper[500] : T.neutral[100],
    color: active ? '#fff' : T.neutral[700],
    border: 'none', cursor: 'pointer', fontFamily: 'inherit',
    fontSize: 13, fontWeight: 700,
  }
}
function chipBtn(active) {
  return {
    padding: '8px 14px', borderRadius: 999,
    background: active ? T.copper[50] : '#fff',
    color: active ? T.copper[700] : T.neutral[600],
    border: `1px solid ${active ? T.copper[400] : T.neutral[200]}`,
    cursor: 'pointer', fontFamily: 'inherit',
    fontSize: 12.5, fontWeight: 700,
  }
}

// ── Modal: limpiar duplicados con la palabra "Pan" ──────────────
function CleanupPanProductsModal({ cashierProducts, onCancel, onDone }) {
  const matches = (cashierProducts || []).filter(p => /pan/i.test(p.name || ''))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [doneCount, setDoneCount] = useState(0)

  async function handleConfirm() {
    if (busy) return
    setBusy(true); setError(null)
    let n = 0
    try {
      for (const p of matches) {
        await deleteCashierProduct(p.id)
        n++
        setDoneCount(n)
      }
      onDone()
    } catch (err) {
      console.error('[cleanup] failed at item', n, err)
      setError(`Se borraron ${n} de ${matches.length}. Reintenta para terminar.`)
      setBusy(false)
    }
  }

  return (
    <Modal onClose={busy ? undefined : onCancel} title="Limpiar productos de pan">
      <div style={{ fontSize: 13, color: T.neutral[600], marginBottom: 14, lineHeight: 1.5 }}>
        Voy a borrar <b>{matches.length} producto{matches.length === 1 ? '' : 's'}</b> creado{matches.length === 1 ? '' : 's'} por cajeras que contiene{matches.length === 1 ? '' : 'n'} la palabra <b>"Pan"</b>.
        Las ventas que ya los usaron <b>NO se afectan</b>.
      </div>

      {matches.length > 0 ? (
        <div style={{
          maxHeight: 200, overflowY: 'auto',
          padding: '10px 12px', borderRadius: 10,
          background: T.neutral[50], border: `1px solid ${T.neutral[100]}`,
          marginBottom: 14, fontSize: 12.5, color: T.neutral[700], lineHeight: 1.6,
        }}>
          {matches.map(p => (
            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.name}
              </span>
              {p.createdByName && (
                <span style={{ color: T.neutral[400], fontSize: 11, flexShrink: 0 }}>
                  · {p.createdByName}
                </span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ marginBottom: 14, fontSize: 13, color: T.neutral[500], fontStyle: 'italic' }}>
          No hay productos de cajera con la palabra "Pan".
        </div>
      )}

      {busy && (
        <div style={{ fontSize: 12.5, color: T.copper[600], textAlign: 'center', marginBottom: 12 }}>
          Borrando {doneCount} de {matches.length}...
        </div>
      )}

      {error && (
        <div style={{
          marginBottom: 12, padding: '10px 12px', borderRadius: 10,
          background: '#FBE9E5', border: `1px solid #F0C8BE`, color: T.bad,
          fontSize: 12.5, fontWeight: 500, textAlign: 'center',
        }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onCancel} disabled={busy} style={{
          flex: 1, padding: 13, borderRadius: 12, border: 'none',
          background: T.neutral[100], color: T.neutral[700],
          fontSize: 14, fontWeight: 700, cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
        }}>Cancelar</button>
        <button
          onClick={handleConfirm}
          disabled={busy || matches.length === 0}
          style={{
            flex: 1.4, padding: 13, borderRadius: 12, border: 'none',
            background: matches.length > 0 && !busy ? T.bad : T.neutral[200],
            color: matches.length > 0 && !busy ? '#fff' : T.neutral[400],
            fontSize: 14, fontWeight: 700, cursor: matches.length > 0 && !busy ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit',
            boxShadow: matches.length > 0 && !busy ? `0 3px 10px ${T.bad}44` : 'none',
          }}
        >
          {busy ? 'Borrando...' : `Borrar ${matches.length}`}
        </button>
      </div>
    </Modal>
  )
}

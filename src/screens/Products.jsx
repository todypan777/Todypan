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
  const profit = p.salePrice - costPerUnit
  const margin = p.salePrice > 0 ? (profit / p.salePrice) * 100 : 0
  return { costPerUnit, profit, margin }
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
      {/* Header */}
      {!isDesktop && (
        <div style={{ padding: '56px 16px 0' }}>
          <BackButton onBack={onBack} label="Más"/>
        </div>
      )}

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
                      Precio: <b style={{ color: T.neutral[700] }}>{fmtCOP(p.salePrice)}</b>
                      {p.createdByName && ` · por ${p.createdByName}`}
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
    { label: 'Producto',       flex: 2.5 },
    { label: 'Sucursal',       flex: 1   },
    { label: 'Costo/unidad',   flex: 1.2 },
    { label: 'Precio venta',   flex: 1.2 },
    { label: 'Ganancia/u',     flex: 1.2 },
    { label: 'Margen',         flex: 1   },
    { label: '',               flex: 0.7 },
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

            {/* Sucursal */}
            <div style={{ flex: 1, paddingRight: 8 }}>
              <BranchTag branch={p.branch}/>
            </div>

            {/* Costo/u */}
            <div style={{ flex: 1.2, textAlign: 'right', paddingRight: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: T.neutral[600], fontVariantNumeric: 'tabular-nums' }}>
                {fmtCOP(p.costPerUnit)}
              </span>
            </div>

            {/* Precio venta */}
            <div style={{ flex: 1.2, textAlign: 'right', paddingRight: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: T.neutral[800], fontVariantNumeric: 'tabular-nums' }}>
                {fmtCOP(p.salePrice)}
              </span>
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
                    <BranchTag branch={p.branch}/>
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

            {/* Fila 2: métricas en grid */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
              gap: 8, background: T.neutral[50], borderRadius: 10, padding: '10px 12px',
            }}>
              <MetricCell label="Costo/u" value={fmtCOP(p.costPerUnit)} color={T.neutral[600]}/>
              <MetricCell label="Precio" value={fmtCOP(p.salePrice)} color={T.neutral[800]}/>
              <MetricCell
                label="Ganancia/u"
                value={(p.profit >= 0 ? '+' : '') + fmtCOP(p.profit)}
                color={p.profit >= 0 ? T.ok : T.bad}
              />
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
  const [name,            setName]            = useState(initial?.name || '')
  const [byPackage,       setByPackage]        = useState(initial?.byPackage ?? true)
  const [packageCost,     setPackageCost]      = useState(initial?.packageCost != null ? String(initial.packageCost) : '')
  const [unitsPerPackage, setUnitsPerPackage]  = useState(initial?.unitsPerPackage != null ? String(initial.unitsPerPackage) : '')
  const [salePrice,       setSalePrice]        = useState(initial?.salePrice != null ? String(initial.salePrice) : '')
  const [branch,          setBranch]           = useState(initial?.branch ?? 'both')
  const [notes,           setNotes]            = useState(initial?.notes || '')

  const pc = Number(packageCost) || 0
  const up = Number(unitsPerPackage) || 1
  const sp = Number(salePrice) || 0
  const costPerUnit = byPackage ? (up > 0 ? pc / up : 0) : pc
  const profit = sp - costPerUnit
  const margin = sp > 0 ? (profit / sp) * 100 : 0

  const canSave = name.trim() && pc > 0 && sp > 0 && (!byPackage || up > 0)

  function handleSave() {
    if (!canSave) return
    const data = {
      name: name.trim(),
      byPackage,
      packageCost: pc,
      unitsPerPackage: byPackage ? up : 1,
      salePrice: sp,
      branch,
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

      {/* Precio de venta */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.neutral[500], textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
          Precio de venta por unidad ($)
        </div>
        <input
          type="number" min="0" value={salePrice}
          onChange={e => setSalePrice(e.target.value)}
          placeholder="Ej: 2500"
          style={inputStyle}
        />
      </div>

      {/* Preview de ganancia en tiempo real */}
      {pc > 0 && sp > 0 && (
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

      {/* Sucursal */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.neutral[500], textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
          Panadería
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[{ v: 'both', l: 'Ambas' }, ...getData().branches.map(b => ({ v: b.id, l: b.name }))].map(b => (
            <button key={b.v} onClick={() => setBranch(b.v)} style={{
              flex: 1, padding: '9px', borderRadius: 10, border: 'none',
              cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
              background: branch === b.v ? T.copper[500] : T.neutral[100],
              color: branch === b.v ? '#fff' : T.neutral[700],
              transition: 'background 0.15s',
            }}>{b.l}</button>
          ))}
        </div>
      </div>

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
  const [salePrice, setSalePrice] = useState(String(product.salePrice || ''))
  const [byPackage, setByPackage] = useState(false)
  const [packageCost, setPackageCost] = useState('')
  const [unitsPerPackage, setUnitsPerPackage] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [branch, setBranch] = useState(product.branch || 'both')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // Cálculo del costo final por unidad y margen
  const sale = Number(salePrice) || 0
  const cost = byPackage
    ? (Number(unitsPerPackage) > 0 ? (Number(packageCost) || 0) / Number(unitsPerPackage) : 0)
    : (Number(unitCost) || 0)
  const profit = sale - cost
  const margin = sale > 0 ? (profit / sale) * 100 : 0

  const valid = sale > 0 && (
    byPackage
      ? (Number(packageCost) > 0 && Number(unitsPerPackage) > 0)
      : Number(unitCost) > 0
  )

  async function handleAccept() {
    if (!valid || busy) return
    setBusy(true); setError(null)
    try {
      // 1. Crear el producto en /todypan/data.products (catálogo del admin)
      addProduct({
        name: product.name,
        salePrice: sale,
        packageCost: byPackage ? Number(packageCost) : Number(unitCost),
        byPackage,
        unitsPerPackage: byPackage ? Number(unitsPerPackage) : 0,
        branch,
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

      {/* Precio de venta */}
      <label style={fieldLabel()}>Precio de venta</label>
      <div style={moneyInputWrap()}>
        <span style={moneyPrefix()}>$</span>
        <input
          type="text"
          inputMode="numeric"
          value={salePrice === '0' ? '' : salePrice}
          onChange={e => setSalePrice(e.target.value.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, ''))}
          placeholder="0"
          disabled={busy}
          style={moneyInput()}
        />
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

      {/* Sucursal */}
      <label style={fieldLabel()}>Sucursal</label>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {[
          { id: 'both', label: 'Ambas' },
          { id: 1, label: 'Iglesia' },
          { id: 2, label: 'Esquina' },
        ].map(b => (
          <button
            key={b.id}
            onClick={() => setBranch(b.id)}
            disabled={busy}
            style={chipBtn(branch === b.id)}
          >
            {b.label}
          </button>
        ))}
      </div>

      {/* Resumen de margen */}
      {valid && (
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

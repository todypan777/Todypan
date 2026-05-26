import { useState, useMemo, useEffect } from 'react'
import { T } from '../tokens'
import { fmtCOP } from '../utils/format'
import { Card, Modal, PrimaryButton } from '../components/Atoms'
import { ScreenHeader } from '../components/Nav'
import { addProduct, updateProduct, deleteProduct, getData } from '../db'
import { useIsDesktop } from '../context/DesktopCtx'
import { watchCashierProducts, deleteCashierProduct } from '../products'

// ── Helpers de cálculo ─────────────────────────────────────────
function calcProduct(p) {
  const costPerUnit = p.byPackage
    ? (p.unitsPerPackage > 0 ? p.packageCost / p.unitsPerPackage : 0)
    : p.packageCost
  const prices = Object.values(p.pricesByBranch || {}).map(Number).filter(n => n > 0)
  const minPrice = prices.length > 0 ? Math.min(...prices) : 0
  const maxPrice = prices.length > 0 ? Math.max(...prices) : 0
  const avgPrice = prices.length > 0 ? prices.reduce((s, n) => s + n, 0) / prices.length : 0
  const profit = avgPrice - costPerUnit
  const margin = avgPrice > 0 ? (profit / avgPrice) * 100 : 0
  return { costPerUnit, profit, margin, minPrice, maxPrice, avgPrice, prices }
}

function priceBreakdown(p) {
  const branches = getData().branches || []
  return branches
    .map(b => {
      const v = p.pricesByBranch?.[String(b.id)]
      return v && Number(v) > 0 ? { name: b.name, price: Number(v) } : null
    })
    .filter(Boolean)
}

function branchesMissingPrice(p) {
  const branches = getData().branches || []
  return branches.filter(b => {
    const v = p.pricesByBranch?.[String(b.id)]
    return !v || Number(v) <= 0
  })
}

// "Sin configurar" si: producto creado por cajera sin revisar, o sin costo,
// o sin precio en alguna panadería. Excepción: ventas libres y almuerzos.
function needsSetup(p) {
  // Venta libre: configurada solo si tiene valor base (obligatorio para
  // registrar unidades). Sin base → pendiente de configurar.
  if (p.freeAmount) return !(Number(p.freeUnitPrice) > 0)
  if (p.isLunch) return false
  if (p.source === 'cashier') return true
  if (!p.packageCost || Number(p.packageCost) <= 0) return true
  if (branchesMissingPrice(p).length > 0) return true
  return false
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

function ProductIcon({ color = T.copper[400] }) {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
      <rect x="3" y="8" width="14" height="9" rx="2" stroke={color} strokeWidth="1.6" fill="none"/>
      <path d="M6 8 Q6 4 10 4 Q14 4 14 8" stroke={color} strokeWidth="1.6" fill="none"/>
      <path d="M7 12 H13 M9 10.5 V13.5" stroke={color} strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  )
}

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

function SetupBadge() {
  return (
    <span style={{
      display: 'inline-block', padding: '3px 9px', borderRadius: 999,
      background: '#FAE8E6', color: T.bad,
      fontSize: 11, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase',
      whiteSpace: 'nowrap',
    }}>
      Sin configurar
    </span>
  )
}

function PricesByBranchInline({ product }) {
  if (product.isLunch) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, color: T.copper[700],
          background: T.copper[50], padding: '2px 7px', borderRadius: 999,
          letterSpacing: 0.4, textTransform: 'uppercase',
        }}>
          🍽️ Almuerzo
        </span>
        <div style={{ fontSize: 12, fontWeight: 600, color: T.neutral[700] }}>
          <span style={{ color: T.neutral[500] }}>Mesa: </span>
          <span style={{ color: T.neutral[900], fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {fmtCOP(product.priceMesa || 0)}
          </span>
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, color: T.neutral[700] }}>
          <span style={{ color: T.neutral[500] }}>Llevar: </span>
          <span style={{ color: T.neutral[900], fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {fmtCOP(product.priceLlevar || product.priceMesa || 0)}
          </span>
        </div>
      </div>
    )
  }
  if (product.freeAmount) {
    const base = Number(product.freeUnitPrice) || 0
    return (
      <span style={{
        fontSize: 11.5, fontWeight: 700, color: T.copper[700],
        background: T.copper[50], padding: '4px 10px', borderRadius: 999,
        letterSpacing: 0.3, textTransform: 'uppercase',
      }}>
        {base > 0 ? `Venta libre · ${fmtCOP(base)}/u` : 'Venta libre'}
      </span>
    )
  }
  const breakdown = priceBreakdown(product)
  const missing = branchesMissingPrice(product)
  if (breakdown.length === 0) {
    return (
      <span style={{ fontSize: 12, color: T.copper[700], fontStyle: 'italic' }}>
        Sin precios todavía
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

function PricesByBranchBlock({ product }) {
  if (product.isLunch) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{
          fontSize: 11, fontWeight: 700, color: T.copper[700],
          letterSpacing: 0.3, textAlign: 'center', marginBottom: 2,
        }}>
          🍽️ Almuerzo (con menú del día)
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
          <span style={{ color: T.neutral[600], fontWeight: 600 }}>Para mesa</span>
          <span style={{ color: T.neutral[900], fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {fmtCOP(product.priceMesa || 0)}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
          <span style={{ color: T.neutral[600], fontWeight: 600 }}>Para llevar</span>
          <span style={{ color: T.neutral[900], fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {fmtCOP(product.priceLlevar || product.priceMesa || 0)}
          </span>
        </div>
      </div>
    )
  }
  if (product.freeAmount) {
    const base = Number(product.freeUnitPrice) || 0
    return (
      <div style={{
        fontSize: 12, fontWeight: 700, color: T.copper[700],
        textAlign: 'center', letterSpacing: 0.3, textTransform: 'uppercase',
      }}>
        {base > 0 ? `Venta libre · base ${fmtCOP(base)}/u` : 'Venta libre · falta valor base'}
      </div>
    )
  }
  const breakdown = priceBreakdown(product)
  const missing = branchesMissingPrice(product)
  if (breakdown.length === 0) {
    return (
      <div style={{ fontSize: 12, color: T.copper[700], textAlign: 'center', fontStyle: 'italic' }}>
        Sin precios todavía
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

// ── Componente principal ───────────────────────────────────────
export default function Products({ products, onRefresh }) {
  const isDesktop = useIsDesktop()
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)
  const [cashierProducts, setCashierProducts] = useState([])

  useEffect(() => watchCashierProducts(setCashierProducts), [])

  // Lista unificada: admins + cashier (sin duplicados por nombre).
  const all = useMemo(() => {
    const adminEnriched = (products || []).map(p => ({
      ...p,
      ...calcProduct(p),
      source: 'admin',
    }))
    const adminNames = new Set(adminEnriched.map(p => p.name.toLowerCase().trim()))
    const cashierEnriched = (cashierProducts || [])
      .filter(p => !adminNames.has((p.name || '').toLowerCase().trim()))
      .map(p => ({
        ...p,
        ...calcProduct(p),
        source: 'cashier',
      }))
    return [...adminEnriched, ...cashierEnriched]
  }, [products, cashierProducts])

  // Filtrar por búsqueda + ordenar A–Z.
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    const list = q ? all.filter(p => (p.name || '').toLowerCase().includes(q)) : all
    return [...list].sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  }, [all, search])

  const missingCount = all.filter(needsSetup).length

  async function handleDelete(p) {
    if (!p) return
    if (p.source === 'cashier') {
      await deleteCashierProduct(p.id)
    } else {
      deleteProduct(p.id)
    }
    setConfirmDel(null)
    onRefresh?.()
  }

  return (
    <div style={{ paddingBottom: 110 }}>
      <ScreenHeader
        title="Productos"
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

      {/* Resumen mínimo en una línea */}
      {all.length > 0 && (
        <div style={{ padding: '0 16px 10px', fontSize: 12, color: T.neutral[500], display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span><b style={{ color: T.neutral[800] }}>{all.length}</b> productos</span>
          {missingCount > 0 && (
            <span>· <b style={{ color: T.bad }}>{missingCount}</b> sin configurar</span>
          )}
        </div>
      )}

      {/* Buscador */}
      <div style={{ padding: '0 16px 14px' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: '#fff', border: `1px solid ${T.neutral[200]}`,
          borderRadius: 12, padding: '11px 14px',
        }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="4.5" stroke={T.neutral[400]} strokeWidth="1.5"/>
            <path d="M10.5 10.5 L14 14" stroke={T.neutral[400]} strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar producto por nombre..."
            style={{
              border: 'none', outline: 'none', background: 'transparent',
              fontSize: 14.5, color: T.neutral[800], fontFamily: 'inherit', width: '100%',
            }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{
              border: 'none', background: 'none', cursor: 'pointer', padding: 0,
              color: T.neutral[400], fontSize: 18, lineHeight: 1,
            }}>×</button>
          )}
        </div>
      </div>

      {/* Estado vacío */}
      {all.length === 0 && (
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
      {all.length > 0 && filtered.length === 0 && (
        <div style={{ padding: '40px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: T.neutral[400] }}>
            No se encontró ningún producto con "{search}"
          </div>
        </div>
      )}

      {/* Tabla / Lista */}
      {filtered.length > 0 && (
        isDesktop
          ? <ProductTable products={filtered} onEdit={setEditTarget} onDelete={setConfirmDel}/>
          : <ProductCards products={filtered} onEdit={setEditTarget} onDelete={setConfirmDel}/>
      )}

      {/* Modal agregar / editar */}
      {showAdd && (
        <ProductForm
          onClose={() => setShowAdd(false)}
          onSave={() => { setShowAdd(false); onRefresh?.() }}
        />
      )}

      {editTarget && (
        <ProductForm
          initial={editTarget}
          isEdit
          source={editTarget.source}
          onClose={() => setEditTarget(null)}
          onSave={() => { setEditTarget(null); onRefresh?.() }}
        />
      )}

      {/* Confirmar eliminar */}
      {confirmDel && (
        <Modal onClose={() => setConfirmDel(null)} title="¿Eliminar producto?">
          <div style={{ fontSize: 14, color: T.neutral[600], marginBottom: 8 }}>
            <b>{confirmDel.name}</b>
          </div>
          <div style={{ fontSize: 13, color: T.neutral[500], marginBottom: 20, lineHeight: 1.5 }}>
            {confirmDel.source === 'cashier'
              ? 'Este producto fue creado por una cajera. Se eliminará del catálogo. Las ventas que ya lo usaron no se afectan.'
              : 'Esta acción no se puede deshacer.'}
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

        {products.map((p, i) => {
          const setup = needsSetup(p)
          return (
            <div key={p.id} style={{
              display: 'flex', alignItems: 'center',
              padding: '13px 16px',
              borderBottom: i < products.length - 1 ? `0.5px solid ${T.neutral[100]}` : 'none',
              transition: 'background 0.1s',
              cursor: 'pointer',
            }}
              onMouseEnter={e => e.currentTarget.style.background = T.neutral[25]}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              onClick={() => onEdit(p)}
            >
              <div style={{ flex: 2.5, display: 'flex', alignItems: 'center', gap: 10, paddingRight: 8, minWidth: 0 }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 9, flexShrink: 0,
                  background: T.copper[50],
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <ProductIcon color={T.copper[500]}/>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: T.neutral[800] }}>{p.name}</span>
                    {setup && <SetupBadge/>}
                  </div>
                  {p.byPackage && (
                    <div style={{ fontSize: 11, color: T.neutral[400], marginTop: 2 }}>
                      Paquete × {p.unitsPerPackage}u · {fmtCOP(p.packageCost)}
                    </div>
                  )}
                  {p.source === 'cashier' && p.createdByName && (
                    <div style={{ fontSize: 11, color: T.copper[700], fontStyle: 'italic', marginTop: 2 }}>
                      Creado por {p.createdByName}
                    </div>
                  )}
                  {p.notes && (
                    <div style={{ fontSize: 11, color: T.neutral[400], fontStyle: 'italic', marginTop: 2 }}>{p.notes}</div>
                  )}
                </div>
              </div>

              <div style={{ flex: 1.2, textAlign: 'right', paddingRight: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: T.neutral[600], fontVariantNumeric: 'tabular-nums' }}>
                  {p.costPerUnit > 0 ? fmtCOP(p.costPerUnit) : <span style={{ color: T.neutral[300] }}>—</span>}
                </span>
              </div>

              <div style={{ flex: 2.2, textAlign: 'right', paddingRight: 8 }}>
                <PricesByBranchInline product={p}/>
              </div>

              <div style={{ flex: 1.2, textAlign: 'right', paddingRight: 8 }}>
                {p.costPerUnit > 0 && p.avgPrice > 0 ? (
                  <span style={{
                    fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                    color: p.profit >= 0 ? T.ok : T.bad,
                  }}>
                    {p.profit >= 0 ? '+' : ''}{fmtCOP(p.profit)}
                  </span>
                ) : (
                  <span style={{ color: T.neutral[300] }}>—</span>
                )}
              </div>

              <div style={{ flex: 1, textAlign: 'right', paddingRight: 8 }}>
                {p.costPerUnit > 0 && p.avgPrice > 0 ? <MarginBadge margin={p.margin}/> : <span style={{ color: T.neutral[300] }}>—</span>}
              </div>

              <div style={{ flex: 0.7, display: 'flex', justifyContent: 'flex-end' }}>
                <button onClick={(e) => { e.stopPropagation(); onDelete(p) }} style={{
                  width: 30, height: 30, borderRadius: 8, border: 'none',
                  background: '#FAE8E6', color: T.bad,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }} title="Eliminar">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 3 H10 M4.5 3 V1.5 H7.5 V3 M4 5 V9.5 M8 5 V9.5 M2.5 3 L3 10 Q3 11 4 11 H8 Q9 11 9 10 L9.5 3" stroke={T.bad} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                  </svg>
                </button>
              </div>
            </div>
          )
        })}
      </Card>
    </div>
  )
}

// ── Vista tarjetas (móvil) ─────────────────────────────────────
function ProductCards({ products, onEdit, onDelete }) {
  return (
    <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {products.map(p => {
        const setup = needsSetup(p)
        const hasMetrics = p.costPerUnit > 0 && p.avgPrice > 0
        return (
          <Card key={p.id} padding={0}>
            <div
              onClick={() => onEdit(p)}
              style={{ padding: '14px 16px', cursor: 'pointer' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                    background: T.copper[50],
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <ProductIcon color={T.copper[500]}/>
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{
                      fontSize: 15, fontWeight: 700, color: T.neutral[800],
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {p.name}
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 3, alignItems: 'center', flexWrap: 'wrap' }}>
                      {setup && <SetupBadge/>}
                      {p.byPackage && (
                        <span style={{ fontSize: 11, color: T.neutral[400] }}>
                          Paq × {p.unitsPerPackage}u
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {hasMetrics && <MarginBadge margin={p.margin}/>}
              </div>

              {p.source === 'cashier' && p.createdByName && (
                <div style={{ fontSize: 11, color: T.copper[700], fontStyle: 'italic', marginBottom: 8 }}>
                  Creado por {p.createdByName}
                </div>
              )}

              <div style={{
                background: T.neutral[50], borderRadius: 10, padding: '10px 12px',
              }}>
                {hasMetrics && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 6 }}>
                    <MetricCell label="Costo/u" value={fmtCOP(p.costPerUnit)} color={T.neutral[600]}/>
                    <MetricCell
                      label="Ganancia/u"
                      value={(p.profit >= 0 ? '+' : '') + fmtCOP(p.profit)}
                      color={p.profit >= 0 ? T.ok : T.bad}
                    />
                  </div>
                )}
                <div style={{ borderTop: hasMetrics ? `0.5px solid ${T.neutral[200]}` : 'none', paddingTop: hasMetrics ? 8 : 0 }}>
                  <PricesByBranchBlock product={p}/>
                </div>
              </div>

              {p.notes && (
                <div style={{ marginTop: 6, fontSize: 11, color: T.neutral[400], fontStyle: 'italic' }}>
                  {p.notes}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button
                  onClick={(e) => { e.stopPropagation(); onEdit(p) }}
                  style={{
                    flex: 1, padding: '8px', borderRadius: 10, border: 'none',
                    background: T.copper[500], color: '#fff',
                    fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  {setup ? 'Configurar' : 'Editar'}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(p) }}
                  style={{
                    flex: 1, padding: '8px', borderRadius: 10, border: 'none',
                    background: '#FAE8E6', color: T.bad,
                    fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  Eliminar
                </button>
              </div>
            </div>
          </Card>
        )
      })}
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

// ── Formulario agregar / editar / promover ─────────────────────
// Si `source === 'cashier'` y `isEdit`, al guardar PROMUEVE: crea producto admin
// y borra el cashier (deja el catálogo unificado en data.products).
function ProductForm({ initial, isEdit, source, onClose, onSave }) {
  const branches = getData().branches || []
  const isPromoting = isEdit && source === 'cashier'

  const MIN_BASE = 100
  const [name,            setName]            = useState(initial?.name || '')
  const [freeAmount,      setFreeAmount]      = useState(initial?.freeAmount === true)
  const [freeBaseStr,     setFreeBaseStr]      = useState(initial?.freeUnitPrice != null && Number(initial.freeUnitPrice) > 0 ? String(initial.freeUnitPrice) : '')
  const [byPackage,       setByPackage]        = useState(initial?.byPackage ?? false)
  const [packageCost,     setPackageCost]      = useState(initial?.packageCost != null && Number(initial.packageCost) > 0 ? String(initial.packageCost) : '')
  const [unitsPerPackage, setUnitsPerPackage]  = useState(initial?.unitsPerPackage != null && Number(initial.unitsPerPackage) > 0 ? String(initial.unitsPerPackage) : '')
  const [notes,           setNotes]            = useState(initial?.notes || '')
  const [busy,            setBusy]             = useState(false)
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

  const definedPrices = Object.values(priceInputs).map(Number).filter(n => n > 0)
  const avgPrice = definedPrices.length > 0
    ? definedPrices.reduce((s, n) => s + n, 0) / definedPrices.length
    : 0
  const profit = avgPrice - costPerUnit
  const margin = avgPrice > 0 ? (profit / avgPrice) * 100 : 0

  const freeBase = Number(freeBaseStr) || 0
  const canSave = name.trim() && (freeAmount ? freeBase >= MIN_BASE : (pc > 0 && (!byPackage || up > 0)))

  async function handleSave() {
    if (!canSave || busy) return
    setBusy(true)
    try {
      const baseData = freeAmount
        ? {
            name: name.trim(),
            freeAmount: true,
            freeUnitPrice: freeBase,
            pricesByBranch: {},
            packageCost: 0,
            unitsPerPackage: 1,
            byPackage: false,
            notes: notes.trim(),
          }
        : (() => {
            const pricesByBranch = {}
            Object.entries(priceInputs).forEach(([bid, val]) => {
              const num = Number(val)
              if (num > 0) pricesByBranch[bid] = num
            })
            return {
              name: name.trim(),
              freeAmount: false,
              byPackage,
              packageCost: pc,
              unitsPerPackage: byPackage ? up : 1,
              pricesByBranch,
              notes: notes.trim(),
            }
          })()

      if (isPromoting) {
        // Promover: crear como admin y borrar el cashier.
        addProduct(baseData)
        try { await deleteCashierProduct(initial.id) } catch (e) { console.warn('No se pudo borrar el cashier:', e) }
      } else if (isEdit) {
        updateProduct(initial.id, baseData)
      } else {
        addProduct(baseData)
      }
      onSave()
    } catch (err) {
      console.error(err)
      setBusy(false)
    }
  }

  const title = isPromoting
    ? 'Configurar producto'
    : isEdit
      ? 'Editar producto'
      : 'Nuevo producto'

  return (
    <Modal onClose={busy ? undefined : onClose} title={title}>
      {isPromoting && (
        <div style={{
          padding: '10px 12px', borderRadius: 10,
          background: T.copper[50], border: `1px solid ${T.copper[100]}`,
          marginBottom: 14, fontSize: 12.5, color: T.copper[800], lineHeight: 1.4,
        }}>
          Este producto fue creado por <b>{initial?.createdByName || 'una cajera'}</b>. Asígnale costo y precios para configurarlo.
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <div style={labelStyle}>Nombre del producto</div>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Ej: Pan tajado, Croissant..."
          style={inputStyle}
        />
      </div>

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

      {freeAmount ? (
        <div style={{ marginBottom: 14 }}>
          <div style={labelStyle}>Valor base por unidad</div>
          <input
            type="number" min="0" inputMode="numeric"
            value={freeBaseStr}
            onChange={e => setFreeBaseStr(e.target.value.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, ''))}
            placeholder="Ej: 400"
            style={inputStyle}
          />
          <div style={{
            marginTop: 8, padding: '10px 12px', borderRadius: 10,
            background: T.copper[50], border: `1px solid ${T.copper[100]}`,
            fontSize: 12, color: T.copper[700], lineHeight: 1.5,
          }}>
            La cajera vende por monto o por unidades. Ej: con valor base {fmtCOP(freeBase || 400)},
            ${((freeBase || 400) * 5).toLocaleString('es-CO')} = 5 unidades. Si el monto no concuerda,
            el sistema le ofrece las opciones válidas más cercanas.
          </div>
        </div>
      ) : (
      <>
      <div style={{ marginBottom: 14 }}>
        <div style={labelStyle}>¿Cómo lo compras?</div>
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
            }}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {byPackage ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          <div>
            <div style={labelStyle}>Costo del paquete ($)</div>
            <input
              type="number" min="0" value={packageCost}
              onChange={e => setPackageCost(e.target.value)}
              placeholder="Ej: 18000"
              style={inputStyle}
            />
          </div>
          <div>
            <div style={labelStyle}>Unidades por paquete</div>
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
          <div style={labelStyle}>Costo por unidad ($)</div>
          <input
            type="number" min="0" value={packageCost}
            onChange={e => setPackageCost(e.target.value)}
            placeholder="Ej: 1500"
            style={inputStyle}
          />
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <div style={labelStyle}>Precio de venta por panadería ($)</div>
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
        </div>
      )}
      </>
      )}

      <div style={{ marginBottom: 20 }}>
        <div style={labelStyle}>Notas <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(opcional)</span></div>
        <input
          type="text" value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Ej: Proveedor Harinera Central..."
          style={inputStyle}
        />
      </div>

      <PrimaryButton
        label={busy ? 'Guardando...' : (isPromoting ? 'Configurar y guardar' : isEdit ? 'Guardar cambios' : 'Agregar producto')}
        onClick={handleSave}
        disabled={!canSave || busy}
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

const labelStyle = {
  fontSize: 11, fontWeight: 700, color: T.neutral[500],
  textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6,
}

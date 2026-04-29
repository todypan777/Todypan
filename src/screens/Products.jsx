import { useState, useMemo } from 'react'
import { T } from '../tokens'
import { fmtCOP } from '../utils/format'
import { Card, Modal, InputField, PrimaryButton, BackButton } from '../components/Atoms'
import { ScreenHeader } from '../components/Nav'
import { addProduct, updateProduct, deleteProduct, getData } from '../db'
import { useIsDesktop } from '../context/DesktopCtx'

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

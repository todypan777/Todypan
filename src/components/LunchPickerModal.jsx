import { useEffect, useMemo, useState } from 'react'
import { T } from '../tokens'
import { fmtCOP } from '../utils/format'
import {
  CATEGORIES, CATEGORY_BY_ID, CATEGORY_IDS,
  watchMenuItems, watchDailyMenu, resolveDailyMenu,
} from '../menu'
import { getBogotaDateStr } from '../db'

// ──────────────────────────────────────────────────────────────────
// Modal de selección de almuerzo. Se abre cuando la cajera escoge un
// producto con isLunch=true.
//
// Props:
//   product    → producto-almuerzo del catálogo (con priceMesa/priceLlevar)
//   onCancel   → cerrar sin agregar
//   onAddOne(payload, addAnotherSignal)
//                → agrega un almuerzo a la comanda en construcción.
//                  payload incluye: kind, productId, productName, destination,
//                                   selections, price.
//                  addAnotherSignal: si true → seguir agregando otro;
//                                    si false → cerrar y enviar.
//   commandaInitial → datos previos (cuando la cajera ya tiene la mesa abierta
//                     y los almuerzos van a la misma mesa).
// ──────────────────────────────────────────────────────────────────
export default function LunchPickerModal({ product, onCancel, onAdd, currentCount = 0 }) {
  const today = getBogotaDateStr()
  const [allItems, setAllItems] = useState([])
  const [dailyMenu, setDailyMenu] = useState(null)
  const [destination, setDestination] = useState('mesa') // 'mesa' | 'llevar'
  const [selections, setSelections] = useState({})       // { soup: {id,name}, ... }

  useEffect(() => watchMenuItems(setAllItems), [])
  useEffect(() => watchDailyMenu(today, setDailyMenu), [today])

  const menu = useMemo(() => resolveDailyMenu(dailyMenu, allItems), [dailyMenu, allItems])

  // Pre-seleccionar las categorías "fijas" (principio/side/salad) cuando el menú
  // del día las tenga (una sola opción cada una).
  useEffect(() => {
    setSelections(prev => {
      const next = { ...prev }
      for (const cat of CATEGORIES) {
        if (cat.multi) continue
        // Si esa categoría tiene UNA opción en el menú de hoy y la cajera no
        // ha tocado nada (no hay entrada previa), la pre-seleccionamos.
        const opts = menu[cat.id] || []
        if (opts.length === 1 && next[cat.id] === undefined) {
          next[cat.id] = { id: opts[0].id, name: opts[0].name }
        }
      }
      return next
    })
  }, [menu.principio, menu.side, menu.salad]) // eslint-disable-line

  function selectMulti(catId, item) {
    setSelections(prev => ({
      ...prev,
      [catId]: prev[catId]?.id === item.id ? null : { id: item.id, name: item.name },
    }))
  }
  function toggleFixed(catId, item) {
    setSelections(prev => ({
      ...prev,
      // Si ya estaba seleccionado → "quitar" (null = SIN ese item, alerta a cocina).
      [catId]: prev[catId]?.id === item.id ? null : { id: item.id, name: item.name },
    }))
  }

  const isLlevar = destination === 'llevar'
  const price = isLlevar
    ? Number(product.priceLlevar || product.priceMesa || 0)
    : Number(product.priceMesa || 0)

  // Validación blanda: las categorías "multi y required" (sopa/proteína/jugo)
  // necesitan al menos una. Las fijas pueden quedar en null.
  const missingRequired = CATEGORIES
    .filter(c => c.multi && c.required)
    .filter(c => !selections[c.id])
    .map(c => c.label)
  const canSubmit = missingRequired.length === 0

  function buildPayload() {
    const sel = {}
    for (const cat of CATEGORIES) {
      sel[cat.id] = selections[cat.id] || null
    }
    return {
      kind: 'menu',
      productId: product.id,
      productName: product.name,
      destination,
      selections: sel,
      price,
    }
  }

  function handleAddAnother() {
    if (!canSubmit) return
    onAdd(buildPayload(), { another: true })
    // Reset para próximo almuerzo (mantiene destino)
    setSelections({})
  }
  function handleSendCommand() {
    if (!canSubmit) return
    onAdd(buildPayload(), { another: false })
  }

  return (
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, zIndex: 95,
      background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 540, height: '94vh',
        background: T.neutral[50], borderRadius: '20px 20px 0 0',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 -8px 32px rgba(0,0,0,0.25)',
        animation: 'lunchSlideUp 0.28s cubic-bezier(0.2,0.9,0.3,1.05)',
      }}>
        {/* Header sticky */}
        <div style={{
          padding: '16px 20px',
          background: '#fff', borderBottom: `1px solid ${T.neutral[100]}`,
          display: 'flex', alignItems: 'center', gap: 12,
          flexShrink: 0,
        }}>
          <button onClick={onCancel} style={{
            width: 36, height: 36, borderRadius: 999,
            background: T.neutral[100], border: 'none',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 3 L11 11 M11 3 L3 11" stroke={T.neutral[700]} strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3 }}>
              {product.name}
              {currentCount > 0 && (
                <span style={{
                  marginLeft: 8, fontSize: 11, fontWeight: 700, color: T.copper[700],
                  background: T.copper[50], padding: '2px 8px', borderRadius: 999,
                  verticalAlign: 'middle',
                }}>
                  {currentCount} en comanda
                </span>
              )}
            </div>
            <div style={{ fontSize: 12.5, color: T.neutral[500] }}>
              {fmtCOP(price)} · {isLlevar ? '📦 Para llevar' : '🍽️ Para mesa'}
            </div>
          </div>
        </div>

        {/* Switch destino */}
        <div style={{ padding: '12px 20px 0' }}>
          <div style={{
            display: 'flex', gap: 4, padding: 4, borderRadius: 14,
            background: T.neutral[100],
          }}>
            <DestPill active={destination === 'mesa'} onClick={() => setDestination('mesa')} icon="🍽️" label="Para mesa" />
            <DestPill active={destination === 'llevar'} onClick={() => setDestination('llevar')} icon="📦" label="Para llevar" />
          </div>
        </div>

        {/* Categorías */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px 14px' }}>
          {CATEGORIES.map(cat => (
            <CategoryBlock
              key={cat.id}
              category={cat}
              options={menu[cat.id] || []}
              selected={selections[cat.id]}
              onSelect={(item) => cat.multi ? selectMulti(cat.id, item) : toggleFixed(cat.id, item)}
            />
          ))}

          {missingRequired.length > 0 && (
            <div style={{
              marginTop: 6, padding: '12px 14px', borderRadius: 12,
              background: '#FFF7E6', border: `1px solid #F4E0BC`,
              color: '#7A5C00', fontSize: 12.5, lineHeight: 1.5,
            }}>
              ⚠ Faltan elegir: <b>{missingRequired.join(', ')}</b>
            </div>
          )}
        </div>

        {/* Footer sticky con botones */}
        <div style={{
          padding: '14px 20px',
          background: '#fff', borderTop: `1px solid ${T.neutral[100]}`,
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 14px)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 10 }}>
            <button
              onClick={handleAddAnother}
              disabled={!canSubmit}
              style={{
                padding: '14px', borderRadius: 14,
                background: canSubmit ? '#fff' : T.neutral[100],
                color: canSubmit ? T.copper[700] : T.neutral[400],
                border: `1.5px solid ${canSubmit ? T.copper[400] : T.neutral[200]}`,
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit', fontSize: 13.5, fontWeight: 800,
              }}
            >
              + Otro almuerzo
            </button>
            <button
              onClick={handleSendCommand}
              disabled={!canSubmit}
              style={{
                padding: '14px', borderRadius: 14,
                background: canSubmit ? T.copper[500] : T.neutral[200],
                color: canSubmit ? '#fff' : T.neutral[500],
                border: 'none',
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit', fontSize: 14.5, fontWeight: 800,
                letterSpacing: 0.3,
                boxShadow: canSubmit ? '0 4px 14px rgba(184,122,86,0.3)' : 'none',
              }}
            >
              {currentCount > 0 ? 'Agregar y enviar' : 'Enviar comanda'}
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes lunchSlideUp {
          from { transform: translateY(8%); opacity: 0; }
          to   { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

function DestPill({ active, onClick, icon, label }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, padding: '10px', borderRadius: 11,
        background: active ? '#fff' : 'transparent',
        color: active ? T.neutral[900] : T.neutral[500],
        border: 'none', cursor: 'pointer', fontFamily: 'inherit',
        fontSize: 13.5, fontWeight: 700,
        boxShadow: active ? '0 1px 4px rgba(0,0,0,0.06)' : 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        transition: 'background 0.15s, color 0.15s',
      }}
    >
      <span style={{ fontSize: 16 }}>{icon}</span>
      {label}
    </button>
  )
}

function CategoryBlock({ category, options, selected, onSelect }) {
  if (options.length === 0) {
    return (
      <div style={{ marginBottom: 16 }}>
        <CategoryHeader category={category} status="empty" />
        <div style={{
          padding: '10px 14px', borderRadius: 10,
          background: T.neutral[50], border: `1px dashed ${T.neutral[200]}`,
          color: T.neutral[500], fontSize: 12, textAlign: 'center',
        }}>
          La cocinera no ha definido opciones de hoy
        </div>
      </div>
    )
  }

  // Categorías fijas (1 opción): mostrar como toggle ON/OFF
  if (!category.multi && options.length === 1) {
    const opt = options[0]
    const active = selected?.id === opt.id
    return (
      <div style={{ marginBottom: 16 }}>
        <CategoryHeader category={category} status={active ? 'on' : 'off'} />
        <button
          onClick={() => onSelect(opt)}
          style={{
            width: '100%', padding: '14px 16px', borderRadius: 14,
            background: active ? '#fff' : '#FBE9E5',
            color: active ? T.neutral[900] : T.bad,
            border: `1.5px solid ${active ? T.copper[400] : '#F0C8BE'}`,
            cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
            display: 'flex', alignItems: 'center', gap: 12,
          }}
        >
          <div style={{
            width: 24, height: 24, borderRadius: 7, flexShrink: 0,
            background: active ? T.copper[500] : '#fff',
            border: `2px solid ${active ? T.copper[500] : T.bad}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {active && (
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M2 7 L5 10 L11 3" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700 }}>
              {active ? opt.name : `SIN ${category.label.toUpperCase()}`}
            </div>
            <div style={{
              fontSize: 11.5, fontWeight: 600,
              color: active ? T.neutral[500] : T.bad,
              marginTop: 2, letterSpacing: 0.2,
            }}>
              {active ? 'Toca para quitarlo' : 'A cocina le llegará marcado'}
            </div>
          </div>
        </button>
      </div>
    )
  }

  // Multi (sopa/proteína/jugo): chips horizontales
  return (
    <div style={{ marginBottom: 16 }}>
      <CategoryHeader category={category} status={selected ? 'on' : (category.required ? 'required' : 'off')} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {options.map(opt => {
          const active = selected?.id === opt.id
          return (
            <button
              key={opt.id}
              onClick={() => onSelect(opt)}
              style={{
                padding: '11px 16px', borderRadius: 14,
                background: active ? T.copper[500] : '#fff',
                color: active ? '#fff' : T.neutral[800],
                border: `1.5px solid ${active ? T.copper[500] : T.neutral[200]}`,
                cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 14, fontWeight: active ? 800 : 600,
                letterSpacing: -0.1,
                transition: 'background 0.15s, border-color 0.15s',
                boxShadow: active ? '0 3px 10px rgba(184,122,86,0.3)' : 'none',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              {active && (
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                  <path d="M2 7 L5 10 L11 3" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
              {opt.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function CategoryHeader({ category, status }) {
  // status: 'on' | 'off' | 'required' | 'empty'
  const cfg = {
    on:        { bg: T.ok + '15', color: T.ok, label: '✓' },
    off:       { bg: T.neutral[100], color: T.neutral[500], label: 'Sin' },
    required:  { bg: '#FBE9E5', color: T.bad, label: 'Falta' },
    empty:     { bg: T.neutral[100], color: T.neutral[400], label: '—' },
  }[status]

  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      margin: '0 4px 8px',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 16 }}>{category.emoji}</span>
        <div style={{
          fontSize: 13, fontWeight: 800, color: T.neutral[900],
          letterSpacing: -0.2,
        }}>
          {category.label}
        </div>
      </div>
      <span style={{
        fontSize: 10, fontWeight: 700, color: cfg.color,
        background: cfg.bg, padding: '2px 8px', borderRadius: 999,
        letterSpacing: 0.4, textTransform: 'uppercase',
      }}>
        {cfg.label}
      </span>
    </div>
  )
}

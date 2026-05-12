import { useEffect, useState } from 'react'
import { T } from '../tokens'
import { fmtCOP } from '../utils/format'
import { CATEGORIES } from '../menu'

// Modal de selección de almuerzo para CLIENTES (página pública /menu).
// Derivado del LunchPickerModal de la cajera pero simplificado:
//   - Sin paso de mesa/llevar (siempre llevar).
//   - Sin badges de admin/cajera.
//   - Más aire, animaciones suaves, copy amable.
//
// Props:
//   resolvedMenu   → { soup: [{id,name}], principio: [...], ... }
//   price          → precio del corriente (siempre priceLlevar).
//   onCancel
//   onAdd(payload) → payload: { selections, note, price }
export default function PublicLunchPickerModal({ resolvedMenu, price, onCancel, onAdd }) {
  const [selections, setSelections] = useState({})
  const [note, setNote] = useState('')

  // Pre-seleccionar acompañantes habituales (igual que la cajera): el cliente
  // ahorra clicks. Si quiere cambiar, lo hace explícitamente.
  useEffect(() => {
    const PRE = ['side', 'salad', 'juice']
    setSelections(prev => {
      const next = { ...prev }
      for (const catId of PRE) {
        if (next[catId] !== undefined) continue
        const opts = resolvedMenu[catId] || []
        if (opts.length > 0) {
          next[catId] = { id: opts[0].id, name: opts[0].name }
        }
      }
      return next
    })
  }, [resolvedMenu.side, resolvedMenu.salad, resolvedMenu.juice]) // eslint-disable-line

  function selectMulti(catId, item) {
    const cat = CATEGORIES.find(c => c.id === catId)
    const maxSel = cat?.maxSelections || 1
    setSelections(prev => {
      const current = prev[catId]
      if (maxSel <= 1) {
        return {
          ...prev,
          [catId]: current?.id === item.id ? null : { id: item.id, name: item.name },
        }
      }
      const arr = Array.isArray(current) ? current : (current ? [current] : [])
      const idx = arr.findIndex(x => x?.id === item.id)
      let next
      if (idx >= 0) {
        next = arr.filter((_, i) => i !== idx)
      } else if (arr.length < maxSel) {
        next = [...arr, { id: item.id, name: item.name }]
      } else {
        next = [...arr.slice(1), { id: item.id, name: item.name }]
      }
      return { ...prev, [catId]: next.length === 0 ? null : next }
    })
  }
  function toggleFixed(catId, item) {
    setSelections(prev => ({
      ...prev,
      [catId]: prev[catId]?.id === item.id ? null : { id: item.id, name: item.name },
    }))
  }

  const missingRequired = CATEGORIES
    .filter(c => c.multi && c.required)
    .filter(c => !selections[c.id])
    .map(c => c.label)
  const canSubmit = missingRequired.length === 0

  function handleAdd() {
    if (!canSubmit) return
    const sel = {}
    for (const cat of CATEGORIES) {
      sel[cat.id] = selections[cat.id] || null
    }
    onAdd({ selections: sel, note: note.trim(), price })
  }

  return (
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, zIndex: 95,
      background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      animation: 'pmFadeBg 0.2s ease',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 540, height: '94vh',
        background: T.neutral[50], borderRadius: '24px 24px 0 0',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 -8px 32px rgba(0,0,0,0.25)',
        animation: 'pmSlideUp 0.32s cubic-bezier(0.2,0.9,0.3,1.05)',
      }}>
        {/* Header */}
        <div style={{
          padding: '18px 22px',
          background: '#fff', borderBottom: `1px solid ${T.neutral[100]}`,
          display: 'flex', alignItems: 'center', gap: 12,
          flexShrink: 0,
          borderRadius: '24px 24px 0 0',
        }}>
          <button
            onClick={onCancel}
            aria-label="Cerrar"
            style={{
              width: 38, height: 38, borderRadius: 999,
              background: T.neutral[100], border: 'none',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 3 L11 11 M11 3 L3 11" stroke={T.neutral[700]} strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3 }}>
              Personaliza tu almuerzo
            </div>
            <div style={{ fontSize: 13, color: T.copper[700], fontWeight: 700, marginTop: 2 }}>
              {fmtCOP(price)} · para llevar
            </div>
          </div>
        </div>

        {/* Cuerpo */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px 18px' }}>
          {CATEGORIES.map((cat, idx) => (
            <CategoryBlock
              key={cat.id}
              category={cat}
              options={resolvedMenu[cat.id] || []}
              selected={selections[cat.id]}
              onSelect={(item) => cat.multi ? selectMulti(cat.id, item) : toggleFixed(cat.id, item)}
              animDelay={idx * 30}
            />
          ))}

          {missingRequired.length > 0 && (
            <div style={{
              marginTop: 4, padding: '12px 14px', borderRadius: 12,
              background: '#FFF7E6', border: `1px solid #F4E0BC`,
              color: '#7A5C00', fontSize: 13, lineHeight: 1.5,
            }}>
              Aún te falta elegir: <b>{missingRequired.join(', ')}</b>
            </div>
          )}

          {/* Nota */}
          <div style={{
            marginTop: 18,
            padding: '14px 14px 12px',
            borderRadius: 14,
            background: '#FFF7E6',
            border: `1.5px solid #F4E0BC`,
          }}>
            <div style={{
              fontSize: 13, fontWeight: 800, color: '#7A5C00',
              letterSpacing: -0.2, marginBottom: 8,
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span>Algún comentario para cocina</span>
              <span style={{
                fontSize: 10, fontWeight: 700, color: '#9A7200',
                background: '#FFE9C2', padding: '2px 7px', borderRadius: 999,
                letterSpacing: 0.3, textTransform: 'uppercase', marginLeft: 'auto',
              }}>
                Opcional
              </span>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {[
                'Sin sal', 'Sin cebolla', 'Sin tomate',
                'Huevo bien cocido', 'Huevo blando',
                'Aparte', 'Bien caliente',
              ].map(chip => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => {
                    setNote(prev => {
                      const t = (prev || '').trim()
                      if (!t) return chip
                      if (t.toLowerCase().includes(chip.toLowerCase())) return prev
                      return `${t} · ${chip}`
                    })
                  }}
                  style={{
                    padding: '6px 11px', borderRadius: 999,
                    background: '#fff', color: '#7A5C00',
                    border: `1px solid #F4E0BC`,
                    cursor: 'pointer', fontFamily: 'inherit',
                    fontSize: 12, fontWeight: 700,
                  }}
                >
                  + {chip}
                </button>
              ))}
            </div>

            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder='Escribe libremente si quieres'
              rows={2}
              maxLength={200}
              style={{
                width: '100%', padding: '11px 12px', borderRadius: 12,
                border: `1.5px solid #F4E0BC`,
                fontSize: 14, fontFamily: 'inherit',
                background: '#fff', color: T.neutral[900],
                outline: 'none', resize: 'vertical', minHeight: 56,
                boxSizing: 'border-box',
              }}
            />
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 22px',
          background: '#fff', borderTop: `1px solid ${T.neutral[100]}`,
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 14px)',
          flexShrink: 0,
        }}>
          <button
            onClick={handleAdd}
            disabled={!canSubmit}
            style={{
              width: '100%', padding: '16px', borderRadius: 16,
              background: canSubmit ? T.copper[500] : T.neutral[200],
              color: canSubmit ? '#fff' : T.neutral[500],
              border: 'none',
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit', fontSize: 15.5, fontWeight: 800,
              letterSpacing: 0.3,
              boxShadow: canSubmit ? '0 4px 16px rgba(184,122,86,0.35)' : 'none',
              transition: 'transform 0.12s ease, box-shadow 0.2s ease',
            }}
            onMouseDown={e => canSubmit && (e.currentTarget.style.transform = 'scale(0.98)')}
            onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
            onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
          >
            Agregar al pedido · {fmtCOP(price)}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes pmFadeBg {
          from { background: rgba(0,0,0,0); }
          to   { background: rgba(0,0,0,0.55); }
        }
        @keyframes pmSlideUp {
          from { transform: translateY(12%); opacity: 0; }
          to   { transform: translateY(0); opacity: 1; }
        }
        @keyframes pmRowIn {
          from { transform: translateY(6px); opacity: 0; }
          to   { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

function CategoryBlock({ category, options, selected, onSelect, animDelay = 0 }) {
  if (options.length === 0) {
    return (
      <div style={{
        marginBottom: 18,
        animation: `pmRowIn 0.3s ease ${animDelay}ms backwards`,
      }}>
        <CategoryHeader category={category} status="empty" />
        <div style={{
          padding: '12px 14px', borderRadius: 12,
          background: T.neutral[50], border: `1px dashed ${T.neutral[200]}`,
          color: T.neutral[500], fontSize: 12.5, textAlign: 'center',
        }}>
          No hay opciones de hoy
        </div>
      </div>
    )
  }

  // Categoría fija (acompañante: arroz) → toggle visual
  if (!category.multi && options.length === 1) {
    const opt = options[0]
    const active = selected?.id === opt.id
    return (
      <div style={{
        marginBottom: 18,
        animation: `pmRowIn 0.3s ease ${animDelay}ms backwards`,
      }}>
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
            transition: 'background 0.18s, border-color 0.18s',
          }}
        >
          <div style={{
            width: 24, height: 24, borderRadius: 7, flexShrink: 0,
            background: active ? T.copper[500] : '#fff',
            border: `2px solid ${active ? T.copper[500] : T.bad}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 0.18s',
          }}>
            {active && (
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M2 7 L5 10 L11 3" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700 }}>
              {active ? opt.name : `Sin ${category.label.toLowerCase()}`}
            </div>
            <div style={{
              fontSize: 11.5, fontWeight: 600,
              color: active ? T.neutral[500] : T.bad,
              marginTop: 2,
            }}>
              {active ? 'Toca para quitarlo' : 'Lo pediste sin esto'}
            </div>
          </div>
        </button>
      </div>
    )
  }

  // Multi: chips
  const selectedArr = Array.isArray(selected) ? selected : (selected ? [selected] : [])
  const isMultiSelect = (category.maxSelections || 1) > 1
  const isMixto = isMultiSelect && selectedArr.length === 2

  return (
    <div style={{
      marginBottom: 18,
      animation: `pmRowIn 0.3s ease ${animDelay}ms backwards`,
    }}>
      <CategoryHeader
        category={category}
        status={selectedArr.length > 0 ? 'on' : (category.required ? 'required' : 'off')}
        extraLabel={isMixto ? 'MIXTO' : null}
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {options.map(opt => {
          const active = selectedArr.some(s => s?.id === opt.id)
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
                transition: 'background 0.18s, border-color 0.18s, transform 0.1s ease',
                boxShadow: active ? '0 3px 10px rgba(184,122,86,0.3)' : 'none',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
              onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.96)')}
              onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
              onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
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

function CategoryHeader({ category, status, extraLabel }) {
  const cfg = {
    on:       { bg: T.ok + '15', color: T.ok, label: 'Listo' },
    off:      { bg: T.neutral[100], color: T.neutral[500], label: 'Sin' },
    required: { bg: '#FBE9E5', color: T.bad, label: 'Falta' },
    empty:    { bg: T.neutral[100], color: T.neutral[400], label: '—' },
  }[status]

  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      margin: '0 4px 10px', gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 16 }}>{category.emoji}</span>
        <div style={{
          fontSize: 14, fontWeight: 800, color: T.neutral[900],
          letterSpacing: -0.2,
        }}>
          {category.label}
        </div>
        {extraLabel && (
          <span style={{
            fontSize: 10, fontWeight: 800, color: T.copper[700],
            background: T.copper[100], padding: '2px 7px', borderRadius: 999,
            letterSpacing: 0.4,
          }}>
            {extraLabel}
          </span>
        )}
        {(category.maxSelections || 1) > 1 && (
          <span style={{
            fontSize: 10, fontWeight: 600, color: T.neutral[500],
            letterSpacing: 0.2,
          }}>
            (hasta {category.maxSelections})
          </span>
        )}
      </div>
      <span style={{
        fontSize: 10, fontWeight: 700, color: cfg.color,
        background: cfg.bg, padding: '3px 9px', borderRadius: 999,
        letterSpacing: 0.4, textTransform: 'uppercase',
        flexShrink: 0,
      }}>
        {cfg.label}
      </span>
    </div>
  )
}

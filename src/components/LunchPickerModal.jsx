import { useEffect, useMemo, useState } from 'react'
import { T } from '../tokens'
import { fmtCOP } from '../utils/format'
import {
  CATEGORIES,
  watchMenuItems, watchDailyMenu, resolveDailyMenu,
} from '../menu'
import { useBogotaDate } from '../utils/useBogotaDate'

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
export default function LunchPickerModal({
  product, onCancel, onAdd, currentCount = 0,
}) {
  const today = useBogotaDate()
  const [allItems, setAllItems] = useState([])
  const [dailyMenu, setDailyMenu] = useState(null)
  const [selections, setSelections] = useState({})       // { soup: {id,name}, ... }
  // Nota PER-ALMUERZO. Antes era state compartido del padre (una sola nota
  // para toda la comanda) y se copiaba idéntica a cada kitchenOrder. Ahora
  // vive aquí, se incluye en el payload del almuerzo, y se resetea cuando
  // la cajera tap "+ Otro almuerzo".
  const [note, setNote] = useState('')
  // Step:
  //   'compose'     → escoger sopa/proteína/jugo, escribir comentario.
  //   'destination' → elegir mesa/llevar (paso explícito para no olvidar).
  // Avanza con "Continuar"; al destino se llama onAdd con el payload final.
  const [step, setStep] = useState('compose')
  // Recordamos si el usuario quiere "+ Otro almuerzo" o "Enviar" tras escoger
  // destino — la diferencia importa para el handler en el padre.
  const [pendingAnother, setPendingAnother] = useState(false)

  useEffect(() => watchMenuItems(setAllItems), [])
  useEffect(() => watchDailyMenu(today, setDailyMenu), [today])

  const menu = useMemo(() => resolveDailyMenu(dailyMenu, allItems), [dailyMenu, allItems])

  // Pre-seleccionar acompañantes "habituales" — la cajera ahorra clicks en
  // los almuerzos típicos y solo cambia lo que el cliente pida distinto:
  //  - Acompañante (arroz, no-multi): pre-seleccionado siempre
  //  - Ensalada y Jugo (multi): primera opción del día por defecto
  //  - Sopa, Principio, Proteína: la cajera escoge explícitamente
  const PRE_SELECT_DEFAULTS = ['side', 'salad', 'juice']
  useEffect(() => {
    setSelections(prev => {
      const next = { ...prev }
      for (const catId of PRE_SELECT_DEFAULTS) {
        if (next[catId] !== undefined) continue // respetar elección previa
        const opts = menu[catId] || []
        if (opts.length > 0) {
          next[catId] = { id: opts[0].id, name: opts[0].name }
        }
      }
      return next
    })
  }, [menu.side, menu.salad, menu.juice]) // eslint-disable-line

  function selectMulti(catId, item) {
    const cat = CATEGORIES.find(c => c.id === catId)
    const maxSel = cat?.maxSelections || 1
    setSelections(prev => {
      const current = prev[catId]
      if (maxSel <= 1) {
        // Lógica clásica: tap mismo = deseleccionar. Tap distinto = reemplazar.
        return {
          ...prev,
          [catId]: current?.id === item.id ? null : { id: item.id, name: item.name },
        }
      }
      // Multi-select (principio: hasta 2 para "mixto").
      // Normalizamos current a array. Compatible con datos viejos donde podía
      // ser objeto único.
      const arr = Array.isArray(current) ? current : (current ? [current] : [])
      const idx = arr.findIndex(x => x?.id === item.id)
      let next
      if (idx >= 0) {
        // Ya estaba → quitarlo
        next = arr.filter((_, i) => i !== idx)
      } else if (arr.length < maxSel) {
        // Cabe → agregarlo
        next = [...arr, { id: item.id, name: item.name }]
      } else {
        // Lleno → reemplazar el más viejo (FIFO)
        next = [...arr.slice(1), { id: item.id, name: item.name }]
      }
      return { ...prev, [catId]: next.length === 0 ? null : next }
    })
  }
  function toggleFixed(catId, item) {
    setSelections(prev => ({
      ...prev,
      // Si ya estaba seleccionado → "quitar" (null = SIN ese item, alerta a cocina).
      [catId]: prev[catId]?.id === item.id ? null : { id: item.id, name: item.name },
    }))
  }

  // Precios visibles como info; el real se decide al elegir destino.
  const priceMesa = Number(product.priceMesa || 0)
  const priceLlevar = Number(product.priceLlevar || product.priceMesa || 0)

  // Validación blanda: las categorías "multi y required" (sopa/proteína/jugo)
  // necesitan al menos una. Las fijas pueden quedar en null.
  const missingRequired = CATEGORIES
    .filter(c => c.multi && c.required)
    .filter(c => !selections[c.id])
    .map(c => c.label)
  const canSubmit = missingRequired.length === 0

  function buildPayload(destination) {
    const sel = {}
    for (const cat of CATEGORIES) {
      sel[cat.id] = selections[cat.id] || null
    }
    const isLlevar = destination === 'llevar'
    const price = isLlevar ? priceLlevar : priceMesa
    return {
      kind: 'menu',
      productId: product.id,
      productName: product.name,
      destination,
      selections: sel,
      price,
      note: note.trim() || null,
    }
  }

  // Click en "+ Otro" o "Enviar" desde el paso de compose: NO envía aún —
  // pasa al paso de destino para forzar la decisión.
  function proceedToDestination(another) {
    if (!canSubmit) return
    setPendingAnother(another)
    setStep('destination')
  }

  // Click en "🍽️ Para mesa" o "📦 Para llevar" desde el paso de destino.
  function pickDestination(destination) {
    onAdd(buildPayload(destination), { another: pendingAnother })
    if (pendingAnother) {
      // Reset para el siguiente almuerzo y volver al compose.
      // Incluye la nota — cada almuerzo arranca limpio.
      setSelections({})
      setNote('')
      setStep('compose')
    }
    setPendingAnother(false)
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
        {/* Header sticky.
            En 'compose': X cierra el modal (con confirm si hay almuerzos).
            En 'destination': la flecha vuelve al compose. */}
        <div style={{
          padding: '16px 20px',
          background: '#fff', borderBottom: `1px solid ${T.neutral[100]}`,
          display: 'flex', alignItems: 'center', gap: 12,
          flexShrink: 0,
        }}>
          <button
            onClick={() => step === 'destination' ? setStep('compose') : onCancel()}
            style={{
              width: 36, height: 36, borderRadius: 999,
              background: T.neutral[100], border: 'none',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {step === 'destination' ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M10 3 L4 8 L10 13" stroke={T.neutral[700]} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3 3 L11 11 M11 3 L3 11" stroke={T.neutral[700]} strokeWidth="2" strokeLinecap="round"/>
              </svg>
            )}
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3 }}>
              {step === 'destination' ? '¿Para mesa o para llevar?' : product.name}
              {step === 'compose' && currentCount > 0 && (
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
              {step === 'destination'
                ? `${product.name} · selecciona dónde se sirve`
                : `Mesa ${fmtCOP(priceMesa)} · Llevar ${fmtCOP(priceLlevar)}`}
            </div>
          </div>
        </div>

        {/* Paso 2: destino — DOS BOTONES GRANDES con precio claro.
            Se renderiza en lugar del cuerpo + footer normales para que la
            cajera no se distraiga. */}
        {step === 'destination' && (
          <div style={{
            flex: 1, overflowY: 'auto', padding: '24px 20px',
            display: 'flex', flexDirection: 'column', gap: 14,
          }}>
            <DestinationBigButton
              icon="🍽️"
              title="Para mesa"
              subtitle="Cliente come en el local"
              price={priceMesa}
              accentBg={T.copper[50]}
              accentBorder={T.copper[400]}
              accentColor={T.copper[700]}
              onClick={() => pickDestination('mesa')}
            />
            <DestinationBigButton
              icon="📦"
              title="Para llevar"
              subtitle="Cliente se lo lleva empacado"
              price={priceLlevar}
              accentBg="#FFF7E6"
              accentBorder="#F0D699"
              accentColor="#7A5C00"
              onClick={() => pickDestination('llevar')}
            />
            <div style={{
              marginTop: 8, padding: '10px 12px', borderRadius: 10,
              background: T.neutral[100], color: T.neutral[600],
              fontSize: 12, lineHeight: 1.5, textAlign: 'center',
            }}>
              Toca una opción para enviar este almuerzo. Puedes volver con la flecha si te equivocaste.
            </div>
          </div>
        )}

        {/* Paso 1: categorías + comentario. Solo se renderiza en 'compose'. */}
        {step === 'compose' && (
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

          {/* Comentario PARA ESTE ALMUERZO específico. Si la cajera agrega
              otro almuerzo a la misma comanda, la nota se reinicia — cada
              uno tiene su contexto propio que llega aislado a la cocinera. */}
          <div style={{
            marginTop: 18,
            padding: '14px 14px 12px',
            borderRadius: 14,
            background: '#FFF7E6',
            border: `1.5px solid #F4E0BC`,
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8,
            }}>
              <span style={{ fontSize: 16 }}>📝</span>
              <div style={{
                fontSize: 13, fontWeight: 800, color: '#7A5C00',
                letterSpacing: -0.2,
              }}>
                Comentario para este almuerzo
              </div>
              <span style={{
                fontSize: 10, fontWeight: 700, color: '#9A7200',
                background: '#FFE9C2', padding: '2px 7px', borderRadius: 999,
                letterSpacing: 0.3, textTransform: 'uppercase', marginLeft: 'auto',
              }}>
                Opcional
              </span>
            </div>

            {/* Chips rápidos — la cajera tap y se inserta al texto. Los
                ejemplos cubren los casos típicos del corriente. */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {[
                'Sin sal', 'Sin cebolla', 'Sin tomate',
                'Huevo bien cocido', 'Huevo blando', 'Huevo frito',
                'Aparte', 'Bien caliente',
              ].map(chip => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => {
                    setNote(prev => {
                      const t = (prev || '').trim()
                      if (!t) return chip
                      // Evitar duplicados exactos
                      if (t.toLowerCase().includes(chip.toLowerCase())) return prev
                      return `${t} · ${chip}`
                    })
                  }}
                  style={{
                    padding: '6px 10px', borderRadius: 999,
                    background: '#fff', color: '#7A5C00',
                    border: `1px solid #F4E0BC`,
                    cursor: 'pointer', fontFamily: 'inherit',
                    fontSize: 11.5, fontWeight: 700,
                  }}
                >
                  + {chip}
                </button>
              ))}
            </div>

            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder='O escribe libremente: "Sin cilantro"'
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
            {note && (
              <button
                type="button"
                onClick={() => setNote('')}
                style={{
                  marginTop: 8, padding: '4px 10px', borderRadius: 8,
                  background: 'transparent', color: T.bad,
                  border: `1px solid ${T.bad}55`,
                  cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 11, fontWeight: 700,
                }}
              >
                Borrar comentario
              </button>
            )}
          </div>
        </div>
        )}

        {/* Footer sticky con botones — solo en compose. En destination los
            CTA son los dos botones grandes del cuerpo. */}
        {step === 'compose' && (
        <div style={{
          padding: '14px 20px',
          background: '#fff', borderTop: `1px solid ${T.neutral[100]}`,
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 14px)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 10 }}>
            <button
              onClick={() => proceedToDestination(true)}
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
              onClick={() => proceedToDestination(false)}
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
              Continuar →
            </button>
          </div>
        </div>
        )}
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

// Botón grande del paso de destino — separado y obvio para que la cajera
// no pueda equivocarse "por click rápido". Cada uno muestra su precio.
function DestinationBigButton({ icon, title, subtitle, price, accentBg, accentBorder, accentColor, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', padding: '20px 22px', borderRadius: 18,
        background: accentBg,
        border: `2px solid ${accentBorder}`,
        cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
        display: 'flex', alignItems: 'center', gap: 16,
        transition: 'transform 0.1s ease',
      }}
      onMouseDown={e => e.currentTarget.style.transform = 'scale(0.985)'}
      onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
      onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
    >
      <div style={{
        width: 56, height: 56, borderRadius: 16, flexShrink: 0,
        background: '#fff', border: `1.5px solid ${accentBorder}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 30,
      }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 19, fontWeight: 900, color: accentColor,
          letterSpacing: -0.3, marginBottom: 2,
        }}>
          {title}
        </div>
        <div style={{ fontSize: 12.5, color: accentColor, opacity: 0.75, lineHeight: 1.4 }}>
          {subtitle}
        </div>
      </div>
      <div style={{
        fontSize: 18, fontWeight: 900, color: accentColor,
        fontVariantNumeric: 'tabular-nums', flexShrink: 0,
      }}>
        ${(price || 0).toLocaleString('es-CO')}
      </div>
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

  // Multi (sopa/proteína/jugo/principio): chips horizontales.
  // selected puede ser objeto único, null, o array (principio multi-select).
  const selectedArr = Array.isArray(selected) ? selected : (selected ? [selected] : [])
  const isMultiSelect = (category.maxSelections || 1) > 1
  const isMixto = isMultiSelect && selectedArr.length === 2
  return (
    <div style={{ marginBottom: 16 }}>
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

function CategoryHeader({ category, status, extraLabel }) {
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
      margin: '0 4px 8px', gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 16 }}>{category.emoji}</span>
        <div style={{
          fontSize: 13, fontWeight: 800, color: T.neutral[900],
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
        background: cfg.bg, padding: '2px 8px', borderRadius: 999,
        letterSpacing: 0.4, textTransform: 'uppercase',
        flexShrink: 0,
      }}>
        {cfg.label}
      </span>
    </div>
  )
}

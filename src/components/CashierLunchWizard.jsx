import { useEffect, useMemo, useRef, useState } from 'react'
import { T } from '../tokens'
import { fmtCOP } from '../utils/format'
import {
  CATEGORIES, CATEGORY_BY_ID, CORRIENTE_CATEGORIES,
  watchMenuItems, watchDailyMenu, resolveDailyMenu,
} from '../menu'
import { useBogotaDate } from '../utils/useBogotaDate'
import {
  REPLACEMENT_OPTIONS, REPLACEMENT_LABELS,
  buildKitchenNoteFromCustomerItem,
} from '../utils/lunchFormat'

// ──────────────────────────────────────────────────────────────────
// Wizard de almuerzo para la CAJERA. Replica el flujo del cliente
// (sí/no implícito por categoría única + reemplazos cuando dice no)
// y añade lo específico de la cajera:
//
//   • Paso final: Mesa/Llevar (con precios diferentes). Al picar destino
//     se cierra el wizard y NewSale abre SendCommandaModal (donde la
//     cajera ve la lista de items, agrega más, define mesa # y envía).
//   • Modo edición: arranca en 'destination' con todo pre-cargado y
//     solo guarda el cambio (sin "+ Otro almuerzo")
//   • Badge "X en comanda" en el header cuando ya hay almuerzos
//   • Chips de nota ampliados (típicos del corriente colombiano)
//
// Reemplaza al LunchPickerModal viejo. Misma interfaz pública:
//   props:
//     product           → { id, name, priceMesa, priceLlevar }
//     currentCount      → cuántos almuerzos ya hay en la comanda
//     editMode          → si edita un kitchenOrder ya enviado
//     initialSelections → preselecciones para edit mode
//     initialNote       → nota actual para edit mode
//     onCancel
//     onAdd(payload, { another })  → modo normal
//     onSaveEdit(payload)          → modo edición
//
// Los `replacements` (reemplazos del wizard cuando dice no a sopa o
// principio) se concatenan al `note` al construir el payload — así la
// cocina los recibe sin cambiar el modelo de kitchenOrders.
// ──────────────────────────────────────────────────────────────────
export default function CashierLunchWizard({
  product,
  currentCount = 0,
  editMode = false,
  initialSelections = null,
  initialNote = '',
  initialDestination = null,
  onCancel,
  onAdd,
  onSaveEdit = () => {},
}) {
  const today = useBogotaDate()
  const [allItems, setAllItems] = useState([])
  const [dailyMenu, setDailyMenu] = useState(null)

  useEffect(() => watchMenuItems(setAllItems), [])
  useEffect(() => watchDailyMenu(today, setDailyMenu), [today])

  const resolvedMenu = useMemo(
    () => resolveDailyMenu(dailyMenu, allItems),
    [dailyMenu, allItems]
  )

  // ─── Estado del almuerzo ─────────────────────────────────────────
  const [selections, setSelections] = useState(() => {
    if (initialSelections) return { ...initialSelections }
    return {}
  })
  // En modo edición no tenemos replacements del kitchenOrder original
  // — viven en la nota del payload de la cocina. Arrancamos vacío;
  // la cajera puede agregarlos al editar si quiere.
  const [replacements, setReplacements] = useState({})
  const [note, setNote] = useState(initialNote || '')

  // ─── Pre-selección de side/salad/juice en modo normal ────────────
  // En edición respetamos las selecciones del kitchenOrder existente
  // (incluso si la cajera dejó algo en null = SIN). Pre-seleccionamos
  // cuando arrancan los datos Y cada vez que la cajera resetea el
  // wizard para un nuevo almuerzo (selections vacías).
  const preselectedRef = useRef(false)
  useEffect(() => {
    if (editMode) return
    if (preselectedRef.current) return
    const sideHas = resolvedMenu.side?.length > 0
    const saladHas = resolvedMenu.salad?.length > 0
    const juiceHas = resolvedMenu.juice?.length > 0
    if (!sideHas && !saladHas && !juiceHas) return
    preselectedRef.current = true
    setSelections(prev => {
      const next = { ...prev }
      for (const catId of ['side', 'salad', 'juice']) {
        if (next[catId] !== undefined) continue
        const opts = resolvedMenu[catId] || []
        if (opts.length > 0) next[catId] = { id: opts[0].id, name: opts[0].name }
      }
      return next
    })
  }, [resolvedMenu.side, resolvedMenu.salad, resolvedMenu.juice, editMode])

  // ─── Steps ───────────────────────────────────────────────────────
  // En edición arrancamos directo en 'destination' (con todo pre-cargado
  // y el destino actual destacado). En modo normal arrancamos en 'soup'.
  //   soup → soup-replace? → principio → principio-replace? → protein
  //   → sides-combo → note → destination
  // (No hay step 'next-action': al picar destino el wizard cierra y se
  //  abre SendCommandaModal, que tiene la lista de items + chooser de
  //  seguir agregando + selector de mesa.)
  const [step, setStep] = useState(editMode ? 'destination' : 'soup')

  function setCategory(catId, val) {
    setSelections(prev => ({ ...prev, [catId]: val }))
  }
  function setReplacement(catId, key) {
    setReplacements(prev => ({ ...prev, [catId]: key }))
  }
  function clearReplacement(catId) {
    setReplacements(prev => {
      const next = { ...prev }
      delete next[catId]
      return next
    })
  }

  // ─── Payload final ───────────────────────────────────────────────
  function buildPayload(destination) {
    const sel = {}
    for (const cat of CORRIENTE_CATEGORIES) {
      sel[cat.id] = selections[cat.id] || null
    }
    const isLlevar = destination === 'llevar'
    const priceMesa = Number(product?.priceMesa || 0)
    const priceLlevar = Number(product?.priceLlevar || product?.priceMesa || 0)
    const price = isLlevar ? priceLlevar : priceMesa

    // Concatenar replacements al note para que viajen a cocina.
    const finalNote = buildKitchenNoteFromCustomerItem({
      replacements,
      note: note.trim(),
    })

    return {
      kind: 'menu',
      productId: product?.id || null,
      productName: product?.name || 'Almuerzo Corriente',
      destination,
      selections: sel,
      price,
      note: finalNote,
    }
  }

  function pickDestination(destination) {
    if (editMode) {
      onSaveEdit(buildPayload(destination))
      return
    }
    // Agregamos al carrito CON another=false: NewSale cerrará el wizard y
    // abrirá SendCommandaModal con la lista de items y el selector de mesa.
    // Desde ahí la cajera puede agregar más almuerzos o enviar la comanda.
    onAdd(buildPayload(destination), { another: false })
  }

  // ─── Navegación ──────────────────────────────────────────────────
  const TOTAL_STEPS = 6 // sopa, principio, proteína, sides, nota, destino
  const stepIndex = useMemo(() => {
    if (step.startsWith('soup')) return 0
    if (step.startsWith('principio')) return 1
    if (step === 'protein') return 2
    if (step === 'sides-combo') return 3
    if (step === 'note') return 4
    if (step === 'destination') return 5
    return 0
  }, [step])

  function goBack() {
    switch (step) {
      case 'soup':              onCancel(); break
      case 'soup-replace':      setStep('soup'); break
      case 'principio':         setStep(selections.soup ? 'soup' : 'soup-replace'); break
      case 'principio-replace': setStep('principio'); break
      case 'protein':           setStep(selections.principio ? 'principio' : 'principio-replace'); break
      case 'sides-combo':       setStep('protein'); break
      case 'note':              setStep('sides-combo'); break
      case 'destination':       editMode ? onCancel() : setStep('note'); break
    }
  }

  // ─── Render ──────────────────────────────────────────────────────
  return (
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, zIndex: 95,
      background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      animation: 'clwFadeBg 0.18s ease',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 540, height: '94vh',
        background: T.neutral[50], borderRadius: '20px 20px 0 0',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 -8px 32px rgba(0,0,0,0.25)',
        animation: 'clwSlideUp 0.28s cubic-bezier(0.2,0.9,0.3,1.05)',
      }}>
        <WizardHeader
          product={product}
          currentCount={currentCount}
          stepIndex={stepIndex}
          total={TOTAL_STEPS}
          editMode={editMode}
          onBack={goBack}
          canCancel={step === 'soup' || (editMode && step === 'destination')}
        />

        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{ padding: '16px 18px 20px' }}>
            {step === 'soup' && (() => {
              // Mismo fix que PublicLunchWizard: si hay 2+ sopas, mostrar
              // todas las opciones en lugar de hardcodear la primera.
              const soupOpts = resolvedMenu.soup || []
              if (soupOpts.length >= 2) {
                return (
                  <PickStep
                    emoji="🥣"
                    title="La sopa de hoy"
                    subtitle={`Hoy hay ${soupOpts.length} opciones — elige una.`}
                    options={soupOpts}
                    selected={selections.soup}
                    onPick={(opt) => {
                      clearReplacement('soup')
                      setCategory('soup', { id: opt.id, name: opt.name })
                    }}
                    ctaBelow={(
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <ContinueButton
                          enabled={!!selections.soup}
                          onClick={() => setStep('principio')}
                          label="Continuar"
                        />
                        <button
                          onClick={() => {
                            setCategory('soup', null)
                            clearReplacement('soup')
                            setStep('soup-replace')
                          }}
                          style={{
                            width: '100%', padding: '14px', borderRadius: 14,
                            background: 'transparent', color: T.neutral[600],
                            border: `1.5px solid ${T.neutral[200]}`,
                            cursor: 'pointer', fontFamily: 'inherit',
                            fontSize: 14, fontWeight: 700, letterSpacing: -0.1,
                          }}
                        >
                          Sin sopa
                        </button>
                      </div>
                    )}
                  />
                )
              }
              // 1 sopa (o 0): UX rápida Sí/No.
              return (
                <SingleOptionStep
                  emoji="🥣"
                  title="La sopa de hoy"
                  item={soupOpts[0] || null}
                  onYes={() => {
                    const opt = soupOpts[0]
                    if (opt) {
                      clearReplacement('soup')
                      setCategory('soup', { id: opt.id, name: opt.name })
                    }
                    setStep('principio')
                  }}
                  onNo={() => {
                    clearReplacement('soup')
                    setCategory('soup', null)
                    setStep('soup-replace')
                  }}
                  emptyText="Hoy no hay sopa publicada."
                  onEmpty={() => setStep('principio')}
                />
              )
            })()}
            {step === 'soup-replace' && (
              <ReplaceStep
                emoji="🥣"
                title="¿Qué deseas en vez de la sopa?"
                options={REPLACEMENT_OPTIONS.soup}
                selected={replacements.soup}
                onPick={(key) => {
                  setReplacement('soup', key)
                  setTimeout(() => setStep('principio'), 180)
                }}
              />
            )}

            {step === 'principio' && (
              <PickStep
                emoji="🫘"
                title="Elige tu principio"
                subtitle="Puedes pedir mixto si quieres dos."
                options={resolvedMenu.principio || []}
                selected={selections.principio}
                multi
                maxSel={CATEGORY_BY_ID.principio?.maxSelections || 1}
                onPick={(opt) => {
                  clearReplacement('principio')
                  const cur = selections.principio
                  const curArr = Array.isArray(cur) ? cur : (cur ? [cur] : [])
                  const max = CATEGORY_BY_ID.principio?.maxSelections || 1
                  const existIdx = curArr.findIndex(x => x?.id === opt.id)
                  let next
                  if (existIdx >= 0) {
                    next = curArr.filter((_, i) => i !== existIdx)
                  } else if (curArr.length < max) {
                    next = [...curArr, opt]
                  } else {
                    next = [...curArr.slice(1), opt]
                  }
                  if (next.length === 0) setCategory('principio', null)
                  else if (next.length === 1) setCategory('principio', next[0])
                  else setCategory('principio', next)
                }}
                emptyText="Hoy no hay principios publicados."
                onEmpty={() => setStep('protein')}
                ctaBelow={(
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <ContinueButton
                      enabled={!!selections.principio}
                      onClick={() => setStep('protein')}
                      label="Continuar"
                    />
                    <button
                      onClick={() => {
                        setCategory('principio', null)
                        clearReplacement('principio')
                        setStep('principio-replace')
                      }}
                      style={{
                        width: '100%', padding: '14px', borderRadius: 14,
                        background: 'transparent', color: T.neutral[600],
                        border: `1.5px solid ${T.neutral[200]}`,
                        cursor: 'pointer', fontFamily: 'inherit',
                        fontSize: 14, fontWeight: 700, letterSpacing: -0.1,
                      }}
                    >
                      No quiere principio
                    </button>
                  </div>
                )}
              />
            )}
            {step === 'principio-replace' && (
              <ReplaceStep
                emoji="🫘"
                title="¿Qué desea en vez del principio?"
                options={REPLACEMENT_OPTIONS.principio}
                selected={replacements.principio}
                onPick={(key) => {
                  setReplacement('principio', key)
                  setTimeout(() => setStep('protein'), 180)
                }}
              />
            )}

            {step === 'protein' && (
              <PickStep
                emoji="🍗"
                title="Elige la proteína"
                subtitle="Esta sí va sí o sí."
                options={resolvedMenu.protein || []}
                selected={selections.protein}
                onPick={(opt) => {
                  setCategory('protein', opt)
                  setTimeout(() => setStep('sides-combo'), 180)
                }}
                emptyText="Hoy no hay proteínas publicadas."
                onEmpty={() => setStep('sides-combo')}
              />
            )}

            {step === 'sides-combo' && (
              <SidesComboStep
                resolvedMenu={resolvedMenu}
                selections={selections}
                onChange={(catId, val) => setCategory(catId, val)}
                onContinue={() => setStep('note')}
              />
            )}

            {step === 'note' && (
              <NoteStep
                note={note}
                onChange={setNote}
                onContinue={() => setStep('destination')}
              />
            )}

            {step === 'destination' && (
              <DestinationStep
                product={product}
                editMode={editMode}
                initialDestination={initialDestination}
                onPick={pickDestination}
              />
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes clwFadeBg {
          from { background: rgba(0,0,0,0); }
          to   { background: rgba(0,0,0,0.55); }
        }
        @keyframes clwSlideUp {
          from { transform: translateY(8%); opacity: 0; }
          to   { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

// ─── Header ──────────────────────────────────────────────────────
function WizardHeader({ product, currentCount, stepIndex, total, editMode, onBack, canCancel }) {
  const pct = ((stepIndex + 1) / total) * 100
  const priceMesa = Number(product?.priceMesa || 0)
  const priceLlevar = Number(product?.priceLlevar || product?.priceMesa || 0)
  return (
    <div style={{
      padding: '12px 16px 10px',
      background: '#fff',
      borderBottom: `1px solid ${T.neutral[100]}`,
      flexShrink: 0,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10,
      }}>
        <button
          onClick={onBack}
          aria-label={canCancel ? 'Cerrar' : 'Atrás'}
          style={{
            width: 36, height: 36, borderRadius: 999,
            background: T.neutral[100], border: 'none',
            cursor: 'pointer', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'inherit',
          }}
        >
          {canCancel ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M3 3 L9 9 M9 3 L3 9" stroke={T.neutral[700]} strokeWidth="2" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
              <path d="M9 2 L3 7 L9 12" stroke={T.neutral[700]} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 15, fontWeight: 800, color: T.neutral[900],
            letterSpacing: -0.2, display: 'flex', alignItems: 'center', gap: 6,
            flexWrap: 'wrap',
          }}>
            <span>{product?.name || 'Almuerzo'}</span>
            {editMode && (
              <span style={{
                fontSize: 10, fontWeight: 800, color: T.warn,
                background: '#FFF7E6', padding: '2px 7px', borderRadius: 999,
                letterSpacing: 0.4, textTransform: 'uppercase',
              }}>
                Editando
              </span>
            )}
            {!editMode && currentCount > 0 && (
              <span style={{
                fontSize: 10, fontWeight: 800, color: T.copper[700],
                background: T.copper[50], padding: '2px 7px', borderRadius: 999,
                letterSpacing: 0.4, textTransform: 'uppercase',
              }}>
                {currentCount} en comanda
              </span>
            )}
          </div>
          <div style={{
            fontSize: 11, color: T.neutral[500], marginTop: 1,
            fontVariantNumeric: 'tabular-nums',
          }}>
            Mesa {fmtCOP(priceMesa)} · Llevar {fmtCOP(priceLlevar)}
            {' · '}<span style={{ fontWeight: 700 }}>Paso {stepIndex + 1}/{total}</span>
          </div>
        </div>
      </div>
      <div style={{
        height: 5, borderRadius: 999, background: T.neutral[100],
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${pct}%`, height: '100%',
          background: T.copper[500],
          transition: 'width 0.3s ease',
        }} />
      </div>
    </div>
  )
}

// ─── Step: una opción ÚNICA del día (sopa) ──────────────────────
function SingleOptionStep({ emoji, title, item, onYes, onNo, emptyText, onEmpty }) {
  if (!item) {
    return (
      <div>
        <StepHero emoji={emoji} title={title} />
        <div style={{
          marginTop: 18, padding: '20px 18px', borderRadius: 16,
          background: '#fff', border: `1.5px dashed ${T.neutral[200]}`,
          textAlign: 'center', color: T.neutral[500], fontSize: 13.5, lineHeight: 1.5,
        }}>
          {emptyText || 'No hay opciones'}
        </div>
        <button
          onClick={onEmpty}
          style={{
            width: '100%', padding: '16px', marginTop: 14, borderRadius: 14,
            background: T.copper[500], color: '#fff',
            border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 15, fontWeight: 800, letterSpacing: -0.1,
            boxShadow: `0 4px 14px ${T.copper[500]}55`,
          }}
        >
          Continuar
        </button>
      </div>
    )
  }
  return (
    <div>
      <StepHero emoji={emoji} title={title} />
      <div style={{
        marginTop: 16, padding: '22px 20px', borderRadius: 18,
        background: '#fff', border: `2px solid ${T.copper[200]}`,
        textAlign: 'center',
        boxShadow: '0 4px 16px rgba(184,122,86,0.12)',
      }}>
        <div style={{
          fontSize: 10.5, fontWeight: 800, color: T.copper[700],
          letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 6,
        }}>
          Hoy es
        </div>
        <div style={{
          fontSize: 22, fontWeight: 900, color: T.neutral[900],
          letterSpacing: -0.4, lineHeight: 1.2,
        }}>
          {item.name}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
        <BigChoice label="Sí quiere" icon="✓" color={T.ok} onClick={onYes} />
        <BigChoice label="No, gracias" icon="✕" color={T.neutral[500]} onClick={onNo} />
      </div>
    </div>
  )
}

function BigChoice({ label, icon, color, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', padding: '18px', borderRadius: 16,
        background: '#fff', color: T.neutral[900],
        border: `2px solid ${T.neutral[200]}`,
        cursor: 'pointer', fontFamily: 'inherit',
        fontSize: 16, fontWeight: 800, letterSpacing: -0.2,
        display: 'flex', alignItems: 'center', gap: 12,
        boxShadow: '0 3px 12px rgba(0,0,0,0.04)',
        transition: 'transform 0.1s ease, border-color 0.18s',
      }}
      onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.98)')}
      onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
      onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
    >
      <div style={{
        width: 34, height: 34, borderRadius: 999, flexShrink: 0,
        background: `${color}22`, color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 16, fontWeight: 900,
      }}>
        {icon}
      </div>
      {label}
    </button>
  )
}

// ─── Step: elegir entre opciones ────────────────────────────────
function PickStep({
  emoji, title, subtitle, options, selected, onPick,
  multi = false, maxSel = 1,
  emptyText, onEmpty, ctaBelow,
}) {
  if (!options || options.length === 0) {
    return (
      <div>
        <StepHero emoji={emoji} title={title} subtitle={subtitle} />
        <div style={{
          marginTop: 18, padding: '20px 18px', borderRadius: 16,
          background: '#fff', border: `1.5px dashed ${T.neutral[200]}`,
          textAlign: 'center', color: T.neutral[500], fontSize: 13.5, lineHeight: 1.5,
        }}>
          {emptyText || 'No hay opciones'}
        </div>
        {onEmpty && (
          <button
            onClick={onEmpty}
            style={{
              width: '100%', padding: '16px', marginTop: 14, borderRadius: 14,
              background: T.copper[500], color: '#fff',
              border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 15, fontWeight: 800, letterSpacing: -0.1,
              boxShadow: `0 4px 14px ${T.copper[500]}55`,
            }}
          >
            Continuar
          </button>
        )}
      </div>
    )
  }

  const selectedArr = Array.isArray(selected) ? selected : (selected ? [selected] : [])
  const isMixto = multi && selectedArr.length === 2

  return (
    <div>
      <StepHero emoji={emoji} title={title} subtitle={subtitle} />
      {multi && maxSel > 1 && (
        <div style={{
          marginTop: 4, marginBottom: 12, padding: '8px 12px',
          borderRadius: 10, background: T.copper[50],
          border: `1px solid ${T.copper[100]}`,
          color: T.copper[700], fontSize: 12, fontWeight: 700,
          textAlign: 'center', letterSpacing: 0.2,
        }}>
          Puede pedir hasta {maxSel} (mixto) {isMixto && '· MIXTO ✓'}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
        {options.map(opt => {
          const active = selectedArr.some(s => s?.id === opt.id)
          return (
            <button
              key={opt.id}
              onClick={() => onPick(opt)}
              style={{
                width: '100%', padding: '14px 16px', borderRadius: 14,
                background: active ? T.copper[500] : '#fff',
                color: active ? '#fff' : T.neutral[900],
                border: `1.5px solid ${active ? T.copper[500] : T.neutral[200]}`,
                cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                fontSize: 15, fontWeight: 700, letterSpacing: -0.1,
                display: 'flex', alignItems: 'center', gap: 12,
                boxShadow: active ? `0 4px 14px ${T.copper[500]}55` : '0 2px 6px rgba(0,0,0,0.03)',
                transition: 'background 0.15s, border-color 0.15s, transform 0.1s ease',
              }}
              onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.99)')}
              onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
              onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
            >
              <div style={{
                width: 24, height: 24, borderRadius: 999, flexShrink: 0,
                background: active ? '#fff' : 'transparent',
                border: `2px solid ${active ? '#fff' : T.neutral[300]}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {active && (
                  <svg width="12" height="12" viewBox="0 0 13 13" fill="none">
                    <path d="M2 7 L5 10 L11 3" stroke={T.copper[500]} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </div>
              <span style={{ flex: 1, minWidth: 0 }}>{opt.name}</span>
            </button>
          )
        })}
      </div>
      {ctaBelow && <div style={{ marginTop: 14 }}>{ctaBelow}</div>}
    </div>
  )
}

// ─── Step: reemplazo cuando dijo no ─────────────────────────────
function ReplaceStep({ emoji, title, options, selected, onPick }) {
  return (
    <div>
      <StepHero
        emoji={emoji}
        title={title}
        subtitle="Algo extra de cortesía, sin costo adicional."
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
        {options.map(opt => {
          const active = selected === opt.key
          return (
            <button
              key={opt.key}
              onClick={() => onPick(opt.key)}
              style={{
                width: '100%', padding: '13px 16px', borderRadius: 14,
                background: active ? T.copper[500] : '#fff',
                color: active ? '#fff' : T.neutral[900],
                border: `1.5px solid ${active ? T.copper[500] : T.neutral[200]}`,
                cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                fontSize: 15, fontWeight: 700, letterSpacing: -0.1,
                display: 'flex', alignItems: 'center', gap: 12,
                boxShadow: active ? `0 4px 14px ${T.copper[500]}55` : '0 2px 6px rgba(0,0,0,0.03)',
                transition: 'background 0.15s, border-color 0.15s, transform 0.1s ease',
              }}
              onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.99)')}
              onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
              onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
            >
              <span style={{ fontSize: 22, lineHeight: 1, flexShrink: 0 }}>{opt.emoji}</span>
              <span style={{ flex: 1, minWidth: 0 }}>{opt.label}</span>
              {active && (
                <svg width="14" height="14" viewBox="0 0 13 13" fill="none">
                  <path d="M2 7 L5 10 L11 3" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Step: Acompañante + Ensalada + Jugo combinado ──────────────
function SidesComboStep({ resolvedMenu, selections, onChange, onContinue }) {
  const CATS = ['side', 'salad', 'juice']
  return (
    <div>
      <StepHero
        emoji="🍚"
        title="Extras"
        subtitle="Pre-seleccionados. Quítalos si el cliente no quiere."
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
        {CATS.map(catId => {
          const cat = CATEGORY_BY_ID[catId]
          const opts = resolvedMenu[catId] || []
          return (
            <SideRow
              key={catId}
              category={cat}
              options={opts}
              selected={selections[catId]}
              onChange={(val) => onChange(catId, val)}
            />
          )
        })}
      </div>
      <button
        onClick={onContinue}
        style={{
          width: '100%', padding: '16px', marginTop: 18, borderRadius: 14,
          background: T.copper[500], color: '#fff',
          border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 15, fontWeight: 800, letterSpacing: -0.1,
          boxShadow: `0 4px 14px ${T.copper[500]}55`,
        }}
      >
        Continuar →
      </button>
    </div>
  )
}

function SideRow({ category, options, selected, onChange }) {
  const [changing, setChanging] = useState(false)
  const hasOptions = options.length > 0
  const showPicker = changing && hasOptions
  const isActive = !!selected

  if (!hasOptions) {
    return (
      <div style={{
        padding: '14px 16px', borderRadius: 14,
        background: T.neutral[100], border: `1px dashed ${T.neutral[200]}`,
        color: T.neutral[500], fontSize: 13, lineHeight: 1.5,
      }}>
        <span style={{ fontSize: 16, marginRight: 6 }}>{category.emoji}</span>
        Sin opciones de <b>{category.label.toLowerCase()}</b> hoy.
      </div>
    )
  }

  return (
    <div style={{
      borderRadius: 16, background: '#fff',
      border: `1.5px solid ${isActive ? T.copper[200] : T.neutral[200]}`,
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '12px 16px',
        display: 'flex', alignItems: 'center', gap: 10,
        background: isActive ? T.copper[50] : T.neutral[50],
        borderBottom: showPicker ? `1px solid ${T.neutral[100]}` : 'none',
      }}>
        <span style={{ fontSize: 22, lineHeight: 1 }}>{category.emoji}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 11.5, fontWeight: 800,
            color: isActive ? T.copper[700] : T.neutral[500],
            letterSpacing: 0.4, textTransform: 'uppercase',
          }}>
            {category.label}
          </div>
          <div style={{
            fontSize: 14.5, fontWeight: 800,
            color: isActive ? T.neutral[900] : T.bad,
            marginTop: 1, lineHeight: 1.3,
          }}>
            {isActive ? selected.name : `Sin ${category.label.toLowerCase()}`}
          </div>
        </div>
      </div>

      {showPicker && (
        <div style={{
          padding: '10px 12px',
          display: 'flex', gap: 8, flexWrap: 'wrap',
        }}>
          {options.map(opt => {
            const active = selected?.id === opt.id
            return (
              <button
                key={opt.id}
                onClick={() => {
                  onChange({ id: opt.id, name: opt.name })
                  setChanging(false)
                }}
                style={{
                  padding: '9px 14px', borderRadius: 12,
                  background: active ? T.copper[500] : '#fff',
                  color: active ? '#fff' : T.neutral[800],
                  border: `1.5px solid ${active ? T.copper[500] : T.neutral[200]}`,
                  cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 13.5, fontWeight: 700, letterSpacing: -0.1,
                }}
              >
                {active && '✓ '}{opt.name}
              </button>
            )
          })}
        </div>
      )}

      <div style={{
        padding: '10px 12px',
        display: 'flex', gap: 8,
        borderTop: showPicker ? `1px solid ${T.neutral[100]}` : 'none',
      }}>
        {!showPicker && options.length > 1 && (
          <button
            onClick={() => setChanging(true)}
            style={{
              flex: 1, padding: '10px', borderRadius: 11,
              background: 'transparent', color: T.copper[700],
              border: `1.5px solid ${T.copper[200]}`,
              cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 13, fontWeight: 700,
            }}
          >
            ✎ Cambiar
          </button>
        )}
        {showPicker && (
          <button
            onClick={() => setChanging(false)}
            style={{
              flex: 1, padding: '10px', borderRadius: 11,
              background: 'transparent', color: T.neutral[600],
              border: `1.5px solid ${T.neutral[200]}`,
              cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 13, fontWeight: 700,
            }}
          >
            Cancelar
          </button>
        )}
        {isActive ? (
          <button
            onClick={() => { onChange(null); setChanging(false) }}
            style={{
              flex: 1, padding: '10px', borderRadius: 11,
              background: '#FBE9E5', color: T.bad,
              border: `1.5px solid #F0C8BE`,
              cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 13, fontWeight: 700,
            }}
          >
            ✕ Quitar
          </button>
        ) : (
          <button
            onClick={() => {
              const first = options[0]
              onChange({ id: first.id, name: first.name })
            }}
            style={{
              flex: 1, padding: '10px', borderRadius: 11,
              background: T.copper[500], color: '#fff',
              border: 'none',
              cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 13, fontWeight: 700,
            }}
          >
            + Agregar
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Step: Observaciones de cocina (chips ampliados de cajera) ──
function NoteStep({ note, onChange, onContinue }) {
  // Chips ampliados — incluyen casos típicos del corriente colombiano que
  // la cajera escucha cara a cara.
  const CHIPS = [
    'Sin sal', 'Sin cebolla', 'Sin tomate',
    'Huevo bien cocido', 'Huevo blando', 'Huevo frito',
    'Bien caliente', 'Aparte', 'Sin cilantro',
  ]
  return (
    <div>
      <StepHero
        emoji="📝"
        title="¿Algún comentario?"
        subtitle="Para cocina. Solo lo que el cliente pidió específicamente."
      />
      <div style={{
        marginTop: 16, padding: '14px 14px 12px', borderRadius: 16,
        background: '#FFF7E6', border: `1.5px solid #F4E0BC`,
      }}>
        <div style={{
          fontSize: 11, fontWeight: 800, color: '#7A5C00',
          letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 8,
        }}>
          Toques rápidos
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {CHIPS.map(chip => (
            <button
              key={chip}
              type="button"
              onClick={() => {
                onChange((note || '').trim()
                  ? (note.toLowerCase().includes(chip.toLowerCase())
                      ? note
                      : `${note.trim()} · ${chip}`)
                  : chip)
              }}
              style={{
                padding: '7px 12px', borderRadius: 999,
                background: '#fff', color: '#7A5C00',
                border: `1px solid #F4E0BC`,
                cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 12.5, fontWeight: 700,
              }}
            >
              + {chip}
            </button>
          ))}
        </div>
        <textarea
          value={note}
          onChange={e => onChange(e.target.value)}
          placeholder='O escribe libremente…'
          rows={3}
          maxLength={200}
          style={{
            width: '100%', padding: '12px 14px', borderRadius: 12,
            border: `1.5px solid #F4E0BC`, fontSize: 14, fontFamily: 'inherit',
            background: '#fff', color: T.neutral[900],
            outline: 'none', resize: 'vertical', minHeight: 70,
            boxSizing: 'border-box',
          }}
        />
        {note && (
          <button
            type="button"
            onClick={() => onChange('')}
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
      <button
        onClick={onContinue}
        style={{
          width: '100%', padding: '16px', marginTop: 16, borderRadius: 14,
          background: T.copper[500], color: '#fff',
          border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 15, fontWeight: 800, letterSpacing: -0.1,
          boxShadow: `0 4px 14px ${T.copper[500]}55`,
        }}
      >
        {note.trim() ? 'Continuar →' : 'Saltar, sin notas →'}
      </button>
    </div>
  )
}

// ─── Step final: elegir Mesa o Llevar ───────────────────────────
function DestinationStep({ product, editMode, initialDestination, onPick }) {
  const priceMesa = Number(product?.priceMesa || 0)
  const priceLlevar = Number(product?.priceLlevar || product?.priceMesa || 0)
  return (
    <div>
      <StepHero
        emoji="🍽️"
        title="¿Mesa o llevar?"
        subtitle={editMode ? 'Toca para guardar los cambios.' : 'Toca para enviar este almuerzo.'}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 18 }}>
        <DestinationBigButton
          icon="🍽️"
          title="Para mesa"
          subtitle="Cliente come en el local"
          price={priceMesa}
          accentBg={T.copper[50]}
          accentBorder={T.copper[400]}
          accentColor={T.copper[700]}
          highlight={initialDestination === 'mesa'}
          onClick={() => onPick('mesa')}
        />
        <DestinationBigButton
          icon="📦"
          title="Para llevar"
          subtitle="Cliente se lo lleva empacado"
          price={priceLlevar}
          accentBg="#FFF7E6"
          accentBorder="#F0D699"
          accentColor="#7A5C00"
          highlight={initialDestination === 'llevar'}
          onClick={() => onPick('llevar')}
        />
      </div>
      {editMode && initialDestination && (
        <div style={{
          marginTop: 14, padding: '10px 12px', borderRadius: 10,
          background: T.neutral[100], color: T.neutral[600],
          fontSize: 12, lineHeight: 1.5, textAlign: 'center',
        }}>
          Actual: <b>{initialDestination === 'mesa' ? 'Para mesa' : 'Para llevar'}</b>
        </div>
      )}
    </div>
  )
}

function DestinationBigButton({ icon, title, subtitle, price, accentBg, accentBorder, accentColor, highlight, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', padding: '20px 22px', borderRadius: 18,
        background: accentBg,
        border: `${highlight ? 3 : 2}px solid ${accentBorder}`,
        cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
        display: 'flex', alignItems: 'center', gap: 16,
        transition: 'transform 0.1s ease',
        boxShadow: highlight ? `0 6px 18px ${accentBorder}66` : 'none',
      }}
      onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.985)')}
      onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
      onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
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
        {fmtCOP(price)}
      </div>
    </button>
  )
}

// ─── Hero compartido ────────────────────────────────────────────
function StepHero({ emoji, title, subtitle }) {
  return (
    <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
      <div style={{ fontSize: 48, lineHeight: 1, marginBottom: 6 }}>{emoji}</div>
      <div style={{
        fontSize: 22, fontWeight: 900, color: T.neutral[900],
        letterSpacing: -0.5, lineHeight: 1.2, marginBottom: 4,
      }}>
        {title}
      </div>
      {subtitle && (
        <div style={{
          fontSize: 13, color: T.neutral[600], lineHeight: 1.5,
          maxWidth: 380, margin: '0 auto',
        }}>
          {subtitle}
        </div>
      )}
    </div>
  )
}

function ContinueButton({ enabled, onClick, label }) {
  return (
    <button
      onClick={enabled ? onClick : undefined}
      disabled={!enabled}
      style={{
        width: '100%', padding: '16px', borderRadius: 14,
        background: enabled ? T.copper[500] : T.neutral[200],
        color: enabled ? '#fff' : T.neutral[500],
        border: 'none', cursor: enabled ? 'pointer' : 'not-allowed',
        fontFamily: 'inherit', fontSize: 15, fontWeight: 800, letterSpacing: -0.1,
        boxShadow: enabled ? `0 4px 14px ${T.copper[500]}55` : 'none',
      }}
    >
      {label} →
    </button>
  )
}

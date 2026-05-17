import { useEffect, useMemo, useState } from 'react'
import { T } from '../tokens'
import { fmtCOP } from '../utils/format'
import {
  watchMenuItems, watchDailyMenu, resolveDailyMenu, getSpecialState,
} from '../menu'
import { useBogotaDate } from '../utils/useBogotaDate'
import {
  REPLACEMENT_OPTIONS, REPLACEMENT_LABELS,
  buildKitchenNoteFromCustomerItem,
} from '../utils/lunchFormat'

// ──────────────────────────────────────────────────────────────────
// Wizard de Almuerzo Especial para la CAJERA. Mismo flujo del cliente
// (sopa → especial → ensalada) + 1 paso de Mesa/Llevar al final.
// Reemplaza al SpecialLunchModal viejo.
//
// Props:
//   currentCount       → cuántos items hay en la comanda
//   editMode           → si edita un kitchenOrder ya enviado
//   initialSelections  → preselecciones para edit mode
//   initialNote        → nota actual para edit mode
//   initialDestination → destino actual (mesa/llevar) para edit mode
//   onCancel
//   onAdd(payload, { another })
//   onSaveEdit(payload)
//
// Los `replacements` se concatenan al note al construir el payload.
// ──────────────────────────────────────────────────────────────────
export default function CashierSpecialWizard({
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
  const specialState = useMemo(
    () => getSpecialState(dailyMenu, allItems),
    [dailyMenu, allItems]
  )

  // ─── Estado del almuerzo ─────────────────────────────────────────
  const [selections, setSelections] = useState(() => {
    if (initialSelections) return { ...initialSelections }
    return {}
  })
  const [replacements, setReplacements] = useState({})
  const [note, setNote] = useState(initialNote || '')

  // Pre-seleccionar ensalada del día (al montar)
  useEffect(() => {
    if (editMode) return
    if (selections.salad !== undefined) return
    const opts = resolvedMenu.salad || []
    if (opts.length > 0) {
      setSelections(prev => ({
        ...prev,
        salad: { id: opts[0].id, name: opts[0].name },
      }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedMenu.salad])

  // En edición arrancamos directo en destination. En normal en 'soup'.
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

  function buildPayload(destination) {
    const sel = {
      soup:     selections.soup || null,
      especial: selections.especial || null,
      salad:    selections.salad || null,
    }
    const isLlevar = destination === 'llevar'
    const price = isLlevar ? specialState.priceLlevar : specialState.priceMesa
    const finalNote = buildKitchenNoteFromCustomerItem({
      replacements, note: note.trim(),
    })
    return {
      kind: 'special',
      productId: null,
      productName: 'Almuerzo Especial',
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
    // Cierra el wizard y NewSale abre SendCommandaModal con todos los items.
    onAdd(buildPayload(destination), { another: false })
  }

  // ─── Navegación ──────────────────────────────────────────────────
  const TOTAL_STEPS = 5 // sopa, especial, ensalada, nota, destino
  const stepIndex = useMemo(() => {
    if (step.startsWith('soup')) return 0
    if (step === 'especial') return 1
    if (step === 'salad-step') return 2
    if (step === 'note') return 3
    if (step === 'destination') return 4
    return 0
  }, [step])

  function goBack() {
    switch (step) {
      case 'soup':         onCancel(); break
      case 'soup-replace': setStep('soup'); break
      case 'especial':     setStep(selections.soup ? 'soup' : 'soup-replace'); break
      case 'salad-step':   setStep('especial'); break
      case 'note':         setStep('salad-step'); break
      case 'destination':  editMode ? onCancel() : setStep('note'); break
    }
  }

  const soupOpts = resolvedMenu.soup || []
  const especialOpts = specialState.resolved.especial || []
  const saladOpts = resolvedMenu.salad || []

  return (
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, zIndex: 95,
      background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      animation: 'cswFadeBg 0.18s ease',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 540, height: '94vh',
        background: T.neutral[50], borderRadius: '20px 20px 0 0',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 -8px 32px rgba(0,0,0,0.25)',
        animation: 'cswSlideUp 0.28s cubic-bezier(0.2,0.9,0.3,1.05)',
      }}>
        <WizardHeader
          specialState={specialState}
          currentCount={currentCount}
          stepIndex={stepIndex}
          total={TOTAL_STEPS}
          editMode={editMode}
          onBack={goBack}
          canCancel={step === 'soup' || (editMode && step === 'destination')}
        />

        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{ padding: '16px 18px 20px' }}>
            {step === 'soup' && (
              soupOpts.length === 0 ? (
                <EmptyAutoSkip onSkip={() => setStep('especial')} />
              ) : soupOpts.length === 1 ? (
                <SingleOptionStep
                  emoji="🥣"
                  title="La sopa de hoy"
                  item={soupOpts[0]}
                  onYes={() => {
                    const opt = soupOpts[0]
                    clearReplacement('soup')
                    setCategory('soup', { id: opt.id, name: opt.name })
                    setStep('especial')
                  }}
                  onNo={() => {
                    clearReplacement('soup')
                    setCategory('soup', null)
                    setStep('soup-replace')
                  }}
                />
              ) : (
                <PickStep
                  emoji="🥣"
                  title="Elige la sopa"
                  subtitle="Hoy hay varias opciones"
                  options={soupOpts}
                  selected={selections.soup}
                  onPick={(opt) => {
                    clearReplacement('soup')
                    setCategory('soup', { id: opt.id, name: opt.name })
                    setTimeout(() => setStep('especial'), 180)
                  }}
                  ctaBelow={(
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
                      No quiere sopa
                    </button>
                  )}
                />
              )
            )}
            {step === 'soup-replace' && (
              <ReplaceStep
                emoji="🥣"
                title="¿Qué desea en vez de la sopa?"
                options={REPLACEMENT_OPTIONS.especial_soup}
                selected={replacements.soup}
                onPick={(key) => {
                  setReplacement('soup', key)
                  setTimeout(() => setStep('especial'), 180)
                }}
              />
            )}

            {step === 'especial' && (
              especialOpts.length === 0 ? (
                <div>
                  <StepHero emoji="⭐" title="Sin especial disponible" />
                  <div style={{
                    marginTop: 18, padding: '20px 18px', borderRadius: 16,
                    background: '#fff', border: `1.5px dashed ${T.neutral[200]}`,
                    textAlign: 'center', color: T.neutral[500], fontSize: 13.5, lineHeight: 1.5,
                  }}>
                    Hoy no hay plato especial publicado.
                  </div>
                </div>
              ) : especialOpts.length === 1 ? (
                <SingleOptionStep
                  emoji="⭐"
                  title="El especial de hoy"
                  item={especialOpts[0]}
                  onYes={() => {
                    const opt = especialOpts[0]
                    setCategory('especial', { id: opt.id, name: opt.name })
                    setStep('salad-step')
                  }}
                  hideNoButton
                />
              ) : (
                <PickStep
                  emoji="⭐"
                  title="Elige el especial"
                  subtitle="Hoy hay varios platos"
                  options={especialOpts}
                  selected={selections.especial}
                  onPick={(opt) => {
                    setCategory('especial', { id: opt.id, name: opt.name })
                    setTimeout(() => setStep('salad-step'), 180)
                  }}
                />
              )
            )}

            {step === 'salad-step' && (
              <SaladStep
                options={saladOpts}
                selected={selections.salad}
                onChange={(val) => setCategory('salad', val)}
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
                specialState={specialState}
                editMode={editMode}
                initialDestination={initialDestination}
                onPick={pickDestination}
              />
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes cswFadeBg {
          from { background: rgba(0,0,0,0); }
          to   { background: rgba(0,0,0,0.55); }
        }
        @keyframes cswSlideUp {
          from { transform: translateY(8%); opacity: 0; }
          to   { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

// ─── Header ──────────────────────────────────────────────────────
function WizardHeader({ specialState, currentCount, stepIndex, total, editMode, onBack, canCancel }) {
  const pct = ((stepIndex + 1) / total) * 100
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
            <span>⭐ Almuerzo Especial</span>
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
            Mesa {fmtCOP(specialState.priceMesa)} · Llevar {fmtCOP(specialState.priceLlevar)}
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
          background: T.warn,
          transition: 'width 0.3s ease',
        }} />
      </div>
    </div>
  )
}

// ─── Step: una opción ÚNICA del día ────────────────────────────
function SingleOptionStep({ emoji, title, item, onYes, onNo, hideNoButton }) {
  if (!item) return null
  return (
    <div>
      <StepHero emoji={emoji} title={title} />
      <div style={{
        marginTop: 16, padding: '22px 20px', borderRadius: 18,
        background: '#fff', border: `2px solid #F4E0BC`,
        textAlign: 'center',
        boxShadow: '0 4px 16px rgba(192,138,62,0.12)',
      }}>
        <div style={{
          fontSize: 10.5, fontWeight: 800, color: T.warn,
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
        <BigChoice label="Sí, quiere" icon="✓" color={T.ok} onClick={onYes} />
        {!hideNoButton && onNo && (
          <BigChoice label="No, gracias" icon="✕" color={T.neutral[500]} onClick={onNo} />
        )}
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
      }}
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
function PickStep({ emoji, title, subtitle, options, selected, onPick, ctaBelow }) {
  return (
    <div>
      <StepHero emoji={emoji} title={title} subtitle={subtitle} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
        {options.map(opt => {
          const active = selected?.id === opt.id
          return (
            <button
              key={opt.id}
              onClick={() => onPick(opt)}
              style={{
                width: '100%', padding: '14px 16px', borderRadius: 14,
                background: active ? T.warn : '#fff',
                color: active ? '#fff' : T.neutral[900],
                border: `1.5px solid ${active ? T.warn : T.neutral[200]}`,
                cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                fontSize: 15, fontWeight: 700, letterSpacing: -0.1,
                display: 'flex', alignItems: 'center', gap: 12,
                boxShadow: active ? `0 4px 14px ${T.warn}55` : '0 2px 6px rgba(0,0,0,0.03)',
              }}
            >
              <div style={{
                width: 24, height: 24, borderRadius: 999, flexShrink: 0,
                background: active ? '#fff' : 'transparent',
                border: `2px solid ${active ? '#fff' : T.neutral[300]}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {active && (
                  <svg width="12" height="12" viewBox="0 0 13 13" fill="none">
                    <path d="M2 7 L5 10 L11 3" stroke={T.warn} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/>
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

// ─── Step: reemplazo ────────────────────────────────────────────
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
                background: active ? T.warn : '#fff',
                color: active ? '#fff' : T.neutral[900],
                border: `1.5px solid ${active ? T.warn : T.neutral[200]}`,
                cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                fontSize: 15, fontWeight: 700, letterSpacing: -0.1,
                display: 'flex', alignItems: 'center', gap: 12,
              }}
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

// ─── Step: Ensalada ─────────────────────────────────────────────
function SaladStep({ options, selected, onChange, onContinue }) {
  const hasOptions = options.length > 0
  const isActive = !!selected
  if (!hasOptions) {
    return (
      <div>
        <StepHero
          emoji="🥗"
          title="Ensalada"
          subtitle="Hoy no hay ensalada publicada."
        />
        <button
          onClick={onContinue}
          style={{
            width: '100%', padding: '16px', marginTop: 16, borderRadius: 14,
            background: T.warn, color: '#fff',
            border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 15, fontWeight: 800, letterSpacing: -0.1,
          }}
        >
          Continuar →
        </button>
      </div>
    )
  }
  return (
    <div>
      <StepHero
        emoji="🥗"
        title="Ensalada"
        subtitle="Pre-seleccionada. Quítala si no la quiere."
      />
      <div style={{
        marginTop: 16, borderRadius: 16,
        background: '#fff', border: `1.5px solid ${isActive ? '#F4E0BC' : T.neutral[200]}`,
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '14px 16px',
          background: isActive ? '#FFF7E6' : T.neutral[50],
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 22 }}>🥗</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 11.5, fontWeight: 800,
              color: isActive ? T.warn : T.neutral[500],
              letterSpacing: 0.4, textTransform: 'uppercase',
            }}>
              Ensalada
            </div>
            <div style={{
              fontSize: 14.5, fontWeight: 800,
              color: isActive ? T.neutral[900] : T.bad,
              marginTop: 1,
            }}>
              {isActive ? selected.name : 'Sin ensalada'}
            </div>
          </div>
        </div>
        <div style={{ padding: '10px 12px' }}>
          {isActive ? (
            <button
              onClick={() => onChange(null)}
              style={{
                width: '100%', padding: '10px', borderRadius: 11,
                background: '#FBE9E5', color: T.bad,
                border: `1.5px solid #F0C8BE`,
                cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 13, fontWeight: 700,
              }}
            >
              ✕ Quitar ensalada
            </button>
          ) : (
            <button
              onClick={() => {
                const first = options[0]
                onChange({ id: first.id, name: first.name })
              }}
              style={{
                width: '100%', padding: '10px', borderRadius: 11,
                background: T.warn, color: '#fff',
                border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 13, fontWeight: 700,
              }}
            >
              + Agregar
            </button>
          )}
        </div>
      </div>
      <button
        onClick={onContinue}
        style={{
          width: '100%', padding: '16px', marginTop: 18, borderRadius: 14,
          background: T.warn, color: '#fff',
          border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 15, fontWeight: 800, letterSpacing: -0.1,
          boxShadow: `0 4px 14px ${T.warn}55`,
        }}
      >
        Continuar →
      </button>
    </div>
  )
}

// ─── Step: Observaciones (chips ampliados cajera) ──────────────
function NoteStep({ note, onChange, onContinue }) {
  const CHIPS = [
    'Sin sal', 'Sin cebolla', 'Sin tomate',
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
                  ? (note.toLowerCase().includes(chip.toLowerCase()) ? note : `${note.trim()} · ${chip}`)
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
          placeholder="O escribe libremente…"
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
      </div>
      <button
        onClick={onContinue}
        style={{
          width: '100%', padding: '16px', marginTop: 16, borderRadius: 14,
          background: T.warn, color: '#fff',
          border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 15, fontWeight: 800, letterSpacing: -0.1,
          boxShadow: `0 4px 14px ${T.warn}55`,
        }}
      >
        {note.trim() ? 'Continuar →' : 'Saltar, sin notas →'}
      </button>
    </div>
  )
}

// ─── Step final: Mesa o Llevar ──────────────────────────────────
function DestinationStep({ specialState, editMode, initialDestination, onPick }) {
  return (
    <div>
      <StepHero
        emoji="🍽️"
        title="¿Mesa o llevar?"
        subtitle={editMode ? 'Toca para guardar los cambios.' : 'Toca para enviar este especial.'}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 18 }}>
        <DestinationBigButton
          icon="🍽️"
          title="Para mesa"
          subtitle="Cliente come en el local"
          price={specialState.priceMesa}
          accentBg="#FFF7E6"
          accentBorder="#F4E0BC"
          accentColor={T.warn}
          highlight={initialDestination === 'mesa'}
          onClick={() => onPick('mesa')}
        />
        <DestinationBigButton
          icon="📦"
          title="Para llevar"
          subtitle="Cliente se lo lleva empacado"
          price={specialState.priceLlevar}
          accentBg="#FFF7E6"
          accentBorder="#F0D699"
          accentColor="#7A5C00"
          highlight={initialDestination === 'llevar'}
          onClick={() => onPick('llevar')}
        />
      </div>
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
        boxShadow: highlight ? `0 6px 18px ${accentBorder}66` : 'none',
      }}
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

function EmptyAutoSkip({ onSkip }) {
  useEffect(() => {
    const t = setTimeout(onSkip, 100)
    return () => clearTimeout(t)
  }, [onSkip])
  return null
}

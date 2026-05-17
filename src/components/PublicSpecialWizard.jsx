import { useEffect, useMemo, useRef, useState } from 'react'
import { T } from '../tokens'
import { fmtCOP } from '../utils/format'
import { CATEGORY_BY_ID } from '../menu'
import { REPLACEMENT_OPTIONS, REPLACEMENT_LABELS } from '../utils/lunchFormat'

// ──────────────────────────────────────────────────────────────────
// Wizard del cliente para armar UN almuerzo ESPECIAL paso a paso.
// Solo tiene 3 categorías: sopa, especial (plato fuerte), ensalada.
// La sopa y la ensalada se comparten con el corriente (no se duplican
// en el menú del día — son los mismos items publicados por la cocinera).
//
// Flujo:
//   1) Sopa: pick + reemplazo si no quiere
//   2) Especial: pick (obligatorio)
//   3) Ensalada: quitable, pre-seleccionada
//   4) Note (opcional)
//   5) Summary → Agregar al pedido
//
// Props:
//   resolvedMenu → { soup: [{id,name}], especial: [...], salad: [...] }
//   especialItems → items del especial publicados (subset de resolvedMenu.especial)
//   price        → priceLlevar del especial (precio único, cliente solo "llevar")
//   onCancel
//   onAdd(payload) → { kind: 'especial', selections, replacements, note, price }
// ──────────────────────────────────────────────────────────────────
export default function PublicSpecialWizard({ resolvedMenu, especialItems, price, onCancel, onAdd }) {
  // Estado del almuerzo
  const [selections, setSelections] = useState(() => {
    // Pre-seleccionar ensalada con la primera del día
    const out = {}
    const saladOpts = resolvedMenu.salad || []
    if (saladOpts.length > 0) {
      out.salad = { id: saladOpts[0].id, name: saladOpts[0].name }
    }
    return out
  })
  const [replacements, setReplacements] = useState({})
  const [note, setNote] = useState('')

  // Steps:
  //   'soup' → 'soup-replace'? → 'especial' → 'salad-step' → 'note' → 'summary'
  const [step, setStep] = useState('soup')

  // Bloquear scroll del body
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

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

  function handleAdd() {
    // Las selecciones del especial: soup, especial, salad
    onAdd({
      selections: {
        soup:     selections.soup || null,
        especial: selections.especial || null,
        salad:    selections.salad || null,
      },
      replacements,
      note: note.trim(),
      price,
    })
  }

  // ─── Navegación ──────────────────────────────────────────────────
  const TOTAL_STEPS = 5 // sopa, especial, ensalada, nota, resumen
  const stepIndex = useMemo(() => {
    if (step.startsWith('soup')) return 0
    if (step === 'especial') return 1
    if (step === 'salad-step') return 2
    if (step === 'note') return 3
    if (step === 'summary') return 4
    return 0
  }, [step])

  function goBack() {
    switch (step) {
      case 'soup':         onCancel(); break
      case 'soup-replace': setStep('soup'); break
      case 'especial':     setStep(selections.soup ? 'soup' : 'soup-replace'); break
      case 'salad-step':   setStep('especial'); break
      case 'note':         setStep('salad-step'); break
      case 'summary':      setStep('note'); break
    }
  }

  // ─── Render ──────────────────────────────────────────────────────
  const soupOpts = resolvedMenu.soup || []
  const especialOpts = especialItems || []
  const saladOpts = resolvedMenu.salad || []

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 95,
      background: T.neutral[50],
      display: 'flex', flexDirection: 'column',
      paddingTop: 'env(safe-area-inset-top, 0px)',
      animation: 'pswFadeIn 0.18s ease',
    }}>
      <WizardHeader
        stepIndex={stepIndex}
        total={TOTAL_STEPS}
        price={price}
        onBack={goBack}
        canCancel={step === 'soup'}
      />

      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ maxWidth: 540, margin: '0 auto', padding: '20px 18px 24px' }}>
          {step === 'soup' && (
            soupOpts.length === 0 ? (
              // No hay sopas hoy: saltar directo al especial
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
                title="Elige tu sopa"
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
                    No quiero sopa
                  </button>
                )}
              />
            )
          )}
          {step === 'soup-replace' && (
            <ReplaceStep
              emoji="🥣"
              title="¿Qué deseas en vez de la sopa?"
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
                  Hoy no hay plato especial publicado. Habla con la cocinera.
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
                onNo={null}  // El especial es obligatorio si lo está pidiendo
                hideNoButton
              />
            ) : (
              <PickStep
                emoji="⭐"
                title="Elige tu especial"
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
              onContinue={() => setStep('summary')}
            />
          )}

          {step === 'summary' && (
            <SummaryStep
              selections={selections}
              replacements={replacements}
              note={note}
              price={price}
              onConfirm={handleAdd}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Header ──────────────────────────────────────────────────────
function WizardHeader({ stepIndex, total, price, onBack, canCancel }) {
  const pct = ((stepIndex + 1) / total) * 100
  return (
    <div style={{
      padding: '12px 16px 10px',
      background: '#fff',
      borderBottom: `1px solid ${T.neutral[100]}`,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10,
      }}>
        <button
          onClick={onBack}
          aria-label={canCancel ? 'Cerrar' : 'Atrás'}
          style={{
            width: 38, height: 38, borderRadius: 999,
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
            fontSize: 11, fontWeight: 800, color: T.warn,
            letterSpacing: 0.5, textTransform: 'uppercase',
          }}>
            ⭐ Almuerzo Especial · Paso {stepIndex + 1} de {total}
          </div>
          <div style={{
            fontSize: 14, fontWeight: 800, color: T.neutral[900],
            letterSpacing: -0.2,
          }}>
            Armando tu especial · {fmtCOP(price)}
          </div>
        </div>
      </div>
      <div style={{
        height: 6, borderRadius: 999, background: T.neutral[100],
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

// ─── Step: una opción ÚNICA del día (sopa/especial) ──────────────
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
        <BigChoice label="Sí, quiero" icon="✓" color={T.ok} onClick={onYes} />
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
        width: '100%', padding: '20px 18px', borderRadius: 18,
        background: '#fff', color: T.neutral[900],
        border: `2px solid ${T.neutral[200]}`,
        cursor: 'pointer', fontFamily: 'inherit',
        fontSize: 17, fontWeight: 800, letterSpacing: -0.2,
        display: 'flex', alignItems: 'center', gap: 14,
        boxShadow: '0 3px 12px rgba(0,0,0,0.04)',
      }}
    >
      <div style={{
        width: 38, height: 38, borderRadius: 999, flexShrink: 0,
        background: `${color}22`, color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 18, fontWeight: 900,
      }}>
        {icon}
      </div>
      {label}
    </button>
  )
}

// ─── Step: elegir entre múltiples opciones ──────────────────────
function PickStep({ emoji, title, subtitle, options, selected, onPick, ctaBelow }) {
  return (
    <div>
      <StepHero emoji={emoji} title={title} subtitle={subtitle} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
        {options.map(opt => {
          const active = selected?.id === opt.id
          return (
            <button
              key={opt.id}
              onClick={() => onPick(opt)}
              style={{
                width: '100%', padding: '16px 18px', borderRadius: 14,
                background: active ? T.warn : '#fff',
                color: active ? '#fff' : T.neutral[900],
                border: `1.5px solid ${active ? T.warn : T.neutral[200]}`,
                cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                fontSize: 15.5, fontWeight: 700, letterSpacing: -0.1,
                display: 'flex', alignItems: 'center', gap: 12,
                boxShadow: active ? `0 4px 14px ${T.warn}55` : '0 2px 6px rgba(0,0,0,0.03)',
              }}
            >
              <div style={{
                width: 26, height: 26, borderRadius: 999, flexShrink: 0,
                background: active ? '#fff' : 'transparent',
                border: `2px solid ${active ? '#fff' : T.neutral[300]}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {active && (
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                    <path d="M2 7 L5 10 L11 3" stroke={T.warn} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </div>
              <span style={{ flex: 1, minWidth: 0 }}>{opt.name}</span>
            </button>
          )
        })}
      </div>
      {ctaBelow && <div style={{ marginTop: 16 }}>{ctaBelow}</div>}
    </div>
  )
}

// ─── Step: reemplazo cuando dijo no a sopa ──────────────────────
function ReplaceStep({ emoji, title, options, selected, onPick }) {
  return (
    <div>
      <StepHero
        emoji={emoji}
        title={title}
        subtitle="Algo extra de cortesía, sin costo adicional."
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
        {options.map(opt => {
          const active = selected === opt.key
          return (
            <button
              key={opt.key}
              onClick={() => onPick(opt.key)}
              style={{
                width: '100%', padding: '14px 16px', borderRadius: 14,
                background: active ? T.warn : '#fff',
                color: active ? '#fff' : T.neutral[900],
                border: `1.5px solid ${active ? T.warn : T.neutral[200]}`,
                cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                fontSize: 15.5, fontWeight: 700, letterSpacing: -0.1,
                display: 'flex', alignItems: 'center', gap: 12,
                boxShadow: active ? `0 4px 14px ${T.warn}55` : '0 2px 6px rgba(0,0,0,0.03)',
              }}
            >
              <span style={{ fontSize: 22, lineHeight: 1, flexShrink: 0 }}>
                {opt.emoji}
              </span>
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

// ─── Step: Ensalada (1 sola opción del día, quitable) ──────────
function SaladStep({ options, selected, onChange, onContinue }) {
  const hasOptions = options.length > 0
  const isActive = !!selected
  if (!hasOptions) {
    // No hay ensalada hoy — saltar
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
        subtitle="Ya la pre-seleccionamos. Quítala si no la quieres."
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

// ─── Step: Observaciones ────────────────────────────────────────
function NoteStep({ note, onChange, onContinue }) {
  const CHIPS = [
    'Sin sal', 'Sin cebolla', 'Sin tomate',
    'Bien caliente', 'Aparte',
  ]
  return (
    <div>
      <StepHero
        emoji="📝"
        title="¿Algo más?"
        subtitle="Para la cocina sobre TU almuerzo. Lo que no pongas acá no se tiene en cuenta 😉"
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
          placeholder="Escribe libremente si quieres…"
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
        {note.trim() ? 'Continuar →' : 'Saltar, no tengo notas →'}
      </button>
    </div>
  )
}

// ─── Step: Resumen + agregar al pedido ──────────────────────────
function SummaryStep({ selections, replacements, note, price, onConfirm }) {
  const rows = [
    { id: 'soup',     label: 'Sopa',     emoji: '🥣', val: selections.soup,     rep: replacements.soup },
    { id: 'especial', label: 'Especial', emoji: '⭐', val: selections.especial, rep: null },
    { id: 'salad',    label: 'Ensalada', emoji: '🥗', val: selections.salad,    rep: null },
  ]
  return (
    <div>
      <StepHero
        emoji="✨"
        title="Revisemos tu especial"
        subtitle="Si todo está bien, agrégalo al pedido."
      />

      <div style={{
        marginTop: 16, borderRadius: 18, background: '#fff',
        border: `1.5px solid #F4E0BC`,
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '12px 16px',
          background: '#FFF7E6',
          borderBottom: `1px solid #F4E0BC`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div style={{
            fontSize: 11.5, fontWeight: 800, color: T.warn,
            letterSpacing: 0.5, textTransform: 'uppercase',
          }}>
            ⭐ Almuerzo Especial
          </div>
          <div style={{
            fontSize: 17, fontWeight: 900, color: T.neutral[900],
            fontVariantNumeric: 'tabular-nums', letterSpacing: -0.3,
          }}>
            {fmtCOP(price)}
          </div>
        </div>
        <div style={{ padding: '6px 16px 12px' }}>
          {rows.map(row => {
            const val = row.val
            const rep = row.rep
            const repLabel = REPLACEMENT_LABELS[rep]
            const isSinSoup = row.id === 'soup' && !val && !repLabel
            const isSinSalad = row.id === 'salad' && !val
            const hasReplacement = row.id === 'soup' && !val && repLabel
            const shouldShow = val || isSinSoup || isSinSalad || hasReplacement
            if (!shouldShow) return null
            return (
              <div key={row.id} style={{
                padding: '8px 0', display: 'flex', gap: 12, alignItems: 'flex-start',
                borderBottom: `0.5px solid ${T.neutral[100]}`,
              }}>
                <span style={{ fontSize: 16, flexShrink: 0, lineHeight: 1.3 }}>{row.emoji}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 10.5, fontWeight: 800, color: T.neutral[500],
                    letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 2,
                  }}>
                    {row.label}
                  </div>
                  <div style={{
                    fontSize: 13.5, fontWeight: 700, lineHeight: 1.4,
                    color: (isSinSoup || isSinSalad) ? T.bad : T.neutral[900],
                  }}>
                    {val ? val.name : hasReplacement ? (
                      <>
                        <span style={{ color: T.bad, fontWeight: 800 }}>Sin sopa</span>
                        {' '}
                        <span style={{ color: T.warn }}>
                          → + {repLabel}
                        </span>
                      </>
                    ) : (
                      `SIN ${row.label.toUpperCase()}`
                    )}
                  </div>
                </div>
              </div>
            )
          })}
          {note.trim() && (
            <div style={{
              marginTop: 10, padding: '10px 12px', borderRadius: 10,
              background: '#FFF7E6', border: `1px solid #F4E0BC`,
              fontSize: 12.5, color: '#7A5C00', fontWeight: 600,
              fontStyle: 'italic', lineHeight: 1.4,
            }}>
              📝 {note.trim()}
            </div>
          )}
        </div>
      </div>

      <button
        onClick={onConfirm}
        style={{
          width: '100%', padding: '18px', marginTop: 20, borderRadius: 16,
          background: T.warn, color: '#fff',
          border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 16, fontWeight: 800, letterSpacing: -0.2,
          boxShadow: `0 6px 18px ${T.warn}66`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}
      >
        ✓ Agregar al pedido
      </button>
    </div>
  )
}

// ─── Hero compartido ────────────────────────────────────────────
function StepHero({ emoji, title, subtitle }) {
  return (
    <div style={{ textAlign: 'center', padding: '12px 0 6px' }}>
      <div style={{ fontSize: 56, lineHeight: 1, marginBottom: 8 }}>{emoji}</div>
      <div style={{
        fontSize: 24, fontWeight: 900, color: T.neutral[900],
        letterSpacing: -0.5, lineHeight: 1.15, marginBottom: 6,
      }}>
        {title}
      </div>
      {subtitle && (
        <div style={{
          fontSize: 13.5, color: T.neutral[600], lineHeight: 1.5,
          maxWidth: 380, margin: '0 auto',
        }}>
          {subtitle}
        </div>
      )}
    </div>
  )
}

// Empty state que avanza automáticamente al montar
function EmptyAutoSkip({ onSkip }) {
  useEffect(() => {
    const t = setTimeout(onSkip, 100)
    return () => clearTimeout(t)
  }, [onSkip])
  return null
}

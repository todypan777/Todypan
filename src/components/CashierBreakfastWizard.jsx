import { useEffect, useMemo, useState } from 'react'
import { T } from '../tokens'
import { fmtCOP } from '../utils/format'
import {
  BREAKFAST_OPTIONS,
  watchBreakfastConfig,
  getBreakfastPrice,
} from '../breakfast'

// ──────────────────────────────────────────────────────────────────
// Wizard de DESAYUNO para la cajera.
//
// 4 pasos de selección (1 categoría por paso) → 1 paso de notas →
// 1 paso de destino con precios en vivo (mesa/llevar).
//
// El precio se calcula en TIEMPO REAL con getBreakfastPrice del
// motor híbrido (aditivo + override de combo). Si la combinación
// matchea un combo definido, el header muestra "⭐ COMBO X" con el
// precio reducido.
//
// Props:
//   currentCount        → cuántos items hay en la comanda
//   editMode            → edición de un kitchenOrder existente
//   initialSelections   → preselecciones para edit mode
//   initialNote         → nota actual para edit mode
//   initialDestination  → destino actual para edit mode
//   hidePrices          → modo mesera (oculta cualquier monto)
//   onCancel
//   onAdd(payload, { another })
//   onSaveEdit(payload)
// ──────────────────────────────────────────────────────────────────

export default function CashierBreakfastWizard({
  currentCount = 0,
  editMode = false,
  initialSelections = null,
  initialNote = '',
  initialDestination = null,
  hidePrices = false,
  onCancel,
  onAdd,
  onSaveEdit = () => {},
}) {
  const [config, setConfig] = useState(null)
  useEffect(() => watchBreakfastConfig(setConfig), [])

  // Estado de selecciones. Cada categoría: { id, name, isRanchero? } | null.
  const [selections, setSelections] = useState(() => {
    if (initialSelections) return { ...initialSelections }
    return {}
  })
  const [note, setNote] = useState(initialNote || '')

  // En edición arrancamos en 'destination' (con todo precargado y el destino
  // actual destacado). En modo normal: paso 1 = caldo.
  const [step, setStep] = useState(editMode ? 'destination' : 'caldo')

  function setCategory(catId, val) {
    setSelections(prev => ({ ...prev, [catId]: val }))
  }

  // Precio en vivo según selecciones (sin destino).
  const priceInfo = useMemo(
    () => config ? getBreakfastPrice(selections, config) : null,
    [selections, config]
  )

  function buildPayload(destination) {
    const isLlevar = destination === 'llevar'
    const price = isLlevar
      ? (priceInfo?.priceLlevar || 0)
      : (priceInfo?.priceMesa || 0)
    return {
      kind: 'breakfast',
      productId: '__breakfast__',
      productName: priceInfo?.isCombo ? priceInfo.comboName : 'Desayuno',
      destination,
      selections: {
        caldo:  selections.caldo  || null,
        huevos: selections.huevos || null,
        arroz:  selections.arroz  || null,
        bebida: selections.bebida || null,
      },
      price,
      note: note.trim() || null,
      comboId: priceInfo?.comboId || null,
      comboName: priceInfo?.comboName || null,
    }
  }

  function pickDestination(destination) {
    if (editMode) {
      onSaveEdit(buildPayload(destination))
      return
    }
    onAdd(buildPayload(destination), { another: false })
  }

  // ─── Navegación ────────────────────────────────────────────
  const TOTAL_STEPS = 6 // caldo, huevos, arroz, bebida, nota, destino
  const stepIndex = useMemo(() => {
    if (step === 'caldo')       return 0
    if (step === 'huevos')      return 1
    if (step === 'arroz')       return 2
    if (step === 'bebida')      return 3
    if (step === 'note')        return 4
    if (step === 'destination') return 5
    return 0
  }, [step])

  function goBack() {
    switch (step) {
      case 'caldo':       onCancel(); break
      case 'huevos':      setStep('caldo'); break
      case 'arroz':       setStep('huevos'); break
      case 'bebida':      setStep('arroz'); break
      case 'note':        setStep('bebida'); break
      case 'destination': editMode ? onCancel() : setStep('note'); break
    }
  }

  // ─── Render ────────────────────────────────────────────────
  if (!config) {
    return (
      <div onClick={onCancel} style={{
        position: 'fixed', inset: 0, zIndex: 95,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontSize: 14,
      }}>
        Cargando…
      </div>
    )
  }

  return (
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, zIndex: 95,
      background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      animation: 'cbwFadeBg 0.18s ease',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 540, height: '94vh',
        background: T.neutral[50], borderRadius: '20px 20px 0 0',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 -8px 32px rgba(0,0,0,0.25)',
        animation: 'cbwSlideUp 0.28s cubic-bezier(0.2,0.9,0.3,1.05)',
      }}>
        <WizardHeader
          priceInfo={priceInfo}
          currentCount={currentCount}
          stepIndex={stepIndex}
          total={TOTAL_STEPS}
          editMode={editMode}
          hidePrices={hidePrices}
          onBack={goBack}
          canCancel={step === 'caldo' || (editMode && step === 'destination')}
        />

        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{ padding: '16px 18px 20px' }}>
            {step === 'caldo' && (
              <CategoryStep
                emoji="🍲"
                title="¿Quiere caldo?"
                subtitle="Caldo de costilla o de pescado"
                options={BREAKFAST_OPTIONS.caldo}
                selected={selections.caldo}
                onPick={(opt) => {
                  setCategory('caldo', opt ? { id: opt.id, name: opt.name } : null)
                  setTimeout(() => setStep('huevos'), 180)
                }}
                noOptionLabel="Sin caldo"
              />
            )}

            {step === 'huevos' && (
              <CategoryStep
                emoji="🥚"
                title="¿Quiere huevos?"
                subtitle="Elige cómo los prefiere"
                options={BREAKFAST_OPTIONS.huevos}
                selected={selections.huevos}
                onPick={(opt) => {
                  setCategory('huevos', opt
                    ? { id: opt.id, name: opt.name, isRanchero: !!opt.isRanchero }
                    : null)
                  setTimeout(() => setStep('arroz'), 180)
                }}
                noOptionLabel="Sin huevos"
              />
            )}

            {step === 'arroz' && (
              <YesNoStep
                emoji="🍚"
                title="¿Lleva arroz con pan?"
                yesLabel="Sí, con arroz y pan"
                noLabel="No quiere"
                option={BREAKFAST_OPTIONS.arroz[0]}
                selected={selections.arroz}
                onPick={(opt) => {
                  setCategory('arroz', opt ? { id: opt.id, name: opt.name } : null)
                  setTimeout(() => setStep('bebida'), 180)
                }}
              />
            )}

            {step === 'bebida' && (
              <CategoryStep
                emoji="☕"
                title="¿Lleva bebida caliente?"
                subtitle="Café o chocolate"
                options={BREAKFAST_OPTIONS.bebida}
                selected={selections.bebida}
                onPick={(opt) => {
                  setCategory('bebida', opt ? { id: opt.id, name: opt.name } : null)
                  setTimeout(() => setStep('note'), 180)
                }}
                noOptionLabel="Sin bebida"
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
                priceInfo={priceInfo}
                editMode={editMode}
                initialDestination={initialDestination}
                hidePrices={hidePrices}
                onPick={pickDestination}
              />
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes cbwFadeBg {
          from { background: rgba(0,0,0,0); }
          to   { background: rgba(0,0,0,0.55); }
        }
        @keyframes cbwSlideUp {
          from { transform: translateY(8%); opacity: 0; }
          to   { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

// ─── Header ───────────────────────────────────────────────────────
function WizardHeader({ priceInfo, currentCount, stepIndex, total, editMode, hidePrices, onBack, canCancel }) {
  const pct = ((stepIndex + 1) / total) * 100
  const priceMesa = Number(priceInfo?.priceMesa || 0)
  const priceLlevar = Number(priceInfo?.priceLlevar || 0)
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
            <span>☕ Desayuno</span>
            {priceInfo?.isCombo && (
              <span style={{
                fontSize: 10, fontWeight: 800, color: T.warn,
                background: '#FFF7E6', padding: '2px 7px', borderRadius: 999,
                letterSpacing: 0.4, textTransform: 'uppercase',
                border: '1px solid #F4E0BC',
              }}>
                ⭐ {priceInfo.comboName}
              </span>
            )}
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
            {!hidePrices && priceMesa > 0 && (
              <>Mesa {fmtCOP(priceMesa)} · Llevar {fmtCOP(priceLlevar)}{' · '}</>
            )}
            <span style={{ fontWeight: 700 }}>Paso {stepIndex + 1}/{total}</span>
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

// ─── Step: elegir entre N opciones + "Sin X" ──────────────────────
// `selected` puede valer:
//   - undefined → cliente no visitó este paso aún (no se destaca nada)
//   - null      → cliente eligió EXPLÍCITAMENTE "Sin X" (botón gris destacado)
//   - { id, name } → cliente eligió una opción (botón cobre destacado)
function CategoryStep({ emoji, title, subtitle, options, selected, onPick, noOptionLabel }) {
  // Distinguir null de undefined permite que el botón "Sin X" se vea como
  // activo cuando la cajera vuelve atrás a revisar.
  const sinSelected = selected === null
  return (
    <div>
      <StepHero emoji={emoji} title={title} subtitle={subtitle} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
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
                    <path d="M2 7 L5 10 L11 3" stroke={T.warn} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </div>
              <span style={{ flex: 1, minWidth: 0 }}>{opt.name}</span>
            </button>
          )
        })}
        {/* Botón "Sin X" / "No quiere" — destacado en gris si ya se eligió */}
        <button
          onClick={() => onPick(null)}
          style={{
            width: '100%', padding: '14px', borderRadius: 14,
            background: sinSelected ? T.neutral[700] : 'transparent',
            color: sinSelected ? '#fff' : T.neutral[600],
            border: `1.5px solid ${sinSelected ? T.neutral[700] : T.neutral[200]}`,
            cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 14, fontWeight: 700, letterSpacing: -0.1,
            marginTop: 4,
            boxShadow: sinSelected ? `0 4px 14px ${T.neutral[700]}33` : 'none',
            transition: 'background 0.15s, border-color 0.15s, transform 0.1s ease',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          {sinSelected && (
            <svg width="14" height="14" viewBox="0 0 13 13" fill="none">
              <path d="M2 7 L5 10 L11 3" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
          {noOptionLabel || 'No quiere'}
        </button>
      </div>
    </div>
  )
}

// ─── Step: Sí / No con UNA sola opción ────────────────────────────
// `selected` mismo contrato: undefined no visitado, null no quiere, objeto sí.
function YesNoStep({ emoji, title, yesLabel, noLabel, option, selected, onPick }) {
  const yesActive = selected && selected.id === option?.id
  const noActive = selected === null
  return (
    <div>
      <StepHero emoji={emoji} title={title} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
        <BigChoice
          label={yesLabel}
          icon="✓"
          color={T.ok}
          active={yesActive}
          onClick={() => onPick(option)}
        />
        <BigChoice
          label={noLabel}
          icon="✕"
          color={T.neutral[500]}
          active={noActive}
          onClick={() => onPick(null)}
        />
      </div>
    </div>
  )
}

function BigChoice({ label, icon, color, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', padding: '18px', borderRadius: 16,
        background: active ? color : '#fff',
        color: active ? '#fff' : T.neutral[900],
        border: `2px solid ${active ? color : T.neutral[200]}`,
        cursor: 'pointer', fontFamily: 'inherit',
        fontSize: 16, fontWeight: 800, letterSpacing: -0.2,
        display: 'flex', alignItems: 'center', gap: 12,
        boxShadow: active ? `0 4px 14px ${color}55` : '0 3px 12px rgba(0,0,0,0.04)',
        transition: 'transform 0.1s ease, background 0.15s, border-color 0.15s',
      }}
      onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.98)')}
      onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
      onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
    >
      <div style={{
        width: 34, height: 34, borderRadius: 999, flexShrink: 0,
        background: active ? '#fff' : `${color}22`,
        color: active ? color : color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 16, fontWeight: 900,
      }}>
        {icon}
      </div>
      {label}
    </button>
  )
}

// ─── Step: Observaciones (chips de desayuno) ──────────────────────
function NoteStep({ note, onChange, onContinue }) {
  const CHIPS = [
    'Sin sal', 'Bien caliente', 'Huevos blandos', 'Huevos bien cocidos',
    'Sin cebolla', 'Sin tomate', 'Aparte',
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

// ─── Step final: Mesa o Llevar con precio en vivo ─────────────────
function DestinationStep({ priceInfo, editMode, initialDestination, hidePrices, onPick }) {
  const priceMesa = Number(priceInfo?.priceMesa || 0)
  const priceLlevar = Number(priceInfo?.priceLlevar || 0)
  const isCombo = !!priceInfo?.isCombo
  const hasAnything = !!priceInfo?.hasAnything

  // Guardia: si el cliente no eligió NADA (todas las categorías en null),
  // bloqueamos el envío y le decimos a la cajera que vuelva a armar.
  // Evita crear órdenes vacías con precio $0 en cocina.
  if (!hasAnything) {
    return (
      <div>
        <StepHero
          emoji="⚠️"
          title="Desayuno vacío"
          subtitle="El cliente no eligió nada todavía. Vuelve atrás y agrega al menos un componente."
        />
        <div style={{
          marginTop: 18, padding: '14px 16px', borderRadius: 14,
          background: '#FBE9E5', border: `1.5px solid #F0C8BE`,
          fontSize: 13.5, color: '#7A3325', lineHeight: 1.5, textAlign: 'center',
        }}>
          No podemos enviar un desayuno sin componentes.<br/>
          Usa la flecha de atrás para corregir.
        </div>
      </div>
    )
  }

  return (
    <div>
      <StepHero
        emoji="🍽️"
        title="¿Mesa o llevar?"
        subtitle={editMode ? 'Toca para guardar los cambios.' : 'Toca para enviar este desayuno.'}
      />

      {/* Si es combo, lo destacamos para que la cajera vea el descuento aplicado */}
      {isCombo && !hidePrices && (
        <div style={{
          marginTop: 14, padding: '12px 14px', borderRadius: 12,
          background: '#FFF7E6', border: `1.5px solid #F4E0BC`,
          textAlign: 'center',
        }}>
          <div style={{
            fontSize: 10.5, fontWeight: 800, color: T.warn,
            letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 4,
          }}>
            ⭐ Combo aplicado
          </div>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: T.neutral[900] }}>
            {priceInfo.comboName}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 18 }}>
        <DestinationBigButton
          icon="🍽️"
          title="Para mesa"
          subtitle="Cliente come en el local"
          price={priceMesa}
          hidePrices={hidePrices}
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
          price={priceLlevar}
          hidePrices={hidePrices}
          accentBg="#FFF7E6"
          accentBorder="#F0D699"
          accentColor="#7A5C00"
          highlight={initialDestination === 'llevar'}
          onClick={() => onPick('llevar')}
        />
      </div>

      {/* Mostrar el desglose para confirmar visualmente */}
      {!hidePrices && priceInfo?.breakdown?.length > 0 && (
        <div style={{
          marginTop: 18, padding: '12px 14px', borderRadius: 12,
          background: '#fff', border: `1px solid ${T.neutral[100]}`,
        }}>
          <div style={{
            fontSize: 10.5, fontWeight: 800, color: T.neutral[500],
            letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8,
          }}>
            Desglose
          </div>
          {priceInfo.breakdown.map((row, i) => (
            <div key={i} style={{
              display: 'flex', justifyContent: 'space-between',
              padding: '4px 0', fontSize: 12.5, color: T.neutral[800],
            }}>
              <span>{row.label}</span>
              <span style={{
                fontVariantNumeric: 'tabular-nums', fontWeight: 700,
                color: row.price < 0 ? T.ok : T.neutral[800],
              }}>
                {row.price < 0 ? '−' : ''}{fmtCOP(Math.abs(row.price))}
              </span>
            </div>
          ))}
        </div>
      )}

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

function DestinationBigButton({ icon, title, subtitle, price, hidePrices, accentBg, accentBorder, accentColor, highlight, onClick }) {
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
      {!hidePrices && (
        <div style={{
          fontSize: 18, fontWeight: 900, color: accentColor,
          fontVariantNumeric: 'tabular-nums', flexShrink: 0,
        }}>
          {fmtCOP(price)}
        </div>
      )}
    </button>
  )
}

// ─── Hero compartido ──────────────────────────────────────────────
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

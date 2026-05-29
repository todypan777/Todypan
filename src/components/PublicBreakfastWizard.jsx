import { useEffect, useMemo, useState } from 'react'
import { T } from '../tokens'
import { fmtCOP } from '../utils/format'
import { BREAKFAST_OPTIONS, getBreakfastPrice } from '../breakfast'

// ──────────────────────────────────────────────────────────────────
// Wizard de DESAYUNO para el cliente público (/menu).
//
// Mismo shape de pasos que CashierBreakfastWizard pero adaptado al
// cliente final: el precio mostrado es el de LLEVAR (la página /menu
// siempre es para llevar).
//
// onAdd(payload) — payload listo para customerOrders.cart:
//   { kind: 'breakfast', selections, note, price, comboId, comboName }
// ──────────────────────────────────────────────────────────────────

export default function PublicBreakfastWizard({
  config,
  onCancel,
  onAdd,
}) {
  const [selections, setSelections] = useState({})
  const [note, setNote] = useState('')
  const [step, setStep] = useState('caldo')

  function setCategory(catId, val) {
    setSelections(prev => ({ ...prev, [catId]: val }))
  }

  const priceInfo = useMemo(
    () => getBreakfastPrice(selections, config),
    [selections, config]
  )

  function handleConfirm() {
    if (!priceInfo?.hasAnything) return
    onAdd({
      kind: 'breakfast',
      selections: {
        caldo:  selections.caldo  || null,
        huevos: selections.huevos || null,
        arroz:  selections.arroz  || null,
        bebida: selections.bebida || null,
      },
      note: note.trim() || '',
      price: priceInfo.priceLlevar,
      comboId: priceInfo.comboId,
      comboName: priceInfo.comboName,
    })
  }

  const TOTAL_STEPS = 5 // caldo, huevos, arroz, bebida, resumen
  const stepIndex = useMemo(() => {
    if (step === 'caldo')   return 0
    if (step === 'huevos')  return 1
    if (step === 'arroz')   return 2
    if (step === 'bebida')  return 3
    if (step === 'resumen') return 4
    return 0
  }, [step])

  function goBack() {
    switch (step) {
      case 'caldo':   onCancel(); break
      case 'huevos':  setStep('caldo'); break
      case 'arroz':   setStep('huevos'); break
      case 'bebida':  setStep('arroz'); break
      case 'resumen': setStep('bebida'); break
    }
  }

  return (
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, zIndex: 95,
      background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      animation: 'pbwFadeBg 0.18s ease',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 540, height: '94vh',
        background: T.neutral[50], borderRadius: '20px 20px 0 0',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 -8px 32px rgba(0,0,0,0.25)',
        animation: 'pbwSlideUp 0.28s cubic-bezier(0.2,0.9,0.3,1.05)',
      }}>
        <Header
          priceInfo={priceInfo}
          stepIndex={stepIndex}
          total={TOTAL_STEPS}
          onBack={goBack}
          canCancel={step === 'caldo'}
        />

        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{ padding: '16px 18px 20px' }}>
            {step === 'caldo' && (
              <CategoryStep
                emoji="🍲"
                title="¿Quieres caldo?"
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
                title="¿Y los huevos?"
                subtitle="Elige cómo los prefieres"
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
                noLabel="No, gracias"
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
                title="¿Bebida caliente?"
                subtitle="Café o chocolate"
                options={BREAKFAST_OPTIONS.bebida}
                selected={selections.bebida}
                onPick={(opt) => {
                  setCategory('bebida', opt ? { id: opt.id, name: opt.name } : null)
                  setTimeout(() => setStep('resumen'), 180)
                }}
                noOptionLabel="Sin bebida"
              />
            )}
            {step === 'resumen' && (
              <SummaryStep
                selections={selections}
                priceInfo={priceInfo}
                note={note}
                onChangeNote={setNote}
                onConfirm={handleConfirm}
              />
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pbwFadeBg {
          from { background: rgba(0,0,0,0); }
          to   { background: rgba(0,0,0,0.55); }
        }
        @keyframes pbwSlideUp {
          from { transform: translateY(8%); opacity: 0; }
          to   { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

// ─── Header ──────────────────────────────────────────────────────
function Header({ priceInfo, stepIndex, total, onBack, canCancel }) {
  const pct = ((stepIndex + 1) / total) * 100
  const price = Number(priceInfo?.priceLlevar || 0)
  return (
    <div style={{
      padding: '12px 16px 10px',
      background: '#fff',
      borderBottom: `1px solid ${T.neutral[100]}`,
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
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
          </div>
          <div style={{
            fontSize: 11, color: T.neutral[500], marginTop: 1,
            fontVariantNumeric: 'tabular-nums',
          }}>
            {price > 0 && <>{fmtCOP(price)} para llevar{' · '}</>}
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

// ─── Step: elegir entre opciones + "Sin X" ──────────────────────
// `selected` puede valer:
//   - undefined → no visitado (no se destaca nada)
//   - null      → cliente eligió EXPLÍCITAMENTE "Sin X"
//   - { id, name } → eligió una opción
function CategoryStep({ emoji, title, subtitle, options, selected, onPick, noOptionLabel }) {
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
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          {sinSelected && (
            <svg width="14" height="14" viewBox="0 0 13 13" fill="none">
              <path d="M2 7 L5 10 L11 3" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
          {noOptionLabel || 'No quiero'}
        </button>
      </div>
    </div>
  )
}

// ─── Step: Sí / No ───────────────────────────────────────────────
function YesNoStep({ emoji, title, yesLabel, noLabel, option, selected, onPick }) {
  const yesActive = selected && selected.id === option?.id
  const noActive = selected === null
  return (
    <div>
      <StepHero emoji={emoji} title={title} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
        <BigChoice label={yesLabel} icon="✓" color={T.ok} active={yesActive} onClick={() => onPick(option)} />
        <BigChoice label={noLabel} icon="✕" color={T.neutral[500]} active={noActive} onClick={() => onPick(null)} />
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
      }}
    >
      <div style={{
        width: 34, height: 34, borderRadius: 999, flexShrink: 0,
        background: active ? '#fff' : `${color}22`,
        color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 16, fontWeight: 900,
      }}>
        {icon}
      </div>
      {label}
    </button>
  )
}

// ─── Step final: Resumen + Notas + Confirmar ─────────────────────
function SummaryStep({ selections, priceInfo, note, onChangeNote, onConfirm }) {
  const rows = [
    { emoji: '🍲', label: 'Caldo',    val: selections.caldo?.name  || 'Sin caldo' },
    { emoji: '🥚', label: 'Huevos',   val: selections.huevos?.name || 'Sin huevos' },
    { emoji: '🍚', label: 'Arroz',    val: selections.arroz ? 'Con arroz y pan' : 'Sin arroz' },
    { emoji: '☕', label: 'Bebida',   val: selections.bebida?.name || 'Sin bebida' },
  ]
  const hasAnything = !!priceInfo?.hasAnything
  return (
    <div>
      <StepHero
        emoji="📋"
        title="Confirma tu desayuno"
        subtitle={hasAnything
          ? 'Revisa el resumen y agrega notas si quieres'
          : 'No elegiste nada. Vuelve atrás para armar tu desayuno.'}
      />

      <div style={{
        marginTop: 16, borderRadius: 16, background: '#fff',
        border: `1.5px solid #F4E0BC`, overflow: 'hidden',
      }}>
        {rows.map((row, i) => (
          <div key={row.label} style={{
            padding: '12px 14px',
            borderBottom: i === rows.length - 1 ? 'none' : '0.5px solid #F4E0BC',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ fontSize: 18, lineHeight: 1, width: 24, textAlign: 'center', flexShrink: 0 }}>
              {row.emoji}
            </span>
            <div style={{
              flex: 1, fontSize: 11.5, fontWeight: 800, color: T.neutral[500],
              letterSpacing: 0.4, textTransform: 'uppercase',
            }}>
              {row.label}
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.neutral[900] }}>
              {row.val}
            </div>
          </div>
        ))}
      </div>

      {priceInfo?.isCombo && (
        <div style={{
          marginTop: 14, padding: '10px 12px', borderRadius: 10,
          background: '#FFF7E6', border: `1px solid #F4E0BC`,
          fontSize: 12.5, color: T.warn, fontWeight: 700, textAlign: 'center',
        }}>
          ⭐ {priceInfo.comboName}: ahorras automáticamente con el combo
        </div>
      )}

      <textarea
        value={note}
        onChange={e => onChangeNote(e.target.value)}
        placeholder="Observaciones para cocina (opcional)…"
        rows={2}
        maxLength={200}
        style={{
          marginTop: 14, width: '100%',
          padding: '12px 14px', borderRadius: 12,
          border: `1.5px solid ${T.neutral[200]}`,
          fontSize: 14, fontFamily: 'inherit',
          background: '#fff', color: T.neutral[900],
          outline: 'none', resize: 'vertical', minHeight: 60,
          boxSizing: 'border-box',
        }}
      />

      <button
        onClick={onConfirm}
        disabled={!hasAnything}
        style={{
          width: '100%', padding: '18px', marginTop: 16, borderRadius: 14,
          background: hasAnything ? T.warn : T.neutral[200],
          color: hasAnything ? '#fff' : T.neutral[500],
          border: 'none',
          cursor: hasAnything ? 'pointer' : 'not-allowed',
          fontFamily: 'inherit', fontSize: 16, fontWeight: 800, letterSpacing: -0.2,
          boxShadow: hasAnything ? `0 4px 14px ${T.warn}55` : 'none',
        }}
      >
        {hasAnything
          ? `+ Agregar al pedido · ${fmtCOP(priceInfo.priceLlevar)}`
          : 'Elige al menos algo'}
      </button>
    </div>
  )
}

// ─── Hero ────────────────────────────────────────────────────────
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

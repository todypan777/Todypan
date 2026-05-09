import { useEffect, useState } from 'react'
import { T } from '../tokens'
import { fmtCOP } from '../utils/format'
import { watchDailyMenu } from '../menu'
import { useBogotaDate } from '../utils/useBogotaDate'

// ──────────────────────────────────────────────────────────────────
// Modal de "Almuerzo Especial".
// Sin categorías: solo descripción libre, destino, y precio definido por la
// cocinera al publicar el menú del día (priceMesa/priceLlevar).
//
// Si la cocinera no activó el especial hoy, muestra mensaje y NO permite agregar.
// ──────────────────────────────────────────────────────────────────
export default function SpecialLunchModal({ onCancel, onAdd, currentCount = 0 }) {
  const today = useBogotaDate()
  const [dailyMenu, setDailyMenu] = useState(null)
  const [description, setDescription] = useState('')
  // Step: 'compose' (descripción) → 'destination' (mesa/llevar).
  const [step, setStep] = useState('compose')
  const [pendingAnother, setPendingAnother] = useState(false)

  useEffect(() => watchDailyMenu(today, setDailyMenu), [today])

  const special = dailyMenu?.special
  const isActive = !!special?.active
  const priceMesa = isActive ? Number(special.priceMesa || 0) : 0
  const priceLlevar = isActive ? Number(special.priceLlevar || special.priceMesa || 0) : 0

  // Pre-llenar descripción con la del menú del día (la cocinera puede haber
  // puesto "bandeja paisa..."). La cajera puede editarla.
  useEffect(() => {
    if (special?.description && !description) {
      setDescription(special.description)
    }
  }, [special?.description]) // eslint-disable-line

  const canSubmit = isActive && priceMesa > 0

  function buildPayload(destination) {
    const isLlevar = destination === 'llevar'
    const price = isLlevar ? priceLlevar : priceMesa
    return {
      kind: 'special',
      productId: null,
      productName: 'Almuerzo Especial',
      destination,
      description: description.trim() || null,
      price,
    }
  }

  function proceedToDestination(another) {
    if (!canSubmit) return
    setPendingAnother(another)
    setStep('destination')
  }

  function pickDestination(destination) {
    onAdd(buildPayload(destination), { another: pendingAnother })
    if (pendingAnother) {
      setDescription(special?.description || '')
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
        width: '100%', maxWidth: 540,
        background: T.neutral[50], borderRadius: '20px 20px 0 0',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 -8px 32px rgba(0,0,0,0.25)',
        animation: 'lunchSlideUp 0.28s cubic-bezier(0.2,0.9,0.3,1.05)',
        maxHeight: '94vh',
      }}>
        {/* Header — back arrow en step destination, X en compose. */}
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
              {step === 'destination' ? '¿Para mesa o para llevar?' : '⭐ Almuerzo Especial'}
              {step === 'compose' && currentCount > 0 && (
                <span style={{
                  marginLeft: 8, fontSize: 11, fontWeight: 700, color: T.warn,
                  background: '#FFF7E6', padding: '2px 8px', borderRadius: 999,
                  verticalAlign: 'middle',
                }}>
                  {currentCount} en comanda
                </span>
              )}
            </div>
            <div style={{ fontSize: 12.5, color: T.neutral[500] }}>
              {!isActive
                ? 'No publicado para hoy'
                : step === 'destination'
                  ? 'Almuerzo Especial · selecciona dónde se sirve'
                  : `Mesa ${fmtCOP(priceMesa)} · Llevar ${fmtCOP(priceLlevar)}`}
            </div>
          </div>
        </div>

        {!isActive ? (
          <div style={{ padding: '36px 28px', textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>⭐</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.neutral[800], marginBottom: 6 }}>
              Hoy no hay especial publicado
            </div>
            <div style={{ fontSize: 13, color: T.neutral[500], lineHeight: 1.5, maxWidth: 320, margin: '0 auto' }}>
              La cocinera no ha activado el almuerzo especial de hoy.
              Pídele que lo active desde su pantalla.
            </div>
            <button onClick={onCancel} style={{
              marginTop: 22, padding: '12px 24px', borderRadius: 12,
              background: T.neutral[800], color: '#fff',
              border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 14, fontWeight: 700,
            }}>Cerrar</button>
          </div>
        ) : step === 'destination' ? (
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
        ) : (
          <>
            {/* Descripción */}
            <div style={{ padding: '14px 20px', flex: 1, overflowY: 'auto' }}>
              <div style={{
                fontSize: 11.5, fontWeight: 700, color: T.neutral[600],
                letterSpacing: 0.3, textTransform: 'uppercase', marginBottom: 6,
              }}>
                Qué incluye
              </div>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Ej: Bandeja paisa con aguacate y patacón"
                rows={4}
                style={{
                  width: '100%', padding: '12px 14px', borderRadius: 12,
                  border: `1.5px solid ${T.neutral[200]}`,
                  fontSize: 14, fontFamily: 'inherit',
                  background: '#fff', color: T.neutral[900],
                  outline: 'none', resize: 'vertical', minHeight: 80,
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Footer */}
            <div style={{
              padding: '14px 20px',
              background: '#fff', borderTop: `1px solid ${T.neutral[100]}`,
              paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 14px)',
              flexShrink: 0,
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 10 }}>
                <button
                  onClick={() => proceedToDestination(true)}
                  style={{
                    padding: '14px', borderRadius: 14,
                    background: '#fff', color: T.warn,
                    border: `1.5px solid ${T.warn}55`,
                    cursor: 'pointer', fontFamily: 'inherit',
                    fontSize: 13.5, fontWeight: 800,
                  }}
                >
                  + Otro almuerzo
                </button>
                <button
                  onClick={() => proceedToDestination(false)}
                  style={{
                    padding: '14px', borderRadius: 14,
                    background: T.warn, color: '#fff',
                    border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                    fontSize: 14.5, fontWeight: 800, letterSpacing: 0.3,
                    boxShadow: `0 4px 14px ${T.warn}55`,
                  }}
                >
                  Continuar →
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

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
        <div style={{ fontSize: 19, fontWeight: 900, color: accentColor, letterSpacing: -0.3, marginBottom: 2 }}>
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


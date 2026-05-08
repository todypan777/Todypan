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
  const [destination, setDestination] = useState('mesa')
  const [description, setDescription] = useState('')

  useEffect(() => watchDailyMenu(today, setDailyMenu), [today])

  const special = dailyMenu?.special
  const isActive = !!special?.active
  const isLlevar = destination === 'llevar'
  const price = isActive
    ? (isLlevar
        ? Number(special.priceLlevar || special.priceMesa || 0)
        : Number(special.priceMesa || 0))
    : 0

  // Pre-llenar descripción con la del menú del día (la cocinera puede haber
  // puesto "bandeja paisa..."). La cajera puede editarla.
  useEffect(() => {
    if (special?.description && !description) {
      setDescription(special.description)
    }
  }, [special?.description]) // eslint-disable-line

  const canSubmit = isActive && price > 0

  function buildPayload() {
    return {
      kind: 'special',
      productId: null,
      productName: 'Almuerzo Especial',
      destination,
      description: description.trim() || null,
      price,
    }
  }

  function handleAddAnother() {
    if (!canSubmit) return
    onAdd(buildPayload(), { another: true })
    setDescription(special?.description || '')
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
        width: '100%', maxWidth: 540,
        background: T.neutral[50], borderRadius: '20px 20px 0 0',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 -8px 32px rgba(0,0,0,0.25)',
        animation: 'lunchSlideUp 0.28s cubic-bezier(0.2,0.9,0.3,1.05)',
        maxHeight: '94vh',
      }}>
        {/* Header */}
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
              ⭐ Almuerzo Especial
              {currentCount > 0 && (
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
              {isActive ? `${fmtCOP(price)} · ${isLlevar ? '📦 Para llevar' : '🍽️ Para mesa'}` : 'No publicado para hoy'}
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
        ) : (
          <>
            {/* Switch destino */}
            <div style={{ padding: '14px 20px 0' }}>
              <div style={{
                display: 'flex', gap: 4, padding: 4, borderRadius: 14,
                background: T.neutral[100],
              }}>
                <DestPill active={destination === 'mesa'} onClick={() => setDestination('mesa')} icon="🍽️" label="Para mesa" />
                <DestPill active={destination === 'llevar'} onClick={() => setDestination('llevar')} icon="📦" label="Para llevar" />
              </div>
            </div>

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
                  onClick={handleAddAnother}
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
                  onClick={handleSendCommand}
                  style={{
                    padding: '14px', borderRadius: 14,
                    background: T.warn, color: '#fff',
                    border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                    fontSize: 14.5, fontWeight: 800, letterSpacing: 0.3,
                    boxShadow: `0 4px 14px ${T.warn}55`,
                  }}
                >
                  {currentCount > 0 ? 'Agregar y enviar' : 'Enviar comanda'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
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

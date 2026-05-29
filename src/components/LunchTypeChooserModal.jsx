import { useEffect } from 'react'
import { T } from '../tokens'
import { fmtCOP } from '../utils/format'

// ──────────────────────────────────────────────────────────────────
// Modal de selección de TIPO de pedido al "agregar almuerzo" en la
// cajera. Sustituye al producto "Almuerzo Especial" del catálogo y
// unifica el flujo: 1 sola entrada → 3 opciones claras.
//
// Botones:
//   1. Almuerzo corriente  (siempre que corriente.available)
//   2. Almuerzo especial   (solo si dailyMenu.special.active)
//   3. Adición             (solo si hay algún precio de adición > 0)
//
// Props:
//   corrienteAvailable, corrientePrice  → para mostrar precio
//   specialActive, specialDescription, specialPrice
//   addonAvailable
//   onCancel
//   onPickCorriente()   → abrir CashierLunchWizard
//   onPickSpecial()     → abrir CashierSpecialWizard
//   onPickAddon()       → abrir PublicAddonsModal
// ──────────────────────────────────────────────────────────────────
export default function LunchTypeChooserModal({
  corrienteAvailable, corrientePrice,
  specialActive, specialDescription, specialPrice,
  addonAvailable,
  breakfastAvailable = false, breakfastPrice = 0,
  hidePrices = false,
  onCancel,
  onPickCorriente,
  onPickSpecial,
  onPickAddon,
  onPickBreakfast,
}) {
  // Bloquear scroll del body mientras está abierto
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  return (
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, zIndex: 96,
      background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16,
      animation: 'ltcmFadeBg 0.18s ease',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 460,
        background: T.neutral[50], borderRadius: 22,
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 16px 48px rgba(0,0,0,0.28)',
        animation: 'ltcmPop 0.24s cubic-bezier(0.2,0.9,0.3,1.05)',
        overflow: 'hidden',
        maxHeight: '90vh',
      }}>
        {/* Header */}
        <div style={{
          padding: '18px 20px',
          background: '#fff', borderBottom: `1px solid ${T.neutral[100]}`,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <button
            onClick={onCancel}
            aria-label="Cerrar"
            style={{
              width: 38, height: 38, borderRadius: 999,
              background: T.neutral[100], border: 'none',
              cursor: 'pointer', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 3 L11 11 M11 3 L3 11" stroke={T.neutral[700]} strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 17, fontWeight: 900, color: T.neutral[900],
              letterSpacing: -0.3,
            }}>
              ¿Qué quiere agregar?
            </div>
            <div style={{ fontSize: 12.5, color: T.neutral[500], marginTop: 2 }}>
              Elige el tipo de pedido
            </div>
          </div>
        </div>

        {/* Botones */}
        <div style={{
          flex: 1, overflowY: 'auto',
          padding: '16px', display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          {breakfastAvailable && (
            <ChoiceButton
              emoji="☕"
              title="Desayuno"
              subtitle="Caldo + huevos + arroz + bebida · 4 pasos"
              priceLabel={hidePrices ? null : `Desde ${fmtCOP(breakfastPrice)}`}
              accentBg="#FFF7E6"
              accentBorder="#F4E0BC"
              accentColor={T.warn}
              onClick={onPickBreakfast}
            />
          )}
          {corrienteAvailable && (
            <ChoiceButton
              emoji="🍽️"
              title="Almuerzo corriente"
              subtitle="Arma el almuerzo del menú del día paso a paso"
              priceLabel={hidePrices ? null : `Desde ${fmtCOP(corrientePrice)}`}
              accentBg={T.copper[50]}
              accentBorder={T.copper[300]}
              accentColor={T.copper[700]}
              onClick={onPickCorriente}
            />
          )}
          {specialActive && (
            <ChoiceButton
              emoji="⭐"
              title="Almuerzo especial"
              subtitle={specialDescription || 'El especial publicado hoy'}
              priceLabel={hidePrices ? null : fmtCOP(specialPrice)}
              accentBg="#FFF7E6"
              accentBorder="#F4E0BC"
              accentColor="#7A5C00"
              onClick={onPickSpecial}
            />
          )}
          {addonAvailable && (
            <ChoiceButton
              emoji="➕"
              title="Adición"
              subtitle="Sopa, huevo o proteína extra · sin almuerzo completo"
              priceLabel={hidePrices ? null : 'Varía'}
              accentBg="#FFF7E6"
              accentBorder="#F4E0BC"
              accentColor={T.warn}
              onClick={onPickAddon}
            />
          )}

          {!corrienteAvailable && !specialActive && !addonAvailable && !breakfastAvailable && (
            <div style={{
              padding: '24px 18px', borderRadius: 16,
              background: '#fff', border: `1.5px dashed ${T.neutral[200]}`,
              textAlign: 'center', color: T.neutral[500],
              fontSize: 13.5, lineHeight: 1.5,
            }}>
              Hoy no hay nada del menú publicado por la cocinera.
            </div>
          )}
        </div>

        <style>{`
          @keyframes ltcmFadeBg {
            from { background: rgba(0,0,0,0); }
            to   { background: rgba(0,0,0,0.55); }
          }
          @keyframes ltcmPop {
            from { transform: scale(0.94); opacity: 0; }
            to   { transform: scale(1); opacity: 1; }
          }
        `}</style>
      </div>
    </div>
  )
}

function ChoiceButton({ emoji, title, subtitle, priceLabel, accentBg, accentBorder, accentColor, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', padding: '16px', borderRadius: 16,
        background: '#fff',
        border: `1.5px solid ${accentBorder}`,
        cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
        display: 'flex', alignItems: 'center', gap: 14,
        boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
        transition: 'transform 0.1s ease, border-color 0.18s',
      }}
      onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.985)')}
      onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
      onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
    >
      <div style={{
        width: 52, height: 52, borderRadius: 14, flexShrink: 0,
        background: accentBg,
        border: `1px solid ${accentBorder}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 28, lineHeight: 1,
      }}>
        {emoji}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 15.5, fontWeight: 900, color: T.neutral[900],
          letterSpacing: -0.2, lineHeight: 1.2,
        }}>
          {title}
        </div>
        <div style={{
          fontSize: 12, color: T.neutral[600],
          marginTop: 3, lineHeight: 1.4,
        }}>
          {subtitle}
        </div>
      </div>
      {priceLabel != null && (
        <div style={{
          fontSize: 13, fontWeight: 800, color: accentColor,
          fontVariantNumeric: 'tabular-nums', letterSpacing: -0.2,
          flexShrink: 0, padding: '4px 10px', borderRadius: 999,
          background: accentBg, border: `1px solid ${accentBorder}`,
        }}>
          {priceLabel}
        </div>
      )}
    </button>
  )
}

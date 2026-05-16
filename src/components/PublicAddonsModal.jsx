import { useEffect, useState } from 'react'
import { T } from '../tokens'
import { fmtCOP } from '../utils/format'

// ──────────────────────────────────────────────────────────────────
// Modal para que el cliente agregue ADICIONES (sopa, huevo, proteína
// extra) al pedido. Se abre desde el botón "+ Agregar adición" en la
// landing del menú público.
//
// Cada adición se agrega como item separado al carrito con:
//   { kind: 'addon', addonType, quantity, unitPrice, price,
//     proteinId?, proteinName? }
//
// Si la cocinera puso precio = 0 a un tipo, NO se muestra esa tarjeta.
//
// Props:
//   prices: { soup, egg, protein }  → precios unitarios
//   proteinOptions: [{id, name}]    → solo se usa si la cocinera publicó
//                                     proteínas del día (cliente elige cuál)
//   onCancel
//   onAdd(addonItem)
// ──────────────────────────────────────────────────────────────────
export default function PublicAddonsModal({ prices, proteinOptions, onCancel, onAdd }) {
  // Bloquear scroll del body mientras está abierto
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  const showSoup    = prices.soup > 0
  const showEgg     = prices.egg > 0
  const showProtein = prices.protein > 0 && (proteinOptions?.length || 0) > 0
  const anyAvailable = showSoup || showEgg || showProtein

  // Estado del picker activo (qué tarjeta está expandida con su selector
  // de cantidad). null = ninguna activa, modo "elige tipo".
  // shape: { type: 'soup'|'egg'|'protein', qty, proteinIdx? }
  const [active, setActive] = useState(null)

  function startAddon(type) {
    if (type === 'protein') {
      setActive({ type: 'protein', qty: 1, proteinIdx: 0 })
    } else {
      setActive({ type, qty: 1 })
    }
  }

  function confirmAddon() {
    if (!active) return
    const qty = Math.max(1, Math.min(99, Math.floor(active.qty || 1)))
    if (active.type === 'soup') {
      onAdd({
        kind: 'addon', addonType: 'soup',
        label: 'Sopa adicional',
        quantity: qty,
        unitPrice: prices.soup,
        price: prices.soup * qty,
      })
    } else if (active.type === 'egg') {
      onAdd({
        kind: 'addon', addonType: 'egg',
        label: 'Huevo adicional',
        quantity: qty,
        unitPrice: prices.egg,
        price: prices.egg * qty,
      })
    } else if (active.type === 'protein') {
      const opt = proteinOptions[active.proteinIdx] || proteinOptions[0]
      onAdd({
        kind: 'addon', addonType: 'protein',
        label: `Proteína adicional: ${opt.name}`,
        quantity: qty,
        unitPrice: prices.protein,
        price: prices.protein * qty,
        proteinId: opt.id,
        proteinName: opt.name,
      })
    }
  }

  return (
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16,
      animation: 'pmFadeBg 0.2s ease',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 540, maxHeight: '90vh',
        background: T.neutral[50], borderRadius: 24,
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 16px 48px rgba(0,0,0,0.32)',
        animation: 'pmPop 0.28s cubic-bezier(0.2,0.9,0.3,1.05)',
        overflow: 'hidden',
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
              fontSize: 18, fontWeight: 900, color: T.neutral[900],
              letterSpacing: -0.3,
            }}>
              Agregar adición
            </div>
            <div style={{ fontSize: 12.5, color: T.neutral[500], marginTop: 2 }}>
              {active ? 'Elige cuántos quieres' : 'Pide solo lo que quieras, sin almuerzo completo'}
            </div>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>
          {!anyAvailable && (
            <div style={{
              padding: '24px 18px', borderRadius: 16,
              background: '#fff', border: `1.5px dashed ${T.neutral[200]}`,
              textAlign: 'center', color: T.neutral[500],
              fontSize: 13.5, lineHeight: 1.5,
            }}>
              Hoy no hay adiciones disponibles. La cocinera no ha puesto los precios todavía.
            </div>
          )}

          {!active && anyAvailable && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {showSoup && (
                <AddonChoiceCard
                  emoji="🥣"
                  title="Sopa adicional"
                  subtitle="La sopa del día"
                  price={prices.soup}
                  onClick={() => startAddon('soup')}
                />
              )}
              {showEgg && (
                <AddonChoiceCard
                  emoji="🍳"
                  title="Huevo adicional"
                  subtitle="Frito o cocido (dilo en la nota)"
                  price={prices.egg}
                  onClick={() => startAddon('egg')}
                />
              )}
              {showProtein && (
                <AddonChoiceCard
                  emoji="🍗"
                  title="Proteína adicional"
                  subtitle="Elige cuál entre las de hoy"
                  price={prices.protein}
                  onClick={() => startAddon('protein')}
                />
              )}
            </div>
          )}

          {active && (
            <AddonQuantityStep
              active={active}
              prices={prices}
              proteinOptions={proteinOptions}
              onChange={setActive}
              onBack={() => setActive(null)}
            />
          )}
        </div>

        {/* Footer con botón de agregar (solo en step de cantidad) */}
        {active && (
          <div style={{
            padding: '12px 18px',
            background: '#fff', borderTop: `1px solid ${T.neutral[100]}`,
          }}>
            <button
              onClick={confirmAddon}
              style={{
                width: '100%', padding: '16px', borderRadius: 14,
                background: T.copper[500], color: '#fff',
                border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 15.5, fontWeight: 800, letterSpacing: -0.2,
                boxShadow: `0 4px 14px ${T.copper[500]}55`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              + Agregar · {fmtCOP(unitPriceForActive(active, prices) * Math.max(1, active.qty))}
            </button>
          </div>
        )}

        <style>{`
          @keyframes pmFadeBg {
            from { background: rgba(0,0,0,0); }
            to   { background: rgba(0,0,0,0.55); }
          }
          @keyframes pmPop {
            from { transform: scale(0.92); opacity: 0; }
            to   { transform: scale(1); opacity: 1; }
          }
        `}</style>
      </div>
    </div>
  )
}

function unitPriceForActive(active, prices) {
  if (active.type === 'soup') return prices.soup
  if (active.type === 'egg') return prices.egg
  if (active.type === 'protein') return prices.protein
  return 0
}

// ─── Tarjeta de elegir tipo de adición ───────────────────────────
function AddonChoiceCard({ emoji, title, subtitle, price, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', padding: '16px', borderRadius: 16,
        background: '#fff', color: T.neutral[900],
        border: `1.5px solid ${T.neutral[200]}`,
        cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
        display: 'flex', alignItems: 'center', gap: 14,
        boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
        transition: 'transform 0.1s ease, border-color 0.18s, box-shadow 0.18s',
      }}
      onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.985)')}
      onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
      onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
    >
      <div style={{
        width: 48, height: 48, borderRadius: 14, flexShrink: 0,
        background: '#FFF7E6', border: `1px solid #F4E0BC`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 26, lineHeight: 1,
      }}>
        {emoji}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 15.5, fontWeight: 800, color: T.neutral[900],
          letterSpacing: -0.2,
        }}>
          {title}
        </div>
        <div style={{ fontSize: 12, color: T.neutral[500], marginTop: 2 }}>
          {subtitle}
        </div>
      </div>
      <div style={{
        fontSize: 17, fontWeight: 900, color: T.warn,
        fontVariantNumeric: 'tabular-nums', letterSpacing: -0.3,
        flexShrink: 0,
      }}>
        {fmtCOP(price)}
      </div>
    </button>
  )
}

// ─── Step de cantidad (y picker de proteína si aplica) ───────────
function AddonQuantityStep({ active, prices, proteinOptions, onChange, onBack }) {
  const unitPrice = unitPriceForActive(active, prices)
  const meta = {
    soup:    { emoji: '🥣', title: 'Sopa adicional' },
    egg:     { emoji: '🍳', title: 'Huevo adicional' },
    protein: { emoji: '🍗', title: 'Proteína adicional' },
  }[active.type]

  return (
    <div>
      {/* Header de la adición elegida */}
      <div style={{
        padding: '14px 16px', borderRadius: 16, background: '#fff',
        border: `1.5px solid ${T.copper[200]}`,
        display: 'flex', alignItems: 'center', gap: 12,
        marginBottom: 16,
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: 14, flexShrink: 0,
          background: '#FFF7E6', border: `1px solid #F4E0BC`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 26, lineHeight: 1,
        }}>
          {meta.emoji}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 15.5, fontWeight: 800, color: T.neutral[900],
            letterSpacing: -0.2,
          }}>
            {meta.title}
          </div>
          <div style={{
            fontSize: 12, color: T.copper[700], marginTop: 1,
            fontWeight: 700, fontVariantNumeric: 'tabular-nums',
          }}>
            {fmtCOP(unitPrice)} c/u
          </div>
        </div>
        <button
          onClick={onBack}
          style={{
            padding: '8px 12px', borderRadius: 999,
            background: T.neutral[100], color: T.neutral[700],
            border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 12, fontWeight: 700, flexShrink: 0,
          }}
        >
          Cambiar
        </button>
      </div>

      {/* Picker de proteína (solo si es 'protein') */}
      {active.type === 'protein' && proteinOptions?.length > 0 && (
        <div style={{
          padding: 14, borderRadius: 14,
          background: '#fff', border: `1px solid ${T.neutral[200]}`,
          marginBottom: 14,
        }}>
          <div style={{
            fontSize: 11, fontWeight: 800, color: T.neutral[500],
            letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 10,
          }}>
            ¿Cuál proteína?
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {proteinOptions.map((opt, i) => {
              const isActive = active.proteinIdx === i
              return (
                <button
                  key={opt.id}
                  onClick={() => onChange({ ...active, proteinIdx: i })}
                  style={{
                    width: '100%', padding: '12px 14px', borderRadius: 12,
                    background: isActive ? T.copper[500] : '#fff',
                    color: isActive ? '#fff' : T.neutral[900],
                    border: `1.5px solid ${isActive ? T.copper[500] : T.neutral[200]}`,
                    cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                    fontSize: 14.5, fontWeight: 700,
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}
                >
                  <div style={{
                    width: 22, height: 22, borderRadius: 999, flexShrink: 0,
                    background: isActive ? '#fff' : 'transparent',
                    border: `2px solid ${isActive ? '#fff' : T.neutral[300]}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {isActive && (
                      <svg width="11" height="11" viewBox="0 0 13 13" fill="none">
                        <path d="M2 7 L5 10 L11 3" stroke={T.copper[500]} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </div>
                  <span style={{ flex: 1, minWidth: 0 }}>{opt.name}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Selector de cantidad */}
      <div style={{
        padding: 14, borderRadius: 14,
        background: '#fff', border: `1px solid ${T.neutral[200]}`,
      }}>
        <div style={{
          fontSize: 11, fontWeight: 800, color: T.neutral[500],
          letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 10,
        }}>
          ¿Cuántos quieres?
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16,
        }}>
          <QtyButton
            label="−"
            disabled={active.qty <= 1}
            onClick={() => onChange({ ...active, qty: Math.max(1, active.qty - 1) })}
          />
          <div style={{
            minWidth: 64, textAlign: 'center',
            fontSize: 32, fontWeight: 900, color: T.neutral[900],
            fontVariantNumeric: 'tabular-nums', letterSpacing: -0.5,
          }}>
            {active.qty}
          </div>
          <QtyButton
            label="+"
            disabled={active.qty >= 20}
            onClick={() => onChange({ ...active, qty: Math.min(20, active.qty + 1) })}
          />
        </div>
        <div style={{
          marginTop: 12, padding: '10px 12px', borderRadius: 10,
          background: T.copper[50], border: `1px solid ${T.copper[100]}`,
          textAlign: 'center', fontSize: 12.5, color: T.copper[700],
        }}>
          {active.qty} × {fmtCOP(unitPrice)} = <b>{fmtCOP(unitPrice * active.qty)}</b>
        </div>
      </div>
    </div>
  )
}

function QtyButton({ label, disabled, onClick }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        width: 52, height: 52, borderRadius: 999,
        background: disabled ? T.neutral[100] : T.copper[500],
        color: disabled ? T.neutral[400] : '#fff',
        border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit', fontSize: 24, fontWeight: 900,
        boxShadow: disabled ? 'none' : `0 3px 10px ${T.copper[500]}44`,
        transition: 'transform 0.1s ease',
      }}
      onMouseDown={e => !disabled && (e.currentTarget.style.transform = 'scale(0.92)')}
      onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
      onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
    >
      {label}
    </button>
  )
}

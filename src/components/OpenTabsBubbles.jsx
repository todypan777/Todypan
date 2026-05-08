import { useEffect, useMemo, useState } from 'react'
import { T } from '../tokens'
import { fmtCOP } from '../utils/format'
import { watchOpenTabsForSession } from '../openTabs'
import { watchLiveOrdersForSession, tabKitchenState } from '../kitchenOrders'

/**
 * Burbujas flotantes con las mesas abiertas de la cajera.
 * Se renderiza siempre que haya sesión activa.
 *
 * Posición: franja fija en el lado derecho, scroll vertical si hay >5.
 *
 * Props:
 *   - sessionId: id de la cashSession activa
 *   - onSelect(tab): callback al tocar una burbuja
 *
 * Estados de color (fase 12 — almuerzos):
 *   - cobre: mesa normal (sin almuerzos en cocina)
 *   - rojo:  al menos un almuerzo pending en cocina
 *   - verde + parpadeo: TODOS los almuerzos en ready
 */
export default function OpenTabsBubbles({ sessionId, onSelect }) {
  const [tabs, setTabs] = useState([])
  const [liveOrders, setLiveOrders] = useState([])

  useEffect(() => {
    if (!sessionId) return
    return watchOpenTabsForSession(sessionId, setTabs)
  }, [sessionId])

  useEffect(() => {
    if (!sessionId) return
    return watchLiveOrdersForSession(sessionId, setLiveOrders)
  }, [sessionId])

  // Map de tabId → estado consolidado
  const stateByTab = useMemo(() => {
    const map = {}
    for (const tab of tabs) {
      const tabOrders = liveOrders.filter(o => o.tabId === tab.id)
      map[tab.id] = tabKitchenState(tabOrders)
    }
    return map
  }, [tabs, liveOrders])

  if (!tabs || tabs.length === 0) return null

  return (
    <div style={{
      position: 'fixed',
      right: 8,
      // Centrado vertical aproximado, dejando margen arriba para la barra de la cajera
      top: '50%',
      transform: 'translateY(-50%)',
      zIndex: 50,
      display: 'flex', flexDirection: 'column', gap: 10,
      maxHeight: '70vh',
      overflowY: 'auto',
      // Animación fade-in al aparecer
      animation: 'fadeIn 0.18s ease',
      // Scrollbar discreto
      paddingRight: 2,
    }}>
      {tabs.map(t => (
        <Bubble
          key={t.id}
          tab={t}
          kitchenState={stateByTab[t.id] || 'idle'}
          onClick={() => onSelect?.(t)}
        />
      ))}

      <style>{`
        @keyframes bubblePulseGreen {
          0%, 100% {
            transform: scale(1);
            box-shadow: 0 4px 14px rgba(91,138,90,0.55);
          }
          50% {
            transform: scale(1.06);
            box-shadow: 0 6px 22px rgba(91,138,90,0.85);
          }
        }
      `}</style>
    </div>
  )
}

function Bubble({ tab, kitchenState, onClick }) {
  const hasItems = (tab.items?.length || 0) > 0
  const total = Number(tab.total) || 0

  // Color de fondo según estado de cocina, fallback a estética actual
  let bg, shadow, animation
  if (kitchenState === 'cooking') {
    bg = T.bad
    shadow = '0 4px 14px rgba(176,78,60,0.55)'
    animation = 'none'
  } else if (kitchenState === 'ready') {
    bg = T.ok
    shadow = '0 4px 14px rgba(91,138,90,0.55)'
    animation = 'bubblePulseGreen 1.2s ease-in-out infinite'
  } else {
    bg = hasItems ? T.copper[500] : T.neutral[300]
    shadow = hasItems
      ? '0 4px 14px rgba(184,122,86,0.45)'
      : '0 2px 8px rgba(0,0,0,0.15)'
    animation = 'none'
  }

  const stateLabel = kitchenState === 'cooking' ? 'En cocina'
    : kitchenState === 'ready' ? '¡Listo!'
    : null

  return (
    <button
      onClick={onClick}
      title={`Mesa ${tab.tableNumber} · ${fmtCOP(total)}${stateLabel ? ` · ${stateLabel}` : ''}`}
      style={{
        width: 64, height: 64, borderRadius: 999,
        background: bg,
        color: '#fff',
        border: '2px solid #fff',
        cursor: 'pointer', fontFamily: 'inherit',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        boxShadow: shadow,
        transition: 'background 0.25s',
        flexShrink: 0,
        padding: 0,
        animation,
      }}
    >
      <div style={{
        fontSize: 24, fontWeight: 800, lineHeight: 1, letterSpacing: -0.5,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {tab.tableNumber}
      </div>
      {hasItems && kitchenState !== 'ready' && (
        <div style={{
          fontSize: 9, fontWeight: 700, marginTop: 3,
          fontVariantNumeric: 'tabular-nums', opacity: 0.95,
        }}>
          {totalShort(total)}
        </div>
      )}
      {kitchenState === 'ready' && (
        <div style={{
          fontSize: 9, fontWeight: 800, marginTop: 3, letterSpacing: 0.5,
        }}>
          LISTO
        </div>
      )}
    </button>
  )
}

// Versión corta del precio para que quepa en la burbuja: $5k, $12k, $1.2M
function totalShort(n) {
  const abs = Math.abs(Math.round(n || 0))
  if (abs >= 1_000_000) return '$' + (abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1).replace('.', ',') + 'M'
  if (abs >= 1_000) return '$' + Math.round(abs / 1_000) + 'k'
  return '$' + abs
}

import { useEffect, useMemo, useState } from 'react'
import { T } from '../tokens'
import { fmtCOP } from '../utils/format'
import { watchOpenTabsForSession, formatTableLabel } from '../openTabs'
import { watchLiveOrdersForSession, tabKitchenState } from '../kitchenOrders'

/**
 * Burbujas flotantes con las mesas abiertas de la cajera.
 * Se renderiza siempre que haya sesión activa.
 *
 * Layout (D + 'llevar'):
 *   - Tabs MESA (kind='mesa' o legacy)  → franja DERECHA
 *   - Tabs LLEVAR (kind='llevar')        → franja IZQUIERDA
 * Cada franja scroll vertical independiente.
 *
 * Props:
 *   - sessionId: id de la cashSession activa
 *   - onSelect(tab): callback al tocar una burbuja
 *
 * Estados de color (fase 12 — almuerzos):
 *   - cobre / amarillo: tab normal (sin almuerzos en cocina)
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

  // Separar por kind
  const mesaTabs = useMemo(
    () => tabs.filter(t => (t.kind || 'mesa') === 'mesa'),
    [tabs]
  )
  const llevarTabs = useMemo(
    () => tabs.filter(t => (t.kind || 'mesa') === 'llevar'),
    [tabs]
  )

  if (mesaTabs.length === 0 && llevarTabs.length === 0) return null

  // Sin sombras en el pulse — la escala sola transmite el "listo" sin
  // ensuciar visualmente con drop-shadows.
  const animations = (
    <style>{`
      @keyframes bubblePulseGreen {
        0%, 100% { transform: scale(1); }
        50%      { transform: scale(1.06); }
      }
    `}</style>
  )

  return (
    <>
      {/* Franja derecha: mesas */}
      {mesaTabs.length > 0 && (
        <div style={{
          ...stripStyle(),
          right: 8,
        }}>
          {mesaTabs.map(t => (
            <Bubble
              key={t.id}
              tab={t}
              kitchenState={stateByTab[t.id] || 'idle'}
              onClick={() => onSelect?.(t)}
            />
          ))}
        </div>
      )}

      {/* Franja izquierda: llevar */}
      {llevarTabs.length > 0 && (
        <div style={{
          ...stripStyle(),
          left: 8,
        }}>
          {llevarTabs.map(t => (
            <Bubble
              key={t.id}
              tab={t}
              kitchenState={stateByTab[t.id] || 'idle'}
              onClick={() => onSelect?.(t)}
            />
          ))}
        </div>
      )}

      {animations}
    </>
  )
}

function stripStyle() {
  return {
    position: 'fixed',
    top: '50%',
    transform: 'translateY(-50%)',
    zIndex: 50,
    display: 'flex', flexDirection: 'column', gap: 10,
    maxHeight: '70vh',
    overflowY: 'auto',
    animation: 'fadeIn 0.18s ease',
    paddingRight: 2,
  }
}

function Bubble({ tab, kitchenState, onClick }) {
  const isLlevar = (tab.kind || 'mesa') === 'llevar'
  const hasItems = (tab.items?.length || 0) > 0
  const total = Number(tab.total) || 0

  // Color de fondo según estado de cocina, fallback a estética por kind.
  // Sin sombras: el color sólido + borde blanco son suficientes para
  // que la burbuja se lea sobre cualquier fondo, y queda más limpio.
  let bg, animation
  if (kitchenState === 'cooking') {
    bg = T.bad
    animation = 'none'
  } else if (kitchenState === 'ready') {
    bg = T.ok
    animation = 'bubblePulseGreen 1.2s ease-in-out infinite'
  } else if (isLlevar) {
    bg = hasItems ? T.warn : T.neutral[300]
    animation = 'none'
  } else {
    bg = hasItems ? T.copper[500] : T.neutral[300]
    animation = 'none'
  }

  const stateLabel = kitchenState === 'cooking' ? 'En cocina'
    : kitchenState === 'ready' ? '¡Listo!'
    : null

  // Identificador para el tooltip (mesa# o nombre cliente).
  // formatTableLabel maneja sufijos automáticamente: "1", "1.1", "1.2"...
  const idLabel = isLlevar
    ? `📦 ${tab.customerName || 'Cliente'}`
    : `Mesa ${formatTableLabel(tab)}`

  return (
    <button
      onClick={onClick}
      title={`${idLabel} · ${fmtCOP(total)}${stateLabel ? ` · ${stateLabel}` : ''}`}
      style={{
        width: 64, height: 64, borderRadius: 999,
        background: bg,
        color: '#fff',
        border: '2px solid #fff',
        cursor: 'pointer', fontFamily: 'inherit',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        transition: 'background 0.25s',
        flexShrink: 0,
        padding: 0,
        animation,
      }}
    >
      {isLlevar ? (
        // Burbuja de llevar: ícono prominente; el nombre se ve grande al
        // abrir la mesa. La user pidió ícono — sin texto encima.
        <div style={{
          fontSize: 28, lineHeight: 1, letterSpacing: -0.5,
        }}>
          📦
        </div>
      ) : (
        <div style={{
          // Si tiene sufijo (".1", ".2") la etiqueta es más larga: bajamos
          // un poco el tamaño para que quepa cómoda en la burbuja de 64x64.
          fontSize: (Number(tab.tableSuffix) || 0) > 0 ? 19 : 24,
          fontWeight: 800, lineHeight: 1, letterSpacing: -0.5,
          fontVariantNumeric: 'tabular-nums',
        }}>
          {formatTableLabel(tab)}
        </div>
      )}
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

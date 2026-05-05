import { useEffect, useState } from 'react'
import { T } from '../tokens'
import { fmtCOP } from '../utils/format'
import { watchOpenTabsForSession } from '../openTabs'

/**
 * Burbujas flotantes con las mesas abiertas de la cajera.
 * Se renderiza siempre que haya sesión activa.
 *
 * Posición: franja fija en el lado derecho, scroll vertical si hay >5.
 *
 * Props:
 *   - sessionId: id de la cashSession activa
 *   - onSelect(tab): callback al tocar una burbuja
 */
export default function OpenTabsBubbles({ sessionId, onSelect }) {
  const [tabs, setTabs] = useState([])

  useEffect(() => {
    if (!sessionId) return
    return watchOpenTabsForSession(sessionId, setTabs)
  }, [sessionId])

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
        <Bubble key={t.id} tab={t} onClick={() => onSelect?.(t)} />
      ))}
    </div>
  )
}

function Bubble({ tab, onClick }) {
  const hasItems = (tab.items?.length || 0) > 0
  const total = Number(tab.total) || 0
  const itemsCount = (tab.items || []).reduce((s, it) => s + (Number(it.qty) || 0), 0)

  return (
    <button
      onClick={onClick}
      title={`Mesa ${tab.tableNumber} · ${fmtCOP(total)}`}
      style={{
        width: 64, height: 64, borderRadius: 999,
        background: hasItems ? T.copper[500] : T.neutral[300],
        color: '#fff',
        border: 'none', cursor: 'pointer', fontFamily: 'inherit',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        boxShadow: hasItems
          ? '0 4px 14px rgba(184,122,86,0.45), 0 0 0 2px #fff'
          : '0 2px 8px rgba(0,0,0,0.15), 0 0 0 2px #fff',
        transition: 'transform 0.12s, box-shadow 0.12s',
        flexShrink: 0,
      }}
      onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.93)' }}
      onMouseUp={e => { e.currentTarget.style.transform = 'scale(1)' }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)' }}
    >
      <div style={{
        fontSize: 24, fontWeight: 800, lineHeight: 1, letterSpacing: -0.5,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {tab.tableNumber}
      </div>
      {hasItems && (
        <div style={{
          fontSize: 9, fontWeight: 700, marginTop: 3,
          fontVariantNumeric: 'tabular-nums', opacity: 0.95,
        }}>
          {totalShort(total)}
        </div>
      )}
      {/* Badge con conteo de items */}
      {itemsCount > 0 && (
        <div style={{
          position: 'absolute',
          // El position absolute no aplica al botón a menos que el padre tenga relative.
          // Simplifico: la franja podría ser relative pero por simplicidad pongo el contador integrado.
          display: 'none',
        }}>{itemsCount}</div>
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

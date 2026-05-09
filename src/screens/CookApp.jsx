import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { T } from '../tokens'
import { UserAvatar } from '../components/Atoms'
import { signOut } from '../auth'
import { fmtCOP } from '../utils/format'
import {
  CATEGORIES, CATEGORY_BY_ID, CATEGORY_IDS,
  watchMenuItems, watchDailyMenu, watchCorrienteConfig,
  createMenuItem, renameMenuItem, archiveMenuItem, unarchiveMenuItem,
  setDailyMenuItem, setDailySpecial, setDailyCorriente,
  getCorrienteState, copyMenuFromDate, previousDateStr,
} from '../menu'
import { useBogotaDate } from '../utils/useBogotaDate'
import {
  watchKitchenQueue, markOrderReady, unmarkOrderReady,
} from '../kitchenOrders'
import ContactSupportButton from '../components/ContactSupportButton'

// ──────────────────────────────────────────────────────────────
// CookApp: vista principal de la cocinera.
//   Tabs: Hoy (cola FIFO) · Menú (qué hay hoy) · Catálogo
// ──────────────────────────────────────────────────────────────
export default function CookApp({ authUser, userDoc }) {
  const [tab, setTab] = useState('today')
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmSignOut, setConfirmSignOut] = useState(false)

  const [queue, setQueue] = useState([])
  useEffect(() => watchKitchenQueue(setQueue), [])

  const pendingCount = queue.filter(o => o.status === 'pending').length

  return (
    <div style={{
      minHeight: '100dvh', background: T.neutral[50],
      fontFamily: '-apple-system, "SF Pro Text", "Inter", system-ui, sans-serif',
      color: T.neutral[800],
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
    }}>
      <CookTopBar
        authUser={authUser}
        userDoc={userDoc}
        onMenu={() => setMenuOpen(true)}
      />

      {/* Tab bar */}
      <div style={{
        display: 'flex', gap: 0,
        borderBottom: `1px solid ${T.neutral[100]}`,
        background: '#fff',
        position: 'sticky',
        top: 60,
        zIndex: 10,
      }}>
        <CookTab
          active={tab === 'today'}
          onClick={() => setTab('today')}
          label="Hoy"
          badge={pendingCount}
        />
        <CookTab
          active={tab === 'menu'}
          onClick={() => setTab('menu')}
          label="Menú del día"
        />
        <CookTab
          active={tab === 'catalog'}
          onClick={() => setTab('catalog')}
          label="Catálogo"
        />
      </div>

      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        {tab === 'today' && (
          <KitchenQueueView queue={queue} />
        )}
        {tab === 'menu' && (
          <DailyMenuView authUser={authUser} userDoc={userDoc} />
        )}
        {tab === 'catalog' && (
          <CatalogView authUser={authUser} userDoc={userDoc} />
        )}
      </div>

      {menuOpen && (
        <AvatarMenuOverlay
          authUser={authUser}
          userDoc={userDoc}
          onCancel={() => setMenuOpen(false)}
          onSignOut={() => { setMenuOpen(false); setConfirmSignOut(true) }}
        />
      )}

      {confirmSignOut && (
        <SignOutModal
          onCancel={() => setConfirmSignOut(false)}
          onConfirm={async () => { await signOut() }}
        />
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Top bar (igual estética que CashierApp)
// ──────────────────────────────────────────────────────────────
function CookTopBar({ authUser, userDoc, onMenu }) {
  return (
    <div style={{
      padding: '14px 18px',
      display: 'flex', alignItems: 'center', gap: 10,
      background: '#fff',
      borderBottom: `1px solid ${T.neutral[100]}`,
      position: 'sticky', top: 0, zIndex: 20,
      height: 60, boxSizing: 'border-box',
    }}>
      <img
        src="/Logo.png"
        alt="Infinity Eventos"
        style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3 }}>
          TodyPan · Cocina
        </div>
        <div style={{
          fontSize: 11, color: T.neutral[500],
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {userDoc?.nombre} {userDoc?.apellido}
        </div>
      </div>
      <button
        onClick={onMenu}
        style={{
          width: 36, height: 36, borderRadius: 999,
          background: 'transparent', border: 'none', padding: 0,
          cursor: 'pointer', flexShrink: 0,
        }}
      >
        <UserAvatar user={authUser} size={34} />
      </button>
    </div>
  )
}

function CookTab({ active, onClick, label, badge }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, padding: '14px 10px',
        background: 'transparent',
        border: 'none', borderBottom: active ? `3px solid ${T.copper[500]}` : '3px solid transparent',
        cursor: 'pointer', fontFamily: 'inherit',
        fontSize: 13.5, fontWeight: active ? 800 : 600,
        color: active ? T.copper[700] : T.neutral[500],
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        transition: 'color 0.15s, border-color 0.15s',
      }}
    >
      <span>{label}</span>
      {badge > 0 && (
        <span style={{
          minWidth: 20, height: 20, padding: '0 6px', borderRadius: 999,
          background: T.bad, color: '#fff',
          fontSize: 11, fontWeight: 800,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {badge}
        </span>
      )}
    </button>
  )
}

// ──────────────────────────────────────────────────────────────
// VISTA 1: Cola de cocina (cards grandes, FIFO, agrupadas por mesa)
// ──────────────────────────────────────────────────────────────
function KitchenQueueView({ queue }) {
  const lastIdsRef = useRef(new Set())
  // Archivados colapsados por defecto — solo se ve el header. La cocinera
  // los expande si necesita revisar algo. Evita inundar la pantalla con
  // pedidos de días anteriores.
  const [archivedExpanded, setArchivedExpanded] = useState(false)

  // Vibrar y disparar animación cuando llegan pedidos nuevos
  useEffect(() => {
    const currentIds = new Set(queue.filter(o => o.status === 'pending').map(o => o.id))
    const isNewArrival = [...currentIds].some(id => !lastIdsRef.current.has(id))
    if (isNewArrival && lastIdsRef.current.size > 0) {
      // Vibrar (no falla si el dispositivo no soporta)
      try { navigator.vibrate?.([100, 60, 100]) } catch {}
    }
    lastIdsRef.current = currentIds
  }, [queue])

  // Agrupar por commandaId — todos los almuerzos enviados juntos van en un grupo
  const groups = useMemo(() => {
    const map = new Map()
    for (const order of queue) {
      const key = order.commandaId || order.id
      if (!map.has(key)) {
        map.set(key, {
          commandaId: key,
          tableNumber: order.tableNumber,         // null cuando es tab 'llevar'
          tableSuffix: Number(order.tableSuffix) || 0,
          customerName: order.customerName || null,
          destination: order.destination,         // por almuerzo (puede mezclarse)
          commandaNote: order.commandaNote || null,
          createdAt: order.createdAt,
          createdAtClient: order.createdAtClient,
          orders: [],
        })
      }
      map.get(key).orders.push(order)
    }
    return Array.from(map.values())
  }, [queue])

  // Separar grupos: pendientes (alguno cocinando) arriba, archivados (todos ready) abajo.
  // ¡Estos useMemo VAN ANTES de cualquier early return! Hooks no pueden
  // saltarse — React tira "Rendered more hooks than during the previous render"
  // si el orden cambia entre renders.
  const pendingGroups = useMemo(
    () => groups.filter(g => !g.orders.every(o => o.status === 'ready')),
    [groups]
  )
  const archivedGroups = useMemo(() => {
    const ready = groups.filter(g => g.orders.every(o => o.status === 'ready'))
    // Archivados: orden por el readyAt MÁS RECIENTE primero (último que se
    // marcó listo arriba). Antes salía al fondo y confundía a la cocinera.
    return ready.sort((a, b) => {
      const ta = Math.max(...a.orders.map(o => o.readyAt?.toMillis?.() ?? o.readyAtClient ?? 0))
      const tb = Math.max(...b.orders.map(o => o.readyAt?.toMillis?.() ?? o.readyAtClient ?? 0))
      return tb - ta
    })
  }, [groups])

  if (groups.length === 0) {
    return (
      <div style={{
        padding: '60px 28px', textAlign: 'center',
      }}>
        <div style={{ fontSize: 64, marginBottom: 14 }}>🥣</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: T.neutral[800], marginBottom: 6 }}>
          Sin pedidos pendientes
        </div>
        <div style={{ fontSize: 13, color: T.neutral[500], maxWidth: 320, margin: '0 auto', lineHeight: 1.55 }}>
          Cuando una cajera envíe una comanda, aparecerá aquí.
          Las más antiguas siempre arriba.
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '14px 12px 80px' }}>
      {/* Pendientes (cocinando) */}
      {pendingGroups.length > 0 && (
        <>
          <SectionLabel
            color={T.copper[700]}
            bg={T.copper[50]}
            label={`🍳 PREPARANDO · ${pendingGroups.length}`}
          />
          {pendingGroups.map(group => (
            <CommandaCard key={group.commandaId} group={group} />
          ))}
        </>
      )}

      {/* Archivados: pedidos ya finalizados. Más recientes primero.
          Colapsado por defecto — la cocinera lo abre si necesita ver. */}
      {archivedGroups.length > 0 && (
        <>
          <CollapsibleSectionLabel
            color={T.ok}
            bg="#E8F4E8"
            label={`📁 ARCHIVADOS · ${archivedGroups.length}`}
            subtitle={archivedExpanded
              ? 'Toca para ocultar de nuevo.'
              : 'Pedidos finalizados. Toca para verlos.'}
            expanded={archivedExpanded}
            onToggle={() => setArchivedExpanded(prev => !prev)}
          />
          {archivedExpanded && archivedGroups.map(group => (
            <CommandaCard key={group.commandaId} group={group} />
          ))}
        </>
      )}

      <style>{`
        @keyframes commandaSlide {
          from { opacity: 0; transform: translateY(-8px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  )
}

function CollapsibleSectionLabel({ color, bg, label, subtitle, expanded, onToggle }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onToggle()
        }
      }}
      style={{
        margin: '6px 4px 12px',
        padding: '12px 16px',
        borderRadius: 14,
        background: bg,
        border: `1.5px solid ${color}33`,
        cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 12,
        userSelect: 'none',
        transition: 'background 0.15s',
        outline: 'none',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 900, color, letterSpacing: 0.5 }}>
          {label}
        </div>
        {subtitle && (
          <div style={{
            fontSize: 13, color, opacity: 0.85, marginTop: 4, lineHeight: 1.4,
          }}>
            {subtitle}
          </div>
        )}
      </div>
      <div style={{
        width: 28, height: 28, borderRadius: 999, flexShrink: 0,
        background: '#fff', border: `1.5px solid ${color}66`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'transform 0.2s',
        transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
      }}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M3 5 L7 9 L11 5" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  )
}

function SectionLabel({ color, bg, label, subtitle }) {
  return (
    <div style={{
      margin: '6px 4px 12px',
      padding: '12px 16px',
      borderRadius: 14,
      background: bg,
      border: `1.5px solid ${color}33`,
    }}>
      <div style={{
        fontSize: 16, fontWeight: 900, color, letterSpacing: 0.5,
      }}>
        {label}
      </div>
      {subtitle && (
        <div style={{
          fontSize: 13, color, opacity: 0.85, marginTop: 4, lineHeight: 1.4,
        }}>
          {subtitle}
        </div>
      )}
    </div>
  )
}

// Etiqueta de tabla a partir de los campos planos del kitchenOrder/grupo.
// "1", "2.1", o "Cliente" según el caso.
function tableLabelFromGroup(group) {
  if (!group.tableNumber) return group.customerName || 'Cliente'
  const suffix = Number(group.tableSuffix) || 0
  return suffix > 0 ? `${group.tableNumber}.${suffix}` : String(group.tableNumber)
}

function CommandaCard({ group }) {
  const allReady = group.orders.every(o => o.status === 'ready')
  // Si NO hay número de mesa, la tab es de tipo 'llevar' (sin mesa).
  // El destino por almuerzo puede mezclarse, pero el header se decide por la
  // tab: si llegó sin tableNumber → header de llevar.
  const isLlevarTab = !group.tableNumber
  const label = tableLabelFromGroup(group)

  // Cronómetro: corre mientras NO esté todo listo. Cuando todo está listo,
  // congela el tiempo en el momento del LAST readyAt (antes corría infinito y
  // se veían pedidos ya cobrados con 1 día de cronómetro).
  const startMs = group.createdAt?.toMillis?.() ?? group.createdAtClient ?? Date.now()
  const frozenEndMs = useMemo(() => {
    if (!allReady) return null
    let max = 0
    for (const o of group.orders) {
      const t = o.readyAt?.toMillis?.() ?? o.readyAtClient ?? 0
      if (t > max) max = t
    }
    return max || Date.now()
  }, [allReady, group.orders])

  // Tickeo:
  //  - Pendiente: cada 1s para urgencia visible.
  //  - Archivado (todo listo): cada 60s — el badge muestra "hace Xh Ym" desde
  //    que se marcó listo; precisión de minuto es suficiente y ahorra battery
  //    cuando hay 40+ archivados expandidos.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const intervalMs = frozenEndMs != null ? 60000 : 1000
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [frozenEndMs])

  // Para PENDIENTES: cuánto lleva esperando = now - createdAt.
  // Para ARCHIVADOS: cuánto hace que se marcó listo = now - readyAt.
  // Antes mostrábamos prep-time (createdAt → readyAt) que confundía a la
  // cocinera porque se veía "7 min" para un pedido de hace 23h.
  const elapsedSecs = frozenEndMs != null
    ? Math.max(0, Math.floor((now - frozenEndMs) / 1000))
    : Math.max(0, Math.floor((now - startMs) / 1000))
  const elapsedLabel = frozenEndMs != null
    ? `Hace ${formatElapsed(elapsedSecs)}`
    : formatElapsed(elapsedSecs)
  const elapsedColor = frozenEndMs != null
    ? T.ok
    : elapsedSecs < 300 ? T.neutral[600] : elapsedSecs < 600 ? T.warn : T.bad
  const elapsedPrefix = frozenEndMs != null ? '✓' : '⏱'

  // Color del header según el tipo de tab (mesa vs llevar)
  const destBg = isLlevarTab ? '#FFF4DD' : '#FBF5F0'
  const destBorder = isLlevarTab ? '#F0D699' : T.copper[100]
  const destLabel = isLlevarTab ? '📦 PARA LLEVAR' : '🍽️ EN MESA'
  const destColor = isLlevarTab ? '#8A5E12' : T.copper[700]

  // Mezcla: si hay almuerzos con destination distinto al de la tab, avisar.
  // (Caso típico: mesa numerada con un almuerzo "para llevar" porque alguien
  // se va a llevar el suyo a la oficina.)
  const llevarCount = group.orders.filter(o => o.destination === 'llevar').length
  const mesaCount = group.orders.filter(o => o.destination === 'mesa').length
  const isMixed = llevarCount > 0 && mesaCount > 0

  return (
    <div style={{
      marginBottom: 16,
      borderRadius: 20,
      background: '#fff',
      border: `2px solid ${allReady ? T.ok + '88' : T.neutral[200]}`,
      overflow: 'hidden',
      boxShadow: '0 3px 10px rgba(0,0,0,0.06)',
      animation: 'commandaSlide 0.32s cubic-bezier(0.2,0.9,0.3,1.05)',
      opacity: allReady ? 0.95 : 1,
    }}>
      {/* Header — fuentes agrandadas para que la cocinera lea sin esfuerzo */}
      <div style={{
        padding: '14px 18px',
        background: destBg,
        borderBottom: `1.5px solid ${destBorder}`,
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{
          width: 60, height: 60, borderRadius: 14,
          background: '#fff', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          // Reducimos el font para mesas con sufijo (más caracteres) — "2.1"
          // necesita más espacio que "2".
          fontSize: isLlevarTab ? 30 : ((Number(group.tableSuffix) || 0) > 0 ? 22 : 28),
          fontWeight: 900,
          color: destColor,
          fontVariantNumeric: 'tabular-nums',
          border: `2px solid ${destBorder}`,
        }}>
          {isLlevarTab ? '📦' : label}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14, fontWeight: 900, color: destColor,
            letterSpacing: 0.6,
          }}>
            {destLabel}
          </div>
          <div style={{
            fontSize: 19, fontWeight: 800, color: T.neutral[900],
            letterSpacing: -0.2, marginTop: 2,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {isLlevarTab ? label : `Mesa ${label}`}
            {' · '}
            {group.orders.length} {group.orders.length === 1 ? 'almuerzo' : 'almuerzos'}
          </div>
          {isMixed && (
            <div style={{
              fontSize: 11.5, fontWeight: 700, color: T.warn,
              marginTop: 2, letterSpacing: 0.3,
            }}>
              ⚠ Mezcla: {mesaCount} mesa + {llevarCount} llevar — revisar cada plato
            </div>
          )}
        </div>
        <div style={{
          padding: '10px 16px', borderRadius: 999,
          background: '#fff', border: `2px solid ${elapsedColor}66`,
          color: elapsedColor,
          fontSize: 17, fontWeight: 900,
          fontVariantNumeric: 'tabular-nums',
          flexShrink: 0,
        }}>
          {elapsedPrefix} {elapsedLabel}
        </div>
      </div>

      {/* Nota de la comanda — más grande y destacada */}
      {group.commandaNote && (
        <div style={{
          padding: '14px 18px',
          background: '#FFF7E6', borderBottom: `1.5px solid #F4E0BC`,
          fontSize: 17, color: '#7A5C00',
          fontWeight: 600, fontStyle: 'italic', lineHeight: 1.4,
        }}>
          📝 {group.commandaNote}
        </div>
      )}

      {/* Almuerzos individuales */}
      <div>
        {group.orders.map((order, i) => (
          <KitchenOrderRow
            key={order.id}
            order={order}
            isLast={i === group.orders.length - 1}
          />
        ))}
      </div>
    </div>
  )
}

// Helper: principio puede ser objeto único (legacy) o array (nuevo, hasta 2).
// Devuelve siempre array.
function principioToArray(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.filter(Boolean)
  return [value]
}

function KitchenOrderRow({ order, isLast }) {
  const isReady = order.status === 'ready'
  const [detailOpen, setDetailOpen] = useState(false)

  // Resumen breve — sin las categorías "siempre se sirven" cuando van por
  // defecto. Cuando la cajera las quita explícitamente, las mostramos como
  // SIN [X] grande para alertar a la cocinera.
  const selections = order.selections || {}
  const description = order.description

  // OJO: usamos <div role="button"> y NO <button> porque el contenido interno
  // tiene <div>s con flex (no es phrasing content). Ponerlos dentro de un
  // <button> hace HTML inválido y el navegador "cierra" el botón temprano,
  // sacando los hijos fuera y rompiendo el layout (incluido el modal hermano
  // que aparece descentrado en posición absoluta). Con role="button" el
  // navegador respeta la estructura y mantiene la accesibilidad.
  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setDetailOpen(true)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setDetailOpen(true)
          }
        }}
        style={{
          display: 'block', width: '100%', textAlign: 'left',
          padding: '18px 20px',
          borderBottom: isLast ? 'none' : `1px solid ${T.neutral[100]}`,
          background: isReady ? '#F5FBF5' : '#fff',
          cursor: 'pointer', fontFamily: 'inherit',
          transition: 'background 0.15s',
          outline: 'none',
          boxSizing: 'border-box',
        }}
        onMouseEnter={e => e.currentTarget.style.background = isReady ? '#EAF6EA' : '#FBF5F0'}
        onMouseLeave={e => e.currentTarget.style.background = isReady ? '#F5FBF5' : '#fff'}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 18, fontWeight: 900, color: isReady ? T.ok : T.copper[700],
              letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 10,
              display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            }}>
              {isReady && <span>✓</span>}
              {order.productName || 'Almuerzo'}
              {order.kind === 'special' && <span>⭐</span>}
              {order.destination === 'llevar' && (
                <span style={{
                  fontSize: 12, fontWeight: 800, color: '#7A5C00',
                  background: '#FFF7E6', border: '1px solid #F0D699',
                  padding: '2px 8px', borderRadius: 999,
                  letterSpacing: 0.3,
                }}>
                  📦 LLEVAR
                </span>
              )}
            </div>

            {/* Selecciones — solo lo IMPORTANTE para la cocinera. Si una
                categoría "siempre se sirve" (acompañante/ensalada/jugo) está
                presente, la ocultamos para no llenar el espacio. */}
            {order.kind === 'menu' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {CATEGORIES.map(cat => {
                  const sel = selections[cat.id]
                  const principioArr = cat.id === 'principio' ? principioToArray(sel) : null
                  const isAlwaysServed = !!cat.alwaysServed

                  // Categoría "siempre se sirve" SIN valor → alerta en grande.
                  if (isAlwaysServed && (sel === null || sel === undefined)) {
                    return (
                      <div key={cat.id} style={{
                        fontSize: 18, fontWeight: 900, color: T.bad,
                        letterSpacing: 0.5, textTransform: 'uppercase',
                        background: '#FBE9E5', padding: '8px 14px', borderRadius: 10,
                        display: 'inline-block', alignSelf: 'flex-start',
                        border: `2px solid ${T.bad}55`,
                      }}>
                        ⚠ SIN {cat.label.toUpperCase()}
                      </div>
                    )
                  }
                  // Categoría "siempre se sirve" CON valor → NO mostrar (la
                  // cocinera ya sabe que va).
                  if (isAlwaysServed) return null

                  // Principio multi-select (puede ser MIXTO)
                  if (principioArr) {
                    if (principioArr.length === 0) return null
                    const value = principioArr.length === 2
                      ? `MIXTO ${principioArr.map(p => p.name).join(' / ')}`
                      : principioArr[0].name
                    return (
                      <div key={cat.id} style={{
                        display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap',
                      }}>
                        <span style={{
                          fontSize: 13, fontWeight: 800, color: T.neutral[500],
                          minWidth: 110, letterSpacing: 0.5, textTransform: 'uppercase',
                        }}>
                          {cat.emoji} {cat.label}
                        </span>
                        <span style={{
                          fontSize: 18, fontWeight: 800,
                          color: principioArr.length === 2 ? T.copper[700] : T.neutral[900],
                          letterSpacing: -0.1,
                        }}>
                          {value}
                        </span>
                      </div>
                    )
                  }

                  // Categoría normal (sopa/proteína).
                  if (!sel) return null
                  return (
                    <div key={cat.id} style={{
                      display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap',
                    }}>
                      <span style={{
                        fontSize: 13, fontWeight: 800, color: T.neutral[500],
                        minWidth: 110, letterSpacing: 0.5, textTransform: 'uppercase',
                      }}>
                        {cat.emoji} {cat.label}
                      </span>
                      <span style={{
                        fontSize: 18, fontWeight: 800, color: T.neutral[900],
                        letterSpacing: -0.1,
                      }}>
                        {sel.name}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Descripción libre del especial */}
            {order.kind === 'special' && description && (
              <div style={{
                fontSize: 17, color: T.neutral[800], lineHeight: 1.55,
                padding: '12px 16px', borderRadius: 12,
                background: T.neutral[50], border: `1px solid ${T.neutral[100]}`,
                whiteSpace: 'pre-wrap', fontWeight: 600,
              }}>
                {description}
              </div>
            )}

            {/* Pagado antes (solo para llevar) */}
            {order.paid && (
              <div style={{
                marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '5px 12px', borderRadius: 999,
                background: T.ok + '20', color: T.ok,
                fontSize: 14, fontWeight: 800,
              }}>
                💳 Pagado
              </div>
            )}

            {/* Hint para la cocinera */}
            <div style={{
              marginTop: 12, fontSize: 12, fontWeight: 700,
              color: T.neutral[500], letterSpacing: 0.4, textTransform: 'uppercase',
            }}>
              {isReady ? 'Toca para deshacer' : 'Toca para confirmar listo'}
            </div>
          </div>

          {/* Pill estado, no botón. Al tocar la fila se abre el modal. */}
          <div style={{
            flexShrink: 0,
            padding: '12px 16px', borderRadius: 14,
            background: isReady ? T.ok + '22' : T.copper[50],
            color: isReady ? T.ok : T.copper[700],
            fontSize: 13, fontWeight: 900, letterSpacing: 0.4, textTransform: 'uppercase',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            {isReady ? '✓ Listo' : '🍳 Cocinando'}
          </div>
        </div>
      </div>

      {detailOpen && (
        <KitchenOrderDetailModal
          order={order}
          onClose={() => setDetailOpen(false)}
        />
      )}
    </>
  )
}

// ──────────────────────────────────────────────────────────────
// Popup grande con el detalle del almuerzo + botones de confirmar/volver.
// La cocinera ya no marca listo con un solo click "por accidente": ahora
// debe abrir, revisar y confirmar — o si ya está listo, deshacer.
// ──────────────────────────────────────────────────────────────
function KitchenOrderDetailModal({ order, onClose }) {
  const isReady = order.status === 'ready'
  const [busy, setBusy] = useState(false)
  // Flash de confirmación post-confirm: "✓ LISTO MESA 2.1" durante 1.2s
  // antes de cerrar el modal — para que la cocinera tenga feedback visual
  // claro de qué pedido acaba de marcar.
  const [flashAction, setFlashAction] = useState(null) // 'ready' | 'unready' | null

  // Etiqueta a mostrar (mesa + sufijo o nombre cliente). Es el dato más
  // importante para la cocinera — qué pedido está terminando.
  const isLlevar = order.destination === 'llevar'
  const isLlevarTab = !order.tableNumber
  const tableLabel = isLlevarTab
    ? (order.customerName || 'Cliente')
    : (() => {
        const suffix = Number(order.tableSuffix) || 0
        return suffix > 0 ? `${order.tableNumber}.${suffix}` : String(order.tableNumber)
      })()
  const labelHeading = isLlevarTab
    ? tableLabel.toUpperCase()
    : `MESA ${tableLabel}`

  async function handleConfirm() {
    if (busy) return
    setBusy(true)
    try {
      const willBeReady = !isReady
      if (isReady) await unmarkOrderReady(order.id)
      else await markOrderReady(order.id)
      // Mostrar flash de feedback antes de cerrar
      setFlashAction(willBeReady ? 'ready' : 'unready')
      setTimeout(() => onClose(), 1200)
    } catch (err) {
      console.error('[kitchen] toggle ready error:', err)
      setBusy(false)
    }
  }

  const selections = order.selections || {}
  const description = order.description

  // PORTAL: renderizamos el modal en document.body para escapar la jerarquía
  // de CommandaCard, que tiene `animation` con keyframes de transform y crea
  // un containing block para los hijos position:fixed. Sin portal, `inset:0`
  // se mide contra la card en vez del viewport y el modal aparece chiquito y
  // descentrado. Con createPortal eso se elimina de raíz.
  return createPortal((
    <div
      onClick={busy ? undefined : onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 110,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16, animation: 'fadeIn 0.15s ease',
      }}
    >
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 540,
        maxHeight: '92vh', display: 'flex', flexDirection: 'column',
        background: '#fff', borderRadius: 22,
        boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
        overflow: 'hidden',
        // position: relative para que el flash overlay (position: absolute)
        // se ancle al modal box, no al viewport entero.
        position: 'relative',
        animation: 'fadeScaleIn 0.2s cubic-bezier(0.2,0.9,0.3,1.05)',
      }}>
        {/* Header — la etiqueta MESA X.Y o nombre del cliente es el elemento
            principal en tamaño gigante. Es lo que la cocinera necesita ver
            de un golpe para saber qué pedido es. */}
        <div style={{
          padding: '20px 22px',
          background: isReady ? '#E8F4E8' : (isLlevarTab ? '#FFF4DD' : '#FBF5F0'),
          borderBottom: `1.5px solid ${isReady ? T.ok + '55' : (isLlevarTab ? '#F0D699' : T.copper[100])}`,
          display: 'flex', alignItems: 'center', gap: 16,
        }}>
          <div style={{
            width: 64, height: 64, borderRadius: 16, flexShrink: 0,
            background: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 34,
            border: `2.5px solid ${isReady ? T.ok + '88' : (isLlevarTab ? '#F0D699' : T.copper[200])}`,
          }}>
            {isReady ? '✓' : (isLlevarTab ? '📦' : '🍽️')}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 12, fontWeight: 900,
              color: isReady ? T.ok : (isLlevarTab ? '#8A5E12' : T.copper[700]),
              letterSpacing: 0.7, textTransform: 'uppercase',
            }}>
              {isReady
                ? 'Toca para volver a pendiente'
                : (isLlevarTab ? 'Para llevar' : 'Para mesa')}
            </div>
            {/* Etiqueta GIGANTE — MESA 2.1 o PARA LA PELUQUERIA */}
            <div style={{
              fontSize: tableLabel.length > 12 ? 26 : (tableLabel.length > 6 ? 32 : 38),
              fontWeight: 900, color: T.neutral[900],
              letterSpacing: -0.5, marginTop: 4, lineHeight: 1.1,
              textTransform: 'uppercase',
              wordBreak: 'break-word',
            }}>
              {labelHeading}
            </div>
            <div style={{
              fontSize: 14, color: T.neutral[600], marginTop: 6, fontWeight: 600,
              letterSpacing: -0.1,
            }}>
              {order.productName || 'Almuerzo'}
              {order.kind === 'special' && ' ⭐'}
              {/* Marca si este almuerzo en particular es llevar dentro de
                  una mesa numerada (caso mixto) */}
              {!isLlevarTab && isLlevar && (
                <span style={{
                  marginLeft: 8,
                  fontSize: 11, fontWeight: 800, color: '#8A5E12',
                  background: '#FFF7E6', border: '1px solid #F0D699',
                  padding: '2px 8px', borderRadius: 999,
                  letterSpacing: 0.3, verticalAlign: 'middle',
                }}>
                  📦 LLEVAR
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Cuerpo */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 22px' }}>
          {/* Comentario de la comanda — destacado arriba */}
          {order.commandaNote && (
            <div style={{
              marginBottom: 18,
              padding: '14px 16px', borderRadius: 14,
              background: '#FFF7E6', border: `1.5px solid #F4E0BC`,
              fontSize: 18, fontWeight: 700, color: '#7A5C00',
              fontStyle: 'italic', lineHeight: 1.4,
            }}>
              📝 {order.commandaNote}
            </div>
          )}

          {/* Selecciones */}
          {order.kind === 'menu' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {CATEGORIES.map(cat => {
                const sel = selections[cat.id]
                const principioArr = cat.id === 'principio' ? principioToArray(sel) : null
                const isAlwaysServed = !!cat.alwaysServed

                if (isAlwaysServed && (sel === null || sel === undefined)) {
                  return (
                    <div key={cat.id} style={{
                      fontSize: 20, fontWeight: 900, color: T.bad,
                      letterSpacing: 0.5, textTransform: 'uppercase',
                      background: '#FBE9E5', padding: '12px 18px', borderRadius: 12,
                      border: `2px solid ${T.bad}55`,
                    }}>
                      ⚠ SIN {cat.label.toUpperCase()}
                    </div>
                  )
                }
                if (isAlwaysServed) return null

                if (principioArr) {
                  if (principioArr.length === 0) return null
                  const value = principioArr.length === 2
                    ? `MIXTO ${principioArr.map(p => p.name).join(' / ')}`
                    : principioArr[0].name
                  return (
                    <div key={cat.id} style={{
                      display: 'flex', flexDirection: 'column', gap: 4,
                      padding: '12px 14px', borderRadius: 12,
                      background: principioArr.length === 2 ? T.copper[50] : T.neutral[50],
                      border: `1px solid ${principioArr.length === 2 ? T.copper[200] : T.neutral[100]}`,
                    }}>
                      <span style={{
                        fontSize: 12, fontWeight: 800, color: T.neutral[500],
                        letterSpacing: 0.5, textTransform: 'uppercase',
                      }}>
                        {cat.emoji} {cat.label}
                      </span>
                      <span style={{
                        fontSize: 20, fontWeight: 900,
                        color: principioArr.length === 2 ? T.copper[700] : T.neutral[900],
                      }}>
                        {value}
                      </span>
                    </div>
                  )
                }

                if (!sel) return null
                return (
                  <div key={cat.id} style={{
                    display: 'flex', flexDirection: 'column', gap: 4,
                    padding: '12px 14px', borderRadius: 12,
                    background: T.neutral[50], border: `1px solid ${T.neutral[100]}`,
                  }}>
                    <span style={{
                      fontSize: 12, fontWeight: 800, color: T.neutral[500],
                      letterSpacing: 0.5, textTransform: 'uppercase',
                    }}>
                      {cat.emoji} {cat.label}
                    </span>
                    <span style={{
                      fontSize: 20, fontWeight: 900, color: T.neutral[900],
                    }}>
                      {sel.name}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {order.kind === 'special' && description && (
            <div style={{
              fontSize: 18, color: T.neutral[800], lineHeight: 1.6,
              padding: '14px 16px', borderRadius: 12,
              background: T.neutral[50], border: `1px solid ${T.neutral[100]}`,
              whiteSpace: 'pre-wrap', fontWeight: 600,
            }}>
              {description}
            </div>
          )}
        </div>

        {/* Footer con acciones */}
        <div style={{
          padding: '16px 20px',
          borderTop: `1px solid ${T.neutral[100]}`,
          background: '#fff',
          display: 'flex', gap: 10,
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
        }}>
          <button
            onClick={onClose}
            disabled={busy}
            style={{
              flex: 1, padding: '16px', borderRadius: 14,
              background: T.neutral[100], color: T.neutral[700],
              border: 'none', cursor: busy ? 'wait' : 'pointer',
              fontFamily: 'inherit', fontSize: 15, fontWeight: 800,
            }}
          >
            ← Volver
          </button>
          <button
            onClick={handleConfirm}
            disabled={busy}
            style={{
              flex: 1.5, padding: '16px', borderRadius: 14,
              background: isReady ? T.warn : T.ok,
              color: '#fff',
              border: 'none', cursor: busy ? 'wait' : 'pointer',
              fontFamily: 'inherit', fontSize: 16, fontWeight: 900,
              letterSpacing: 0.3,
              boxShadow: isReady
                ? `0 6px 18px ${T.warn}66`
                : `0 6px 18px ${T.ok}66`,
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? '...' : (isReady ? '↺ Volver a pendiente' : '✓ Confirmar listo')}
          </button>
        </div>

        {/* Flash de confirmación — cubre el modal con un overlay verde y
            la etiqueta GIGANTE durante 1.2s antes de cerrar. Feedback claro
            de qué pedido acaba de marcar. */}
        {flashAction && (
          <div style={{
            position: 'absolute', inset: 0,
            background: flashAction === 'ready' ? T.ok : T.warn,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            color: '#fff', textAlign: 'center', padding: '20px',
            animation: 'flashIn 0.18s ease-out',
            zIndex: 5,
          }}>
            <div style={{ fontSize: 64, lineHeight: 1, marginBottom: 8 }}>
              {flashAction === 'ready' ? '✓' : '↺'}
            </div>
            <div style={{
              fontSize: 22, fontWeight: 900, letterSpacing: 1,
              textTransform: 'uppercase', marginBottom: 6,
            }}>
              {flashAction === 'ready' ? 'LISTO' : 'DEVUELTO'}
            </div>
            <div style={{
              fontSize: tableLabel.length > 12 ? 32 : 44,
              fontWeight: 900, letterSpacing: -0.5, lineHeight: 1.1,
              wordBreak: 'break-word',
            }}>
              {labelHeading}
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes fadeScaleIn {
          from { opacity: 0; transform: scale(0.94) translateY(10px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes flashIn {
          from { opacity: 0; transform: scale(1.05); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  ), document.body)
}

function formatElapsed(secs) {
  if (secs < 60) return `${secs}s`
  const min = Math.floor(secs / 60)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h < 24) return m > 0 ? `${h}h ${m}m` : `${h}h`
  // Archivados pueden tener varios días — reportar en días+horas.
  const days = Math.floor(h / 24)
  const remH = h % 24
  return remH > 0 ? `${days}d ${remH}h` : `${days}d`
}

// ──────────────────────────────────────────────────────────────
// VISTA 2: Menú del día — toggles de qué hay disponible HOY
// ──────────────────────────────────────────────────────────────
function DailyMenuView({ authUser, userDoc }) {
  const today = useBogotaDate()
  const [allItems, setAllItems] = useState([])
  const [dailyMenu, setDailyMenu] = useState(null)
  const [corrienteConfig, setCorrienteConfig] = useState(null)
  const adminName = `${userDoc?.nombre || ''} ${userDoc?.apellido || ''}`.trim() || authUser?.email || 'Cocinera'

  useEffect(() => watchMenuItems(setAllItems), [])
  useEffect(() => watchDailyMenu(today, setDailyMenu), [today])
  // Config PERSISTENTE de precios del corriente — sobrevive al reset diario.
  useEffect(() => watchCorrienteConfig(setCorrienteConfig), [])

  const itemsByCategory = useMemo(() => {
    const out = {}
    for (const cat of CATEGORY_IDS) out[cat] = []
    for (const item of allItems) {
      if (item.archived) continue
      if (out[item.category]) out[item.category].push(item)
    }
    return out
  }, [allItems])

  const activeIds = useMemo(() => {
    const out = {}
    for (const cat of CATEGORY_IDS) {
      out[cat] = new Set(dailyMenu?.itemsByCategory?.[cat] || [])
    }
    return out
  }, [dailyMenu])

  // Estado del corriente HOY (precios persistentes + categorías OK del día)
  const corriente = useMemo(
    () => getCorrienteState(dailyMenu, allItems, corrienteConfig),
    [dailyMenu, allItems, corrienteConfig]
  )

  // ¿El doc del DÍA está vacío de opciones? (los precios viven aparte y son persistentes)
  const dailyIsEmpty = !dailyMenu
    || (
      !dailyMenu.itemsByCategory
      && (!dailyMenu.special || !dailyMenu.special.active)
    )

  async function toggleItem(category, itemId) {
    const cat = CATEGORY_BY_ID[category]
    const current = dailyMenu?.itemsByCategory?.[category] || []
    let next
    if (cat.multi) {
      next = current.includes(itemId)
        ? current.filter(id => id !== itemId)
        : [...current, itemId]
    } else {
      next = current.includes(itemId) ? [] : [itemId]
    }
    await setDailyMenuItem(today, category, next, {
      publishedBy: authUser.uid,
      publishedByName: adminName,
    })
  }

  return (
    <div style={{ padding: '16px 14px 80px' }}>
      {/* Botón "Copiar lo de ayer" — solo si el día está vacío */}
      {dailyIsEmpty && (
        <CopyYesterdayCard
          today={today}
          authUser={authUser}
          adminName={adminName}
        />
      )}

      {/* Card "Almuerzo Corriente" — siempre visible, define precios */}
      <CorrienteSection
        corriente={corriente}
        date={today}
        authUser={authUser}
        adminName={adminName}
        existingPriceMesa={corrienteConfig?.priceMesa}
        existingPriceLlevar={corrienteConfig?.priceLlevar}
      />

      {/* Categorías del corriente */}
      <div style={{
        padding: '10px 14px', borderRadius: 12, margin: '4px 0 14px',
        background: T.copper[50], border: `1px solid ${T.copper[100]}`,
        fontSize: 12.5, color: T.copper[700], lineHeight: 1.5,
      }}>
        💡 Activa lo que hay disponible <b>hoy</b>. Los cambios aplican en vivo —
        si algo se acaba, desactívalo y desaparece del menú de la cajera al instante.
      </div>

      {CATEGORIES.map(cat => (
        <CategorySection
          key={cat.id}
          category={cat}
          items={itemsByCategory[cat.id]}
          activeIds={activeIds[cat.id]}
          onToggle={(itemId) => toggleItem(cat.id, itemId)}
        />
      ))}

      <SpecialSection
        dailyMenu={dailyMenu}
        date={today}
        authUser={authUser}
        adminName={adminName}
      />
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Card "Almuerzo Corriente": precios + estado de disponibilidad
// ──────────────────────────────────────────────────────────────
function CorrienteSection({ corriente, date, authUser, adminName, existingPriceMesa, existingPriceLlevar }) {
  const [editing, setEditing] = useState(false)
  const [priceMesa, setPriceMesa] = useState(String(existingPriceMesa || ''))
  const [priceLlevar, setPriceLlevar] = useState(String(existingPriceLlevar || ''))
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState(null)

  // Cuando los datos del doc cambian (snapshot), reflejarlos en los inputs
  // si NO estamos editando — para no sobrescribir lo que la cocinera escribe.
  useEffect(() => {
    if (!editing) {
      setPriceMesa(String(existingPriceMesa || ''))
      setPriceLlevar(String(existingPriceLlevar || ''))
    }
  }, [editing, existingPriceMesa, existingPriceLlevar])

  async function handleSave() {
    const pm = Number(priceMesa) || 0
    const pl = Number(priceLlevar) || 0
    if (pm <= 0) return
    setBusy(true)
    setSaveError(null)
    try {
      await setDailyCorriente(date, {
        priceMesa: pm,
        priceLlevar: pl > 0 ? pl : pm,
      }, { publishedBy: authUser.uid, publishedByName: adminName })
      setEditing(false)
    } catch (err) {
      // Antes esto tiraba "uncaught promise" sin feedback. Ahora la
      // cocinera ve qué pasó y puede reintentar.
      console.error('[corriente] no se pudo guardar el precio:', err)
      const code = err?.code || ''
      if (code === 'permission-denied') {
        setSaveError('Permisos insuficientes. Avisa al admin para revisar reglas de Firestore.')
      } else if (code === 'invalid-argument' || /reserved/i.test(err?.message || '')) {
        setSaveError('Error interno con el id del documento. Avisa al programador.')
      } else if (code === 'unavailable') {
        setSaveError('Sin conexión. Intenta de nuevo cuando vuelva la red.')
      } else {
        setSaveError(`No se pudo guardar. ${err?.message || 'Intenta de nuevo.'}`)
      }
    } finally {
      setBusy(false)
    }
  }

  const tone = corriente.available
    ? { bg: '#E8F4E8', border: T.ok + '55', label: 'Disponible', labelColor: T.ok }
    : { bg: '#FFF7E6', border: '#F4E0BC', label: 'Falta configurar', labelColor: T.warn }

  return (
    <div style={{
      padding: '14px 16px', borderRadius: 16, marginBottom: 14,
      background: tone.bg, border: `1.5px solid ${tone.border}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 18 }}>🍽️</span>
        <div style={{ fontSize: 14, fontWeight: 800, color: T.neutral[900] }}>
          Almuerzo Corriente
        </div>
        <span style={{
          fontSize: 10, fontWeight: 700, color: tone.labelColor,
          letterSpacing: 0.4, textTransform: 'uppercase',
          padding: '2px 7px', borderRadius: 999,
          background: '#fff', border: `1px solid ${tone.border}`,
        }}>
          {tone.label}
        </span>
      </div>

      {!corriente.available && (
        <div style={{ fontSize: 12, color: T.neutral[600], marginBottom: 12, lineHeight: 1.5 }}>
          {corriente.missingPrice && 'Falta poner precio. '}
          {corriente.missingCategories.length > 0 && (
            <>Falta activar opciones de: <b>{corriente.missingCategories.join(', ')}</b>.</>
          )}
        </div>
      )}

      {editing ? (
        <div>
          <FieldLabel>Precio para mesa ($)</FieldLabel>
          <input type="number" value={priceMesa} onChange={e => setPriceMesa(e.target.value)}
            placeholder="Ej. 15000" style={inputStyle()} />
          <FieldLabel>Precio para llevar ($)</FieldLabel>
          <input type="number" value={priceLlevar} onChange={e => setPriceLlevar(e.target.value)}
            placeholder="Si vacío, se usa el de mesa" style={inputStyle()} />
          <div style={{
            fontSize: 11.5, color: T.neutral[600], lineHeight: 1.45,
            marginTop: 4, marginBottom: 8,
          }}>
            💡 Estos precios <b>se guardan permanentes</b> — no se reinician al día siguiente. Solo cámbialos cuando suba el precio.
          </div>
          {saveError && (
            <div style={{
              padding: '10px 12px', borderRadius: 10, marginBottom: 8,
              background: '#FBE9E5', border: `1px solid #F0C8BE`, color: T.bad,
              fontSize: 12.5, fontWeight: 600, lineHeight: 1.4,
            }}>
              ⚠ {saveError}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button onClick={() => { setEditing(false); setSaveError(null) }} disabled={busy} style={btnSecondary()}>Cancelar</button>
            <button onClick={handleSave} disabled={busy || !priceMesa} style={btnPrimary(T.copper[500])}>
              {busy ? 'Guardando...' : 'Guardar precios'}
            </button>
          </div>
        </div>
      ) : (
        <>
          {(corriente.priceMesa > 0 || corriente.priceLlevar > 0) ? (
            <div style={{
              padding: '10px 12px', borderRadius: 10, background: '#fff',
              marginBottom: 10, border: `1px solid ${T.neutral[100]}`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
                <span style={{ fontSize: 12.5, color: T.neutral[600] }}>Para mesa</span>
                <span style={{ fontSize: 14, fontWeight: 800, color: T.neutral[900], fontVariantNumeric: 'tabular-nums' }}>
                  {fmtCOP(corriente.priceMesa || 0)}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ fontSize: 12.5, color: T.neutral[600] }}>Para llevar</span>
                <span style={{ fontSize: 14, fontWeight: 800, color: T.neutral[900], fontVariantNumeric: 'tabular-nums' }}>
                  {fmtCOP(corriente.priceLlevar || 0)}
                </span>
              </div>
            </div>
          ) : null}
          <button onClick={() => setEditing(true)} disabled={busy} style={btnGhost(T.copper[600])}>
            ✎ {corriente.priceMesa > 0 ? 'Cambiar precios' : 'Definir precios'}
          </button>
        </>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Botón "Copiar lo de ayer"
// ──────────────────────────────────────────────────────────────
function CopyYesterdayCard({ today, authUser, adminName }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)

  async function handleCopy() {
    if (busy) return
    setBusy(true); setError(null)
    try {
      const yesterday = previousDateStr(today)
      const ok = await copyMenuFromDate(yesterday, today, {
        publishedBy: authUser.uid,
        publishedByName: adminName,
      })
      if (!ok) {
        setError('No hay menú del día anterior para copiar.')
      } else {
        setDone(true)
      }
    } catch (err) {
      console.error('[menu] copy failed:', err)
      setError('No pudimos copiar el menú. Intenta de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  if (done) return null

  return (
    <div style={{
      padding: '12px 14px', borderRadius: 14, marginBottom: 14,
      background: T.neutral[100], border: `1px dashed ${T.neutral[300]}`,
    }}>
      <div style={{ fontSize: 13, color: T.neutral[700], marginBottom: 8, lineHeight: 1.4 }}>
        ¿Mismo menú que ayer? Cópialo y solo ajusta lo que cambia.
      </div>
      <button
        onClick={handleCopy}
        disabled={busy}
        style={{
          width: '100%', padding: '11px 14px', borderRadius: 12,
          background: T.neutral[800], color: '#fff',
          border: 'none', cursor: busy ? 'wait' : 'pointer',
          fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700,
          opacity: busy ? 0.7 : 1,
        }}
      >
        {busy ? 'Copiando...' : '📋 Copiar lo de ayer'}
      </button>
      {error && (
        <div style={{
          marginTop: 8, padding: '8px 10px', borderRadius: 8,
          background: '#FBE9E5', border: `1px solid #F0C8BE`,
          color: T.bad, fontSize: 12, textAlign: 'center',
        }}>
          {error}
        </div>
      )}
    </div>
  )
}

function CategorySection({ category, items, activeIds, onToggle }) {
  const activeCount = items.filter(it => activeIds.has(it.id)).length
  const subtitle = category.multi
    ? `${activeCount} de ${items.length} activas`
    : activeCount > 0 ? 'Definida' : 'Sin definir'

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        margin: '0 4px 8px',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 16 }}>{category.emoji}</span>
          <div style={{
            fontSize: 14, fontWeight: 800, color: T.neutral[900],
            letterSpacing: -0.2,
          }}>
            {category.label}
          </div>
          {!category.multi && (
            <span style={{
              fontSize: 10, fontWeight: 700, color: T.neutral[500],
              letterSpacing: 0.4, textTransform: 'uppercase',
              padding: '2px 7px', borderRadius: 999,
              background: T.neutral[100],
            }}>
              Una sola
            </span>
          )}
        </div>
        <div style={{ fontSize: 11.5, color: T.neutral[500], fontWeight: 600 }}>
          {subtitle}
        </div>
      </div>

      {items.length === 0 ? (
        <div style={{
          padding: '14px', textAlign: 'center', borderRadius: 12,
          background: T.neutral[50], border: `1px dashed ${T.neutral[200]}`,
          color: T.neutral[500], fontSize: 12.5,
        }}>
          Sin opciones en el catálogo. Agrégalas en la pestaña Catálogo.
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {items.map(item => {
            const active = activeIds.has(item.id)
            return (
              <button
                key={item.id}
                onClick={() => onToggle(item.id)}
                style={{
                  padding: '10px 16px', borderRadius: 12,
                  background: active ? T.copper[500] : '#fff',
                  color: active ? '#fff' : T.neutral[700],
                  border: `1.5px solid ${active ? T.copper[500] : T.neutral[200]}`,
                  cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 14, fontWeight: 700,
                  display: 'flex', alignItems: 'center', gap: 8,
                  transition: 'background 0.15s, border-color 0.15s',
                  boxShadow: active ? '0 3px 10px rgba(184,122,86,0.3)' : 'none',
                }}
              >
                {active && (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M2 7 L6 11 L12 4" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
                {item.name}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function SpecialSection({ dailyMenu, date, authUser, adminName }) {
  const special = dailyMenu?.special || { active: false }
  const [editing, setEditing] = useState(false)
  const [priceMesa, setPriceMesa] = useState(String(special.priceMesa || ''))
  const [priceLlevar, setPriceLlevar] = useState(String(special.priceLlevar || ''))
  const [description, setDescription] = useState(special.description || '')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!editing) {
      setPriceMesa(String(special.priceMesa || ''))
      setPriceLlevar(String(special.priceLlevar || ''))
      setDescription(special.description || '')
    }
  }, [editing, special.priceMesa, special.priceLlevar, special.description])

  async function handleSave() {
    const pm = Number(priceMesa) || 0
    const pl = Number(priceLlevar) || 0
    if (pm <= 0) return
    setBusy(true)
    try {
      await setDailySpecial(date, {
        active: true,
        priceMesa: pm,
        priceLlevar: pl || pm,
        description,
      }, { publishedBy: authUser.uid, publishedByName: adminName })
      setEditing(false)
    } finally {
      setBusy(false)
    }
  }

  async function handleDeactivate() {
    setBusy(true)
    try {
      await setDailySpecial(date, { active: false }, { publishedBy: authUser.uid, publishedByName: adminName })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{
      marginTop: 24, padding: '14px 16px', borderRadius: 16,
      background: special.active ? '#FFF7E6' : T.neutral[50],
      border: `1.5px solid ${special.active ? '#F4E0BC' : T.neutral[200]}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 18 }}>⭐</span>
        <div style={{ fontSize: 14, fontWeight: 800, color: T.neutral[900] }}>
          Almuerzo Especial
        </div>
        {special.active && (
          <span style={{
            fontSize: 10, fontWeight: 700, color: T.warn,
            letterSpacing: 0.4, textTransform: 'uppercase',
            padding: '2px 7px', borderRadius: 999,
            background: '#fff', border: `1px solid #F4E0BC`,
          }}>
            Activo hoy
          </span>
        )}
      </div>
      <div style={{ fontSize: 12, color: T.neutral[600], marginBottom: 12, lineHeight: 1.5 }}>
        Sin categorías. La cajera lo vende como un almuerzo aparte con la descripción que pongas.
      </div>

      {editing ? (
        <div>
          <FieldLabel>Precio para mesa ($)</FieldLabel>
          <input type="number" value={priceMesa} onChange={e => setPriceMesa(e.target.value)}
            placeholder="Ej. 20000" style={inputStyle()} />
          <FieldLabel>Precio para llevar ($)</FieldLabel>
          <input type="number" value={priceLlevar} onChange={e => setPriceLlevar(e.target.value)}
            placeholder="Si no pones, se usa el de mesa" style={inputStyle()} />
          <FieldLabel>Qué incluye <span style={{ color: T.neutral[400], fontWeight: 500 }}>· opcional</span></FieldLabel>
          <textarea value={description} onChange={e => setDescription(e.target.value)}
            placeholder="Ej: Bandeja paisa con aguacate, jugo natural"
            rows={2}
            style={{ ...inputStyle(), resize: 'vertical', minHeight: 60 }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button onClick={() => setEditing(false)} disabled={busy} style={btnSecondary()}>Cancelar</button>
            <button onClick={handleSave} disabled={busy || !priceMesa} style={btnPrimary(T.warn)}>
              {busy ? 'Guardando...' : 'Activar especial'}
            </button>
          </div>
        </div>
      ) : (
        <div>
          {special.active ? (
            <>
              <div style={{
                padding: '12px 14px', borderRadius: 12, background: '#fff',
                marginBottom: 10, border: `1px solid #F4E0BC`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
                  <span style={{ fontSize: 12.5, color: T.neutral[600] }}>Para mesa</span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: T.warn, fontVariantNumeric: 'tabular-nums' }}>
                    {fmtCOP(special.priceMesa || 0)}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ fontSize: 12.5, color: T.neutral[600] }}>Para llevar</span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: T.warn, fontVariantNumeric: 'tabular-nums' }}>
                    {fmtCOP(special.priceLlevar || 0)}
                  </span>
                </div>
                {special.description && (
                  <div style={{
                    marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${T.neutral[200]}`,
                    fontSize: 12.5, color: T.neutral[700], lineHeight: 1.45, fontStyle: 'italic',
                  }}>
                    "{special.description}"
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setEditing(true)} disabled={busy} style={btnGhost()}>
                  ✎ Editar
                </button>
                <button onClick={handleDeactivate} disabled={busy} style={btnGhost(T.bad)}>
                  Desactivar especial
                </button>
              </div>
            </>
          ) : (
            <button onClick={() => setEditing(true)} disabled={busy} style={btnPrimary(T.warn)}>
              + Activar especial de hoy
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// VISTA 3: Catálogo permanente
// ──────────────────────────────────────────────────────────────
function CatalogView({ authUser, userDoc }) {
  const [allItems, setAllItems] = useState([])
  const [creatingFor, setCreatingFor] = useState(null) // categoryId
  const [editing, setEditing] = useState(null) // item
  const cookName = `${userDoc?.nombre || ''} ${userDoc?.apellido || ''}`.trim() || authUser?.email || 'Cocinera'

  useEffect(() => watchMenuItems(setAllItems), [])

  const itemsByCategory = useMemo(() => {
    const out = {}
    for (const cat of CATEGORY_IDS) out[cat] = []
    for (const item of allItems) {
      if (out[item.category]) out[item.category].push(item)
    }
    return out
  }, [allItems])

  return (
    <div style={{ padding: '16px 14px 80px' }}>
      <div style={{
        padding: '12px 14px', borderRadius: 12, marginBottom: 16,
        background: T.neutral[100], border: `1px solid ${T.neutral[200]}`,
        fontSize: 12.5, color: T.neutral[700], lineHeight: 1.5,
      }}>
        Aquí guardas todas las opciones que has cocinado alguna vez.
        Lo que crees aquí podrás activarlo cualquier día desde "Menú del día".
      </div>

      {CATEGORIES.map(cat => (
        <CatalogCategory
          key={cat.id}
          category={cat}
          items={itemsByCategory[cat.id]}
          onCreate={() => setCreatingFor(cat.id)}
          onEdit={(item) => setEditing(item)}
        />
      ))}

      {creatingFor && (
        <CreateMenuItemModal
          category={creatingFor}
          authUser={authUser}
          cookName={cookName}
          onCancel={() => setCreatingFor(null)}
          onCreated={() => setCreatingFor(null)}
        />
      )}

      {editing && (
        <EditMenuItemModal
          item={editing}
          onCancel={() => setEditing(null)}
          onDone={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function CatalogCategory({ category, items, onCreate, onEdit }) {
  const active = items.filter(it => !it.archived)
  const archived = items.filter(it => it.archived)

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        margin: '0 4px 8px',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 16 }}>{category.emoji}</span>
          <div style={{
            fontSize: 14, fontWeight: 800, color: T.neutral[900],
            letterSpacing: -0.2,
          }}>
            {category.label}
          </div>
          <div style={{ fontSize: 11.5, color: T.neutral[500], fontWeight: 600 }}>
            {active.length} {active.length === 1 ? 'opción' : 'opciones'}
          </div>
        </div>
        <button onClick={onCreate} style={{
          padding: '6px 12px', borderRadius: 999,
          background: T.copper[500], color: '#fff',
          border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 12, fontWeight: 700,
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          + Nueva
        </button>
      </div>

      {active.length === 0 && archived.length === 0 ? (
        <div style={{
          padding: '14px', textAlign: 'center', borderRadius: 12,
          background: T.neutral[50], border: `1px dashed ${T.neutral[200]}`,
          color: T.neutral[500], fontSize: 12.5,
        }}>
          Sin opciones todavía. Toca "+ Nueva" para crear la primera.
        </div>
      ) : (
        <div style={{
          background: '#fff', borderRadius: 12,
          border: `1px solid ${T.neutral[100]}`,
          overflow: 'hidden',
        }}>
          {active.map((item, i) => (
            <CatalogItemRow
              key={item.id}
              item={item}
              isLast={i === active.length - 1 && archived.length === 0}
              onEdit={() => onEdit(item)}
            />
          ))}
          {archived.map((item, i) => (
            <CatalogItemRow
              key={item.id}
              item={item}
              isLast={i === archived.length - 1}
              onEdit={() => onEdit(item)}
              archived
            />
          ))}
        </div>
      )}
    </div>
  )
}

function CatalogItemRow({ item, isLast, onEdit, archived }) {
  return (
    <div style={{
      padding: '12px 14px',
      borderBottom: isLast ? 'none' : `0.5px solid ${T.neutral[100]}`,
      display: 'flex', alignItems: 'center', gap: 10,
      opacity: archived ? 0.55 : 1,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14, fontWeight: 700, color: T.neutral[900],
          textDecoration: archived ? 'line-through' : 'none',
        }}>
          {item.name}
        </div>
        {archived && (
          <div style={{ fontSize: 10.5, color: T.neutral[500], marginTop: 1, letterSpacing: 0.3 }}>
            Archivado
          </div>
        )}
      </div>
      <button onClick={onEdit} style={{
        padding: '6px 10px', borderRadius: 8,
        background: 'transparent', color: T.neutral[600],
        border: `1px solid ${T.neutral[200]}`,
        cursor: 'pointer', fontFamily: 'inherit',
        fontSize: 11.5, fontWeight: 700,
      }}>
        ✎ Editar
      </button>
    </div>
  )
}

function CreateMenuItemModal({ category, authUser, cookName, onCancel, onCreated }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const cat = CATEGORY_BY_ID[category]

  async function handleCreate() {
    if (!name.trim() || busy) return
    setBusy(true); setError(null)
    try {
      await createMenuItem({
        category,
        name,
        createdBy: authUser.uid,
        createdByName: cookName,
      })
      onCreated()
    } catch (err) {
      console.error('[menu] create error:', err)
      setError('No pudimos crear la opción.')
      setBusy(false)
    }
  }

  return (
    <ModalOverlay onClose={busy ? undefined : onCancel}>
      <ModalCard>
        <ModalTitle>Nueva opción · {cat.label}</ModalTitle>
        <ModalSub>Esta opción quedará en tu catálogo permanente.</ModalSub>
        <FieldLabel>Nombre</FieldLabel>
        <input
          type="text" value={name} onChange={e => setName(e.target.value)}
          placeholder={`Ej: ${exampleByCategory(category)}`}
          autoFocus maxLength={60}
          style={inputStyle()}
        />
        {error && <ErrorBox>{error}</ErrorBox>}
        <ModalActions
          onCancel={onCancel}
          onConfirm={handleCreate}
          confirmLabel={busy ? 'Creando...' : 'Crear'}
          confirmDisabled={busy || !name.trim()}
          confirmColor={T.copper[500]}
        />
      </ModalCard>
    </ModalOverlay>
  )
}

function exampleByCategory(catId) {
  return {
    soup: 'Sopa de verduras',
    principio: 'Frijoles',
    protein: 'Carne de cerdo',
    side: 'Arroz blanco',
    salad: 'Ensalada de tomate',
    juice: 'Jugo de mora',
  }[catId] || 'Nombre'
}

function EditMenuItemModal({ item, onCancel, onDone }) {
  const [name, setName] = useState(item.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function handleSave() {
    if (!name.trim() || busy) return
    setBusy(true); setError(null)
    try {
      await renameMenuItem(item.id, name)
      onDone()
    } catch (err) {
      console.error(err); setError('No pudimos guardar.')
      setBusy(false)
    }
  }

  async function handleArchiveToggle() {
    setBusy(true); setError(null)
    try {
      if (item.archived) await unarchiveMenuItem(item.id)
      else await archiveMenuItem(item.id)
      onDone()
    } catch (err) {
      console.error(err); setError('No pudimos archivar.')
      setBusy(false)
    }
  }

  return (
    <ModalOverlay onClose={busy ? undefined : onCancel}>
      <ModalCard>
        <ModalTitle>Editar opción</ModalTitle>
        <ModalSub>{CATEGORY_BY_ID[item.category]?.label}</ModalSub>
        <FieldLabel>Nombre</FieldLabel>
        <input
          type="text" value={name} onChange={e => setName(e.target.value)}
          autoFocus maxLength={60}
          style={inputStyle()}
        />
        {error && <ErrorBox>{error}</ErrorBox>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={handleArchiveToggle} disabled={busy} style={btnGhost(item.archived ? T.copper[600] : T.bad)}>
            {item.archived ? '↺ Reactivar' : '🗂 Archivar'}
          </button>
          <button onClick={onCancel} disabled={busy} style={btnSecondary()}>Cerrar</button>
          <button onClick={handleSave} disabled={busy || !name.trim()} style={btnPrimary(T.copper[500])}>
            {busy ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </div>
      </ModalCard>
    </ModalOverlay>
  )
}

// ──────────────────────────────────────────────────────────────
// Avatar menu y sign-out (idénticos a CashierApp)
// ──────────────────────────────────────────────────────────────
function AvatarMenuOverlay({ authUser, userDoc, onCancel, onSignOut }) {
  return (
    <ModalOverlay onClose={onCancel}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 340, background: '#fff', borderRadius: 20,
        padding: '20px 0 12px', boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '0 22px 16px', borderBottom: `1px solid ${T.neutral[100]}`,
        }}>
          <UserAvatar user={authUser} size={44} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 14.5, fontWeight: 700, color: T.neutral[900],
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {userDoc?.nombre} {userDoc?.apellido}
            </div>
            <div style={{
              fontSize: 11.5, color: T.neutral[500],
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {authUser?.email}
            </div>
          </div>
        </div>
        <ContactSupportButton
          variant="menu"
          reason="Algo no funciona en la app de cocina"
          userContext={`Cuenta: ${authUser?.email || ''} (${userDoc?.nombre || ''} ${userDoc?.apellido || ''})`}
          onClick={onCancel}
        />

        <button onClick={onSignOut} style={{
          width: '100%', padding: '14px 22px',
          background: 'transparent', border: 'none',
          cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 14.5, fontWeight: 600, color: T.bad,
          display: 'flex', alignItems: 'center', gap: 14,
          textAlign: 'left',
        }}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M8 4 L4 4 L4 16 L8 16" stroke={T.bad} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M11 7 L15 10 L11 13 M15 10 H7" stroke={T.bad} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span style={{ flex: 1 }}>Cerrar sesión</span>
        </button>
        <div style={{ padding: '8px 12px 0' }}>
          <button onClick={onCancel} style={{
            width: '100%', padding: '10px', borderRadius: 12,
            background: T.neutral[100], color: T.neutral[700],
            border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 13.5, fontWeight: 600,
          }}>Cancelar</button>
        </div>
      </div>
    </ModalOverlay>
  )
}

function SignOutModal({ onCancel, onConfirm }) {
  const [busy, setBusy] = useState(false)
  return (
    <ModalOverlay onClose={busy ? undefined : onCancel}>
      <ModalCard>
        <ModalTitle>Cerrar sesión</ModalTitle>
        <ModalSub>¿Seguro que quieres salir?</ModalSub>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCancel} disabled={busy} style={btnSecondary()}>Cancelar</button>
          <button
            onClick={async () => { setBusy(true); await onConfirm() }}
            disabled={busy}
            style={btnPrimary(T.bad)}
          >
            {busy ? 'Saliendo...' : 'Cerrar sesión'}
          </button>
        </div>
      </ModalCard>
    </ModalOverlay>
  )
}

// ──────────────────────────────────────────────────────────────
// Componentes utilitarios
// ──────────────────────────────────────────────────────────────
function ModalOverlay({ onClose, children }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 90,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      {children}
    </div>
  )
}
function ModalCard({ children }) {
  return (
    <div onClick={e => e.stopPropagation()} style={{
      width: '100%', maxWidth: 460, background: '#fff', borderRadius: 22,
      padding: '24px 22px 22px', boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
      maxHeight: '94vh', overflowY: 'auto',
    }}>
      {children}
    </div>
  )
}
function ModalTitle({ children }) {
  return <div style={{ fontSize: 18, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3 }}>{children}</div>
}
function ModalSub({ children }) {
  return <div style={{ fontSize: 12.5, color: T.neutral[500], marginTop: 4, marginBottom: 16, lineHeight: 1.5 }}>{children}</div>
}
function ModalActions({ onCancel, onConfirm, confirmLabel, confirmDisabled, confirmColor }) {
  return (
    <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
      <button onClick={onCancel} style={btnSecondary()}>Cancelar</button>
      <button
        onClick={onConfirm}
        disabled={confirmDisabled}
        style={{
          ...btnPrimary(confirmDisabled ? T.neutral[200] : confirmColor),
          opacity: confirmDisabled ? 0.6 : 1,
          cursor: confirmDisabled ? 'not-allowed' : 'pointer',
        }}
      >
        {confirmLabel}
      </button>
    </div>
  )
}
function FieldLabel({ children }) {
  return (
    <div style={{
      fontSize: 11.5, fontWeight: 700, color: T.neutral[600],
      letterSpacing: 0.3, textTransform: 'uppercase',
      marginBottom: 6, marginTop: 4,
    }}>
      {children}
    </div>
  )
}
function inputStyle() {
  return {
    width: '100%', padding: '11px 12px', borderRadius: 12,
    border: `1.5px solid ${T.neutral[200]}`,
    fontSize: 14, fontFamily: 'inherit',
    background: '#fff', color: T.neutral[900],
    outline: 'none', marginBottom: 12,
    boxSizing: 'border-box',
  }
}
function btnPrimary(bg) {
  return {
    flex: 1.4, padding: '12px', borderRadius: 12,
    background: bg, color: '#fff',
    border: 'none', cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
    boxShadow: `0 3px 10px ${bg}44`,
  }
}
function btnSecondary() {
  return {
    flex: 1, padding: '12px', borderRadius: 12,
    background: T.neutral[100], color: T.neutral[700],
    border: 'none', cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
  }
}
function btnGhost(color) {
  const c = color || T.neutral[700]
  return {
    padding: '11px 14px', borderRadius: 12,
    background: 'transparent', color: c,
    border: `1.5px solid ${c}33`,
    cursor: 'pointer', fontFamily: 'inherit',
    fontSize: 13.5, fontWeight: 700,
  }
}
function ErrorBox({ children }) {
  return (
    <div style={{
      marginBottom: 10, padding: '10px 12px', borderRadius: 10,
      background: '#FBE9E5', border: `1px solid #F0C8BE`, color: T.bad,
      fontSize: 12.5, fontWeight: 500, textAlign: 'center',
    }}>
      {children}
    </div>
  )
}

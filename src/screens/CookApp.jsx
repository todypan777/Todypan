import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { T } from '../tokens'
import { UserAvatar } from '../components/Atoms'
import { signOut } from '../auth'
import {
  CORRIENTE_CATEGORIES, SPECIAL_CATEGORIES,
  watchMenuItems, watchDailyMenu, watchCorrienteConfig, resolveDailyMenu,
} from '../menu'
import { useBogotaDate } from '../utils/useBogotaDate'
import {
  watchKitchenQueue, watchKitchenArchivedForDate,
  markOrderReady, unmarkOrderReady, markOrderDelivered,
} from '../kitchenOrders'
import { watchOpenSessions } from '../cashSessions'
import { createKitchenCall, cancelKitchenCall, watchMyPendingCalls } from '../kitchenCalls'
import { setupAudioUnlock, playNewOrderSound } from '../utils/notificationSound'
import { getData } from '../db'
import ContactSupportButton from '../components/ContactSupportButton'
import CatalogView from '../components/MenuEditor/CatalogView'
import DailyMenuCard from '../components/MenuEditor/DailyMenuCard'
import MenuWizard from '../components/MenuEditor/MenuWizard'
import MenuEditView from '../components/MenuEditor/MenuEditView'
import {
  ModalOverlay, ModalCard, ModalTitle, ModalSub,
  btnPrimary, btnSecondary,
} from '../components/MenuEditor/ui'

// ──────────────────────────────────────────────────────────────
// CookApp: vista de cocina.
//   Tabs: Hoy (cola FIFO) · Menú (qué hay hoy) · Catálogo
//
// Props:
//   authUser, userDoc → identidad del editor (cocinera o admin asistiendo).
//   assistMode (opt)  → { onExit } cuando el admin entra desde el dashboard.
//                       Activa selector de fecha en "Hoy", reemplaza la
//                       top bar por una con flecha de volver y oculta el
//                       avatar/logout.
// ──────────────────────────────────────────────────────────────
export default function CookApp({ authUser, userDoc, assistMode }) {
  const [tab, setTab] = useState('today')
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmSignOut, setConfirmSignOut] = useState(false)

  // Overlays del menú del día.
  //   'wizard'  → MenuWizard (crear desde cero)
  //   'edit'    → MenuEditView (editar publicado)
  //   null      → ninguno
  const [menuOverlay, setMenuOverlay] = useState(null)

  const today = useBogotaDate()
  // Fecha seleccionada para la pestaña "Hoy". Cocinera = siempre hoy.
  // Admin (assistMode) puede navegar a otros días con un selector.
  const [selectedDate, setSelectedDate] = useState(today)
  // Si el reloj cruza medianoche y la cocinera está abierta, useBogotaDate
  // actualiza `today`. En ese caso saltamos al nuevo día automáticamente.
  // En admin no lo hacemos porque pudo navegar manualmente a otra fecha.
  useEffect(() => {
    if (!assistMode) setSelectedDate(today)
  }, [today, assistMode])

  const [queue, setQueue] = useState([])
  useEffect(() => watchKitchenQueue(setQueue), [])

  // Archivados del día seleccionado (delivered + cancelled). El watcher
  // principal solo trae pending/ready, así que cuando la cajera cobra el
  // pedido pasa a 'delivered' y desaparece de la vista. Este watcher trae
  // ese histórico para que la cocinera no vea que "se borran".
  const [archivedForDate, setArchivedForDate] = useState([])
  useEffect(
    () => watchKitchenArchivedForDate(selectedDate, setArchivedForDate),
    [selectedDate],
  )

  // Datos del menú del día para la tarjeta arriba de Hoy.
  // Solo se suscribe cuando se ve hoy real (no para fechas pasadas en
  // assist mode — ahí la tarjeta no aparece).
  const [allMenuItems, setAllMenuItems] = useState([])
  const [dailyMenu, setDailyMenu] = useState(null)
  const [corrienteConfig, setCorrienteConfig] = useState(null)
  useEffect(() => watchMenuItems(setAllMenuItems), [])
  useEffect(() => watchDailyMenu(today, setDailyMenu), [today])
  useEffect(() => watchCorrienteConfig(setCorrienteConfig), [])

  // Desbloquea el audio al primer toque (iOS/Safari lo exigen) para que el
  // sonido de "pedido nuevo" pueda sonar luego sin gesto directo.
  useEffect(() => { setupAudioUnlock() }, [])

  const publisherName = `${userDoc?.nombre || ''} ${userDoc?.apellido || ''}`.trim()
    || authUser?.email || 'Editor'

  const pendingCount = useMemo(
    () => queue.filter(o =>
      o.status === 'pending' && bogotaDateOfOrder(o) === today
    ).length,
    [queue, today]
  )

  const isAssist = !!assistMode

  return (
    <div style={{
      minHeight: '100dvh', background: T.neutral[50],
      fontFamily: '-apple-system, "SF Pro Text", "Inter", system-ui, sans-serif',
      color: T.neutral[800],
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
    }}>
      {isAssist ? (
        <AssistTopBar
          userDoc={userDoc}
          onExit={() => assistMode.onExit?.()}
        />
      ) : (
        <CookTopBar
          authUser={authUser}
          userDoc={userDoc}
          onMenu={() => setMenuOpen(true)}
        />
      )}

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
          active={tab === 'catalog'}
          onClick={() => setTab('catalog')}
          label="Catálogo"
        />
      </div>

      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        {tab === 'today' && (
          <>
            {isAssist && (
              <DateNavigator
                today={today}
                value={selectedDate}
                onChange={setSelectedDate}
              />
            )}
            {/* Tarjeta del menú del día. Solo cuando la fecha activa
                coincide con hoy real (no en navegación a fechas pasadas). */}
            {selectedDate === today && (
              <DailyMenuCard
                dailyMenu={dailyMenu}
                allMenuItems={allMenuItems}
                corrienteConfig={corrienteConfig}
                today={today}
                authUser={authUser}
                publisherName={publisherName}
                onCreate={() => setMenuOverlay('wizard')}
                onEdit={() => setMenuOverlay('edit')}
              />
            )}
            <KitchenQueueView
              queue={queue}
              archivedForDate={archivedForDate}
              selectedDate={selectedDate}
              today={today}
              dailyMenu={dailyMenu}
              allMenuItems={allMenuItems}
            />
          </>
        )}
        {tab === 'catalog' && (
          <CatalogView authUser={authUser} userDoc={userDoc} />
        )}
      </div>

      {menuOverlay === 'wizard' && (
        <MenuWizard
          today={today}
          authUser={authUser}
          publisherName={publisherName}
          allMenuItems={allMenuItems}
          onClose={() => setMenuOverlay(null)}
          onDone={() => setMenuOverlay(null)}
        />
      )}

      {menuOverlay === 'edit' && (
        <MenuEditView
          today={today}
          authUser={authUser}
          publisherName={publisherName}
          allMenuItems={allMenuItems}
          dailyMenu={dailyMenu}
          corrienteConfig={corrienteConfig}
          onClose={() => setMenuOverlay(null)}
          onGoToCatalog={() => { setMenuOverlay(null); setTab('catalog') }}
        />
      )}

      {/* Botón flotante para llamar a la cajera de Panadería B.
          Visible tanto para la cocinera real como para el admin en
          assistMode — al admin le sirve cuando está cubriendo cocina y
          también necesita pedir apoyo. La llamada queda registrada con el
          authUser real (admin o cocinera), no se enmascara. */}
      <CallCashierFAB
        authUser={authUser}
        userDoc={userDoc}
      />

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

// Bogota date string (YYYY-MM-DD) del createdAt de una order.
// Usado para filtrar la cola por día seleccionado.
function bogotaDateOfOrder(order) {
  const ms = order.createdAt?.toMillis?.() ?? order.createdAtClient ?? 0
  if (!ms) return null
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
}

// Último timestamp relevante de una orden (para ordenar archivados):
// prioriza el evento más reciente del ciclo de vida.
function orderTouchedMs(o) {
  return o.deliveredAt?.toMillis?.()
    ?? o.cancelledAt?.toMillis?.()
    ?? o.readyAt?.toMillis?.()
    ?? o.readyAtClient
    ?? o.createdAt?.toMillis?.()
    ?? o.createdAtClient
    ?? 0
}
function lastTouchedMs(group) {
  let max = 0
  for (const o of group.orders) {
    const t = orderTouchedMs(o)
    if (t > max) max = t
  }
  return max
}

// ──────────────────────────────────────────────────────────────
// Top bar normal de la cocinera
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

// Top bar para el admin cuando entra en modo "Asistir cocinera".
// Reemplaza al CookTopBar para dejar claro el contexto.
function AssistTopBar({ userDoc, onExit }) {
  return (
    <div style={{
      padding: '14px 18px',
      display: 'flex', alignItems: 'center', gap: 12,
      background: '#FFF7E6',
      borderBottom: `1px solid #F4E0BC`,
      position: 'sticky', top: 0, zIndex: 20,
      height: 60, boxSizing: 'border-box',
    }}>
      <button
        onClick={onExit}
        aria-label="Volver al panel admin"
        style={{
          width: 36, height: 36, borderRadius: 999,
          background: '#fff', border: `1.5px solid #F4E0BC`,
          cursor: 'pointer', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M9 2 L3 7 L9 12" stroke="#7A5C00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 900, color: '#7A5C00', letterSpacing: -0.2 }}>
          Asistiendo en la cocina
        </div>
        <div style={{
          fontSize: 11, color: '#9A7200',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {userDoc?.nombre} {userDoc?.apellido} · La cocinera ve los mismos cambios al instante
        </div>
      </div>
    </div>
  )
}

// Navegador de fecha (solo visible en modo asistir).
// Flechas para retroceder/avanzar día + botón "Hoy" para volver rápido.
function DateNavigator({ today, value, onChange }) {
  function shiftDay(delta) {
    const d = new Date(value + 'T12:00:00')
    d.setDate(d.getDate() + delta)
    onChange(d.toISOString().slice(0, 10))
  }
  const isToday = value === today
  const label = formatHumanDate(value, today)

  return (
    <div style={{
      margin: '14px 14px 4px',
      padding: '10px 12px', borderRadius: 14,
      background: '#fff', border: `1px solid ${T.neutral[200]}`,
      display: 'flex', alignItems: 'center', gap: 8,
      boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
    }}>
      <button onClick={() => shiftDay(-1)} aria-label="Día anterior" style={navBtnStyle()}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M9 2 L3 7 L9 12" stroke={T.neutral[700]} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      <div style={{
        flex: 1, textAlign: 'center',
        fontSize: 13.5, fontWeight: 700, color: T.neutral[900],
        letterSpacing: -0.2, textTransform: 'capitalize',
      }}>
        {label}
      </div>
      <button onClick={() => shiftDay(1)} aria-label="Día siguiente" style={navBtnStyle()}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M5 2 L11 7 L5 12" stroke={T.neutral[700]} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {!isToday && (
        <button
          onClick={() => onChange(today)}
          style={{
            padding: '6px 12px', borderRadius: 999,
            background: T.copper[500], color: '#fff',
            border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 11.5, fontWeight: 800, letterSpacing: 0.3,
            flexShrink: 0,
          }}
        >
          Hoy
        </button>
      )}
    </div>
  )
}
function navBtnStyle() {
  return {
    width: 32, height: 32, borderRadius: 999,
    background: T.neutral[100], border: 'none',
    cursor: 'pointer', flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: 'inherit',
  }
}
function formatHumanDate(dateStr, todayStr) {
  if (!dateStr) return ''
  if (dateStr === todayStr) {
    // Fecha humana de hoy
    const d = new Date(todayStr + 'T12:00:00')
    return `Hoy · ${humanDate(d)}`
  }
  const d = new Date(dateStr + 'T12:00:00')
  // Detectar ayer (1 día antes de hoy)
  const t = new Date(todayStr + 'T12:00:00')
  const dayDiff = Math.round((t - d) / 86400000)
  if (dayDiff === 1) return `Ayer · ${humanDate(d)}`
  if (dayDiff === -1) return `Mañana · ${humanDate(d)}`
  return humanDate(d)
}
function humanDate(d) {
  const days = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado']
  const months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
  return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]}`
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
//
// Recibe DOS streams:
//   - queue            → pending + ready, sin filtro de día (cola viva)
//   - archivedForDate  → delivered + cancelled del día seleccionado
//
// Antes solo veía la cola viva — cuando la cajera cobraba, los pedidos
// pasaban a 'delivered' y desaparecían de Archivados (la cocinera lo
// percibía como "se borraron"). Ahora fusionamos ambos streams para que
// el histórico del día siga visible.
//
// Filtra TODO por `selectedDate` (Bogotá). Cocinera = siempre hoy, admin
// (assist mode) puede navegar con el DateNavigator.
// ──────────────────────────────────────────────────────────────
function KitchenQueueView({ queue, archivedForDate, selectedDate, today, dailyMenu, allMenuItems }) {
  const lastIdsRef = useRef(new Set())
  const [archivedExpanded, setArchivedExpanded] = useState(false)

  // Nombres de las opciones del día por categoría → para que cocina vea
  // "SIN TAJADAS" (el acompañante real) en vez de "SIN ACOMPAÑANTE", y para
  // saber si el día tenía sopa (y así mostrar "SIN SOPA" cuando la rechazan).
  // Solo aplica cuando vemos HOY: el menú vive en el doc de hoy; para días
  // pasados caemos al nombre genérico de la categoría.
  const servedInfo = useMemo(() => {
    if (selectedDate !== today) return null
    const resolved = resolveDailyMenu(dailyMenu, allMenuItems)
    const byCat = {}
    for (const cat of CORRIENTE_CATEGORIES) {
      byCat[cat.id] = (resolved[cat.id] || []).map(it => it.name)
    }
    return byCat
  }, [dailyMenu, allMenuItems, selectedDate, today])

  // Pending/ready del día seleccionado.
  const queueForDate = useMemo(
    () => queue.filter(o => bogotaDateOfOrder(o) === selectedDate),
    [queue, selectedDate]
  )

  // Vibrar y disparar animación cuando llegan pedidos nuevos (solo si
  // estamos viendo HOY — para días pasados es ruido).
  useEffect(() => {
    if (selectedDate !== today) {
      lastIdsRef.current = new Set()
      return
    }
    const currentIds = new Set(queueForDate.filter(o => o.status === 'pending').map(o => o.id))
    const isNewArrival = [...currentIds].some(id => !lastIdsRef.current.has(id))
    if (isNewArrival && lastIdsRef.current.size > 0) {
      try { navigator.vibrate?.([100, 60, 100]) } catch {}
      try { playNewOrderSound() } catch {}
    }
    lastIdsRef.current = currentIds
  }, [queueForDate, selectedDate, today])

  // Fusión: si un order vive en ambos streams (transición ready→delivered
  // en vuelo), la versión de archivedForDate gana por status más nuevo.
  // El watcher de archivados ya filtra por día, pero re-filtramos por
  // seguridad por si llega un doc viejo en el rango UTC.
  const ordersForDate = useMemo(() => {
    const byId = new Map()
    for (const o of queueForDate) byId.set(o.id, o)
    for (const o of archivedForDate) {
      if (bogotaDateOfOrder(o) === selectedDate) byId.set(o.id, o)
    }
    return Array.from(byId.values())
  }, [queueForDate, archivedForDate, selectedDate])

  // Agrupar por commandaId
  const groups = useMemo(() => {
    const map = new Map()
    for (const order of ordersForDate) {
      const key = order.commandaId || order.id
      if (!map.has(key)) {
        map.set(key, {
          commandaId: key,
          tableNumber: order.tableNumber,
          tableSuffix: Number(order.tableSuffix) || 0,
          customerName: order.customerName || null,
          destination: order.destination,
          commandaNote: order.commandaNote || null,
          createdAt: order.createdAt,
          createdAtClient: order.createdAtClient,
          orders: [],
        })
      }
      map.get(key).orders.push(order)
    }
    // Ordenar los almuerzos dentro de cada grupo por createdAt asc — así
    // la cocinera ve siempre el mismo orden aunque cambien status.
    for (const g of map.values()) {
      g.orders.sort((a, b) => {
        const ta = a.createdAt?.toMillis?.() ?? a.createdAtClient ?? 0
        const tb = b.createdAt?.toMillis?.() ?? b.createdAtClient ?? 0
        return ta - tb
      })
    }
    return Array.from(map.values())
  }, [ordersForDate])

  // PREPARANDO: grupos con al menos un almuerzo pendiente.
  // ARCHIVADOS: grupos sin pendientes (todos ready / delivered / cancelled).
  //   - ready     = cocina terminó pero la cajera aún no cobra
  //   - delivered = la cajera ya cobró (vendido)
  //   - cancelled = pedido anulado (mesa eliminada, item retirado…)
  const pendingGroups = useMemo(
    () => groups.filter(g => g.orders.some(o => o.status === 'pending')),
    [groups]
  )

  const archivedGroups = useMemo(() => {
    const archived = groups.filter(g => g.orders.every(o => o.status !== 'pending'))
    return archived.sort((a, b) => {
      const ta = lastTouchedMs(a)
      const tb = lastTouchedMs(b)
      return tb - ta
    })
  }, [groups])

  // Conteo de almuerzos archivados que cuentan como "vendidos" — excluye
  // cancelados. El usuario lo lee como "cuántos almuerzos vendí hoy".
  const archivedSoldCount = useMemo(
    () => archivedGroups.reduce(
      (sum, g) => sum + g.orders.filter(o => o.status !== 'cancelled').length,
      0,
    ),
    [archivedGroups],
  )
  const archivedCancelledCount = useMemo(
    () => archivedGroups.reduce(
      (sum, g) => sum + g.orders.filter(o => o.status === 'cancelled').length,
      0,
    ),
    [archivedGroups],
  )

  // Para días pasados, auto-expandir archivados (no hay nada que cocinar,
  // el admin entra a auditar). Para hoy, mantener colapsado por defecto.
  const isPastDay = selectedDate !== today
  const archivedDefaultOpen = isPastDay

  if (groups.length === 0) {
    return (
      <div style={{
        padding: '60px 28px', textAlign: 'center',
      }}>
        <div style={{ fontSize: 64, marginBottom: 14 }}>🥣</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: T.neutral[800], marginBottom: 6 }}>
          {isPastDay ? 'Sin pedidos en esa fecha' : 'Sin pedidos pendientes'}
        </div>
        <div style={{ fontSize: 13, color: T.neutral[500], maxWidth: 320, margin: '0 auto', lineHeight: 1.55 }}>
          {isPastDay
            ? 'No hay registro de comandas para ese día.'
            : 'Cuando una cajera envíe una comanda, aparecerá aquí. Las más antiguas siempre arriba.'}
        </div>
      </div>
    )
  }

  const expanded = archivedExpanded || archivedDefaultOpen

  return (
    <div style={{ padding: '14px 12px 80px' }}>
      {pendingGroups.length > 0 && (
        <>
          <SectionLabel
            color={T.copper[700]}
            bg={T.copper[50]}
            label={`🍳 PREPARANDO · ${pendingGroups.length}`}
          />
          {pendingGroups.map(group => (
            <CommandaCard key={group.commandaId} group={group} servedInfo={servedInfo} />
          ))}
        </>
      )}

      {archivedGroups.length > 0 && (
        <>
          <CollapsibleSectionLabel
            color={T.ok}
            bg="#E8F4E8"
            label={`📁 ARCHIVADOS · ${archivedSoldCount} ${archivedSoldCount === 1 ? 'almuerzo' : 'almuerzos'}`}
            subtitle={(() => {
              const parts = []
              if (archivedCancelledCount > 0) {
                parts.push(`${archivedCancelledCount} cancelado${archivedCancelledCount === 1 ? '' : 's'} (no cuentan)`)
              }
              parts.push(expanded ? 'Toca para ocultar.' : 'Toca para ver detalle.')
              return parts.join(' · ')
            })()}
            expanded={expanded}
            onToggle={() => setArchivedExpanded(prev => !prev)}
          />
          {expanded && archivedGroups.map(group => (
            <CommandaCard key={group.commandaId} group={group} servedInfo={servedInfo} />
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

function tableLabelFromGroup(group) {
  if (!group.tableNumber) return group.customerName || 'Cliente'
  const suffix = Number(group.tableSuffix) || 0
  return suffix > 0 ? `${group.tableNumber}.${suffix}` : String(group.tableNumber)
}

function CommandaCard({ group, servedInfo }) {
  // "Done" = no hay pendientes (todos ready/delivered/cancelled).
  // "AllCancelled" = grupo entero anulado → la card se ve gris.
  const allDone = group.orders.every(o => o.status !== 'pending')
  const allCancelled = group.orders.every(o => o.status === 'cancelled')
  const isLlevarTab = !group.tableNumber
  const label = tableLabelFromGroup(group)

  // Plegar/desplegar la comanda. Llega desplegada; la cocinera la pliega
  // cuando quiere "guardarla para una hora" — el título sigue visible.
  const [collapsed, setCollapsed] = useState(false)

  const startMs = group.createdAt?.toMillis?.() ?? group.createdAtClient ?? Date.now()
  const frozenEndMs = useMemo(() => {
    if (!allDone) return null
    // Tomamos el evento más reciente del ciclo de vida de cualquier
    // almuerzo del grupo (delivered > cancelled > ready). Sin esto, los
    // delivered/cancelled mostrarían "⏱ corriendo" para siempre.
    let max = 0
    for (const o of group.orders) {
      const t = orderTouchedMs(o)
      if (t > max) max = t
    }
    return max || Date.now()
  }, [allDone, group.orders])

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const intervalMs = frozenEndMs != null ? 60000 : 1000
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [frozenEndMs])

  const elapsedSecs = frozenEndMs != null
    ? Math.max(0, Math.floor((now - frozenEndMs) / 1000))
    : Math.max(0, Math.floor((now - startMs) / 1000))
  const elapsedLabel = frozenEndMs != null
    ? `Hace ${formatElapsed(elapsedSecs)}`
    : formatElapsed(elapsedSecs)
  const elapsedColor = frozenEndMs != null
    ? (allCancelled ? T.neutral[500] : T.ok)
    : elapsedSecs < 300 ? T.neutral[600] : elapsedSecs < 600 ? T.warn : T.bad
  const elapsedPrefix = frozenEndMs != null ? (allCancelled ? '✕' : '✓') : '⏱'

  const destBg = allCancelled
    ? T.neutral[100]
    : (isLlevarTab ? '#FFF4DD' : '#FBF5F0')
  const destBorder = allCancelled
    ? T.neutral[200]
    : (isLlevarTab ? '#F0D699' : T.copper[100])
  const destLabel = allCancelled
    ? '✕ COMANDA CANCELADA'
    : (isLlevarTab ? '📦 PARA LLEVAR' : '🍽️ EN MESA')
  const destColor = allCancelled
    ? T.neutral[600]
    : (isLlevarTab ? '#8A5E12' : T.copper[700])

  const llevarCount = group.orders.filter(o => o.destination === 'llevar').length
  const mesaCount = group.orders.filter(o => o.destination === 'mesa').length
  const isMixed = llevarCount > 0 && mesaCount > 0
  // Para el contador del header: solo los almuerzos que no están cancelados.
  const activeCount = group.orders.filter(o => o.status !== 'cancelled').length
  const cancelledCount = group.orders.length - activeCount

  // Color del borde según el estado dominante:
  //   - allCancelled → gris (toda la comanda anulada)
  //   - allDone (sin pending) → verde (cocina terminó)
  //   - resto → neutral (todavía hay algo cocinando)
  const cardBorder = allCancelled
    ? T.neutral[300]
    : (allDone ? T.ok + '88' : T.neutral[200])

  return (
    <div style={{
      marginBottom: 16,
      borderRadius: 20,
      background: '#fff',
      border: `2px solid ${cardBorder}`,
      overflow: 'hidden',
      boxShadow: '0 3px 10px rgba(0,0,0,0.06)',
      animation: 'commandaSlide 0.32s cubic-bezier(0.2,0.9,0.3,1.05)',
      opacity: allCancelled ? 0.78 : (allDone ? 0.95 : 1),
    }}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setCollapsed(c => !c)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setCollapsed(c => !c)
          }
        }}
        title={collapsed ? 'Toca para desplegar' : 'Toca para plegar'}
        style={{
          padding: '14px 18px',
          background: destBg,
          borderBottom: collapsed ? 'none' : `1.5px solid ${destBorder}`,
          display: 'flex', alignItems: 'center', gap: 12,
          cursor: 'pointer', outline: 'none',
        }}>
        <div style={{
          width: 60, height: 60, borderRadius: 14,
          background: '#fff', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
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
            {activeCount} {activeCount === 1 ? 'almuerzo' : 'almuerzos'}
            {cancelledCount > 0 && (
              <span style={{ color: T.neutral[500], fontWeight: 700, marginLeft: 6 }}>
                (+{cancelledCount} cancelado{cancelledCount === 1 ? '' : 's'})
              </span>
            )}
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
        {/* Chevron de plegado: indica si la comanda está abierta o cerrada. */}
        <div style={{
          width: 34, height: 34, borderRadius: 999, flexShrink: 0,
          background: '#fff', border: `1.5px solid ${destBorder}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'transform 0.2s',
          transform: collapsed ? 'rotate(0deg)' : 'rotate(180deg)',
        }}>
          <svg width="15" height="15" viewBox="0 0 14 14" fill="none">
            <path d="M3 5 L7 9 L11 5" stroke={destColor} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>

      {/* Las notas ahora son PER-ALMUERZO y se muestran dentro de cada
          KitchenOrderRow. No hay banner global de comanda — eso evita la
          confusión de "¿esta nota aplica a cuál?". */}

      {!collapsed && (
        <div>
          {group.orders.map((order, i) => (
            <KitchenOrderRow
              key={order.id}
              order={order}
              isLast={i === group.orders.length - 1}
              servedInfo={servedInfo}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// Etiqueta "SIN X" de una categoría omitida. Si conocemos la opción del día
// (servedInfo), usamos su nombre real → "SIN TAJADAS"; si no, la categoría.
function omittedLabel(cat, servedInfo) {
  const names = servedInfo?.[cat.id]
  if (names && names.length > 0) return `SIN ${names.join(' / ').toUpperCase()}`
  return `SIN ${cat.label.toUpperCase()}`
}

function principioToArray(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.filter(Boolean)
  return [value]
}

function KitchenOrderRow({ order, isLast, servedInfo }) {
  const isReady = order.status === 'ready'
  const isDelivered = order.status === 'delivered'
  const isCancelled = order.status === 'cancelled'
  const isDone = isReady || isDelivered || isCancelled
  const [detailOpen, setDetailOpen] = useState(false)

  // selections puede venir:
  //   - objeto con cats (especial moderno / corriente)  → renderizar categorías
  //   - null (especial viejo o "Almuerzo Especial sintético" generado por
  //     buildLunchCommanda cuando la cajera pidió SOLO adiciones)        → renderizar description
  // El bug anterior hacía `order.selections || {}` y eso convertía null en
  // {} (truthy), llevando al render a buscar 'salad' y mostrar "SIN
  // ENSALADA" para cada adición. Ahora distinguimos limpiamente.
  const selections = order.selections && typeof order.selections === 'object'
    ? order.selections
    : null
  const hasSelections = !!selections && Object.keys(selections).length > 0
  const description = order.description
  // Adición pura: la cajera pidió solo addons (sopa adicional, huevo, etc.).
  // No es un Almuerzo Especial real — productName === 'Adiciones' viene de
  // buildLunchCommanda. Mostrarlo distinto: sin ⭐, con etiqueta "ADICIÓN"
  // y el description como contenido principal.
  const isAddonOnly = order.kind === 'special'
    && !hasSelections
    && order.productName === 'Adiciones'

  // Paleta por status. Los cancelados se ven en gris atenuado para que
  // la cocinera los identifique de un vistazo sin contarlos como vendidos.
  const palette = isCancelled
    ? { bg: T.neutral[50], bgHover: T.neutral[100], titleColor: T.neutral[500], badgeBg: T.neutral[200], badgeColor: T.neutral[600], badgeLabel: '✕ Cancelado' }
    : isDelivered
      ? { bg: '#EAF6EA', bgHover: '#DCEFDC', titleColor: T.ok, badgeBg: T.ok + '22', badgeColor: T.ok, badgeLabel: '💰 Entregado' }
      : isReady
        ? { bg: '#F5FBF5', bgHover: '#EAF6EA', titleColor: T.ok, badgeBg: T.ok + '22', badgeColor: T.ok, badgeLabel: '✓ Listo' }
        : { bg: '#fff', bgHover: '#FBF5F0', titleColor: T.copper[700], badgeBg: T.copper[50], badgeColor: T.copper[700], badgeLabel: '🍳 Cocinando' }

  // Diferenciador FUERTE de "para llevar": franja ámbar a un lado (siempre,
  // salvo cancelado) + fondo ámbar mientras se cocina. Así la cocinera separa
  // de un vistazo los de llevar de los de mesa, incluso en comandas mixtas.
  const isLlevar = order.destination === 'llevar'
  const rowBg = (!isDone && isLlevar) ? '#FFF4DD' : palette.bg
  const rowBgHover = (!isDone && isLlevar) ? '#FFEAC2' : palette.bgHover

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
          borderLeft: (isLlevar && !isCancelled) ? '7px solid #E8A33D' : 'none',
          background: rowBg,
          cursor: 'pointer', fontFamily: 'inherit',
          transition: 'background 0.15s',
          outline: 'none',
          boxSizing: 'border-box',
          // Tachar el texto cuando está cancelado lo hace inmediatamente
          // legible como "no va".
          textDecoration: isCancelled ? 'line-through' : 'none',
          textDecorationColor: isCancelled ? T.neutral[400] : undefined,
        }}
        onMouseEnter={e => e.currentTarget.style.background = rowBgHover}
        onMouseLeave={e => e.currentTarget.style.background = rowBg}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 18, fontWeight: 900, color: palette.titleColor,
              letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 10,
              display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            }}>
              {isReady && <span>✓</span>}
              {isDelivered && <span>💰</span>}
              {isCancelled && <span>✕</span>}
              {isAddonOnly ? (
                <>
                  <span>🍲</span>
                  <span>Adición</span>
                </>
              ) : (
                <>
                  {order.productName || 'Almuerzo'}
                  {order.kind === 'special' && <span>⭐</span>}
                </>
              )}
              {order.destination === 'llevar' && (
                <span style={{
                  fontSize: 13, fontWeight: 900, color: '#fff',
                  background: '#E8A33D', border: '1px solid #D8912A',
                  padding: '3px 11px', borderRadius: 999,
                  letterSpacing: 0.5,
                  boxShadow: '0 2px 6px rgba(232,163,61,0.4)',
                }}>
                  📦 PARA LLEVAR
                </span>
              )}
            </div>

            {order.kind === 'menu' && hasSelections && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {CORRIENTE_CATEGORIES.map(cat => {
                  const sel = selections[cat.id]
                  const principioArr = cat.id === 'principio' ? principioToArray(sel) : null
                  const isAlwaysServed = !!cat.alwaysServed
                  const isMissing = sel === null || sel === undefined

                  // Sopa rechazada: el cliente NO quiso sopa (y el día sí tenía).
                  // Lo mostramos explícito; el reemplazo, si lo hay, va en la nota.
                  if (cat.id === 'soup' && isMissing) {
                    const dayHadSoup = servedInfo ? (servedInfo.soup?.length > 0) : false
                    if (!dayHadSoup) return null
                    return (
                      <div key={cat.id} style={{
                        fontSize: 18, fontWeight: 900, color: T.bad,
                        letterSpacing: 0.5, textTransform: 'uppercase',
                        background: '#FBE9E5', padding: '8px 14px', borderRadius: 10,
                        display: 'inline-block', alignSelf: 'flex-start',
                        border: `2px solid ${T.bad}55`,
                      }}>
                        ⚠ SIN SOPA
                      </div>
                    )
                  }

                  if (isAlwaysServed && isMissing) {
                    return (
                      <div key={cat.id} style={{
                        fontSize: 18, fontWeight: 900, color: T.bad,
                        letterSpacing: 0.5, textTransform: 'uppercase',
                        background: '#FBE9E5', padding: '8px 14px', borderRadius: 10,
                        display: 'inline-block', alignSelf: 'flex-start',
                        border: `2px solid ${T.bad}55`,
                      }}>
                        ⚠ {omittedLabel(cat, servedInfo)}
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

            {/* Especial NUEVO con selections (soup, especial, salad).
                Solo entra si selections viene como objeto con datos —
                hasSelections evita el bug histórico donde un especial
                sintético de adiciones (selections=null) caía aquí y
                mostraba "SIN ENSALADA" falsamente. */}
            {order.kind === 'special' && hasSelections && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {SPECIAL_CATEGORIES.map(cat => {
                  const sel = selections[cat.id]
                  if (cat.id === 'salad' && (sel === null || sel === undefined)) {
                    return (
                      <div key={cat.id} style={{
                        fontSize: 18, fontWeight: 900, color: T.bad,
                        letterSpacing: 0.5, textTransform: 'uppercase',
                        background: '#FBE9E5', padding: '8px 14px', borderRadius: 10,
                        display: 'inline-block', alignSelf: 'flex-start',
                        border: `2px solid ${T.bad}55`,
                      }}>
                        ⚠ {omittedLabel(cat, servedInfo)}
                      </div>
                    )
                  }
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
            {/* Adición pura: la cajera pidió solo addons (sopa adicional,
                huevo, proteína extra…). El destination y la mesa siguen
                aplicando; solo cambia el contenido a una sola línea
                grande con lo que la cocinera tiene que preparar. */}
            {isAddonOnly && description && (
              <div style={{
                fontSize: 20, fontWeight: 800, color: T.copper[700],
                letterSpacing: -0.2, lineHeight: 1.4,
                padding: '12px 16px', borderRadius: 12,
                background: T.copper[50], border: `1.5px solid ${T.copper[200]}`,
                whiteSpace: 'pre-wrap',
              }}>
                ➕ {description}
              </div>
            )}
            {/* Backward-compat: especial viejo (real, no addon) sin
                selections — viene con description libre. */}
            {order.kind === 'special' && !hasSelections && !isAddonOnly && description && (
              <div style={{
                fontSize: 17, color: T.neutral[800], lineHeight: 1.55,
                padding: '12px 16px', borderRadius: 12,
                background: T.neutral[50], border: `1px solid ${T.neutral[100]}`,
                whiteSpace: 'pre-wrap', fontWeight: 600,
              }}>
                {description}
              </div>
            )}

            {/* Comentario PER-ALMUERZO. Destacado amarillo grande para que
                la cocinera no se lo pierda — va asociado A ESTE almuerzo,
                no al grupo. */}
            {order.commandaNote && (
              <div style={{
                marginTop: 12, padding: '12px 14px', borderRadius: 12,
                background: '#FFF7E6', border: `1.5px solid #F4E0BC`,
                fontSize: 16, color: '#7A5C00',
                fontWeight: 700, fontStyle: 'italic', lineHeight: 1.4,
              }}>
                📝 {order.commandaNote}
              </div>
            )}

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

            {/* Quién canceló + razón. Solo se muestra para almuerzos
                cancelados — destacado para que la cocinera entienda
                rápido por qué ese plato no sale. */}
            {isCancelled && (
              <div style={{
                marginTop: 12, padding: '10px 12px', borderRadius: 10,
                background: T.neutral[100], border: `1px solid ${T.neutral[200]}`,
                fontSize: 13, fontWeight: 700, color: T.neutral[700],
                letterSpacing: -0.1, textDecoration: 'none',
                display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
              }}>
                <span>👤 Cancelado por <strong>{order.cancelledByName || order.cashierName || 'desconocido'}</strong></span>
                {order.cancelReason && (
                  <span style={{ color: T.neutral[500], fontWeight: 600 }}>
                    · {order.cancelReason}
                  </span>
                )}
              </div>
            )}

            <div style={{
              marginTop: 12, fontSize: 12, fontWeight: 700,
              color: T.neutral[500], letterSpacing: 0.4, textTransform: 'uppercase',
            }}>
              {isCancelled
                ? 'Toca para ver detalle'
                : isDelivered
                  ? 'Ya entregado · Toca para ver detalle'
                  : isReady
                    ? 'Toca para deshacer'
                    : 'Toca para confirmar listo'}
            </div>
          </div>

          <div style={{
            flexShrink: 0,
            padding: '12px 16px', borderRadius: 14,
            background: palette.badgeBg,
            color: palette.badgeColor,
            fontSize: 13, fontWeight: 900, letterSpacing: 0.4, textTransform: 'uppercase',
            display: 'flex', alignItems: 'center', gap: 6,
            textDecoration: 'none',
          }}>
            {palette.badgeLabel}
          </div>
        </div>
      </div>

      {detailOpen && (
        <KitchenOrderDetailModal
          order={order}
          servedInfo={servedInfo}
          onClose={() => setDetailOpen(false)}
        />
      )}
    </>
  )
}

function KitchenOrderDetailModal({ order, servedInfo, onClose }) {
  const isReady = order.status === 'ready'
  const isDelivered = order.status === 'delivered'
  const isCancelled = order.status === 'cancelled'
  // El toggle Pendiente↔Listo solo aplica si el almuerzo sigue activo
  // en la cola. Para delivered/cancelled el modal es "solo lectura".
  const isToggleable = !isDelivered && !isCancelled
  const [busy, setBusy] = useState(false)
  const [flashAction, setFlashAction] = useState(null)

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
    if (busy || !isToggleable) return
    setBusy(true)
    try {
      if (isReady) {
        await unmarkOrderReady(order.id)
        setFlashAction('unready')
      } else if (order.paid) {
        // Ya lo cobraron mientras se cocinaba → al marcar Listo queda
        // directamente entregado/vendido (no se vuelve a cobrar).
        await markOrderDelivered(order.id)
        setFlashAction('delivered')
      } else {
        await markOrderReady(order.id)
        setFlashAction('ready')
      }
      setTimeout(() => onClose(), 1200)
    } catch (err) {
      console.error('[kitchen] toggle ready error:', err)
      setBusy(false)
    }
  }

  // Mismo tratamiento de selections que KitchenOrderRow: null si no es un
  // objeto con datos reales, para que el render no caiga en la rama de
  // SPECIAL_CATEGORIES y muestre "SIN ENSALADA" para una simple adición.
  const selections = order.selections && typeof order.selections === 'object'
    ? order.selections
    : null
  const hasSelections = !!selections && Object.keys(selections).length > 0
  const description = order.description
  const isAddonOnly = order.kind === 'special'
    && !hasSelections
    && order.productName === 'Adiciones'

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
        position: 'relative',
        animation: 'fadeScaleIn 0.2s cubic-bezier(0.2,0.9,0.3,1.05)',
      }}>
        {/* Header con paleta según status. Cancelado = gris, Entregado =
            verde lleno, Listo = verde claro, Pendiente = copper. */}
        <div style={{
          padding: '20px 22px',
          background: isCancelled
            ? T.neutral[100]
            : isDelivered
              ? '#DCEFDC'
              : isReady
                ? '#E8F4E8'
                : (isLlevarTab ? '#FFF4DD' : '#FBF5F0'),
          borderBottom: `1.5px solid ${
            isCancelled
              ? T.neutral[300]
              : isDelivered
                ? T.ok + '88'
                : isReady
                  ? T.ok + '55'
                  : (isLlevarTab ? '#F0D699' : T.copper[100])
          }`,
          display: 'flex', alignItems: 'center', gap: 16,
        }}>
          <div style={{
            width: 64, height: 64, borderRadius: 16, flexShrink: 0,
            background: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 34,
            border: `2.5px solid ${
              isCancelled
                ? T.neutral[300]
                : (isReady || isDelivered)
                  ? T.ok + '88'
                  : (isLlevarTab ? '#F0D699' : T.copper[200])
            }`,
          }}>
            {isCancelled ? '✕' : isDelivered ? '💰' : isReady ? '✓' : (isLlevarTab ? '📦' : '🍽️')}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 12, fontWeight: 900,
              color: isCancelled
                ? T.neutral[600]
                : (isReady || isDelivered)
                  ? T.ok
                  : (isLlevarTab ? '#8A5E12' : T.copper[700]),
              letterSpacing: 0.7, textTransform: 'uppercase',
            }}>
              {isCancelled
                ? 'Cancelado'
                : isDelivered
                  ? 'Entregado a la mesa'
                  : isReady
                    ? 'Toca para volver a pendiente'
                    : (isLlevarTab ? 'Para llevar' : 'Para mesa')}
            </div>
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
              {isAddonOnly
                ? '🍲 Adición'
                : <>{order.productName || 'Almuerzo'}{order.kind === 'special' && ' ⭐'}</>}
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

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 22px' }}>
          {isCancelled && (
            <div style={{
              marginBottom: 18,
              padding: '14px 16px', borderRadius: 14,
              background: T.neutral[100], border: `1.5px solid ${T.neutral[200]}`,
              display: 'flex', flexDirection: 'column', gap: 6,
            }}>
              <div style={{
                fontSize: 12, fontWeight: 900, color: T.neutral[600],
                letterSpacing: 0.5, textTransform: 'uppercase',
              }}>
                👤 Cancelado por
              </div>
              <div style={{ fontSize: 18, fontWeight: 800, color: T.neutral[800] }}>
                {order.cancelledByName || order.cashierName || 'Desconocido'}
              </div>
              {order.cancelReason && (
                <div style={{
                  fontSize: 14, color: T.neutral[600], fontStyle: 'italic',
                  marginTop: 4,
                }}>
                  Razón: {order.cancelReason}
                </div>
              )}
            </div>
          )}
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

          {order.kind === 'menu' && hasSelections && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {CORRIENTE_CATEGORIES.map(cat => {
                const sel = selections[cat.id]
                const principioArr = cat.id === 'principio' ? principioToArray(sel) : null
                const isAlwaysServed = !!cat.alwaysServed
                const isMissing = sel === null || sel === undefined

                if (cat.id === 'soup' && isMissing) {
                  const dayHadSoup = servedInfo ? (servedInfo.soup?.length > 0) : false
                  if (!dayHadSoup) return null
                  return (
                    <div key={cat.id} style={{
                      fontSize: 20, fontWeight: 900, color: T.bad,
                      letterSpacing: 0.5, textTransform: 'uppercase',
                      background: '#FBE9E5', padding: '12px 18px', borderRadius: 12,
                      border: `2px solid ${T.bad}55`,
                    }}>
                      ⚠ SIN SOPA
                    </div>
                  )
                }

                if (isAlwaysServed && isMissing) {
                  return (
                    <div key={cat.id} style={{
                      fontSize: 20, fontWeight: 900, color: T.bad,
                      letterSpacing: 0.5, textTransform: 'uppercase',
                      background: '#FBE9E5', padding: '12px 18px', borderRadius: 12,
                      border: `2px solid ${T.bad}55`,
                    }}>
                      ⚠ {omittedLabel(cat, servedInfo)}
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

          {/* Especial NUEVO con selections (soup, especial, salad).
              hasSelections en lugar de selections para evitar tratar a
              una adición sintética (selections=null) como especial. */}
          {order.kind === 'special' && hasSelections && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {SPECIAL_CATEGORIES.map(cat => {
                const sel = selections[cat.id]
                if (cat.id === 'salad' && (sel === null || sel === undefined)) {
                  return (
                    <div key={cat.id} style={{
                      fontSize: 20, fontWeight: 900, color: T.bad,
                      letterSpacing: 0.5, textTransform: 'uppercase',
                      background: '#FBE9E5', padding: '10px 16px', borderRadius: 10,
                      display: 'inline-block', alignSelf: 'flex-start',
                      border: `2px solid ${T.bad}55`,
                    }}>
                      ⚠ {omittedLabel(cat, servedInfo)}
                    </div>
                  )
                }
                if (!sel) return null
                return (
                  <div key={cat.id} style={{
                    display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap',
                  }}>
                    <span style={{
                      fontSize: 14, fontWeight: 800, color: T.neutral[500],
                      minWidth: 120, letterSpacing: 0.5, textTransform: 'uppercase',
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
          {/* Adición pura — destacada en copper para que la cocinera vea
              de inmediato qué tiene que preparar (es solo una línea). */}
          {isAddonOnly && description && (
            <div style={{
              fontSize: 22, fontWeight: 800, color: T.copper[700],
              letterSpacing: -0.3, lineHeight: 1.35,
              padding: '16px 18px', borderRadius: 14,
              background: T.copper[50], border: `1.5px solid ${T.copper[200]}`,
              whiteSpace: 'pre-wrap',
            }}>
              ➕ {description}
            </div>
          )}
          {/* Backward-compat: especial viejo real (no addon) sin selections. */}
          {order.kind === 'special' && !hasSelections && !isAddonOnly && description && (
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
              flex: isToggleable ? 1 : 1, padding: '16px', borderRadius: 14,
              background: T.neutral[100], color: T.neutral[700],
              border: 'none', cursor: busy ? 'wait' : 'pointer',
              fontFamily: 'inherit', fontSize: 15, fontWeight: 800,
            }}
          >
            ← Volver
          </button>
          {isToggleable && (
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
              {busy ? '...' : (isReady ? '↺ Volver a pendiente' : (order.paid ? '✓ Listo y entregar' : '✓ Confirmar listo'))}
            </button>
          )}
        </div>

        {flashAction && (
          <div style={{
            position: 'absolute', inset: 0,
            background: (flashAction === 'ready' || flashAction === 'delivered') ? T.ok : T.warn,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            color: '#fff', textAlign: 'center', padding: '20px',
            animation: 'flashIn 0.18s ease-out',
            zIndex: 5,
          }}>
            <div style={{ fontSize: 64, lineHeight: 1, marginBottom: 8 }}>
              {flashAction === 'delivered' ? '💰' : flashAction === 'ready' ? '✓' : '↺'}
            </div>
            <div style={{
              fontSize: 22, fontWeight: 900, letterSpacing: 1,
              textTransform: 'uppercase', marginBottom: 6,
            }}>
              {flashAction === 'delivered' ? 'ENTREGADO' : flashAction === 'ready' ? 'LISTO' : 'DEVUELTO'}
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
  const days = Math.floor(h / 24)
  const remH = h % 24
  return remH > 0 ? `${days}d ${remH}h` : `${days}d`
}

// ──────────────────────────────────────────────────────────────
// Avatar menu y sign-out (solo cocinera, no admin asistiendo)
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
// Botón flotante "Llamar cajera" (Panadería B)
//
// Estados:
//   - Idle:    pill cobre con campana — la cocinera puede llamar
//   - Pending: pill ámbar con punto pulsante — esperando que la cajera
//              tape "Voy en camino"; el botón queda bloqueado
//   - Sin cajera: toast suave "No hay cajera activa en Panadería B"
// ──────────────────────────────────────────────────────────────
const KITCHEN_CALL_BRANCH_NAME = 'Panadería B'

function CallCashierFAB({ authUser, userDoc }) {
  const [openSessions, setOpenSessions] = useState([])
  const [myPendingCalls, setMyPendingCalls] = useState([])
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)
  const [confirmCancel, setConfirmCancel] = useState(false)

  useEffect(() => watchOpenSessions(setOpenSessions), [])
  useEffect(() => watchMyPendingCalls(authUser.uid, setMyPendingCalls), [authUser.uid])

  const branches = getData().branches || []
  const targetBranch = useMemo(
    () => branches.find(b => b.name === KITCHEN_CALL_BRANCH_NAME) || null,
    [branches]
  )
  const targetSession = useMemo(() => {
    if (!targetBranch) return null
    return openSessions.find(s => s.branchId === targetBranch.id && s.status === 'open') || null
  }, [openSessions, targetBranch])

  const isPending = myPendingCalls.length > 0

  function showToast(message, kind = 'info') {
    setToast({ message, kind })
    setTimeout(() => setToast(null), 3200)
  }

  async function handleCall() {
    if (busy) return
    if (isPending) {
      // Tap mientras hay una llamada en vuelo → ofrecer cancelar.
      setConfirmCancel(true)
      return
    }
    if (!targetBranch) {
      showToast('No se encontró la Panadería B en la configuración.', 'warn')
      return
    }
    if (!targetSession) {
      showToast(`No hay cajera activa en ${KITCHEN_CALL_BRANCH_NAME} ahora mismo.`, 'warn')
      return
    }
    setBusy(true)
    try {
      try { navigator.vibrate?.(40) } catch {}
      const cookName = `${userDoc?.nombre || ''} ${userDoc?.apellido || ''}`.trim()
        || authUser?.email || 'Cocina'
      const callerRole = userDoc?.role || 'unknown'
      console.log(
        `%c[kitchenCalls] 🔔 intentando llamar como role=${callerRole} (${cookName}) …`,
        'color:#B87A56;font-weight:bold',
      )
      await createKitchenCall({
        createdBy: authUser.uid,
        createdByName: cookName,
        targetBranchId: targetBranch.id,
        targetBranchName: targetBranch.name,
        targetSessionId: targetSession.id,
        targetCashierUid: targetSession.cashierUid,
        targetCashierName: targetSession.cashierName,
      })
      console.log(
        `%c[kitchenCalls] ✅ llamada CREADA OK desde role=${callerRole} — Firestore Rules permiten`,
        'background:#1E8E3E;color:#fff;font-weight:bold;padding:4px 8px;border-radius:4px',
      )
      showToast(`Llamada enviada a ${targetSession.cashierName || 'la cajera'}.`, 'ok')
    } catch (err) {
      const code = err?.code || ''
      const callerRole = userDoc?.role || 'unknown'
      const isPermDenied = code === 'permission-denied'
      // Log MUY visible para diagnosticar el caso admin-en-assistMode.
      // Si sale el banner rojo de permission-denied al cubrir cocina como
      // admin, hay que ajustar la regla de Firestore en kitchenCalls para
      // permitir role 'admin' además de 'cook'.
      console.error(
        `%c[kitchenCalls] ❌ FALLÓ createKitchenCall — role=${callerRole}, code=${code || '(sin code)'}`,
        'background:#D93025;color:#fff;font-weight:bold;padding:4px 8px;border-radius:4px',
        err,
      )
      if (isPermDenied) {
        console.error(
          '%c[kitchenCalls] 🛑 PERMISSION DENIED — Firestore Rules NO permiten que este rol cree kitchenCalls. ' +
          'Si esto pasó como admin en modo asistir, hay que ajustar la regla.',
          'background:#FBE9E5;color:#A50E0E;font-weight:bold;padding:4px 8px;border-radius:4px',
        )
      }
      showToast(
        isPermDenied
          ? 'Permiso denegado por Firestore. Revisa la consola.'
          : 'No se pudo enviar la llamada. Intenta de nuevo.',
        'bad',
      )
      setBusy(false)
      return
    }
    setBusy(false)
  }

  async function handleCancel() {
    const call = myPendingCalls[0]
    if (!call || busy) return
    setBusy(true)
    try {
      const cookName = `${userDoc?.nombre || ''} ${userDoc?.apellido || ''}`.trim()
        || authUser?.email || 'Cocina'
      await cancelKitchenCall(call.id, { byUid: authUser.uid, byName: cookName })
      setConfirmCancel(false)
      showToast('Llamada cancelada.', 'ok')
    } catch (err) {
      console.error('[kitchenCalls] cancelKitchenCall error:', err)
      showToast('No se pudo cancelar. Intenta de nuevo.', 'bad')
    }
    setBusy(false)
  }

  const label = isPending
    ? `Esperando a ${myPendingCalls[0]?.targetCashierName || 'la cajera'}...`
    : 'Llamar cajera'
  const sub = isPending
    ? 'Toca aquí para cancelar la llamada'
    : KITCHEN_CALL_BRANCH_NAME

  const bg = isPending ? '#FFF4DD' : T.copper[500]
  const fg = isPending ? '#8A5E12' : '#fff'
  const subColor = isPending ? '#9A7200' : 'rgba(255,255,255,0.85)'
  const borderColor = isPending ? '#F0D699' : 'transparent'
  const shadow = isPending
    ? '0 6px 18px rgba(184,140,40,0.25)'
    : '0 8px 22px rgba(184,122,86,0.5)'

  return createPortal((
    <>
      <button
        onClick={handleCall}
        disabled={busy}
        aria-label={isPending ? 'Cancelar llamada en curso' : 'Llamar a la cajera de Panadería B'}
        style={{
          position: 'fixed',
          right: 'max(16px, env(safe-area-inset-right, 0px))',
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 18px)',
          zIndex: 90,
          padding: '14px 18px',
          borderRadius: 999,
          background: bg,
          color: fg,
          border: `1.5px solid ${borderColor}`,
          cursor: busy ? 'wait' : 'pointer',
          fontFamily: 'inherit',
          boxShadow: shadow,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          minHeight: 56,
          maxWidth: 'calc(100vw - 32px)',
          transition: 'transform 0.12s, background 0.2s, color 0.2s',
          animation: isPending ? 'fabPulse 1.4s ease-in-out infinite' : 'none',
        }}
        onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.96)' }}
        onMouseUp={e => { e.currentTarget.style.transform = 'scale(1)' }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)' }}
      >
        <div style={{
          width: 36, height: 36, borderRadius: 999, flexShrink: 0,
          background: isPending ? '#fff' : 'rgba(255,255,255,0.18)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative',
        }}>
          {isPending ? (
            <span style={{
              width: 12, height: 12, borderRadius: 999, background: '#C08A3E',
              animation: 'fabDot 1s ease-in-out infinite',
              display: 'block',
            }}/>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 3 C8.7 3 6 5.7 6 9 V13 L4 16 H20 L18 13 V9 C18 5.7 15.3 3 12 3 Z"
                stroke={fg} strokeWidth="1.8" fill="none" strokeLinejoin="round"
              />
              <path
                d="M10 19 C10 20.1 10.9 21 12 21 C13.1 21 14 20.1 14 19"
                stroke={fg} strokeWidth="1.8" fill="none" strokeLinecap="round"
              />
            </svg>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0 }}>
          <span style={{
            fontSize: 14, fontWeight: 900, letterSpacing: -0.2,
            lineHeight: 1.15,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            maxWidth: 220,
          }}>
            {label}
          </span>
          <span style={{
            fontSize: 11, fontWeight: 700, color: subColor,
            letterSpacing: 0.2, marginTop: 2,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            maxWidth: 220,
          }}>
            {sub}
          </span>
        </div>
      </button>

      {toast && (
        <div style={{
          position: 'fixed',
          right: 'max(16px, env(safe-area-inset-right, 0px))',
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 88px)',
          zIndex: 91,
          maxWidth: 'calc(100vw - 32px)',
          padding: '12px 16px', borderRadius: 14,
          background: toast.kind === 'bad' ? '#FBE9E5'
            : toast.kind === 'warn' ? '#FFF4DD'
            : toast.kind === 'ok' ? '#E8F4E8'
            : '#fff',
          border: `1.5px solid ${
            toast.kind === 'bad' ? '#F0C8BE'
            : toast.kind === 'warn' ? '#F0D699'
            : toast.kind === 'ok' ? `${T.ok}55`
            : T.neutral[200]
          }`,
          color: toast.kind === 'bad' ? T.bad
            : toast.kind === 'warn' ? '#8A5E12'
            : toast.kind === 'ok' ? T.ok
            : T.neutral[800],
          fontSize: 13, fontWeight: 700, lineHeight: 1.4,
          boxShadow: '0 8px 20px rgba(0,0,0,0.12)',
          animation: 'fabToastIn 0.2s ease-out',
        }}>
          {toast.message}
        </div>
      )}

      {confirmCancel && (
        <div
          onClick={() => !busy && setConfirmCancel(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 18,
            animation: 'fabToastIn 0.15s ease-out',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 360,
              background: '#fff', borderRadius: 20,
              padding: '22px 22px 18px',
              boxShadow: '0 20px 50px rgba(0,0,0,0.35)',
            }}
          >
            <div style={{
              fontSize: 18, fontWeight: 900, color: T.neutral[900],
              letterSpacing: -0.3, marginBottom: 6,
            }}>
              ¿Cancelar la llamada?
            </div>
            <div style={{
              fontSize: 13.5, color: T.neutral[600], lineHeight: 1.5,
              marginBottom: 18,
            }}>
              El pop-up desaparecerá del celular de
              {' '}<b>{myPendingCalls[0]?.targetCashierName || 'la cajera'}</b>{' '}
              y podrás volver a llamar.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setConfirmCancel(false)}
                disabled={busy}
                style={{
                  flex: 1, padding: '14px', borderRadius: 14,
                  background: T.neutral[100], color: T.neutral[700],
                  border: 'none', cursor: busy ? 'wait' : 'pointer',
                  fontFamily: 'inherit', fontSize: 14, fontWeight: 800,
                }}
              >
                No, esperar
              </button>
              <button
                onClick={handleCancel}
                disabled={busy}
                style={{
                  flex: 1.2, padding: '14px', borderRadius: 14,
                  background: T.bad, color: '#fff',
                  border: 'none', cursor: busy ? 'wait' : 'pointer',
                  fontFamily: 'inherit', fontSize: 14, fontWeight: 900,
                  letterSpacing: 0.3,
                  boxShadow: `0 6px 16px ${T.bad}55`,
                  opacity: busy ? 0.7 : 1,
                }}
              >
                {busy ? 'Cancelando...' : 'Sí, cancelar'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fabPulse {
          0%, 100% { box-shadow: 0 6px 18px rgba(184,140,40,0.25); }
          50%      { box-shadow: 0 6px 22px rgba(184,140,40,0.55); }
        }
        @keyframes fabDot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.4; transform: scale(0.7); }
        }
        @keyframes fabToastIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </>
  ), document.body)
}

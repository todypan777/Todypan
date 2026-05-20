import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { T } from '../tokens'
import { Card, UserAvatar } from '../components/Atoms'
import { fmtCOP } from '../utils/format'
import { signOut } from '../auth'
import { getData } from '../db'
import { watchMyOpenSession } from '../cashSessions'
import { watchSessionSales, flagSale } from '../sales'
import { createCashExpense, watchSessionExpenses } from '../cashExpenses'
import { watchAllDeductionsForCashier } from '../cashierDeductions'
import { watchTasksForCashier, markTaskDone, unmarkTaskDone } from '../tasks'
import { watchPendingCallsForCashier, acknowledgeKitchenCall } from '../kitchenCalls'
import { watchLiveOrdersForSession } from '../kitchenOrders'
import { setupAudioUnlock, playKitchenCallSound, playOrderReadySound } from '../utils/notificationSound'
import ErrorBoundary from '../components/ErrorBoundary'
import ContactSupportButton from '../components/ContactSupportButton'
import { compressImage, uploadToImageBB } from '../utils/imagebb'
import { enqueuePhoto, makePhotoLocalId } from '../utils/photoQueue'
import NewSale from './NewSale'
import OpenTabsBubbles from '../components/OpenTabsBubbles'
import MissingPricesPanel from '../components/MissingPricesPanel'
import ProductCatalogPanel from '../components/ProductCatalogPanel'
import ConnectionChip from '../components/ConnectionChip'
import { useOnlineStatus, useDataSaver } from '../utils/network'
import MyHistoricalSales from './MyHistoricalSales'
import {
  watchCashierProducts,
  mergeProductCatalogs,
  getProductPrice,
} from '../products'

// ──────────────────────────────────────────────────────────────
// Wrapper top-level (D25): el admin abre y cierra los turnos.
// Si la cajera tiene sesión open → POS. Si no → "sin turno asignado".
// ──────────────────────────────────────────────────────────────
export default function CashierApp({ authUser, userDoc }) {
  const [mySession, setMySession] = useState(undefined) // undefined=loading

  useEffect(() => watchMyOpenSession(authUser.uid, setMySession), [authUser.uid])

  // Desbloquea el audio al primer tap. Necesario para que el sonido de
  // llamada de cocina suene en iOS (Safari bloquea audio sin gesto previo).
  useEffect(() => { setupAudioUnlock() }, [])

  if (mySession === undefined) {
    return <LoadingScreen label="Verificando turno..." />
  }

  return (
    <div style={{
      minHeight: '100dvh', background: T.neutral[50],
      fontFamily: '-apple-system, "SF Pro Text", "Inter", system-ui, sans-serif',
      color: T.neutral[800],
    }}>
      <CashierTopBar
        authUser={authUser}
        userDoc={userDoc}
        session={mySession}
        branches={getData().branches || []}
      />

      <ConnectivityBanner />

      {mySession ? (
        <ActiveSession session={mySession} userDoc={userDoc} authUser={authUser} />
      ) : (
        <NoShiftAssigned userDoc={userDoc} />
      )}
    </div>
  )
}

// Banner que aparece debajo del top bar cuando la cajera está sin red Y/O
// con "Modo ahorro de datos" activado. Tres estados:
//   - Sin red real (online=false): banner gris/amarillo
//   - Modo ahorro activo (online=true pero el corte es voluntario): banner
//     copper con botón "Sincronizar ahora"
//   - Todo OK (online + sin modo ahorro): no se muestra nada
function ConnectivityBanner() {
  const online = useOnlineStatus()
  const { enabled: dataSaver, syncNow } = useDataSaver()
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState(null) // {ok, error}

  async function handleSyncNow() {
    setSyncing(true); setSyncResult(null)
    const r = await syncNow()
    setSyncResult(r)
    setSyncing(false)
    if (r.ok) {
      setTimeout(() => setSyncResult(null), 3000)
    }
  }

  if (!online && !dataSaver) {
    return (
      <div style={bannerStyle('#FFF4DD', '#F0D699', '#8A5E12')}>
        <div style={{ fontSize: 20, lineHeight: 1, flexShrink: 0 }}>📵</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 2 }}>
            Sin conexión
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.4 }}>
            Puedes seguir vendiendo. Tus ventas se guardarán y se subirán solas cuando vuelva la señal.
          </div>
        </div>
      </div>
    )
  }

  if (dataSaver) {
    return (
      <div style={bannerStyle('#FFEFE2', '#F0C8A8', '#8A4A1A')}>
        <div style={{ fontSize: 20, lineHeight: 1, flexShrink: 0 }}>💾</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 2 }}>
            Modo ahorro activo
          </div>
          <div style={{ fontSize: 11.5, lineHeight: 1.4, marginBottom: 8 }}>
            {syncResult?.ok
              ? '✅ Listo, todo sincronizado.'
              : syncResult?.error
                ? `⚠️ ${syncResult.error}. Reintentar.`
                : 'Sin gastar datos. Toca "Sincronizar" antes de cerrar el turno.'}
          </div>
          <button
            onClick={handleSyncNow}
            disabled={syncing || !online}
            style={{
              padding: '7px 14px', borderRadius: 999,
              background: !online ? T.neutral[200] : T.copper[500],
              color: !online ? T.neutral[500] : '#fff',
              border: 'none', fontFamily: 'inherit',
              fontSize: 12, fontWeight: 700,
              cursor: syncing || !online ? 'wait' : 'pointer',
              opacity: syncing ? 0.7 : 1,
            }}
          >
            {syncing ? 'Sincronizando...' : !online ? 'Necesitas datos para sincronizar' : 'Sincronizar ahora'}
          </button>
        </div>
      </div>
    )
  }

  return null
}

function bannerStyle(bg, border, fg) {
  return {
    background: bg,
    borderBottom: `1px solid ${border}`,
    color: fg,
    padding: '10px 16px',
    display: 'flex', alignItems: 'flex-start', gap: 10,
  }
}

// ──────────────────────────────────────────────────────────────
// PANTALLA: Sin turno asignado
// La cajera ve esto hasta que el admin le abra un turno desde su panel.
// ──────────────────────────────────────────────────────────────
function NoShiftAssigned({ userDoc }) {
  const firstName = userDoc?.nombre || 'Hola'
  return (
    <div style={{
      padding: '60px 24px 40px', maxWidth: 480, margin: '0 auto',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18,
    }}>
      <div style={{
        width: 96, height: 96, borderRadius: 999,
        background: T.copper[50], border: `1px solid ${T.copper[100]}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="9" stroke={T.copper[600]} strokeWidth="1.6" fill="none"/>
          <path d="M12 7 V12 L15 14" stroke={T.copper[600]} strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      <div style={{
        fontSize: 22, fontWeight: 800, color: T.neutral[900],
        letterSpacing: -0.4, textAlign: 'center', lineHeight: 1.25,
      }}>
        {firstName}, no tienes turno asignado
      </div>
      <div style={{
        fontSize: 14, color: T.neutral[600], textAlign: 'center',
        lineHeight: 1.55, maxWidth: 340,
      }}>
        El administrador te abrirá el turno desde su panel cuando estés lista para empezar.
      </div>
      <div style={{
        marginTop: 6, padding: '12px 16px', borderRadius: 14,
        background: T.neutral[100],
        fontSize: 12.5, color: T.neutral[600], textAlign: 'center',
        maxWidth: 320, lineHeight: 1.5,
      }}>
        Esta pantalla se actualiza sola en cuanto admin abra tu turno.
      </div>
    </div>
  )
}

function LoadingScreen({ label }) {
  return (
    <div style={{
      minHeight: '100dvh', background: T.neutral[50],
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 14,
    }}>
      <div style={{ fontSize: 48 }}>🥖</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: T.copper[500], letterSpacing: 0.3 }}>
        {label}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Top bar (avatar + nombre + cerrar sesión)
// ──────────────────────────────────────────────────────────────
function CashierTopBar({ authUser, userDoc, session, branches }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [dataSaverConfirm, setDataSaverConfirm] = useState(null) // null | 'turn-on' | 'turn-off'

  return (
    <div style={{
      padding: '14px 18px',
      display: 'flex', alignItems: 'center', gap: 10,
      background: '#fff',
      borderBottom: `1px solid ${T.neutral[100]}`,
      position: 'sticky', top: 0, zIndex: 20,
    }}>
      <img
        src="/Logo.png"
        alt="Infinity Eventos"
        style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3 }}>
          TodyPan
        </div>
        <div style={{
          fontSize: 11, color: T.neutral[500],
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {userDoc?.nombre} {userDoc?.apellido}
        </div>
      </div>

      <ConnectionChip compact />

      <button
        onClick={() => setMenuOpen(true)}
        style={{
          width: 36, height: 36, borderRadius: 999,
          background: 'transparent', border: 'none', padding: 0,
          cursor: 'pointer', flexShrink: 0,
        }}
      >
        <UserAvatar user={authUser} size={34} />
      </button>

      {menuOpen && (
        <AvatarMenu
          authUser={authUser}
          userDoc={userDoc}
          onCancel={() => setMenuOpen(false)}
          onOpenCatalog={() => { setMenuOpen(false); setCatalogOpen(true) }}
          onToggleDataSaver={(intent) => { setMenuOpen(false); setDataSaverConfirm(intent) }}
          onSignOut={() => { setMenuOpen(false); setConfirmSignOut(true) }}
        />
      )}

      {confirmSignOut && (
        <SignOutModal
          onCancel={() => setConfirmSignOut(false)}
          onConfirm={async () => { await signOut() }}
        />
      )}

      {dataSaverConfirm && (
        <DataSaverModal
          intent={dataSaverConfirm}
          onClose={() => setDataSaverConfirm(null)}
        />
      )}

      {catalogOpen && session && (
        <ProductCatalogPanel
          branchId={session.branchId}
          branchName={session.branchName}
          branches={branches}
          cashierUid={authUser.uid}
          cashierName={`${userDoc?.nombre || ''} ${userDoc?.apellido || ''}`.trim()}
          onClose={() => setCatalogOpen(false)}
        />
      )}
    </div>
  )
}

function AvatarMenu({ authUser, userDoc, onCancel, onOpenCatalog, onToggleDataSaver, onSignOut }) {
  const { enabled: dataSaverOn } = useDataSaver()
  return (
    <ModalOverlay onClose={onCancel}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 340, background: '#fff', borderRadius: 20,
        padding: '20px 0 12px', boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
      }}>
        {/* Header con avatar y nombre */}
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

        {/* Opciones */}
        <button onClick={onOpenCatalog} style={menuItemStyle()}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <rect x="3" y="3" width="14" height="14" rx="2" stroke={T.neutral[600]} strokeWidth="1.6" fill="none"/>
            <path d="M6 7 H14 M6 10 H14 M6 13 H11" stroke={T.neutral[600]} strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          <span style={{ flex: 1 }}>Ver catálogo</span>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M3 1 L8 6 L3 11" stroke={T.neutral[400]} strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        <button onClick={() => onToggleDataSaver(dataSaverOn ? 'turn-off' : 'turn-on')} style={menuItemStyle()}>
          <span style={{ fontSize: 18, lineHeight: 1, width: 20, textAlign: 'center' }}>💾</span>
          <span style={{ flex: 1 }}>
            <div>Modo ahorro de datos</div>
            <div style={{ fontSize: 11, fontWeight: 500, color: dataSaverOn ? T.copper[600] : T.neutral[500], marginTop: 2 }}>
              {dataSaverOn ? 'Activo · sin gastar datos' : 'Desactivado'}
            </div>
          </span>
          <span style={{
            width: 36, height: 20, borderRadius: 999,
            background: dataSaverOn ? T.copper[500] : T.neutral[300],
            position: 'relative', flexShrink: 0,
            transition: 'background 0.15s',
          }}>
            <span style={{
              position: 'absolute', top: 2, left: dataSaverOn ? 18 : 2,
              width: 16, height: 16, borderRadius: 999, background: '#fff',
              transition: 'left 0.15s',
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            }}/>
          </span>
        </button>

        {/* Contactar al programador (WhatsApp) */}
        <ContactSupportButton
          variant="menu"
          reason="Algo no funciona en la app de cajera"
          userContext={`Cuenta: ${authUser?.email || ''} (${userDoc?.nombre || ''} ${userDoc?.apellido || ''})`}
          onClick={onCancel}
        />

        <button onClick={onSignOut} style={menuItemStyle({ danger: true })}>
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
          }}>
            Cancelar
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

function menuItemStyle({ danger = false } = {}) {
  return {
    width: '100%', padding: '14px 22px',
    background: 'transparent', border: 'none',
    cursor: 'pointer', fontFamily: 'inherit',
    fontSize: 14.5, fontWeight: 600,
    color: danger ? T.bad : T.neutral[800],
    display: 'flex', alignItems: 'center', gap: 14,
    textAlign: 'left',
  }
}

// Modal de confirmación para activar/desactivar Modo Ahorro. Cuando intent
// es 'turn-on' explica qué pasa al activar; al desactivar avisa que va a
// sincronizar todo lo encolado (puede tomar unos segundos según volumen).
function DataSaverModal({ intent, onClose }) {
  const { enabled, turnOn, turnOff, syncNow } = useDataSaver()
  const online = useOnlineStatus()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const turningOn = intent === 'turn-on'

  async function handleConfirm() {
    setBusy(true); setError(null)
    try {
      if (turningOn) {
        // Antes de cortar la red, intentar subir lo pendiente para arrancar
        // el modo ahorro con la cola limpia.
        if (online) {
          await syncNow() // ya respeta el ahorro (vuelve a desconectar al final)
        }
        await turnOn()
      } else {
        // Al desactivar: enableNetwork (que es lo que turnOff hace internamente)
        // sube la cola sola. waitForPendingWrites antes de cerrar el modal
        // para mostrar el estado real al usuario.
        await turnOff()
      }
      onClose()
    } catch (e) {
      setError(e?.message || 'No se pudo cambiar el modo. Intenta de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalOverlay onClose={busy ? undefined : onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 360, background: '#fff', borderRadius: 20,
        padding: '24px 22px', boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
      }}>
        <div style={{ fontSize: 36, textAlign: 'center', marginBottom: 8 }}>
          {turningOn ? '💾' : '📡'}
        </div>
        <div style={{ fontSize: 17, fontWeight: 800, color: T.neutral[900], textAlign: 'center', marginBottom: 8 }}>
          {turningOn ? 'Activar modo ahorro' : 'Desactivar modo ahorro'}
        </div>
        <div style={{
          fontSize: 13, color: T.neutral[600], textAlign: 'center',
          lineHeight: 1.55, marginBottom: 18,
        }}>
          {turningOn
            ? 'La app dejará de gastar datos. Puedes seguir vendiendo normal — todo se guarda en el celular. Antes de cerrar el turno, toca "Sincronizar ahora" en el banner para que el admin vea todas tus ventas.'
            : 'La app volverá a usar datos móviles para sincronizar en tiempo real. Tus ventas pendientes se subirán automáticamente.'}
        </div>

        {!online && turningOn && (
          <div style={{
            marginBottom: 14, padding: '10px 12px', borderRadius: 10,
            background: '#FFF4DD', border: `1px solid #F0D699`, color: '#8A5E12',
            fontSize: 12, lineHeight: 1.45,
          }}>
            Estás sin conexión. Se activará el modo ahorro de todas formas — al volver la red podrás sincronizar manualmente.
          </div>
        )}

        {error && (
          <div style={{
            marginBottom: 14, padding: '10px 12px', borderRadius: 10,
            background: '#FBE9E5', border: `1px solid #F0C8BE`, color: T.bad,
            fontSize: 12.5, fontWeight: 500, textAlign: 'center',
          }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} disabled={busy} style={btnSecondary()}>
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={busy}
            style={{
              ...btnPrimary(turningOn ? T.copper[500] : T.ok),
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? (turningOn ? 'Activando...' : 'Activando red...') : (turningOn ? 'Activar ahorro' : 'Reconectar')}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

function SignOutModal({ onCancel, onConfirm }) {
  const [busy, setBusy] = useState(false)
  return (
    <ModalOverlay onClose={busy ? undefined : onCancel}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 340, background: '#fff', borderRadius: 20,
        padding: '24px 22px', boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
      }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: T.neutral[900], textAlign: 'center', marginBottom: 8 }}>
          Cerrar sesión
        </div>
        <div style={{ fontSize: 13.5, color: T.neutral[600], textAlign: 'center', marginBottom: 22, lineHeight: 1.5 }}>
          ¿Seguro que quieres salir?
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCancel} disabled={busy} style={btnSecondary()}>Cancelar</button>
          <button
            onClick={async () => { setBusy(true); await onConfirm() }}
            disabled={busy}
            style={{ ...btnPrimary(T.bad), opacity: busy ? 0.7 : 1 }}
          >
            {busy ? 'Saliendo...' : 'Cerrar sesión'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

function ErrorBox({ text }) {
  return (
    <div style={{
      marginBottom: 10, padding: '10px 12px', borderRadius: 10,
      background: '#FBE9E5', border: `1px solid #F0C8BE`, color: T.bad,
      fontSize: 12.5, fontWeight: 500, textAlign: 'center',
    }}>
      {text}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// PANTALLA: Turno activo (header + cerrar turno)
// ──────────────────────────────────────────────────────────────
function ActiveSession({ session, userDoc, authUser }) {
  const [newSaleOpen, setNewSaleOpen] = useState(false)
  const [editingTab, setEditingTab] = useState(null)  // tab abierto en NewSale
  const [expenseOpen, setExpenseOpen] = useState(false)
  const [showDeductions, setShowDeductions] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false) // pantalla "Mis ventas" (Fase 9)
  const [boredomOpen, setBoredomOpen] = useState(false) // panel "¿estás aburrida?"
  const [cashierProducts, setCashierProducts] = useState([])
  const [sessionSales, setSessionSales] = useState([])
  const [sessionExpenses, setSessionExpenses] = useState([])
  const [myDeductions, setMyDeductions] = useState([])
  const [reportSale, setReportSale] = useState(null)
  const [myTasks, setMyTasks] = useState([])
  const branches = getData().branches || []

  useEffect(() => watchCashierProducts(setCashierProducts), [])

  // Productos del catálogo SIN precio en la panadería actual (excluye venta libre)
  const missingPriceCount = useMemo(() => {
    const adminProducts = getData().products || []
    const catalog = mergeProductCatalogs(adminProducts, cashierProducts)
    return catalog.filter(p => !p.freeAmount && getProductPrice(p, session.branchId) === null).length
  }, [cashierProducts, session.branchId])

  useEffect(() => {
    const unsub = watchSessionSales(session.id, setSessionSales)
    return unsub
  }, [session.id])

  useEffect(() => {
    const unsub = watchSessionExpenses(session.id, setSessionExpenses)
    return unsub
  }, [session.id])

  useEffect(() => {
    const unsub = watchAllDeductionsForCashier(authUser.uid, setMyDeductions)
    return unsub
  }, [authUser.uid])

  useEffect(() => {
    const unsub = watchTasksForCashier(authUser.uid, setMyTasks)
    return unsub
  }, [authUser.uid])

  // Llamadas pendientes de cocina dirigidas a esta cajera.
  // Si hay alguna, se monta el overlay bloqueante encima de toda la UI.
  const [pendingCalls, setPendingCalls] = useState([])
  useEffect(() => {
    const unsub = watchPendingCallsForCashier(authUser.uid, setPendingCalls)
    return unsub
  }, [authUser.uid])
  const activeCall = pendingCalls[0] || null

  // Notificación SONORA (sin nada visual) cuando cocina marca un almuerzo
  // de esta sesión como 'ready'. Detectamos transiciones pending→ready
  // contra un baseline tomado en el primer snapshot — así no suena al
  // cargar la app si ya había orders listos de antes.
  const readyBaselineRef = useRef(null) // null = aún sin baseline
  useEffect(() => {
    readyBaselineRef.current = null // reset al cambiar de sesión
    return watchLiveOrdersForSession(session.id, (orders) => {
      const readyNow = new Set(
        orders.filter(o => o.status === 'ready').map(o => o.id)
      )
      if (readyBaselineRef.current === null) {
        readyBaselineRef.current = readyNow
        return
      }
      const newlyReady = [...readyNow].some(id => !readyBaselineRef.current.has(id))
      if (newlyReady) {
        try { playOrderReadySound() } catch {}
      }
      readyBaselineRef.current = readyNow
    })
  }, [session.id])

  // Mostrar últimas 15 ventas (D21: sin totales agregados)
  const recentSales = sessionSales.slice(0, 15)
  const pendingDeductions = myDeductions.filter(d => d.status === 'pending')

  // Tareas relevantes para este turno:
  //   - Pendientes que aplican a esta panadería (o sin panadería específica)
  //   - Hechas que se completaron EN este turno (para verlas tachadas)
  const turnTasks = useMemo(() => {
    const branchOk = (t) => !t.branchId || String(t.branchId) === String(session.branchId)
    return myTasks.filter(t => {
      if (t.status === 'pending') return branchOk(t)
      if (t.status === 'done' && t.completedInSessionId === session.id) return true
      return false
    })
  }, [myTasks, session.id, session.branchId])
  const branch = branches.find(b => b.id === session.branchId) || { name: session.branchName, colorKey: 'copper' }
  const colorKey = branch.colorKey || 'copper'
  const palette = T[colorKey] || T.copper

  const openedAt = session.openedAt?.toDate?.() || new Date()
  const openedTime = openedAt.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false })
  const openedDay = openedAt.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' })

  return (
    <div style={{ padding: '24px 18px 40px', maxWidth: 540, margin: '0 auto' }}>
      <div style={{
        fontSize: 13, fontWeight: 700, color: palette[500] || T.copper[500],
        letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 4,
      }}>
        Turno activo
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.6, marginBottom: 4 }}>
        {branch.name}
      </div>
      <div style={{ fontSize: 13, color: T.neutral[500], marginBottom: 18 }}>
        Iniciado {openedDay} a las {openedTime}
      </div>

      {/* Botón principal: Nueva venta (las mesas se crean desde aquí al agregar items) */}
      <button
        onClick={() => setNewSaleOpen(true)}
        style={{
          width: '100%', padding: '20px', borderRadius: 18,
          background: T.copper[500], color: '#fff',
          border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 17, fontWeight: 800, letterSpacing: -0.2,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          boxShadow: '0 6px 18px rgba(184,122,86,0.4)',
          marginBottom: 10,
        }}
      >
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <circle cx="11" cy="11" r="9" stroke="#fff" strokeWidth="2" fill="none"/>
          <path d="M11 7 V15 M7 11 H15" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/>
        </svg>
        Nueva venta
      </button>

      {/* Botones secundarios: Gasto de caja + Mis ventas */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
        <button
          onClick={() => setExpenseOpen(true)}
          style={{
            padding: '13px 10px', borderRadius: 14,
            background: '#fff', color: T.neutral[700],
            border: `1.5px solid ${T.neutral[200]}`,
            cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 13, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
            <path d="M3 17 H17 M3 14 L7 10 L11 13 L17 5" stroke={T.neutral[600]} strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Gasto de caja
        </button>
        <button
          onClick={() => setHistoryOpen(true)}
          style={{
            padding: '13px 10px', borderRadius: 14,
            background: '#fff', color: T.neutral[700],
            border: `1.5px solid ${T.neutral[200]}`,
            cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 13, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="7.5" stroke={T.neutral[600]} strokeWidth="1.7" fill="none"/>
            <path d="M10 5 V10 L13 12" stroke={T.neutral[600]} strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Mis ventas
        </button>
      </div>

      {/* Banner sorpresa: aparece solo si hay productos sin precio en esta panaderia.
          NO revela de qué se trata — la cajera lo descubre al tocar. */}
      {missingPriceCount > 0 && (
        <button
          onClick={() => setBoredomOpen(true)}
          style={{
            width: '100%', padding: '14px 16px', borderRadius: 16, marginBottom: 14,
            background: 'linear-gradient(135deg, #FFE4D2 0%, #FFD0B0 100%)',
            border: `1.5px solid ${T.copper[200]}`,
            cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', gap: 12,
            textAlign: 'left',
            boxShadow: '0 3px 10px rgba(184,122,86,0.15)',
            transition: 'transform 0.12s',
          }}
          onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.98)' }}
          onMouseUp={e => { e.currentTarget.style.transform = 'scale(1)' }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)' }}
        >
          <div style={{ fontSize: 28, lineHeight: 1, flexShrink: 0 }}>🥱</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 800, color: T.copper[700], letterSpacing: -0.2 }}>
              ¿Estás aburrida?
            </div>
            <div style={{ fontSize: 11.5, color: T.copper[700], opacity: 0.85, marginTop: 2 }}>
              Tap para descubrir algo útil que puedes hacer 👀
            </div>
          </div>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, color: T.copper[700] }}>
            <path d="M3 1 L9 7 L3 13" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      )}

      {/* Card de estado activo (sin mostrar monto — control anti-fraude D21) */}
      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 999, flexShrink: 0,
            background: '#E8F4E8',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{ width: 12, height: 12, borderRadius: 999, background: T.ok }}/>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.neutral[900], marginBottom: 2 }}>
              Tu turno está activo
            </div>
            <div style={{ fontSize: 12, color: T.neutral[500], lineHeight: 1.45 }}>
              Vende y registra gastos. El administrador cierra la caja al final.
            </div>
          </div>
        </div>
      </Card>

      {/* Tareas del turno */}
      {turnTasks.length > 0 && (
        <CashierTaskList tasks={turnTasks} sessionId={session.id} />
      )}

      {/* Últimas ventas (sin montos — D21) */}
      {recentSales.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{
            fontSize: 12, fontWeight: 700, color: T.neutral[500],
            letterSpacing: 0.5, textTransform: 'uppercase',
            margin: '0 4px 8px',
          }}>
            Últimas ventas
          </div>
          <Card padding={0} style={{ overflow: 'hidden' }}>
            {recentSales.map((s, i) => (
              <SaleRow
                key={s.id}
                sale={s}
                isLast={i === recentSales.length - 1}
                onClick={() => setReportSale(s)}
              />
            ))}
          </Card>
          {sessionSales.length > 15 && (
            <div style={{
              fontSize: 11.5, color: T.neutral[400],
              textAlign: 'center', marginTop: 8,
            }}>
              + {sessionSales.length - 15} ventas anteriores en este turno
            </div>
          )}
        </div>
      )}

      {/* Gastos del turno */}
      {sessionExpenses.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{
            fontSize: 12, fontWeight: 700, color: T.neutral[500],
            letterSpacing: 0.5, textTransform: 'uppercase',
            margin: '0 4px 8px',
          }}>
            Gastos de caja del turno
          </div>
          <Card padding={0} style={{ overflow: 'hidden' }}>
            {sessionExpenses.map((e, i) => (
              <ExpenseRow
                key={e.id}
                expense={e}
                isLast={i === sessionExpenses.length - 1}
              />
            ))}
          </Card>
        </div>
      )}

      {/* Mis descuentos (transparencia para la cajera) */}
      {myDeductions.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <button
            onClick={() => setShowDeductions(v => !v)}
            style={{
              width: '100%', padding: '12px 14px', borderRadius: 14,
              background: pendingDeductions.length > 0 ? '#FBE9E5' : T.neutral[100],
              border: pendingDeductions.length > 0 ? `1px solid #F0C8BE` : `1px solid ${T.neutral[200]}`,
              cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}
          >
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: pendingDeductions.length > 0 ? T.bad : T.neutral[700] }}>
                Mis descuentos
              </div>
              <div style={{ fontSize: 11.5, color: T.neutral[500], marginTop: 1 }}>
                {pendingDeductions.length > 0
                  ? `${pendingDeductions.length} pendiente(s) · ${myDeductions.length - pendingDeductions.length} aplicado(s)`
                  : `${myDeductions.length} en total`}
              </div>
            </div>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ transform: showDeductions ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
              <path d="M3 5 L7 9 L11 5" stroke={T.neutral[600]} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          {showDeductions && (
            <Card padding={0} style={{ marginTop: 8, overflow: 'hidden' }}>
              {myDeductions.map((d, i) => (
                <div key={d.id} style={{
                  padding: '10px 14px',
                  borderBottom: i < myDeductions.length - 1 ? `0.5px solid ${T.neutral[100]}` : 'none',
                  display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.neutral[800] }}>
                      {d.reason === 'cash_shortage' ? 'Falta de caja' : d.reason}
                    </div>
                    <div style={{ fontSize: 11, color: T.neutral[500], marginTop: 1 }}>
                      {d.createdAt?.toDate?.().toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }) || ''}
                      {d.status === 'applied' && d.appliedToPaymentDate && ` · aplicado ${d.appliedToPaymentDate}`}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: d.status === 'pending' ? T.bad : T.neutral[600], fontVariantNumeric: 'tabular-nums' }}>
                      −{fmtCOP(d.amount)}
                    </div>
                    <span style={{
                      fontSize: 9.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
                      color: d.status === 'pending' ? T.bad : d.status === 'applied' ? T.neutral[500] : T.neutral[400],
                      background: d.status === 'pending' ? '#FBE9E5' : T.neutral[100],
                      padding: '2px 6px', borderRadius: 999,
                    }}>
                      {d.status === 'pending' ? 'pendiente' : d.status === 'applied' ? 'aplicado' : 'cancelado'}
                    </span>
                  </div>
                </div>
              ))}
            </Card>
          )}
        </div>
      )}

      {/* Footer informativo: el admin cierra el turno (D25) */}
      <div style={{
        padding: '14px 16px', borderRadius: 14,
        background: T.neutral[100], border: `1px solid ${T.neutral[200]}`,
        fontSize: 12.5, color: T.neutral[600], textAlign: 'center', lineHeight: 1.55,
      }}>
        Cuando termines tu turno, el administrador cerrará la caja.
      </div>

      {newSaleOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 60, background: T.neutral[50],
          animation: 'slideUp 0.25s cubic-bezier(0.2,0.9,0.3,1.05)',
        }}>
          <ErrorBoundary label="la pantalla de nueva venta">
            <NewSale
              session={session}
              authUser={authUser}
              userDoc={userDoc}
              onCancel={() => setNewSaleOpen(false)}
              onSaved={() => setNewSaleOpen(false)}
            />
          </ErrorBoundary>
        </div>
      )}

      {historyOpen && (
        <MyHistoricalSales
          authUser={authUser}
          userDoc={userDoc}
          onClose={() => setHistoryOpen(false)}
          onReport={(sale) => setReportSale(sale)}
        />
      )}

      {editingTab && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 60, background: T.neutral[50],
          animation: 'slideUp 0.25s cubic-bezier(0.2,0.9,0.3,1.05)',
        }}>
          <ErrorBoundary label="la mesa">
            <NewSale
              session={session}
              authUser={authUser}
              userDoc={userDoc}
              tab={editingTab}
              onCancel={() => setEditingTab(null)}
              onSaved={() => setEditingTab(null)}
            />
          </ErrorBoundary>
        </div>
      )}

      {/* Burbujas de mesas abiertas — siempre visibles mientras haya turno */}
      <OpenTabsBubbles
        sessionId={session.id}
        onSelect={tab => setEditingTab(tab)}
      />

      {/* Panel "¿estás aburrida?" — productos sin precio en esta panadería */}
      {boredomOpen && (
        <MissingPricesPanel
          branchId={session.branchId}
          branchName={session.branchName}
          branches={branches}
          onClose={() => setBoredomOpen(false)}
        />
      )}

      {reportSale && (
        <ReportSaleModal
          sale={reportSale}
          authUser={authUser}
          userDoc={userDoc}
          onCancel={() => setReportSale(null)}
          onDone={() => setReportSale(null)}
        />
      )}

      {expenseOpen && (
        <CashExpenseModal
          session={session}
          authUser={authUser}
          userDoc={userDoc}
          onCancel={() => setExpenseOpen(false)}
          onSaved={() => setExpenseOpen(false)}
        />
      )}

      {/* Overlay bloqueante: la cocinera está llamando a esta cajera.
          No se puede cerrar de otra forma, solo tocando "Voy en camino". */}
      {activeCall && (
        <KitchenCallOverlay
          call={activeCall}
          authUser={authUser}
          userDoc={userDoc}
        />
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Overlay bloqueante cuando la cocinera llama a la cajera.
// La cajera no puede interactuar con la app hasta confirmar.
// Vibra al aparecer y reintenta la vibración cada pocos segundos.
// ──────────────────────────────────────────────────────────────
function KitchenCallOverlay({ call, authUser, userDoc }) {
  const [busy, setBusy] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  // Vibración + sonido inmediato y ráfaga de recordatorios mientras
  // la cajera no atienda. Ambos van juntos para máxima atención.
  useEffect(() => {
    function pulse() {
      try { navigator.vibrate?.([300, 120, 300, 120, 500]) } catch {}
      try { playKitchenCallSound() } catch {}
    }
    pulse()
    const id = setInterval(pulse, 4500)
    return () => clearInterval(id)
  }, [call.id])

  async function handleConfirm() {
    if (busy) return
    setBusy(true)
    try {
      try { navigator.vibrate?.(0) } catch {}
      const cashierName = `${userDoc?.nombre || ''} ${userDoc?.apellido || ''}`.trim()
        || authUser?.email || 'Cajera'
      await acknowledgeKitchenCall(call.id, {
        byUid: authUser.uid,
        byName: cashierName,
      })
      setConfirmed(true)
      // El overlay desaparecerá solo cuando el watcher reciba el update.
      // Mientras tanto mostramos el flash de "Listo, vas en camino".
    } catch (err) {
      console.error('[kitchenCalls] acknowledge error:', err)
      setBusy(false)
      setConfirmed(false)
    }
  }

  const fromName = call.createdByName || 'Cocina'

  return createPortal((
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(20, 16, 12, 0.78)',
      backdropFilter: 'blur(4px)',
      WebkitBackdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 18,
      animation: 'kcOverlayIn 0.22s ease-out',
    }}>
      <div style={{
        width: '100%', maxWidth: 420,
        background: '#fff', borderRadius: 26,
        boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
        overflow: 'hidden',
        animation: 'kcCardIn 0.32s cubic-bezier(0.2,0.9,0.3,1.05)',
        position: 'relative',
      }}>
        <div style={{
          padding: '28px 24px 22px',
          background: 'linear-gradient(135deg, #FFE4D2 0%, #F0BFA0 100%)',
          textAlign: 'center',
          borderBottom: `1.5px solid ${T.copper[200]}`,
          position: 'relative',
          overflow: 'hidden',
        }}>
          {/* Halo pulsante detrás del icono */}
          <div style={{
            position: 'absolute',
            top: '50%', left: '50%',
            width: 180, height: 180,
            borderRadius: 999,
            background: 'rgba(255,255,255,0.5)',
            transform: 'translate(-50%, -55%)',
            animation: 'kcHalo 1.6s ease-out infinite',
            pointerEvents: 'none',
          }}/>
          <div style={{
            position: 'relative',
            width: 96, height: 96, borderRadius: 999,
            background: '#fff',
            margin: '0 auto 14px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: `0 10px 28px ${T.copper[500]}55`,
            animation: 'kcBell 0.9s ease-in-out infinite',
          }}>
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 3 C8.7 3 6 5.7 6 9 V13 L4 16 H20 L18 13 V9 C18 5.7 15.3 3 12 3 Z"
                stroke={T.copper[700]} strokeWidth="1.9" fill="none" strokeLinejoin="round"
              />
              <path
                d="M10 19 C10 20.1 10.9 21 12 21 C13.1 21 14 20.1 14 19"
                stroke={T.copper[700]} strokeWidth="1.9" fill="none" strokeLinecap="round"
              />
            </svg>
          </div>
          <div style={{
            position: 'relative',
            fontSize: 12, fontWeight: 900,
            color: T.copper[700], letterSpacing: 1.2,
            textTransform: 'uppercase',
          }}>
            Te llaman de cocina
          </div>
          <div style={{
            position: 'relative',
            fontSize: 26, fontWeight: 900,
            color: T.neutral[900], letterSpacing: -0.5,
            lineHeight: 1.15, marginTop: 6,
          }}>
            Por favor sube a cocina
          </div>
          <div style={{
            position: 'relative',
            fontSize: 13, color: T.copper[700], opacity: 0.85,
            marginTop: 8, fontWeight: 700,
          }}>
            {fromName} te necesita
          </div>
        </div>

        <div style={{ padding: '22px 22px 18px', textAlign: 'center' }}>
          <div style={{
            fontSize: 13.5, color: T.neutral[600], lineHeight: 1.55,
            marginBottom: 18,
          }}>
            La app está bloqueada hasta que confirmes. Toca el botón cuando vayas
            a subir para que la cocinera sepa que la viste.
          </div>

          <button
            onClick={handleConfirm}
            disabled={busy || confirmed}
            style={{
              width: '100%', padding: '18px',
              borderRadius: 16,
              background: confirmed ? T.ok : T.copper[500],
              color: '#fff',
              border: 'none',
              cursor: busy ? 'wait' : 'pointer',
              fontFamily: 'inherit',
              fontSize: 17, fontWeight: 900, letterSpacing: 0.3,
              boxShadow: confirmed
                ? `0 8px 20px ${T.ok}66`
                : `0 8px 22px ${T.copper[500]}66`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 10,
              transition: 'background 0.2s, box-shadow 0.2s',
            }}
          >
            {confirmed ? (
              <>
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                  <path d="M5 11 L9 15 L17 7" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Listo, ya vas en camino
              </>
            ) : busy ? (
              'Enviando...'
            ) : (
              <>
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                  <path d="M5 11 L9 15 L17 7" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Voy en camino
              </>
            )}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes kcOverlayIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes kcCardIn {
          from { opacity: 0; transform: scale(0.92) translateY(14px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes kcBell {
          0%, 100% { transform: rotate(0deg); }
          15%      { transform: rotate(-12deg); }
          30%      { transform: rotate(10deg); }
          45%      { transform: rotate(-8deg); }
          60%      { transform: rotate(6deg); }
          75%      { transform: rotate(-3deg); }
        }
        @keyframes kcHalo {
          0%   { transform: translate(-50%, -55%) scale(0.6); opacity: 0.7; }
          100% { transform: translate(-50%, -55%) scale(1.4); opacity: 0; }
        }
      `}</style>
    </div>
  ), document.body)
}

// ──────────────────────────────────────────────────────────────
// Fila de gasto en lista (la cajera SI ve montos: ella misma los digitó)
// ──────────────────────────────────────────────────────────────
function ExpenseRow({ expense, isLast }) {
  const time = expense.createdAt?.toDate?.()
  const timeStr = time
    ? time.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false })
    : '—'

  const statusColor = {
    pending: T.warn,
    approved: T.ok,
    rejected: T.bad,
  }[expense.status] || T.neutral[500]

  const statusLabel = {
    pending: 'Pendiente',
    approved: 'Aprobado',
    rejected: 'Rechazado',
  }[expense.status] || expense.status

  return (
    <div style={{
      padding: '12px 14px',
      borderBottom: isLast ? 'none' : `0.5px solid ${T.neutral[100]}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <div style={{
          fontSize: 12, fontWeight: 700, color: T.neutral[500],
          fontVariantNumeric: 'tabular-nums', minWidth: 42, flexShrink: 0,
        }}>
          {timeStr}
        </div>
        <div style={{
          flex: 1, minWidth: 0,
          fontSize: 13.5, fontWeight: 600, color: T.neutral[900],
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {expense.description}
        </div>
        <div style={{
          fontSize: 13.5, fontWeight: 700, color: T.neutral[800],
          fontVariantNumeric: 'tabular-nums', flexShrink: 0,
        }}>
          {fmtCOP(expense.amount)}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 52 }}>
        <span style={{
          fontSize: 10.5, fontWeight: 700, color: statusColor,
          background: statusColor + '15',
          padding: '2px 8px', borderRadius: 999,
          letterSpacing: 0.4, textTransform: 'uppercase',
        }}>
          {statusLabel}
        </span>
        {expense.status === 'rejected' && expense.reviewNote && (
          <span style={{
            fontSize: 11.5, color: T.bad, fontStyle: 'italic',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {expense.reviewNote}
          </span>
        )}
        {expense.photoUrl && (
          <a
            href={expense.photoUrl}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 11, color: T.copper[600], textDecoration: 'none', fontWeight: 600 }}
          >
            📎 Ver foto
          </a>
        )}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Modal: Registrar gasto de caja
// ──────────────────────────────────────────────────────────────
function CashExpenseModal({ session, authUser, userDoc, onCancel, onSaved }) {
  const [description, setDescription] = useState('')
  const [amountStr, setAmountStr] = useState('')
  const [photoUrl, setPhotoUrl] = useState(null)
  const [photoBlob, setPhotoBlob] = useState(null)
  const [photoLocalPreview, setPhotoLocalPreview] = useState(null)
  const [photoOfflineQueued, setPhotoOfflineQueued] = useState(false)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoError, setPhotoError] = useState(null)
  const fileInputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    return () => {
      if (photoLocalPreview) URL.revokeObjectURL(photoLocalPreview)
    }
  }, [photoLocalPreview])

  const amount = Number(amountStr) || 0
  const valid = description.trim().length >= 3 && amount > 0 && !photoUploading

  async function handleFileSelected(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setPhotoError(null)
    setPhotoUploading(true)
    setPhotoOfflineQueued(false)
    if (photoLocalPreview) URL.revokeObjectURL(photoLocalPreview)
    setPhotoLocalPreview(null)
    setPhotoBlob(null)
    setPhotoUrl(null)

    let compressed = null
    try {
      compressed = await compressImage(file)
    } catch (err) {
      console.error(err)
      setPhotoError(err.message || 'No pudimos procesar la foto.')
      setPhotoUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    setPhotoBlob(compressed)
    setPhotoLocalPreview(URL.createObjectURL(compressed))

    const online = typeof navigator !== 'undefined' ? navigator.onLine : true
    if (!online) {
      setPhotoOfflineQueued(true)
      setPhotoUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    try {
      const result = await uploadToImageBB(compressed)
      setPhotoUrl(result.url)
      setPhotoOfflineQueued(false)
    } catch (err) {
      console.warn('[CashExpense] upload falló, queda en cola offline:', err?.message)
      setPhotoOfflineQueued(true)
    } finally {
      setPhotoUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleSave() {
    if (!valid || busy) return
    setBusy(true); setError(null)
    try {
      const cashierName = `${userDoc?.nombre || ''} ${userDoc?.apellido || ''}`.trim() || authUser.email

      // Caso B (foto offline): pre-generar localId para que el doc nazca con
      // photoLocalId + photoStatus='pending' desde la creacion. Esto evita
      // un updateDoc post-create — importante porque las reglas actuales de
      // /cashExpenses NO permiten a la cajera updatear (solo crear).
      // OJO: aun asi, cuando la red vuelva el worker hara updateDoc para
      // grabar photoUrl + photoStatus='uploaded' — eso requiere que la regla
      // permita a la cajera updatear sus propios cashExpenses 'pending'
      // restringido a campos de foto (ver doc).
      let photoLocalId = null
      if (!photoUrl && photoBlob) {
        photoLocalId = makePhotoLocalId()
      }

      const expenseId = await createCashExpense({
        sessionId: session.id,
        branchId: session.branchId,
        branchName: session.branchName,
        cashierUid: authUser.uid,
        cashierName,
        description,
        amount,
        photoUrl: photoUrl || undefined,
        photoLocalId: photoLocalId || undefined,
      })

      if (photoLocalId && photoBlob && expenseId) {
        try {
          await enqueuePhoto(
            photoBlob,
            { collection: 'cashExpenses', docId: expenseId },
            photoLocalId,
          )
        } catch (queueErr) {
          console.warn('[CashExpense] no se pudo encolar la foto offline:', queueErr)
        }
      }
      onSaved()
    } catch (err) {
      console.error(err)
      setError('No pudimos guardar el gasto. Intenta de nuevo.')
      setBusy(false)
    }
  }

  return (
    <ModalOverlay onClose={busy ? undefined : onCancel}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 440, background: '#fff', borderRadius: 22,
        padding: '24px 22px 22px', boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
        animation: 'fadeScaleIn 0.2s ease',
        maxHeight: '92vh', overflowY: 'auto',
      }}>
        <div style={{ fontSize: 19, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3, marginBottom: 4 }}>
          Registrar gasto de caja
        </div>
        <div style={{ fontSize: 12.5, color: T.neutral[500], marginBottom: 16 }}>
          Quedará pendiente de aprobación del administrador.
        </div>

        <ExpenseTextField
          label="¿Para qué fue?"
          value={description}
          onChange={setDescription}
          placeholder="Ej: Compra de empaques al proveedor"
          autoFocus
          disabled={busy}
        />

        <ExpenseNumberField
          label="Monto"
          value={amountStr}
          onChange={setAmountStr}
          disabled={busy}
        />

        {/* Foto opcional */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: T.neutral[600], display: 'block', marginBottom: 6 }}>
            Foto del recibo (opcional)
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileSelected}
            style={{ display: 'none' }}
          />
          {!photoUrl && !photoLocalPreview && !photoUploading && !photoError && (
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                width: '100%', padding: '14px', borderRadius: 12,
                background: '#fff', color: T.neutral[600],
                border: `1.5px dashed ${T.neutral[300]}`,
                cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 13, fontWeight: 600,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              📸 Adjuntar foto
            </button>
          )}
          {photoUploading && (
            <div style={{
              padding: '14px', borderRadius: 12, textAlign: 'center',
              background: T.neutral[50], border: `1.5px solid ${T.neutral[200]}`,
              fontSize: 13, color: T.neutral[600], fontWeight: 600,
            }}>
              Subiendo foto...
            </div>
          )}
          {photoError && !photoUploading && (
            <div style={{
              padding: '11px 14px', borderRadius: 12,
              background: '#FBE9E5', border: `1px solid #F0C8BE`,
              fontSize: 12.5, color: T.bad, fontWeight: 500,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            }}>
              <span style={{ flex: 1 }}>{photoError}</span>
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{
                  padding: '6px 12px', borderRadius: 8,
                  background: T.bad, color: '#fff', border: 'none',
                  fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Reintentar
              </button>
            </div>
          )}
          {(photoUrl || photoLocalPreview) && !photoUploading && (
            <div style={{
              borderRadius: 12, overflow: 'hidden',
              border: `1.5px solid ${(photoUrl ? T.ok : T.warn) + '66'}`,
              background: '#fff',
            }}>
              <div style={{ position: 'relative' }}>
                <img
                  src={photoUrl || photoLocalPreview}
                  alt="Recibo"
                  style={{
                    display: 'block', width: '100%', maxHeight: 180,
                    objectFit: 'contain', background: T.neutral[900],
                  }}
                />
                {!photoUrl && (
                  <div style={{
                    position: 'absolute', top: 6, right: 6,
                    background: T.warn, color: '#fff',
                    padding: '3px 9px', borderRadius: 999,
                    fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3,
                  }}>
                    ⏳ Pendiente
                  </div>
                )}
              </div>
              {!photoUrl && photoOfflineQueued && (
                <div style={{
                  padding: '7px 12px',
                  background: '#FFF7E6',
                  borderTop: `1px solid #F4E0BC`,
                  fontSize: 11.5, color: T.warn, fontWeight: 600,
                }}>
                  Sin conexion · subira al volver la red.
                </div>
              )}
              <button
                onClick={() => {
                  setPhotoUrl(null)
                  setPhotoBlob(null)
                  setPhotoOfflineQueued(false)
                  if (photoLocalPreview) URL.revokeObjectURL(photoLocalPreview)
                  setPhotoLocalPreview(null)
                }}
                style={{
                  width: '100%', padding: '8px',
                  background: 'transparent', border: 'none',
                  borderTop: `1px solid ${T.neutral[100]}`,
                  cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 12, fontWeight: 600, color: T.neutral[600],
                }}
              >
                Quitar foto
              </button>
            </div>
          )}
        </div>

        <div style={{
          padding: '11px 14px', borderRadius: 12,
          background: '#FFF7E6', border: `1px solid #F4E0BC`,
          fontSize: 12.5, color: T.warn, fontWeight: 500, lineHeight: 1.5,
          marginBottom: 14,
        }}>
          ⚠ Este monto reduce tu caja del turno. Cuando cierres el turno, ya estará descontado.
        </div>

        {error && <ErrorBox text={error} />}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCancel} disabled={busy} style={btnSecondary()}>Cancelar</button>
          <button
            onClick={handleSave}
            disabled={!valid || busy}
            style={{
              ...btnPrimary(valid && !busy ? T.copper[500] : T.neutral[200]),
              flex: 1.4,
              color: valid && !busy ? '#fff' : T.neutral[400],
              cursor: valid && !busy ? 'pointer' : 'not-allowed',
              boxShadow: valid && !busy ? '0 3px 10px rgba(184,122,86,0.3)' : 'none',
            }}
          >
            {busy ? 'Guardando...' : 'Registrar gasto'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

function ExpenseTextField({ label, value, onChange, placeholder, autoFocus, disabled }) {
  const [focused, setFocused] = useState(false)
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: T.neutral[600], display: 'block', marginBottom: 6 }}>
        {label}
      </label>
      <div style={{
        border: `1.5px solid ${focused ? T.copper[400] : T.neutral[200]}`,
        borderRadius: 12, background: '#fff', transition: 'border-color 0.12s',
      }}>
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            width: '100%', padding: '12px 14px', border: 'none', outline: 'none',
            fontFamily: 'inherit', fontSize: 14.5, color: T.neutral[900],
            background: 'transparent', borderRadius: 12,
            opacity: disabled ? 0.6 : 1,
          }}
        />
      </div>
    </div>
  )
}

function ExpenseNumberField({ label, value, onChange, disabled }) {
  const [focused, setFocused] = useState(false)
  function sanitize(raw) {
    return raw.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '')
  }
  const display = value === '0' ? '' : value
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: T.neutral[600], display: 'block', marginBottom: 6 }}>
        {label}
      </label>
      <div style={{
        border: `1.5px solid ${focused ? T.copper[400] : T.neutral[200]}`,
        borderRadius: 12, background: '#fff', transition: 'border-color 0.12s',
        display: 'flex', alignItems: 'center',
      }}>
        <span style={{ paddingLeft: 14, color: T.neutral[500], fontSize: 15, fontWeight: 600 }}>$</span>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={display}
          onChange={e => onChange(sanitize(e.target.value))}
          placeholder="0"
          disabled={disabled}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            width: '100%', padding: '12px 14px 12px 8px', border: 'none', outline: 'none',
            fontFamily: 'inherit', fontSize: 16, color: T.neutral[900],
            background: 'transparent', borderRadius: 12,
            opacity: disabled ? 0.6 : 1,
            fontVariantNumeric: 'tabular-nums', fontWeight: 600,
          }}
        />
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Fila de venta en lista (sin monto — D21)
// ──────────────────────────────────────────────────────────────
function SaleRow({ sale, isLast, onClick }) {
  const time = sale.createdAt?.toDate?.()
  const timeStr = time
    ? time.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false })
    : '—'

  const itemsCount = sale.items?.length || 0
  const firstName = sale.items?.[0]?.name || ''
  const summary = itemsCount === 1
    ? firstName
    : itemsCount > 1
      ? `${firstName} + ${itemsCount - 1} más`
      : 'Sin productos'

  const methodIcons = {
    efectivo: '💵',
    nequi: '📱',
    daviplata: '📱',
    deuda: '🤝',
    mixto: '🔀',
  }
  const methodIcon = methodIcons[sale.paymentMethod] || ''

  const isFlagged = sale.status === 'flagged'

  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', padding: '12px 14px',
        background: isFlagged ? '#FFF7E6' : 'transparent',
        border: 'none', cursor: 'pointer', fontFamily: 'inherit',
        borderBottom: isLast ? 'none' : `0.5px solid ${T.neutral[100]}`,
        display: 'flex', alignItems: 'center', gap: 10,
        textAlign: 'left',
      }}
    >
      <div style={{
        fontSize: 12, fontWeight: 700, color: T.neutral[500],
        fontVariantNumeric: 'tabular-nums', minWidth: 42, flexShrink: 0,
      }}>
        {timeStr}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13.5, fontWeight: 600, color: T.neutral[900],
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {summary}
        </div>
        {isFlagged && (
          <div style={{ fontSize: 11, color: T.warn, fontWeight: 600, marginTop: 2 }}>
            ⚠ Reportado al admin
          </div>
        )}
        {sale.recordedByUid && sale.recordedByRole === 'admin' && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            marginTop: 4, padding: '2px 8px', borderRadius: 999,
            background: '#FFF7E6', border: `1px solid #F4E0BC`,
            fontSize: 10.5, fontWeight: 700, color: '#7A5C00',
            letterSpacing: 0.3, textTransform: 'uppercase',
          }}>
            👤 Hecha por admin{sale.recordedByName ? ` · ${sale.recordedByName}` : ''}
          </div>
        )}
        {sale.paymentMethod === 'deuda' && sale.debtorName && !isFlagged && (
          <div style={{
            fontSize: 11, color: T.neutral[500], marginTop: 2,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            deudor: {sale.debtorName}
          </div>
        )}
      </div>
      <div style={{ fontSize: 16, flexShrink: 0 }} title={sale.paymentMethod}>
        {methodIcon}
      </div>
    </button>
  )
}

// ──────────────────────────────────────────────────────────────
// Modal: Reportar problema con una venta
// ──────────────────────────────────────────────────────────────
function ReportSaleModal({ sale, authUser, userDoc, onCancel, onDone }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const isAlreadyFlagged = sale.status === 'flagged'
  const valid = note.trim().length >= 10

  function handleReport() {
    if (!valid || busy) return
    setBusy(true); setError(null)
    try {
      const cashierName = `${userDoc?.nombre || ''} ${userDoc?.apellido || ''}`.trim() || authUser.email
      // flagSale es fire-and-forget: encola el reporte y no se cuelga en modo
      // ahorro. No usar await.
      flagSale(sale.id, {
        note,
        byUid: authUser.uid,
        byName: cashierName,
      })
      onDone()
    } catch (err) {
      console.error(err)
      setError('No pudimos enviar el reporte. Intenta de nuevo.')
      setBusy(false)
    }
  }

  const time = sale.createdAt?.toDate?.()
  const timeStr = time
    ? time.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false })
    : '—'

  return (
    <ModalOverlay onClose={onCancel}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 420, background: '#fff', borderRadius: 22,
        padding: '24px 22px 22px', boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
        animation: 'fadeScaleIn 0.2s ease',
        maxHeight: '92vh', overflowY: 'auto',
      }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3, marginBottom: 4 }}>
          Reportar problema
        </div>
        <div style={{ fontSize: 12.5, color: T.neutral[500], marginBottom: 16 }}>
          Venta de las {timeStr} · {sale.items?.length || 0} producto(s)
        </div>

        {/* Lista de items para que la cajera identifique cuál es */}
        <div style={{
          padding: '10px 12px', borderRadius: 12,
          background: T.neutral[50], marginBottom: 14,
          maxHeight: 140, overflowY: 'auto',
        }}>
          {sale.items?.map((it, i) => (
            <div key={i} style={{
              fontSize: 12.5, color: T.neutral[700],
              padding: '3px 0',
              display: 'flex', justifyContent: 'space-between', gap: 8,
            }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {it.qty}× {it.name}
              </span>
            </div>
          ))}
        </div>

        {isAlreadyFlagged ? (
          <>
            <div style={{
              padding: '12px 14px', borderRadius: 12,
              background: '#FFF7E6', border: `1px solid #F4E0BC`,
              fontSize: 13, color: T.warn, lineHeight: 1.5, marginBottom: 14,
            }}>
              Esta venta ya está reportada al admin. Estas son las notas dejadas:
            </div>
            <div style={{
              padding: '10px 12px', borderRadius: 10,
              background: '#fff', border: `1px solid ${T.neutral[100]}`,
              maxHeight: 200, overflowY: 'auto', marginBottom: 14,
            }}>
              {(sale.notes || []).map((n, i) => (
                <div key={i} style={{
                  padding: '6px 0',
                  borderBottom: i < (sale.notes.length - 1) ? `0.5px solid ${T.neutral[100]}` : 'none',
                  fontSize: 12.5, color: T.neutral[700], lineHeight: 1.5,
                }}>
                  <div style={{ fontWeight: 600, color: T.neutral[800], marginBottom: 2 }}>
                    {n.byName || 'Cajera'}
                  </div>
                  <div>{n.message}</div>
                </div>
              ))}
            </div>
            <button onClick={onCancel} style={btnSecondary()}>Cerrar</button>
          </>
        ) : (
          <>
            <NoteField
              label="¿Qué pasó? (mínimo 10 caracteres)"
              value={note}
              onChange={setNote}
              placeholder="Ej: La cantidad de panes está mal, eran 3 no 5..."
              disabled={busy}
            />

            <div style={{
              padding: '11px 14px', borderRadius: 12,
              background: '#FFF7E6', border: `1px solid #F4E0BC`,
              fontSize: 12.5, color: T.warn, fontWeight: 500, lineHeight: 1.5,
              marginTop: 4, marginBottom: 14,
            }}>
              ⚠ La venta no se modifica ni se elimina. El admin verá tu reporte y decidirá qué hacer.
            </div>

            {error && <ErrorBox text={error} />}

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={onCancel} style={btnSecondary()}>Cancelar</button>
              <button
                onClick={handleReport}
                disabled={!valid || busy}
                style={{
                  ...btnPrimary(valid && !busy ? T.warn : T.neutral[200]),
                  flex: 1.4,
                  color: valid && !busy ? '#fff' : T.neutral[400],
                  cursor: valid && !busy ? 'pointer' : 'not-allowed',
                }}
              >
                {busy ? 'Reportando...' : 'Reportar al admin'}
              </button>
            </div>
          </>
        )}
      </div>
    </ModalOverlay>
  )
}

// ──────────────────────────────────────────────────────────────
// Componentes utilitarios
// ──────────────────────────────────────────────────────────────
function NoteField({ label, value, onChange, placeholder, disabled }) {
  const [focused, setFocused] = useState(false)
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: T.neutral[600], display: 'block', marginBottom: 6 }}>
        {label}
      </label>
      <div style={{
        border: `1.5px solid ${focused ? T.copper[400] : T.neutral[200]}`,
        borderRadius: 12, background: '#fff',
        transition: 'border-color 0.12s',
      }}>
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          rows={3}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            width: '100%', padding: '12px 14px', border: 'none', outline: 'none',
            fontFamily: 'inherit', fontSize: 14, color: T.neutral[900],
            background: 'transparent', borderRadius: 12, resize: 'vertical',
            opacity: disabled ? 0.6 : 1,
            minHeight: 64,
          }}
        />
      </div>
    </div>
  )
}


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

function btnPrimary(bg) {
  return {
    flex: 1, padding: '12px', borderRadius: 12,
    background: bg, color: '#fff',
    border: 'none', cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
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

// ──────────────────────────────────────────────────────────────
// Card "Tareas del turno" (vista cajera)
// Lista compacta con checkbox tipo radio. Tap → chulea (con micro-animación).
// Re-tap → des-chulea (mientras el turno siga abierto).
// ──────────────────────────────────────────────────────────────
function CashierTaskList({ tasks, sessionId }) {
  // Las pendientes arriba, las completadas (en este turno) abajo tachadas
  const sorted = useMemo(() => {
    const pending = tasks.filter(t => t.status === 'pending')
    const done = tasks.filter(t => t.status === 'done')
    return [...pending, ...done]
  }, [tasks])

  const pendingCount = tasks.filter(t => t.status === 'pending').length
  const doneCount = tasks.filter(t => t.status === 'done').length
  const allDone = pendingCount === 0 && doneCount > 0

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        margin: '0 4px 8px', gap: 8,
      }}>
        <div style={{
          fontSize: 12, fontWeight: 700, color: T.neutral[500],
          letterSpacing: 0.5, textTransform: 'uppercase',
        }}>
          Tus tareas
        </div>
        <div style={{
          fontSize: 11, fontWeight: 700,
          color: allDone ? T.ok : T.copper[700],
        }}>
          {allDone
            ? '✓ Todas hechas'
            : `${doneCount}/${pendingCount + doneCount} hechas`}
        </div>
      </div>

      <Card padding={0} style={{
        overflow: 'hidden',
        background: allDone ? '#F5FBF5' : '#fff',
        border: allDone ? `1px solid ${T.ok}40` : `1px solid ${T.neutral[100]}`,
        transition: 'background 0.3s, border-color 0.3s',
      }}>
        {sorted.map((task, i) => (
          <CashierTaskRow
            key={task.id}
            task={task}
            sessionId={sessionId}
            isLast={i === sorted.length - 1}
          />
        ))}
      </Card>

      <style>{`
        @keyframes taskTickPop {
          0%   { transform: scale(0.5); opacity: 0; }
          60%  { transform: scale(1.15); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes taskRowSlide {
          from { background: #FFF8E0; }
          to   { background: transparent; }
        }
      `}</style>
    </div>
  )
}

function CashierTaskRow({ task, sessionId, isLast }) {
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const isDone = task.status === 'done'

  async function handleToggle() {
    if (busy) return
    setBusy(true)
    try {
      if (isDone) {
        await unmarkTaskDone(task.id)
      } else {
        await markTaskDone(task.id, { sessionId })
      }
    } catch (err) {
      console.error('[tasks] toggle failed:', err)
    } finally {
      setBusy(false)
    }
  }

  // Días restantes/vencido (solo si pending)
  const dueInfo = useMemo(() => {
    if (!task.dueDate || isDone) return null
    const today = new Date().toISOString().slice(0, 10)
    const diff = Math.ceil((new Date(task.dueDate + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000)
    if (diff < 0) return { text: `Vencida hace ${-diff}d`, color: T.bad }
    if (diff === 0) return { text: 'Hoy', color: T.warn }
    if (diff === 1) return { text: 'Mañana', color: T.warn }
    return null
  }, [task.dueDate, isDone])

  return (
    <div
      style={{
        padding: '14px 14px 14px 12px',
        borderBottom: isLast ? 'none' : `0.5px solid ${T.neutral[100]}`,
        display: 'flex', alignItems: 'flex-start', gap: 12,
        background: isDone ? 'transparent' : '#fff',
        transition: 'opacity 0.25s',
        opacity: isDone ? 0.6 : 1,
        cursor: task.description ? 'pointer' : 'default',
      }}
    >
      {/* Checkbox */}
      <button
        onClick={(e) => { e.stopPropagation(); handleToggle() }}
        disabled={busy}
        aria-label={isDone ? 'Desmarcar tarea' : 'Marcar tarea como hecha'}
        style={{
          flexShrink: 0,
          width: 26, height: 26, borderRadius: 8,
          background: isDone ? T.ok : '#fff',
          border: `2px solid ${isDone ? T.ok : T.neutral[300]}`,
          cursor: busy ? 'wait' : 'pointer',
          padding: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background 0.18s, border-color 0.18s, transform 0.12s',
          marginTop: 1,
        }}
        onMouseDown={e => { if (!busy) e.currentTarget.style.transform = 'scale(0.92)' }}
        onMouseUp={e => { e.currentTarget.style.transform = 'scale(1)' }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)' }}
      >
        {isDone && (
          <svg
            width="14" height="14" viewBox="0 0 14 14" fill="none"
            style={{ animation: 'taskTickPop 0.32s cubic-bezier(0.2,0.9,0.3,1.4)' }}
          >
            <path d="M2.5 7.5 L5.5 10 L11 4" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </button>

      {/* Contenido */}
      <div
        onClick={() => task.description && setExpanded(v => !v)}
        style={{ flex: 1, minWidth: 0 }}
      >
        <div style={{
          fontSize: 14.5, fontWeight: 700,
          color: isDone ? T.neutral[500] : T.neutral[900],
          textDecoration: isDone ? 'line-through' : 'none',
          letterSpacing: -0.2,
          lineHeight: 1.35,
          transition: 'color 0.18s',
        }}>
          {task.title}
        </div>

        {/* Descripción colapsable */}
        {task.description && (
          <div style={{
            fontSize: 12.5, color: T.neutral[600], marginTop: 4,
            lineHeight: 1.45,
            display: expanded ? 'block' : '-webkit-box',
            WebkitLineClamp: expanded ? 'unset' : 1,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            whiteSpace: 'pre-wrap',
          }}>
            {task.description}
          </div>
        )}

        {/* Meta */}
        {(dueInfo || task.branchName || task.createdByName) && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginTop: 6,
            flexWrap: 'wrap',
          }}>
            {dueInfo && (
              <span style={{
                fontSize: 11, fontWeight: 700, color: dueInfo.color,
                background: `${dueInfo.color}15`,
                padding: '2px 8px', borderRadius: 999,
              }}>
                ⏰ {dueInfo.text}
              </span>
            )}
            {task.branchName && (
              <span style={{
                fontSize: 11, fontWeight: 600, color: T.neutral[500],
              }}>
                {task.branchName}
              </span>
            )}
            {task.createdByName && !isDone && (
              <span style={{ fontSize: 11, color: T.neutral[400] }}>
                · {task.createdByName}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

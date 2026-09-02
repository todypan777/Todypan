import { useState, useReducer, useCallback, useEffect } from 'react'
import { T } from './tokens'
import InstallPrompt from './components/UI/InstallPrompt'
import ErrorBoundary from './components/ErrorBoundary'
import { getData, initDB } from './db'
import { TabBar, Sidebar } from './components/Nav'
import NotificationBell from './components/NotificationBell'
import ConnectionChip from './components/ConnectionChip'
import { DesktopCtx } from './context/DesktopCtx'
import { AuthProvider, useAuth, hasCachedFirebaseSession, readUserDocCache } from './context/AuthCtx'
import { ADMIN_EMAIL } from './auth'
import { useOnlineStatus } from './utils/network'
import Dashboard from './screens/Dashboard'
import Movements from './screens/Movements'
import AddMovement from './screens/AddMovement'
import Team from './screens/Team'
import Reports from './screens/Reports'
import Reminders from './screens/Reminders'
import More from './screens/More'
import Branches from './screens/Branches'
import Registro from './screens/Registro'
import Products from './screens/Products'
import Inventario from './screens/Inventario'
import Pendientes from './screens/Pendientes'
import Deudores from './screens/Deudores'
import Transferencias from './screens/Transferencias'
import Tasks from './screens/Tasks'
import Almuerzos from './screens/Almuerzos'
import Desayunos from './screens/Desayunos'
import Cuentas from './screens/Cuentas'
import Login from './screens/Login'
import {
  RegistrationForm,
  PendingApproval,
  Deactivated,
  BootstrappingAdmin,
} from './screens/AccountStates'
import StaffApp from './screens/StaffApp'
import PublicMenu from './screens/PublicMenu'
import OrderConfirm from './screens/OrderConfirm'

const SIDEBAR_W = 230

function LoadingScreen({ label = 'Cargando TodyPan...' }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100dvh', background: '#FAF7F2', flexDirection: 'column', gap: 16,
    }}>
      <div style={{ fontSize: 52 }}>🥖</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#B08060', letterSpacing: 0.3 }}>{label}</div>
    </div>
  )
}

// Rutas públicas (sin login forzado). Se interceptan ANTES del AuthGate.
//   /menu             → página del cliente, sin AuthProvider (totalmente público)
//   /comanda/{id}     → pantalla de confirmación de pedido web. USA
//                       AuthProvider para detectar si quien la abre es admin
//                       (que ve "Confirmar") vs cliente (que ve resumen).
const MENU_PATH = '/menu'
const COMANDA_PREFIX = '/comanda/'

function currentPath() {
  if (typeof window === 'undefined') return '/'
  return window.location.pathname || '/'
}

export default function App() {
  const path = currentPath()

  // Página pública del menú — sin AuthProvider (no necesita saber del user).
  if (path === MENU_PATH || path.startsWith(MENU_PATH + '/')) {
    return (
      <ErrorBoundary label="la página pública">
        <PublicMenu />
      </ErrorBoundary>
    )
  }

  // Página de confirmación de pedido web — pública pero CON AuthProvider
  // para poder leer si el visitante es admin (sin forzar login a los demás).
  if (path.startsWith(COMANDA_PREFIX)) {
    const orderId = path.slice(COMANDA_PREFIX.length).split('/')[0] || null
    return (
      <ErrorBoundary label="la confirmación de pedido">
        <AuthProvider>
          <OrderConfirm orderId={orderId} />
        </AuthProvider>
      </ErrorBoundary>
    )
  }

  // App normal (admin / cajera / cocinera) — fuerza login vía AuthGate.
  return (
    <ErrorBoundary label="la app">
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </ErrorBoundary>
  )
}

function AuthGate() {
  const { authUser, userDoc: ctxUserDoc, loading, isAdmin: ctxIsAdmin } = useAuth()
  const online = useOnlineStatus()

  // Fallback al caché de localStorage cuando AuthCtx aún no nos dio userDoc.
  // Esto evita el "frame" de RegistrationForm que la cajera ve cuando vuelve
  // la red y authUser llega antes que el snapshot del listener de Firestore.
  const cachedDoc = !ctxUserDoc && authUser ? readUserDocCache(authUser.uid) : null
  const userDoc = ctxUserDoc || cachedDoc
  const isAdmin = ctxIsAdmin || (!!userDoc && userDoc.role === 'admin' && userDoc.status === 'approved')
  // Cualquier miembro del equipo que no sea admin. Acepta el rol nuevo 'staff'
  // y también los roles viejos 'cashier'/'cook' por compat (data legacy).
  const isStaff = !!userDoc
    && userDoc.status === 'approved'
    && userDoc.role !== 'admin'
    && ['staff', 'cashier', 'cook'].includes(userDoc.role)

  if (loading) return <LoadingScreen label="Verificando sesión..." />

  // Sin authUser:
  //   - Si offline Y este celular tuvo sesión antes → es muy probable que
  //     Firebase Auth no haya terminado de cargar la sesión por falta de
  //     red. Mostrar Login no ayuda porque el botón de Google fallaría.
  //     En su lugar, mostrar splash "Sin conexión, esperando..." hasta que
  //     vuelva la red.
  //   - Si online o nunca hubo sesión → Login normal.
  if (!authUser) {
    if (!online && hasCachedFirebaseSession()) {
      return <LoadingScreen label="Sin conexión — reconectando tu sesión..." />
    }
    return <Login />
  }

  // Admin email pero todavía sin doc → bootstrap automático en AuthCtx
  if (!userDoc) {
    if (!online) {
      return <LoadingScreen label="Sin conexión — cargando tu cuenta..." />
    }
    if (authUser.email === ADMIN_EMAIL) return <BootstrappingAdmin />
    return <RegistrationForm authUser={authUser} />
  }

  if (userDoc.status === 'pending') return <PendingApproval authUser={authUser} userDoc={userDoc} />
  if (userDoc.status === 'inactive') return <Deactivated authUser={authUser} userDoc={userDoc} />

  if (isAdmin || isStaff) {
    const approvedApp = isAdmin
      ? <AppShell />
      : <StaffApp authUser={authUser} userDoc={userDoc} />
    return <ApprovedAppLoader>{approvedApp}</ApprovedAppLoader>
  }

  // Estado inesperado (rol vacío, status raro): mostrar Login fallback
  return <Login unauthorizedEmail={authUser.email} />
}

/**
 * Carga los datos compartidos (todypan/data) de Firestore antes de renderizar
 * la app del admin o la cajera. Las dos necesitan acceso a branches/products/etc.
 */
function ApprovedAppLoader({ children }) {
  const [dbLoaded, setDbLoaded] = useState(false)

  useEffect(() => {
    initDB()
      .then(() => setDbLoaded(true))
      .catch(() => setDbLoaded(true))
  }, [])

  if (!dbLoaded) return <LoadingScreen label="Cargando datos..." />
  return children
}

function AppShell() {
  // authUser/userDoc viven en AuthGate; aquí se vuelven a pedir al contexto.
  // Las pantallas que reciben el usuario (Balance, Inventario, Nuevo
  // movimiento) los necesitan para saber qué panadería puede ver.
  const { authUser, userDoc } = useAuth()

  const [tab, setTab] = useState('home')
  const [filter, setFilter] = useState('all')
  const [modal, setModal] = useState(null)
  const [moreSub, setMoreSub] = useState(null)
  const [pendingEmpId, setPendingEmpId] = useState(null)

  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 1024)

  useEffect(() => {
    const handler = () => setIsDesktop(window.innerWidth >= 1024)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  // Botón "atrás" (Android / gesto): si el modal de Nuevo Movimiento está abierto,
  // que el back lo CIERRE en vez de salir de la app. Lo integramos con el historial:
  // al abrir empujamos un estado; al cerrarlo por UI lo consumimos; al apretar atrás
  // se dispara popstate y cerramos el modal.
  useEffect(() => {
    if (!modal) return
    window.history.pushState({ todypanModal: true }, '')
    const onPop = () => setModal(null)
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      if (window.history.state?.todypanModal) window.history.back()
    }
  }, [modal])

  const [dataTick, forceUpdate] = useReducer(x => x + 1, 0)
  const refresh = useCallback(() => forceUpdate(), [])

  const data = getData()

  function handleNav(target, meta) {
    if (target === 'add') {
      setModal({ kind: meta?.kind || 'income' })
    } else if (target === 'emp') {
      setPendingEmpId(meta?.empId)
      setTab('team')
    } else if (target === 'reminders') {
      setMoreSub('reminders')
      setTab('more')
    } else if (target === 'users') {
      // 'users' ahora vive dentro de Equipo (tab Pendientes/Inactivos)
      setMoreSub(null)
      setTab('team')
    } else if (target === 'pendientes') {
      setMoreSub('pendientes')
      setTab('more')
    } else if (target === 'deudores') {
      setMoreSub('deudores')
      setTab('more')
    } else if (target === 'transferencias') {
      setMoreSub('transferencias')
      setTab('more')
    } else if (target === 'tasks') {
      setMoreSub('tasks')
      setTab('more')
    } else if (target === 'almuerzos') {
      setMoreSub('almuerzos')
      setTab('more')
    } else if (target === 'desayunos') {
      setMoreSub('desayunos')
      setTab('more')
    } else if (target === 'cuentas') {
      setMoreSub('cuentas')
      setTab('more')
    } else {
      setTab(target)
    }
  }

  function handleTabChange(t) {
    if (t === 'add') {
      setModal({ kind: 'income' })
      return
    }
    // En desktop, los sub-ítems de "Más" se navegan directamente desde el sidebar
    if (['movements', 'reports', 'reminders', 'branches', 'products', 'inventario', 'pendientes', 'deudores', 'transferencias', 'tasks', 'almuerzos', 'desayunos', 'cuentas'].includes(t)) {
      setMoreSub(t)
      setTab('more')
      return
    }
    setMoreSub(null)
    setPendingEmpId(null)
    setTab(t)
  }

  const activeTab = ['home','registro','team','more'].includes(tab) ? tab : 'more'

  let content
  if (tab === 'home') {
    content = (
      <Dashboard
        onNav={handleNav}
        filter={filter}
        setFilter={setFilter}
        movements={data.movements}
        reminders={data.reminders}
      />
    )
  } else if (tab === 'movements') {
    content = (
      <Movements
        filter={filter}
        setFilter={setFilter}
        movements={data.movements}
        incomeCats={data.incomeCats}
        expenseCats={data.expenseCats}
        onNav={handleNav}
        onRefresh={refresh}
      />
    )
  } else if (tab === 'registro') {
    content = (
      <Registro onRefresh={refresh} />
    )
  } else if (tab === 'team') {
    content = (
      <Team
        employees={data.employees}
        onRefresh={refresh}
        initialEmpId={pendingEmpId}
        onClearEmpId={() => setPendingEmpId(null)}
      />
    )
  } else if (tab === 'more') {
    if (moreSub === 'movements') {
      content = (
        <Movements
          filter={filter}
          setFilter={setFilter}
          movements={data.movements}
          incomeCats={data.incomeCats}
          expenseCats={data.expenseCats}
          onNav={handleNav}
          onRefresh={refresh}
        />
      )
    } else if (moreSub === 'reports') {
      content = (
        <Reports
          filter={filter}
          setFilter={setFilter}
          userDoc={userDoc}
          movements={data.movements}
          incomeCats={data.incomeCats}
          expenseCats={data.expenseCats}
          onBack={() => setMoreSub(null)}
        />
      )
    } else if (moreSub === 'reminders') {
      content = (
        <Reminders
          reminders={data.reminders}
          onBack={() => setMoreSub(null)}
          onRefresh={refresh}
        />
      )
    } else if (moreSub === 'branches') {
      content = (
        <Branches
          branches={data.branches}
          onBack={() => setMoreSub(null)}
          onRefresh={refresh}
        />
      )
    } else if (moreSub === 'products') {
      content = (
        <Products
          products={data.products || []}
          onBack={() => setMoreSub(null)}
          onRefresh={refresh}
        />
      )
    } else if (moreSub === 'inventario') {
      content = (
        <Inventario
          authUser={authUser}
          userDoc={userDoc}
          onBack={() => setMoreSub(null)}
        />
      )
    } else if (moreSub === 'pendientes') {
      content = (
        <Pendientes
          onBack={() => setMoreSub(null)}
          onOpenUsers={() => { setMoreSub(null); setTab('team') }}
          onOpenProducts={() => setMoreSub('products')}
          onOpenReminders={() => setMoreSub('reminders')}
          dataTick={dataTick}
        />
      )
    } else if (moreSub === 'deudores') {
      content = (
        <Deudores
          onBack={() => setMoreSub(null)}
        />
      )
    } else if (moreSub === 'transferencias') {
      content = <Transferencias />
    } else if (moreSub === 'tasks') {
      content = (
        <Tasks
          onBack={() => setMoreSub(null)}
        />
      )
    } else if (moreSub === 'almuerzos') {
      content = <Almuerzos />
    } else if (moreSub === 'desayunos') {
      content = <Desayunos />
    } else if (moreSub === 'cuentas') {
      content = <Cuentas />
    } else if (moreSub === 'team') {
      content = (
        <Team
          employees={data.employees}
          onRefresh={refresh}
          initialEmpId={pendingEmpId}
          onClearEmpId={() => setPendingEmpId(null)}
        />
      )
    } else {
      content = <More onOpen={id => setMoreSub(id)} />
    }
  }

  // ── Modal de nuevo movimiento (desktop = centrado, móvil = fullscreen) ──
  const addMovementOverlay = modal && (
    isDesktop ? (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 80,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }} onClick={() => setModal(null)}>
        <div onClick={e => e.stopPropagation()} style={{
          width: 480, maxHeight: '90vh', borderRadius: 24,
          background: T.neutral[50], overflow: 'hidden',
          boxShadow: '0 24px 64px rgba(0,0,0,0.2)',
          animation: 'fadeScaleIn 0.2s ease',
        }}>
          <AddMovement
            initialKind={modal.kind}
            userDoc={userDoc}
            onBack={() => setModal(null)}
            onSave={() => { setModal(null); refresh() }}
            incomeCats={data.incomeCats}
            expenseCats={data.expenseCats}
          />
        </div>
      </div>
    ) : (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 80,
        background: T.neutral[50],
        animation: 'slideUp 0.28s cubic-bezier(0.2,0.9,0.3,1.2)',
      }}>
        <AddMovement
          initialKind={modal.kind}
          userDoc={userDoc}
          onBack={() => setModal(null)}
          onSave={() => { setModal(null); refresh() }}
          incomeCats={data.incomeCats}
          expenseCats={data.expenseCats}
        />
      </div>
    )
  )

  return (
    <DesktopCtx.Provider value={isDesktop}>
      <div style={{
        minHeight: '100dvh',
        background: isDesktop ? T.neutral[100] : T.neutral[50],
        fontFamily: '-apple-system, "SF Pro Text", "Inter", system-ui, sans-serif',
        color: T.neutral[800],
      }}>

        {isDesktop ? (
          /* ── Layout desktop ── */
          <div style={{ display: 'flex', minHeight: '100dvh' }}>
            <Sidebar active={tab === 'more' && moreSub ? moreSub : activeTab} onChange={handleTabChange} />
            <main style={{
              flex: 1,
              marginLeft: SIDEBAR_W,
              minHeight: '100dvh',
              overflowY: 'auto',
              background: T.neutral[50],
            }}>
              <div style={{ maxWidth: 920, margin: '0 auto', minHeight: '100vh' }}>
                {content}
              </div>
            </main>
          </div>
        ) : (
          /* ── Layout móvil ── */
          <>
            <div style={{ minHeight: '100dvh', WebkitOverflowScrolling: 'touch' }}>
              {content}
            </div>
            <TabBar active={(tab === 'more' && moreSub === 'cuentas') ? 'cuentas' : activeTab} onChange={handleTabChange} />
          </>
        )}

        {addMovementOverlay}

        {/* Campanita de notificaciones global (oculta cuando ya estamos en Pendientes) */}
        <NotificationBell
          onOpenPendientes={() => handleNav('pendientes')}
          onOpenUsers={() => handleNav('users')}
          dataTick={dataTick}
          hidden={moreSub === 'pendientes'}
        />

        {/* Estado de sincronizacion offline (top-right, a la izquierda de la campana).
            Respeta safe-area-inset-top para no esconderse bajo el notch en iPhone. */}
        <div style={{
          position: 'fixed',
          top: 'calc(env(safe-area-inset-top, 0px) + 14px)',
          right: 62,
          zIndex: 50,
        }}>
          <ConnectionChip compact />
        </div>

        <InstallPrompt />

        <style>{`
          @keyframes slideUp {
            from { transform: translateY(100%); opacity: 0.9; }
            to { transform: translateY(0); opacity: 1; }
          }
          @keyframes fadeScaleIn {
            from { transform: scale(0.96); opacity: 0; }
            to { transform: scale(1); opacity: 1; }
          }
          * { -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
          body { margin: 0; background: ${T.neutral[100]}; }
          button:active { opacity: 0.75; }
          input[type="date"]::-webkit-calendar-picker-indicator { opacity: 0.6; cursor: pointer; }
          ::-webkit-scrollbar { display: none; }
          @media (min-width: 1024px) {
            ::-webkit-scrollbar { display: block; width: 6px; }
            ::-webkit-scrollbar-track { background: transparent; }
            ::-webkit-scrollbar-thumb { background: ${T.neutral[200]}; border-radius: 3px; }
            ::-webkit-scrollbar-thumb:hover { background: ${T.neutral[300]}; }
          }
        `}</style>
      </div>
    </DesktopCtx.Provider>
  )
}

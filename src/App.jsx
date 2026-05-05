import { useState, useReducer, useCallback, useEffect } from 'react'
import { T } from './tokens'
import InstallPrompt from './components/UI/InstallPrompt'
import { getData, getBogotaHour, getBogotaDateStr, isDayConfirmed, initDB } from './db'
import { TabBar, Sidebar } from './components/Nav'
import { DesktopCtx } from './context/DesktopCtx'
import { AuthProvider, useAuth } from './context/AuthCtx'
import { ADMIN_EMAIL } from './auth'
import Dashboard from './screens/Dashboard'
import Movements from './screens/Movements'
import AddMovement from './screens/AddMovement'
import Team from './screens/Team'
import Reports from './screens/Reports'
import Reminders from './screens/Reminders'
import More from './screens/More'
import Branches from './screens/Branches'
import DailyConfirmation, { DayEditModal } from './screens/DailyConfirmation'
import Registro from './screens/Registro'
import Products from './screens/Products'
import Users from './screens/Users'
import Pendientes from './screens/Pendientes'
import Login from './screens/Login'
import {
  RegistrationForm,
  PendingApproval,
  Deactivated,
  BootstrappingAdmin,
} from './screens/AccountStates'
import CashierApp from './screens/CashierApp'

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

export default function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  )
}

function AuthGate() {
  const { authUser, userDoc, loading, isAdmin, isCashier } = useAuth()

  if (loading) return <LoadingScreen label="Verificando sesión..." />
  if (!authUser) return <Login />

  // Admin email pero todavía sin doc → bootstrap automático en AuthCtx
  if (!userDoc) {
    if (authUser.email === ADMIN_EMAIL) return <BootstrappingAdmin />
    return <RegistrationForm authUser={authUser} />
  }

  if (userDoc.status === 'pending') return <PendingApproval authUser={authUser} userDoc={userDoc} />
  if (userDoc.status === 'inactive') return <Deactivated authUser={authUser} userDoc={userDoc} />

  if (isAdmin || isCashier) {
    return (
      <ApprovedAppLoader>
        {isAdmin
          ? <AppShell />
          : <CashierApp authUser={authUser} userDoc={userDoc} />}
      </ApprovedAppLoader>
    )
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
  const [tab, setTab] = useState('home')
  const [filter, setFilter] = useState('all')
  const [modal, setModal] = useState(null)
  const [moreSub, setMoreSub] = useState(null)
  const [pendingEmpId, setPendingEmpId] = useState(null)

  const [confirmingDate, setConfirmingDate] = useState(null)
  const [editingDate, setEditingDate] = useState(null)
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 1024)

  useEffect(() => {
    const handler = () => setIsDesktop(window.innerWidth >= 1024)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  const [, forceUpdate] = useReducer(x => x + 1, 0)
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
      setMoreSub('users')
      setTab('more')
    } else if (target === 'pendientes') {
      setMoreSub('pendientes')
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
    if (['movements', 'reports', 'reminders', 'branches', 'products', 'users', 'pendientes'].includes(t)) {
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
        employees={data.employees}
        attendance={data.attendance}
        reminders={data.reminders}
        onConfirmDay={() => setConfirmingDate(getBogotaDateStr())}
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
      <Registro
        employees={data.employees}
        attendance={data.attendance}
        onRefresh={refresh}
        onConfirmDay={date => setConfirmingDate(date)}
        onEditDay={date => setEditingDate(date)}
      />
    )
  } else if (tab === 'team') {
    content = (
      <Team
        filter={filter}
        setFilter={setFilter}
        employees={data.employees}
        attendance={data.attendance}
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
          movements={data.movements}
          employees={data.employees}
          attendance={data.attendance}
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
    } else if (moreSub === 'users') {
      content = (
        <Users
          onBack={() => setMoreSub(null)}
          onRefresh={refresh}
        />
      )
    } else if (moreSub === 'pendientes') {
      content = (
        <Pendientes
          onBack={() => setMoreSub(null)}
          onOpenUsers={() => setMoreSub('users')}
          onOpenProducts={() => setMoreSub('products')}
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
            <TabBar active={activeTab} onChange={handleTabChange} />
          </>
        )}

        {/* Confirmación de día */}
        {confirmingDate && (
          <DailyConfirmation
            date={confirmingDate}
            employees={data.employees}
            attendance={data.attendance}
            onDone={() => { setConfirmingDate(null); refresh() }}
            onRefresh={refresh}
          />
        )}

        {/* Edición de día confirmado */}
        {editingDate && (
          <DayEditModal
            date={editingDate}
            employees={data.employees}
            attendance={data.attendance}
            onDone={() => { setEditingDate(null); refresh() }}
            onRefresh={refresh}
          />
        )}

        {addMovementOverlay}

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

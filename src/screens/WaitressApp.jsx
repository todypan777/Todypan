import { useEffect, useMemo, useRef, useState } from 'react'
import { T } from '../tokens'
import { UserAvatar } from '../components/Atoms'
import { signOut } from '../auth'
import ErrorBoundary from '../components/ErrorBoundary'
import ConnectionChip from '../components/ConnectionChip'
import { watchOpenCashSessionForBranch } from '../cashSessions'
import { watchTasksForCashier } from '../tasks'
import { watchReadyOrdersForWaitress } from '../kitchenOrders'
import { setupAudioUnlock, playOrderReadySound } from '../utils/notificationSound'
import OpenTabsBubbles from '../components/OpenTabsBubbles'
import NewSale from './NewSale'
import { CashierTaskList } from './CashierApp'

/**
 * App de la MESERA / domiciliaria.
 *
 * La mesera toma pedidos en piso para la caja de su panadería. Abre mesas y
 * pedidos para llevar, arma almuerzos viendo el menú, pero NUNCA ve precios ni
 * cobra: el pedido le "llega" a la cajera (se engancha a la sesión de caja de
 * la panadería) y ella lo cobra.
 *
 * Requiere que haya una caja abierta en su panadería (D5: una sola por
 * panadería). Si no hay, ve una pantalla de espera.
 *
 * Props:
 *   - session: la sesión PROPIA de la mesera (type 'waitress'), con branchId,
 *     branchName, cashierUid (uid de la mesera), cashierName (su nombre).
 *   - assistMode (opt): por ahora no se usa (el admin no asiste meseras), pero
 *     se respeta para ocultar "Cerrar sesión" si algún día se habilita.
 */
export default function WaitressApp({ authUser, userDoc, session, assistMode }) {
  const isAssist = !!assistMode

  // Caja abierta de la panadería de la mesera (donde se enganchan sus mesas).
  // undefined = cargando · null = no hay caja abierta.
  const [cashSession, setCashSession] = useState(undefined)
  useEffect(
    () => watchOpenCashSessionForBranch(session.branchId, setCashSession),
    [session.branchId],
  )

  // Tareas asignadas a la mesera.
  const [tasks, setTasks] = useState([])
  useEffect(() => watchTasksForCashier(authUser.uid, setTasks), [authUser.uid])

  // Almuerzos que la mesera pidió y la cocina ya marcó LISTOS.
  const [readyOrders, setReadyOrders] = useState([])
  useEffect(() => watchReadyOrdersForWaitress(authUser.uid, setReadyOrders), [authUser.uid])

  // Estados de la pantalla de armado de pedido.
  const [newSaleOpen, setNewSaleOpen] = useState(false)
  const [editingTab, setEditingTab] = useState(null)
  const [busy, setBusy] = useState(false)

  // Audio: desbloquear en el primer gesto del usuario (iOS) para poder sonar
  // cuando la cocina marque listo un plato.
  useEffect(() => { setupAudioUnlock() }, [])

  const fullName = (`${userDoc?.nombre || ''} ${userDoc?.apellido || ''}`).trim()
    || session?.cashierName
    || authUser?.displayName
    || 'Mesera'
  const firstName = userDoc?.nombre || authUser?.displayName?.split(' ')[0] || 'Hola'

  const waitressMode = useMemo(
    () => ({ waitressUid: authUser.uid, waitressName: fullName }),
    [authUser.uid, fullName],
  )

  async function handleSignOut() {
    setBusy(true)
    try {
      await signOut()
    } catch (err) {
      console.error('Error al cerrar sesión:', err)
      setBusy(false)
    }
  }

  // ── Estados de carga / espera ──
  if (cashSession === undefined) {
    return <SplashScreen label="Conectando con la caja..." />
  }

  return (
    <div style={{
      minHeight: '100dvh', background: T.neutral[50],
      fontFamily: '-apple-system, "SF Pro Text", "Inter", system-ui, sans-serif',
      color: T.neutral[800],
    }}>
      {isAssist && <AssistBar name={session?.cashierName} branch={session?.branchName} onExit={() => assistMode.onExit?.()} />}

      {/* Header */}
      <div style={{
        background: '#fff', borderBottom: `1px solid ${T.neutral[100]}`,
        position: 'sticky', top: 0, zIndex: 20,
        paddingTop: isAssist ? 0 : 'env(safe-area-inset-top, 0px)',
      }}>
        <div style={{
          maxWidth: 560, margin: '0 auto',
          padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <UserAvatar user={userDoc || authUser} size={42} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.2 }}>
              {firstName}
            </div>
            <div style={{ fontSize: 12, color: T.neutral[500] }}>
              Mesera{session?.branchName ? ` · ${session.branchName}` : ''}
            </div>
          </div>
          <ConnectionChip compact />
        </div>
      </div>

      <div style={{ maxWidth: 560, margin: '0 auto', padding: '18px' }}>
        {cashSession === null ? (
          <WaitingForCashier branchName={session?.branchName} />
        ) : (
          <>
            {/* Aviso de platos listos */}
            <ReadyOrdersBanner orders={readyOrders} />

            {/* Botón principal: nuevo pedido */}
            <button
              onClick={() => setNewSaleOpen(true)}
              style={{
                width: '100%', padding: '20px', borderRadius: 18,
                background: T.copper[500], color: '#fff',
                border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 17, fontWeight: 800, letterSpacing: -0.2,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                boxShadow: '0 6px 18px rgba(184,122,86,0.4)',
                marginBottom: 16,
              }}
            >
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <circle cx="11" cy="11" r="9" stroke="#fff" strokeWidth="2" fill="none"/>
                <path d="M11 7 V15 M7 11 H15" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/>
              </svg>
              Nueva mesa o pedido
            </button>

            {/* Tareas */}
            {tasks.length > 0 && (
              <CashierTaskList tasks={tasks} sessionId={session.id} />
            )}

            {/* Pista de las burbujas */}
            <div style={{
              marginTop: 6, padding: '14px 16px', borderRadius: 14,
              background: '#fff', border: `1px dashed ${T.neutral[200]}`,
              fontSize: 12.5, color: T.neutral[600], lineHeight: 1.5, textAlign: 'center',
            }}>
              Tus mesas y pedidos aparecen como burbujas a los lados. Tócalas para
              agregar más. La cajera las cobra.
            </div>
          </>
        )}

        {!isAssist && (
          <button
            onClick={handleSignOut}
            disabled={busy}
            style={{
              width: '100%', marginTop: 22, padding: '11px',
              borderRadius: 12, border: `1px solid ${T.neutral[200]}`,
              background: 'transparent', color: T.neutral[600],
              fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
              cursor: busy ? 'wait' : 'pointer',
            }}
          >
            {busy ? 'Saliendo...' : 'Cerrar sesión'}
          </button>
        )}
      </div>

      {/* Burbujas de mesas de la panadería (las que ven la cajera y la mesera) */}
      {cashSession && (
        <OpenTabsBubbles
          sessionId={cashSession.id}
          onSelect={tab => setEditingTab(tab)}
        />
      )}

      {/* Pantalla de nuevo pedido */}
      {newSaleOpen && cashSession && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 60, background: T.neutral[50],
          animation: 'slideUp 0.25s cubic-bezier(0.2,0.9,0.3,1.05)',
        }}>
          <ErrorBoundary label="el pedido">
            <NewSale
              session={cashSession}
              authUser={authUser}
              userDoc={userDoc}
              waitressMode={waitressMode}
              onCancel={() => setNewSaleOpen(false)}
              onSaved={() => setNewSaleOpen(false)}
            />
          </ErrorBoundary>
        </div>
      )}

      {/* Editar una mesa existente */}
      {editingTab && cashSession && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 60, background: T.neutral[50],
          animation: 'slideUp 0.25s cubic-bezier(0.2,0.9,0.3,1.05)',
        }}>
          <ErrorBoundary label="la mesa">
            <NewSale
              session={cashSession}
              authUser={authUser}
              userDoc={userDoc}
              tab={editingTab}
              waitressMode={waitressMode}
              onCancel={() => setEditingTab(null)}
              onSaved={() => setEditingTab(null)}
            />
          </ErrorBoundary>
        </div>
      )}

      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); opacity: 0.9; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes readyPulse {
          0%, 100% { box-shadow: 0 4px 16px rgba(46,160,90,0.3); }
          50%      { box-shadow: 0 4px 24px rgba(46,160,90,0.55); }
        }
        * { -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
      `}</style>
    </div>
  )
}

// ── Aviso flotante: platos listos para llevar a la mesa ──
function ReadyOrdersBanner({ orders }) {
  // Tocar "Voy" descarta el aviso localmente (no cambia el estado del pedido —
  // ese lo maneja la cajera al cobrar). Si llega un pedido nuevo, vuelve a sonar.
  const [dismissed, setDismissed] = useState([])
  const prevIdsRef = useRef(new Set())

  const visible = useMemo(
    () => (orders || []).filter(o => !dismissed.includes(o.id)),
    [orders, dismissed],
  )

  // Sonido + vibración cuando aparece un pedido listo nuevo.
  useEffect(() => {
    const prev = prevIdsRef.current
    const nuevos = (orders || []).filter(o => !prev.has(o.id))
    if (nuevos.length > 0) {
      try { playOrderReadySound() } catch { /* noop */ }
      try { navigator.vibrate?.([120, 60, 120]) } catch { /* noop */ }
    }
    prevIdsRef.current = new Set((orders || []).map(o => o.id))
  }, [orders])

  if (visible.length === 0) return null

  // Etiquetas legibles de las mesas/clientes listos (sin repetir).
  const labels = []
  for (const o of visible) {
    const label = o.customerName
      ? `📦 ${o.customerName}`
      : `Mesa ${o.tableSuffix > 0 ? `${o.tableNumber}.${o.tableSuffix}` : o.tableNumber}`
    if (!labels.includes(label)) labels.push(label)
  }

  return (
    <div style={{
      marginBottom: 16, padding: '14px 16px', borderRadius: 16,
      background: T.ok, color: '#fff',
      display: 'flex', alignItems: 'center', gap: 12,
      animation: 'readyPulse 1.4s ease-in-out infinite',
    }}>
      <div style={{ fontSize: 26, lineHeight: 1, flexShrink: 0 }}>🛎️</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: -0.2 }}>
          ¡Listo para llevar!
        </div>
        <div style={{ fontSize: 12.5, opacity: 0.95, lineHeight: 1.4 }}>
          {labels.join(' · ')}
        </div>
      </div>
      <button
        onClick={() => setDismissed(visible.map(o => o.id))}
        style={{
          padding: '8px 14px', borderRadius: 999, flexShrink: 0,
          background: '#fff', color: T.ok,
          border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 13, fontWeight: 800,
        }}
      >
        Voy ✓
      </button>
    </div>
  )
}

// ── Pantalla cuando no hay caja abierta en la panadería ──
function WaitingForCashier({ branchName }) {
  return (
    <div style={{
      marginTop: 12, padding: '28px 22px', textAlign: 'center',
      background: '#fff', borderRadius: 20, border: `1px solid ${T.neutral[100]}`,
      boxShadow: '0 4px 16px rgba(0,0,0,0.05)',
    }}>
      <div style={{ fontSize: 44, marginBottom: 10 }}>⏳</div>
      <div style={{ fontSize: 17, fontWeight: 800, color: T.neutral[900], marginBottom: 6 }}>
        Esperando a la cajera
      </div>
      <div style={{ fontSize: 13.5, color: T.neutral[600], lineHeight: 1.5 }}>
        Para tomar pedidos necesitas que haya una caja abierta
        {branchName ? <> en <b>{branchName}</b></> : ' en tu panadería'}.
        En cuanto el admin abra la caja, esta pantalla se activa sola.
      </div>
    </div>
  )
}

function AssistBar({ name, branch, onExit }) {
  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 40,
      background: T.copper[700], color: '#fff',
      padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10,
      boxShadow: '0 2px 10px rgba(0,0,0,0.22)',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', opacity: 0.85 }}>
          Estás asistiendo
        </div>
        <div style={{ fontSize: 14.5, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {name || 'Mesera'}{branch ? ` · ${branch}` : ''}
        </div>
      </div>
      <button onClick={onExit} style={{
        padding: '9px 16px', borderRadius: 999,
        background: '#fff', color: T.copper[700], border: 'none',
        cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 800, flexShrink: 0,
      }}>
        Salir de asistir
      </button>
    </div>
  )
}

function SplashScreen({ label }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100dvh', background: T.neutral[50], flexDirection: 'column', gap: 16,
    }}>
      <div style={{ fontSize: 52 }}>🍽️</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: T.copper[500] }}>{label}</div>
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { T } from '../tokens'
import { Card } from './Atoms'
import { fmtCOP } from '../utils/format'
import { useAuth } from '../context/AuthCtx'
import {
  watchOpenSessions,
  openSession,
  adminCloseSession,
  adminCloseNonCashSession,
  discardEmptySession,
  getLatestClosedSessionForBranch,
} from '../cashSessions'
import { watchSessionSales } from '../sales'
import {
  watchSessionExpenses,
  approveCashExpense,
  rejectCashExpense,
} from '../cashExpenses'
import { watchAllUsers } from '../users'
import { addMovement, getData, getCashFloor, CASH_FLOOR_DEFAULT } from '../db'
import { addSaleToBreakdown, paymentDisplay, paymentSplitSummary } from '../utils/payment'
import { getCustomerOrder } from '../customerOrders'
import { buildKitchenNoteFromCustomerItem, buildLunchCommanda } from '../utils/lunchFormat'
import {
  watchOpenTabsForSession,
  deleteOpenTab,
  releaseTabForNextCashier,
  claimOrphanTab,
  listOrphanTabsForBranch,
  formatTableLabel,
} from '../openTabs'
import {
  releaseOrdersForTab,
  claimOrdersForTab,
  cancelOrdersForTab,
} from '../kitchenOrders'
import { ActiveSession } from '../screens/CashierApp'
import CookApp from '../screens/CookApp'
import WaitressApp from '../screens/WaitressApp'
import ErrorBoundary from './ErrorBoundary'

// Panadería destino de los pedidos web (debe coincidir con OrderConfirm.jsx).
const WEB_ORDER_BRANCH_NAME = 'Panadería B'

// Clave en localStorage para recordar a qué turno está asistiendo el admin.
// Permite que, al recargar la página, el admin vuelva directo al modo asistir
// (si la cajera sigue con turno abierto) en vez de quedar en el panel.
const ASSIST_STORAGE_KEY = 'todypan_assist_session_id'

// Convierte un item del cart de customerOrder al shape que usa el state
// `lunchCommanda` de NewSale (mismo que producen CashierLunchWizard /
// CashierSpecialWizard al armar un almuerzo).
// Los `replacements` (reemplazos del wizard cuando el cliente dice NO a
// sopa/principio) se concatenan al `note` para que viajen a cocina sin
// tocar el modelo de kitchenOrders.
function customerOrderItemToLunchPayload(item) {
  const isEspecial = item.kind === 'especial'
  // Ambos (corriente y especial) pueden tener replacements en el note
  // (corriente: soup/principio, especial: solo soup).
  const note = buildKitchenNoteFromCustomerItem({
    replacements: item.replacements,
    note: item.note,
  })
  return {
    kind: isEspecial ? 'special' : 'menu',
    productId: null,
    productName: isEspecial ? 'Almuerzo Especial' : 'Almuerzo Corriente',
    destination: 'llevar',
    // El especial NUEVO tiene selections (soup, especial, salad); el viejo
    // tenía solo description. Pasamos ambos para máxima compatibilidad.
    selections: item.selections || null,
    description: isEspecial ? (item.description || null) : null,
    price: Number(item.price) || 0,
    note,
  }
}

// Convierte el cart COMPLETO (con almuerzos + adiciones) al lunchCommanda
// que entiende NewSale. Reusa el helper compartido — la única lógica
// específica del cliente es mapear cada almuerzo a su payload (eso lo
// hace customerOrderItemToLunchPayload).
function customerCartToLunchCommanda(cart) {
  return buildLunchCommanda(cart, customerOrderItemToLunchPayload)
}

/**
 * Panel central del admin (D25): controla TODOS los turnos.
 *
 * Lista cada panadería con su estado actual y permite:
 *   - Abrir turno (panaderías sin sesión)
 *   - Cerrar caja (sesiones open o legacy pending_close)
 *   - Asistir (POS de la cajera mientras está ausente)
 *
 * Reemplaza el flujo anterior donde la cajera abría/cerraba.
 */
export default function ActiveTurnsCard() {
  const { authUser, userDoc } = useAuth()
  const [openSessions, setOpenSessions] = useState([])
  const [allUsers, setAllUsers] = useState([])
  // Turno que el admin está asistiendo. Cuando está poblado se monta la
  // pantalla COMPLETA de la cajera (ActiveSession) en modo asistir — idéntica
  // a la que ella ve. La navegación interna (nueva venta, mesas, gastos) la
  // maneja ActiveSession; aquí solo controlamos entrar/salir del modo.
  const [assistingSession, setAssistingSession] = useState(null)
  // Turno de cocina/mesera que el admin está asistiendo. Se monta CookApp o
  // WaitressApp en modo asistir (su pantalla real). Independiente del asistir
  // de caja de arriba: estos turnos no tienen el problema de "salir al crear
  // una mesa", así que no persisten tras recarga (parità con el flujo previo).
  const [assistingNonCash, setAssistingNonCash] = useState(null)
  // Pedido web pendiente que el admin entró a atender desde /comanda/{id}.
  // Cuando está poblado, el NewSale del modo asistir recibe sus almuerzos
  // pre-cargados en lunchCommanda y, al enviar la comanda, se marca el
  // customerOrder como confirmado.
  // shape: null | { id, lunchCommanda: [...] }
  const [pendingCustomerOrder, setPendingCustomerOrder] = useState(null)
  const [openingBranch, setOpeningBranch] = useState(null)
  const [openingNonCash, setOpeningNonCash] = useState(false)
  const [closingSession, setClosingSession] = useState(null)
  const [closingNonCashSession, setClosingNonCashSession] = useState(null)
  // Turno (caja o no-caja) que el admin quiere CANCELAR por haberlo abierto por
  // error. Solo se permite si está vacío (sin ventas/gastos/mesas).
  const [discardingSession, setDiscardingSession] = useState(null)

  useEffect(() => watchOpenSessions(setOpenSessions), [])
  useEffect(() => watchAllUsers(setAllUsers), [])

  // Entrar al modo asistir: monta ActiveSession y persiste el id para que la
  // recarga vuelva al mismo turno. Salir: desmonta y limpia la persistencia
  // (es la ÚNICA forma de salir — ningún flujo interno saca al admin).
  function enterAssist(sess) {
    if (!sess) return
    setAssistingSession(sess)
    try { localStorage.setItem(ASSIST_STORAGE_KEY, sess.id) } catch {}
  }
  function exitAssist() {
    setAssistingSession(null)
    setPendingCustomerOrder(null)
    try { localStorage.removeItem(ASSIST_STORAGE_KEY) } catch {}
  }

  // Restaurar tras recarga: si había un turno en asistencia guardado y sigue
  // abierto (tipo caja), volvemos directo al modo asistir. Solo intentamos una
  // vez por montaje. Si el turno ya se cerró, no restauramos (queda inerte).
  const restoredAssistRef = useRef(false)
  useEffect(() => {
    if (restoredAssistRef.current || assistingSession) return
    let stored = null
    try { stored = localStorage.getItem(ASSIST_STORAGE_KEY) } catch {}
    if (!stored) return
    const sess = openSessions.find(
      s => s.id === stored && (!s.type || s.type === 'cash')
    )
    if (sess) {
      restoredAssistRef.current = true
      setAssistingSession(sess)
    }
  }, [openSessions, assistingSession])

  // Pedido web pendiente de atender: se captura del query param ?assistOrder
  // al montar y se procesa cuando openSessions ya tiene la sesión de
  // Panadería B. Usamos ref (no state) porque no afecta el render.
  const pendingOrderIdRef = useRef(null)

  // 1) Captura: leer el query param al montar y limpiarlo de la URL.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const orderId = params.get('assistOrder')
    if (!orderId) return
    pendingOrderIdRef.current = orderId
    try {
      const url = new URL(window.location.href)
      url.searchParams.delete('assistOrder')
      window.history.replaceState({}, '', url.toString())
    } catch {}
  }, [])

  // 2) Procesa: cuando openSessions cambia, intentamos abrir el modo asistir
  //    si hay un orderId pendiente y un turno abierto en Panadería B.
  useEffect(() => {
    const orderId = pendingOrderIdRef.current
    if (!orderId) return
    if (assistingSession) return // ya estamos asistiendo, no re-abrir
    let cancelled = false
    ;(async () => {
      try {
        const branchesNow = getData().branches || []
        const targetBranch = branchesNow.find(b => b.name === WEB_ORDER_BRANCH_NAME)
        if (!targetBranch) return
        // El pedido web lo cobra la CAJA — debemos enganchar a la sesión de
        // caja, no a una de mesera/cocina que también puede estar abierta en
        // la misma panadería (si no, la burbuja no le llega a la cajera).
        const targetSession = openSessions.find(
          s => s.branchId === targetBranch.id && (!s.type || s.type === 'cash')
        )
        if (!targetSession) return  // sin caja abierta, esperamos a que abra
        const order = await getCustomerOrder(orderId)
        if (cancelled) return
        if (!order || order.status === 'confirmed') {
          // Pedido ya confirmado o no encontrado — limpiar y salir.
          pendingOrderIdRef.current = null
          return
        }
        const lunchCommanda = customerCartToLunchCommanda(order.cart || [])
        pendingOrderIdRef.current = null
        setPendingCustomerOrder({ id: orderId, lunchCommanda })
        enterAssist(targetSession)
      } catch (err) {
        console.warn('[ActiveTurnsCard] no se pudo cargar el pedido web:', err)
      }
    })()
    return () => { cancelled = true }
  }, [openSessions, assistingSession])

  const branches = getData().branches || []
  if (branches.length === 0) return null

  const adminName = `${userDoc?.nombre || ''} ${userDoc?.apellido || ''}`.trim() || authUser?.email || 'Admin'

  // Por cada panadería, determinar su estado actual de CAJA (solo sessions tipo
  // 'cash' o legacy sin type). Las sessions de cocina/mesera viven en la lista
  // de "Otros turnos" más abajo.
  const branchRows = branches.map(b => {
    const session = openSessions.find(s => s.branchId === b.id && (!s.type || s.type === 'cash'))
    return { branch: b, session }
  })

  const occupiedCount = branchRows.filter(r => r.session).length

  // Sessions de cocina / domiciliaria activas (cualquier panadería).
  const nonCashSessions = openSessions.filter(s => s.type === 'kitchen' || s.type === 'waitress')

  return (
    <>
      <div style={{ padding: '0 16px 16px' }}>
        <Card padding={0} style={{
          background: '#fff',
          border: `1px solid ${T.copper[100]}`,
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '12px 16px 8px',
            display: 'flex', alignItems: 'center', gap: 8,
            borderBottom: `1px solid ${T.neutral[100]}`,
          }}>
            <div style={{
              width: 8, height: 8, borderRadius: 999,
              background: occupiedCount > 0 ? T.ok : T.neutral[300],
              boxShadow: occupiedCount > 0 ? `0 0 0 4px ${T.ok}22` : 'none',
            }}/>
            <div style={{ flex: 1, fontSize: 12, fontWeight: 700, color: T.neutral[700], letterSpacing: 0.4, textTransform: 'uppercase' }}>
              Caja · {occupiedCount}/{branches.length} con turno
            </div>
            <button
              onClick={() => setOpeningNonCash(true)}
              title="Abrir turno de cocina o domiciliaria/mesera"
              style={{
                padding: '5px 10px', borderRadius: 999,
                background: T.copper[50], color: T.copper[700],
                border: `1px solid ${T.copper[200]}`,
                cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 11, fontWeight: 700, letterSpacing: 0.2,
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}
            >
              + Cocina / Mesera
            </button>
          </div>

          {branchRows.map((row, i) => (
            <BranchRow
              key={row.branch.id}
              branch={row.branch}
              session={row.session}
              isLast={i === branchRows.length - 1}
              onOpen={() => setOpeningBranch(row.branch)}
              onClose={() => setClosingSession(row.session)}
              onAssist={() => enterAssist(row.session)}
              onDiscard={() => setDiscardingSession(row.session)}
            />
          ))}
        </Card>

        {/* Sección: Turnos de cocina / mesera activos */}
        {nonCashSessions.length > 0 && (
          <Card padding={0} style={{
            marginTop: 12,
            background: '#fff',
            border: `1px solid ${T.neutral[100]}`,
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '10px 16px',
              fontSize: 11.5, fontWeight: 700, color: T.neutral[600],
              letterSpacing: 0.4, textTransform: 'uppercase',
              borderBottom: `1px solid ${T.neutral[100]}`,
            }}>
              Otros turnos activos · {nonCashSessions.length}
            </div>
            {nonCashSessions.map((s, i) => (
              <NonCashShiftRow
                key={s.id}
                session={s}
                isLast={i === nonCashSessions.length - 1}
                onAssist={() => setAssistingNonCash(s)}
                onClose={() => setClosingNonCashSession(s)}
                onDiscard={() => setDiscardingSession(s)}
              />
            ))}
          </Card>
        )}
      </div>

      {/* Modal: abrir turno (admin elige cajera + monto inicial) */}
      {openingBranch && (
        <OpenShiftModal
          branch={openingBranch}
          allUsers={allUsers}
          adminUid={authUser.uid}
          onCancel={() => setOpeningBranch(null)}
          onOpened={() => setOpeningBranch(null)}
        />
      )}

      {/* Modal: abrir turno de cocina o domiciliaria/mesera */}
      {openingNonCash && (
        <OpenNonCashShiftModal
          branches={branches}
          allUsers={allUsers}
          onCancel={() => setOpeningNonCash(false)}
          onOpened={() => setOpeningNonCash(false)}
        />
      )}

      {/* Modal: cerrar un turno de cocina o domiciliaria/mesera (sin cuadre) */}
      {closingNonCashSession && (
        <CloseNonCashShiftModal
          session={closingNonCashSession}
          adminUid={authUser.uid}
          onCancel={() => setClosingNonCashSession(null)}
          onClosed={() => setClosingNonCashSession(null)}
        />
      )}

      {/* Modal: cancelar un turno abierto por error (solo si está vacío) */}
      {discardingSession && (
        <DiscardSessionModal
          session={discardingSession}
          onCancel={() => setDiscardingSession(null)}
          onDiscarded={() => setDiscardingSession(null)}
        />
      )}

      {/* Modal: cerrar caja (admin cuenta + decide handover + resuelve cuadre) */}
      {closingSession && (
        <CloseSessionModal
          session={closingSession}
          adminUid={authUser.uid}
          adminName={adminName}
          allUsers={allUsers}
          onCancel={() => setClosingSession(null)}
          onClosed={(reopenWith) => {
            setClosingSession(null)
            // Si admin pidió "abrir nuevo turno ya", abrir el modal correspondiente
            if (reopenWith?.branch) setOpeningBranch(reopenWith.branch)
          }}
        />
      )}

      {/* Modo asistir: el admin ve la pantalla COMPLETA de la cajera
          (ActiveSession), idéntica a la que ella usa — nueva venta, mesas,
          gastos, tareas, mis ventas, descuentos y llamadas de cocina. La
          única salida es la barra "Salir de asistir" (no se sale al crear
          una mesa ni al recargar). Si veníamos de /comanda/{id}, el pedido
          web se pre-carga en NewSale vía initialLunchCommanda. */}
      {assistingSession && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 80, background: T.neutral[50],
          overflowY: 'auto', WebkitOverflowScrolling: 'touch',
          animation: 'slideUp 0.25s cubic-bezier(0.2,0.9,0.3,1.05)',
        }}>
          <ActiveSession
            session={assistingSession}
            authUser={authUser}
            userDoc={userDoc}
            assistMode={{
              adminUid: authUser.uid,
              adminName,
              customerOrderId: pendingCustomerOrder?.id || null,
            }}
            initialLunchCommanda={pendingCustomerOrder?.lunchCommanda || null}
            onConsumedCustomerOrder={() => setPendingCustomerOrder(null)}
            onExitAssist={exitAssist}
          />
        </div>
      )}

      {/* Modo asistir cocina/mesera: monta la pantalla real del turno
          (CookApp para cocina, WaitressApp para mesera) en modo asistir.
          La cola de cocina es global, así que el admin ve lo mismo que la
          cocinera. La mesera aún es placeholder (su app está en construcción).
          Salida única vía la barra de cada vista. */}
      {assistingNonCash && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 80, background: T.neutral[50],
          overflowY: 'auto', WebkitOverflowScrolling: 'touch',
          animation: 'slideUp 0.25s cubic-bezier(0.2,0.9,0.3,1.05)',
        }}>
          <ErrorBoundary label="la vista del turno">
            {assistingNonCash.type === 'kitchen' ? (
              <CookApp
                authUser={authUser}
                userDoc={userDoc}
                assistMode={{ onExit: () => setAssistingNonCash(null) }}
              />
            ) : (
              <WaitressApp
                authUser={authUser}
                userDoc={userDoc}
                session={assistingNonCash}
                assistMode={{ onExit: () => setAssistingNonCash(null) }}
              />
            )}
          </ErrorBoundary>
        </div>
      )}
    </>
  )
}

// ──────────────────────────────────────────────────────────────
// Una fila por panadería, con estado y acciones contextuales
// ──────────────────────────────────────────────────────────────
// Hook ligero: cuenta en vivo la actividad de una sesión (ventas, gastos,
// mesas) para decidir si se puede mostrar "Cancelar". Solo se suscribe cuando
// `enabled` — así no agrega listeners en panaderías sin turno.
function useSessionActivity(sessionId, enabled) {
  const [state, setState] = useState({ sales: 0, expenses: 0, tabs: 0, loaded: false })
  useEffect(() => {
    if (!sessionId || !enabled) { setState({ sales: 0, expenses: 0, tabs: 0, loaded: false }); return }
    const counts = { sales: 0, expenses: 0, tabs: 0 }
    const got = { s: false, e: false, t: false }
    const emit = () => setState({ ...counts, loaded: got.s && got.e && got.t })
    const u1 = watchSessionSales(sessionId, list => {
      counts.sales = (list || []).filter(x => (x.status || 'active') !== 'deleted').length
      got.s = true; emit()
    })
    const u2 = watchSessionExpenses(sessionId, list => {
      counts.expenses = (list || []).length; got.e = true; emit()
    })
    const u3 = watchOpenTabsForSession(sessionId, list => {
      counts.tabs = (list || []).length; got.t = true; emit()
    })
    return () => { u1 && u1(); u2 && u2(); u3 && u3() }
  }, [sessionId, enabled])
  return state
}

function BranchRow({ branch, session, isLast, onOpen, onClose, onAssist, onDiscard }) {
  const isLegacyPending = session?.status === 'pending_close'
  const colorKey = branch.colorKey || 'copper'
  const palette = T[colorKey] || T.copper

  // El botón "Cancelar" solo aparece si el turno está VACÍO: sin ventas, sin
  // gastos y sin mesas. Apenas haya una venta o gasto, desaparece.
  const activity = useSessionActivity(session?.id, !!session && !isLegacyPending)
  const canDiscard = !!session && !isLegacyPending && activity.loaded
    && activity.sales === 0 && activity.expenses === 0 && activity.tabs === 0

  return (
    <div style={{
      padding: '12px 16px',
      borderBottom: isLast ? 'none' : `0.5px solid ${T.neutral[100]}`,
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <div style={{
        width: 8, height: 8, borderRadius: 999, flexShrink: 0,
        background: session ? (isLegacyPending ? T.warn : T.ok) : T.neutral[300],
      }}/>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14, fontWeight: 700, color: T.neutral[900],
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {branch.name}
        </div>
        <div style={{
          fontSize: 11.5, color: session ? T.neutral[600] : T.neutral[400], marginTop: 2,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {session
            ? (isLegacyPending
                ? `Cierre pendiente · ${session.cashierName || 'Cajera'}`
                : `${session.cashierName || 'Cajera'} en turno`)
            : 'Sin turno · disponible'}
        </div>
      </div>

      {!session && (
        <button
          onClick={onOpen}
          style={{
            padding: '8px 12px', borderRadius: 10,
            background: palette[500] || T.copper[500], color: '#fff',
            border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 12, fontWeight: 700, flexShrink: 0,
            boxShadow: `0 2px 6px ${(palette[500] || T.copper[500])}55`,
          }}
        >
          Abrir turno
        </button>
      )}

      {session && (
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {canDiscard && (
            <button
              onClick={onDiscard}
              title="Cancelar turno (abierto por error)"
              style={{
                padding: '8px 10px', borderRadius: 10,
                background: '#fff', color: T.bad,
                border: `1px solid ${T.bad}55`,
                cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 12, fontWeight: 700,
              }}
            >
              Cancelar
            </button>
          )}
          {!isLegacyPending && (
            <button
              onClick={onAssist}
              title="Asistir (vender por la cajera)"
              style={{
                padding: '8px 10px', borderRadius: 10,
                background: '#fff', color: T.neutral[700],
                border: `1px solid ${T.neutral[200]}`,
                cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 12, fontWeight: 700,
              }}
            >
              Asistir
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              padding: '8px 12px', borderRadius: 10,
              background: T.neutral[900], color: '#fff',
              border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 12, fontWeight: 700,
              boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
            }}
          >
            Cerrar caja
          </button>
        </div>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// MODAL: Abrir turno (admin elige cajera + monto inicial)
// ──────────────────────────────────────────────────────────────
function OpenShiftModal({ branch, allUsers, adminUid, onCancel, onOpened }) {
  const cashFloor = getCashFloor(branch.id)
  const [cashierUid, setCashierUid] = useState('')
  const [amountStr, setAmountStr] = useState(String(cashFloor))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // Pre-llenado heredado del último cierre. Si en el cierre anterior se decidió
  // dejar dinero en la caja (handover='leave', 'cashier' o 'none'), pre-llenamos
  // el monto con `handover.amount` para que el admin no tenga que recordarlo.
  // Si fue 'admin' (se llevó la diferencia), la caja tiene solo la base —
  // el default `cashFloor` ya es correcto.
  const [inherited, setInherited] = useState(null) // { amount, fromName, type, closedAt }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const prev = await getLatestClosedSessionForBranch(branch.id)
        if (cancelled || !prev) return
        const handoverType = prev?.handover?.type
        const handoverAmount = Number(prev?.handover?.amount) || 0
        // Solo heredar si quedó dinero físico en la caja al cerrar.
        // 'admin' = se llevó lo de encima de la base → la caja tiene solo cashFloor.
        const cashStayed = handoverType === 'cashier' || handoverType === 'leave' || handoverType === 'none'
        if (!cashStayed || handoverAmount <= 0) return
        setInherited({
          amount: handoverAmount,
          fromName: prev?.cashierName || null,
          type: handoverType,
          closedAt: prev?.closedAt?.toMillis?.() ?? prev?.closedAtClient ?? null,
        })
        // Solo sobrescribir si el admin no ha tocado el campo (sigue en el default).
        setAmountStr(curr => curr === String(cashFloor) ? String(handoverAmount) : curr)
      } catch (e) {
        console.warn('[OpenShiftModal] no se pudo leer cierre anterior:', e)
      }
    })()
    return () => { cancelled = true }
  }, [branch.id, cashFloor])

  // Cualquier miembro del equipo aprobado puede recibir un turno de caja.
  // (Antes filtrábamos por role==='cashier', pero ahora el rol funcional se
  // asigna por turno, no es permanente.)
  const cashiers = useMemo(
    () => allUsers.filter(u => u.status === 'approved' && u.role !== 'admin'),
    [allUsers]
  )

  const selectedCashier = cashiers.find(c => c.uid === cashierUid)
  const amount = Number(amountStr) || 0
  const canConfirm = !busy && cashierUid && amount >= 0

  async function handleOpen() {
    if (!canConfirm) return
    setBusy(true); setError(null)
    try {
      const cashierName = `${selectedCashier.nombre || ''} ${selectedCashier.apellido || ''}`.trim() || selectedCashier.email
      // openingFloat = MONTO SOBRE LA BASE.
      // - Si admin abre con cashFloor exacto → openingFloat = 0 (la base es implícita, type='empty')
      // - Si admin abre con MÁS que la base (ej. cadena de turno con extras heredados) →
      //   openingFloat = monto total ingresado, type='handover' (la base ya está incluida).
      const isJustBase = amount === cashFloor
      const newSessionId = await openSession({
        branchId: branch.id,
        branchName: branch.name,
        cashierUid: selectedCashier.uid,
        cashierName,
        openingFloat: isJustBase ? 0 : amount,
        openingSource: isJustBase ? { type: 'empty' } : { type: 'handover' },
        openingAmount: amount,
        shiftType: 'cash',
      })

      // Heredar tabs huérfanas: si el cierre anterior dejó mesas pendientes
      // (admin eligió "pasar a la próxima cajera"), las re-atamos a la nueva
      // sesión + cajera. Sus kitchenOrders activos también se reatan.
      try {
        const orphans = await listOrphanTabsForBranch(branch.id)
        if (orphans.length > 0) {
          for (const tab of orphans) {
            await claimOrdersForTab(tab.id, {
              sessionId: newSessionId,
              cashierUid: selectedCashier.uid,
            })
            await claimOrphanTab(tab.id, {
              sessionId: newSessionId,
              cashierUid: selectedCashier.uid,
            })
          }
        }
      } catch (e) {
        // No bloqueamos la apertura por esto — el admin puede resolver luego.
        console.warn('[OpenShiftModal] no se pudieron heredar tabs huérfanas:', e?.message || e)
      }

      onOpened()
    } catch (err) {
      console.error(err)
      setError('No pudimos abrir el turno. Intenta de nuevo.')
      setBusy(false)
    }
  }

  return (
    <ModalShell onClose={busy ? undefined : onCancel}>
      <ModalTitle title="Abrir turno" subtitle={branch.name} />

      <Field label="Cajera">
        <select
          value={cashierUid}
          onChange={e => setCashierUid(e.target.value)}
          disabled={busy}
          style={selectStyle}
        >
          <option value="">Selecciona una cajera...</option>
          {cashiers.map(c => (
            <option key={c.uid} value={c.uid}>
              {c.nombre} {c.apellido}
            </option>
          ))}
        </select>
        {cashiers.length === 0 && (
          <div style={{ fontSize: 11.5, color: T.bad, marginTop: 6 }}>
            No hay cajeras aprobadas. Aprueba primero en Usuarios.
          </div>
        )}
      </Field>

      <Field label={`Monto inicial en caja (base de ${fmtCOP(cashFloor)})`}>
        {/* Banner heredado: indica de dónde viene el monto pre-llenado para
            que el admin sepa qué confirmar y pueda ajustar si físicamente
            la caja tiene otra cosa (ej. el dueño ya retiró/agregó algo). */}
        {inherited && (
          <div style={{
            marginBottom: 8, padding: '10px 12px', borderRadius: 10,
            background: '#FFF7E6', border: `1px solid #F4E0BC`,
            display: 'flex', alignItems: 'flex-start', gap: 8,
          }}>
            <div style={{ fontSize: 16, lineHeight: 1, flexShrink: 0 }}>💵</div>
            <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: '#7A5C00', lineHeight: 1.5 }}>
              <div style={{ fontWeight: 700 }}>
                Heredado del cierre anterior
                {inherited.fromName ? ` de ${inherited.fromName}` : ''} ·{' '}
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtCOP(inherited.amount)}</span>
              </div>
              <div style={{ color: '#9A7200', marginTop: 2 }}>
                {inherited.type === 'cashier' && 'La caja anterior se transfirió a una cajera.'}
                {inherited.type === 'leave' && 'Se dejó todo el dinero en la caja.'}
                {inherited.type === 'none' && 'Se dejó la caja intacta tras el cierre.'}
                {' '}Confirma que físicamente hay este monto o ajústalo.
              </div>
            </div>
          </div>
        )}
        <NumInput value={amountStr} onChange={setAmountStr} disabled={busy} />
        <div style={{ fontSize: 11.5, color: T.neutral[500], marginTop: 6, lineHeight: 1.5 }}>
          {amount === cashFloor && '✓ Arranca solo con la base'}
          {amount > cashFloor && `Arranca con ${fmtCOP(amount - cashFloor)} sobre la base`}
          {amount < cashFloor && `⚠ Arranca con ${fmtCOP(cashFloor - amount)} menos que la base`}
        </div>
      </Field>

      {error && <ErrorBox text={error} />}

      <ModalFooter>
        <ModalBtnSecondary onClick={onCancel} disabled={busy}>Cancelar</ModalBtnSecondary>
        <ModalBtnPrimary
          onClick={handleOpen}
          disabled={!canConfirm}
          color={T.copper[500]}
        >
          {busy ? 'Abriendo...' : 'Abrir turno'}
        </ModalBtnPrimary>
      </ModalFooter>
    </ModalShell>
  )
}

// ──────────────────────────────────────────────────────────────
// MODAL: Cerrar caja (admin cuenta + decide handover + resuelve cuadre)
// ──────────────────────────────────────────────────────────────
function CloseSessionModal({ session, adminUid, adminName, allUsers, onCancel, onClosed }) {
  // Datos en vivo del turno
  const [sales, setSales] = useState([])
  const [expenses, setExpenses] = useState([])
  // openTabs activas de la cajera — si quedan pendientes al cerrar, el admin
  // debe decidir qué hacer con ellas (transferir a próxima cajera o eliminar).
  const [pendingTabs, setPendingTabs] = useState([])
  // Decisión del admin sobre las tabs pendientes: 'transfer' | 'delete' | null.
  // Solo es requerida si pendingTabs.length > 0.
  const [tabsDecision, setTabsDecision] = useState(null)

  useEffect(() => watchSessionSales(session.id, setSales), [session.id])
  useEffect(() => watchSessionExpenses(session.id, setExpenses), [session.id])
  useEffect(() => watchOpenTabsForSession(session.id, setPendingTabs), [session.id])

  // Decisiones tentativas del admin sobre gastos pendientes
  const [expenseDecisions, setExpenseDecisions] = useState({})

  // Si la sesión es legacy pending_close (cajera ya declaró), pre-llenar con su declaración
  const cashierLegacyDeclared = session.declaredClosingCash
  const [declaredStr, setDeclaredStr] = useState(
    cashierLegacyDeclared != null ? String(cashierLegacyDeclared) : ''
  )

  const [handoverChoice, setHandoverChoice] = useState('admin') // 'admin' | 'leave'
  const [reopenAfter, setReopenAfter] = useState(false) // checkbox para abrir nuevo turno después
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // Sub-modal con detalle de ventas. Si methodFilter está seteado, solo muestra
  // ventas de ese método (efectivo / nequi / daviplata / deuda). null = todas.
  const [salesView, setSalesView] = useState(null) // null | { methodFilter: string|null }

  // Cálculos en vivo
  const activeSales = useMemo(
    () => sales.filter(s => (s.status || 'active') !== 'deleted'),
    [sales]
  )

  // Hora de la última venta sincronizada al servidor. Usamos createdAt si ya
  // resolvió (server timestamp) o createdAtClient como fallback. Sirve para
  // que el admin vea de un golpe si la cajera tuvo poca actividad reciente
  // — y por tanto pueda haber ventas offline que aún no se han subido.
  const lastSaleAt = useMemo(() => {
    let max = 0
    for (const s of activeSales) {
      const t = s.createdAt?.toMillis?.() ?? s.createdAtClient ?? 0
      if (t > max) max = t
    }
    return max || null
  }, [activeSales])
  const salesByMethod = useMemo(() => {
    const acc = { efectivo: 0, nequi: 0, daviplata: 0, deuda: 0 }
    activeSales.forEach(s => addSaleToBreakdown(acc, s))
    return acc
  }, [activeSales])
  const totalSales = activeSales.reduce((acc, s) => acc + (Number(s.total) || 0), 0)

  function effectiveStatus(exp) {
    if (exp.status === 'approved' || exp.status === 'rejected') return exp.status
    const dec = expenseDecisions[exp.id]
    if (dec === 'approve') return 'approved'
    if (dec === 'reject') return 'rejected'
    return 'pending'
  }
  const approvedExpenseTotal = expenses.reduce((acc, e) =>
    effectiveStatus(e) === 'approved' ? acc + (Number(e.amount) || 0) : acc, 0
  )
  const pendingExpensesCount = expenses.filter(e => effectiveStatus(e) === 'pending').length

  const cashFloor = getCashFloor(session.branchId)
  const openingFloat = Number(session.openingFloat) || 0
  const baseAtOpen = session.openingSource?.type === 'empty' ? cashFloor : 0
  const declared = Number(declaredStr) || 0
  const expectedCash = baseAtOpen + openingFloat + (salesByMethod.efectivo || 0) - approvedExpenseTotal
  const difference = declared - expectedCash
  const hasShortage = difference < 0
  const hasSurplus = difference > 0
  const isExact = difference === 0
  const baseLowered = declared < cashFloor
  const baseShortfall = baseLowered ? cashFloor - declared : 0
  const overBase = declared - cashFloor
  // La base es FIJA — siempre $200.000 (CASH_FLOOR_DEFAULT). Si la caja
  // quedó por debajo, el admin SIEMPRE repone físicamente: no hay opción
  // de "bajar la base". Esto evita que la base se anclara en valores bajos
  // por decisiones de un día específico.

  function setDecision(expenseId, decision) {
    setExpenseDecisions(prev => ({ ...prev, [expenseId]: decision }))
  }

  // Validación
  const canConfirm =
    !busy &&
    declaredStr.trim() !== '' &&
    pendingExpensesCount === 0 &&
    (pendingTabs.length === 0 || !!tabsDecision)

  async function handleConfirm() {
    if (!canConfirm) return
    setBusy(true); setError(null)
    try {
      // 1. Aplicar decisiones de gastos pendientes
      for (const exp of expenses) {
        if (exp.status !== 'pending') continue
        const dec = expenseDecisions[exp.id]
        if (dec === 'approve') {
          const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
          const movementId = addMovement({
            type: 'expense',
            amount: exp.amount,
            date: today,
            note: exp.description,
            cat: 'otros_prov',
            branch: exp.branchId || 'both',
            origin: 'caja',
            sessionId: exp.sessionId || null,
            cashierName: exp.cashierName,
          })
          await approveCashExpense(exp.id, { reviewedBy: adminUid, movementId })
        } else if (dec === 'reject') {
          await rejectCashExpense(exp.id, { reviewedBy: adminUid, reviewNote: null })
        }
      }

      // 3. Construir handover
      let handover = null
      if (handoverChoice === 'admin') {
        handover = {
          type: 'admin',
          toName: 'Administrador',
          amount: declared,
        }
      } else {
        // 'leave' → la plata queda en caja. No se asigna a nadie todavía;
        // el admin elige al abrir el siguiente turno.
        handover = { type: 'none', amount: declared }
      }

      // 3.5. Aplicar decisión sobre tabs pendientes ANTES de cerrar la sesión.
      // - 'transfer' → liberar (sessionId/cashierUid = null) tabs + sus
      //   kitchenOrders activos. La próxima cajera que abra turno en esta
      //   panadería las hereda automáticamente.
      // - 'delete'   → borrar las tabs + cancelar sus kitchenOrders
      //   pending/ready (no se cobran, ojo).
      if (pendingTabs.length > 0 && tabsDecision === 'transfer') {
        for (const tab of pendingTabs) {
          try {
            await releaseOrdersForTab(tab.id)
            await releaseTabForNextCashier(tab.id, session.id)
          } catch (err) {
            console.warn('[CloseSessionModal] no se pudo liberar tab:', tab.id, err?.message || err)
          }
        }
      } else if (pendingTabs.length > 0 && tabsDecision === 'delete') {
        for (const tab of pendingTabs) {
          try {
            await cancelOrdersForTab(tab.id, {
              reason: 'Mesa eliminada al cerrar turno',
              cancelledBy: adminUid,
              cancelledByName: adminName,
            })
            await deleteOpenTab(tab.id)
          } catch (err) {
            console.warn('[CloseSessionModal] no se pudo eliminar tab:', tab.id, err?.message || err)
          }
        }
      }

      // 4. Cerrar la sesión (una sola operación que hace todo)
      await adminCloseSession(session.id, {
        reviewedBy: adminUid,
        declaredClosingCash: declared,
        expectedCash,
        approveNote: note.trim() || null,
        handover,
        session,
        // La base SIEMPRE se restaura al default si quedó por debajo.
        // No hay opción de bajar la base — el admin repone físicamente.
        nextCashFloor: baseLowered ? CASH_FLOOR_DEFAULT : null,
      })

      // 5. Si admin marcó "abrir nuevo turno ya", devolver el branch al padre
      onClosed(reopenAfter ? { branch: { id: session.branchId, name: session.branchName, colorKey: getData().branches?.find(b => b.id === session.branchId)?.colorKey } } : null)
    } catch (err) {
      console.error(err)
      setError('No pudimos cerrar la caja. Intenta de nuevo.')
      setBusy(false)
    }
  }

  return (
    <ModalShell onClose={busy ? undefined : onCancel} wide>
      <ModalTitle
        title="Cerrar caja"
        subtitle={`${session.cashierName || 'Cajera'} · ${session.branchName || 'Sin nombre'}`}
      />

      {/* Aviso pre-cierre: hora de la última venta vista. Si fue hace mucho
          rato, puede ser que la cajera tenga ventas offline aún por subir. */}
      <LastSaleNotice lastSaleAt={lastSaleAt} salesCount={activeSales.length} />

      {/* Resumen del turno */}
      <SectionLabel>Resumen del turno</SectionLabel>
      <div style={blockStyle}>
        {baseAtOpen > 0 && <Row label="Base de caja" value={fmtCOP(baseAtOpen)} muted />}
        {openingFloat > 0 && <Row label="Apertura (recibido)" value={fmtCOP(openingFloat)} muted />}
        <Row label={`Ventas (${activeSales.length})`} value={fmtCOP(totalSales)} muted />
        <div style={{ borderTop: `1px solid ${T.neutral[200]}`, marginTop: 6, paddingTop: 6 }}>
          <ClickableMethodRow
            label="Efectivo a caja"
            method="efectivo"
            sales={activeSales}
            amount={salesByMethod.efectivo || 0}
            onOpen={(m) => setSalesView({ methodFilter: m })}
            bold
          />
          <ClickableMethodRow
            label="Nequi"
            method="nequi"
            sales={activeSales}
            amount={salesByMethod.nequi || 0}
            onOpen={(m) => setSalesView({ methodFilter: m })}
          />
          <ClickableMethodRow
            label="Daviplata"
            method="daviplata"
            sales={activeSales}
            amount={salesByMethod.daviplata || 0}
            onOpen={(m) => setSalesView({ methodFilter: m })}
          />
          {salesByMethod.deuda > 0 && (
            <ClickableMethodRow
              label="Deuda (a cobrar después)"
              method="deuda"
              sales={activeSales}
              amount={salesByMethod.deuda}
              onOpen={(m) => setSalesView({ methodFilter: m })}
            />
          )}
        </div>
        {activeSales.length > 0 && (
          <button
            onClick={() => setSalesView({ methodFilter: null })}
            style={{
              width: '100%', marginTop: 10, padding: '10px 12px', borderRadius: 10,
              background: '#fff', color: T.copper[700],
              border: `1px solid ${T.copper[200]}`,
              cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 12.5, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 4 H12 M2 7 H12 M2 10 H8" stroke={T.copper[600]} strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
            Ver todas las ventas ({activeSales.length})
          </button>
        )}
      </div>

      {/* Sub-modal: lista detallada de ventas (todas o filtradas por método) */}
      {salesView && (
        <SalesListModal
          sales={activeSales}
          totalSales={totalSales}
          methodFilter={salesView.methodFilter}
          onClose={() => setSalesView(null)}
        />
      )}

      {/* Gastos del turno */}
      <SectionLabel>
        Gastos del turno · {expenses.length}
        {pendingExpensesCount > 0 && (
          <span style={{ color: T.warn, marginLeft: 6 }}>
            ({pendingExpensesCount} sin decidir)
          </span>
        )}
      </SectionLabel>
      {expenses.length === 0 ? (
        <div style={emptyBlockStyle}>Sin gastos en este turno</div>
      ) : (
        <div style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {expenses.map(e => (
            <ExpenseRow
              key={e.id}
              expense={e}
              effectiveStatus={effectiveStatus(e)}
              onApprove={() => setDecision(e.id, 'approve')}
              onReject={() => setDecision(e.id, 'reject')}
              disabled={busy}
            />
          ))}
        </div>
      )}

      {/* Conteo físico (lo cuenta el ADMIN) */}
      <SectionLabel>Cuenta física en caja</SectionLabel>
      <div style={{
        padding: '14px 16px', borderRadius: 12,
        background: T.copper[50], border: `1.5px solid ${T.copper[100]}`,
        marginBottom: 14,
      }}>
        <div style={{ fontSize: 12.5, color: T.neutral[700], marginBottom: 8, lineHeight: 1.5 }}>
          {cashierLegacyDeclared != null
            ? `La cajera declaró ${fmtCOP(cashierLegacyDeclared)}. Confirma o ajusta lo que cuentes físicamente.`
            : 'Cuenta TODO el efectivo físico que hay en la caja (incluyendo la base) y digítalo:'}
        </div>
        <NumInput
          value={declaredStr}
          onChange={setDeclaredStr}
          disabled={busy}
          large
          autoFocus
        />
      </div>

      {/* Cuadre — solo si admin ya digitó algo */}
      {declaredStr.trim() !== '' && (
        <>
          <SectionLabel>Cuadre</SectionLabel>
          <div style={blockStyle}>
            <Row label="Esperado" value={fmtCOP(expectedCash)} bold />
            <Row label="Contado" value={fmtCOP(declared)} bold />
            <div style={{ borderTop: `1px solid ${T.neutral[200]}`, marginTop: 6, paddingTop: 6 }}>
              {isExact && <Row label="✓ CUADRE EXACTO" value={fmtCOP(0)} highlight tone="ok" />}
              {hasSurplus && <Row label="SOBRA" value={fmtCOP(Math.abs(difference))} highlight tone="ok" />}
              {hasShortage && <Row label="FALTA" value={fmtCOP(Math.abs(difference))} highlight tone="bad" />}
            </div>
          </div>

          {/* Acción física para el admin */}
          <AdminActionCard declared={declared} cashFloor={cashFloor} handoverChoice={handoverChoice} />

          {/* Cuando baseLowered, el AdminActionCard de arriba ya muestra
              "Repón $X.XXX para devolver la caja a $200.000". No hay
              decisión adicional: la base es fija. */}

          {/* Mesas/burbujas pendientes — si la cajera deja mesas sin cobrar
              al cerrar, el admin debe decidir si pasárselas a la próxima
              cajera que abra turno en esta panadería, o eliminarlas. */}
          {pendingTabs.length > 0 && (
            <PendingTabsPanel
              tabs={pendingTabs}
              decision={tabsDecision}
              onDecision={setTabsDecision}
            />
          )}

          {/* Si hay FALTA: solo se registra. La app no decide descuentos —
              el admin ve la falta y decide por fuera si se la cobra a la cajera. */}
          {hasShortage && (
            <div style={{
              padding: '12px 14px', borderRadius: 12,
              background: '#FBE9E5', border: `1px solid #F0C8BE`,
              fontSize: 12.5, color: T.bad, fontWeight: 600, lineHeight: 1.5,
              marginBottom: 14,
            }}>
              Falta de {fmtCOP(Math.abs(difference))}. Queda registrada en el turno.
              Tú decides por fuera si se la descuentas a {session.cashierName || 'la cajera'}.
            </div>
          )}

          {/* Si hay SOBRA */}
          {hasSurplus && (
            <div style={{
              padding: '12px 14px', borderRadius: 12,
              background: '#E8F4E8', border: `1px solid #C2DDC1`,
              fontSize: 12.5, color: T.ok, fontWeight: 600, lineHeight: 1.5,
              marginBottom: 14,
            }}>
              Al cerrar, se registrará {fmtCOP(Math.abs(difference))} como ingreso "Sobra de cierre".
            </div>
          )}

          {/* Handover: qué hacer físicamente con la plata */}
          <SectionLabel>¿Qué hacer con la caja?</SectionLabel>
          <RadioOption
            selected={handoverChoice === 'admin'}
            onClick={() => setHandoverChoice('admin')}
            title="Yo me llevo lo de encima de la base"
            subtitle={`Te llevas ${fmtCOP(Math.max(0, overBase))}. La caja queda con $${cashFloor.toLocaleString('es-CO')}.`}
          />
          <RadioOption
            selected={handoverChoice === 'leave'}
            onClick={() => setHandoverChoice('leave')}
            title="Dejar todo en la caja"
            subtitle={`Quedan ${fmtCOP(declared)} para el próximo turno. Al abrirlo eliges a quién se lo asignas.`}
          />

          {/* Reabrir turno después */}
          <label style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 12px', borderRadius: 10,
            background: T.neutral[50], border: `1px solid ${T.neutral[100]}`,
            fontSize: 13, color: T.neutral[700],
            cursor: 'pointer', marginTop: 4, marginBottom: 12,
          }}>
            <input
              type="checkbox"
              checked={reopenAfter}
              onChange={e => setReopenAfter(e.target.checked)}
              disabled={busy}
            />
            Después de cerrar, abrir nuevo turno aquí
          </label>
        </>
      )}

      {/* Nota interna */}
      {declaredStr.trim() !== '' && (
        <NoteInput value={note} onChange={setNote} placeholder="Nota interna del cierre (opcional)" disabled={busy} />
      )}

      {pendingExpensesCount > 0 && (
        <div style={{
          margin: '0 0 10px', padding: '10px 12px', borderRadius: 10,
          background: '#FFF7E6', border: `1px solid #F4E0BC`, color: T.warn,
          fontSize: 12.5, fontWeight: 600, textAlign: 'center',
        }}>
          Decide aprobar o rechazar todos los gastos antes de cerrar.
        </div>
      )}

      {error && <ErrorBox text={error} />}

      <ModalFooter>
        <ModalBtnSecondary onClick={onCancel} disabled={busy}>Cancelar</ModalBtnSecondary>
        <ModalBtnPrimary
          onClick={handleConfirm}
          disabled={!canConfirm}
          color={T.ok}
        >
          {busy ? 'Cerrando...' : 'Cerrar caja'}
        </ModalBtnPrimary>
      </ModalFooter>
    </ModalShell>
  )
}

// ──────────────────────────────────────────────────────────────
// Acción al cerrar (mensaje claro al admin sobre qué hacer físicamente)
// ──────────────────────────────────────────────────────────────
function AdminActionCard({ declared, cashFloor, handoverChoice }) {
  const baseLowered = declared < cashFloor
  const overBase = declared - cashFloor

  if (baseLowered) {
    return (
      <div style={{
        padding: '14px 16px', borderRadius: 14,
        background: '#FBE9E5', border: `1.5px solid ${T.bad}55`,
        marginBottom: 14,
      }}>
        <div style={{
          fontSize: 11, fontWeight: 700, color: T.bad,
          textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6,
        }}>
          Acción física
        </div>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: T.neutral[900], lineHeight: 1.4, marginBottom: 6 }}>
          La caja tiene <span style={{ color: T.bad, fontVariantNumeric: 'tabular-nums' }}>{fmtCOP(declared)}</span>.
        </div>
        <div style={{ fontSize: 13, color: T.neutral[700], lineHeight: 1.5 }}>
          Repón <b style={{ color: T.bad, fontVariantNumeric: 'tabular-nums' }}>{fmtCOP(cashFloor - declared)}</b> para devolver la caja a {fmtCOP(cashFloor)}.
        </div>
      </div>
    )
  }

  if (handoverChoice === 'leave') {
    return (
      <div style={{
        padding: '14px 16px', borderRadius: 14,
        background: T.copper[50], border: `1.5px solid ${T.copper[100]}`,
        marginBottom: 14,
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.copper[700], textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
          Acción física
        </div>
        <div style={{ fontSize: 14, color: T.neutral[800], lineHeight: 1.5 }}>
          Deja los <b style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtCOP(declared)}</b> en la caja para el próximo turno.
        </div>
      </div>
    )
  }

  return (
    <div style={{
      padding: '14px 16px', borderRadius: 14,
      background: '#E8F4E8', border: `1.5px solid ${T.ok}55`,
      marginBottom: 14,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.ok, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
        Acción física
      </div>
      <div style={{ fontSize: 14.5, fontWeight: 700, color: T.neutral[900], lineHeight: 1.4 }}>
        Llévate <span style={{ color: T.ok, fontVariantNumeric: 'tabular-nums' }}>{fmtCOP(Math.max(0, overBase))}</span>.
      </div>
      <div style={{ fontSize: 13, color: T.neutral[600], lineHeight: 1.5, marginTop: 4 }}>
        Deja los <b>{fmtCOP(cashFloor)}</b> de base intactos.
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Panel "Mesas pendientes" en el cierre. Aparece si la cajera deja
// burbujas sin cobrar al cerrar. El admin DEBE escoger una opción:
//   - Pasar a la próxima cajera: tabs se quedan huérfanas con sus
//     kitchenOrders. La siguiente cajera que abra turno en esta
//     panadería las hereda automáticamente.
//   - Eliminar: tabs + kitchenOrders activos se borran/cancelan.
// ──────────────────────────────────────────────────────────────
function PendingTabsPanel({ tabs, decision, onDecision }) {
  const totalAmount = tabs.reduce((s, t) => s + (Number(t.total) || 0), 0)
  return (
    <div style={{
      padding: '12px 14px', borderRadius: 12, marginBottom: 14,
      background: '#FFF7E6', border: `1.5px solid #F4E0BC`,
    }}>
      <div style={{ fontSize: 13.5, fontWeight: 900, color: '#7A5C00', letterSpacing: -0.2, marginBottom: 4 }}>
        ⚠ {tabs.length} {tabs.length === 1 ? 'mesa pendiente' : 'mesas pendientes'}
      </div>
      <div style={{ fontSize: 12, color: '#7A5C00', lineHeight: 1.5, marginBottom: 10 }}>
        La cajera deja {tabs.length === 1 ? 'una mesa abierta' : 'mesas abiertas'} sin cobrar
        {totalAmount > 0 && <> (total {fmtCOP(totalAmount)})</>}. Decide qué hacer:
      </div>

      <div style={{
        background: '#fff', borderRadius: 10, padding: '8px 12px',
        border: `1px solid #F4E0BC`, marginBottom: 10,
        maxHeight: 140, overflowY: 'auto',
      }}>
        {tabs.map((t, i) => (
          <div key={t.id} style={{
            fontSize: 12, color: T.neutral[700], lineHeight: 1.5,
            padding: '4px 0',
            borderBottom: i < tabs.length - 1 ? `0.5px dashed ${T.neutral[200]}` : 'none',
            display: 'flex', justifyContent: 'space-between', gap: 8,
          }}>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {(t.kind || 'mesa') === 'llevar'
                ? `📦 ${t.customerName || 'Cliente'}`
                : `🍽️ Mesa ${formatTableLabel(t)}`}
              {(t.items?.length || 0) > 0 && <> · {t.items.length} {t.items.length === 1 ? 'item' : 'items'}</>}
            </span>
            <span style={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0, fontWeight: 700 }}>
              {fmtCOP(Number(t.total) || 0)}
            </span>
          </div>
        ))}
      </div>

      <RadioOption
        selected={decision === 'transfer'}
        onClick={() => onDecision('transfer')}
        title="Pasar a la próxima cajera"
        subtitle="Quedan guardadas. La cajera que abra el próximo turno aquí las hereda."
      />
      <RadioOption
        selected={decision === 'delete'}
        onClick={() => onDecision('delete')}
        title="Eliminar todas"
        subtitle="Se borran las mesas y se cancelan los almuerzos en cocina. No se cobra."
      />
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Componentes UI auxiliares (locales al panel)
// ──────────────────────────────────────────────────────────────
function ModalShell({ onClose, wide, children }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '16px',
      animation: 'fadeIn 0.15s ease',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: wide ? 520 : 440,
        maxHeight: '90vh', overflowY: 'auto',
        background: '#fff', borderRadius: 20,
        boxShadow: '0 16px 48px rgba(0,0,0,0.22)',
        padding: '20px 22px 24px',
        animation: 'fadeScaleIn 0.18s cubic-bezier(0.2, 0.9, 0.3, 1.05)',
      }}>
        {children}
      </div>
      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes fadeScaleIn {
          from { opacity: 0; transform: scale(0.96) translateY(8px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  )
}

function ModalTitle({ title, subtitle }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 19, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3 }}>
        {title}
      </div>
      {subtitle && (
        <div style={{ fontSize: 13, color: T.neutral[500], marginTop: 3 }}>
          {subtitle}
        </div>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// MODAL: Cancelar (descartar) un turno abierto por error
// ──────────────────────────────────────────────────────────────
function DiscardSessionModal({ session, onCancel, onDiscarded }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const typeLabel = session?.type === 'kitchen'
    ? 'de cocina'
    : session?.type === 'waitress' ? 'de mesera' : 'de caja'

  async function handleConfirm() {
    setBusy(true)
    setError(null)
    try {
      await discardEmptySession(session.id)
      onDiscarded()
    } catch (err) {
      setError(err?.message || 'No se pudo cancelar el turno.')
      setBusy(false)
    }
  }

  return (
    <ModalShell onClose={busy ? undefined : onCancel}>
      <ModalTitle
        title="Cancelar turno"
        subtitle={`${session.cashierName || 'Sin nombre'} · ${session.branchName || 'Sin panadería'}`}
      />
      <div style={{ fontSize: 13.5, color: T.neutral[700], lineHeight: 1.55, marginBottom: 16 }}>
        Esto <b>borra el turno {typeLabel}</b> sin dejar registro. Úsalo solo si
        lo abriste por error. Solo funciona si el turno no tiene ventas, gastos
        ni mesas — si tiene algo, no se borra y te avisa.
      </div>

      {error && (
        <div style={{
          marginBottom: 14, padding: '10px 12px', borderRadius: 12,
          background: '#FBE9E5', border: `1px solid #F0C8BE`,
          fontSize: 12.5, color: T.bad, lineHeight: 1.45, fontWeight: 600,
        }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        <button
          onClick={onCancel}
          disabled={busy}
          style={{
            flex: 1, padding: '13px', borderRadius: 12,
            background: '#fff', color: T.neutral[700],
            border: `1px solid ${T.neutral[200]}`,
            cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
            fontSize: 14, fontWeight: 700,
          }}
        >
          No, volver
        </button>
        <button
          onClick={handleConfirm}
          disabled={busy}
          style={{
            flex: 1.3, padding: '13px', borderRadius: 12,
            background: T.bad, color: '#fff',
            border: 'none', cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
            fontSize: 14, fontWeight: 800,
            boxShadow: `0 3px 10px ${T.bad}44`,
          }}
        >
          {busy ? 'Cancelando...' : 'Sí, cancelar turno'}
        </button>
      </div>
    </ModalShell>
  )
}

function ModalFooter({ children }) {
  return (
    <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
      {children}
    </div>
  )
}

function ModalBtnPrimary({ onClick, disabled, color, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1.4, padding: '13px', borderRadius: 12,
        background: disabled ? T.neutral[200] : color,
        color: disabled ? T.neutral[400] : '#fff',
        border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit', fontSize: 14.5, fontWeight: 700,
      }}
    >
      {children}
    </button>
  )
}

function ModalBtnSecondary({ onClick, disabled, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1, padding: '13px', borderRadius: 12,
        background: T.neutral[100], color: T.neutral[700],
        border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
      }}
    >
      {children}
    </button>
  )
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 12, fontWeight: 700, color: T.neutral[600], display: 'block', marginBottom: 6 }}>
        {label}
      </label>
      {children}
    </div>
  )
}

function NumInput({ value, onChange, disabled, large, autoFocus }) {
  const [focused, setFocused] = useState(false)
  function sanitize(raw) {
    return raw.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '')
  }
  return (
    <div style={{
      border: `1.5px solid ${focused ? T.copper[400] : T.neutral[200]}`,
      borderRadius: 12, background: '#fff',
      padding: large ? '12px 14px' : '10px 12px',
      display: 'flex', alignItems: 'center', gap: 6,
    }}>
      <span style={{ fontSize: large ? 22 : 16, fontWeight: 700, color: T.neutral[400] }}>$</span>
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={e => onChange(sanitize(e.target.value))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder="0"
        style={{
          flex: 1, border: 'none', outline: 'none', background: 'transparent',
          fontFamily: 'inherit', fontSize: large ? 22 : 16, fontWeight: 700,
          color: T.neutral[900], fontVariantNumeric: 'tabular-nums',
        }}
      />
    </div>
  )
}

function NoteInput({ value, onChange, placeholder, disabled }) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      rows={2}
      style={{
        width: '100%', boxSizing: 'border-box',
        padding: '10px 12px', borderRadius: 10,
        border: `1.5px solid ${T.neutral[200]}`, background: '#fff',
        fontFamily: 'inherit', fontSize: 13, color: T.neutral[800],
        outline: 'none', resize: 'vertical', minHeight: 50,
        marginBottom: 12,
      }}
    />
  )
}

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, color: T.neutral[500],
      textTransform: 'uppercase', letterSpacing: 0.5,
      marginBottom: 8, marginTop: 4,
    }}>
      {children}
    </div>
  )
}

function Row({ label, value, muted, bold, highlight, tone }) {
  const valueColor = highlight
    ? tone === 'bad' ? T.bad : tone === 'ok' ? T.ok : T.neutral[900]
    : muted ? T.neutral[600] : T.neutral[900]
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '4px 0',
      fontSize: highlight ? 14 : 13,
      fontWeight: highlight || bold ? 700 : 500,
    }}>
      <span style={{ color: muted ? T.neutral[600] : T.neutral[800] }}>{label}</span>
      <span style={{ color: valueColor, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  )
}

function RadioOption({ selected, onClick, title, subtitle, disabled }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        width: '100%', padding: '12px 14px', borderRadius: 12,
        background: selected ? T.copper[50] : '#fff',
        border: `1.5px solid ${selected ? T.copper[400] : T.neutral[200]}`,
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit', textAlign: 'left',
        display: 'flex', alignItems: 'center', gap: 10,
        marginBottom: 6,
      }}
    >
      <div style={{
        width: 18, height: 18, borderRadius: 999, flexShrink: 0,
        border: `2px solid ${selected ? T.copper[500] : T.neutral[300]}`,
        background: selected ? T.copper[500] : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {selected && <div style={{ width: 6, height: 6, borderRadius: 999, background: '#fff' }}/>}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: T.neutral[900] }}>{title}</div>
        {subtitle && <div style={{ fontSize: 11.5, color: T.neutral[500], marginTop: 1, lineHeight: 1.4 }}>{subtitle}</div>}
      </div>
    </button>
  )
}

function ExpenseRow({ expense, effectiveStatus, onApprove, onReject, disabled }) {
  const isApproved = effectiveStatus === 'approved'
  const isRejected = effectiveStatus === 'rejected'
  const isPending = effectiveStatus === 'pending'
  const wasFinal = expense.status === 'approved' || expense.status === 'rejected'

  return (
    <div style={{
      padding: '10px 12px', borderRadius: 10,
      background: isApproved ? '#E8F4E8' : isRejected ? '#FBE9E5' : T.neutral[50],
      border: `1px solid ${isApproved ? '#C2DDC1' : isRejected ? '#F0C8BE' : T.neutral[100]}`,
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 700, color: T.neutral[900],
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {expense.description}
        </div>
        <div style={{ fontSize: 11.5, color: T.neutral[500], marginTop: 2 }}>
          {fmtCOP(expense.amount)}
          {expense.photoUrl && (
            <a href={expense.photoUrl} target="_blank" rel="noreferrer" style={{
              marginLeft: 8, color: T.copper[600], fontWeight: 600,
              textDecoration: 'underline', fontSize: 11,
            }}>
              📎 ver foto
            </a>
          )}
        </div>
      </div>
      {isPending && (
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button onClick={onReject} disabled={disabled} style={{
            padding: '5px 10px', borderRadius: 8,
            background: 'transparent', color: T.bad,
            border: `1px solid ${T.bad}55`,
            cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
            fontSize: 11.5, fontWeight: 700,
          }}>
            Rechazar
          </button>
          <button onClick={onApprove} disabled={disabled} style={{
            padding: '5px 10px', borderRadius: 8,
            background: T.ok, color: '#fff',
            border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
            fontSize: 11.5, fontWeight: 700,
          }}>
            Aprobar
          </button>
        </div>
      )}
      {isApproved && !wasFinal && (
        <span style={{
          padding: '3px 8px', borderRadius: 999,
          background: T.ok, color: '#fff',
          fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase',
          flexShrink: 0,
        }}>
          ✓ Aprobado
        </span>
      )}
      {isRejected && !wasFinal && (
        <span style={{
          padding: '3px 8px', borderRadius: 999,
          background: T.bad, color: '#fff',
          fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase',
          flexShrink: 0,
        }}>
          ✗ Rechazado
        </span>
      )}
      {wasFinal && (
        <span style={{
          padding: '3px 8px', borderRadius: 999,
          background: T.neutral[100], color: T.neutral[600],
          fontSize: 10.5, fontWeight: 600, letterSpacing: 0.3, textTransform: 'uppercase',
          flexShrink: 0,
        }}>
          {isApproved ? 'Antes' : 'Antes'}
        </span>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Fila de método clickeable. Si hay ventas en ese método, abre el sub-modal
// filtrado para mostrar quién pagó/debe.
// ──────────────────────────────────────────────────────────────
function ClickableMethodRow({ label, method, sales, amount, onOpen, bold }) {
  // Una venta cuenta en este método si:
  //  - su paymentMethod es exactamente el método, O
  //  - tiene paymentSplit con porción > 0 en este método
  const matching = sales.filter(s => {
    if (s.paymentSplit && Number(s.paymentSplit[method]) > 0) return true
    return (s.paymentMethod || 'efectivo') === method
  })
  const count = matching.length
  const hasContent = count > 0
  const muted = !bold

  // Por defecto el botón se ve como una Row normal; si tiene ventas, se hace
  // clickeable con caret a la derecha.
  return (
    <button
      type="button"
      onClick={hasContent ? () => onOpen(method) : undefined}
      disabled={!hasContent}
      style={{
        width: '100%',
        background: 'transparent', border: 'none', padding: '4px 0',
        fontFamily: 'inherit', textAlign: 'left',
        cursor: hasContent ? 'pointer' : 'default',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: 13,
        fontWeight: bold ? 700 : 500,
        color: muted ? T.neutral[600] : T.neutral[900],
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {label}
        {hasContent && (
          <span style={{
            fontSize: 10.5, fontWeight: 700, color: T.copper[700], background: T.copper[50],
            padding: '1px 7px', borderRadius: 999, letterSpacing: 0.3,
          }}>
            {count} ›
          </span>
        )}
      </span>
      <span style={{
        color: muted ? T.neutral[600] : T.neutral[900],
        fontVariantNumeric: 'tabular-nums',
      }}>
        {fmtCOP(amount)}
      </span>
    </button>
  )
}

// ──────────────────────────────────────────────────────────────
// Sub-modal: lista detallada de ventas del turno
// methodFilter (opcional): si se pasa, solo muestra ventas de ese método.
// ──────────────────────────────────────────────────────────────
function SalesListModal({ sales, totalSales, methodFilter, onClose }) {
  // Ordenar más recientes primero (las que vienen de watchSessionSales ya
  // vienen ordenadas, pero por seguridad)
  // Igual que ClickableMethodRow: incluir ventas mixto que tengan porción en
  // el método filtrado.
  const filtered = methodFilter
    ? sales.filter(s => {
        if (s.paymentSplit && Number(s.paymentSplit[methodFilter]) > 0) return true
        return (s.paymentMethod || 'efectivo') === methodFilter
      })
    : [...sales]

  // Para deuda mostramos el grupo por deudor (suma por persona) además de la
  // lista de ventas — es más útil para "ver quiénes deben".
  const debtorSummary = methodFilter === 'deuda'
    ? Object.values(filtered.reduce((acc, s) => {
        const key = (s.debtorName || 'Sin nombre').trim() || 'Sin nombre'
        if (!acc[key]) acc[key] = { name: key, total: 0, count: 0 }
        acc[key].total += Number(s.total) || 0
        acc[key].count += 1
        return acc
      }, {})).sort((a, b) => b.total - a.total)
    : null

  const filteredTotal = filtered.reduce((acc, s) => acc + (Number(s.total) || 0), 0)
  const headerLabel = {
    efectivo: { title: 'Ventas en efectivo', icon: '💵' },
    nequi: { title: 'Ventas por Nequi', icon: '📱' },
    daviplata: { title: 'Ventas por Daviplata', icon: '📲' },
    deuda: { title: 'Deudores del turno', icon: '📋' },
  }[methodFilter] || { title: 'Ventas del turno', icon: '🧾' }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 110,
      background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '16px',
      animation: 'fadeIn 0.15s ease',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 460,
        maxHeight: '85vh', display: 'flex', flexDirection: 'column',
        background: '#fff', borderRadius: 20,
        boxShadow: '0 16px 48px rgba(0,0,0,0.25)',
        overflow: 'hidden',
        animation: 'fadeScaleIn 0.18s cubic-bezier(0.2, 0.9, 0.3, 1.05)',
      }}>
        {/* Header sticky */}
        <div style={{
          padding: '18px 20px 14px',
          borderBottom: `1px solid ${T.neutral[100]}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: T.neutral[900] }}>
              <span style={{ marginRight: 6 }}>{headerLabel.icon}</span>{headerLabel.title}
            </div>
            <div style={{ fontSize: 12.5, color: T.neutral[500], marginTop: 2 }}>
              {filtered.length} {filtered.length === 1 ? 'venta' : 'ventas'} · Total {fmtCOP(methodFilter ? filteredTotal : totalSales)}
            </div>
          </div>
          <button onClick={onClose} style={{
            width: 32, height: 32, borderRadius: 999, border: 'none',
            background: T.neutral[100], color: T.neutral[700],
            cursor: 'pointer', fontSize: 18, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'inherit',
          }}>×</button>
        </div>

        {/* Si es vista de deuda, mostrar resumen por deudor arriba */}
        {debtorSummary && debtorSummary.length > 0 && (
          <div style={{
            padding: '12px 20px',
            background: '#FFF7E6', borderBottom: `1px solid #F4E0BC`,
          }}>
            <div style={{
              fontSize: 11, fontWeight: 700, color: T.warn,
              textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8,
            }}>
              Quiénes deben ({debtorSummary.length})
            </div>
            {debtorSummary.map((d, i) => (
              <div key={d.name} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '4px 0',
                borderBottom: i < debtorSummary.length - 1 ? `0.5px solid #F4E0BC` : 'none',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.neutral[900] }}>
                    {d.name}
                  </div>
                  <div style={{ fontSize: 11, color: T.neutral[600] }}>
                    {d.count} {d.count === 1 ? 'venta' : 'ventas'}
                  </div>
                </div>
                <div style={{
                  fontSize: 14, fontWeight: 800, color: T.bad,
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {fmtCOP(d.total)}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Lista scrollable */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {filtered.length === 0 ? (
            <div style={{
              padding: '32px 20px', textAlign: 'center',
              fontSize: 13, color: T.neutral[500],
            }}>
              Sin ventas en este método
            </div>
          ) : (
            filtered.map((s, i) => (
              <SaleDetailRow key={s.id} sale={s} isLast={i === filtered.length - 1} />
            ))
          )}
        </div>

        {/* Footer con total */}
        <div style={{
          padding: '14px 20px',
          background: T.copper[50], borderTop: `1px solid ${T.copper[100]}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.copper[700], letterSpacing: 0.4, textTransform: 'uppercase' }}>
            Total
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: T.copper[700], fontVariantNumeric: 'tabular-nums' }}>
            {fmtCOP(methodFilter ? filteredTotal : totalSales)}
          </div>
        </div>
      </div>
    </div>
  )
}

function SaleDetailRow({ sale, isLast }) {
  const time = sale.createdAt?.toDate?.() || sale.createdAtClient
  const timeStr = time
    ? new Date(time).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Bogota' })
    : '—'
  const { icon: methodIcon, label: methodLabel } = paymentDisplay(sale)
  const splitSummary = paymentSplitSummary(sale)
  const isFlagged = sale.status === 'flagged'

  return (
    <div style={{
      padding: '12px 20px',
      borderBottom: isLast ? 'none' : `0.5px solid ${T.neutral[100]}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <div style={{ fontSize: 16, flexShrink: 0 }}>{methodIcon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.neutral[800] }}>
            {timeStr} · {methodLabel}
            {isFlagged && <span style={{ color: T.warn, marginLeft: 6, fontWeight: 700 }}>⚠ reportada</span>}
          </div>
          {splitSummary && (
            <div style={{ fontSize: 11, color: T.copper[700], marginTop: 1, fontWeight: 600 }}>
              {splitSummary}
            </div>
          )}
          {sale.debtorName && (
            <div style={{ fontSize: 11, color: T.neutral[500], marginTop: 1 }}>
              Deudor: {sale.debtorName}
            </div>
          )}
        </div>
        <div style={{
          fontSize: 14, fontWeight: 800, color: T.neutral[900],
          fontVariantNumeric: 'tabular-nums', flexShrink: 0,
        }}>
          {fmtCOP(sale.total || 0)}
        </div>
      </div>
      {/* Items de la venta */}
      {sale.items && sale.items.length > 0 && (
        <div style={{
          marginLeft: 26, padding: '6px 10px', borderRadius: 8,
          background: T.neutral[50],
        }}>
          {sale.items.map((it, j) => (
            <div key={j} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8,
              fontSize: 12, color: T.neutral[700], padding: '2px 0',
            }}>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {it.qty}× {it.name}
              </span>
              <span style={{ color: T.neutral[500], fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                {fmtCOP(it.subtotal || (Number(it.unitPrice) || 0) * (Number(it.qty) || 0))}
              </span>
            </div>
          ))}
        </div>
      )}
      {sale.photoUrl && (
        <div style={{ marginLeft: 26, marginTop: 4 }}>
          <a href={sale.photoUrl} target="_blank" rel="noreferrer" style={{
            fontSize: 11, color: T.copper[600], fontWeight: 600, textDecoration: 'underline',
          }}>
            📎 ver comprobante
          </a>
        </div>
      )}
    </div>
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

const blockStyle = {
  padding: '12px 14px', borderRadius: 12,
  background: T.neutral[50], marginBottom: 14,
}

const emptyBlockStyle = {
  padding: '12px', textAlign: 'center', borderRadius: 10,
  background: T.neutral[50], color: T.neutral[500], fontSize: 12.5,
  marginBottom: 14,
}

const selectStyle = {
  width: '100%', padding: '12px 14px', borderRadius: 12,
  border: `1.5px solid ${T.neutral[200]}`,
  background: '#fff', color: T.neutral[900],
  fontFamily: 'inherit', fontSize: 14, outline: 'none',
}

// Aviso visual al admin antes de cerrar: hora de la última venta vista en el
// servidor. El admin desde su panel solo ve lo sincronizado — si la cajera
// estuvo offline, sus ventas más recientes aún no aparecerán hasta que tenga
// señal. Tres niveles según hace cuánto fue la última venta:
//   < 30min  → tono neutro (todo normal)
//   30-120min → amarillo (revisar con la cajera)
//   > 2h     → rojo (probablemente faltan ventas por sincronizar)
function LastSaleNotice({ lastSaleAt, salesCount }) {
  if (salesCount === 0) {
    return (
      <div style={{
        padding: '10px 12px', borderRadius: 10, marginBottom: 14,
        background: T.neutral[50], border: `1px solid ${T.neutral[200]}`,
        fontSize: 12.5, color: T.neutral[600], lineHeight: 1.5,
      }}>
        Sin ventas registradas en este turno.
      </div>
    )
  }
  if (!lastSaleAt) return null

  const minsAgo = Math.max(0, Math.round((Date.now() - lastSaleAt) / 60000))
  const time = new Date(lastSaleAt).toLocaleTimeString('es-CO', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota',
  })

  let level = 'ok'
  if (minsAgo >= 120) level = 'alert'
  else if (minsAgo >= 30) level = 'warn'

  const cfg = {
    ok:    { bg: '#E8F0E5', border: '#BCD2B6', fg: '#3D6F3B', icon: '🕒', hint: null },
    warn:  { bg: '#FFF4DD', border: '#F0D699', fg: '#8A5E12', icon: '⚠️',
             hint: 'Si la cajera tiene activado "Modo ahorro de datos" o problemas de internet, pídele que toque "Sincronizar ahora" antes de cerrar.' },
    alert: { bg: '#FBE4DF', border: '#E8B5AB', fg: '#8A3625', icon: '🚨',
             hint: 'Hace bastante rato sin ventas nuevas. Pídele a la cajera que sincronice (banner de "Modo ahorro" o conectar a internet) antes de cerrar — puede tener ventas pendientes en el celular.' },
  }[level]

  const agoLabel =
    minsAgo < 1 ? 'hace menos de 1 min' :
    minsAgo < 60 ? `hace ${minsAgo} min` :
    `hace ${Math.floor(minsAgo / 60)}h ${minsAgo % 60}m`

  return (
    <div style={{
      padding: '12px 14px', borderRadius: 12, marginBottom: 14,
      background: cfg.bg, border: `1px solid ${cfg.border}`,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: cfg.hint ? 6 : 0,
      }}>
        <div style={{ fontSize: 18, lineHeight: 1 }}>{cfg.icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: cfg.fg, letterSpacing: 0.3, textTransform: 'uppercase' }}>
            Última venta vista
          </div>
          <div style={{ fontSize: 14, fontWeight: 800, color: cfg.fg, fontVariantNumeric: 'tabular-nums' }}>
            {time} · {agoLabel}
          </div>
        </div>
      </div>
      {cfg.hint && (
        <div style={{ fontSize: 12, color: cfg.fg, lineHeight: 1.5, paddingLeft: 28 }}>
          {cfg.hint}
        </div>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Fila de la lista "Otros turnos activos" (cocina / mesera)
// ──────────────────────────────────────────────────────────────
function NonCashShiftRow({ session, isLast, onAssist, onClose, onDiscard }) {
  const typeLabel = session.type === 'kitchen' ? 'Cocina' : 'Domiciliaria / Mesera'
  const typeColor = session.type === 'kitchen' ? '#7A5C00' : T.copper[700]
  const typeBg = session.type === 'kitchen' ? '#FFF7E6' : T.copper[50]
  const opened = session.openedAt?.toDate?.()
  const fmtTime = (d) => d
    ? d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Bogota' })
    : '—'

  return (
    <div style={{
      padding: '12px 16px',
      display: 'flex', alignItems: 'center', gap: 12,
      borderBottom: isLast ? 'none' : `0.5px solid ${T.neutral[100]}`,
    }}>
      <div style={{
        padding: '3px 9px', borderRadius: 999,
        background: typeBg, color: typeColor,
        fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
        flexShrink: 0,
      }}>
        {typeLabel}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: T.neutral[900] }}>
          {session.cashierName || 'Sin nombre'}
        </div>
        <div style={{ fontSize: 11.5, color: T.neutral[500], marginTop: 2 }}>
          {session.branchName || 'Sin panadería'} · desde {fmtTime(opened)}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        {onDiscard && (
          <button
            onClick={onDiscard}
            title="Cancelar turno (abierto por error)"
            style={{
              padding: '7px 10px', borderRadius: 10,
              background: '#fff', color: T.bad,
              border: `1px solid ${T.bad}55`,
              cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 12, fontWeight: 700,
            }}
          >
            Cancelar
          </button>
        )}
        <button
          onClick={onAssist}
          title="Asistir (ver la pantalla de este turno)"
          style={{
            padding: '7px 10px', borderRadius: 10,
            background: '#fff', color: T.neutral[700],
            border: `1px solid ${T.neutral[200]}`,
            cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 12, fontWeight: 700,
          }}
        >
          Asistir
        </button>
        <button
          onClick={onClose}
          style={{
            padding: '7px 12px', borderRadius: 10,
            background: T.neutral[900], color: '#fff',
            border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 12, fontWeight: 700,
          }}
        >
          Cerrar
        </button>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// MODAL: Abrir turno de cocina / domiciliaria-mesera
// ──────────────────────────────────────────────────────────────
function OpenNonCashShiftModal({ branches, allUsers, onCancel, onOpened }) {
  const [shiftType, setShiftType] = useState('kitchen') // 'kitchen' | 'waitress'
  const [branchId, setBranchId] = useState(branches[0]?.id || '')
  const [personUid, setPersonUid] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // Cualquier miembro del equipo aprobado puede recibir el turno.
  const people = useMemo(
    () => allUsers.filter(u => u.status === 'approved' && u.role !== 'admin'),
    [allUsers]
  )

  const selectedPerson = people.find(p => p.uid === personUid)
  const selectedBranch = branches.find(b => b.id === branchId)
  const canConfirm = !busy && shiftType && branchId && personUid

  async function handleOpen() {
    if (!canConfirm) return
    setBusy(true); setError(null)
    try {
      const cashierName = `${selectedPerson.nombre || ''} ${selectedPerson.apellido || ''}`.trim() || selectedPerson.email
      await openSession({
        branchId: selectedBranch.id,
        branchName: selectedBranch.name,
        cashierUid: selectedPerson.uid,
        cashierName,
        shiftType,
      })
      onOpened()
    } catch (err) {
      console.error(err)
      setError('No pudimos abrir el turno. Intenta de nuevo.')
      setBusy(false)
    }
  }

  return (
    <ModalShell onClose={busy ? undefined : onCancel}>
      <ModalTitle title="Abrir turno" subtitle="Cocina o domiciliaria/mesera" />

      <Field label="Tipo de turno">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {[
            { id: 'kitchen', label: 'Cocina', sub: 'Cola de pedidos' },
            { id: 'waitress', label: 'Domiciliaria / Mesera', sub: 'Apoyo en piso' },
          ].map(opt => {
            const active = shiftType === opt.id
            return (
              <button
                key={opt.id}
                onClick={() => !busy && setShiftType(opt.id)}
                disabled={busy}
                style={{
                  padding: '12px', borderRadius: 12, textAlign: 'left',
                  background: active ? T.copper[50] : '#fff',
                  border: `1.5px solid ${active ? T.copper[400] : T.neutral[200]}`,
                  cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                  opacity: busy ? 0.6 : 1,
                }}
              >
                <div style={{ fontSize: 13.5, fontWeight: 700, color: active ? T.copper[700] : T.neutral[800] }}>
                  {opt.label}
                </div>
                <div style={{ fontSize: 11, color: T.neutral[500], marginTop: 2 }}>{opt.sub}</div>
              </button>
            )
          })}
        </div>
      </Field>

      <Field label="Panadería">
        <select
          value={branchId}
          onChange={e => setBranchId(Number(e.target.value))}
          disabled={busy}
          style={selectStyle}
        >
          {branches.map(b => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </Field>

      <Field label="Persona">
        <select
          value={personUid}
          onChange={e => setPersonUid(e.target.value)}
          disabled={busy}
          style={selectStyle}
        >
          <option value="">Selecciona del equipo...</option>
          {people.map(p => (
            <option key={p.uid} value={p.uid}>
              {p.nombre} {p.apellido}
            </option>
          ))}
        </select>
        {people.length === 0 && (
          <div style={{ fontSize: 11.5, color: T.bad, marginTop: 6 }}>
            No hay miembros del equipo aprobados.
          </div>
        )}
      </Field>

      {error && <ErrorBox text={error} />}

      <ModalFooter>
        <ModalBtnSecondary onClick={onCancel} disabled={busy}>Cancelar</ModalBtnSecondary>
        <ModalBtnPrimary
          onClick={handleOpen}
          disabled={!canConfirm}
          color={T.copper[500]}
        >
          {busy ? 'Abriendo...' : 'Abrir turno'}
        </ModalBtnPrimary>
      </ModalFooter>
    </ModalShell>
  )
}

// ──────────────────────────────────────────────────────────────
// MODAL: Cerrar turno de cocina / domiciliaria-mesera (sin cuadre)
// ──────────────────────────────────────────────────────────────
function CloseNonCashShiftModal({ session, adminUid, onCancel, onClosed }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const typeLabel = session.type === 'kitchen' ? 'cocina' : 'domiciliaria/mesera'

  async function handleClose() {
    setBusy(true); setError(null)
    try {
      await adminCloseNonCashSession(session.id, { reviewedBy: adminUid })
      onClosed()
    } catch (err) {
      console.error(err)
      setError('No pudimos cerrar el turno. Intenta de nuevo.')
      setBusy(false)
    }
  }

  return (
    <ModalShell onClose={busy ? undefined : onCancel}>
      <ModalTitle title="Cerrar turno" subtitle={`${session.cashierName} · ${session.branchName || 'Sin panadería'}`} />
      <div style={{ fontSize: 13.5, color: T.neutral[600], marginBottom: 18, lineHeight: 1.5 }}>
        Cerrar el turno de <b>{typeLabel}</b> de <b>{session.cashierName}</b>. No hay cuadre de caja para este tipo de turno.
      </div>
      {error && <ErrorBox text={error} />}
      <ModalFooter>
        <ModalBtnSecondary onClick={onCancel} disabled={busy}>Cancelar</ModalBtnSecondary>
        <ModalBtnPrimary onClick={handleClose} disabled={busy} color={T.neutral[900]}>
          {busy ? 'Cerrando...' : 'Cerrar turno'}
        </ModalBtnPrimary>
      </ModalFooter>
    </ModalShell>
  )
}

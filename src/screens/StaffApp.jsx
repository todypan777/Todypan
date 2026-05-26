import { useEffect, useState } from 'react'
import { T } from '../tokens'
import { watchMyOpenSessions } from '../cashSessions'
import { isDataSaverEnabled, ensureNetworkForWaiting } from '../utils/network'
import CashierApp from './CashierApp'
import CookApp from './CookApp'
import WaitressApp from './WaitressApp'
import NoShiftScreen from './NoShiftScreen'

/**
 * Router para staff (cualquier miembro del equipo que no sea admin).
 * Es la ÚNICA fuente de verdad del turno activo: observa TODOS los turnos
 * abiertos de la cuenta y elige cuál se muestra. Si hay 2+ (ej. caja + cocina),
 * el empleado puede cambiar entre ellos desde el menú de perfil (RoleSwitcher).
 *
 * Decide qué app mostrar según el tipo del turno activo:
 *   - type === 'cash'     → CashierApp (POS, caja)
 *   - type === 'kitchen'  → CookApp    (cola de cocina)
 *   - type === 'waitress' → WaitressApp
 *   - sin turno           → NoShiftScreen
 *
 * Compatibilidad: turnos sin campo type se tratan como 'cash' (legacy).
 */
const SELECTED_KEY = uid => `todypan_selected_session_${uid}`

export default function StaffApp({ authUser, userDoc }) {
  const [sessions, setSessions] = useState(undefined) // undefined = cargando
  const [selectedId, setSelectedId] = useState(null)

  useEffect(() => watchMyOpenSessions(authUser.uid, setSessions), [authUser.uid])

  // Recordar el último rol usado en este dispositivo.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SELECTED_KEY(authUser.uid))
      if (stored) setSelectedId(stored)
    } catch {}
  }, [authUser.uid])

  // Turno activo: el guardado si sigue abierto, si no el primero (más antiguo).
  const current = Array.isArray(sessions) && sessions.length > 0
    ? (sessions.find(s => s.id === selectedId) || sessions[0])
    : null

  // Modo ahorro + red:
  //  - Sin turno, o turno activo NO-caja (cocina/mesera) → la red DEBE estar
  //    conectada: sin turno para recibir la apertura del admin (anti-deadlock);
  //    en cocina/mesera porque dependen de watchers en vivo (cola, mesas).
  //  - Turno activo de CAJA → no tocamos: CashierApp aplica el ahorro él mismo.
  // Sin esto, una cuenta multi-rol que pasa por caja (que desconecta la red)
  // dejaría la vista de cocina/mesera congelada al volver a ella.
  useEffect(() => {
    if (!isDataSaverEnabled()) return
    const activeType = current ? (current.type || 'cash') : null
    if (activeType === 'cash') return // CashierApp se encarga
    ensureNetworkForWaiting().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id])

  // Mantener selectedId y el localStorage alineados con el turno realmente
  // activo (corrige un id guardado que ya se cerró → apunta al turno real).
  useEffect(() => {
    if (!current || current.id === selectedId) return
    setSelectedId(current.id)
    try { localStorage.setItem(SELECTED_KEY(authUser.uid), current.id) } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id])

  function handleSwitch(id) {
    setSelectedId(id)
    try { localStorage.setItem(SELECTED_KEY(authUser.uid), id) } catch {}
  }

  if (sessions === undefined) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100dvh', background: T.neutral[50],
        flexDirection: 'column', gap: 16,
      }}>
        <div style={{ fontSize: 52 }}>🥖</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: T.copper[500] }}>
          Verificando turno...
        </div>
      </div>
    )
  }

  if (!current) {
    return <NoShiftScreen authUser={authUser} userDoc={userDoc} />
  }

  const switchProps = {
    availableSessions: sessions,
    currentSessionId: current.id,
    onSwitchSession: handleSwitch,
  }

  const type = current.type || 'cash'
  if (type === 'kitchen') {
    return <CookApp authUser={authUser} userDoc={userDoc} session={current} {...switchProps} />
  }
  if (type === 'waitress') {
    return <WaitressApp authUser={authUser} userDoc={userDoc} session={current} {...switchProps} />
  }
  // Default: 'cash' (incluye turnos legacy sin type)
  return <CashierApp authUser={authUser} userDoc={userDoc} session={current} {...switchProps} />
}

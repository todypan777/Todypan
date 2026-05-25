import { useEffect, useState } from 'react'
import { T } from '../tokens'
import { watchMyOpenSession } from '../cashSessions'
import { isDataSaverEnabled, ensureNetworkForWaiting } from '../utils/network'
import CashierApp from './CashierApp'
import CookApp from './CookApp'
import WaitressApp from './WaitressApp'
import NoShiftScreen from './NoShiftScreen'

/**
 * Router para staff (cualquier miembro del equipo que no sea admin).
 * Decide qué app mostrar según la session abierta:
 *   - session.type === 'cash'     → CashierApp (POS, caja)
 *   - session.type === 'kitchen'  → CookApp    (cola de cocina)
 *   - session.type === 'waitress' → WaitressApp (placeholder por ahora)
 *   - sin session                 → NoShiftScreen
 *
 * Compatibilidad: sessions abiertas SIN campo type se tratan como 'cash'
 * (estado legacy — todas las sesiones existentes eran de cajera).
 */
export default function StaffApp({ authUser, userDoc }) {
  const [mySession, setMySession] = useState(undefined) // undefined = loading

  useEffect(() => watchMyOpenSession(authUser.uid, setMySession), [authUser.uid])

  // Anti-deadlock del modo ahorro: mientras NO haya turno abierto, la red DEBE
  // seguir conectada para recibir la apertura que hace el admin. Con el ahorro
  // activo (flag por-dispositivo en localStorage) Firestore quedaba desconectado
  // y el turno nuevo nunca llegaba → el empleado se quedaba atascado en "sin
  // turno" aunque el dispositivo tuviera internet, sin forma de apagar el ahorro
  // desde esa pantalla. Reconectamos mientras espera; al abrir un turno de CAJA,
  // CashierApp vuelve a respetar el ahorro durante el turno.
  useEffect(() => {
    if (mySession) return // ya hay turno → la app del rol decide la red
    if (!isDataSaverEnabled()) return
    ensureNetworkForWaiting().catch(() => {})
  }, [mySession])

  if (mySession === undefined) {
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

  if (!mySession) {
    return <NoShiftScreen authUser={authUser} userDoc={userDoc} />
  }

  const type = mySession.type || 'cash'

  if (type === 'kitchen') {
    return <CookApp authUser={authUser} userDoc={userDoc} session={mySession} />
  }
  if (type === 'waitress') {
    return <WaitressApp authUser={authUser} userDoc={userDoc} session={mySession} />
  }
  // Default: 'cash' (incluye sesiones legacy sin type)
  return <CashierApp authUser={authUser} userDoc={userDoc} />
}

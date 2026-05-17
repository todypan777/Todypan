import { firestoreDb } from './firebase'
import {
  doc,
  collection,
  addDoc,
  updateDoc,
  serverTimestamp,
  query,
  where,
  onSnapshot,
} from 'firebase/firestore'
import { getClientTimestamp } from './utils/network'

// ────────────────────────────────────────────────────────────────────────────
// Llamadas de cocina a cajera.
//
// La cocinera toca un botón flotante para pedirle a la cajera de una panadería
// que suba a cocina. Mientras la llamada esté en `pending`, la app de la
// cajera se bloquea con un overlay grande y vibra. Al tocar "Voy en camino"
// la cajera marca la llamada como `acknowledged` y se desbloquea — la
// cocinera vuelve a poder llamar.
//
// Modelo: kitchenCalls/{id}
//   createdBy, createdByName             (cocinera/admin que llamó)
//   targetBranchId, targetBranchName     (panadería a la que se llama)
//   targetSessionId, targetCashierUid,
//   targetCashierName                    (cajera receptora cuando se creó)
//   status: 'pending' | 'acknowledged'
//   createdAt, createdAtClient
//   acknowledgedAt?, acknowledgedAtClient?,
//   acknowledgedBy?, acknowledgedByName?
// ────────────────────────────────────────────────────────────────────────────

const callsCol = () => collection(firestoreDb, 'kitchenCalls')
const callRef = (id) => doc(firestoreDb, 'kitchenCalls', id)

function timeOf(c) {
  return c.createdAt?.toMillis?.() ?? c.createdAtClient ?? 0
}

/**
 * Crea una llamada de cocina. La llama la cocinera al tocar el botón.
 *
 * payload:
 *   - createdBy, createdByName
 *   - targetBranchId, targetBranchName
 *   - targetSessionId, targetCashierUid, targetCashierName
 */
export async function createKitchenCall(payload) {
  const data = {
    createdBy: payload.createdBy,
    createdByName: payload.createdByName || null,
    targetBranchId: payload.targetBranchId ?? null,
    targetBranchName: payload.targetBranchName || null,
    targetSessionId: payload.targetSessionId || null,
    targetCashierUid: payload.targetCashierUid || null,
    targetCashierName: payload.targetCashierName || null,
    status: 'pending',
    createdAt: serverTimestamp(),
    createdAtClient: getClientTimestamp(),
  }
  const ref = await addDoc(callsCol(), data)
  return ref.id
}

/**
 * La cajera acepta la llamada: queda `acknowledged`, su app se desbloquea
 * y la cocinera puede volver a llamar.
 */
export async function acknowledgeKitchenCall(callId, { byUid, byName } = {}) {
  await updateDoc(callRef(callId), {
    status: 'acknowledged',
    acknowledgedAt: serverTimestamp(),
    acknowledgedAtClient: getClientTimestamp(),
    acknowledgedBy: byUid || null,
    acknowledgedByName: byName || null,
  })
}

/**
 * La cocinera cancela su propia llamada antes de que la cajera atienda
 * (ej. ya la vio venir físicamente). El overlay desaparece del lado de
 * la cajera y la cocinera vuelve a poder llamar.
 */
export async function cancelKitchenCall(callId, { byUid, byName } = {}) {
  await updateDoc(callRef(callId), {
    status: 'cancelled',
    cancelledAt: serverTimestamp(),
    cancelledAtClient: getClientTimestamp(),
    cancelledBy: byUid || null,
    cancelledByName: byName || null,
  })
}

/**
 * Suscripción a las llamadas pendientes dirigidas a una cajera específica.
 * Usada por la cajera para saber si debe mostrar el overlay bloqueante.
 *
 * Filtramos por `targetCashierUid` (no por branchId) porque eso permite
 * reglas Firestore mínimas: la cajera solo lee las llamadas que la
 * mencionan a ella, no las de otras panaderías.
 *
 * Mantiene el último valor en error transitorio (mismo patrón que
 * watchMyOpenSession): si pierde señal, la cajera no debe ver el overlay
 * desaparecer ni reaparecer en bucle.
 */
export function watchPendingCallsForCashier(cashierUid, callback) {
  if (!cashierUid) { callback([]); return () => {} }
  const q = query(
    callsCol(),
    where('status', '==', 'pending'),
    where('targetCashierUid', '==', cashierUid),
  )
  return onSnapshot(
    q,
    snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      list.sort((a, b) => timeOf(a) - timeOf(b))
      callback(list)
    },
    err => {
      console.error('[kitchenCalls] watchPendingCallsForCashier error (manteniendo último valor):', err?.message || err)
    }
  )
}

/**
 * Suscripción a las llamadas creadas por una cocinera específica que
 * siguen pendientes. La cocinera la usa para saber si su última llamada
 * ya fue atendida (y por tanto puede volver a llamar).
 */
export function watchMyPendingCalls(uid, callback) {
  if (!uid) { callback([]); return () => {} }
  const q = query(
    callsCol(),
    where('status', '==', 'pending'),
    where('createdBy', '==', uid),
  )
  return onSnapshot(
    q,
    snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      list.sort((a, b) => timeOf(b) - timeOf(a))
      callback(list)
    },
    err => {
      console.error('[kitchenCalls] watchMyPendingCalls error:', err)
      callback([])
    }
  )
}

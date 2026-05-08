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

// ──────────────────────────────────────────────────────────────────────────
// kitchenOrders/{id}
//   tabId             → mesa (openTab) a la que pertenece
//   tableNumber       → denormalizado para la cocinera
//   sessionId         → cashSession activa que la creó
//   branchId, branchName
//   cashierUid, cashierName
//   destination: 'mesa' | 'llevar'
//   kind: 'menu' | 'special'
//      'menu':    almuerzo con selecciones por categoría
//      'special': almuerzo especial sin categorías, solo descripción y precio
//   selections?: { soup?, principio?, protein?, side?, salad?, juice? }
//      Cada uno: { id, name } o null si la cajera lo quitó
//      Para 'special' este campo no existe.
//   description?: string   (solo para 'special' o nota libre del almuerzo)
//   price                  → precio del producto (priceMesa o priceLlevar según destination)
//   productId, productName → producto del catálogo (Almuerzo Sencillo, etc.)
//   commandaNote?          → nota a nivel de la comanda (ver más abajo)
//   commandaId             → agrupador: todos los almuerzos enviados juntos
//   status: 'pending' | 'ready' | 'delivered' | 'cancelled'
//   paid?: bool            → para llevar pagado antes (cocina aún pendiente)
//   createdAt, createdAtClient
//   readyAt?, readyAtClient?
//   deliveredAt?
//   cancelledAt?, cancelReason?
//
// commandaId: cuando la cajera envía 3 almuerzos juntos para la misma mesa,
//   los 3 comparten el mismo commandaId. Permite a la cocinera mostrarlos
//   agrupados (encajados con una llave).
//
// commandaNote: la nota es por COMANDA (no por almuerzo). Se guarda igual en
//   los 3 docs para que el watcher funcione sin joins.
// ──────────────────────────────────────────────────────────────────────────

const ordersCol = () => collection(firestoreDb, 'kitchenOrders')
const orderRef = (id) => doc(firestoreDb, 'kitchenOrders', id)

function timeOf(o) {
  return o.createdAt?.toMillis?.() ?? o.createdAtClient ?? 0
}

/** Crea una orden de cocina. Devuelve { id }. */
export async function createKitchenOrder(payload) {
  const data = {
    tabId: payload.tabId,
    tableNumber: payload.tableNumber,
    sessionId: payload.sessionId,
    branchId: payload.branchId ?? null,
    branchName: payload.branchName || null,
    cashierUid: payload.cashierUid,
    cashierName: payload.cashierName || null,
    destination: payload.destination === 'llevar' ? 'llevar' : 'mesa',
    kind: payload.kind === 'special' ? 'special' : 'menu',
    selections: payload.selections || null,
    description: payload.description?.trim() || null,
    price: Number(payload.price) || 0,
    productId: payload.productId || null,
    productName: payload.productName || null,
    commandaId: payload.commandaId,
    commandaNote: payload.commandaNote?.trim() || null,
    status: 'pending',
    paid: !!payload.paid,
    createdAt: serverTimestamp(),
    createdAtClient: getClientTimestamp(),
  }
  const ref = await addDoc(ordersCol(), data)
  return ref.id
}

/** La cocinera marca un almuerzo como listo. */
export async function markOrderReady(id) {
  await updateDoc(orderRef(id), {
    status: 'ready',
    readyAt: serverTimestamp(),
    readyAtClient: getClientTimestamp(),
  })
}

/**
 * Reabre una orden lista (toggle visual si la cocinera tocó por error).
 */
export async function unmarkOrderReady(id) {
  await updateDoc(orderRef(id), {
    status: 'pending',
    readyAt: null,
    readyAtClient: null,
  })
}

/** La cajera entrega (cierra) una orden lista. */
export async function markOrderDelivered(id) {
  await updateDoc(orderRef(id), {
    status: 'delivered',
    deliveredAt: serverTimestamp(),
  })
}

/** La cajera cancela una orden (puede estar pending o ready). */
export async function cancelKitchenOrder(id, { reason } = {}) {
  await updateDoc(orderRef(id), {
    status: 'cancelled',
    cancelledAt: serverTimestamp(),
    cancelReason: reason?.trim() || null,
  })
}

/** Marca toda una comanda como pagada antes de tiempo (solo para llevar). */
export async function markCommandaPaid(commandaId, _ids) {
  // Recibe commandaId pero firestore necesita actualizar doc por doc;
  // la UI debe pasar la lista de ids a actualizar.
  if (!Array.isArray(_ids)) return
  await Promise.all(_ids.map(id => updateDoc(orderRef(id), { paid: true })))
}

// ─── Watchers ──────────────────────────────────────────────────────

/**
 * Cola de cocina: todos los pedidos pending o ready (no entregados/cancelados).
 * Ordenados por createdAt asc (FIFO — más antiguo primero).
 */
export function watchKitchenQueue(callback) {
  try {
    const q = query(ordersCol(), where('status', 'in', ['pending', 'ready']))
    return onSnapshot(
      q,
      snap => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        list.sort((a, b) => timeOf(a) - timeOf(b))
        callback(list)
      },
      err => {
        console.error('[kitchen] watchKitchenQueue error:', err)
        callback([])
      }
    )
  } catch (err) {
    console.error('[kitchen] watchKitchenQueue setup failed:', err)
    callback([])
    return () => {}
  }
}

/** Pedidos de una mesa específica (cualquier status no-cancelled). */
export function watchOrdersForTab(tabId, callback) {
  if (!tabId) { callback([]); return () => {} }
  const q = query(ordersCol(), where('tabId', '==', tabId))
  return onSnapshot(
    q,
    snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      list.sort((a, b) => timeOf(a) - timeOf(b))
      callback(list)
    },
    err => {
      console.error('[kitchen] watchOrdersForTab error:', err)
      callback([])
    }
  )
}

/**
 * Pedidos vivos (pending/ready) de TODAS las mesas de una sesión.
 * Usado por OpenTabsBubbles para colorear las burbujas.
 */
export function watchLiveOrdersForSession(sessionId, callback) {
  if (!sessionId) { callback([]); return () => {} }
  try {
    const q = query(
      ordersCol(),
      where('sessionId', '==', sessionId),
      where('status', 'in', ['pending', 'ready']),
    )
    return onSnapshot(
      q,
      snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err => {
        console.error('[kitchen] watchLiveOrdersForSession error:', err)
        callback([])
      }
    )
  } catch (err) {
    console.error('[kitchen] watchLiveOrdersForSession setup failed:', err)
    callback([])
    return () => {}
  }
}

/**
 * Estado consolidado de una mesa según sus orders activos.
 *  - 'cooking'  → al menos uno pending
 *  - 'ready'    → todos los activos están ready (al menos hay uno)
 *  - 'idle'     → no hay orders activos
 */
export function tabKitchenState(orders) {
  const active = (orders || []).filter(o => o.status === 'pending' || o.status === 'ready')
  if (active.length === 0) return 'idle'
  if (active.every(o => o.status === 'ready')) return 'ready'
  return 'cooking'
}

/** Genera un commandaId único. */
export function newCommandaId() {
  return `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

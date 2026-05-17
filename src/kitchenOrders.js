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
  Timestamp,
} from 'firebase/firestore'
import { getClientTimestamp } from './utils/network'
import { addDocOffline } from './utils/firestoreOffline'

// ──────────────────────────────────────────────────────────────────────────
// kitchenOrders/{id}
//   tabId             → mesa (openTab) a la que pertenece
//   tableNumber       → denormalizado para la cocinera (puede ser null si la
//                       tab es de tipo 'llevar' sin número)
//   customerName?     → nombre del cliente cuando la tab es de 'llevar'
//                       (denormalizado de openTab.customerName)
//   sessionId         → cashSession activa que la creó
//   branchId, branchName
//   cashierUid, cashierName
//   destination: 'mesa' | 'llevar'   (POR ALMUERZO — puede mezclarse en una comanda)
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
    // tableNumber puede ser null cuando la tab es de tipo 'llevar' (sin mesa).
    tableNumber: payload.tableNumber ?? null,
    // tableSuffix denormalizado para que cocina muestre "Mesa 2.1" sin tener
    // que hacer JOIN con openTabs. Solo se incluye si > 0.
    ...(Number(payload.tableSuffix) > 0 ? { tableSuffix: Number(payload.tableSuffix) } : {}),
    customerName: payload.customerName?.trim() || null,
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
  // Fire-and-forget para modo ahorro / offline.
  const ref = addDocOffline(ordersCol(), data)
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
export async function cancelKitchenOrder(id, { reason, cancelledBy, cancelledByName } = {}) {
  await updateDoc(orderRef(id), {
    status: 'cancelled',
    cancelledAt: serverTimestamp(),
    cancelReason: reason?.trim() || null,
    cancelledBy: cancelledBy || null,
    cancelledByName: cancelledByName?.trim() || null,
  })
}

/**
 * La cajera corrige un almuerzo YA enviado (por si se equivocó). Solo debe
 * llamarse cuando el pedido sigue 'pending' — la UI lo verifica con el
 * estado en vivo antes de abrir el editor.
 *
 * payload: { destination, selections?, description?, note?, price }
 *   - destination: 'mesa' | 'llevar'
 *   - selections: objeto de categorías (solo 'menu')
 *   - description: texto libre (solo 'special')
 *   - note: comentario per-almuerzo (se guarda en commandaNote por compat)
 *   - price: precio recalculado según el destino
 */
export async function updateKitchenOrder(id, payload) {
  const data = {
    destination: payload.destination === 'llevar' ? 'llevar' : 'mesa',
    price: Number(payload.price) || 0,
    editedAt: serverTimestamp(),
    editedAtClient: getClientTimestamp(),
  }
  if (payload.selections !== undefined) data.selections = payload.selections || null
  if (payload.description !== undefined) data.description = payload.description?.trim() || null
  if (payload.note !== undefined) data.commandaNote = payload.note?.trim() || null
  await updateDoc(orderRef(id), data)
}

/** Marca toda una comanda como pagada antes de tiempo (solo para llevar). */
export async function markCommandaPaid(commandaId, _ids) {
  // Recibe commandaId pero firestore necesita actualizar doc por doc;
  // la UI debe pasar la lista de ids a actualizar.
  if (!Array.isArray(_ids)) return
  await Promise.all(_ids.map(id => updateDoc(orderRef(id), { paid: true })))
}

/**
 * Libera todos los kitchenOrders activos de una openTab — limpia sessionId
 * y cashierUid para que queden "huérfanos" junto con la tab. La cocinera
 * sigue viéndolos en su cola (esa query no filtra por sessionId), pero
 * las burbujas de la nueva cajera no los muestran hasta que se reclamen.
 */
export async function releaseOrdersForTab(tabId) {
  if (!tabId) return
  try {
    const { getDocs } = await import('firebase/firestore')
    const q = query(
      ordersCol(),
      where('tabId', '==', tabId),
      where('status', 'in', ['pending', 'ready']),
    )
    const snap = await getDocs(q)
    await Promise.all(snap.docs.map(d => updateDoc(orderRef(d.id), {
      sessionId: null,
      cashierUid: null,
    })))
  } catch (err) {
    console.warn('[kitchen] releaseOrdersForTab falló:', err?.message || err)
  }
}

/**
 * Reclama todos los kitchenOrders huérfanos de una openTab — asigna sessionId
 * y cashierUid al turno de la nueva cajera. Llamado al heredar tabs del
 * turno anterior.
 */
export async function claimOrdersForTab(tabId, { sessionId, cashierUid }) {
  if (!tabId) return
  try {
    const { getDocs } = await import('firebase/firestore')
    const q = query(
      ordersCol(),
      where('tabId', '==', tabId),
      where('status', 'in', ['pending', 'ready']),
    )
    const snap = await getDocs(q)
    await Promise.all(snap.docs.map(d => updateDoc(orderRef(d.id), {
      sessionId: sessionId || null,
      cashierUid: cashierUid || null,
    })))
  } catch (err) {
    console.warn('[kitchen] claimOrdersForTab falló:', err?.message || err)
  }
}

/**
 * Cancela todos los kitchenOrders activos de una openTab. Llamado cuando
 * el admin decide eliminar mesas pendientes al cerrar un turno (en lugar
 * de pasarlas a la próxima cajera).
 */
export async function cancelOrdersForTab(tabId, { reason, cancelledBy, cancelledByName } = {}) {
  if (!tabId) return
  try {
    const { getDocs } = await import('firebase/firestore')
    const q = query(
      ordersCol(),
      where('tabId', '==', tabId),
      where('status', 'in', ['pending', 'ready']),
    )
    const snap = await getDocs(q)
    await Promise.all(snap.docs.map(d => updateDoc(orderRef(d.id), {
      status: 'cancelled',
      cancelledAt: serverTimestamp(),
      cancelReason: reason?.trim() || 'Mesa eliminada al cerrar turno',
      cancelledBy: cancelledBy || null,
      cancelledByName: cancelledByName?.trim() || null,
    })))
  } catch (err) {
    console.warn('[kitchen] cancelOrdersForTab falló:', err?.message || err)
  }
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

/**
 * Pedidos archivados de un día Bogotá específico (status delivered o cancelled).
 *
 * Por qué un watcher aparte: `watchKitchenQueue` solo trae pending/ready, así
 * que cuando la cajera cobra y el pedido pasa a 'delivered' desaparece de la
 * vista de la cocinera — incluyendo la sección "Archivados". Este watcher
 * trae lo que ya salió de la cola viva para que la cocinera siga viendo el
 * histórico del día (no se "borran").
 *
 * El filtro por día se hace en el cliente (sobre createdAt → Bogotá) porque
 * Firestore no soporta funciones de zona horaria en queries. Para acotar el
 * fetch, traemos un rango UTC un poco más amplio que el día Bogotá.
 *
 * `dateStr`: 'YYYY-MM-DD' en Bogotá.
 */
export function watchKitchenArchivedForDate(dateStr, callback) {
  if (!dateStr) { callback([]); return () => {} }
  try {
    // Bogotá es UTC-5 todo el año. El día Bogotá 2026-05-17 va de
    // 2026-05-17 00:00 -05:00 → 2026-05-18 00:00 -05:00, o sea
    // 2026-05-17 05:00 UTC → 2026-05-18 05:00 UTC.
    const startUtc = new Date(`${dateStr}T05:00:00.000Z`)
    const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000)
    const q = query(
      ordersCol(),
      where('status', 'in', ['delivered', 'cancelled']),
      where('createdAt', '>=', Timestamp.fromDate(startUtc)),
      where('createdAt', '<', Timestamp.fromDate(endUtc)),
    )
    return onSnapshot(
      q,
      snap => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        list.sort((a, b) => timeOf(a) - timeOf(b))
        callback(list)
      },
      err => {
        console.error('[kitchen] watchKitchenArchivedForDate error:', err)
        callback([])
      }
    )
  } catch (err) {
    console.error('[kitchen] watchKitchenArchivedForDate setup failed:', err)
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

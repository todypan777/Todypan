import { firestoreDb } from './firebase'
import {
  doc,
  collection,
  addDoc,
  updateDoc,
  serverTimestamp,
  onSnapshot,
  getDoc,
} from 'firebase/firestore'
import { getClientTimestamp } from './utils/network'

// ──────────────────────────────────────────────────────────────
// customerOrders/{id}
//   Pedido hecho por un cliente en /menu (página pública). Guarda el
//   carrito completo y queda 'pending' hasta que el admin abra el link
//   de confirmación en el WhatsApp y lo despache a cocina.
//
//   Lectura pública (mismos datos que viajan en el WhatsApp).
//   Escritura pública para `create`; update/delete solo admin.
//
//   Shape:
//     status: 'pending' | 'confirmed' | 'cancelled'
//     cart: [{
//       kind: 'corriente' | 'especial',
//       selections?: { soup, principio, protein, side, salad, juice },
//       description?: string,    // solo especial
//       note?: string,           // per-almuerzo
//       price: number,
//     }]
//     total: number
//     createdAt, createdAtClient
//     confirmedBy?, confirmedByName?, confirmedAt?
//     tabId?, orderIds?, customerName?
// ──────────────────────────────────────────────────────────────

const ordersCol = () => collection(firestoreDb, 'customerOrders')
const orderRef = (id) => doc(firestoreDb, 'customerOrders', id)

/** Crea un pedido pendiente de confirmación del admin. Devuelve el id. */
export async function createCustomerOrder({ cart, total }) {
  // Sanitizamos lo que se guarda — solo los campos que necesitamos. Evita
  // que cualquier basura del cliente termine en Firestore.
  const cleanCart = (cart || []).map(it => {
    const out = {
      kind: it.kind === 'especial' ? 'especial' : 'corriente',
      price: Number(it.price) || 0,
    }
    if (it.kind === 'especial') {
      out.description = it.description?.toString().trim() || null
    } else if (it.selections) {
      out.selections = it.selections
    }
    if (it.note) out.note = it.note.toString().trim() || null
    return out
  })

  const data = {
    cart: cleanCart,
    total: Number(total) || 0,
    status: 'pending',
    createdAt: serverTimestamp(),
    createdAtClient: getClientTimestamp(),
  }
  const ref = await addDoc(ordersCol(), data)
  return ref.id
}

/** Suscripción al doc de un pedido. Útil para la pantalla de confirmación. */
export function watchCustomerOrder(id, callback) {
  if (!id) { callback(null); return () => {} }
  try {
    return onSnapshot(
      orderRef(id),
      snap => callback(snap.exists() ? { id: snap.id, ...snap.data() } : null),
      err => {
        console.error('[customerOrders] watch error:', err)
        callback(null)
      }
    )
  } catch (err) {
    console.error('[customerOrders] watch setup failed:', err)
    callback(null)
    return () => {}
  }
}

/** Lectura puntual (fallback offline / SSR-safe). */
export async function getCustomerOrder(id) {
  if (!id) return null
  const snap = await getDoc(orderRef(id))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

/**
 * El admin marca el pedido como confirmado, con referencias al tab y los
 * kitchenOrders creados, y el nombre del cliente que él ingresó.
 */
export async function markCustomerOrderConfirmed(id, {
  confirmedBy, confirmedByName, customerName, tabId, orderIds,
}) {
  await updateDoc(orderRef(id), {
    status: 'confirmed',
    confirmedBy: confirmedBy || null,
    confirmedByName: confirmedByName || null,
    confirmedAt: serverTimestamp(),
    confirmedAtClient: getClientTimestamp(),
    customerName: customerName?.trim() || null,
    tabId: tabId || null,
    orderIds: orderIds || [],
  })
}

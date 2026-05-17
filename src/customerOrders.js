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
//       kind: 'corriente' | 'especial' | 'addon',
//       // -- corriente --
//       selections?: { soup, principio, protein, side, salad, juice },
//       replacements?: { soup?, principio? },
//         // valores: 'huevo' | 'extra_principio' | 'extra_side'
//         //        | 'extra_arroz' | 'extra_salad' | 'extra_juice' | 'nada'
//         // Solo soup y principio aceptan reemplazo (son las únicas que el
//         // wizard del cliente permite omitir). El resto siempre se sirve.
//       // -- especial --
//       description?: string,
//       // -- addon (sopa/huevo/proteína extra) --
//       addonType?: 'soup' | 'egg' | 'protein',
//       proteinId?: string,      // solo si addonType='protein'
//       proteinName?: string,    // solo si addonType='protein'
//       quantity?: number,       // unidades pedidas (>=1)
//       unitPrice?: number,      // precio por unidad
//       // -- comunes --
//       note?: string,           // observaciones del cliente
//       price: number,           // total del item (unitPrice * quantity para addons)
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
  const validAddonTypes = new Set(['soup', 'egg', 'protein'])
  const cleanCart = (cart || []).map(it => {
    let kind = 'corriente'
    if (it.kind === 'especial') kind = 'especial'
    else if (it.kind === 'addon' && validAddonTypes.has(it.addonType)) kind = 'addon'
    const out = {
      kind,
      price: Number(it.price) || 0,
    }
    if (kind === 'especial') {
      // Nuevo modelo: el especial tiene selections (soup, especial, salad)
      // + replacements (solo soup). description legacy se mantiene si llega.
      if (it.selections) {
        out.selections = it.selections
        // Replacements del especial: solo soup admite (mismas llaves que corriente
        // pero el cliente solo verá huevo/extra_arroz/extra_salad/nada en el wizard).
        const validReps = new Set([
          'huevo', 'extra_principio', 'extra_side',
          'extra_arroz', 'extra_salad', 'extra_juice', 'nada',
        ])
        const reps = {}
        if (validReps.has(it.replacements?.soup)) reps.soup = it.replacements.soup
        if (Object.keys(reps).length > 0) out.replacements = reps
      }
      // Backward-compat: si solo viene description (cliente con app vieja),
      // la guardamos también.
      if (it.description) out.description = it.description.toString().trim() || null
    } else if (kind === 'addon') {
      out.addonType = it.addonType
      out.quantity = Math.max(1, Math.floor(Number(it.quantity) || 1))
      out.unitPrice = Number(it.unitPrice) || 0
      if (it.addonType === 'protein') {
        out.proteinId = it.proteinId || null
        out.proteinName = it.proteinName?.toString().trim() || null
      }
    } else if (it.selections) {
      out.selections = it.selections
      // replacements: solo soup/principio. Sanitizar a llaves conocidas.
      const validReps = new Set([
        'huevo', 'extra_principio', 'extra_side',
        'extra_arroz', 'extra_salad', 'extra_juice', 'nada',
      ])
      const reps = {}
      if (validReps.has(it.replacements?.soup)) reps.soup = it.replacements.soup
      if (validReps.has(it.replacements?.principio)) reps.principio = it.replacements.principio
      if (Object.keys(reps).length > 0) out.replacements = reps
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

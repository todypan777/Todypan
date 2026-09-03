import { firestoreDb } from './firebase'
import {
  doc,
  collection,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  query,
  where,
  onSnapshot,
} from 'firebase/firestore'
import { updateProduct, deleteProduct } from './db'
import { addDocOffline } from './utils/firestoreOffline'

/**
 * Solicitudes de cambio en productos pedidas por cajeras.
 * El admin las aprueba (aplica los cambios al producto real) o rechaza.
 *
 * Doc shape en /productChangeRequests/{id}:
 *   - productId
 *   - source: 'admin' | 'cashier'  (qué catálogo es el producto)
 *   - kind: 'edit' | 'delete'  (default 'edit')
 *   - currentName / requestedName
 *   - currentPricesByBranch / requestedPricesByBranch
 *   - currentFreeAmount / requestedFreeAmount    (venta libre on/off)
 *   - currentFreeUnitPrice / requestedFreeUnitPrice  (valor base venta libre)
 *   - cashierUid / cashierName
 *   - branchId / branchName  (panadería desde donde se pidió)
 *   - reason (opcional, texto)
 *   - status: 'pending' | 'approved' | 'rejected'
 *   - createdAt, reviewedBy, reviewedAt, reviewNote
 *
 * Regla de negocio: solo puede haber UNA solicitud pendiente por producto.
 */

const reqCol = () => collection(firestoreDb, 'productChangeRequests')
const reqRef = (id) => doc(firestoreDb, 'productChangeRequests', id)

/** Suscripción a las solicitudes pendientes de las panaderías del usuario. */
export function watchPendingChangeRequests(callback, branchIds = null) {
  // Acotada por panaderia: alimenta la campana de notificaciones. Sin el
  // filtro un dueño ve las peticiones de cambio de precio del otro.
  //
  // Ojo: las peticiones viejas pueden traer `branchId: null` (se guarda con
  // `?? null`) y esas quedan fuera del filtro. Es lo mismo que hace el resto
  // de la app con los datos sin sede, y es preferible a enseñarlas a los dos.
  //
  // Dos igualdades: no necesita indice compuesto.
  const parts = [where('status', '==', 'pending')]
  if (Array.isArray(branchIds) && branchIds.length > 0) {
    parts.push(where('branchId', 'in', branchIds))
  }
  const q = query(reqCol(), ...parts)
  return onSnapshot(
    q,
    snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      list.sort((a, b) => {
        const ta = a.createdAt?.toMillis?.() ?? 0
        const tb = b.createdAt?.toMillis?.() ?? 0
        return tb - ta
      })
      callback(list)
    },
    err => {
      console.error('[changeReq] watchPendingChangeRequests error:', err)
      callback([])
    }
  )
}

/**
 * Suscripción a las solicitudes pendientes de un producto específico
 * (para validar que la cajera no mande otra mientras hay una pendiente).
 */
export function watchPendingChangeRequestForProduct(productId, callback) {
  if (!productId) { callback(null); return () => {} }
  const q = query(
    reqCol(),
    where('productId', '==', productId),
    where('status', '==', 'pending'),
  )
  return onSnapshot(
    q,
    snap => {
      if (snap.docs.length === 0) callback(null)
      else callback({ id: snap.docs[0].id, ...snap.docs[0].data() })
    },
    err => {
      console.error('[changeReq] watchPendingChangeRequestForProduct error:', err)
      callback(null)
    }
  )
}

/**
 * Crea una solicitud de cambio. La UI debe haber validado que no exista
 * otra pendiente para el mismo producto.
 */
export function createChangeRequest({
  productId, source, kind,
  currentName, requestedName,
  currentPricesByBranch, requestedPricesByBranch,
  currentFreeAmount, requestedFreeAmount,
  currentFreeUnitPrice, requestedFreeUnitPrice,
  cashierUid, cashierName,
  branchId, branchName,
  reason,
}) {
  const data = {
    productId,
    source: source || 'admin',
    kind: kind === 'delete' ? 'delete' : 'edit',
    currentName: currentName || '',
    requestedName: (requestedName || '').trim(),
    currentPricesByBranch: currentPricesByBranch || {},
    requestedPricesByBranch: requestedPricesByBranch || {},
    currentFreeAmount: !!currentFreeAmount,
    requestedFreeAmount: !!requestedFreeAmount,
    currentFreeUnitPrice: Number(currentFreeUnitPrice) || 0,
    requestedFreeUnitPrice: Number(requestedFreeUnitPrice) || 0,
    cashierUid: cashierUid || null,
    cashierName: cashierName || null,
    branchId: branchId ?? null,
    branchName: branchName || null,
    reason: (reason || '').trim() || null,
    status: 'pending',
    createdAt: serverTimestamp(),
  }
  // Fire-and-forget: la cajera la envía en modo ahorro; `await addDoc` se
  // colgaba y dejaba el modal "Reportar cambio" atrapado en "Enviando...".
  const ref = addDocOffline(reqCol(), data)
  return ref.id
}

/**
 * Aprueba una solicitud: aplica los cambios al producto real y marca la
 * solicitud como 'approved'. La función decide si es producto admin o cashier
 * basándose en source.
 *
 * Para producto cashier (Firestore /products/{id}), recibe la función updater
 * via dependency injection para no acoplar este archivo a Firestore products.
 */
export async function approveChangeRequest(req, { adminUid, updateCashierProduct, deleteCashierProduct }) {
  if (!req || req.status !== 'pending') return

  if (req.kind === 'delete') {
    // Eliminar el producto del catálogo correspondiente.
    if (req.source === 'admin') {
      deleteProduct(req.productId)
    } else if (req.source === 'cashier' && typeof deleteCashierProduct === 'function') {
      await deleteCashierProduct(req.productId)
    }
  } else {
    // Edición: aplicar nombre, venta libre / valor base y precios.
    const requestedFree = !!req.requestedFreeAmount
    const updates = {
      name: req.requestedName,
      freeAmount: requestedFree,
      // En venta libre los precios por panadería no aplican; se limpian.
      pricesByBranch: requestedFree ? {} : (req.requestedPricesByBranch || {}),
      freeUnitPrice: requestedFree ? (Number(req.requestedFreeUnitPrice) || 0) : 0,
    }
    if (requestedFree) {
      // Alinear con la forma de un producto de venta libre (sin costo/paquete).
      updates.byPackage = false
      updates.packageCost = 0
      updates.unitsPerPackage = 1
    }
    if (req.source === 'admin') {
      updateProduct(req.productId, updates)
    } else if (req.source === 'cashier' && typeof updateCashierProduct === 'function') {
      await updateCashierProduct(req.productId, updates)
    }
  }

  await updateDoc(reqRef(req.id), {
    status: 'approved',
    reviewedBy: adminUid || null,
    reviewedAt: serverTimestamp(),
  })
}

export async function rejectChangeRequest(reqId, { adminUid, reviewNote }) {
  await updateDoc(reqRef(reqId), {
    status: 'rejected',
    reviewedBy: adminUid || null,
    reviewedAt: serverTimestamp(),
    reviewNote: (reviewNote || '').trim() || null,
  })
}

/** Borrar definitivamente una solicitud (admin, limpieza). */
export async function deleteChangeRequest(reqId) {
  await deleteDoc(reqRef(reqId))
}

import { firestoreDb } from './firebase'
import {
  doc,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  query,
  where,
  onSnapshot,
} from 'firebase/firestore'
import { updateProduct } from './db'

/**
 * Solicitudes de cambio en productos pedidas por cajeras.
 * El admin las aprueba (aplica los cambios al producto real) o rechaza.
 *
 * Doc shape en /productChangeRequests/{id}:
 *   - productId
 *   - source: 'admin' | 'cashier'  (qué catálogo es el producto)
 *   - currentName / requestedName
 *   - currentPricesByBranch / requestedPricesByBranch
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

/** Suscripción a TODAS las solicitudes pendientes (vista admin). */
export function watchPendingChangeRequests(callback) {
  const q = query(reqCol(), where('status', '==', 'pending'))
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
export async function createChangeRequest({
  productId, source,
  currentName, requestedName,
  currentPricesByBranch, requestedPricesByBranch,
  cashierUid, cashierName,
  branchId, branchName,
  reason,
}) {
  const data = {
    productId,
    source: source || 'admin',
    currentName: currentName || '',
    requestedName: (requestedName || '').trim(),
    currentPricesByBranch: currentPricesByBranch || {},
    requestedPricesByBranch: requestedPricesByBranch || {},
    cashierUid: cashierUid || null,
    cashierName: cashierName || null,
    branchId: branchId ?? null,
    branchName: branchName || null,
    reason: (reason || '').trim() || null,
    status: 'pending',
    createdAt: serverTimestamp(),
  }
  const ref = await addDoc(reqCol(), data)
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
export async function approveChangeRequest(req, { adminUid, updateCashierProduct }) {
  if (!req || req.status !== 'pending') return
  const updates = {
    name: req.requestedName,
    pricesByBranch: req.requestedPricesByBranch || {},
  }
  if (req.source === 'admin') {
    updateProduct(req.productId, updates)
  } else if (req.source === 'cashier') {
    if (typeof updateCashierProduct === 'function') {
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

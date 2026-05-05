import { firestoreDb } from './firebase'
import {
  doc,
  getDoc,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  query,
  onSnapshot,
} from 'firebase/firestore'

const productsCol = () => collection(firestoreDb, 'products')

/**
 * Suscripción al catálogo de productos creados por cajeras.
 * Estos viven en /products/{id} (separado de los productos legacy del
 * admin que están en /todypan/data.products).
 */
export function watchCashierProducts(callback) {
  const q = query(productsCol())
  return onSnapshot(
    q,
    snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => {
      console.error('[products] watchCashierProducts error:', err)
      callback([])
    }
  )
}

/**
 * Crea un producto al vuelo desde el POS de una cajera. Solo conoce el precio
 * de SU panadería, así que se guarda como pricesByBranch[branchId] = price.
 * Otras cajeras en otra panadería verán el producto sin precio y se les pedirá
 * el suyo la primera vez.
 */
export async function createCashierProduct({ name, salePrice, branchId, createdByUid, createdByName }) {
  const key = String(branchId)
  const data = {
    name: name.trim(),
    normalizedName: name.trim().toLowerCase(),
    pricesByBranch: { [key]: Number(salePrice) || 0 },
    packageCost: 0,           // sin costo aún — admin lo completa
    byPackage: false,
    branch: 'both',           // disponible en cualquier panadería que tenga precio
    createdByCashier: true,
    needsCostReview: true,
    createdByUid: createdByUid || null,
    createdByName: createdByName || null,
    createdAt: serverTimestamp(),
  }
  const ref = await addDoc(productsCol(), data)
  return ref.id
}

/** Solo admin: elimina un producto creado por cajera (rechazo definitivo). */
export async function deleteCashierProduct(id) {
  await deleteDoc(doc(firestoreDb, 'products', id))
}

/** Solo admin: actualiza precio/costo de un producto cajera. */
export async function updateCashierProduct(id, updates) {
  const clean = { ...updates }
  delete clean.salePrice  // bloquear campo legacy
  await updateDoc(doc(firestoreDb, 'products', id), {
    ...clean,
    needsCostReview: false,  // ya fue revisado
    reviewedAt: serverTimestamp(),
  })
}

/**
 * Actualización liviana de un producto cajera SIN tocar needsCostReview
 * (para aplicar solicitudes de cambio aprobadas, donde el costo no cambió).
 */
export async function patchCashierProduct(id, updates) {
  const clean = { ...updates }
  delete clean.salePrice
  await updateDoc(doc(firestoreDb, 'products', id), clean)
}

/**
 * Establece el precio de un producto cajera para una panadería específica.
 * Lee el doc, modifica el mapa y lo guarda. Si price es 0/null elimina la entrada.
 */
export async function setCashierProductPriceForBranch(id, branchId, price) {
  const ref = doc(firestoreDb, 'products', id)
  const snap = await getDoc(ref)
  if (!snap.exists()) return
  const data = snap.data() || {}
  const key = String(branchId)
  const next = { ...(data.pricesByBranch || {}) }
  const num = Number(price)
  if (!num || num <= 0) {
    delete next[key]
  } else {
    next[key] = num
  }
  await updateDoc(ref, { pricesByBranch: next })
}

/** Devuelve el precio de un producto en una panadería, o null si no está. */
export function getProductPrice(product, branchId) {
  if (!product) return null
  const key = String(branchId)
  const v = product.pricesByBranch?.[key]
  return v && Number(v) > 0 ? Number(v) : null
}

/** True si el producto tiene precio definido para esa panadería. */
export function hasProductPrice(product, branchId) {
  return getProductPrice(product, branchId) !== null
}

/**
 * Une el catálogo legacy del admin (en /todypan/data.products) con los
 * productos creados por cajeras (en /products/{id}). Devuelve una lista
 * unificada con shape consistente para el buscador.
 *
 * Cada item incluye `pricesByBranch` para que el POS pueda decidir si el
 * producto tiene precio en la panadería activa o si toca preguntarlo.
 */
export function mergeProductCatalogs(adminProducts = [], cashierProducts = []) {
  const adminList = adminProducts.map(p => ({
    id: p.id,
    source: 'admin',
    name: p.name,
    pricesByBranch: p.pricesByBranch || {},
    branch: p.branch,
    createdByCashier: false,
    needsCostReview: false,
  }))
  const cashierList = cashierProducts.map(p => ({
    id: p.id,
    source: 'cashier',
    name: p.name,
    pricesByBranch: p.pricesByBranch || {},
    branch: p.branch || 'both',
    createdByCashier: true,
    needsCostReview: !!p.needsCostReview,
  }))
  // Si hay un producto admin con el mismo nombre que uno cajera, prioridad al admin
  const adminNames = new Set(adminList.map(p => p.name.toLowerCase()))
  const dedupedCashier = cashierList.filter(p => !adminNames.has(p.name.toLowerCase()))
  return [...adminList, ...dedupedCashier].sort((a, b) =>
    a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })
  )
}

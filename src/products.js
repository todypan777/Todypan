import { firestoreDb } from './firebase'
import {
  doc,
  collection,
  addDoc,
  updateDoc,
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
 * Crea un producto al vuelo (al hacer una venta) con el precio que la cajera
 * digitó. Queda flagged needsCostReview: true para que el admin lo complete.
 */
export async function createCashierProduct({ name, salePrice, createdByUid, createdByName }) {
  const data = {
    name: name.trim(),
    normalizedName: name.trim().toLowerCase(),
    salePrice: Number(salePrice) || 0,
    packageCost: 0,           // sin costo aún — admin lo completa
    byPackage: false,
    branch: 'both',           // por defecto
    createdByCashier: true,
    needsCostReview: true,
    createdByUid: createdByUid || null,
    createdByName: createdByName || null,
    createdAt: serverTimestamp(),
  }
  const ref = await addDoc(productsCol(), data)
  return ref.id
}

/**
 * Une el catálogo legacy del admin (en /todypan/data.products) con los
 * productos creados por cajeras (en /products/{id}). Devuelve una lista
 * unificada con shape consistente para el buscador.
 */
export function mergeProductCatalogs(adminProducts = [], cashierProducts = []) {
  const adminList = adminProducts.map(p => ({
    id: p.id,
    source: 'admin',
    name: p.name,
    salePrice: Number(p.salePrice) || 0,
    branch: p.branch,
    createdByCashier: false,
    needsCostReview: false,
  }))
  const cashierList = cashierProducts.map(p => ({
    id: p.id,
    source: 'cashier',
    name: p.name,
    salePrice: Number(p.salePrice) || 0,
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

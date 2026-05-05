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

/**
 * Mesas abiertas (open tabs) — carrito persistente que la cajera deja como
 * "burbuja" para seguir agregando productos antes de cobrar.
 *
 * Doc shape en /openTabs/{id}:
 *   - sessionId: id de la cashSession activa de la cajera
 *   - cashierUid: uid del cajero dueño
 *   - branchId / branchName
 *   - tableNumber: número visible (1, 2, 3…) único por (sessionId, cashierUid)
 *   - items: [{ key, productId, source, name, qty, unitPrice }]
 *   - total: suma de qty * unitPrice
 *   - createdAt / updatedAt: timestamps
 *
 * Las tabs viven mientras dure la sesión. Al cerrar turno DEBEN estar todas
 * cobradas o eliminadas (validación en CloseTurnModal).
 */

const tabsCol = () => collection(firestoreDb, 'openTabs')
const tabRef = (id) => doc(firestoreDb, 'openTabs', id)

/** Suscripción a las tabs abiertas de una sesión específica. */
export function watchOpenTabsForSession(sessionId, callback) {
  if (!sessionId) { callback([]); return () => {} }
  const q = query(tabsCol(), where('sessionId', '==', sessionId))
  return onSnapshot(
    q,
    snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      // Orden estable: por número de mesa ascendente
      list.sort((a, b) => (a.tableNumber || 0) - (b.tableNumber || 0))
      callback(list)
    },
    err => {
      console.error('[openTabs] watchOpenTabsForSession error:', err)
      callback([])
    }
  )
}

/** Calcula total de una lista de items. */
export function computeTabTotal(items) {
  return (items || []).reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0)
}

/** Calcula el siguiente número libre en una lista de tabs. */
export function nextFreeTableNumber(tabs) {
  const used = new Set((tabs || []).map(t => Number(t.tableNumber)).filter(n => n > 0))
  let n = 1
  while (used.has(n)) n++
  return n
}

/** True si el número está usado por OTRA tab (excluye una opcional). */
export function isTableNumberTaken(tabs, number, excludeId = null) {
  const num = Number(number)
  return (tabs || []).some(t => t.id !== excludeId && Number(t.tableNumber) === num)
}

/**
 * Crea una nueva tab con items iniciales. tableNumber se valida contra
 * duplicados (la UI debe haber resuelto eso antes).
 */
export async function createOpenTab({
  sessionId, cashierUid, branchId, branchName,
  tableNumber, items,
}) {
  const cleanItems = (items || []).map(it => ({
    key: it.key,
    productId: it.productId || null,
    source: it.source || 'inline',
    name: it.name,
    qty: Number(it.qty) || 0,
    unitPrice: Number(it.unitPrice) || 0,
  }))
  const data = {
    sessionId,
    cashierUid,
    branchId: branchId ?? null,
    branchName: branchName || null,
    tableNumber: Number(tableNumber) || 1,
    items: cleanItems,
    total: computeTabTotal(cleanItems),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }
  const ref = await addDoc(tabsCol(), data)
  return ref.id
}

/**
 * Actualiza una tab existente. Permite cambiar items y/o número.
 * (La UI valida número duplicado antes de llamar.)
 */
export async function updateOpenTab(id, { items, tableNumber }) {
  const updates = { updatedAt: serverTimestamp() }
  if (Array.isArray(items)) {
    const cleanItems = items.map(it => ({
      key: it.key,
      productId: it.productId || null,
      source: it.source || 'inline',
      name: it.name,
      qty: Number(it.qty) || 0,
      unitPrice: Number(it.unitPrice) || 0,
    }))
    updates.items = cleanItems
    updates.total = computeTabTotal(cleanItems)
  }
  if (tableNumber != null) {
    updates.tableNumber = Number(tableNumber) || 1
  }
  await updateDoc(tabRef(id), updates)
}

/** Elimina una tab (al cobrar o al eliminarla manualmente). */
export async function deleteOpenTab(id) {
  await deleteDoc(tabRef(id))
}

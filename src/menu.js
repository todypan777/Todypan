import { firestoreDb } from './firebase'
import {
  doc,
  collection,
  addDoc,
  setDoc,
  updateDoc,
  getDoc,
  serverTimestamp,
  query,
  where,
  onSnapshot,
  deleteField,
} from 'firebase/firestore'
import { getClientTimestamp } from './utils/network'

// ──────────────────────────────────────────────────────────────────────────
// Sistema de menú de almuerzos.
//
// menuItems/{id}        → catálogo permanente que la cocinera arma con el tiempo.
//   category: 'soup' | 'principio' | 'protein' | 'side' | 'salad' | 'juice'
//   name, archived, createdAt, createdBy
//
// dailyMenu/{YYYY-MM-DD} → estado del menú para una fecha específica.
//   itemsByCategory: { soup: [menuItemId], principio: [menuItemId], ... }
//     Para soup/protein/juice: la cocinera puede activar varias.
//     Para principio/side/salad: solo UNA activa por dia (defecto pre-seleccionado).
//   special: { active: bool, priceMesa, priceLlevar }
//     Si active=true, hoy se vende "Almuerzo especial" sin categorias.
//   publishedAt, publishedBy, publishedByName
//
// Las 6 categorías son fijas. Los IDs se mantienen estables para la UI.
// ──────────────────────────────────────────────────────────────────────────

export const CATEGORIES = [
  { id: 'soup',      label: 'Sopa',         multi: true,  required: true,  emoji: '🥣' },
  { id: 'principio', label: 'Principio',    multi: false, required: false, emoji: '🫘' },
  { id: 'protein',   label: 'Proteína',     multi: true,  required: true,  emoji: '🍗' },
  { id: 'side',      label: 'Acompañante',  multi: false, required: false, emoji: '🍚' },
  { id: 'salad',     label: 'Ensalada',     multi: false, required: false, emoji: '🥗' },
  { id: 'juice',     label: 'Jugo',         multi: true,  required: true,  emoji: '🥤' },
]

export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map(c => [c.id, c]))
export const CATEGORY_IDS = CATEGORIES.map(c => c.id)

const menuItemsCol = () => collection(firestoreDb, 'menuItems')
const menuItemRef = (id) => doc(firestoreDb, 'menuItems', id)
const dailyMenuRef = (dateStr) => doc(firestoreDb, 'dailyMenu', dateStr)

// ─── menuItems (catálogo permanente) ──────────────────────────────

/** Suscripción a TODOS los items del catálogo (cocinera y admin). */
export function watchMenuItems(callback) {
  const q = query(menuItemsCol())
  return onSnapshot(
    q,
    snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      list.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      callback(list)
    },
    err => {
      console.error('[menu] watchMenuItems error:', err)
      callback([])
    }
  )
}

export async function createMenuItem({ category, name, createdBy, createdByName }) {
  if (!CATEGORY_BY_ID[category]) throw new Error('Categoría inválida')
  const data = {
    category,
    name: (name || '').trim(),
    archived: false,
    createdAt: serverTimestamp(),
    createdAtClient: getClientTimestamp(),
    createdBy: createdBy || null,
    createdByName: createdByName || null,
  }
  const ref = await addDoc(menuItemsCol(), data)
  return ref.id
}

export async function renameMenuItem(id, name) {
  await updateDoc(menuItemRef(id), { name: (name || '').trim() })
}

/** Archiva (oculta del catálogo activo sin borrar). */
export async function archiveMenuItem(id) {
  await updateDoc(menuItemRef(id), { archived: true })
}

export async function unarchiveMenuItem(id) {
  await updateDoc(menuItemRef(id), { archived: false })
}

// ─── dailyMenu (qué hay hoy) ──────────────────────────────────────

/** Suscripción al menú de una fecha específica. */
export function watchDailyMenu(dateStr, callback) {
  if (!dateStr) { callback(null); return () => {} }
  return onSnapshot(
    dailyMenuRef(dateStr),
    snap => callback(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    err => {
      // Mantener último valor en error transitorio (offline-friendly).
      console.error('[menu] watchDailyMenu error (manteniendo último valor):', err?.message || err)
    }
  )
}

/**
 * Toggle de un item en una categoría del menú de hoy.
 * Para categorías 'multi' (soup/protein/juice): agrega o quita del array.
 * Para categorías de UNA opción (principio/side/salad): reemplaza.
 *
 * action: 'add' | 'remove' | 'set'
 *   - 'add' / 'remove' aplican a multi
 *   - 'set' reemplaza el array entero (para no-multi: array de 0 o 1 elementos)
 */
export async function setDailyMenuItem(dateStr, category, itemIds, { publishedBy, publishedByName } = {}) {
  if (!CATEGORY_BY_ID[category]) throw new Error('Categoría inválida')
  const ids = (itemIds || []).filter(Boolean)
  const ref = dailyMenuRef(dateStr)
  // setDoc con merge NO interpreta dot-notation como path anidado: trataría
  // "itemsByCategory.protein" como nombre literal del campo. Para eso usamos
  // updateDoc, pero updateDoc falla si el doc no existe — así que primero
  // garantizamos que el doc exista con setDoc (merge), luego updateamos con
  // dot-notation real.
  const snap = await getDoc(ref)
  if (!snap.exists()) {
    await setDoc(ref, {
      date: dateStr,
      itemsByCategory: { [category]: ids },
      publishedAt: serverTimestamp(),
      publishedAtClient: getClientTimestamp(),
      publishedBy: publishedBy || null,
      publishedByName: publishedByName || null,
    })
  } else {
    await updateDoc(ref, {
      date: dateStr,
      [`itemsByCategory.${category}`]: ids,
      publishedAt: serverTimestamp(),
      publishedAtClient: getClientTimestamp(),
      publishedBy: publishedBy || null,
      publishedByName: publishedByName || null,
    })
  }
}

/**
 * Activa o desactiva el "Almuerzo especial" del día con su precio.
 * config: { active, priceMesa, priceLlevar, description? }
 */
export async function setDailySpecial(dateStr, config, { publishedBy, publishedByName } = {}) {
  const payload = {
    date: dateStr,
    publishedAt: serverTimestamp(),
    publishedAtClient: getClientTimestamp(),
    publishedBy: publishedBy || null,
    publishedByName: publishedByName || null,
  }
  if (config && config.active) {
    payload.special = {
      active: true,
      priceMesa: Number(config.priceMesa) || 0,
      priceLlevar: Number(config.priceLlevar) || 0,
      description: config.description?.trim() || null,
    }
  } else {
    payload.special = { active: false }
  }
  await setDoc(dailyMenuRef(dateStr), payload, { merge: true })
}

/**
 * Helpers para construir la vista del menú de hoy con los datos completos
 * (no solo IDs).
 *
 * Devuelve: { soup: [{id, name}], principio: [{id, name}], ... }
 */
export function resolveDailyMenu(dailyMenu, allMenuItems) {
  const out = {}
  for (const cat of CATEGORY_IDS) {
    const ids = dailyMenu?.itemsByCategory?.[cat] || []
    out[cat] = ids
      .map(id => allMenuItems.find(m => m.id === id))
      .filter(m => m && !m.archived)
  }
  return out
}

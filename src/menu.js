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

// Categorías del menú del corriente.
//   multi: true  → la cocinera publica varias opciones; la cajera escoge UNA al pedir.
//   multi: false → categoría fija (1 sola opción que define la cocinera).
//                  En el modal de la cajera viene pre-seleccionada con opción de
//                  quitarla. Si la quita, a cocina le llega "SIN [X]" en grande.
//                  Solo aplica a 'side' (Acompañante = Arroz blanco).
//
// required: si la cocinera no la activa, el corriente no está disponible
// (sopa, proteína y jugo son obligatorias para considerar válido el menú).
export const CATEGORIES = [
  { id: 'soup',      label: 'Sopa',         multi: true,  required: true,  emoji: '🥣' },
  { id: 'principio', label: 'Principio',    multi: true,  required: false, emoji: '🫘' },
  { id: 'protein',   label: 'Proteína',     multi: true,  required: true,  emoji: '🍗' },
  { id: 'side',      label: 'Acompañante',  multi: false, required: false, emoji: '🍚' },
  { id: 'salad',     label: 'Ensalada',     multi: true,  required: false, emoji: '🥗' },
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
  try {
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
  } catch (err) {
    console.error('[menu] watchMenuItems setup failed:', err)
    callback([])
    return () => {}
  }
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
  try {
    return onSnapshot(
      dailyMenuRef(dateStr),
      snap => callback(snap.exists() ? { id: snap.id, ...snap.data() } : null),
      err => {
        // Mantener último valor en error transitorio (offline-friendly).
        console.error('[menu] watchDailyMenu error (manteniendo último valor):', err?.message || err)
      }
    )
  } catch (err) {
    console.error('[menu] watchDailyMenu setup failed:', err)
    return () => {}
  }
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
 * Define los precios del "Almuerzo Corriente" del día.
 * config: { priceMesa, priceLlevar }
 *
 * El corriente NO tiene flag 'active' explícito: se considera disponible para
 * la cajera cuando priceMesa > 0 Y hay opciones suficientes en el menú del día
 * (ver getCorrienteState).
 */
export async function setDailyCorriente(dateStr, config, { publishedBy, publishedByName } = {}) {
  const ref = dailyMenuRef(dateStr)
  const snap = await getDoc(ref)
  const corrientePayload = {
    priceMesa: Number(config?.priceMesa) || 0,
    priceLlevar: Number(config?.priceLlevar) || 0,
  }
  if (!snap.exists()) {
    await setDoc(ref, {
      date: dateStr,
      corriente: corrientePayload,
      publishedAt: serverTimestamp(),
      publishedAtClient: getClientTimestamp(),
      publishedBy: publishedBy || null,
      publishedByName: publishedByName || null,
    })
  } else {
    await updateDoc(ref, {
      date: dateStr,
      corriente: corrientePayload,
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

// Categorías OBLIGATORIAS para que el corriente esté disponible.
// (principio/side/salad son fijos por la cocinera, no requeridos para activar.)
const REQUIRED_FOR_CORRIENTE = ['soup', 'protein', 'juice']

/**
 * Estado del Almuerzo Corriente para una fecha:
 *   - available: bool — true si la cajera lo puede vender hoy
 *   - priceMesa, priceLlevar: precios definidos (o 0)
 *   - missingPrice: bool — la cocinera no ha puesto precio
 *   - missingCategories: [labels] — categorías obligatorias sin opciones
 *
 * Resuelve también con el catálogo (para descartar ítems archivados).
 */
export function getCorrienteState(dailyMenu, allMenuItems) {
  const priceMesa = Number(dailyMenu?.corriente?.priceMesa) || 0
  const priceLlevar = Number(dailyMenu?.corriente?.priceLlevar) || 0
  const missingPrice = priceMesa <= 0
  const resolved = resolveDailyMenu(dailyMenu, allMenuItems)
  const missingCategories = REQUIRED_FOR_CORRIENTE
    .filter(cat => (resolved[cat] || []).length === 0)
    .map(cat => CATEGORY_BY_ID[cat]?.label || cat)
  const available = !missingPrice && missingCategories.length === 0
  return {
    available,
    priceMesa,
    priceLlevar: priceLlevar > 0 ? priceLlevar : priceMesa,
    missingPrice,
    missingCategories,
  }
}

/**
 * Copia el menú COMPLETO de una fecha a otra. Usado por el botón "Copiar lo
 * de ayer" en la cocinera. Solo copia campos relevantes (precios + opciones +
 * estado del especial); NO copia los timestamps.
 */
export async function copyMenuFromDate(fromDateStr, toDateStr, { publishedBy, publishedByName } = {}) {
  if (!fromDateStr || !toDateStr || fromDateStr === toDateStr) return false
  const fromSnap = await getDoc(dailyMenuRef(fromDateStr))
  if (!fromSnap.exists()) return false
  const src = fromSnap.data() || {}

  const payload = {
    date: toDateStr,
    publishedAt: serverTimestamp(),
    publishedAtClient: getClientTimestamp(),
    publishedBy: publishedBy || null,
    publishedByName: publishedByName || null,
  }
  if (src.itemsByCategory) payload.itemsByCategory = src.itemsByCategory
  if (src.corriente) payload.corriente = src.corriente
  if (src.special) payload.special = src.special

  await setDoc(dailyMenuRef(toDateStr), payload, { merge: true })
  return true
}

/**
 * Devuelve la fecha (YYYY-MM-DD) del día anterior a una dada.
 * Trabaja en strings para evitar issues de zona horaria.
 */
export function previousDateStr(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

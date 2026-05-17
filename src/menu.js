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
//   multi: true  → la cocinera publica varias opciones; la cajera escoge al pedir.
//   multi: false → categoría fija (1 sola opción que define la cocinera).
//                  En el modal de la cajera viene pre-seleccionada con opción de
//                  quitarla. Si la quita, a cocina le llega "SIN [X]" en grande.
//                  Solo aplica a 'side' (Acompañante = Arroz blanco).
//
// required: la cajera DEBE elegir al menos una opción al pedir un almuerzo
// (sopa y proteína son obligatorias para considerar el almuerzo completo).
//
// maxSelections: cuántas opciones puede acumular la cajera en un mismo plato.
//   Solo 'principio' permite 2 (caso "mixto" — mitad pasta, mitad frijol).
//
// alwaysServed: si la cajera deja la categoría VACÍA (null), a cocina le llega
//   "SIN [X]" como alerta visual. Si está seleccionada, la cocina la oculta
//   porque ya sabe que va por defecto. Aplica a side/salad/juice.
export const CATEGORIES = [
  // Sopa: multi:true permite a la cocinera publicar varias opciones del día.
  // El cliente escoge UNA (maxSelections:1, sin mixto).
  { id: 'soup',      label: 'Sopa',         multi: true,  required: true,  maxSelections: 1, emoji: '🥣' },
  { id: 'principio', label: 'Principio',    multi: true,  required: false, maxSelections: 2, emoji: '🫘' },
  { id: 'protein',   label: 'Proteína',     multi: true,  required: true,  maxSelections: 1, emoji: '🍗' },
  { id: 'side',      label: 'Acompañante',  multi: false, required: false, maxSelections: 1, alwaysServed: true, emoji: '🍚' },
  { id: 'salad',     label: 'Ensalada',     multi: false, required: false, maxSelections: 1, alwaysServed: true, emoji: '🥗' },
  { id: 'juice',     label: 'Jugo',         multi: false, required: false, maxSelections: 1, alwaysServed: true, emoji: '🥤' },
  // Almuerzo Especial: el plato fuerte (arroz con pollo, costillas…).
  // forSpecial:true significa que NO es parte del corriente — vive en su
  // propio flujo. El especial tiene 3 categorías: soup (compartida con
  // corriente), especial (esta) y salad (compartida).
  // Por ahora maxSelections:1 (1 plato especial por día) pero la estructura
  // soporta varios en el futuro cambiando ese número.
  { id: 'especial',  label: 'Almuerzo Especial', multi: true,  required: true,  maxSelections: 1, emoji: '⭐', forSpecial: true },
]

export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map(c => [c.id, c]))
export const CATEGORY_IDS = CATEGORIES.map(c => c.id)

// Categorías SOLO del corriente (sin las marcadas forSpecial). Usar en los
// flujos del corriente para no mostrar 'especial' como una más.
export const CORRIENTE_CATEGORIES = CATEGORIES.filter(c => !c.forSpecial)
export const CORRIENTE_CATEGORY_IDS = CORRIENTE_CATEGORIES.map(c => c.id)

// Categorías del ESPECIAL: sopa (compartida), especial (propia), ensalada
// (compartida). Si la cocinera publica sopa/ensalada para el corriente,
// esas MISMAS opciones se ofrecen al cliente que pide el especial — no se
// duplica nada en el menú del día.
export const SPECIAL_CATEGORIES = [
  CATEGORY_BY_ID.soup,
  CATEGORY_BY_ID.especial,
  CATEGORY_BY_ID.salad,
]
export const SPECIAL_CATEGORY_IDS = ['soup', 'especial', 'salad']

const menuItemsCol = () => collection(firestoreDb, 'menuItems')
const menuItemRef = (id) => doc(firestoreDb, 'menuItems', id)
const dailyMenuRef = (dateStr) => doc(firestoreDb, 'dailyMenu', dateStr)

// Doc FIJO (no por día) que guarda los precios persistentes del Almuerzo
// Corriente. Usa la misma colección `dailyMenu` para reusar permisos de
// lectura/escritura. El docId tiene formato no-fecha para no chocar con los
// `YYYY-MM-DD`.
//
// IMPORTANTE: Firestore reserva los IDs que matchean __.*__ (doble guión
// bajo al inicio Y al final). El ID original `__corriente_config__` era
// inválido y rompía save/read con "Resource id is invalid because it is
// reserved". Por eso ahora usamos guiones simples.
const CORRIENTE_CONFIG_ID = 'corriente_config'
const corrienteConfigRef = () => doc(firestoreDb, 'dailyMenu', CORRIENTE_CONFIG_ID)

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
 * Define los precios del "Almuerzo Corriente". PERSISTENTES — viven en un
 * doc fijo (no por día), así no se pierden con el reset diario. La cocinera
 * los cambia solo cuando quiere; los días siguientes mantienen los precios
 * sin acción manual.
 *
 * config: { priceMesa, priceLlevar }
 *
 * El corriente NO tiene flag 'active' explícito: se considera disponible
 * para la cajera cuando priceMesa > 0 Y hay opciones suficientes en el menú
 * del día (ver getCorrienteState).
 */
export async function setDailyCorriente(_dateStr, config, { publishedBy, publishedByName } = {}) {
  await setDoc(corrienteConfigRef(), {
    priceMesa: Number(config?.priceMesa) || 0,
    priceLlevar: Number(config?.priceLlevar) || 0,
    updatedAt: serverTimestamp(),
    updatedAtClient: getClientTimestamp(),
    updatedBy: publishedBy || null,
    updatedByName: publishedByName || null,
  }, { merge: true })
}

/**
 * Define los precios de las ADICIONES (sopa adicional, huevo, proteína
 * extra). PERSISTENTES — viven en el mismo doc fijo `corriente_config`.
 *
 * config: { addonSoupPrice, addonEggPrice, addonProteinPrice }
 *
 * Los 3 tipos de adición son fijos: 'soup' | 'egg' | 'protein'.
 * Si el precio es 0 o falsy, la adición NO se ofrece al cliente.
 */
export async function setAddonPrices(config, { publishedBy, publishedByName } = {}) {
  await setDoc(corrienteConfigRef(), {
    addonSoupPrice:    Number(config?.addonSoupPrice) || 0,
    addonEggPrice:     Number(config?.addonEggPrice) || 0,
    addonProteinPrice: Number(config?.addonProteinPrice) || 0,
    updatedAt: serverTimestamp(),
    updatedAtClient: getClientTimestamp(),
    updatedBy: publishedBy || null,
    updatedByName: publishedByName || null,
  }, { merge: true })
}

/**
 * Lee los 3 precios de adiciones del doc persistente. Devuelve null para
 * los que no estén configurados (precio = 0 → no se ofrece al cliente).
 */
export function getAddonPrices(corrienteConfig) {
  const cfg = corrienteConfig || {}
  return {
    soup:    Number(cfg.addonSoupPrice) || 0,
    egg:     Number(cfg.addonEggPrice) || 0,
    protein: Number(cfg.addonProteinPrice) || 0,
  }
}

/**
 * Suscripción al doc persistente de configuración del corriente (precios).
 * callback recibe { priceMesa, priceLlevar } o null si no hay config aún.
 */
export function watchCorrienteConfig(callback) {
  try {
    return onSnapshot(
      corrienteConfigRef(),
      snap => callback(snap.exists() ? snap.data() : null),
      err => {
        console.error('[menu] watchCorrienteConfig error (manteniendo último valor):', err?.message || err)
      }
    )
  } catch (err) {
    console.error('[menu] watchCorrienteConfig setup failed:', err)
    return () => {}
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
 * Estado del Almuerzo Especial para una fecha:
 *   - available: bool — true si la cajera/cliente lo puede pedir
 *   - active: bool — la cocinera lo activó hoy
 *   - priceMesa, priceLlevar: precios del especial
 *   - resolved: { soup, especial, salad } items resueltos del día
 *   - missingPrice, missingEspecial: razones por las que NO está disponible
 *
 * El especial es "available" cuando:
 *   - dailyMenu.special.active === true
 *   - priceMesa > 0
 *   - hay al menos UN item de categoría 'especial' publicado hoy
 *
 * Sopa y ensalada son OPCIONALES (el especial puede no llevar) pero si la
 * cocinera publicó alguna, el cliente las verá como parte del flujo.
 */
export function getSpecialState(dailyMenu, allMenuItems) {
  const sp = dailyMenu?.special || {}
  const active = sp.active === true
  const priceMesa = Number(sp.priceMesa) || 0
  const priceLlevar = Number(sp.priceLlevar) || priceMesa
  const resolved = {
    soup:     resolveCategoryFor(dailyMenu, allMenuItems, 'soup'),
    especial: resolveCategoryFor(dailyMenu, allMenuItems, 'especial'),
    salad:    resolveCategoryFor(dailyMenu, allMenuItems, 'salad'),
  }
  const missingPrice = priceMesa <= 0
  const missingEspecial = resolved.especial.length === 0
  const available = active && !missingPrice && !missingEspecial
  return {
    active, available,
    priceMesa, priceLlevar,
    resolved,
    missingPrice, missingEspecial,
  }
}

function resolveCategoryFor(dailyMenu, allMenuItems, catId) {
  const ids = dailyMenu?.itemsByCategory?.[catId] || []
  return ids
    .map(id => allMenuItems.find(m => m.id === id))
    .filter(m => m && !m.archived)
}

/**
 * Estado del Almuerzo Corriente para una fecha:
 *   - available: bool — true si la cajera lo puede vender hoy
 *   - priceMesa, priceLlevar: precios definidos (o 0)
 *   - missingPrice: bool — la cocinera no ha puesto precio nunca
 *   - missingCategories: [labels] — categorías obligatorias sin opciones HOY
 *
 * Los precios vienen del doc PERSISTENTE (corrienteConfig), no del día. Las
 * opciones del menú vienen del dailyMenu del día. Si no se pasa
 * corrienteConfig, intenta leerlo del campo `corriente` del dailyMenu por
 * retrocompatibilidad con datos viejos.
 */
export function getCorrienteState(dailyMenu, allMenuItems, corrienteConfig) {
  // Prioridad: config persistente. Fallback: el campo `corriente` del día (legacy).
  const cfg = corrienteConfig || dailyMenu?.corriente || null
  const priceMesa = Number(cfg?.priceMesa) || 0
  const priceLlevar = Number(cfg?.priceLlevar) || 0
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
 * Copia el menú DEL DÍA (opciones + estado del especial) de una fecha a otra.
 * Los precios del corriente NO se copian aquí porque viven en un doc
 * persistente — siempre están actualizados.
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

import { firestoreDb } from './firebase'
import {
  doc,
  setDoc,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore'
import { getClientTimestamp } from './utils/network'

// ──────────────────────────────────────────────────────────────────────────
// Sistema de DESAYUNOS.
//
// A diferencia del almuerzo (donde la cocinera arma un menú dinámico cada día
// con menuItems del catálogo), el desayuno tiene **opciones fijas** y un
// **motor de precios híbrido**:
//
//   1. Componentes aditivos:
//      - Caldo costilla / pescado (o sin caldo)
//      - Huevos normales (revueltos/fritos/pericos) o rancheros (+recargo)
//      - Arroz con pan (sí/no)
//      - Bebida caliente (café/chocolate, o sin bebida)
//
//   2. Recargo único por llevar (se suma al total mesa).
//
//   3. COMBOS COMPLETOS con descuento: si la combinación elegida matchea
//      uno de los combos definidos, se cobra el precio del combo en vez de
//      la suma de componentes. Hoy hay 4 combos (costilla/pescado normal o
//      ranchero, todos con arroz+bebida).
//
// Config persistente en doc fijo `dailyMenu/breakfast_config`. Vive en la
// misma colección que el corriente para reusar reglas de Firestore.
//
// IMPORTANTE: Firestore reserva IDs `__.*__`. Usamos guiones simples.
// ──────────────────────────────────────────────────────────────────────────

const BREAKFAST_CONFIG_ID = 'breakfast_config'
const breakfastConfigRef = () => doc(firestoreDb, 'dailyMenu', BREAKFAST_CONFIG_ID)

// ─── Categorías del desayuno ──────────────────────────────────────
//
// Mismo shape que las categorías del almuerzo para que los wizards puedan
// reusar primitivas (`PickStep`, `SingleOptionStep`, etc.). `mealType` las
// distingue del corriente.
//
// `required:false` y `alwaysServed:false` porque cualquiera puede ir nula
// (el cliente puede pedir "solo huevos", "solo caldo", etc.). El precio se
// calcula con lo que haya.

export const BREAKFAST_CATEGORIES = [
  { id: 'caldo',  label: 'Caldo',           emoji: '🍲', multi: true,  required: false, maxSelections: 1, mealType: 'breakfast' },
  { id: 'huevos', label: 'Huevos',          emoji: '🥚', multi: true,  required: false, maxSelections: 1, mealType: 'breakfast' },
  { id: 'arroz',  label: 'Arroz con pan',   emoji: '🍚', multi: false, required: false, maxSelections: 1, mealType: 'breakfast' },
  { id: 'bebida', label: 'Bebida caliente', emoji: '☕', multi: true,  required: false, maxSelections: 1, mealType: 'breakfast' },
]

export const BREAKFAST_CATEGORY_BY_ID = Object.fromEntries(
  BREAKFAST_CATEGORIES.map(c => [c.id, c])
)
export const BREAKFAST_CATEGORY_IDS = BREAKFAST_CATEGORIES.map(c => c.id)

// ─── Opciones fijas por categoría ─────────────────────────────────
//
// Las opciones son fijas (no las edita la cocinera desde el catálogo).
// Si en el futuro hay que agregar otro caldo o bebida, se cambia acá Y se
// agregan precios en breakfast_config.componentes.
//
// IDs:
//   - caldo:  'costilla' | 'pescado'
//   - huevos: 'revueltos' | 'fritos' | 'pericos' | 'rancheros'
//   - arroz:  'arroz_pan'
//   - bebida: 'cafe' | 'chocolate'

export const BREAKFAST_OPTIONS = {
  caldo: [
    { id: 'costilla', name: 'Caldo de costilla' },
    { id: 'pescado',  name: 'Caldo de pescado' },
  ],
  huevos: [
    { id: 'revueltos', name: 'Huevos revueltos' },
    { id: 'fritos',    name: 'Huevos fritos' },
    { id: 'pericos',   name: 'Huevos pericos' },
    { id: 'rancheros', name: 'Huevos rancheros', isRanchero: true },
  ],
  arroz: [
    { id: 'arroz_pan', name: 'Arroz con pan' },
  ],
  bebida: [
    { id: 'cafe',      name: 'Café' },
    { id: 'chocolate', name: 'Chocolate' },
  ],
}

/** Mapa rápido id → opción para resolver desde una selection. */
export const BREAKFAST_OPTION_BY_ID = (() => {
  const out = {}
  for (const cat of Object.keys(BREAKFAST_OPTIONS)) {
    for (const opt of BREAKFAST_OPTIONS[cat]) {
      out[opt.id] = { ...opt, category: cat }
    }
  }
  return out
})()

// ─── Config persistente ───────────────────────────────────────────

/**
 * Defaults editables. Si la cocinera/admin nunca toca la config, estos son
 * los valores que el motor usa. Vienen mapeados de la conversación con el
 * cliente:
 *   - Caldo costilla $8.000 · pescado $9.000
 *   - Huevos $4.000 · rancheros +$4.000
 *   - Arroz con pan $3.000 · bebida $3.000
 *   - Llevar +$1.500
 *   - 4 combos: costilla/pescado normal/ranchero con arroz+bebida
 */
export const BREAKFAST_DEFAULTS = {
  active: false,
  caldoCostillaPrice:    8000,
  caldoPescadoPrice:     9000,
  huevosNormalesPrice:   4000,
  rancherosRecargo:      4000,
  arrozPanPrice:         3000,
  bebidaPrice:           3000,
  llevarSurcharge:       1500,
  combos: [
    { id: 'combo_costilla',          name: 'Combo Costilla',           caldo: 'costilla', huevos: 'normal',    arroz: true, bebida: true, priceMesa: 12000 },
    { id: 'combo_pescado',           name: 'Combo Pescado',            caldo: 'pescado',  huevos: 'normal',    arroz: true, bebida: true, priceMesa: 13000 },
    { id: 'combo_costilla_ranchero', name: 'Combo Costilla Ranchero',  caldo: 'costilla', huevos: 'rancheros', arroz: true, bebida: true, priceMesa: 16000 },
    { id: 'combo_pescado_ranchero',  name: 'Combo Pescado Ranchero',   caldo: 'pescado',  huevos: 'rancheros', arroz: true, bebida: true, priceMesa: 17000 },
  ],
}

/** Mezcla la config guardada en Firestore con los defaults — cualquier
 *  campo ausente cae al default. Devuelve siempre un objeto completo. */
export function getBreakfastConfig(raw) {
  if (!raw) return { ...BREAKFAST_DEFAULTS }
  return {
    active:               raw.active === true,
    caldoCostillaPrice:   Number(raw.caldoCostillaPrice)   || BREAKFAST_DEFAULTS.caldoCostillaPrice,
    caldoPescadoPrice:    Number(raw.caldoPescadoPrice)    || BREAKFAST_DEFAULTS.caldoPescadoPrice,
    huevosNormalesPrice:  Number(raw.huevosNormalesPrice)  || BREAKFAST_DEFAULTS.huevosNormalesPrice,
    rancherosRecargo:     Number(raw.rancherosRecargo)     || BREAKFAST_DEFAULTS.rancherosRecargo,
    arrozPanPrice:        Number(raw.arrozPanPrice)        || BREAKFAST_DEFAULTS.arrozPanPrice,
    bebidaPrice:          Number(raw.bebidaPrice)          || BREAKFAST_DEFAULTS.bebidaPrice,
    llevarSurcharge:      Number(raw.llevarSurcharge)      || BREAKFAST_DEFAULTS.llevarSurcharge,
    combos: Array.isArray(raw.combos) && raw.combos.length > 0
      ? raw.combos.map(normalizeCombo).filter(Boolean)
      : BREAKFAST_DEFAULTS.combos,
  }
}

function normalizeCombo(c) {
  if (!c || !c.id) return null
  return {
    id:        String(c.id),
    name:      String(c.name || ''),
    caldo:     c.caldo === 'costilla' || c.caldo === 'pescado' ? c.caldo : null,
    huevos:    c.huevos === 'normal' || c.huevos === 'rancheros' ? c.huevos : null,
    arroz:     c.arroz === true,
    bebida:    c.bebida === true,
    priceMesa: Number(c.priceMesa) || 0,
  }
}

/** Suscripción al doc persistente. callback(config) siempre con shape completo. */
export function watchBreakfastConfig(callback) {
  try {
    return onSnapshot(
      breakfastConfigRef(),
      snap => callback(getBreakfastConfig(snap.exists() ? snap.data() : null)),
      err => {
        console.error('[breakfast] watchBreakfastConfig error:', err?.message || err)
      }
    )
  } catch (err) {
    console.error('[breakfast] watchBreakfastConfig setup failed:', err)
    callback(getBreakfastConfig(null))
    return () => {}
  }
}

/** Activa o desactiva el desayuno globalmente. */
export async function setBreakfastActive(active, { publishedBy, publishedByName } = {}) {
  await setDoc(breakfastConfigRef(), {
    active: !!active,
    updatedAt: serverTimestamp(),
    updatedAtClient: getClientTimestamp(),
    updatedBy: publishedBy || null,
    updatedByName: publishedByName || null,
  }, { merge: true })
}

/** Guarda los precios de los componentes (caldo, huevos, etc.). */
export async function setBreakfastPrices(prices, { publishedBy, publishedByName } = {}) {
  const payload = {
    updatedAt: serverTimestamp(),
    updatedAtClient: getClientTimestamp(),
    updatedBy: publishedBy || null,
    updatedByName: publishedByName || null,
  }
  const KEYS = [
    'caldoCostillaPrice', 'caldoPescadoPrice',
    'huevosNormalesPrice', 'rancherosRecargo',
    'arrozPanPrice', 'bebidaPrice',
    'llevarSurcharge',
  ]
  for (const k of KEYS) {
    if (prices[k] != null) payload[k] = Math.max(0, Number(prices[k]) || 0)
  }
  await setDoc(breakfastConfigRef(), payload, { merge: true })
}

/** Reemplaza la lista completa de combos (4 por defecto). */
export async function setBreakfastCombos(combos, { publishedBy, publishedByName } = {}) {
  const clean = (combos || []).map(normalizeCombo).filter(Boolean)
  await setDoc(breakfastConfigRef(), {
    combos: clean,
    updatedAt: serverTimestamp(),
    updatedAtClient: getClientTimestamp(),
    updatedBy: publishedBy || null,
    updatedByName: publishedByName || null,
  }, { merge: true })
}

// ─── Motor de precios HÍBRIDO ─────────────────────────────────────
//
// Dada una selección del cliente y el destino (mesa/llevar), devuelve:
//   { priceMesa, priceLlevar, isCombo, comboId, comboName, breakdown }
//
// breakdown: array de líneas { label, price } para mostrar al cliente
//   y para auditar el cálculo.
//
// Lógica:
//   1. Suma de componentes seleccionados → precio aditivo.
//   2. Si la combinación MATCHEA un combo (mismo caldo, mismo tipo de
//      huevos, mismo arroz, misma bebida) → se usa el precio del combo
//      en lugar de la suma. SIEMPRE preferimos combo (asumimos que el
//      combo es más barato; si por error es más caro, también se aplica
//      porque el negocio definió ese precio).
//   3. Llevar: precio mesa + recargo.

/**
 * selections: { caldo, huevos, arroz, bebida }
 *   - caldo:  { id, name } | null
 *   - huevos: { id, name, isRanchero? } | null
 *   - arroz:  { id, name } | null
 *   - bebida: { id, name } | null
 */
export function getBreakfastPrice(selections, config) {
  const cfg = config && config.combos ? config : getBreakfastConfig(config)
  const sel = selections || {}

  const caldoId  = sel.caldo?.id || null
  const huevosId = sel.huevos?.id || null
  const isRanchero = !!sel.huevos?.isRanchero || huevosId === 'rancheros'
  const hasArroz  = !!sel.arroz?.id
  const hasBebida = !!sel.bebida?.id

  // 1) Componentes aditivos
  const breakdown = []
  let priceMesa = 0

  if (caldoId === 'costilla') {
    breakdown.push({ key: 'caldoCostilla', label: 'Caldo de costilla', price: cfg.caldoCostillaPrice })
    priceMesa += cfg.caldoCostillaPrice
  } else if (caldoId === 'pescado') {
    breakdown.push({ key: 'caldoPescado', label: 'Caldo de pescado', price: cfg.caldoPescadoPrice })
    priceMesa += cfg.caldoPescadoPrice
  }

  if (huevosId) {
    if (isRanchero) {
      breakdown.push({ key: 'huevosBase',  label: 'Huevos', price: cfg.huevosNormalesPrice })
      breakdown.push({ key: 'rancheros',   label: 'Recargo rancheros', price: cfg.rancherosRecargo })
      priceMesa += cfg.huevosNormalesPrice + cfg.rancherosRecargo
    } else {
      breakdown.push({ key: 'huevos', label: 'Huevos', price: cfg.huevosNormalesPrice })
      priceMesa += cfg.huevosNormalesPrice
    }
  }

  if (hasArroz) {
    breakdown.push({ key: 'arroz', label: 'Arroz con pan', price: cfg.arrozPanPrice })
    priceMesa += cfg.arrozPanPrice
  }

  if (hasBebida) {
    breakdown.push({ key: 'bebida', label: 'Bebida caliente', price: cfg.bebidaPrice })
    priceMesa += cfg.bebidaPrice
  }

  // 2) Buscar combo que matchee.
  //
  // El caldo y el tipo de huevos SÍ deben coincidir exactamente (son los que
  // definen de qué combo se trata y cuánto vale).
  //
  // El arroz y la bebida van INCLUIDOS en el combo: si el cliente los quita,
  // el combo sigue aplicando y el precio NO sube (no hay descuento por quitar
  // una pieza incluida). Sin esto, "sin arroz" rompía el combo y caía a la
  // suma suelta de componentes, que es MÁS cara que el combo.
  //
  // Regla: el cliente solo puede tener arroz/bebida si el combo los incluye;
  // pero puede NO tenerlos y el combo igual matchea.
  const huevosType = isRanchero ? 'rancheros' : (huevosId ? 'normal' : null)
  const match = (cfg.combos || []).find(c =>
    c.caldo === caldoId &&
    c.huevos === huevosType &&
    (!hasArroz  || c.arroz) &&
    (!hasBebida || c.bebida)
  )

  let isCombo = false
  let comboId = null
  let comboName = null
  if (match && match.priceMesa > 0) {
    isCombo = true
    comboId = match.id
    comboName = match.name
    // El combo SUSTITUYE al precio aditivo. Lo marcamos en el breakdown
    // como ajuste para que la UI pueda mostrar "Combo: -$X".
    const discount = priceMesa - match.priceMesa
    if (discount > 0) {
      breakdown.push({ key: 'comboDiscount', label: `Descuento combo (${match.name})`, price: -discount })
    } else if (discount < 0) {
      breakdown.push({ key: 'comboAdjust', label: `Precio combo (${match.name})`, price: -discount })
    }
    priceMesa = match.priceMesa
  }

  const priceLlevar = priceMesa > 0 ? priceMesa + cfg.llevarSurcharge : 0

  return {
    priceMesa,
    priceLlevar,
    isCombo,
    comboId,
    comboName,
    breakdown,
    hasAnything: breakdown.length > 0,
  }
}

// ─── Estado de disponibilidad ─────────────────────────────────────

/**
 * ¿Se ofrece desayuno hoy?
 *   - available: true si está activo y al menos el caldo+huevos tienen precio
 *   - active: el switch global
 *   - priceMesaFrom: precio mínimo posible (referencia)
 *   - missingPrices: si activo pero faltan precios clave
 */
export function getBreakfastState(config) {
  const cfg = config && config.combos ? config : getBreakfastConfig(config)
  const active = cfg.active === true
  const hasCorePrices =
    cfg.caldoCostillaPrice > 0 &&
    cfg.huevosNormalesPrice > 0
  // Precio mínimo posible: solo huevos normales.
  const priceMesaFrom = cfg.huevosNormalesPrice || 0
  const priceLlevarFrom = priceMesaFrom > 0
    ? priceMesaFrom + cfg.llevarSurcharge
    : 0
  return {
    available: active && hasCorePrices,
    active,
    priceMesaFrom,
    priceLlevarFrom,
    missingPrices: active && !hasCorePrices,
  }
}

// ─── Helpers de formato compartidos ───────────────────────────────

/**
 * Texto descriptivo de un desayuno completo para mostrar en la cola de
 * cocina, comanda, etc. Sin precios.
 * ej: "🍲 Costilla · 🥚 Revueltos · 🍚 Arroz/pan · ☕ Café"
 */
export function formatBreakfastSelections(selections) {
  const sel = selections || {}
  const parts = []
  if (sel.caldo?.name) parts.push(`🍲 ${sel.caldo.name}`)
  if (sel.huevos?.name) parts.push(`🥚 ${sel.huevos.name}`)
  if (sel.arroz?.id) parts.push(`🍚 Arroz con pan`)
  if (sel.bebida?.name) parts.push(`☕ ${sel.bebida.name}`)
  return parts.join(' · ')
}

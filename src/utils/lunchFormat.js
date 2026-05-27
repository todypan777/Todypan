// ──────────────────────────────────────────────────────────────
// Helpers compartidos para formatear almuerzos del cliente
// (PublicMenu, OrderConfirm, WhatsApp message, conversión a cocina).
//
// Modelo:
//   selections = { soup, principio, protein, side, salad, juice }
//     valor por categoría: { id, name } | [{ id, name }] | null
//   replacements = { soup?, principio? }
//     valor: 'huevo' | 'extra_principio' | 'extra_side'
//          | 'extra_arroz' | 'extra_salad' | 'extra_juice'
//          | 'nada'  | null
//   note = string libre del cliente
//
// Solo `soup` y `principio` admiten replacement (las únicas que el
// wizard del cliente permite omitir). El resto siempre se sirve o
// se marca como SIN [X] (categorías alwaysServed).
// ──────────────────────────────────────────────────────────────

export const REPLACEMENT_LABELS = {
  huevo:           'Huevo',
  extra_principio: 'Doble principio',
  extra_side:      'Doble acompañante',
  extra_arroz:     'Arroz extra',
  extra_salad:     'Doble ensalada',
  extra_juice:     'Doble jugo',
  nada:            null, // explícito "nada" → no mostrar reemplazo
}

/**
 * Texto de una opción de categoría para listas de UI / WhatsApp.
 * - val null + alwaysServed → "SIN [X]"
 * - val con replacement → "Sin [X] · en su lugar: [reemplazo]"
 * - val array (mixto) → "MIXTO · A / B"
 * - val objeto → "Nombre"
 */
export function formatSelection(cat, val, replacement = null) {
  if (!val) {
    const repLabel = REPLACEMENT_LABELS[replacement]
    if (repLabel) {
      return `Sin ${cat.label.toLowerCase()} · en su lugar: ${repLabel}`
    }
    if (cat.alwaysServed) return `SIN ${cat.label.toUpperCase()}`
    // soup/principio sin replacement explícito = simplemente sin esa categoría
    if (replacement === 'nada') return `SIN ${cat.label.toUpperCase()}`
    return null
  }
  if (Array.isArray(val)) {
    if (val.length === 0) return null
    if (val.length === 1) return val[0]?.name || null
    return 'MIXTO · ' + val.map(v => v.name).join(' / ')
  }
  return val.name || null
}

/**
 * Construye un texto a partir de selections + replacements + note
 * pensado para enviar a la cocina como NOTA del almuerzo cuando se
 * convierte un customerOrder → kitchenOrder.
 *
 * No reemplaza al sistema de selections (que sigue tal cual): solo
 * agrega los EXTRAS y los reemplazos como texto, para que la cocina
 * los vea sin que tengamos que cambiar el modelo de kitchenOrders.
 */
export function buildKitchenNoteFromCustomerItem({ replacements, note }) {
  const parts = []
  if (replacements?.soup && replacements.soup !== 'nada') {
    const lbl = REPLACEMENT_LABELS[replacements.soup]
    if (lbl) parts.push(`En vez de sopa: + ${lbl}`)
  }
  if (replacements?.principio && replacements.principio !== 'nada') {
    const lbl = REPLACEMENT_LABELS[replacements.principio]
    if (lbl) parts.push(`En vez de principio: + ${lbl}`)
  }
  const userNote = (note || '').toString().trim()
  if (userNote) parts.push(userNote)
  return parts.join(' · ') || null
}

/**
 * Texto humano para un item de tipo 'addon' (sopa/huevo/proteína extra).
 * Usado en cocina y resumen de carrito.
 * ej: "Sopa adicional x2", "Proteína adicional x1 (Pollo Dorado)"
 */
export function formatAddonLine(addon) {
  if (!addon || addon.kind !== 'addon') return null
  const qty = Math.max(1, Number(addon.quantity) || 1)
  const qtySuffix = qty > 1 ? ` x${qty}` : ''
  const base = {
    soup:    'Sopa adicional',
    egg:     'Huevo adicional',
    protein: 'Proteína adicional',
  }[addon.addonType] || 'Adicional'
  const proteinSuffix = addon.proteinName ? ` (${addon.proteinName})` : ''
  return `${base}${qtySuffix}${proteinSuffix}`
}

/**
 * Convierte un cart con mezcla de almuerzos (corriente/especial) y adiciones
 * a la lista de "lunch payloads" que entiende el modelo de kitchenOrders.
 *
 * Las ADICIONES no se mapean 1:1 a kitchenOrders — se concatenan como
 * texto al `note` del primer almuerzo. Si el cart contiene SOLO adiciones
 * (cliente que pidió únicamente una sopa, por ejemplo), generamos un
 * "Almuerzo Especial" sintético con descripción = lista de adiciones y
 * precio = suma. Así no tocamos el modelo de kitchen ni rompemos nada.
 *
 * Cada item de entrada puede tener:
 *   { kind, selections, replacements, description, note, price, ...addonFields }
 *
 * Cada item de salida (lunchPayload) tiene:
 *   { kind: 'menu' | 'special', productId, productName, destination,
 *     selections, description, price, note }
 *
 * @param items   array de items (almuerzos + adiciones)
 * @param mapLunch (item) → lunchPayload — función para mapear un almuerzo
 *                normal. La provee el caller porque cada lado (cliente vs
 *                cajera) construye el payload con campos diferentes
 *                (destination, productId del catálogo, etc).
 */
export function buildLunchCommanda(items, mapLunch) {
  const list = items || []
  const lunches = list.filter(it => it.kind !== 'addon')
  const addons  = list.filter(it => it.kind === 'addon')

  const lunchPayloads = lunches.map(mapLunch)

  if (addons.length === 0) return lunchPayloads

  const addonsText = addons.map(formatAddonLine).filter(Boolean).join(' · ')

  // Las adiciones SIEMPRE se cobran como su propia línea "Adiciones" (vayan
  // solas o junto a almuerzos). Antes, cuando había un almuerzo, la adición se
  // pegaba como nota y su precio se PERDÍA (no se cobraba). Ahora cada adición
  // ya trae su precio (según mesa/llevar) y se suman en una línea aparte.
  const totalAddonsPrice = addons.reduce((s, it) => s + (Number(it.price) || 0), 0)
  const customerNotes = addons
    .map(it => it.note?.toString().trim())
    .filter(Boolean)
    .join(' · ')
  // Destino de la línea de adiciones: el de la propia adición (cajera lo eligió;
  // cliente web = 'llevar'). Si por algún motivo falta, hereda del primer
  // almuerzo o cae a 'llevar'.
  const destination = addons[0]?.destination || lunchPayloads[0]?.destination || 'llevar'

  const adicionesItem = {
    kind: 'special',
    productId: null,
    productName: 'Adiciones',
    destination,
    selections: null,
    description: addonsText,
    price: totalAddonsPrice,
    note: customerNotes || null,
  }
  return [...lunchPayloads, adicionesItem]
}

/**
 * Opciones de reemplazo según la categoría omitida.
 * - soup: huevo + más de cualquier otra categoría + nada
 * - principio: huevo + más de cualquiera EXCEPTO principio + nada
 */
export const REPLACEMENT_OPTIONS = {
  soup: [
    { key: 'huevo',           label: 'Huevo',              emoji: '🍳' },
    { key: 'extra_principio', label: 'Más principio',      emoji: '🫘' },
    { key: 'extra_side',      label: 'Más acompañante',    emoji: '🥔' },
    { key: 'extra_salad',     label: 'Más ensalada',       emoji: '🥗' },
    { key: 'extra_arroz',     label: 'Más arroz',          emoji: '🍚' },
    { key: 'extra_juice',     label: 'Más jugo',           emoji: '🥤' },
    { key: 'nada',            label: 'Nada, así está bien', emoji: '👌' },
  ],
  principio: [
    { key: 'huevo',           label: 'Huevo',              emoji: '🍳' },
    { key: 'extra_side',      label: 'Más acompañante',    emoji: '🥔' },
    { key: 'extra_salad',     label: 'Más ensalada',       emoji: '🥗' },
    { key: 'extra_arroz',     label: 'Más arroz',          emoji: '🍚' },
    { key: 'extra_juice',     label: 'Más jugo',           emoji: '🥤' },
    { key: 'nada',            label: 'Nada, así está bien', emoji: '👌' },
  ],
  // Reemplazos para la sopa CUANDO va dentro del especial: el especial
  // solo lleva sopa + plato + ensalada, así que no tiene sentido ofrecer
  // 'más principio', 'más acompañante' o 'más jugo' (no van en el especial).
  especial_soup: [
    { key: 'huevo',       label: 'Huevo',               emoji: '🍳' },
    { key: 'extra_arroz', label: 'Más arroz',           emoji: '🍚' },
    { key: 'extra_salad', label: 'Más ensalada',        emoji: '🥗' },
    { key: 'nada',        label: 'Nada, así está bien', emoji: '👌' },
  ],
}

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
 * Opciones de reemplazo según la categoría omitida.
 * - soup: huevo + más de cualquier otra categoría + nada
 * - principio: huevo + más de cualquiera EXCEPTO principio + nada
 */
export const REPLACEMENT_OPTIONS = {
  soup: [
    { key: 'huevo',           label: 'Huevo',              emoji: '🍳' },
    { key: 'extra_principio', label: 'Más principio',      emoji: '🫘' },
    { key: 'extra_side',      label: 'Más acompañante',    emoji: '🍚' },
    { key: 'extra_salad',     label: 'Más ensalada',       emoji: '🥗' },
    { key: 'extra_arroz',     label: 'Más arroz',          emoji: '🍚' },
    { key: 'extra_juice',     label: 'Más jugo',           emoji: '🥤' },
    { key: 'nada',            label: 'Nada, así está bien', emoji: '👌' },
  ],
  principio: [
    { key: 'huevo',           label: 'Huevo',              emoji: '🍳' },
    { key: 'extra_side',      label: 'Más acompañante',    emoji: '🍚' },
    { key: 'extra_salad',     label: 'Más ensalada',       emoji: '🥗' },
    { key: 'extra_arroz',     label: 'Más arroz',          emoji: '🍚' },
    { key: 'extra_juice',     label: 'Más jugo',           emoji: '🥤' },
    { key: 'nada',            label: 'Nada, así está bien', emoji: '👌' },
  ],
}

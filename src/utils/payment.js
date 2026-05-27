// Helpers compartidos para representar el método de pago de una venta.
// Centraliza los iconos y labels para que todos los listados de ventas
// muestren lo mismo, incluyendo el caso 'mixto' (pago dividido).

const METHOD_META = {
  efectivo:  { icon: '💵', label: 'Efectivo' },
  nequi:     { icon: '📱', label: 'NEQUI' },
  daviplata: { icon: '📲', label: 'DAVIPLATA' },
  deuda:     { icon: '📋', label: 'Deuda' },
  mixto:     { icon: '🔀', label: 'Mixto' },
}

/** Devuelve { icon, label } para una venta cualquiera. */
export function paymentDisplay(sale) {
  const m = sale?.paymentMethod || 'efectivo'
  return METHOD_META[m] || { icon: '·', label: m }
}

/** Devuelve solo el icono. */
export function paymentIcon(sale) {
  return paymentDisplay(sale).icon
}

/** Devuelve solo el label. */
export function paymentLabel(sale) {
  return paymentDisplay(sale).label
}

/**
 * Para ventas con `paymentSplit`, devuelve string resumen tipo:
 *   "$10k + $5k"
 * Útil para mostrar como subtítulo del row.
 * Devuelve null si no es split.
 */
export function paymentSplitSummary(sale) {
  if (!sale?.paymentSplit) return null
  const parts = Object.entries(sale.paymentSplit)
    .filter(([, amt]) => Number(amt) > 0)
    .map(([m, amt]) => `${METHOD_META[m]?.icon || ''} ${shortMoney(amt)}`.trim())
  return parts.join(' + ')
}

/**
 * Monto que viajó por una app digital (nequi/daviplata) en una venta.
 * - Venta pura de ese método → el total.
 * - Venta mixto → solo la porción de ese método dentro de paymentSplit.
 * - Cualquier otro caso → 0.
 */
export function digitalAmount(sale, method) {
  if (!sale) return 0
  if (sale.paymentSplit) return Number(sale.paymentSplit[method]) || 0
  if (sale.paymentMethod === method) return Number(sale.total) || 0
  return 0
}

function shortMoney(n) {
  const abs = Math.abs(Math.round(Number(n) || 0))
  if (abs >= 1_000_000) return '$' + (abs / 1_000_000).toFixed(1).replace('.', ',') + 'M'
  if (abs >= 1_000) return '$' + Math.round(abs / 1_000) + 'k'
  return '$' + abs
}

/**
 * Suma las porciones de una venta a un breakdown { efectivo, nequi, daviplata, deuda }.
 * Maneja correctamente ventas con paymentSplit (las distribuye) y sin split
 * (suma el total al método único). Mutador in-place sobre el breakdown.
 *
 * Uso:
 *   const breakdown = { efectivo: 0, nequi: 0, daviplata: 0, deuda: 0 }
 *   for (const sale of activeSales) addSaleToBreakdown(breakdown, sale)
 */
export function addSaleToBreakdown(breakdown, sale) {
  const total = Number(sale.total) || 0
  if (sale.paymentSplit) {
    for (const [m, amt] of Object.entries(sale.paymentSplit)) {
      const a = Number(amt) || 0
      if (a <= 0) continue
      breakdown[m] = (breakdown[m] || 0) + a
    }
  } else {
    const m = sale.paymentMethod || 'efectivo'
    breakdown[m] = (breakdown[m] || 0) + total
  }
}

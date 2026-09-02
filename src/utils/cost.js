// ─────────────────────────────────────────────────────────────────────────────
// COSTO POR UNIDAD — fuente unica de verdad
//
// El costo de un producto puede venir de dos formas:
//   1. `suppliers[]`  — modelo nuevo: cada proveedor trae su propio costo, ya
//      sea por paquete (packageCost / unitsPerPackage) o por unidad.
//   2. `packageCost` + `byPackage` + `unitsPerPackage` — modelo legacy, un
//      unico costo para el producto. Es el que traen los productos creados
//      por cajera (nacen en 0 y el admin los completa).
//
// Cuando hay varios proveedores se usa el MAS CARO: para calcular ganancia
// conviene el peor caso, asi el margen que ve el admin nunca esta inflado.
// ─────────────────────────────────────────────────────────────────────────────

/** Costo por unidad de UN proveedor: por paquete → costo/unidades; o directo. */
export function supplierUnitCost(s) {
  if (!s) return 0
  const pc = Number(s.packageCost) || 0
  if (s.byPackage) {
    const u = Number(s.unitsPerPackage) || 0
    return u > 0 ? pc / u : 0
  }
  return pc
}

/**
 * Costo por unidad de un producto, mirando primero sus proveedores y cayendo
 * al costo legacy. Devuelve 0 si el producto aun no tiene costo cargado — el
 * llamador decide si eso es "sin configurar" o simplemente ganancia desconocida.
 */
export function productUnitCost(p) {
  if (!p) return 0
  const costs = Array.isArray(p.suppliers)
    ? p.suppliers.map(supplierUnitCost).filter(c => c > 0)
    : []
  if (costs.length > 0) return Math.max(...costs)
  const pc = Number(p.packageCost) || 0
  if (p.byPackage) {
    const u = Number(p.unitsPerPackage) || 0
    return u > 0 ? pc / u : 0
  }
  return pc
}

/** True si el producto tiene algun costo cargado (de proveedor o legacy). */
export function hasUnitCost(p) {
  return productUnitCost(p) > 0
}

// ─────────────────────────────────────────────────────────────────────────────
// COSTO Y GANANCIA DE UNA VENTA
//
// Se calculan sobre el `unitCost` CONGELADO en cada item al momento de vender.
// Nunca se va a buscar el costo actual del producto: si el proveedor sube el
// precio manana, lo vendido ayer debe seguir mostrando la ganancia de ayer.
// ─────────────────────────────────────────────────────────────────────────────

/** Costo total de una venta. Los items sin `unitCost` cuentan como 0. */
export function saleCost(sale) {
  if (!sale || !Array.isArray(sale.items)) return 0
  return sale.items.reduce(
    (sum, it) => sum + (Number(it.unitCost) || 0) * (Number(it.qty) || 0),
    0
  )
}

/** Ganancia de una venta: total cobrado menos costo de lo vendido. */
export function saleProfit(sale) {
  return (Number(sale?.total) || 0) - saleCost(sale)
}

/**
 * True si a la venta le falta costo en algun item — la ganancia que se muestre
 * estara inflada. La UI lo usa para avisar "faltan costos por cargar" en vez de
 * presentar una ganancia optimista como si fuera un dato firme.
 */
export function saleHasMissingCost(sale) {
  if (!sale || !Array.isArray(sale.items) || sale.items.length === 0) return false
  return sale.items.some(it => !(Number(it.unitCost) > 0))
}

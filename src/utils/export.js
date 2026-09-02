// ─────────────────────────────────────────────────────────────────────────────
// EXPORTACION A EXCEL
//
// Se genera CSV, no .xlsx: Excel lo abre directo con doble clic, no necesita
// ninguna libreria (la app pesa lo mismo) y funciona sin internet, que importa
// porque el POS trabaja offline.
//
// Dos detalles que hacen que abra bien en un Excel colombiano:
//   - BOM UTF-8: sin el, Excel en Windows rompe las tildes y las enes.
//   - Separador ';': con configuracion regional es-CO la coma es el separador
//     decimal, asi que un CSV con comas queda todo en una sola columna.
//
// Los montos se redondean a pesos enteros. Un costo por unidad puede dar
// 616,67 y ahi el separador decimal volveria a pelear con la configuracion
// regional; al peso es suficiente para una panaderia y evita el problema.
// ─────────────────────────────────────────────────────────────────────────────

import { saleCost } from './cost'

const SEP = ';'

/** Escapa un valor para CSV: comillas dobles si trae separador, comillas o salto. */
function cell(v) {
  if (v === null || v === undefined) return ''
  const s = String(v)
  if (s.includes(SEP) || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

/** Convierte [{col: valor}] + headers [[clave, titulo]] en texto CSV. */
export function toCSV(rows, headers) {
  const head = headers.map(([, title]) => cell(title)).join(SEP)
  const body = rows.map(r => headers.map(([key]) => cell(r[key])).join(SEP))
  return [head, ...body].join('\r\n')
}

/** Dispara la descarga de un CSV en el navegador. */
export function downloadCSV(filename, csv) {
  // El BOM (U+FEFF) le dice a Excel que el archivo es UTF-8.
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Se libera en el siguiente tick: revocar de inmediato cancela la descarga
  // en algunos navegadores moviles.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const money = (n) => Math.round(Number(n) || 0)

/** Hora HH:MM (Bogota) de una venta, o vacio si aun no sincronizo. */
function saleTime(sale) {
  const d = sale.createdAt?.toDate?.() || (sale.createdAtClient ? new Date(sale.createdAtClient) : null)
  if (!d) return ''
  return d.toLocaleTimeString('es-CO', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Bogota',
  })
}

const METHOD_LABEL = {
  efectivo: 'Efectivo', nequi: 'Nequi', daviplata: 'Daviplata',
  deuda: 'Fiado', mixto: 'Mixto',
}

/** Como se pago una venta. En mixto detalla el reparto. */
function methodLabel(sale) {
  const m = sale.paymentMethod || 'efectivo'
  if (m === 'mixto' && sale.paymentSplit) {
    const parts = Object.entries(sale.paymentSplit)
      .filter(([, amt]) => Number(amt) > 0)
      .map(([k, amt]) => `${METHOD_LABEL[k] || k} ${money(amt)}`)
    return parts.join(' + ')
  }
  return METHOD_LABEL[m] || m
}

export const SALES_HEADERS = [
  ['fecha', 'Fecha'],
  ['hora', 'Hora'],
  ['venta', 'Venta'],
  ['panaderia', 'Panadería'],
  ['cajera', 'Atendió'],
  ['producto', 'Producto'],
  ['cantidad', 'Cantidad'],
  ['precioVenta', 'Precio venta'],
  ['totalLinea', 'Total vendido'],
  ['costoUnitario', 'Precio costo'],
  ['costoLinea', 'Costo total'],
  ['ganancia', 'Ganancia'],
  ['metodoPago', 'Método de pago'],
]

/**
 * Una fila POR PRODUCTO VENDIDO (no por venta). Asi se puede sacar en Excel,
 * con una tabla dinamica, cuanto dejo cada producto — que es la pregunta que
 * no se puede responder con una fila por venta.
 *
 * `branchName` resuelve el id de sede a su nombre.
 */
export function salesToRows(sales, branchName) {
  const rows = []
  for (const s of sales) {
    if ((s.status || 'active') === 'deleted') continue
    const base = {
      fecha: s.date || '',
      hora: saleTime(s),
      venta: String(s.id || '').slice(0, 6).toUpperCase(),
      panaderia: branchName(s.branchId),
      cajera: s.cashierName || '',
      metodoPago: methodLabel(s),
    }
    const items = Array.isArray(s.items) ? s.items : []
    if (items.length === 0) {
      rows.push({
        ...base, producto: '(sin detalle)', cantidad: 0, precioVenta: 0,
        totalLinea: money(s.total), costoUnitario: 0, costoLinea: 0,
        ganancia: money(s.total),
      })
      continue
    }
    for (const it of items) {
      const qty = Number(it.qty) || 0
      const totalLinea = money(it.subtotal)
      const costoUnitario = money(it.unitCost)
      const costoLinea = money((Number(it.unitCost) || 0) * qty)
      rows.push({
        ...base,
        producto: it.name || '',
        cantidad: qty,
        precioVenta: money(it.unitPrice),
        totalLinea,
        costoUnitario,
        costoLinea,
        ganancia: totalLinea - costoLinea,
      })
    }
  }
  return rows
}

export const EXPENSE_HEADERS = [
  ['fecha', 'Fecha'],
  ['tipo', 'Tipo'],
  ['categoria', 'Categoría'],
  ['descripcion', 'Descripción'],
  ['panaderia', 'Panadería'],
  ['monto', 'Monto'],
]

/** Movimientos (ingresos y gastos) del admin, para la segunda hoja. */
export function movementsToRows(movements, catLabel, branchName) {
  return movements.map(m => ({
    fecha: m.date || '',
    tipo: m.type === 'income' ? 'Ingreso' : 'Gasto',
    categoria: catLabel(m.cat),
    descripcion: m.note || m.description || '',
    panaderia: m.branch === 'both' ? 'Ambas' : branchName(m.branch),
    monto: money(m.amount),
  }))
}

/** Resumen del periodo: la hoja que un contador mira primero. */
export function summaryToCSV({ desde, hasta, sales, movements }) {
  const activas = sales.filter(s => (s.status || 'active') !== 'deleted')
  const ventas = activas.reduce((a, s) => a + (Number(s.total) || 0), 0)
  const costo = activas.reduce((a, s) => a + saleCost(s), 0)
  const ingresos = movements.filter(m => m.type === 'income').reduce((a, m) => a + m.amount, 0)
  const gastos = movements.filter(m => m.type === 'expense').reduce((a, m) => a + m.amount, 0)

  const filas = [
    ['Desde', desde],
    ['Hasta', hasta],
    ['', ''],
    ['Vendido', money(ventas)],
    ['Costo de lo vendido', money(costo)],
    ['Ganancia en ventas', money(ventas - costo)],
    ['Otros ingresos', money(ingresos)],
    ['Gastos', money(gastos)],
    ['Le quedó', money(ventas - costo + ingresos - gastos)],
    ['', ''],
    ['Número de ventas', activas.length],
  ]
  return filas.map(([a, b]) => cell(a) + SEP + cell(b)).join('\r\n')
}

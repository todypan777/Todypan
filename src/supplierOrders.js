// ─────────────────────────────────────────────────────────────────────────────
// PEDIDOS A PROVEEDOR
//
// El vendedor de un proveedor llega a la panaderia, toma el pedido y dice el
// total ahi mismo. Dias despues llega la mercancia, con una factura que ya
// viene ajustada a lo que realmente llego: si se pidieron 20 y llegaron 18, la
// factura dice 18. No quedan saldos a favor ni facturas a medias.
//
// De ahi salen las dos cosas que el dueño pidio:
//
//   1. Cuanta plata dejar en caja hoy  → sumar el `expectedTotal` de los
//      pedidos que se esperan para hoy. Es un pronostico: lo dijo el vendedor
//      de palabra, no hay factura todavia.
//
//   2. Si hay descuadres al revisar inventario → comparar lo que se pidio
//      (`items`) contra lo que llego (`receivedItems`). La diferencia no es un
//      error: es el proveedor que no tenia todo. Pero hay que verla.
//
// Al recibir pasan dos cosas mas, y por eso esto no es solo una lista:
//   - Lo que llego ENTRA al inventario (un movimiento por producto).
//   - El valor de la factura sale como GASTO DE CAJA, que el admin aprueba en
//     el cierre igual que cualquier otro. Asi la plata que salio de la caja
//     queda registrada sola, sin que nadie tenga que acordarse de anotarla.
//
// El catalogo de esta panaderia lo crearon las cajeras vendiendo, son cientos
// de productos y ninguno tiene costo. Por eso aqui NO se calcula ningun total
// a partir de precios: el total lo dicta el vendedor y se escribe tal cual.
// Y por eso la lista de productos de cada proveedor se arma sola con
// `productosDeProveedor()`, leyendo lo que ya se le pidio antes — nadie tiene
// que configurar que vende cada quien.
// ─────────────────────────────────────────────────────────────────────────────

import { firestoreDb } from './firebase'
import {
  doc, collection, updateDoc, serverTimestamp,
  query, where, onSnapshot, orderBy, limit as fsLimit, getDocs,
} from 'firebase/firestore'
import { addDocOffline } from './utils/firestoreOffline'
import { getClientTimestamp } from './utils/network'
import { getBogotaDateStr } from './db'
import { addInventoryMove } from './inventory'
import { createCashExpense } from './cashExpenses'

const ordersCol = () => collection(firestoreDb, 'supplierOrders')
const orderRef = (id) => doc(firestoreDb, 'supplierOrders', id)

/** Estados de un pedido. */
export const ESTADOS = {
  pendiente: { label: 'Esperando',  desc: 'Ya se pidió, todavía no llega' },
  recibido:  { label: 'Recibido',   desc: 'Llegó y se registró en inventario' },
  no_llego:  { label: 'No llegó',   desc: 'El proveedor no lo trajo' },
  cancelado: { label: 'Anulado',    desc: 'Estaba mal escrito y se anuló' },
}

/** Normaliza el nombre de un proveedor para comparar sin tildes ni mayúsculas. */
export function normalizarProveedor(nombre) {
  return (nombre || '').toString()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim().replace(/\s+/g, ' ')
}

/** Suma las cantidades de una lista de items. */
function totalUnidades(items) {
  return (items || []).reduce((a, i) => a + (Number(i.qty) || 0), 0)
}

/**
 * Registra el pedido que acaba de tomar el vendedor.
 *
 * `expectedTotal` es lo que el vendedor dijo de palabra. No se valida contra
 * ningun precio porque los productos no tienen costo cargado, y porque el
 * precio real lo pone el proveedor, no nosotros.
 */
export function createSupplierOrder({
  branchId, supplierName, expectedTotal, expectedDate, items,
  sessionId, byUid, byName, note,
}) {
  const nombre = (supplierName || '').trim()
  if (!branchId || !nombre) throw new Error('Falta la panadería o el proveedor.')
  if (!expectedDate) throw new Error('Falta la fecha en que llega el pedido.')

  const limpios = (items || [])
    .filter(i => i.productId && (Number(i.qty) || 0) > 0)
    .map(i => ({
      productId: i.productId,
      productName: i.productName || '',
      qty: Number(i.qty) || 0,
    }))

  const data = {
    branchId,
    supplierName: nombre,
    supplierKey: normalizarProveedor(nombre),
    expectedTotal: Number(expectedTotal) || 0,
    expectedDate,
    items: limpios,
    status: 'pendiente',
    orderedDate: getBogotaDateStr(),
    createdAt: serverTimestamp(),
    createdAtClient: getClientTimestamp(),
    createdByUid: byUid || null,
    createdByName: byName || null,
    sessionId: sessionId || null,
  }
  if (note?.trim()) data.note = note.trim()

  // Fire-and-forget, igual que las ventas: en modo ahorro de datos `await`
  // se cuelga y dejaria a la cajera esperando con el vendedor al frente.
  const ref = addDocOffline(ordersCol(), data)
  return ref.id
}

/** Suscripción a los pedidos que todavía no han llegado. */
export function watchPendingOrders(callback, branchIds = null, onError = null) {
  const filtros = [where('status', '==', 'pendiente')]
  if (Array.isArray(branchIds) && branchIds.length > 0) {
    filtros.push(where('branchId', 'in', branchIds))
  }
  return onSnapshot(
    query(ordersCol(), ...filtros),
    snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      // Primero lo que llega antes. El orden se hace aqui y no en la consulta
      // para no exigir un indice compuesto mas.
      list.sort((a, b) => (a.expectedDate || '').localeCompare(b.expectedDate || ''))
      callback(list)
      if (onError) onError(null)
    },
    err => {
      console.error('[supplierOrders] watchPendingOrders error:', err)
      if (onError) onError(err)
    }
  )
}

/** Suscripción a los últimos pedidos ya cerrados (recibidos o no llegados). */
export function watchRecentOrders(callback, branchId, max = 30) {
  if (!branchId) { callback([]); return () => {} }
  return onSnapshot(
    query(ordersCol(), where('branchId', '==', branchId),
      orderBy('createdAt', 'desc'), fsLimit(max)),
    snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => {
      console.error('[supplierOrders] watchRecentOrders error:', err)
      callback([])
    }
  )
}

/**
 * Lo que hay que dejar en caja para un dia: los pedidos que se esperan ese dia
 * y los que ya debieron llegar y siguen pendientes (si el proveedor aparece
 * tarde, hay que tener con que pagarle).
 *
 * Devuelve el desglose por proveedor, no solo el total, porque el dueño
 * necesita saber a quien le va a pagar — un numero suelto no le sirve para
 * decidir si le alcanza.
 */
export function plataParaProveedores(pedidos, fecha = getBogotaDateStr()) {
  const hoy = (pedidos || []).filter(p => p.expectedDate <= fecha)
  const manana = (pedidos || []).filter(p => p.expectedDate > fecha)
  const suma = l => l.reduce((a, p) => a + (Number(p.expectedTotal) || 0), 0)
  return {
    hoy: {
      total: suma(hoy),
      pedidos: hoy,
      atrasados: hoy.filter(p => p.expectedDate < fecha),
    },
    despues: { total: suma(manana), pedidos: manana },
  }
}

/** Días de atraso de un pedido que no ha llegado. 0 si aún no le toca. */
export function diasDeAtraso(pedido, fecha = getBogotaDateStr()) {
  if (!pedido?.expectedDate || pedido.expectedDate >= fecha) return 0
  const ms = Date.parse(fecha + 'T00:00:00Z') - Date.parse(pedido.expectedDate + 'T00:00:00Z')
  return Math.max(0, Math.round(ms / 86400000))
}

/**
 * Qué productos le compra la panadería a este proveedor, sacado de los pedidos
 * anteriores. Es lo que evita tener que configurar un catálogo por proveedor:
 * la primera vez la cajera escribe lo que pidió, y de ahí en adelante ya le
 * aparece la lista.
 *
 * Se ordena por lo más pedido, que es lo que va a volver a pedir.
 */
export async function productosDeProveedor(branchId, supplierName, max = 40) {
  const key = normalizarProveedor(supplierName)
  if (!branchId || !key) return []
  const snap = await getDocs(query(
    ordersCol(),
    where('branchId', '==', branchId),
    where('supplierKey', '==', key),
    orderBy('createdAt', 'desc'),
    fsLimit(15),
  ))
  const veces = new Map()
  for (const d of snap.docs) {
    // Se cuenta lo PEDIDO, no lo recibido: si el proveedor no trajo algo, la
    // proxima vez igual se le va a volver a pedir.
    for (const i of (d.data().items || [])) {
      if (!i.productId) continue
      const prev = veces.get(i.productId)
      if (prev) prev.n += 1
      else veces.set(i.productId, { productId: i.productId, productName: i.productName || '', n: 1 })
    }
  }
  return [...veces.values()].sort((a, b) => b.n - a.n).slice(0, max)
}

/** Proveedores a los que ya se les ha pedido, para autocompletar. */
export async function proveedoresUsados(branchId, max = 60) {
  if (!branchId) return []
  const snap = await getDocs(query(
    ordersCol(), where('branchId', '==', branchId),
    orderBy('createdAt', 'desc'), fsLimit(120),
  ))
  const vistos = new Map()
  for (const d of snap.docs) {
    const n = d.data().supplierName
    if (n && !vistos.has(normalizarProveedor(n))) vistos.set(normalizarProveedor(n), n)
  }
  return [...vistos.values()].slice(0, max)
}

/**
 * Recibe el pedido: la cajera confirma o corrige lo que llegó y escribe el
 * total de la factura.
 *
 * Hace tres cosas, en este orden y a proposito:
 *
 *   1. Marca el pedido como recibido, guardando lo pedido Y lo recibido. Lo
 *      pedido no se pisa: la comparacion entre los dos es el "descuadre" que
 *      el dueño quiere ver.
 *   2. Mete al inventario lo que llego, un movimiento por producto.
 *   3. Crea el gasto de caja por el valor de la factura, que el admin aprueba
 *      en el cierre como cualquier otro gasto.
 *
 * El gasto se crea de ultimo: si algo falla antes, no queda plata descontada
 * de una mercancia que no se registro. Al reves seria peor.
 */
export async function receiveSupplierOrder(orderId, {
  order, receivedItems, invoiceTotal, sessionId, branchName,
  cashierUid, cashierName, byUid, byName, note,
}) {
  if (!orderId || !order) throw new Error('Pedido no encontrado.')
  if (order.status === 'recibido') return { yaRecibido: true }

  const llegaron = (receivedItems || [])
    .filter(i => i.productId && (Number(i.qty) || 0) > 0)
    .map(i => ({
      productId: i.productId,
      productName: i.productName || '',
      qty: Number(i.qty) || 0,
    }))
  const factura = Number(invoiceTotal) || 0

  await updateDoc(orderRef(orderId), {
    status: 'recibido',
    receivedItems: llegaron,
    invoiceTotal: factura,
    receivedDate: getBogotaDateStr(),
    receivedAt: serverTimestamp(),
    receivedByUid: byUid || null,
    receivedByName: byName || null,
    receivedSessionId: sessionId || null,
    ...(note?.trim() ? { receiveNote: note.trim() } : {}),
  })

  // Entrada al inventario. `addInventoryMove` ya es fire-and-forget y crea el
  // saldo si el producto todavia no se seguia — que es justo como el dueño va
  // a ir metiendo productos al inventario de a poco, sin configurar nada.
  for (const i of llegaron) {
    addInventoryMove({
      branchId: order.branchId,
      productId: i.productId,
      productName: i.productName,
      type: 'entrada',
      qty: i.qty,
      supplierName: order.supplierName,
      note: `Pedido a ${order.supplierName}`,
      byUid, byName,
    })
  }

  // La plata que sale de la caja. Sin esto el inventario cuadraria pero el
  // dinero no, y el turno cerraria con un faltante sin explicacion.
  let cashExpenseId = null
  if (factura > 0 && sessionId) {
    try {
      // Devuelve el id ya generado local (addDocOffline), no una referencia.
      cashExpenseId = await createCashExpense({
        sessionId,
        branchId: order.branchId,
        branchName: branchName || '',
        cashierUid: cashierUid || byUid,
        cashierName: cashierName || byName,
        description: `Pedido a ${order.supplierName}`,
        amount: factura,
      })
      if (cashExpenseId) {
        updateDoc(orderRef(orderId), { cashExpenseId })
          .catch(e => console.warn('[supplierOrders] no se pudo enlazar el gasto:', e?.message || e))
      }
    } catch (err) {
      // El pedido ya quedo recibido y en inventario. Que falle el gasto no
      // puede deshacer eso; se avisa para que alguien lo anote a mano.
      console.error('[supplierOrders] no se pudo crear el gasto de caja:', err)
      return { cashExpenseId: null, gastoFallo: true, faltantes: comparar(order.items, llegaron) }
    }
  }

  return { cashExpenseId, faltantes: comparar(order.items, llegaron) }
}

/**
 * Corrige un pedido que todavía no ha llegado: fecha, total, proveedor o
 * productos. Se equivocaron al teclear, o el vendedor cambió algo después.
 *
 * Solo sobre `pendiente`. Uno ya recibido NO se toca por aquí: detrás tiene
 * una entrada de inventario y un gasto de caja, y cambiarle los números
 * dejaría a los dos sin respaldo. Eso se corrige con un ajuste de inventario.
 *
 * Queda constancia de que se corrigió (`editadoAt`), porque el pedido es lo
 * que después se compara contra lo que llegó: si alguien lo "arregla" para
 * que cuadre, el descuadre desaparece sin que nadie se entere.
 */
export async function updateSupplierOrder(orderId, {
  order, supplierName, expectedTotal, expectedDate, items, byUid, byName,
}) {
  if (!orderId || !order) throw new Error('Pedido no encontrado.')
  if (order.status !== 'pendiente') {
    throw new Error('Este pedido ya se cerró. Solo se pueden corregir los que no han llegado.')
  }
  const nombre = (supplierName || '').trim()
  if (!nombre) throw new Error('Falta el proveedor.')
  if (!expectedDate) throw new Error('Falta la fecha en que llega el pedido.')

  const limpios = (items || [])
    .filter(i => i.productId && (Number(i.qty) || 0) > 0)
    .map(i => ({
      productId: i.productId,
      productName: i.productName || '',
      qty: Number(i.qty) || 0,
    }))
  if (limpios.length === 0) throw new Error('El pedido no puede quedar sin productos.')

  await updateDoc(orderRef(orderId), {
    supplierName: nombre,
    supplierKey: normalizarProveedor(nombre),
    expectedTotal: Number(expectedTotal) || 0,
    expectedDate,
    items: limpios,
    editadoAt: serverTimestamp(),
    editadoPorUid: byUid || null,
    editadoPorNombre: byName || null,
  })
}

/**
 * El pedido estaba mal y se anula. Es DISTINTO de 'no_llego': aquel dice que
 * el proveedor falló, y si se usara para tapar un error de tecleo el
 * proveedor quedaría quedando mal en el historial sin deberlo.
 *
 * No se borra el documento —las reglas solo dejan borrar al admin, y a
 * propósito—: queda con estado 'cancelado', fuera de las cuentas pero con su
 * rastro.
 */
export async function cancelSupplierOrder(orderId, { byUid, byName, note } = {}) {
  await updateDoc(orderRef(orderId), {
    status: 'cancelado',
    closedDate: getBogotaDateStr(),
    closedAt: serverTimestamp(),
    closedByUid: byUid || null,
    closedByName: byName || null,
    ...(note?.trim() ? { closeNote: note.trim() } : {}),
  })
}

/** El proveedor no trajo el pedido. Se cierra sin tocar inventario ni caja. */
export async function markOrderNotArrived(orderId, { byUid, byName, note } = {}) {
  await updateDoc(orderRef(orderId), {
    status: 'no_llego',
    closedDate: getBogotaDateStr(),
    closedAt: serverTimestamp(),
    closedByUid: byUid || null,
    closedByName: byName || null,
    ...(note?.trim() ? { closeNote: note.trim() } : {}),
  })
}

/**
 * Compara lo pedido contra lo recibido. Devuelve solo lo que NO cuadro, que es
 * lo unico que el dueño necesita mirar.
 *
 * `de_mas` incluye los productos que llegaron sin haberse pedido: pasa, y si
 * no se muestran, el inventario sube sin que nadie sepa por que.
 */
export function comparar(pedidos, recibidos) {
  const ped = new Map((pedidos || []).map(i => [i.productId, i]))
  const rec = new Map((recibidos || []).map(i => [i.productId, i]))
  const out = []
  for (const [id, p] of ped) {
    const r = rec.get(id)
    const llego = Number(r?.qty) || 0
    const pedido = Number(p.qty) || 0
    if (llego !== pedido) {
      out.push({
        productId: id,
        productName: p.productName || r?.productName || '',
        pedido, llego, diferencia: llego - pedido,
      })
    }
  }
  for (const [id, r] of rec) {
    if (ped.has(id)) continue
    out.push({
      productId: id,
      productName: r.productName || '',
      pedido: 0, llego: Number(r.qty) || 0, diferencia: Number(r.qty) || 0,
    })
  }
  return out
}

/** Resumen corto de un pedido recibido, para listarlo sin abrirlo. */
export function resumenRecibido(order) {
  if (!order || order.status !== 'recibido') return null
  const dif = comparar(order.items, order.receivedItems)
  return {
    unidadesPedidas: totalUnidades(order.items),
    unidadesRecibidas: totalUnidades(order.receivedItems),
    productosConDiferencia: dif.length,
    diferenciaPlata: (Number(order.invoiceTotal) || 0) - (Number(order.expectedTotal) || 0),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// INVENTARIO DE PRODUCTO TERMINADO
//
// Dos colecciones, a proposito:
//
//   /inventoryMoves/{id}   El libro: cada entrada, salida y ajuste, con quien
//                          lo hizo y cuando. Nunca se edita ni se borra — se
//                          corrige con otro movimiento, para que quede el
//                          rastro de la correccion.
//
//   /inventoryStock/{id}   El saldo actual por producto y panaderia, con
//                          id `${branchId}__${productId}`.
//
// El saldo se guarda en vez de recalcularse sumando el libro entero: leer
// todos los movimientos en cada pantalla es justo lo que agotaba la cuota
// diaria de Firestore en los reportes. Se actualiza con `increment()`, que es
// atomico del lado del servidor: si dos personas registran una entrada al
// mismo tiempo, no se pisan.
//
// NO vive en /todypan/data (el documento unico) porque los movimientos crecen
// sin techo y ese documento tiene un limite duro de 1 MB.
//
// LAS VENTAS DESCUENTAN SOLAS (`descontarVenta`). Antes no lo hacian, y el
// motivo escrito aqui era que el sistema no sabe cuanta harina lleva un pan.
// Eso vale para el pan, no para una gaseosa: una gaseosa vendida es una
// gaseosa menos, y esta panaderia es sobre todo reventa. Sin descontar, el
// saldo mentia todos los dias y cualquier conteo daba un faltante falso.
//
// No hacen falta recetas: lo que el dueño hornea lo registra como ENTRADA,
// igual que si se lo hubiera traido un proveedor. Todo entra por un lado y
// sale por el otro, venga del horno o del camion.
//
// Un producto se empieza a seguir cuando se le registra su PRIMERA entrada.
// Antes de eso las ventas no lo tocan (ver `descontarVenta`). Sin esa regla,
// el dia que esto se publique los cientos de productos del catalogo se irian
// a negativo de golpe — se han vendido siempre, pero nunca se registro que
// entraran— y la pantalla quedaria inservible. Asi el inventario arranca
// vacio y crece a medida que se van metiendo productos, sin configurar nada.
//
// Las ventas NO escriben en el libro de movimientos, solo bajan el saldo. Un
// renglon por linea vendida serian cientos al dia: el libro quedaria
// ilegible y ademas gasta cuota, que es el cuello de botella de este
// proyecto. Lo vendido ya queda registrado en `sales`.
// ─────────────────────────────────────────────────────────────────────────────

import { firestoreDb } from './firebase'
import {
  doc, collection, setDoc, updateDoc, increment, serverTimestamp,
  query, where, onSnapshot, orderBy, limit as fsLimit,
} from 'firebase/firestore'
import { addDocOffline } from './utils/firestoreOffline'
import { getClientTimestamp } from './utils/network'
import { getBogotaDateStr } from './db'

const movesCol = () => collection(firestoreDb, 'inventoryMoves')
const stockRef = (branchId, productId) =>
  doc(firestoreDb, 'inventoryStock', `${branchId}__${productId}`)

/** Tipos de movimiento. `ajuste` admite cantidad negativa; los otros no. */
export const MOVE_TYPES = {
  entrada: { label: 'Entrada', sign: +1, desc: 'Llegó del proveedor' },
  salida:  { label: 'Salida',  sign: -1, desc: 'Merma, daño, consumo o traslado' },
  ajuste:  { label: 'Ajuste',  sign: +1, desc: 'Corrección tras un conteo físico' },
}

/** Cuanto suma (o resta) un movimiento al saldo. */
export function moveDelta(type, qty) {
  const n = Number(qty) || 0
  const sign = MOVE_TYPES[type]?.sign ?? 1
  // En 'ajuste' la cantidad ya viene con signo (puede ser negativa).
  return type === 'ajuste' ? n : Math.abs(n) * sign
}

/**
 * Registra un movimiento y actualiza el saldo.
 *
 * Se escribe primero el saldo y despues el libro, ambos fire-and-forget: en
 * modo ahorro de datos `await` se cuelga indefinidamente y dejaria el boton
 * atrapado en "Guardando...". Firestore encola las escrituras y las resuelve
 * cuando vuelva la red, asi que el orden entre ellas no se pierde.
 */
export function addInventoryMove({
  branchId, productId, productName, type, qty,
  unitCost, supplierName, note, byUid, byName,
}) {
  const delta = moveDelta(type, qty)
  if (!branchId || !productId || !delta) return null

  const data = {
    date: getBogotaDateStr(),
    branchId,
    productId,
    productName: productName || '',
    type,
    qty: Number(qty) || 0,
    delta,
    createdAt: serverTimestamp(),
    createdAtClient: getClientTimestamp(),
    createdByUid: byUid || null,
    createdByName: byName || null,
  }
  if (Number(unitCost) > 0) data.unitCost = Number(unitCost)
  if (supplierName) data.supplierName = supplierName
  if (note?.trim()) data.note = note.trim()

  // merge:true + increment crea el documento de saldo si aun no existe.
  setDoc(stockRef(branchId, productId), {
    branchId,
    productId,
    productName: productName || '',
    qty: increment(delta),
    updatedAt: serverTimestamp(),
  }, { merge: true }).catch(e => console.warn('[inventory] saldo diferido:', e?.message || e))

  const ref = addDocOffline(movesCol(), data)
  return ref.id
}

/**
 * Baja del saldo lo que se acaba de vender. También sirve para devolverlo
 * (`signo = +1`) cuando se elimina o se edita una venta.
 *
 * Usa `updateDoc` y NO `setDoc({merge:true})`, y esa diferencia ES la regla de
 * negocio: `updateDoc` falla si el documento de saldo no existe, o sea si a
 * ese producto nunca se le registro una entrada. Asi las ventas solo tocan los
 * productos que el dueño ya metio al inventario, y el resto del catalogo
 * queda quieto en vez de irse a numeros negativos.
 *
 * El fallo se traga a proposito: no es un error, es "este producto todavia no
 * se sigue". Y no se consulta antes si existe porque eso seria una lectura por
 * linea vendida — cientos al dia, justo lo que agota la cuota.
 *
 * Fire-and-forget, como el resto del punto de venta: la cajera no puede
 * quedarse esperando a que responda el servidor con el cliente al frente.
 */
export function descontarVenta({ branchId, items, signo = -1 }) {
  if (!branchId || !Array.isArray(items)) return
  // Un mismo producto puede venir en varias lineas de la misma venta; se
  // juntan para no hacer dos escrituras al mismo documento.
  const porProducto = new Map()
  for (const i of items) {
    const id = i?.productId
    const qty = Number(i?.qty) || 0
    if (!id || qty <= 0) continue
    porProducto.set(id, (porProducto.get(id) || 0) + qty)
  }
  for (const [productId, qty] of porProducto) {
    updateDoc(stockRef(branchId, productId), {
      qty: increment(signo * qty),
      updatedAt: serverTimestamp(),
    }).catch(() => { /* producto no seguido: correcto, no se toca */ })
  }
}

/** Suscripción a los saldos de una panadería. */
export function watchInventoryStock(branchId, callback) {
  if (!branchId) { callback([]); return () => {} }
  const q = query(collection(firestoreDb, 'inventoryStock'), where('branchId', '==', branchId))
  return onSnapshot(
    q,
    snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      list.sort((a, b) => (a.productName || '').localeCompare(b.productName || '', 'es', { sensitivity: 'base' }))
      callback(list)
    },
    err => {
      console.error('[inventory] watchInventoryStock error:', err)
      callback([])
    }
  )
}

/**
 * Suscripción a los últimos movimientos de una panadería.
 *
 * Va limitada (por defecto 50): el libro crece sin techo y traerlo completo
 * para mostrar las últimas filas es el error que ya costó la cuota de
 * Firestore en otras pantallas.
 *
 * Requiere índice compuesto (branchId + createdAt desc). Si aún no existe,
 * Firestore devuelve failed-precondition; en ese caso caemos a un filtro de
 * campo único y ordenamos en cliente, para que la pantalla no quede en blanco
 * mientras el índice se crea.
 */
export function watchInventoryMoves(branchId, callback, max = 50) {
  if (!branchId) { callback([]); return () => {} }
  const col = collection(firestoreDb, 'inventoryMoves')
  const sortDesc = (list) => list.sort(
    (a, b) => (b.createdAt?.toMillis?.() ?? b.createdAtClient ?? 0)
            - (a.createdAt?.toMillis?.() ?? a.createdAtClient ?? 0)
  )

  let fallback = null
  const stop = onSnapshot(
    query(col, where('branchId', '==', branchId), orderBy('createdAt', 'desc'), fsLimit(max)),
    snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => {
      if (err?.code !== 'failed-precondition') {
        console.error('[inventory] watchInventoryMoves error:', err)
        callback([])
        return
      }
      console.warn('[inventory] sin índice compuesto todavía, ordenando en cliente')
      fallback = onSnapshot(
        query(col, where('branchId', '==', branchId)),
        snap => callback(sortDesc(snap.docs.map(d => ({ id: d.id, ...d.data() }))).slice(0, max)),
        e => { console.error('[inventory] fallback error:', e); callback([]) }
      )
    }
  )
  return () => { stop(); if (fallback) fallback() }
}

/**
 * Suscripción a los saldos de TODAS las panaderías, para el panel de balance.
 *
 * Sin filtro, pero acotada por naturaleza: hay como máximo un documento por
 * producto y panadería, no uno por movimiento. A diferencia del libro, esta
 * colección no crece con el uso.
 */
export function watchInventoryStockAll(callback) {
  return onSnapshot(
    collection(firestoreDb, 'inventoryStock'),
    snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => {
      console.error('[inventory] watchInventoryStockAll error:', err)
      callback([])
    }
  )
}

/** Valor total del inventario a costo, para el panel de balance. */
export function stockValue(stockList, costOf) {
  return stockList.reduce((sum, s) => {
    const qty = Number(s.qty) || 0
    if (qty <= 0) return sum
    return sum + qty * (Number(costOf(s.productId)) || 0)
  }, 0)
}

import { firestoreDb } from './firebase'
import {
  doc,
  collection,
  updateDoc,
  serverTimestamp,
  query,
  where,
  onSnapshot,
  arrayUnion,
  getDoc,
} from 'firebase/firestore'
import { getClientTimestamp } from './utils/network'
import { addDocOffline } from './utils/firestoreOffline'

const saleRef = (id) => doc(firestoreDb, 'sales', id)

const salesCol = () => collection(firestoreDb, 'sales')

/**
 * Devuelve los millis de un doc para ordenar.
 * Prefiere createdAt (server) si ya sincronizo; cae a createdAtClient
 * mientras la venta esta en cola offline.
 */
function timeOf(doc) {
  return doc.createdAt?.toMillis?.() ?? doc.createdAtClient ?? 0
}

/**
 * Crea una venta nueva. payload:
 *  - sessionId, branchId, cashierUid, cashierName
 *  - items: [{ productId, source: 'admin'|'cashier'|'inline', name, qty, unitPrice, subtotal }]
 *  - total
 *  - paymentMethod: 'efectivo' | 'nequi' | 'daviplata' | 'deuda' | 'mixto'
 *  - paymentSplit?  (solo si paymentMethod === 'mixto') ej: { efectivo: 10000, nequi: 5000 }
 *  - cashReceived?  (solo efectivo)
 *  - photoUrl?      (solo nequi/daviplata o mixto con porción digital, Fase 4)
 *  - debtorId?, debtorName?  (solo deuda)
 *  - recordedByUid?, recordedByName?, recordedByRole?
 *      → cuando admin asiste un turno: la venta SE CONTABILIZA a la cajera
 *        (cashierUid de ella) pero se marca quién la registró.
 */
export async function createSale(payload) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
  const data = {
    date: today,
    createdAt: serverTimestamp(),
    createdAtClient: getClientTimestamp(),
    sessionId: payload.sessionId,
    branchId: payload.branchId,
    cashierUid: payload.cashierUid,
    cashierName: payload.cashierName,
    items: payload.items,
    total: Number(payload.total) || 0,
    paymentMethod: payload.paymentMethod,
    status: 'active',
    notes: [],
  }
  if (payload.cashReceived !== undefined && payload.cashReceived !== null) {
    data.cashReceived = Number(payload.cashReceived) || 0
  }
  // Pago dividido: el desglose por método. Solo se guarda si la venta
  // realmente es 'mixto' — para el resto de métodos queda ausente y los
  // consumidores que no conocen split siguen funcionando como antes.
  if (payload.paymentMethod === 'mixto' && payload.paymentSplit) {
    data.paymentSplit = {}
    for (const [m, amt] of Object.entries(payload.paymentSplit)) {
      const a = Number(amt) || 0
      if (a > 0) data.paymentSplit[m] = a
    }
  }
  if (payload.photoUrl) {
    data.photoUrl = payload.photoUrl
    data.photoStatus = 'uploaded'
  } else if (payload.photoLocalId) {
    // Foto encolada en IndexedDB: el worker la subira cuando haya red.
    data.photoStatus = 'pending'
    data.photoLocalId = payload.photoLocalId
  }
  if (payload.debtorId) {
    data.debtorId = payload.debtorId
    data.debtorName = payload.debtorName
  }
  // Modo asistir: admin registra venta en turno de otra persona
  if (payload.recordedByUid && payload.recordedByUid !== payload.cashierUid) {
    data.recordedByUid = payload.recordedByUid
    data.recordedByName = payload.recordedByName || null
    data.recordedByRole = payload.recordedByRole || 'admin'
  }
  // Fire-and-forget: el ID se genera local; la escritura se encola y
  // resuelve cuando haya red. Crítico para modo ahorro de datos donde
  // `await addDoc()` se cuelga indefinidamente.
  const ref = addDocOffline(salesCol(), data)
  return ref.id
}

/**
 * Suscripción a las ventas a crédito asociadas a un deudor específico.
 * Usado por el modal de detalle del deudor para mostrar qué productos
 * compró en cada venta.
 */
export function watchSalesByDebtor(debtorId, callback) {
  if (!debtorId) { callback([]); return () => {} }
  const q = query(salesCol(), where('debtorId', '==', debtorId))
  return onSnapshot(
    q,
    snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      list.sort((a, b) => timeOf(b) - timeOf(a))
      callback(list)
    },
    err => {
      console.error('[sales] watchSalesByDebtor error:', err)
      callback([])
    }
  )
}

/** Suscripción a las ventas de una sesión específica (para vista cajera). */
export function watchSessionSales(sessionId, callback) {
  if (!sessionId) { callback([]); return () => {} }
  const q = query(salesCol(), where('sessionId', '==', sessionId))
  return onSnapshot(
    q,
    snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      // Ordenar por createdAt descendente (más recientes primero)
      // Usa createdAtClient como fallback mientras la venta esta en cola offline.
      list.sort((a, b) => timeOf(b) - timeOf(a))
      callback(list)
    },
    err => {
      console.error('[sales] watchSessionSales error:', err)
      callback([])
    }
  )
}

/**
 * La cajera marca una venta como "tiene un error". Solo añade nota y cambia
 * status a 'flagged'. NO modifica items, total, ni nada del contenido.
 * El admin verá en su pestaña Ventas qué decidir (Fase 7).
 */
export async function flagSale(saleId, { note, byUid, byName }) {
  const newNote = {
    by: byUid,
    byName: byName || null,
    at: Date.now(),
    message: note.trim(),
  }
  // Fire-and-forget para modo ahorro: `await updateDoc` se cuelga y dejaba el
  // modal de "Reportar error" atrapado en "Enviando...". Se encola y sube luego.
  updateDoc(saleRef(saleId), {
    status: 'flagged',
    notes: arrayUnion(newNote),
  }).catch(err => console.warn('[sales] flagSale deferred:', err?.message || err))
}

/**
 * Solo admin: marca una venta como eliminada. Si era deuda, ajusta al deudor
 * (reduce el totalOwed por el monto de la venta).
 *
 * Devuelve el resultado del ajuste de deuda si aplica.
 */
export async function deleteSaleAsAdmin(saleId, { byUid, reason } = {}) {
  const ref = saleRef(saleId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('Venta no encontrada')
  const sale = snap.data()
  if (sale.status === 'deleted') return { alreadyDeleted: true }

  await updateDoc(ref, {
    status: 'deleted',
    deletedAt: serverTimestamp(),
    deletedBy: byUid || null,
    deleteReason: reason || null,
  })
  return { sale }
}

/**
 * Solo admin: edita los items de una venta (cantidades, productos).
 * Recalcula total. Si era deuda, devuelve los datos para que el caller
 * ajuste el deudor.
 *
 * payload: { items, total, byUid, note? }
 */
export async function editSaleItems(saleId, payload) {
  const ref = saleRef(saleId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('Venta no encontrada')
  const sale = snap.data()

  const oldTotal = Number(sale.total) || 0
  const newTotal = Number(payload.total) || 0

  const editEntry = {
    by: payload.byUid || null,
    at: Date.now(),
    oldTotal,
    newTotal,
    note: payload.note || null,
  }

  await updateDoc(ref, {
    items: payload.items,
    total: newTotal,
    editedAt: serverTimestamp(),
    editedBy: payload.byUid || null,
    editHistory: arrayUnion(editEntry),
  })

  return { oldTotal, newTotal, sale }
}

/**
 * Suscripción a las ventas de UNA cajera específica para UN día específico.
 * Usada por la pantalla "Mis ventas" (Fase 9) — historial read-only.
 *
 * Filtramos por cashierUid + date (YYYY-MM-DD, zona Bogotá).
 * Ordena por hora descendente (más reciente primero).
 *
 * IMPORTANTE: aunque las ventas tengan total, la UI debe NO mostrarlo
 * (D21 anti-fraude). Esta función solo trae los docs; el filtrado visual
 * lo hace la pantalla.
 */
export function watchCashierSalesByDate(cashierUid, dateStr, callback) {
  if (!cashierUid || !dateStr) { callback([]); return () => {} }
  const q = query(
    salesCol(),
    where('cashierUid', '==', cashierUid),
    where('date', '==', dateStr),
  )
  return onSnapshot(
    q,
    snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      list.sort((a, b) => timeOf(b) - timeOf(a))
      callback(list)
    },
    err => {
      console.error('[sales] watchCashierSalesByDate error:', err)
      callback([])
    }
  )
}

/**
 * READ-ONLY (diagnóstico admin): todas las ventas de UNA fecha (zona Bogotá),
 * sin importar cajera ni sesión. Sirve para auditar descuadres comparando el
 * `sessionId`/`cashierUid` real de cada venta contra la sesión que el admin
 * cierra. Filtro de campo único (`date`) → Firestore lo indexa solo, no
 * requiere índice compuesto. No muta nada.
 */
export function watchSalesByDate(dateStr, callback) {
  if (!dateStr) { callback([]); return () => {} }
  const q = query(salesCol(), where('date', '==', dateStr))
  return onSnapshot(
    q,
    snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      list.sort((a, b) => timeOf(b) - timeOf(a))
      callback(list)
    },
    err => {
      console.error('[sales] watchSalesByDate error:', err)
      callback([])
    }
  )
}

/** Suscripción a TODAS las ventas (para admin, futuras fases). */
export function watchAllSales(callback) {
  const q = query(salesCol())
  return onSnapshot(
    q,
    snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => {
      console.error('[sales] watchAllSales error:', err)
      callback([])
    }
  )
}

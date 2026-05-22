import { firestoreDb } from './firebase'
import {
  doc,
  collection,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  query,
  where,
  onSnapshot,
} from 'firebase/firestore'
import { addDocOffline } from './utils/firestoreOffline'

/**
 * Mesas abiertas (open tabs) — carrito persistente que la cajera deja como
 * "burbuja" para seguir agregando productos antes de cobrar.
 *
 * Doc shape en /openTabs/{id}:
 *   - sessionId: id de la cashSession activa de la cajera
 *   - cashierUid: uid del cajero dueño
 *   - branchId / branchName
 *   - kind: 'mesa' | 'llevar'  (default 'mesa' para legacy)
 *       'mesa'   → mesa numerada en sitio. Usa tableNumber + tableSuffix.
 *       'llevar' → cliente para llevar (sin mesa). Usa customerName.
 *   - tableNumber?: número base (1, 2, 3…). Para tabs 'mesa'.
 *   - tableSuffix?: sufijo entero >=0 cuando hay mesas con mismo número.
 *       0 (o ausente) = sin sufijo, se muestra "1".
 *       1 = se muestra "1.1". 2 = "1.2". Etc.
 *       Sirve para cuando dos grupos se sientan juntos en una sola mesa
 *       física: la cajera tipea el mismo número y el sistema asigna .1, .2
 *       automáticamente sin combinar las cuentas.
 *   - customerName?: nombre del cliente cuando kind='llevar' (no único — pueden repetirse)
 *   - items: [{ key, productId, source, name, qty, unitPrice, ...campos cocina }]
 *   - total: suma de qty * unitPrice
 *   - createdAt / updatedAt: timestamps
 *
 * Las tabs viven mientras dure la sesión. Al cerrar turno DEBEN estar todas
 * cobradas o eliminadas (validación en CloseTurnModal).
 */

const tabsCol = () => collection(firestoreDb, 'openTabs')
const tabRef = (id) => doc(firestoreDb, 'openTabs', id)

/** Suscripción a las tabs abiertas de una sesión específica. */
export function watchOpenTabsForSession(sessionId, callback) {
  if (!sessionId) { callback([]); return () => {} }
  const q = query(tabsCol(), where('sessionId', '==', sessionId))
  return onSnapshot(
    q,
    snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      // Orden estable:
      //  - mesa primero por número ascendente
      //  - llevar después, por createdAt ascendente (los más viejos primero)
      list.sort((a, b) => {
        const aIsLlevar = (a.kind || 'mesa') === 'llevar'
        const bIsLlevar = (b.kind || 'mesa') === 'llevar'
        if (aIsLlevar !== bIsLlevar) return aIsLlevar ? 1 : -1
        if (!aIsLlevar) return (a.tableNumber || 0) - (b.tableNumber || 0)
        const ta = a.createdAt?.toMillis?.() ?? 0
        const tb = b.createdAt?.toMillis?.() ?? 0
        return ta - tb
      })
      callback(list)
    },
    err => {
      console.error('[openTabs] watchOpenTabsForSession error:', err)
      callback([])
    }
  )
}

/** Calcula total de una lista de items. */
export function computeTabTotal(items) {
  return (items || []).reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0)
}

/** Calcula el siguiente número base libre en una lista de tabs. Solo considera mesas.
 *  Pensado para sugerir "siguiente mesa" — ignora sufijos: si hay 1, 1.1 y 2,
 *  el siguiente libre es 3. */
export function nextFreeTableNumber(tabs) {
  const used = new Set(
    (tabs || [])
      .filter(t => (t.kind || 'mesa') === 'mesa')
      .map(t => Number(t.tableNumber))
      .filter(n => n > 0)
  )
  let n = 1
  while (used.has(n)) n++
  return n
}

/** True si el número base está usado por OTRA tab MESA (excluye una opcional).
 *  ATENCIÓN: con el modelo de sufijos, "ocupado" ya no implica error — la UI
 *  puede asignar un sufijo (1.1, 1.2) al crear. Esta función queda sólo para
 *  mostrarle a la cajera "esta mesa ya tiene gente, se creará como 1.1".
 */
export function isTableNumberTaken(tabs, number, excludeId = null) {
  const num = Number(number)
  if (!num || num <= 0 || !Number.isFinite(num)) return false
  return (tabs || []).some(t => {
    if (t.id === excludeId) return false
    if ((t.kind || 'mesa') !== 'mesa') return false
    const tn = Number(t.tableNumber)
    if (!tn || tn <= 0 || !Number.isFinite(tn)) return false
    return tn === num
  })
}

/** Devuelve el siguiente sufijo libre para un número base dado.
 *    - Si nadie tiene ese número (suffix 0 libre): retorna 0 (sin sufijo).
 *    - Si está tomado, busca 1, 2, 3... y retorna el primero libre.
 *  Ej: hay mesas {1 sin suffix, 1.1, 1.3} → para baseNumber=1 retorna 2.
 */
export function nextTableSuffix(tabs, baseNumber) {
  const base = Number(baseNumber)
  if (!base || base <= 0) return 0
  const used = new Set(
    (tabs || [])
      .filter(t => (t.kind || 'mesa') === 'mesa' && Number(t.tableNumber) === base)
      .map(t => Number(t.tableSuffix) || 0)
  )
  if (!used.has(0)) return 0
  let s = 1
  while (used.has(s)) s++
  return s
}

/** Etiqueta legible de la tab para mostrar en burbujas, headers y cocina.
 *    - llevar: el customerName.
 *    - mesa sin suffix: "5".
 *    - mesa con suffix: "5.1".
 */
export function formatTableLabel(tab) {
  if (!tab) return ''
  if ((tab.kind || 'mesa') === 'llevar') {
    return tab.customerName || 'Cliente'
  }
  const base = Number(tab.tableNumber) || 0
  const suffix = Number(tab.tableSuffix) || 0
  if (!base) return ''
  return suffix > 0 ? `${base}.${suffix}` : String(base)
}

/**
 * Sanea un item para guardarlo en Firestore. Preserva campos opcionales
 * (incluido `kitchenOrderId` y selecciones de almuerzo) sólo si vienen,
 * para que al reabrir la mesa la cajera siga viendo los detalles del
 * almuerzo enviado y se pueda cancelar/entregar la orden de cocina.
 */
function cleanCartItem(it) {
  const out = {
    key: it.key,
    productId: it.productId || null,
    source: it.source || 'inline',
    name: it.name,
    qty: Number(it.qty) || 0,
    unitPrice: Number(it.unitPrice) || 0,
  }
  // Campos opcionales: solo se incluyen si tienen valor para no llenar el
  // doc de claves vacías.
  if (it.kitchenOrderId) out.kitchenOrderId = it.kitchenOrderId
  if (it.kitchenStatus) out.kitchenStatus = it.kitchenStatus
  if (it.lunchKind) out.lunchKind = it.lunchKind
  if (it.lunchDestination) out.lunchDestination = it.lunchDestination
  if (it.lunchSelections) out.lunchSelections = it.lunchSelections
  if (it.lunchDescription) out.lunchDescription = it.lunchDescription
  if (it.lunchProductName) out.lunchProductName = it.lunchProductName
  if (it.commandaNote) out.commandaNote = it.commandaNote
  if (it.freeAmount) out.freeAmount = true
  return out
}

/**
 * Crea una nueva tab con items iniciales.
 *
 * Para kind='mesa': tableNumber requerido y validado contra duplicados (UI).
 * Para kind='llevar': customerName requerido (puede repetirse — solo etiqueta).
 *
 * Si el admin la crea asistiendo el turno de una cajera, pasar
 * recordedByUid/Name/Role para registrar quién la creó.
 */
export async function createOpenTab({
  sessionId, cashierUid, branchId, branchName,
  kind, tableNumber, tableSuffix, customerName,
  items,
  recordedByUid, recordedByName, recordedByRole,
  openedByUid, openedByName, openedByRole,
}) {
  const tabKind = kind === 'llevar' ? 'llevar' : 'mesa'
  const cleanItems = (items || []).map(cleanCartItem)
  const data = {
    sessionId,
    cashierUid,
    branchId: branchId ?? null,
    branchName: branchName || null,
    kind: tabKind,
    items: cleanItems,
    total: computeTabTotal(cleanItems),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }
  // Atribución de quién ABRIÓ la mesa (mesera/cajera). Permite mostrar
  // "Mesa 5 · Laura" en la burbuja y dirigir el aviso de "listo" a la mesera.
  if (openedByUid) {
    data.openedByUid = openedByUid
    data.openedByName = openedByName || null
    data.openedByRole = openedByRole || 'cashier'
  }
  if (tabKind === 'mesa') {
    data.tableNumber = Number(tableNumber) || 1
    // tableSuffix: 0 = sin sufijo, 1+ = sufijo. Solo persistir si > 0 para
    // no llenar el doc con campos vacíos en el caso normal.
    const sfx = Number(tableSuffix) || 0
    if (sfx > 0) data.tableSuffix = sfx
  } else {
    // Cliente sin nombre cae a "Cliente" — la cajera puede editar después.
    data.customerName = (customerName || '').trim() || 'Cliente'
  }
  if (recordedByUid && recordedByUid !== cashierUid) {
    data.recordedByUid = recordedByUid
    data.recordedByName = recordedByName || null
    data.recordedByRole = recordedByRole || 'admin'
  }
  // Fire-and-forget para modo ahorro / offline.
  const ref = addDocOffline(tabsCol(), data)
  return ref.id
}

/**
 * Actualiza una tab existente. Permite cambiar items, número de mesa
 * (solo kind='mesa') o nombre del cliente (solo kind='llevar').
 * (La UI valida número duplicado antes de llamar.)
 */
export async function updateOpenTab(id, { items, tableNumber, customerName }) {
  const updates = { updatedAt: serverTimestamp() }
  if (Array.isArray(items)) {
    const cleanItems = items.map(cleanCartItem)
    updates.items = cleanItems
    updates.total = computeTabTotal(cleanItems)
  }
  if (tableNumber != null) {
    updates.tableNumber = Number(tableNumber) || 1
  }
  if (customerName != null) {
    updates.customerName = String(customerName).trim() || 'Cliente'
  }
  // Fire-and-forget: en modo ahorro `await updateDoc` se cuelga y dejaba a la
  // cajera atrapada al guardar/salir de una mesa. Se encola y sube con la red.
  updateDoc(tabRef(id), updates).catch(err =>
    console.warn('[openTabs] updateOpenTab deferred:', err?.message || err))
}

/** Elimina una tab (al cobrar o al eliminarla manualmente). */
export async function deleteOpenTab(id) {
  // Fire-and-forget: en modo ahorro `await deleteDoc` se cuelga (mismo motivo
  // que updateOpenTab). La eliminación se encola y se aplica con la red.
  deleteDoc(tabRef(id)).catch(err =>
    console.warn('[openTabs] deleteOpenTab deferred:', err?.message || err))
}

/**
 * Marca una openTab como "huérfana" — sin sesión ni cajera asignada — para
 * que la siguiente cajera que abra turno en la misma panadería la herede
 * automáticamente. Se conserva `branchId` para que la herencia respete la
 * sucursal correcta.
 *
 * Solo el admin debe llamar esto (al cerrar un turno con mesas pendientes).
 */
export async function releaseTabForNextCashier(id, fromSessionId) {
  await updateDoc(tabRef(id), {
    sessionId: null,
    cashierUid: null,
    transferredFromSessionId: fromSessionId || null,
    transferredAt: serverTimestamp(),
  })
}

/**
 * Asigna una openTab huérfana al turno activo de una cajera. Llamado por
 * el admin al abrir un nuevo turno cuando detecta tabs sin dueño en esa
 * panadería.
 */
export async function claimOrphanTab(id, { sessionId, cashierUid }) {
  await updateDoc(tabRef(id), {
    sessionId: sessionId || null,
    cashierUid: cashierUid || null,
    claimedAt: serverTimestamp(),
  })
}

/**
 * Lectura puntual: devuelve las openTabs huérfanas (sin sesión) de una
 * panadería. Usado al abrir un turno para detectar mesas pendientes del
 * turno anterior y heredarlas.
 *
 * Devuelve [] si Firestore no responde — no bloquea el flujo de abrir.
 */
export async function listOrphanTabsForBranch(branchId) {
  if (branchId == null) return []
  try {
    const { getDocs } = await import('firebase/firestore')
    const q = query(
      collection(firestoreDb, 'openTabs'),
      where('branchId', '==', branchId),
      where('sessionId', '==', null),
    )
    const snap = await getDocs(q)
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
  } catch (err) {
    console.warn('[openTabs] listOrphanTabsForBranch falló:', err?.message || err)
    return []
  }
}

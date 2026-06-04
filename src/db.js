import { firestoreDb } from './firebase'
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore'

// ─── Refs ─────────────────────────────────────────────────────
const LOCAL_KEY = 'todypan_v1'
const FS_REF = doc(firestoreDb, 'todypan', 'data')

// ─── Defaults ─────────────────────────────────────────────────
const defaultIncomeCats = [
  { id: 'ventas_mostrador', label: 'Ventas mostrador' },
  { id: 'pedidos',          label: 'Pedidos especiales' },
  { id: 'domicilios',       label: 'Domicilios' },
  { id: 'mayorista',        label: 'Venta mayorista' },
  { id: 'sobra_caja',       label: 'Sobra de cierre' },
  { id: 'ingreso_caja',     label: 'Ingreso de caja' },
]

const defaultExpenseCats = {
  proveedores: [
    { id: 'harina',     label: 'Harina' },
    { id: 'levadura',   label: 'Levadura' },
    { id: 'lacteos',    label: 'Lácteos' },
    { id: 'huevos',     label: 'Huevos' },
    { id: 'frutas',     label: 'Frutas' },
    { id: 'empaques',   label: 'Empaques' },
    { id: 'otros_prov', label: 'Otros insumos' },
  ],
  operacion: [
    { id: 'arriendo',   label: 'Arriendo' },
    { id: 'energia',    label: 'Energía' },
    { id: 'agua',       label: 'Agua' },
    { id: 'gas',        label: 'Gas' },
    { id: 'internet',   label: 'Internet' },
    { id: 'aseo',       label: 'Aseo' },
  ],
  empresa: [
    { id: 'reparacion', label: 'Reparaciones' },
    { id: 'equipo',     label: 'Equipo nuevo' },
    { id: 'mejora',     label: 'Mejoras locativas' },
    { id: 'publicidad', label: 'Publicidad' },
  ],
}

// ─── Base de caja (cashFloor) ────────────────────────────────
// La caja siempre tiene un PISO de efectivo para vueltos. La base se
// asume intacta entre turnos. Si los gastos consumen parte de la base,
// el admin debe reponer (o aceptar que el siguiente turno arranque
// con base reducida).
export const CASH_FLOOR_DEFAULT = 200000

function defaultData() {
  return {
    movements: [],
    employees: [],
    attendance: {},
    reminders: [],
    products: [],
    suppliers: [],            // lista maestra de proveedores { id, name }
    incomeCats: defaultIncomeCats,
    expenseCats: defaultExpenseCats,
    branches: [
      { id: 1, name: 'Panadería Iglesia', colorKey: 'copper' },
      { id: 2, name: 'Panadería Esquina', colorKey: 'sage' },
    ],
    dailyConfirmations: {},
    branchCashFloors: {}, // override por branch si la base bajó y admin no repuso
  }
}

// ─── In-memory store ──────────────────────────────────────────
let _data = null

function migrate(d) {
  if (!d.dailyConfirmations) d.dailyConfirmations = {}
  if (!d.branches) d.branches = defaultData().branches
  if (!d.branchCashFloors) d.branchCashFloors = {}
  if (!d.incomeCats) d.incomeCats = defaultIncomeCats
  // Migrar: agregar 'sobra_caja' si falta (apps con datos previos)
  if (Array.isArray(d.incomeCats) && !d.incomeCats.some(c => c.id === 'sobra_caja')) {
    d.incomeCats = [...d.incomeCats, { id: 'sobra_caja', label: 'Sobra de cierre' }]
  }
  // Migrar: agregar 'ingreso_caja' si falta (ingresos de caja de la cajera)
  if (Array.isArray(d.incomeCats) && !d.incomeCats.some(c => c.id === 'ingreso_caja')) {
    d.incomeCats = [...d.incomeCats, { id: 'ingreso_caja', label: 'Ingreso de caja' }]
  }
  if (!d.expenseCats) d.expenseCats = defaultExpenseCats
  // Migración legacy: si quedó la categoría 'nomina', la quitamos
  if (d.expenseCats?.operacion) {
    d.expenseCats.operacion = d.expenseCats.operacion.filter(c => c.id !== 'nomina')
  }
  if (!d.attendance) d.attendance = {}
  if (!d.reminders) d.reminders = []
  if (!d.products) d.products = []
  if (!Array.isArray(d.suppliers)) d.suppliers = []
  // Migracion a precios por panaderia (modelo nuevo): se borra salePrice
  // antiguo asi cada cajera ingresa el precio real la primera vez en su
  // panaderia. Si un producto YA tiene pricesByBranch, no se toca.
  if (!d._pricesByBranchMigrated) {
    d.products = (d.products || []).map(p => {
      if (p.pricesByBranch && typeof p.pricesByBranch === 'object') return p
      const { salePrice, ...rest } = p
      return { ...rest, pricesByBranch: {} }
    })
    d._pricesByBranchMigrated = true
  }
  // Migrar colorKey a branches existentes sin color
  const defaultColors = ['copper', 'sage']
  d.branches = d.branches.map((b, i) => b.colorKey ? b : { ...b, colorKey: defaultColors[i] || 'copper' })
  return d
}

// ─── Init (async) ─────────────────────────────────────────────
export async function initDB() {
  // 1. Try Firestore
  try {
    const snap = await getDoc(FS_REF)
    if (snap.exists()) {
      _data = migrate(snap.data())
      try { localStorage.setItem(LOCAL_KEY, JSON.stringify(_data)) } catch {}
      return
    }
  } catch (e) {
    console.warn('[TodyPan] Firestore no disponible, usando caché local:', e.message)
  }

  // 2. Fallback: localStorage
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    if (raw) {
      _data = migrate(JSON.parse(raw))
      // Subir datos locales a Firestore
      const clean = JSON.parse(JSON.stringify(_data))
      setDoc(FS_REF, clean).catch(() => {})
      return
    }
  } catch {}

  // 3. Datos vacíos
  _data = defaultData()
  const clean = JSON.parse(JSON.stringify(_data))
  setDoc(FS_REF, clean).catch(() => {})
}

export function getData() { return _data || defaultData() }

/**
 * Suscripción EN VIVO al doc compartido /todypan/data. Necesaria porque los
 * productos del admin (y demás datos compartidos) viven aquí y antes solo se
 * leían una vez al arrancar: un cambio del admin (ej. aprobar el nuevo precio
 * de un producto) NO llegaba a la tablet de la cajera hasta recargar la app.
 *
 * Cada snapshot refresca `_data` y la caché local, y avisa por callback para
 * que la UI se vuelva a pintar. Ignora los snapshots de nuestras PROPIAS
 * escrituras aún sin confirmar (hasPendingWrites): ya tenemos ese estado en
 * memoria y re-aplicarlo solo causaría parpadeo.
 */
export function watchSharedData(callback) {
  return onSnapshot(
    FS_REF,
    snap => {
      if (!snap.exists()) return
      if (snap.metadata.hasPendingWrites) return // eco de nuestra propia escritura
      _data = migrate(snap.data())
      try { localStorage.setItem(LOCAL_KEY, JSON.stringify(_data)) } catch {}
      if (typeof callback === 'function') callback(_data)
    },
    err => console.warn('[TodyPan] watchSharedData:', err?.message || err),
  )
}

function persist() {
  if (!_data) return
  // Guarda local inmediatamente
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(_data)) } catch {}
  // Guarda en Firestore sin esperar (elimina undefined)
  const clean = JSON.parse(JSON.stringify(_data))
  setDoc(FS_REF, clean).catch(e => console.warn('[TodyPan] Error Firestore:', e.message))
}

// ─── Tiempo Bogotá (UTC-5) ────────────────────────────────────
export function getBogotaDate() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }))
}
export function getBogotaDateStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
}
export function getBogotaHour() {
  return getBogotaDate().getHours()
}

// ─── Movimientos ─────────────────────────────────────────────
export function getMovements() { return _data.movements }

export function addMovement(mov) {
  const id = 'm' + Date.now()
  _data.movements = [{ id, ...mov }, ..._data.movements]
  persist()
  return id
}

export function deleteMovement(id) {
  _data.movements = _data.movements.filter(m => m.id !== id)
  persist()
}

// ─── Empleados ────────────────────────────────────────────────
export function getEmployees() { return _data.employees }

export function addEmployee(emp) {
  const id = 'e' + Date.now()
  _data.employees = [..._data.employees, { type: 'regular', ...emp, id }]
  persist()
  return id
}

export function updateEmployee(id, updates) {
  _data.employees = _data.employees.map(e => e.id === id ? { ...e, ...updates } : e)
  persist()
}

export function deleteEmployee(id) {
  _data.employees = _data.employees.filter(e => e.id !== id)
  persist()
}

// ─── Recordatorios ────────────────────────────────────────────
export function getReminders() { return _data.reminders }

export function addReminder(rem) {
  const id = 'r' + Date.now()
  _data.reminders = [..._data.reminders, { id, paid: false, ...rem }]
  persist()
  return id
}

export function updateReminder(id, updates) {
  _data.reminders = _data.reminders.map(r => r.id === id ? { ...r, ...updates } : r)
  persist()
}

export function deleteReminder(id) {
  _data.reminders = _data.reminders.filter(r => r.id !== id)
  persist()
}

export function toggleReminderPaid(id) {
  const r = _data.reminders.find(x => x.id === id)
  if (!r) return

  if (!r.paid && r.recurring === 'monthly') {
    // Para recurrentes: guardar fecha de último pago y avanzar al próximo mes
    r.lastPaid = r.due
    const [y, m, d] = r.due.split('-').map(Number)
    // m es 1-indexed → new Date(y, m, d) usa m como índice 0-based = siguiente mes ✓
    const next = new Date(y, m, d)
    r.due = next.toLocaleDateString('en-CA')
    r.paid = false // queda pendiente para el próximo ciclo
  } else {
    r.paid = !r.paid
  }
  persist()
}

// ─── Productos ────────────────────────────────────────────────
// Modelo: { id, name, pricesByBranch: { [branchId]: number }, packageCost,
//          byPackage, branch, notes, active }
// pricesByBranch puede estar vacio: significa que el producto existe en el
// catalogo pero ninguna cajera ha definido su precio aun. Al usarlo por primera
// vez en una panaderia se le pide a la cajera que ingrese el precio.

export function getProducts() { return _data.products }

export function addProduct(prod) {
  const id = 'p' + Date.now()
  const safe = { ...prod }
  // Asegurar que pricesByBranch existe como objeto
  if (!safe.pricesByBranch || typeof safe.pricesByBranch !== 'object') {
    safe.pricesByBranch = {}
  }
  // Eliminar campo legacy salePrice si llegara
  delete safe.salePrice
  _data.products = [..._data.products, { id, active: true, ...safe }]
  persist()
  return id
}

export function updateProduct(id, updates) {
  const clean = { ...updates }
  // Bloquear escritura del campo legacy
  delete clean.salePrice
  _data.products = _data.products.map(p => p.id === id ? { ...p, ...clean } : p)
  persist()
}

export function deleteProduct(id) {
  _data.products = _data.products.filter(p => p.id !== id)
  persist()
}

/**
 * Establece el precio de un producto admin para una panaderia especifica.
 * Si price es null/undefined/0, elimina el precio para esa panaderia.
 */
// setBy (opcional): { name, role } de quién fija el precio. Se guarda en
// priceSetByBranch[branchId] para poder mostrar "Panadería X (Cajera/Admin)".
export function setProductPriceForBranch(productId, branchId, price, setBy = null) {
  const key = String(branchId)
  _data.products = _data.products.map(p => {
    if (p.id !== productId) return p
    const next = { ...(p.pricesByBranch || {}) }
    const nextSetBy = { ...(p.priceSetByBranch || {}) }
    const num = Number(price)
    if (!num || num <= 0) {
      delete next[key]
      delete nextSetBy[key]
    } else {
      next[key] = num
      if (setBy && setBy.name) nextSetBy[key] = { name: setBy.name, role: setBy.role || 'cashier' }
    }
    return { ...p, pricesByBranch: next, priceSetByBranch: nextSetBy }
  })
  persist()
}

/** Devuelve el precio de un producto en una panaderia, o null si no esta definido. */
export function getProductPriceForBranch(product, branchId) {
  if (!product) return null
  const key = String(branchId)
  const v = product.pricesByBranch?.[key]
  return v && Number(v) > 0 ? Number(v) : null
}

// ─── Categorías ───────────────────────────────────────────────
export function getIncomeCats() { return _data.incomeCats }
export function getExpenseCats() { return _data.expenseCats }
export function setIncomeCats(cats) { _data.incomeCats = cats; persist() }
export function setExpenseCats(cats) { _data.expenseCats = cats; persist() }

// ─── Proveedores (lista maestra para clasificar productos) ────────
export function getSuppliers() { return _data.suppliers || [] }
export function setSuppliers(list) { _data.suppliers = list; persist() }
// Crea un proveedor si no existe (match por nombre, case-insensitive) y
// devuelve su id. Idempotente: si ya existe, devuelve el id existente.
export function ensureSupplier(name) {
  const clean = String(name || '').trim()
  if (!clean) return null
  const list = _data.suppliers || []
  const found = list.find(s => s.name.toLowerCase() === clean.toLowerCase())
  if (found) return found.id
  const id = 'sup_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)
  _data.suppliers = [...list, { id, name: clean }]
  persist()
  return id
}

// ─── Panaderías ───────────────────────────────────────────────
export function getBranches() { return _data.branches }

export function updateBranch(id, updates) {
  _data.branches = _data.branches.map(b => b.id === id ? { ...b, ...updates } : b)
  persist()
}

// ─── CashFloor (base de caja) ────────────────────────────────
// REGLA DE NEGOCIO: la base es FIJA en CASH_FLOOR_DEFAULT ($200.000)
// para TODAS las panaderías, siempre. No hay overrides por sucursal.
//
// Antes existía `branchCashFloors` (override por panadería) que se podía
// bajar en un cierre. Eso anclaba la base en valores erróneos (ej. $115k)
// y rompía la lógica de "sobra/falta". Ahora getCashFloor IGNORA por
// completo cualquier override viejo que haya quedado en la data — se
// vuelve data muerta inofensiva.

/** Devuelve la base de caja. SIEMPRE el default — sin overrides. */
export function getCashFloor(_branchId) {
  return CASH_FLOOR_DEFAULT
}

/**
 * No-op conservado por compatibilidad: cashSessions.js aún lo llama al
 * cerrar un turno. Como la base es fija, limpiar el override viejo (si
 * lo hay) es lo único útil — así la data se va auto-limpiando sola.
 */
export function setCashFloor(branchId, _value) {
  if (branchId == null || !_data?.branchCashFloors) return
  const key = String(branchId)
  if (_data.branchCashFloors[key] !== undefined) {
    delete _data.branchCashFloors[key]
    persist()
  }
}

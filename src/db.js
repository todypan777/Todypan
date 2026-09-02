import { firestoreDb } from './firebase'
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore'
import { createMovement, removeMovement } from './movements'

// ─── Refs ─────────────────────────────────────────────────────
const LOCAL_KEY = 'todypan_v1'
const FS_REF = doc(firestoreDb, 'todypan', 'data')

// ─── Normalización de categorías ──────────────────────────────
// Clave de comparación: ignora tildes y espacios (inicio/final e internos) y
// mayúsculas. Así "Inicio ", "Inició" y "inicio" se tratan como la misma.
export function normalizeCatKey(s) {
  return String(s || '')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')   // quita tildes
    .trim().replace(/\s+/g, ' ')                        // colapsa espacios
    .toLowerCase()
}

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

// ─── Cuentas del administrador (Nequi / Daviplata / Efectivo / ...) ──
// Saldos que el admin lleva a mano ("chetar"): puede fijar el saldo exacto,
// sumar ingresos, restar egresos y crear cuentas nuevas. Viven en el doc
// compartido /todypan/data bajo `accounts`.
// Cada cuenta guarda solo su IDENTIDAD y sus AJUSTES manuales (adjustments).
// El SALDO es DERIVADO: ajustes manuales + suma de los movimientos globales
// asignados a la cuenta (accountId). No se guarda saldo duplicado, así
// alimentar la cuenta desde "Nuevo movimiento" no cuesta escrituras extra.
const defaultAccounts = [
  { id: 'acc_nequi',     name: 'Nequi',     emoji: '📱', colorKey: 'burgundy', adjustments: [] },
  { id: 'acc_daviplata', name: 'Daviplata', emoji: '📱', colorKey: 'ocean',    adjustments: [] },
  { id: 'acc_efectivo',  name: 'Efectivo',  emoji: '💵', colorKey: 'sage',     adjustments: [] },
]

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
    accounts: defaultAccounts.map(a => ({ ...a, adjustments: [] })),
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

// ─── Movimientos: dos fuentes, una sola lista ─────────────────
//
// Los movimientos HISTORICOS viven dentro de /todypan/data (el documento
// compartido). Los NUEVOS van a la coleccion /movements, donde cada uno es su
// propio documento — eso arregla la perdida de datos entre dos
// administradores, permite separar por panaderia y quita el techo de 1 MB.
//
// No se migra nada: reescribir el documento compartido mientras hay gente
// trabajando dentro es exactamente como se pierden datos. Las dos fuentes se
// presentan unidas en `_data.movements`, asi que TODA la app sigue leyendo de
// donde siempre y no hubo que tocar ninguna pantalla.
let _legacyMovements = []   // los de /todypan/data (solo lectura de aqui en adelante)
let _newMovements = []      // los de la coleccion /movements

function remergeMovements() {
  if (!_data) return
  _data.movements = [..._newMovements, ..._legacyMovements]
}

/** Adopta un snapshot del documento compartido separando lo historico. */
function adoptData(d) {
  _data = d
  _legacyMovements = Array.isArray(d.movements) ? d.movements : []
  remergeMovements()
}

/** La suscripcion a /movements entrega aqui su resultado. */
export function setCollectionMovements(list) {
  _newMovements = Array.isArray(list) ? list : []
  remergeMovements()
}

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
  // Cuentas del admin: sembrar las 3 por defecto si nunca existieron.
  if (!Array.isArray(d.accounts)) d.accounts = defaultAccounts.map(a => ({ ...a, adjustments: [] }))
  // Migrar modelo viejo (balance + movements) → adjustments. Si una cuenta
  // traía un balance guardado, lo convertimos en un ajuste 'set' inicial para
  // no perderlo. El campo `movements` viejo se reutiliza como adjustments.
  d.accounts = d.accounts.map(a => {
    if (Array.isArray(a.adjustments)) {
      const { balance, movements, ...rest } = a
      return { ...rest, adjustments: a.adjustments }
    }
    const adjustments = Array.isArray(a.movements) ? a.movements : []
    const { balance, movements, ...rest } = a
    // Si había balance guardado y no quedó rastro en adjustments, sembrarlo.
    if ((balance || 0) !== 0 && adjustments.length === 0) {
      adjustments.push({
        id: 'mv_seed_' + a.id, type: 'set', amount: Number(balance) || 0,
        note: 'Saldo inicial', date: getBogotaDateStr(), createdAt: 0,
      })
    }
    return { ...rest, adjustments }
  })
  // Migración legacy: si quedó la categoría 'nomina', la quitamos
  if (d.expenseCats?.operacion) {
    d.expenseCats.operacion = d.expenseCats.operacion.filter(c => c.id !== 'nomina')
  }
  // Unificar categorías de movimientos de cuenta que son la misma salvo tildes
  // o espacios (ej. "Inicio " e "Inició" → una sola etiqueta canónica).
  if (Array.isArray(d.movements)) {
    const groups = new Map() // key normalizada → Map(label → conteo)
    for (const m of d.movements) {
      if (!m.accountId || !m.cat) continue
      const key = normalizeCatKey(m.cat)
      if (!key) continue
      if (!groups.has(key)) groups.set(key, new Map())
      const label = String(m.cat).trim().replace(/\s+/g, ' ')
      const lm = groups.get(key)
      lm.set(label, (lm.get(label) || 0) + 1)
    }
    if (groups.size) {
      const canon = new Map()
      for (const [key, lm] of groups) {
        // Etiqueta canónica: la más usada; empate → orden alfabético.
        const best = [...lm.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'))[0]
        canon.set(key, best[0])
      }
      d.movements = d.movements.map(m => {
        if (!m.accountId || !m.cat) return m
        const c = canon.get(normalizeCatKey(m.cat))
        return (c && c !== m.cat) ? { ...m, cat: c } : m
      })
    }
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
      adoptData(migrate(snap.data()))
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
      adoptData(migrate(JSON.parse(raw)))
      // Subir datos locales a Firestore
      const clean = JSON.parse(JSON.stringify(_data))
      setDoc(FS_REF, clean).catch(() => {})
      return
    }
  } catch {}

  // 3. Datos vacíos
  adoptData(defaultData())
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
      adoptData(migrate(snap.data()))
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
  // Guarda en Firestore sin esperar (elimina undefined).
  //
  // OJO: `_data.movements` es la lista UNIDA (historicos + los de la coleccion
  // /movements). Escribirla tal cual meteria los nuevos DENTRO del documento
  // compartido y quedarian duplicados: una vez en la coleccion y otra aqui.
  // Por eso se sustituye por los historicos, que son los unicos que de verdad
  // viven en este documento.
  const clean = JSON.parse(JSON.stringify({ ..._data, movements: _legacyMovements }))
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

/**
 * Registra un movimiento en la coleccion /movements.
 *
 * Antes se anexaba al arreglo dentro de /todypan/data. Aunque se hiciera de
 * forma atomica, ese arreglo seguia sin poder separarse por panaderia (las
 * reglas de Firestore aplican por documento completo) y seguia creciendo contra
 * el techo de 1 MB. En una coleccion cada movimiento es su propio documento y
 * los tres problemas desaparecen.
 *
 * Se agrega tambien a la lista en memoria para que la UI responda de inmediato;
 * la suscripcion lo confirma un instante despues.
 */
export function addMovement(mov, actor = {}) {
  const id = createMovement(mov, actor)
  _newMovements = [{ id, ...mov }, ..._newMovements]
  remergeMovements()
  return id
}

/**
 * Elimina un movimiento, de donde sea que viva.
 *
 * Los nuevos se borran como documento suelto. Los historicos siguen dentro del
 * documento compartido, asi que ahi toca reescribirlo — con el riesgo de
 * siempre, que desaparece a medida que los viejos dejen de usarse.
 */
export function deleteMovement(id) {
  const nuevo = _newMovements.find(m => m.id === id)
  if (nuevo) {
    removeMovement(nuevo)
    _newMovements = _newMovements.filter(m => m.id !== id)
    remergeMovements()
    return
  }
  _legacyMovements = _legacyMovements.filter(m => m.id !== id)
  remergeMovements()
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

// ─── Cuentas del administrador ───────────────────────────────
// Modelo de cuenta (solo identidad + ajustes manuales):
//   { id, name, emoji, colorKey, adjustments: [
//       { id, type: 'in'|'out'|'set', amount, note, date, createdAt }
//   ] }
//
// SALDO = DERIVADO, nunca se guarda:
//   saldo = baseline(adjustments) + Σ(movimientos globales con accountId)
//
//   - baseline(adjustments): recorre los ajustes manuales en orden cronológico;
//     'set' fija la base, 'in' suma, 'out' resta. Esto es la parte que el admin
//     toca a mano dentro de la pestaña Cuentas (reconciliación / "chetar").
//   - movimientos globales: cada movimiento creado con "Nuevo movimiento" que
//     tenga accountId = esta cuenta. Ingreso suma, gasto resta.
//
// Ventaja: editar/borrar un movimiento recalcula el saldo solo (es derivado) y
// asignar un movimiento a una cuenta NO escribe nada extra (es el mismo doc).

export function getAccounts() { return _data?.accounts || [] }

/** Efecto de un movimiento global sobre su cuenta: ingreso +, gasto −. */
function movementEffect(m) {
  const amt = Number(m.amount) || 0
  return m.type === 'income' ? amt : -amt
}

/** Movimientos globales asignados a una cuenta (los del botón Nuevo movimiento). */
export function getAccountAssignedMovements(accountId) {
  return (_data?.movements || []).filter(m => m.accountId === accountId)
}

/** Suma neta de los movimientos globales asignados a la cuenta. */
export function getAccountAssignedSum(accountId) {
  return getAccountAssignedMovements(accountId).reduce((s, m) => s + movementEffect(m), 0)
}

// ─── Limpieza de "Reposición de base" (cierres viejos) ──────────
// Antes, al cerrar un turno con la caja por debajo de la base, el sistema
// SIEMPRE generaba un gasto de "Reposición de base" sobre Efectivo, asumiendo
// que el admin reponía. Como muchas veces no se reponía nada, esos gastos
// bajaron el saldo de Efectivo sin que se moviera plata real. Estas funciones
// permiten revertirlos en lote. Su firma exacta es cat 'Cierre de Caja' +
// type 'expense' (el ingreso de "lo que se llevó" es type 'income' y NO se toca).

/** Movimientos de "Reposición de base" asignados a una cuenta (gastos de cierre). */
export function getBaseRepositionMovements(accountId) {
  return (_data?.movements || []).filter(m =>
    m.accountId === accountId &&
    m.type === 'expense' &&
    m.cat === 'Cierre de Caja'
  )
}

/**
 * Borra de una sola vez todos los movimientos de "Reposición de base" de una
 * cuenta (una sola escritura). El saldo es derivado, así que al borrarlos el
 * saldo se corrige solo. Devuelve { count, total } de lo revertido.
 */
export function deleteBaseRepositionMovements(accountId) {
  const targets = getBaseRepositionMovements(accountId)
  if (targets.length === 0) return { count: 0, total: 0 }
  const total = targets.reduce((s, m) => s + (Number(m.amount) || 0), 0)
  const ids = new Set(targets.map(m => m.id))

  // Los de la colección se borran como documentos sueltos, y cada uno tiene
  // que revertir su efecto sobre el saldo de la cuenta.
  const nuevos = _newMovements.filter(m => ids.has(m.id))
  nuevos.forEach(removeMovement)
  _newMovements = _newMovements.filter(m => !ids.has(m.id))

  // Los históricos salen del documento compartido en una sola escritura, y
  // solo se escribe si de verdad había alguno.
  const antes = _legacyMovements.length
  _legacyMovements = _legacyMovements.filter(m => !ids.has(m.id))

  remergeMovements()
  if (_legacyMovements.length !== antes) persist()

  return { count: targets.length, total }
}

/** Base manual: recorre los ajustes en orden cronológico (set fija, in/out ajustan). */
function baselineFromAdjustments(adjustments) {
  const chrono = [...(adjustments || [])].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
  let bal = 0
  for (const m of chrono) {
    if (m.type === 'set') bal = Number(m.amount) || 0
    else if (m.type === 'in') bal += Math.abs(Number(m.amount) || 0)
    else if (m.type === 'out') bal -= Math.abs(Number(m.amount) || 0)
  }
  return bal
}

/** Saldo DERIVADO de una cuenta = base manual + movimientos asignados. */
export function getAccountBalance(account) {
  if (!account) return 0
  return baselineFromAdjustments(account.adjustments) + getAccountAssignedSum(account.id)
}

export function addAccount({ name, emoji = '💳', colorKey = 'copper', balance = 0 } = {}) {
  const clean = String(name || '').trim()
  if (!clean) return null
  const id = 'acc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)
  const initial = Number(balance) || 0
  const account = {
    id, name: clean, emoji: emoji || '💳', colorKey: colorKey || 'copper',
    adjustments: initial !== 0
      ? [{ id: 'mv_' + Date.now(), type: 'set', amount: initial,
           note: 'Saldo inicial', date: getBogotaDateStr(), createdAt: Date.now() }]
      : [],
  }
  _data.accounts = [...(_data.accounts || []), account]
  persist()
  return id
}

export function updateAccount(id, updates) {
  const clean = { ...updates }
  // La identidad sí (nombre/emoji/color); el saldo se toca con los ajustes.
  delete clean.adjustments
  delete clean.balance
  if (clean.name != null) clean.name = String(clean.name).trim()
  _data.accounts = (_data.accounts || []).map(a => a.id === id ? { ...a, ...clean } : a)
  persist()
}

export function deleteAccount(id) {
  _data.accounts = (_data.accounts || []).filter(a => a.id !== id)
  persist()
}

/**
 * Fija el saldo EXACTO de una cuenta (chetar / reconciliar). Como el saldo es
 * derivado, guardamos un ajuste 'set' cuyo valor compensa los movimientos ya
 * asignados, de modo que el saldo resultante sea exactamente `balance`.
 */
export function setAccountBalance(id, balance, note = '') {
  const target = Number(balance) || 0
  _data.accounts = (_data.accounts || []).map(a => {
    if (a.id !== id) return a
    const assigned = getAccountAssignedSum(a.id)
    const setValue = target - assigned // baseline necesario para que saldo = target
    const mv = {
      id: 'mv_' + Date.now(), type: 'set', amount: setValue,
      note: note || 'Saldo ajustado', date: getBogotaDateStr(), createdAt: Date.now(),
    }
    return { ...a, adjustments: [mv, ...(a.adjustments || [])] }
  })
  persist()
}

/** Ajuste manual: suma (in) o resta (out) directo sobre la base de la cuenta. */
export function addAccountMovement(id, { type, amount, note = '' }) {
  const amt = Math.abs(Number(amount) || 0)
  if (amt <= 0 || (type !== 'in' && type !== 'out')) return
  _data.accounts = (_data.accounts || []).map(a => {
    if (a.id !== id) return a
    const mv = {
      id: 'mv_' + Date.now(), type, amount: amt,
      note: note || '', date: getBogotaDateStr(), createdAt: Date.now(),
    }
    return { ...a, adjustments: [mv, ...(a.adjustments || [])] }
  })
  persist()
}

/** Borra un ajuste manual. El saldo se recalcula solo (es derivado). */
export function deleteAccountMovement(accountId, adjustmentId) {
  _data.accounts = (_data.accounts || []).map(a =>
    a.id !== accountId
      ? a
      : { ...a, adjustments: (a.adjustments || []).filter(m => m.id !== adjustmentId) }
  )
  persist()
}

// ─── Control automático de transferencias: fecha de inicio ────
// "Arrancar desde hoy": la conciliación automática y el rojo/señalado solo
// aplican desde el día en que se activó el control. Se fija la primera vez
// que se usa (al abrir Transferencias o al conciliar) y se persiste.
export function getTransfersStartDate() {
  return _data?.transfersStartDate || null
}
export function ensureTransfersStartDate() {
  if (!_data) return null
  if (!_data.transfersStartDate) {
    _data.transfersStartDate = getBogotaDateStr()
    persist()
  }
  return _data.transfersStartDate
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

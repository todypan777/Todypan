import { firestoreDb } from './firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'

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
    { id: 'nomina',     label: 'Nómina' },
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

function defaultData() {
  return {
    movements: [],
    employees: [],
    attendance: {},
    reminders: [],
    products: [],
    incomeCats: defaultIncomeCats,
    expenseCats: defaultExpenseCats,
    branches: [
      { id: 1, name: 'Panadería Iglesia', colorKey: 'copper' },
      { id: 2, name: 'Panadería Esquina', colorKey: 'sage' },
    ],
    dailyConfirmations: {},
  }
}

// ─── In-memory store ──────────────────────────────────────────
let _data = null

function migrate(d) {
  if (!d.dailyConfirmations) d.dailyConfirmations = {}
  if (!d.branches) d.branches = defaultData().branches
  if (!d.incomeCats) d.incomeCats = defaultIncomeCats
  // Migrar: agregar 'sobra_caja' si falta (apps con datos previos)
  if (Array.isArray(d.incomeCats) && !d.incomeCats.some(c => c.id === 'sobra_caja')) {
    d.incomeCats = [...d.incomeCats, { id: 'sobra_caja', label: 'Sobra de cierre' }]
  }
  if (!d.expenseCats) d.expenseCats = defaultExpenseCats
  // Migrar: agregar 'nomina' a operacion si falta
  if (d.expenseCats?.operacion && !d.expenseCats.operacion.some(c => c.id === 'nomina')) {
    d.expenseCats.operacion = [{ id: 'nomina', label: 'Nómina' }, ...d.expenseCats.operacion]
  }
  if (!d.attendance) d.attendance = {}
  if (!d.reminders) d.reminders = []
  if (!d.products) d.products = []
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

// ─── Cálculo de horas ─────────────────────────────────────────
export function calcHourRate(empRate, workHours = 9) {
  return Math.round((empRate / workHours) / 50) * 50
}
export function calcExtraPay(hourRate, extraHours) {
  return Math.round((hourRate * extraHours) / 50) * 50
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
  const mov = _data.movements.find(m => m.id === id)
  // Si es un movimiento de nomina, sincronizar: despagar el dia para no
  // dejar attendance.paid=true sin gasto registrado.
  if (mov?.payrollRef) {
    const { empId, workedDate } = mov.payrollRef
    const a = _data.attendance[empId]?.[workedDate]
    if (a) {
      a.paid = false
      delete a.payrollMovementId
    }
  }
  _data.movements = _data.movements.filter(m => m.id !== id)
  persist()
}

// ─── Empleados ────────────────────────────────────────────────
export function getEmployees() { return _data.employees }

export function addEmployee(emp) {
  const id = 'e' + Date.now()
  _data.employees = [..._data.employees, { workHours: 9, type: 'regular', ...emp, id }]
  _data.attendance[id] = {}
  persist()
  return id
}

export function updateEmployee(id, updates) {
  _data.employees = _data.employees.map(e => e.id === id ? { ...e, ...updates } : e)
  persist()
}

export function deleteEmployee(id) {
  _data.employees = _data.employees.filter(e => e.id !== id)
  delete _data.attendance[id]
  persist()
}

// ─── Asistencia ───────────────────────────────────────────────
export function getAttendance() { return _data.attendance }

export function toggleWorked(empId, date) {
  if (!_data.attendance[empId]) _data.attendance[empId] = {}
  const att = _data.attendance[empId]
  if (att[date]) {
    delete att[date]
  } else {
    att[date] = { worked: true, extras: 0, extraHours: 0, paid: false }
  }
  persist()
}

export function setAttendanceEntry(empId, date, data) {
  if (!_data.attendance[empId]) _data.attendance[empId] = {}
  if (data === null) {
    delete _data.attendance[empId][date]
  } else {
    _data.attendance[empId][date] = { ..._data.attendance[empId][date], ...data }
  }
  persist()
}

// ─── Helpers: pago de nómina como movimiento de gasto ─────────
// Cada día pagado de un empleado crea un movimiento expense (cat: 'nomina')
// con fecha del día del pago (Bogotá). Despagar borra ese movimiento.
function _shortDate(dateStr) {
  try {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })
  } catch {
    return dateStr
  }
}

function _buildPayrollMovement(empId, workedDate) {
  const emp = _data.employees.find(e => e.id === empId)
  if (!emp) return null
  const a = _data.attendance[empId]?.[workedDate]
  if (!a) return null
  const amount = (Number(emp.rate) || 0) + (Number(a.extras) || 0)
  if (amount <= 0) return null
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
  const firstName = (emp.name || 'empleado').split(' ')[0]
  return {
    type: 'expense',
    amount,
    date: today,
    cat: 'nomina',
    group: 'operacion',
    branch: emp.branch || 'both',
    note: `Pago nómina · ${firstName} · ${_shortDate(workedDate)}`,
    payrollRef: { empId, workedDate },
    origin: 'nomina',
  }
}

function _addPayrollMovementForDay(empId, workedDate) {
  const a = _data.attendance[empId]?.[workedDate]
  if (!a || a.paid) return
  const mov = _buildPayrollMovement(empId, workedDate)
  if (!mov) { a.paid = true; return }
  const id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  _data.movements = [{ id, ...mov }, ..._data.movements]
  a.paid = true
  a.payrollMovementId = id
}

function _removePayrollMovementForDay(empId, workedDate) {
  const a = _data.attendance[empId]?.[workedDate]
  if (!a) return
  const movId = a.payrollMovementId
    || _data.movements.find(m => m.payrollRef?.empId === empId && m.payrollRef?.workedDate === workedDate)?.id
  if (movId) {
    _data.movements = _data.movements.filter(m => m.id !== movId)
  }
  a.paid = false
  delete a.payrollMovementId
}

export function togglePaid(empId, date) {
  const a = _data.attendance[empId]?.[date]
  if (!a) return
  if (a.paid) {
    _removePayrollMovementForDay(empId, date)
  } else {
    _addPayrollMovementForDay(empId, date)
  }
  persist()
}

export function payAllPending(empId, month) {
  const att = _data.attendance[empId] || {}
  Object.keys(att).forEach(d => {
    const a = att[d]
    if (d.startsWith(month) && a.worked && !a.paid) {
      _addPayrollMovementForDay(empId, d)
    }
  })
  persist()
}

export function setExtras(empId, date, amount) {
  const a = _data.attendance[empId]?.[date]
  if (a) { a.extras = amount; persist() }
}

// ─── Confirmación diaria ──────────────────────────────────────
export function isDayConfirmed(date) {
  return !!_data.dailyConfirmations[date]
}

export function confirmDay(date, entries) {
  entries.forEach(entry => {
    if (!_data.attendance[entry.empId]) _data.attendance[entry.empId] = {}
    const emp = _data.employees.find(e => e.id === entry.empId)
    if (!emp) return

    if (entry.worked) {
      const hourRate = calcHourRate(emp.rate, emp.workHours || 9)
      const extras = entry.extraHours !== 0 ? calcExtraPay(hourRate, entry.extraHours) : 0
      _data.attendance[entry.empId][date] = {
        worked: true,
        extras,
        extraHours: entry.extraHours || 0,
        paid: false,
        confirmedAt: Date.now(),
      }
    } else {
      delete _data.attendance[entry.empId][date]
    }
  })

  entries.forEach(entry => {
    if (!entry.worked && entry.replacedBy) {
      const replacerEmp = _data.employees.find(e => e.id === entry.replacedBy)
      if (replacerEmp) {
        if (!_data.attendance[entry.replacedBy]) _data.attendance[entry.replacedBy] = {}
        const hourRate = calcHourRate(replacerEmp.rate, replacerEmp.workHours || 9)
        const extras = entry.replacerExtraHours ? calcExtraPay(hourRate, entry.replacerExtraHours) : 0
        _data.attendance[entry.replacedBy][date] = {
          worked: true,
          extras,
          extraHours: entry.replacerExtraHours || 0,
          paid: false,
          replacedFor: entry.empId,
          confirmedAt: Date.now(),
        }
      }
    }
  })

  _data.dailyConfirmations[date] = true
  persist()
}

export function getScheduledEmployees(date) {
  const d = new Date(date + 'T00:00:00')
  const dayOfWeek = d.getDay()
  return _data.employees.filter(e => {
    if (e.type === 'occasional') return false
    return e.restDay !== dayOfWeek
  })
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
export function getProducts() { return _data.products }

export function addProduct(prod) {
  const id = 'p' + Date.now()
  _data.products = [..._data.products, { id, active: true, ...prod }]
  persist()
  return id
}

export function updateProduct(id, updates) {
  _data.products = _data.products.map(p => p.id === id ? { ...p, ...updates } : p)
  persist()
}

export function deleteProduct(id) {
  _data.products = _data.products.filter(p => p.id !== id)
  persist()
}

// ─── Categorías ───────────────────────────────────────────────
export function getIncomeCats() { return _data.incomeCats }
export function getExpenseCats() { return _data.expenseCats }
export function setIncomeCats(cats) { _data.incomeCats = cats; persist() }
export function setExpenseCats(cats) { _data.expenseCats = cats; persist() }

// ─── Panaderías ───────────────────────────────────────────────
export function getBranches() { return _data.branches }

export function updateBranch(id, updates) {
  _data.branches = _data.branches.map(b => b.id === id ? { ...b, ...updates } : b)
  persist()
}

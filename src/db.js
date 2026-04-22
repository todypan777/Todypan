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

function defaultData() {
  return {
    movements: [],
    employees: [],
    attendance: {},
    reminders: [],
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
  if (!d.expenseCats) d.expenseCats = defaultExpenseCats
  if (!d.attendance) d.attendance = {}
  if (!d.reminders) d.reminders = []
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

export function togglePaid(empId, date) {
  const a = _data.attendance[empId]?.[date]
  if (a) { a.paid = !a.paid; persist() }
}

export function payAllPending(empId, month) {
  const att = _data.attendance[empId] || {}
  Object.entries(att).forEach(([d, a]) => {
    if (d.startsWith(month) && a.worked && !a.paid) a.paid = true
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
  if (r) { r.paid = !r.paid; persist() }
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

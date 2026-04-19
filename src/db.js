// localStorage persistence layer — all data lives here

const KEY = 'todypan_v1'

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return null
}

function save(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {}
}

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
      { id: 1, name: 'Panadería Iglesia' },
      { id: 2, name: 'Panadería Esquina' },
    ],
  }
}

let _data = load() || defaultData()

export function getData() { return _data }

function persist() { save(_data) }

// ─── Movements ───────────────────────────────────────────────
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

// ─── Employees ───────────────────────────────────────────────
export function getEmployees() { return _data.employees }

export function addEmployee(emp) {
  const id = 'e' + Date.now()
  _data.employees = [..._data.employees, { id, ...emp }]
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

// ─── Attendance ──────────────────────────────────────────────
export function getAttendance() { return _data.attendance }

export function toggleWorked(empId, date) {
  if (!_data.attendance[empId]) _data.attendance[empId] = {}
  const att = _data.attendance[empId]
  if (att[date]) {
    delete att[date]
  } else {
    att[date] = { worked: true, extras: 0, paid: false }
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

// ─── Reminders ───────────────────────────────────────────────
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

// ─── Categories ──────────────────────────────────────────────
export function getIncomeCats() { return _data.incomeCats }
export function getExpenseCats() { return _data.expenseCats }

export function setIncomeCats(cats) { _data.incomeCats = cats; persist() }
export function setExpenseCats(cats) { _data.expenseCats = cats; persist() }

// ─── Branches ────────────────────────────────────────────────
export function getBranches() { return _data.branches }

export function updateBranch(id, name) {
  _data.branches = _data.branches.map(b => b.id === id ? { ...b, name } : b)
  persist()
}

import { useState, useEffect, useMemo } from 'react'
import { T } from '../tokens'
import { Card, BackButton, Modal, InputField, EmptyState, UserAvatar } from '../components/Atoms'
import { ScreenHeader } from '../components/Nav'
import { updateEmployee, deleteEmployee, getData } from '../db'
import { watchAllUsers, rejectPendingUser } from '../users'
import { useAuth } from '../context/AuthCtx'
import { ApprovalModal, ConfirmUserModal } from './Users'
import {
  watchShiftsForDate,
  createScheduledShift,
  updateScheduledShift,
  deleteScheduledShift,
} from '../scheduledShifts'
import { fmtDate } from '../utils/format'

// ──────────────────────────────────────────────────────────────
// Vista principal: Turnos del día (con navegador de fecha).
// Sub-vista: "Administrar personal" (lista de empleados + pendientes).
// ──────────────────────────────────────────────────────────────
export default function Team({ employees, onRefresh, initialEmpId, onClearEmpId }) {
  // Si llegamos con initialEmpId (desde Dashboard "Ir a empleado"), abre
  // directamente la sub-vista de personal.
  const [view, setView] = useState(initialEmpId ? 'personal' : 'shifts')

  if (view === 'personal') {
    return (
      <PersonalManager
        employees={employees}
        onRefresh={onRefresh}
        initialEmpId={initialEmpId}
        onClearEmpId={onClearEmpId}
        onBack={() => setView('shifts')}
      />
    )
  }

  return (
    <ShiftsView
      employees={employees}
      onOpenPersonal={() => setView('personal')}
    />
  )
}

// ──────────────────────────────────────────────────────────────
// VISTA DE TURNOS (default al entrar a Equipo)
// ──────────────────────────────────────────────────────────────
function todayStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
}

function addDaysStr(dateStr, delta) {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + delta)
  return d.toISOString().slice(0, 10)
}

const ROLE_OPTIONS = [
  { id: 'cash', label: 'Caja' },
  { id: 'kitchen', label: 'Cocina' },
  { id: 'waitress', label: 'Domiciliaria / Mesera' },
]

function roleLabel(id) {
  return ROLE_OPTIONS.find(r => r.id === id)?.label || id
}

function fmt12h(time24) {
  if (!time24) return ''
  const [h, m] = time24.split(':').map(Number)
  if (Number.isNaN(h)) return time24
  const period = h >= 12 ? 'pm' : 'am'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${m.toString().padStart(2, '0')} ${period}`
}

// Fecha completa en español para el mensaje de WhatsApp.
// Ej: "miércoles 20 de mayo de 2026"
function fmtDateLong(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const days = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
  const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
  return `${days[d.getDay()]} ${d.getDate()} de ${months[d.getMonth()]} de ${d.getFullYear()}`
}

function ShiftsView({ employees, onOpenPersonal }) {
  const today = todayStr()
  const [date, setDate] = useState(today)
  const [shifts, setShifts] = useState([])
  const [showAssign, setShowAssign] = useState(false)
  const [editingShift, setEditingShift] = useState(null)

  useEffect(() => watchShiftsForDate(date, setShifts), [date])

  function changeDate(delta) {
    setDate(d => addDaysStr(d, delta))
  }

  function jumpToToday() {
    setDate(today)
  }

  const isToday = date === today
  const isFuture = date > today
  const isPast = date < today

  // Agrupar por panadería para la vista y el WhatsApp.
  const byBranch = useMemo(() => {
    const map = new Map()
    for (const s of shifts) {
      const key = String(s.branchId ?? 'none')
      if (!map.has(key)) map.set(key, { branchId: s.branchId, branchName: s.branchName || 'Sin panadería', items: [] })
      map.get(key).items.push(s)
    }
    return Array.from(map.values())
  }, [shifts])

  function handleShare() {
    if (shifts.length === 0) return
    const dateLabel = fmtDateLong(date)
    let msg = `*Turnos del ${dateLabel}*\n`
    for (const group of byBranch) {
      msg += `\n*${group.branchName}*\n`
      for (const s of group.items) {
        msg += `• ${s.personName} — ${roleLabel(s.role)} — ${fmt12h(s.startTime)} a ${fmt12h(s.endTime)}\n`
      }
    }
    const url = `https://wa.me/?text=${encodeURIComponent(msg.trim())}`
    window.open(url, '_blank', 'noopener')
  }

  const displayDate = fmtDate(date, { weekday: true })

  return (
    <div style={{ paddingBottom: 110 }}>
      <ScreenHeader
        title="Equipo"
        right={(
          <button
            onClick={onOpenPersonal}
            title="Administrar personal"
            style={{
              padding: '8px 12px', borderRadius: 999,
              background: '#fff', color: T.neutral[700],
              border: `1px solid ${T.neutral[200]}`,
              cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 12, fontWeight: 700,
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 22 22" fill="none">
              <circle cx="8" cy="8" r="3" stroke={T.neutral[600]} strokeWidth="1.7" fill="none"/>
              <path d="M2 18 Q2 12 8 12 Q14 12 14 18" stroke={T.neutral[600]} strokeWidth="1.7" fill="none"/>
              <circle cx="15" cy="7" r="2.3" stroke={T.neutral[600]} strokeWidth="1.5" fill="none"/>
              <path d="M13 13 Q15 11.5 17 12.5 Q20 13.5 20 17" stroke={T.neutral[600]} strokeWidth="1.5" fill="none"/>
            </svg>
            Personal
          </button>
        )}
      />

      {/* Navegador de fecha */}
      <div style={{ padding: '0 16px 12px' }}>
        <div style={{ borderRadius: 18, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <div style={{
            background: T.neutral[900], padding: '14px 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
          }}>
            <button onClick={() => changeDate(-1)} style={navBtn} title="Día anterior">
              <svg width="8" height="14" viewBox="0 0 8 14"><path d="M6 1 L1 7 L6 13" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: T.copper[300], letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 4 }}>
                {isToday ? 'Hoy' : isFuture ? 'Próximamente' : 'Pasado'}
              </div>
              <div style={{ fontSize: 17, fontWeight: 700, color: '#fff', textTransform: 'capitalize', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {displayDate}
              </div>
              {!isToday && (
                <button
                  onClick={jumpToToday}
                  style={{
                    marginTop: 4, padding: '2px 8px', borderRadius: 999,
                    background: 'rgba(255,255,255,0.12)', color: T.copper[300],
                    border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                    fontSize: 10, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase',
                  }}
                >
                  Ir a hoy
                </button>
              )}
            </div>
            <button onClick={() => changeDate(1)} style={navBtn} title="Día siguiente">
              <svg width="8" height="14" viewBox="0 0 8 14"><path d="M2 1 L7 7 L2 13" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </div>
        </div>
      </div>

      {/* Acciones del día */}
      <div style={{ padding: '0 16px 16px', display: 'flex', gap: 10 }}>
        <button
          onClick={() => setShowAssign(true)}
          style={{
            flex: 1, padding: '12px', borderRadius: 14,
            background: T.copper[500], color: '#fff',
            border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 14, fontWeight: 700,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            boxShadow: '0 2px 6px rgba(184,122,86,0.3)',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 12 12"><path d="M6 1 V11 M1 6 H11" stroke="#fff" strokeWidth="2" strokeLinecap="round"/></svg>
          Asignar turno
        </button>
        <button
          onClick={handleShare}
          disabled={shifts.length === 0}
          title={shifts.length === 0 ? 'No hay turnos para compartir' : 'Compartir por WhatsApp'}
          style={{
            padding: '12px 14px', borderRadius: 14,
            background: shifts.length > 0 ? '#25D366' : T.neutral[200],
            color: shifts.length > 0 ? '#fff' : T.neutral[400],
            border: 'none',
            cursor: shifts.length > 0 ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit',
            fontSize: 13, fontWeight: 700,
            display: 'inline-flex', alignItems: 'center', gap: 6,
            boxShadow: shifts.length > 0 ? '0 2px 6px rgba(37,211,102,0.35)' : 'none',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20.5 3.5A11.8 11.8 0 0 0 12 0C5.4 0 0 5.4 0 12c0 2.1.6 4.2 1.7 6L0 24l6.2-1.6c1.7 1 3.7 1.5 5.8 1.5h0c6.6 0 12-5.4 12-12 0-3.2-1.2-6.2-3.5-8.4zM12 22c-1.8 0-3.6-.5-5.1-1.4l-.4-.2-3.7 1 1-3.6-.2-.4A9.9 9.9 0 0 1 2 12C2 6.5 6.5 2 12 2s10 4.5 10 10-4.5 10-10 10z"/>
          </svg>
          WhatsApp
        </button>
      </div>

      {/* Lista de turnos */}
      {shifts.length === 0 ? (
        <div style={{ padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 36 }}>📅</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: T.neutral[600], marginTop: 12 }}>
            Sin turnos asignados
          </div>
          <div style={{ fontSize: 12.5, color: T.neutral[400], marginTop: 6 }}>
            {isPast ? 'No quedaron registros de este día.' : 'Toca "Asignar turno" para empezar.'}
          </div>
        </div>
      ) : (
        <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {byBranch.map(group => (
            <div key={group.branchId ?? 'none'}>
              <div style={{
                fontSize: 11, fontWeight: 700, color: T.neutral[500],
                letterSpacing: 0.5, textTransform: 'uppercase',
                paddingLeft: 4, marginBottom: 8,
              }}>
                {group.branchName} · {group.items.length}
              </div>
              <Card padding={0}>
                {group.items.map((s, i) => (
                  <div
                    key={s.id}
                    onClick={() => setEditingShift(s)}
                    style={{
                      padding: '14px 16px', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 12,
                      borderBottom: i < group.items.length - 1 ? `0.5px solid ${T.neutral[100]}` : 'none',
                    }}
                  >
                    <div style={{
                      width: 40, height: 40, borderRadius: 999,
                      background: T.copper[50],
                      color: T.copper[700],
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, fontSize: 14, flexShrink: 0,
                    }}>
                      {(s.personName || '?').split(' ').map(p => p[0]).slice(0, 2).join('')}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14.5, fontWeight: 700, color: T.neutral[900] }}>
                        {s.personName}
                      </div>
                      <div style={{ fontSize: 12, color: T.neutral[500], marginTop: 2, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{
                          padding: '2px 7px', borderRadius: 999,
                          background: T.copper[50], color: T.copper[700],
                          fontSize: 10, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase',
                        }}>
                          {roleLabel(s.role)}
                        </span>
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {fmt12h(s.startTime)} a {fmt12h(s.endTime)}
                        </span>
                      </div>
                    </div>
                    <svg width="7" height="12" viewBox="0 0 7 12">
                      <path d="M1 1 L6 6 L1 11" stroke={T.neutral[300]} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                ))}
              </Card>
            </div>
          ))}
        </div>
      )}

      {showAssign && (
        <AssignShiftModal
          date={date}
          employees={employees}
          onCancel={() => setShowAssign(false)}
          onSaved={() => setShowAssign(false)}
        />
      )}

      {editingShift && (
        <EditShiftModal
          shift={editingShift}
          employees={employees}
          onCancel={() => setEditingShift(null)}
          onSaved={() => setEditingShift(null)}
        />
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Mini modal: Asignar turno
// ──────────────────────────────────────────────────────────────
function AssignShiftModal({ date, employees, onCancel, onSaved }) {
  const { authUser } = useAuth()
  const branches = getData().branches || []

  const [employeeId, setEmployeeId] = useState('')
  const [branchId, setBranchId] = useState(branches[0]?.id || '')
  const [role, setRole] = useState('cash')
  const [startTime, setStartTime] = useState('07:00')
  const [endTime, setEndTime] = useState('15:00')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const selectedEmp = employees.find(e => e.id === employeeId)
  const selectedBranch = branches.find(b => b.id === branchId)
  const validHours = startTime && endTime && endTime > startTime
  const canSave = !busy && employeeId && branchId && role && validHours

  async function handleSave() {
    if (!canSave) return
    setBusy(true); setError(null)
    try {
      await createScheduledShift({
        date,
        employeeId,
        personName: selectedEmp.name,
        branchId: selectedBranch.id,
        branchName: selectedBranch.name,
        role,
        startTime,
        endTime,
        createdBy: authUser?.uid || null,
      })
      onSaved()
    } catch (err) {
      console.error(err)
      setError('No pudimos guardar el turno. Intenta de nuevo.')
      setBusy(false)
    }
  }

  return (
    <Modal onClose={busy ? undefined : onCancel} title={`Asignar turno · ${fmtDate(date, { weekday: true })}`}>
      <ShiftFormFields
        employees={employees}
        branches={branches}
        employeeId={employeeId} setEmployeeId={setEmployeeId}
        branchId={branchId} setBranchId={setBranchId}
        role={role} setRole={setRole}
        startTime={startTime} setStartTime={setStartTime}
        endTime={endTime} setEndTime={setEndTime}
        disabled={busy}
      />

      {!validHours && startTime && endTime && (
        <div style={hintStyle('warn')}>
          La hora de fin debe ser después de la de inicio.
        </div>
      )}
      {error && <div style={hintStyle('bad')}>{error}</div>}

      <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
        <button onClick={onCancel} disabled={busy} style={btnSecondary}>
          Cancelar
        </button>
        <button
          onClick={handleSave}
          disabled={!canSave}
          style={{
            ...btnPrimary,
            flex: 1.4,
            background: canSave ? T.copper[500] : T.neutral[200],
            color: canSave ? '#fff' : T.neutral[400],
            cursor: canSave ? 'pointer' : 'not-allowed',
            boxShadow: canSave ? '0 3px 10px rgba(184,122,86,0.3)' : 'none',
          }}
        >
          {busy ? 'Guardando...' : 'Asignar turno'}
        </button>
      </div>
    </Modal>
  )
}

// ──────────────────────────────────────────────────────────────
// Modal: Editar / eliminar turno asignado
// ──────────────────────────────────────────────────────────────
function EditShiftModal({ shift, employees, onCancel, onSaved }) {
  const branches = getData().branches || []
  const [employeeId, setEmployeeId] = useState(shift.employeeId || '')
  const [branchId, setBranchId] = useState(shift.branchId ?? '')
  const [role, setRole] = useState(shift.role || 'cash')
  const [startTime, setStartTime] = useState(shift.startTime || '07:00')
  const [endTime, setEndTime] = useState(shift.endTime || '15:00')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const selectedEmp = employees.find(e => e.id === employeeId)
  const selectedBranch = branches.find(b => b.id === branchId)
  const validHours = startTime && endTime && endTime > startTime
  const canSave = !busy && employeeId && branchId && role && validHours && selectedEmp && selectedBranch

  async function handleSave() {
    if (!canSave) return
    setBusy(true); setError(null)
    try {
      await updateScheduledShift(shift.id, {
        employeeId,
        personName: selectedEmp.name,
        branchId: selectedBranch.id,
        branchName: selectedBranch.name,
        role,
        startTime,
        endTime,
      })
      onSaved()
    } catch (err) {
      console.error(err)
      setError('No pudimos guardar los cambios.')
      setBusy(false)
    }
  }

  async function handleDelete() {
    setBusy(true); setError(null)
    try {
      await deleteScheduledShift(shift.id)
      onSaved()
    } catch (err) {
      console.error(err)
      setError('No pudimos eliminar el turno.')
      setBusy(false)
      setConfirmDelete(false)
    }
  }

  if (confirmDelete) {
    return (
      <Modal onClose={busy ? undefined : () => setConfirmDelete(false)} title="¿Eliminar turno?">
        <div style={{ fontSize: 14, color: T.neutral[500], marginBottom: 24, lineHeight: 1.5 }}>
          Se eliminará el turno asignado a <b>{shift.personName}</b>.
        </div>
        {error && <div style={hintStyle('bad')}>{error}</div>}
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => setConfirmDelete(false)} disabled={busy} style={btnSecondary}>
            Cancelar
          </button>
          <button onClick={handleDelete} disabled={busy} style={{
            ...btnPrimary, flex: 1,
            background: T.bad, color: '#fff', boxShadow: 'none',
            cursor: busy ? 'wait' : 'pointer',
          }}>
            {busy ? 'Eliminando...' : 'Eliminar'}
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal onClose={busy ? undefined : onCancel} title="Editar turno">
      <ShiftFormFields
        employees={employees}
        branches={branches}
        employeeId={employeeId} setEmployeeId={setEmployeeId}
        branchId={branchId} setBranchId={setBranchId}
        role={role} setRole={setRole}
        startTime={startTime} setStartTime={setStartTime}
        endTime={endTime} setEndTime={setEndTime}
        disabled={busy}
      />

      {!validHours && startTime && endTime && (
        <div style={hintStyle('warn')}>
          La hora de fin debe ser después de la de inicio.
        </div>
      )}
      {error && <div style={hintStyle('bad')}>{error}</div>}

      <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
        <button
          onClick={() => setConfirmDelete(true)}
          disabled={busy}
          style={{
            padding: '12px 14px', borderRadius: 12, border: `1px solid #E8C4BC`,
            background: '#FBF0EE', color: T.bad,
            cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
            fontSize: 14, fontWeight: 600,
          }}
        >
          Eliminar
        </button>
        <button
          onClick={handleSave}
          disabled={!canSave}
          style={{
            ...btnPrimary, flex: 1,
            background: canSave ? T.copper[500] : T.neutral[200],
            color: canSave ? '#fff' : T.neutral[400],
            cursor: canSave ? 'pointer' : 'not-allowed',
            boxShadow: canSave ? '0 3px 10px rgba(184,122,86,0.3)' : 'none',
          }}
        >
          {busy ? 'Guardando...' : 'Guardar'}
        </button>
      </div>
    </Modal>
  )
}

// ──────────────────────────────────────────────────────────────
// Campos compartidos por Asignar y Editar
// ──────────────────────────────────────────────────────────────
function ShiftFormFields({
  employees, branches,
  employeeId, setEmployeeId,
  branchId, setBranchId,
  role, setRole,
  startTime, setStartTime,
  endTime, setEndTime,
  disabled,
}) {
  return (
    <>
      <FieldLabel>Empleado</FieldLabel>
      <select
        value={employeeId}
        onChange={e => setEmployeeId(e.target.value)}
        disabled={disabled}
        style={selectStyle}
      >
        <option value="">Selecciona...</option>
        {employees.map(emp => (
          <option key={emp.id} value={emp.id}>{emp.name}</option>
        ))}
      </select>
      {employees.length === 0 && (
        <div style={{ fontSize: 11.5, color: T.bad, marginTop: 4, marginBottom: 8 }}>
          No hay empleados en el equipo todavía.
        </div>
      )}

      <FieldLabel>Panadería</FieldLabel>
      <select
        value={branchId}
        onChange={e => setBranchId(Number(e.target.value))}
        disabled={disabled}
        style={selectStyle}
      >
        {branches.map(b => (
          <option key={b.id} value={b.id}>{b.name}</option>
        ))}
      </select>

      <FieldLabel>Rol del día</FieldLabel>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 14 }}>
        {ROLE_OPTIONS.map(opt => {
          const active = role === opt.id
          return (
            <button
              key={opt.id}
              onClick={() => !disabled && setRole(opt.id)}
              disabled={disabled}
              style={{
                padding: '10px 6px', borderRadius: 10, textAlign: 'center',
                background: active ? T.copper[50] : '#fff',
                border: `1.5px solid ${active ? T.copper[400] : T.neutral[200]}`,
                cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                fontSize: 12, fontWeight: 700,
                color: active ? T.copper[700] : T.neutral[700],
                opacity: disabled ? 0.6 : 1,
              }}
            >
              {opt.label}
            </button>
          )
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
        <div>
          <FieldLabel>Hora inicio</FieldLabel>
          <input
            type="time"
            value={startTime}
            onChange={e => setStartTime(e.target.value)}
            disabled={disabled}
            style={timeStyle}
          />
          <div style={{ fontSize: 11, color: T.neutral[500], marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
            {fmt12h(startTime)}
          </div>
        </div>
        <div>
          <FieldLabel>Hora fin</FieldLabel>
          <input
            type="time"
            value={endTime}
            onChange={e => setEndTime(e.target.value)}
            disabled={disabled}
            style={timeStyle}
          />
          <div style={{ fontSize: 11, color: T.neutral[500], marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
            {fmt12h(endTime)}
          </div>
        </div>
      </div>
    </>
  )
}

function FieldLabel({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: T.neutral[600], letterSpacing: 0.2, marginBottom: 6, textTransform: 'uppercase' }}>
      {children}
    </div>
  )
}

const selectStyle = {
  width: '100%', padding: '11px 12px', borderRadius: 12,
  border: `1.5px solid ${T.neutral[200]}`,
  background: '#fff', color: T.neutral[900],
  fontFamily: 'inherit', fontSize: 14, fontWeight: 500,
  outline: 'none', cursor: 'pointer',
  marginBottom: 14,
}

const timeStyle = {
  width: '100%', padding: '11px 12px', borderRadius: 12,
  border: `1.5px solid ${T.neutral[200]}`,
  background: '#fff', color: T.neutral[900],
  fontFamily: 'inherit', fontSize: 14, fontWeight: 500,
  outline: 'none',
  fontVariantNumeric: 'tabular-nums',
}

const btnPrimary = {
  padding: '12px 14px', borderRadius: 12, border: 'none',
  fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
}

const btnSecondary = {
  flex: 1, padding: '12px 14px', borderRadius: 12, border: 'none',
  background: T.neutral[100], color: T.neutral[700],
  cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
}

function hintStyle(tone) {
  if (tone === 'bad') {
    return {
      marginBottom: 10, padding: '10px 12px', borderRadius: 10,
      background: '#FBE9E5', border: `1px solid #F0C8BE`, color: T.bad,
      fontSize: 12.5, fontWeight: 500, textAlign: 'center',
    }
  }
  return {
    marginBottom: 10, padding: '10px 12px', borderRadius: 10,
    background: '#FFF7E6', border: `1px solid #F4E0BC`, color: '#7A5C00',
    fontSize: 12.5, fontWeight: 500, textAlign: 'center',
  }
}

const navBtn = {
  width: 38, height: 38, borderRadius: 999, border: 'none', cursor: 'pointer',
  background: 'rgba(255,255,255,0.12)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  flexShrink: 0,
}

// ──────────────────────────────────────────────────────────────
// SUB-VISTA: Administrar Personal (lista empleados + pendientes + detalle)
// ──────────────────────────────────────────────────────────────
function PersonalManager({ employees, onRefresh, initialEmpId, onClearEmpId, onBack }) {
  const { authUser } = useAuth()
  const [empOpen, setEmpOpen] = useState(initialEmpId || null)
  const [users, setUsers] = useState([])
  const [showPending, setShowPending] = useState(false)
  const [approvingUser, setApprovingUser] = useState(null)
  const [confirmUserAction, setConfirmUserAction] = useState(null)

  useEffect(() => watchAllUsers(setUsers), [])

  function openEmp(id) { setEmpOpen(id); onClearEmpId?.() }
  function closeEmp() { setEmpOpen(null) }

  if (empOpen) {
    const emp = employees.find(e => e.id === empOpen)
    if (!emp) { setEmpOpen(null); return null }
    return <EmployeeDetail emp={emp} users={users} onBack={closeEmp} onRefresh={onRefresh} />
  }

  const pendingUsers = users.filter(u => u.status === 'pending')

  const rows = employees.map(e => {
    const linkedUser = users.find(u => u.linkedEmployeeId === e.id)
    return { emp: e, linkedUser }
  })

  return (
    <div style={{ paddingBottom: 110 }}>
      <div style={{ padding: '56px 16px 0' }}>
        <BackButton onBack={onBack} label="Equipo"/>
      </div>

      <ScreenHeader title="Personal" subtitle="Miembros del equipo" />

      {pendingUsers.length > 0 && (
        <div style={{ padding: '0 16px 12px' }}>
          <button
            onClick={() => setShowPending(true)}
            style={{
              width: '100%', padding: '14px 16px', borderRadius: 14,
              background: T.copper[50], border: `1px solid ${T.copper[200]}`,
              cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
              display: 'flex', alignItems: 'center', gap: 12,
            }}
          >
            <div style={{
              width: 32, height: 32, borderRadius: 999,
              background: T.copper[500], color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, fontWeight: 800,
              fontVariantNumeric: 'tabular-nums',
              flexShrink: 0,
            }}>
              {pendingUsers.length}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.copper[800] }}>
                {pendingUsers.length === 1 ? '1 solicitud pendiente' : `${pendingUsers.length} solicitudes pendientes`}
              </div>
              <div style={{ fontSize: 12, color: T.copper[700], marginTop: 2 }}>
                Toca para revisarlas y aprobar
              </div>
            </div>
            <svg width="7" height="12" viewBox="0 0 7 12">
              <path d="M1 1 L6 6 L1 11" stroke={T.copper[600]} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      )}

      {employees.length === 0 ? (
        <EmptyState
          icon="👥"
          title="Sin miembros del equipo"
          subtitle="Cuando alguien solicite cuenta y la apruebes, aparecerá aquí."
        />
      ) : (
        <div style={{ padding: '0 16px' }}>
          <Card padding={0}>
            {rows.map((x, i) => (
              <div key={x.emp.id} onClick={() => openEmp(x.emp.id)}
                style={{
                  padding: '14px 16px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 12,
                  borderBottom: i < rows.length - 1 ? `0.5px solid ${T.neutral[100]}` : 'none',
                }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 999,
                  background: T.copper[50],
                  color: T.copper[700],
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, fontSize: 14, flexShrink: 0,
                }}>
                  {x.emp.name.split(' ').map(p => p[0]).slice(0, 2).join('')}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: T.neutral[800] }}>
                    {x.emp.name}
                  </div>
                  <div style={{ fontSize: 12, color: T.neutral[500], marginTop: 2 }}>
                    {x.emp.phone || 'Sin WhatsApp'}
                    {x.linkedUser?.role === 'admin' && (
                      <>
                        {' · '}
                        <span style={{
                          fontSize: 10, fontWeight: 700, color: T.copper[700],
                          letterSpacing: 0.4, textTransform: 'uppercase',
                        }}>
                          Admin
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <svg width="7" height="12" viewBox="0 0 7 12">
                  <path d="M1 1 L6 6 L1 11" stroke={T.neutral[300]} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            ))}
          </Card>
        </div>
      )}

      {showPending && (
        <PendingUsersModal
          users={pendingUsers}
          onClose={() => setShowPending(false)}
          onApprove={u => setApprovingUser(u)}
          onReject={u => setConfirmUserAction({ user: u, action: 'reject' })}
        />
      )}

      {approvingUser && (
        <ApprovalModal
          user={approvingUser}
          adminUid={authUser.uid}
          onCancel={() => setApprovingUser(null)}
          onDone={() => { setApprovingUser(null); onRefresh?.() }}
        />
      )}

      {confirmUserAction && (
        <ConfirmUserModal
          title="Rechazar solicitud"
          message={`¿Rechazar la solicitud de ${confirmUserAction.user.nombre} ${confirmUserAction.user.apellido}? Podrá volver a solicitar acceso después.`}
          confirmLabel="Rechazar"
          confirmColor={T.bad}
          onCancel={() => setConfirmUserAction(null)}
          onConfirm={async () => {
            await rejectPendingUser(confirmUserAction.user.uid)
            setConfirmUserAction(null)
          }}
        />
      )}
    </div>
  )
}

function PendingUsersModal({ users, onClose, onApprove, onReject }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 90,
      background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 480, maxHeight: '92vh', overflowY: 'auto',
        background: '#fff', borderRadius: '20px 20px 0 0',
        boxShadow: '0 -8px 32px rgba(0,0,0,0.15)',
      }}>
        <div style={{
          position: 'sticky', top: 0, background: '#fff', zIndex: 2,
          padding: '18px 20px 14px', borderBottom: `1px solid ${T.neutral[100]}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3 }}>
            Solicitudes pendientes
          </div>
          <button onClick={onClose} style={{
            width: 32, height: 32, borderRadius: 999, border: 'none',
            background: T.neutral[100], color: T.neutral[700],
            cursor: 'pointer', fontSize: 18, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'inherit',
          }}>×</button>
        </div>

        <div style={{ padding: '8px 16px 24px' }}>
          {users.map((u, i) => (
            <div key={u.uid} style={{
              padding: '14px 4px',
              display: 'flex', alignItems: 'center', gap: 12,
              borderBottom: i < users.length - 1 ? `0.5px solid ${T.neutral[100]}` : 'none',
            }}>
              <UserAvatar user={u} size={40} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 14.5, fontWeight: 700, color: T.neutral[900],
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {u.nombre} {u.apellido}
                </div>
                <div style={{
                  fontSize: 11.5, color: T.neutral[500], marginTop: 2,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {u.email}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button onClick={() => onReject(u)} style={ghostBtn(T.bad)}>Rechazar</button>
                <button onClick={() => onApprove(u)} style={primaryBtn()}>Aprobar</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ghostBtn(color) {
  return {
    padding: '7px 12px', borderRadius: 10,
    background: 'transparent', color,
    border: `1px solid ${T.neutral[200]}`,
    cursor: 'pointer', fontFamily: 'inherit',
    fontSize: 12.5, fontWeight: 600,
  }
}
function primaryBtn() {
  return {
    padding: '7px 14px', borderRadius: 10,
    background: T.copper[500], color: '#fff',
    border: 'none', cursor: 'pointer', fontFamily: 'inherit',
    fontSize: 12.5, fontWeight: 700,
    boxShadow: '0 2px 6px rgba(184,122,86,0.3)',
  }
}

function EmployeeDetail({ emp, users, onBack, onRefresh }) {
  const [name, setName] = useState(emp.name || '')
  const [phone, setPhone] = useState(emp.phone || '')
  const [showDelete, setShowDelete] = useState(false)

  const linkedUser = (users || []).find(u => u.linkedEmployeeId === emp.id)

  const dirty = name.trim() !== (emp.name || '').trim() || phone.trim() !== (emp.phone || '').trim()
  const canSave = dirty && name.trim() && phone.trim()

  function handleSave() {
    if (!canSave) return
    updateEmployee(emp.id, { name: name.trim(), phone: phone.trim() })
    onRefresh()
  }

  function handleDeleteEmp() {
    deleteEmployee(emp.id)
    onRefresh()
    onBack()
  }

  return (
    <div style={{ background: T.neutral[50], minHeight: '100%', paddingBottom: 120 }}>
      <div style={{ padding: '56px 16px 0' }}>
        <BackButton onBack={onBack} label="Personal"/>
      </div>

      <div style={{ padding: '12px 16px 0' }}>
        <Card padding={20}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 56, height: 56, borderRadius: 999, flexShrink: 0,
              background: T.copper[50],
              color: T.copper[700],
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: 20,
            }}>
              {(name || '?').split(' ').map(p => p[0]).slice(0, 2).join('')}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: T.neutral[900], letterSpacing: -0.3 }}>
                {name || 'Sin nombre'}
              </div>
              {phone && (
                <a href={`https://wa.me/57${phone.replace(/\D/g,'')}`} target="_blank" rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  style={{ display: 'inline-block', marginTop: 4, color: '#25D366', fontWeight: 600, textDecoration: 'none', fontSize: 12 }}>
                  WhatsApp
                </a>
              )}
            </div>
          </div>
        </Card>
      </div>

      {linkedUser && (
        <div style={{ padding: '10px 16px 0' }}>
          <Card padding={14} style={{
            background: T.copper[50],
            border: `1px solid ${T.copper[100]}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <UserAvatar user={linkedUser} size={40} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 11, fontWeight: 700, color: T.copper[700],
                  letterSpacing: 0.5, textTransform: 'uppercase',
                }}>
                  Cuenta {linkedUser.role === 'admin' ? '· Admin' : ''}
                </div>
                <div style={{
                  fontSize: 13, fontWeight: 600, color: T.neutral[800], marginTop: 2,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {linkedUser.email}
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      <div style={{ padding: '14px 16px 0' }}>
        <Card padding={18}>
          <InputField
            label="Nombre completo"
            value={name}
            onChange={setName}
            placeholder="Ej: María López"
          />
          <InputField
            label="WhatsApp"
            value={phone}
            onChange={setPhone}
            type="tel"
            placeholder="Ej: 301 234 5678"
          />

          <button
            onClick={handleSave}
            disabled={!canSave}
            style={{
              width: '100%', marginTop: 6, padding: '13px',
              borderRadius: 12, border: 'none',
              background: canSave ? T.copper[500] : T.neutral[200],
              color: canSave ? '#fff' : T.neutral[400],
              cursor: canSave ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
              boxShadow: canSave ? '0 3px 10px rgba(184,122,86,0.3)' : 'none',
            }}
          >
            Guardar cambios
          </button>
        </Card>
      </div>

      <div style={{ padding: '24px 16px 0' }}>
        <button onClick={() => setShowDelete(true)} style={{
          width: '100%', padding: '13px', borderRadius: 14,
          border: `1px solid #E8C4BC`,
          background: '#FBF0EE', color: T.bad,
          fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
        }}>
          Eliminar cuenta
        </button>
      </div>

      {showDelete && (
        <Modal onClose={() => setShowDelete(false)} title="¿Eliminar cuenta?">
          <div style={{ fontSize: 14, color: T.neutral[500], marginBottom: 24, lineHeight: 1.5 }}>
            Se eliminará <b>{emp.name}</b> del equipo. Esta acción no se puede deshacer.
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setShowDelete(false)} style={{
              flex: 1, padding: 13, borderRadius: 12, border: 'none',
              background: T.neutral[100], color: T.neutral[700],
              fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}>Cancelar</button>
            <button onClick={handleDeleteEmp} style={{
              flex: 1, padding: 13, borderRadius: 12, border: 'none',
              background: T.bad, color: '#fff',
              fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}>Eliminar</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

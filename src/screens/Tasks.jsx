import { useEffect, useMemo, useState } from 'react'
import { T } from '../tokens'
import { Card, UserAvatar } from '../components/Atoms'
import { ScreenHeader } from '../components/Nav'
import { useAuth } from '../context/AuthCtx'
import { watchAllUsers } from '../users'
import { getData } from '../db'
import {
  watchAllTasks,
  createTask,
  cancelTask,
  reopenTask,
  editTask,
} from '../tasks'

// ──────────────────────────────────────────────────────────────
// Pantalla del admin: gestión de tareas
//
// 3 tabs: Activas · Completadas · Canceladas
// Botón flotante: + Nueva tarea
// Click en tarea → modal detalle (con acciones contextuales)
// ──────────────────────────────────────────────────────────────
export default function Tasks({ onBack }) {
  const { authUser, userDoc } = useAuth()
  const [tab, setTab] = useState('pending')
  const [tasks, setTasks] = useState([])
  const [allUsers, setAllUsers] = useState([])
  const [creating, setCreating] = useState(false)
  const [reviewing, setReviewing] = useState(null)

  useEffect(() => watchAllTasks(setTasks), [])
  useEffect(() => watchAllUsers(setAllUsers), [])

  const adminName = `${userDoc?.nombre || ''} ${userDoc?.apellido || ''}`.trim() || authUser?.email || 'Admin'

  const grouped = useMemo(() => ({
    pending: tasks.filter(t => t.status === 'pending'),
    done: tasks.filter(t => t.status === 'done'),
    cancelled: tasks.filter(t => t.status === 'cancelled'),
  }), [tasks])

  const visibleTasks = grouped[tab] || []

  // Cajeras activas (para el dropdown del modal de creación)
  const activeCashiers = useMemo(
    () => allUsers.filter(u => u.role === 'cashier' && u.status === 'approved'),
    [allUsers]
  )

  return (
    <div style={{ paddingBottom: 110 }}>
      <ScreenHeader
        title="Tareas"
        subtitle={
          grouped.pending.length > 0
            ? `${grouped.pending.length} ${grouped.pending.length === 1 ? 'activa' : 'activas'}`
            : 'Sin tareas activas'
        }
      />

      {/* Tabs */}
      <div style={{ padding: '0 16px 12px' }}>
        <div style={{
          display: 'flex', gap: 6, padding: 4, borderRadius: 14,
          background: T.neutral[100],
        }}>
          <TabPill
            label="Activas"
            count={grouped.pending.length}
            active={tab === 'pending'}
            onClick={() => setTab('pending')}
          />
          <TabPill
            label="Hechas"
            count={grouped.done.length}
            active={tab === 'done'}
            onClick={() => setTab('done')}
          />
          <TabPill
            label="Canceladas"
            count={grouped.cancelled.length}
            active={tab === 'cancelled'}
            onClick={() => setTab('cancelled')}
          />
        </div>
      </div>

      {/* Botón nueva tarea */}
      <div style={{ padding: '0 16px 14px' }}>
        <button
          onClick={() => setCreating(true)}
          style={{
            width: '100%', padding: '14px 16px', borderRadius: 14,
            background: T.copper[500], color: '#fff',
            border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 14.5, fontWeight: 700, letterSpacing: -0.1,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            boxShadow: '0 6px 18px rgba(184,122,86,0.3)',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M9 3 V15 M3 9 H15" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/>
          </svg>
          Nueva tarea
        </button>
      </div>

      {/* Lista */}
      {visibleTasks.length === 0 ? (
        <EmptyState tab={tab} onCreate={() => setCreating(true)} />
      ) : (
        <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {visibleTasks.map(task => (
            <TaskRow
              key={task.id}
              task={task}
              onClick={() => setReviewing(task)}
            />
          ))}
        </div>
      )}

      {creating && (
        <CreateTaskModal
          adminUid={authUser.uid}
          adminName={adminName}
          cashiers={activeCashiers}
          onCancel={() => setCreating(false)}
          onCreated={() => setCreating(false)}
        />
      )}

      {reviewing && (
        <TaskDetailModal
          task={reviewing}
          adminUid={authUser.uid}
          onClose={() => setReviewing(null)}
        />
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// TabPill — píldora segmentada
// ──────────────────────────────────────────────────────────────
function TabPill({ label, count, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, padding: '9px 10px', borderRadius: 11,
        background: active ? '#fff' : 'transparent',
        color: active ? T.neutral[900] : T.neutral[500],
        border: 'none', cursor: 'pointer', fontFamily: 'inherit',
        fontSize: 13, fontWeight: 700,
        boxShadow: active ? '0 1px 4px rgba(0,0,0,0.06)' : 'none',
        transition: 'background 0.15s, color 0.15s',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      }}
    >
      <span>{label}</span>
      {count > 0 && (
        <span style={{
          minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999,
          background: active ? T.copper[500] : T.neutral[200],
          color: active ? '#fff' : T.neutral[600],
          fontSize: 10.5, fontWeight: 800,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {count}
        </span>
      )}
    </button>
  )
}

// ──────────────────────────────────────────────────────────────
// Card de una tarea en la lista (admin)
// ──────────────────────────────────────────────────────────────
function TaskRow({ task, onClick }) {
  const isDone = task.status === 'done'
  const isCancelled = task.status === 'cancelled'
  const isPending = task.status === 'pending'

  // Color del border-left según estado
  const accent = isDone ? T.ok : isCancelled ? T.neutral[300] : T.copper[400]

  // Días restantes / vencido
  const dueInfo = useMemo(() => {
    if (!task.dueDate || !isPending) return null
    const today = new Date().toISOString().slice(0, 10)
    const diff = Math.ceil((new Date(task.dueDate + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000)
    if (diff < 0) return { text: `Vencida hace ${-diff}d`, color: T.bad, urgent: true }
    if (diff === 0) return { text: 'Vence hoy', color: T.warn, urgent: true }
    if (diff === 1) return { text: 'Vence mañana', color: T.warn, urgent: false }
    if (diff <= 7) return { text: `En ${diff} días`, color: T.neutral[500], urgent: false }
    return { text: task.dueDate, color: T.neutral[500], urgent: false }
  }, [task.dueDate, isPending])

  const completedDate = task.completedAt?.toDate?.() || (task.completedAtClient && new Date(task.completedAtClient))
  const completedStr = completedDate?.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })

  return (
    <div
      onClick={onClick}
      style={{
        padding: '14px 14px 14px 16px',
        borderRadius: 14,
        background: '#fff',
        border: `1px solid ${T.neutral[100]}`,
        borderLeft: `4px solid ${accent}`,
        cursor: 'pointer',
        boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
        transition: 'transform 0.12s, box-shadow 0.12s',
      }}
      onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.99)' }}
      onMouseUp={e => { e.currentTarget.style.transform = 'scale(1)' }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)' }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14.5, fontWeight: 700, color: T.neutral[900],
            letterSpacing: -0.2,
            textDecoration: isDone || isCancelled ? 'line-through' : 'none',
            opacity: isCancelled ? 0.55 : 1,
            lineHeight: 1.35,
          }}>
            {task.title}
          </div>
          {task.description && (
            <div style={{
              fontSize: 12, color: T.neutral[500], marginTop: 4, lineHeight: 1.4,
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}>
              {task.description}
            </div>
          )}

          {/* Meta info */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginTop: 8,
            flexWrap: 'wrap',
          }}>
            <span style={{
              fontSize: 11, fontWeight: 600, color: T.copper[700],
              background: T.copper[50],
              padding: '3px 9px', borderRadius: 999,
              display: 'inline-flex', alignItems: 'center', gap: 5,
            }}>
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                <circle cx="6" cy="4" r="2.2" stroke={T.copper[700]} strokeWidth="1.4"/>
                <path d="M2 11 Q2 7 6 7 Q10 7 10 11" stroke={T.copper[700]} strokeWidth="1.4" fill="none"/>
              </svg>
              {task.assignedToName || 'Sin asignar'}
            </span>

            {task.branchName && (
              <span style={{
                fontSize: 11, fontWeight: 600, color: T.neutral[600],
                background: T.neutral[100],
                padding: '3px 9px', borderRadius: 999,
              }}>
                {task.branchName}
              </span>
            )}

            {dueInfo && (
              <span style={{
                fontSize: 11, fontWeight: 700, color: dueInfo.color,
                background: dueInfo.urgent ? `${dueInfo.color}15` : 'transparent',
                padding: dueInfo.urgent ? '3px 9px' : '3px 0',
                borderRadius: 999,
              }}>
                {dueInfo.urgent && '⏰ '}{dueInfo.text}
              </span>
            )}

            {isDone && completedStr && (
              <span style={{
                fontSize: 11, fontWeight: 600, color: T.ok,
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}>
                ✓ Hecha {completedStr}
              </span>
            )}

            {isCancelled && (
              <span style={{ fontSize: 11, fontWeight: 600, color: T.neutral[400] }}>
                Cancelada
              </span>
            )}
          </div>
        </div>

        <svg width="10" height="14" viewBox="0 0 10 14" style={{ flexShrink: 0, marginTop: 2 }}>
          <path d="M2 1 L8 7 L2 13" stroke={T.neutral[300]} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Estado vacío (por tab)
// ──────────────────────────────────────────────────────────────
function EmptyState({ tab, onCreate }) {
  const config = {
    pending: {
      emoji: '✨',
      title: '¡Sin tareas activas!',
      subtitle: 'Cuando asignes una tarea a una cajera aparecerá aquí.',
      cta: 'Crear primera tarea',
    },
    done: {
      emoji: '✅',
      title: 'Aún no hay tareas hechas',
      subtitle: 'Cuando una cajera complete una tarea, aparecerá aquí.',
      cta: null,
    },
    cancelled: {
      emoji: '🗂️',
      title: 'Sin tareas canceladas',
      subtitle: 'Las tareas que canceles antes de completarse aparecerán aquí.',
      cta: null,
    },
  }
  const c = config[tab]

  return (
    <div style={{ padding: '40px 28px', textAlign: 'center' }}>
      <div style={{ fontSize: 56, marginBottom: 14 }}>{c.emoji}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: T.neutral[800], marginBottom: 6 }}>
        {c.title}
      </div>
      <div style={{
        fontSize: 13, color: T.neutral[500], maxWidth: 280,
        margin: '0 auto', lineHeight: 1.55,
      }}>
        {c.subtitle}
      </div>
      {c.cta && (
        <button
          onClick={onCreate}
          style={{
            marginTop: 18, padding: '11px 20px', borderRadius: 12,
            background: T.copper[500], color: '#fff',
            border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 13.5, fontWeight: 700,
            boxShadow: '0 4px 12px rgba(184,122,86,0.25)',
          }}
        >
          {c.cta}
        </button>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Modal: Crear tarea
// ──────────────────────────────────────────────────────────────
function CreateTaskModal({ adminUid, adminName, cashiers, onCancel, onCreated }) {
  const branches = getData().branches || []
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assignedTo, setAssignedTo] = useState(cashiers[0]?.uid || '')
  const [branchId, setBranchId] = useState('') // '' = ninguna
  const [dueDate, setDueDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function handleCreate() {
    if (busy) return
    if (!title.trim()) {
      setError('Pon un título a la tarea.')
      return
    }
    if (!assignedTo) {
      setError('Elige a quién asignársela.')
      return
    }
    setBusy(true); setError(null)
    try {
      const cashier = cashiers.find(c => c.uid === assignedTo)
      const cashierName = cashier
        ? `${cashier.nombre || ''} ${cashier.apellido || ''}`.trim()
        : ''
      const branch = branches.find(b => String(b.id) === String(branchId))
      await createTask({
        assignedToUid: assignedTo,
        assignedToName: cashierName,
        createdBy: adminUid,
        createdByName: adminName,
        title,
        description,
        branchId: branchId ? branch?.id ?? null : null,
        branchName: branch?.name || null,
        dueDate,
      })
      onCreated()
    } catch (err) {
      console.error('[tasks] create failed:', err)
      setError('No pudimos crear la tarea. Intenta de nuevo.')
      setBusy(false)
    }
  }

  return (
    <ModalOverlay onClose={busy ? undefined : onCancel}>
      <ModalCard>
        <ModalTitle>Nueva tarea</ModalTitle>
        <ModalSub>Asígnale algo a una cajera para que lo haga en su próximo turno.</ModalSub>

        {/* Título */}
        <FieldLabel>Título</FieldLabel>
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder='Ej: "Limpiar nevera"'
          maxLength={80}
          autoFocus
          style={inputStyle()}
        />

        {/* Descripción */}
        <FieldLabel>Descripción <span style={{ color: T.neutral[400], fontWeight: 500 }}>· opcional</span></FieldLabel>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Detalles, instrucciones extra..."
          rows={3}
          maxLength={400}
          style={{ ...inputStyle(), resize: 'vertical', minHeight: 70 }}
        />

        {/* Asignar a */}
        <FieldLabel>Asignar a</FieldLabel>
        {cashiers.length === 0 ? (
          <div style={{
            padding: '12px 14px', borderRadius: 12,
            background: '#FFF7E6', border: `1px solid #F4E0BC`,
            color: '#7A5C00', fontSize: 12.5, lineHeight: 1.5, marginBottom: 12,
          }}>
            No hay cajeras activas. Aprueba una primero desde Equipo.
          </div>
        ) : (
          <div style={{
            display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12,
          }}>
            {cashiers.map(c => {
              const sel = assignedTo === c.uid
              return (
                <button
                  key={c.uid}
                  onClick={() => setAssignedTo(c.uid)}
                  style={{
                    padding: '8px 12px 8px 8px', borderRadius: 999,
                    background: sel ? T.copper[50] : '#fff',
                    border: `1.5px solid ${sel ? T.copper[400] : T.neutral[200]}`,
                    cursor: 'pointer', fontFamily: 'inherit',
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    fontSize: 12.5, fontWeight: 700,
                    color: sel ? T.copper[700] : T.neutral[700],
                    transition: 'background 0.15s, border-color 0.15s',
                  }}
                >
                  <UserAvatar user={c} size={22} />
                  {c.nombre} {c.apellido}
                </button>
              )
            })}
          </div>
        )}

        {/* Panadería (opcional) */}
        {branches.length > 0 && (
          <>
            <FieldLabel>Panadería <span style={{ color: T.neutral[400], fontWeight: 500 }}>· opcional</span></FieldLabel>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              <PillChoice
                selected={branchId === ''}
                onClick={() => setBranchId('')}
                label="Cualquiera"
              />
              {branches.map(b => (
                <PillChoice
                  key={b.id}
                  selected={String(branchId) === String(b.id)}
                  onClick={() => setBranchId(String(b.id))}
                  label={b.name}
                />
              ))}
            </div>
          </>
        )}

        {/* Fecha límite */}
        <FieldLabel>Fecha límite <span style={{ color: T.neutral[400], fontWeight: 500 }}>· opcional</span></FieldLabel>
        <input
          type="date"
          value={dueDate}
          onChange={e => setDueDate(e.target.value)}
          style={inputStyle()}
        />

        {error && <ErrorBox>{error}</ErrorBox>}

        <ModalActions
          onCancel={onCancel}
          onConfirm={handleCreate}
          confirmLabel={busy ? 'Creando...' : 'Crear tarea'}
          confirmDisabled={busy || !title.trim() || !assignedTo}
          confirmColor={T.copper[500]}
        />
      </ModalCard>
    </ModalOverlay>
  )
}

// ──────────────────────────────────────────────────────────────
// Modal: Detalle de una tarea (admin)
// ──────────────────────────────────────────────────────────────
function TaskDetailModal({ task, adminUid, onClose }) {
  const [editing, setEditing] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // Estado del modo edición
  const [editTitle, setEditTitle] = useState(task.title)
  const [editDescription, setEditDescription] = useState(task.description || '')
  const [editDueDate, setEditDueDate] = useState(task.dueDate || '')

  const isPending = task.status === 'pending'
  const isDone = task.status === 'done'
  const isCancelled = task.status === 'cancelled'

  const createdAt = task.createdAt?.toDate?.() || (task.createdAtClient && new Date(task.createdAtClient))
  const completedAt = task.completedAt?.toDate?.() || (task.completedAtClient && new Date(task.completedAtClient))
  const cancelledAt = task.cancelledAt?.toDate?.()

  const fmtFull = (d) => d?.toLocaleString('es-CO', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })

  async function handleSaveEdit() {
    if (busy) return
    if (!editTitle.trim()) {
      setError('El título no puede estar vacío.')
      return
    }
    setBusy(true); setError(null)
    try {
      await editTask(task.id, {
        title: editTitle,
        description: editDescription,
        dueDate: editDueDate,
      })
      setEditing(false)
      setBusy(false)
    } catch (err) {
      console.error('[tasks] edit failed:', err)
      setError('No pudimos guardar los cambios.')
      setBusy(false)
    }
  }

  async function handleCancelTask(reason) {
    if (busy) return
    setBusy(true); setError(null)
    try {
      await cancelTask(task.id, { adminUid, reason })
      onClose()
    } catch (err) {
      console.error('[tasks] cancel failed:', err)
      setError('No pudimos cancelar la tarea.')
      setBusy(false)
    }
  }

  async function handleReopen() {
    if (busy) return
    setBusy(true); setError(null)
    try {
      await reopenTask(task.id)
      setBusy(false)
    } catch (err) {
      console.error('[tasks] reopen failed:', err)
      setError('No pudimos reactivar la tarea.')
      setBusy(false)
    }
  }

  return (
    <ModalOverlay onClose={busy ? undefined : onClose}>
      <ModalCard>
        {/* Estado pill */}
        <div style={{ marginBottom: 8 }}>
          <StatusPill status={task.status} />
        </div>

        {editing ? (
          <>
            <FieldLabel>Título</FieldLabel>
            <input
              type="text"
              value={editTitle}
              onChange={e => setEditTitle(e.target.value)}
              maxLength={80}
              autoFocus
              style={inputStyle()}
            />
            <FieldLabel>Descripción</FieldLabel>
            <textarea
              value={editDescription}
              onChange={e => setEditDescription(e.target.value)}
              rows={3}
              maxLength={400}
              style={{ ...inputStyle(), resize: 'vertical', minHeight: 70 }}
            />
            <FieldLabel>Fecha límite</FieldLabel>
            <input
              type="date"
              value={editDueDate}
              onChange={e => setEditDueDate(e.target.value)}
              style={inputStyle()}
            />
          </>
        ) : (
          <>
            <ModalTitle>{task.title}</ModalTitle>
            {task.description && (
              <div style={{
                fontSize: 13.5, color: T.neutral[700], lineHeight: 1.55,
                marginTop: 8, marginBottom: 16,
                whiteSpace: 'pre-wrap',
              }}>
                {task.description}
              </div>
            )}
          </>
        )}

        {/* Bloque de info */}
        {!editing && (
          <div style={{
            marginTop: 10, marginBottom: 14, padding: '12px 14px', borderRadius: 12,
            background: T.neutral[50], border: `1px solid ${T.neutral[100]}`,
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            <InfoLine label="Asignada a" value={task.assignedToName || '—'} />
            {task.branchName && <InfoLine label="Panadería" value={task.branchName} />}
            {task.dueDate && <InfoLine label="Fecha límite" value={task.dueDate} />}
            {createdAt && (
              <InfoLine
                label="Creada"
                value={`${fmtFull(createdAt)} · por ${task.createdByName || 'Admin'}`}
              />
            )}
            {isDone && completedAt && (
              <InfoLine
                label="Completada"
                value={fmtFull(completedAt)}
                tone="ok"
              />
            )}
            {isCancelled && cancelledAt && (
              <InfoLine
                label="Cancelada"
                value={fmtFull(cancelledAt)}
                tone="muted"
              />
            )}
          </div>
        )}

        {/* Notas de completado */}
        {!editing && isDone && task.completedNote && (
          <div style={{
            marginBottom: 14, padding: '10px 12px', borderRadius: 10,
            background: '#E8F4E8', border: `1px solid #C2DDC1`,
            fontSize: 12.5, color: T.neutral[700], lineHeight: 1.5,
          }}>
            <div style={{
              fontSize: 10.5, fontWeight: 700, color: T.ok,
              letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 4,
            }}>
              Nota de la cajera
            </div>
            "{task.completedNote}"
          </div>
        )}

        {/* Razón de cancelación */}
        {!editing && isCancelled && task.cancelReason && (
          <div style={{
            marginBottom: 14, padding: '10px 12px', borderRadius: 10,
            background: T.neutral[100], border: `1px solid ${T.neutral[200]}`,
            fontSize: 12.5, color: T.neutral[700], fontStyle: 'italic', lineHeight: 1.5,
          }}>
            <b style={{ fontStyle: 'normal', color: T.neutral[600] }}>Motivo:</b> "{task.cancelReason}"
          </div>
        )}

        {error && <ErrorBox>{error}</ErrorBox>}

        {/* Acciones */}
        {editing ? (
          <ModalActions
            onCancel={() => { setEditing(false); setError(null) }}
            onConfirm={handleSaveEdit}
            confirmLabel={busy ? 'Guardando...' : 'Guardar cambios'}
            confirmDisabled={busy || !editTitle.trim()}
            confirmColor={T.copper[500]}
          />
        ) : confirmCancel ? (
          <CancelConfirm
            onCancel={() => setConfirmCancel(false)}
            onConfirm={handleCancelTask}
            busy={busy}
          />
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {isPending && (
              <>
                <button onClick={() => setEditing(true)} style={btnGhost()}>
                  ✎ Editar
                </button>
                <button onClick={() => setConfirmCancel(true)} style={btnGhost(T.bad)}>
                  Cancelar tarea
                </button>
              </>
            )}
            {(isDone || isCancelled) && (
              <button onClick={handleReopen} style={btnGhost(T.copper[600])}>
                ↺ Reactivar
              </button>
            )}
            <button onClick={onClose} style={{
              flex: 1, minWidth: 100, padding: '11px 14px', borderRadius: 12,
              background: T.neutral[800], color: '#fff',
              border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 13.5, fontWeight: 700,
            }}>
              Cerrar
            </button>
          </div>
        )}
      </ModalCard>
    </ModalOverlay>
  )
}

function StatusPill({ status }) {
  const cfg = {
    pending: { bg: T.copper[50], color: T.copper[700], label: 'Activa' },
    done: { bg: '#E8F4E8', color: T.ok, label: '✓ Completada' },
    cancelled: { bg: T.neutral[100], color: T.neutral[600], label: 'Cancelada' },
  }[status] || { bg: T.neutral[100], color: T.neutral[600], label: status }
  return (
    <span style={{
      display: 'inline-block',
      padding: '4px 10px', borderRadius: 999,
      background: cfg.bg, color: cfg.color,
      fontSize: 11, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase',
    }}>
      {cfg.label}
    </span>
  )
}

function InfoLine({ label, value, tone }) {
  const valueColor = tone === 'ok' ? T.ok : tone === 'muted' ? T.neutral[500] : T.neutral[800]
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
      <span style={{ fontSize: 11.5, color: T.neutral[500], fontWeight: 600, flexShrink: 0 }}>{label}</span>
      <span style={{
        fontSize: 12.5, color: valueColor, fontWeight: 600, textAlign: 'right',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {value}
      </span>
    </div>
  )
}

function CancelConfirm({ onCancel, onConfirm, busy }) {
  const [reason, setReason] = useState('')
  return (
    <div style={{
      padding: '12px 14px', borderRadius: 12,
      background: '#FBE9E5', border: `1px solid #F0C8BE`,
      marginTop: 4,
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: T.bad, marginBottom: 6 }}>
        ¿Cancelar esta tarea?
      </div>
      <div style={{ fontSize: 12, color: T.neutral[700], marginBottom: 10, lineHeight: 1.4 }}>
        La cajera ya no la verá. Puedes reactivarla luego si quieres.
      </div>
      <input
        type="text"
        value={reason}
        onChange={e => setReason(e.target.value)}
        placeholder="Motivo (opcional)"
        maxLength={120}
        style={{
          ...inputStyle(),
          marginBottom: 10,
          background: '#fff',
        }}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onCancel} disabled={busy} style={{
          flex: 1, padding: '10px', borderRadius: 10,
          background: '#fff', color: T.neutral[700],
          border: `1px solid ${T.neutral[200]}`,
          cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
          fontSize: 13, fontWeight: 700,
        }}>
          No
        </button>
        <button onClick={() => onConfirm(reason)} disabled={busy} style={{
          flex: 1.4, padding: '10px', borderRadius: 10,
          background: T.bad, color: '#fff',
          border: 'none', cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
          fontSize: 13, fontWeight: 700,
          opacity: busy ? 0.7 : 1,
        }}>
          {busy ? 'Cancelando...' : 'Sí, cancelar'}
        </button>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Componentes utilitarios
// ──────────────────────────────────────────────────────────────
function FieldLabel({ children }) {
  return (
    <div style={{
      fontSize: 11.5, fontWeight: 700, color: T.neutral[600],
      letterSpacing: 0.3, textTransform: 'uppercase',
      marginBottom: 6, marginTop: 4,
    }}>
      {children}
    </div>
  )
}

function inputStyle() {
  return {
    width: '100%', padding: '11px 12px', borderRadius: 12,
    border: `1.5px solid ${T.neutral[200]}`,
    fontSize: 14, fontFamily: 'inherit',
    background: '#fff', color: T.neutral[900],
    outline: 'none', marginBottom: 12,
    boxSizing: 'border-box',
  }
}

function PillChoice({ selected, onClick, label }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '7px 14px', borderRadius: 999,
        background: selected ? T.copper[500] : '#fff',
        color: selected ? '#fff' : T.neutral[700],
        border: `1.5px solid ${selected ? T.copper[500] : T.neutral[200]}`,
        cursor: 'pointer', fontFamily: 'inherit',
        fontSize: 12.5, fontWeight: 700,
        transition: 'background 0.15s, border-color 0.15s',
      }}
    >
      {label}
    </button>
  )
}

function btnGhost(color) {
  const c = color || T.neutral[700]
  return {
    padding: '11px 14px', borderRadius: 12,
    background: 'transparent', color: c,
    border: `1.5px solid ${c}33`,
    cursor: 'pointer', fontFamily: 'inherit',
    fontSize: 13.5, fontWeight: 700,
  }
}

function ErrorBox({ children }) {
  return (
    <div style={{
      marginBottom: 10, padding: '10px 12px', borderRadius: 10,
      background: '#FBE9E5', border: `1px solid #F0C8BE`, color: T.bad,
      fontSize: 12.5, fontWeight: 500, textAlign: 'center',
    }}>
      {children}
    </div>
  )
}

function ModalOverlay({ onClose, children }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 90,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
      animation: 'fadeIn 0.18s ease',
    }}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
      `}</style>
      {children}
    </div>
  )
}

function ModalCard({ children }) {
  return (
    <div onClick={e => e.stopPropagation()} style={{
      width: '100%', maxWidth: 460, background: '#fff', borderRadius: 22,
      padding: '24px 22px 22px', boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
      animation: 'fadeScaleIn 0.2s ease',
      maxHeight: '94vh', overflowY: 'auto',
    }}>
      {children}
    </div>
  )
}

function ModalTitle({ children }) {
  return (
    <div style={{
      fontSize: 19, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.4,
      lineHeight: 1.25,
    }}>
      {children}
    </div>
  )
}

function ModalSub({ children }) {
  return (
    <div style={{ fontSize: 13, color: T.neutral[500], marginTop: 4, marginBottom: 16, lineHeight: 1.5 }}>
      {children}
    </div>
  )
}

function ModalActions({ onCancel, onConfirm, confirmLabel, confirmDisabled, confirmColor }) {
  return (
    <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
      <button onClick={onCancel} style={{
        flex: 1, padding: '12px', borderRadius: 12,
        background: T.neutral[100], color: T.neutral[700],
        border: 'none', cursor: 'pointer', fontFamily: 'inherit',
        fontSize: 14, fontWeight: 700,
      }}>
        Cancelar
      </button>
      <button
        onClick={onConfirm}
        disabled={confirmDisabled}
        style={{
          flex: 1.4, padding: '12px', borderRadius: 12,
          background: confirmDisabled ? T.neutral[200] : confirmColor, color: '#fff',
          border: 'none', cursor: confirmDisabled ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
          boxShadow: confirmDisabled ? 'none' : `0 3px 10px ${confirmColor}44`,
          opacity: confirmDisabled ? 0.6 : 1,
        }}
      >
        {confirmLabel}
      </button>
    </div>
  )
}

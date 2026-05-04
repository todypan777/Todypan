import { useEffect, useState, useMemo } from 'react'
import { T } from '../tokens'
import { Card, Chip, UserAvatar } from '../components/Atoms'
import { ScreenHeader } from '../components/Nav'
import { useAuth } from '../context/AuthCtx'
import {
  watchAllUsers,
  approveUserAndCreateEmployee,
  deactivateUser,
  reactivateUser,
  rejectPendingUser,
} from '../users'
import { useIsDesktop } from '../context/DesktopCtx'

export default function Users({ onBack, onRefresh }) {
  const { authUser } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('pending')
  const [approvingUser, setApprovingUser] = useState(null)
  const [confirmDeactivate, setConfirmDeactivate] = useState(null)
  const isDesktop = useIsDesktop()

  useEffect(() => {
    const unsub = watchAllUsers(list => {
      setUsers(list)
      setLoading(false)
    })
    return unsub
  }, [])

  const groups = useMemo(() => {
    const pending = users.filter(u => u.status === 'pending')
    const active = users.filter(u => u.status === 'approved')
    const inactive = users.filter(u => u.status === 'inactive')
    return { pending, active, inactive }
  }, [users])

  const list = groups[tab] || []

  return (
    <div style={{ paddingBottom: isDesktop ? 0 : 110 }}>
      <ScreenHeader
        title="Usuarios"
        subtitle="Gestión de cajeras y administradores"
      />

      <div style={{ padding: '0 16px 12px', display: 'flex', gap: 8, overflowX: 'auto' }}>
        <Chip
          label={`Pendientes${groups.pending.length ? ` (${groups.pending.length})` : ''}`}
          active={tab === 'pending'}
          onClick={() => setTab('pending')}
        />
        <Chip
          label={`Activos (${groups.active.length})`}
          active={tab === 'active'}
          onClick={() => setTab('active')}
        />
        <Chip
          label={`Inactivos (${groups.inactive.length})`}
          active={tab === 'inactive'}
          onClick={() => setTab('inactive')}
        />
      </div>

      <div style={{ padding: '4px 16px 0' }}>
        {loading ? (
          <Card>
            <div style={{ padding: '24px 0', textAlign: 'center', color: T.neutral[500], fontSize: 13 }}>
              Cargando usuarios...
            </div>
          </Card>
        ) : list.length === 0 ? (
          <Card>
            <div style={{ padding: '32px 0', textAlign: 'center', color: T.neutral[500] }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>
                {tab === 'pending' ? '✨' : tab === 'active' ? '👥' : '📭'}
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: T.neutral[700], marginBottom: 4 }}>
                {emptyTitle(tab)}
              </div>
              <div style={{ fontSize: 12, color: T.neutral[500] }}>
                {emptyDesc(tab)}
              </div>
            </div>
          </Card>
        ) : (
          <Card padding={0}>
            {list.map((u, i) => (
              <UserRow
                key={u.uid}
                user={u}
                isLast={i === list.length - 1}
                tab={tab}
                onApprove={() => setApprovingUser(u)}
                onReject={() => setConfirmDeactivate({ user: u, action: 'reject' })}
                onDeactivate={() => setConfirmDeactivate({ user: u, action: 'deactivate' })}
                onReactivate={() => reactivateUser(u.uid)}
              />
            ))}
          </Card>
        )}
      </div>

      {approvingUser && (
        <ApprovalModal
          user={approvingUser}
          adminUid={authUser.uid}
          onCancel={() => setApprovingUser(null)}
          onDone={() => {
            setApprovingUser(null)
            onRefresh?.()
          }}
        />
      )}

      {confirmDeactivate && (
        <ConfirmModal
          title={
            confirmDeactivate.action === 'reject'
              ? 'Rechazar solicitud'
              : 'Desactivar usuario'
          }
          message={
            confirmDeactivate.action === 'reject'
              ? `¿Rechazar la solicitud de ${confirmDeactivate.user.nombre} ${confirmDeactivate.user.apellido}? Podrá volver a solicitar acceso después.`
              : `¿Desactivar a ${confirmDeactivate.user.nombre} ${confirmDeactivate.user.apellido}? No podrá entrar a la app hasta que la reactives.`
          }
          confirmLabel={confirmDeactivate.action === 'reject' ? 'Rechazar' : 'Desactivar'}
          confirmColor={T.bad}
          onCancel={() => setConfirmDeactivate(null)}
          onConfirm={async () => {
            if (confirmDeactivate.action === 'reject') {
              await rejectPendingUser(confirmDeactivate.user.uid)
            } else {
              await deactivateUser(confirmDeactivate.user.uid)
            }
            setConfirmDeactivate(null)
          }}
        />
      )}
    </div>
  )
}

function emptyTitle(tab) {
  if (tab === 'pending') return 'No hay solicitudes pendientes'
  if (tab === 'active') return 'Todavía no hay usuarios activos'
  return 'No hay usuarios desactivados'
}
function emptyDesc(tab) {
  if (tab === 'pending') return 'Las solicitudes de cajeras nuevas aparecerán aquí.'
  if (tab === 'active') return 'Cuando apruebes a alguien aparecerá en esta lista.'
  return 'Los usuarios que desactives aparecerán aquí para reactivarlos si quieres.'
}

function UserRow({ user, isLast, tab, onApprove, onReject, onDeactivate, onReactivate }) {
  return (
    <div style={{
      padding: '14px 16px',
      display: 'flex', alignItems: 'center', gap: 12,
      borderBottom: isLast ? 'none' : `0.5px solid ${T.neutral[100]}`,
    }}>
      <UserAvatar user={user} size={42} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 14.5, fontWeight: 700, color: T.neutral[900],
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {user.nombre} {user.apellido}
          {user.role === 'admin' && (
            <span style={{
              fontSize: 9.5, fontWeight: 700, color: T.copper[700],
              background: T.copper[50], padding: '2px 7px', borderRadius: 999,
              letterSpacing: 0.4, textTransform: 'uppercase',
            }}>
              Admin
            </span>
          )}
        </div>
        <div style={{
          fontSize: 11.5, color: T.neutral[500], marginTop: 2,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {user.email}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        {tab === 'pending' && (
          <>
            <button
              onClick={onReject}
              style={ghostBtn(T.bad)}
              title="Rechazar"
            >Rechazar</button>
            <button
              onClick={onApprove}
              style={primaryBtn()}
            >Aprobar</button>
          </>
        )}
        {tab === 'active' && user.role !== 'admin' && (
          <button
            onClick={onDeactivate}
            style={ghostBtn(T.bad)}
          >Desactivar</button>
        )}
        {tab === 'inactive' && (
          <button
            onClick={onReactivate}
            style={primaryBtn()}
          >Reactivar</button>
        )}
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

// ─── Modal de aprobación ──────────────────────────────────────
function ApprovalModal({ user, adminUid, onCancel, onDone }) {
  const [nombre, setNombre] = useState(user.nombre || '')
  const [apellido, setApellido] = useState(user.apellido || '')
  const [telefono, setTelefono] = useState('')
  const [salario, setSalario] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const valid = nombre.trim().length >= 2 && apellido.trim().length >= 2 && telefono.trim().length >= 7

  async function handleApprove() {
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    try {
      await approveUserAndCreateEmployee(
        user.uid,
        { nombre, apellido, telefono, rate: salario ? Number(salario) : 0 },
        adminUid,
      )
      onDone()
    } catch (err) {
      console.error(err)
      setError('No pudimos aprobar al usuario. Intenta de nuevo.')
      setBusy(false)
    }
  }

  return (
    <ModalOverlay onClose={busy ? undefined : onCancel}>
      <div style={{
        width: '100%', maxWidth: 440,
        background: '#fff', borderRadius: 20,
        boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
        animation: 'fadeScaleIn 0.2s ease',
        maxHeight: '92vh', overflowY: 'auto',
      }} onClick={e => e.stopPropagation()}>

        <div style={{ padding: '20px 22px 12px' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: T.neutral[900], letterSpacing: -0.2 }}>
            Aprobar y crear empleada
          </div>
          <div style={{ fontSize: 12.5, color: T.neutral[500], marginTop: 4 }}>
            Esta acción crea su registro en Equipo automáticamente.
          </div>
        </div>

        <div style={{
          margin: '0 22px',
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '10px 12px', background: T.neutral[50], borderRadius: 12,
        }}>
          <UserAvatar user={user} size={36} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 12.5, color: T.neutral[600],
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {user.email}
            </div>
          </div>
        </div>

        <div style={{ padding: '16px 22px 20px' }}>
          <ModalField label="Nombre" value={nombre} onChange={setNombre} placeholder="Ej. María" disabled={busy} autoFocus />
          <ModalField label="Apellido" value={apellido} onChange={setApellido} placeholder="Ej. González" disabled={busy} />
          <ModalField label="Teléfono / WhatsApp" value={telefono} onChange={setTelefono} placeholder="Ej. 3001234567" type="tel" disabled={busy} />
          <ModalField label="Salario diario (opcional)" value={salario} onChange={setSalario} placeholder="Ej. 60000" type="number" disabled={busy} hint="Lo puedes llenar después desde Equipo" />

          {error && (
            <div style={{
              marginTop: 4, padding: '10px 12px', borderRadius: 10,
              background: '#FBE9E5', border: `1px solid #F0C8BE`, color: T.bad,
              fontSize: 12.5, fontWeight: 500, textAlign: 'center',
            }}>
              {error}
            </div>
          )}
        </div>

        <div style={{ padding: '0 22px 22px', display: 'flex', gap: 10 }}>
          <button
            onClick={onCancel}
            disabled={busy}
            style={{
              flex: 1, padding: '12px', borderRadius: 12,
              background: T.neutral[100], color: T.neutral[700],
              border: 'none', cursor: busy ? 'wait' : 'pointer',
              fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
            }}
          >Cancelar</button>
          <button
            onClick={handleApprove}
            disabled={!valid || busy}
            style={{
              flex: 1.4, padding: '12px', borderRadius: 12,
              background: valid && !busy ? T.copper[500] : T.neutral[200],
              color: valid && !busy ? '#fff' : T.neutral[400],
              border: 'none', cursor: valid && !busy ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
              boxShadow: valid && !busy ? '0 3px 10px rgba(184,122,86,0.3)' : 'none',
            }}
          >
            {busy ? 'Aprobando...' : 'Aprobar y crear'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

function ModalField({ label, value, onChange, placeholder, type = 'text', disabled, autoFocus, hint }) {
  const [focused, setFocused] = useState(false)
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: T.neutral[600], display: 'block', marginBottom: 6 }}>
        {label}
      </label>
      <div style={{
        border: `1.5px solid ${focused ? T.copper[400] : T.neutral[200]}`,
        borderRadius: 12, background: '#fff',
        transition: 'border-color 0.12s',
      }}>
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          inputMode={type === 'tel' ? 'tel' : type === 'number' ? 'numeric' : undefined}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            width: '100%', padding: '12px 14px', border: 'none', outline: 'none',
            fontFamily: 'inherit', fontSize: 14.5, color: T.neutral[900],
            background: 'transparent', borderRadius: 12,
            opacity: disabled ? 0.6 : 1,
          }}
        />
      </div>
      {hint && (
        <div style={{ fontSize: 11.5, color: T.neutral[400], marginTop: 4 }}>{hint}</div>
      )}
    </div>
  )
}

function ConfirmModal({ title, message, confirmLabel, confirmColor, onCancel, onConfirm }) {
  const [busy, setBusy] = useState(false)
  return (
    <ModalOverlay onClose={busy ? undefined : onCancel}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 360,
        background: '#fff', borderRadius: 20,
        padding: '24px 22px',
        boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
      }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: T.neutral[900], textAlign: 'center', marginBottom: 8 }}>
          {title}
        </div>
        <div style={{ fontSize: 13.5, color: T.neutral[600], textAlign: 'center', marginBottom: 22, lineHeight: 1.5 }}>
          {message}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onCancel}
            disabled={busy}
            style={{
              flex: 1, padding: '12px', borderRadius: 12,
              background: T.neutral[100], color: T.neutral[700],
              border: 'none', cursor: busy ? 'wait' : 'pointer',
              fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
            }}
          >Cancelar</button>
          <button
            onClick={async () => { setBusy(true); await onConfirm() }}
            disabled={busy}
            style={{
              flex: 1, padding: '12px', borderRadius: 12,
              background: confirmColor, color: '#fff',
              border: 'none', cursor: busy ? 'wait' : 'pointer',
              fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? '...' : confirmLabel}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

function ModalOverlay({ onClose, children }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 90,
      background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      {children}
    </div>
  )
}

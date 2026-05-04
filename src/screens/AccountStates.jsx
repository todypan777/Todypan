import { useState } from 'react'
import { T } from '../tokens'
import { TodyMark, UserAvatar } from '../components/Atoms'
import { signOut } from '../auth'
import { createPendingUser } from '../users'

// ─── Layout base ──────────────────────────────────────────────
function StateLayout({ icon, title, children, footer }) {
  return (
    <div style={{
      minHeight: '100dvh', background: T.neutral[50],
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '32px 24px',
      fontFamily: '-apple-system, "SF Pro Text", "Inter", system-ui, sans-serif',
      color: T.neutral[800],
    }}>
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        marginBottom: 32,
      }}>
        <div style={{
          width: 76, height: 76, borderRadius: 22,
          background: T.copper[50], border: `1px solid ${T.copper[100]}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 18,
          boxShadow: '0 8px 24px rgba(184,122,86,0.12)',
        }}>
          {icon}
        </div>
        <div style={{
          fontSize: 26, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.6,
          marginBottom: 4, textAlign: 'center',
        }}>
          TodyPan
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: T.neutral[800], letterSpacing: -0.2, textAlign: 'center' }}>
          {title}
        </div>
      </div>

      <div style={{
        width: '100%', maxWidth: 400,
        background: '#fff', borderRadius: 20,
        border: `1px solid ${T.neutral[100]}`,
        padding: '24px 22px',
        boxShadow: '0 4px 16px rgba(45,35,25,0.04)',
      }}>
        {children}
      </div>

      {footer && (
        <div style={{ marginTop: 16, width: '100%', maxWidth: 400 }}>
          {footer}
        </div>
      )}
    </div>
  )
}

function SignOutFooter() {
  const [busy, setBusy] = useState(false)
  return (
    <button
      onClick={async () => { setBusy(true); await signOut() }}
      disabled={busy}
      style={{
        width: '100%', padding: '11px 14px', borderRadius: 12,
        background: 'transparent', color: T.neutral[600],
        border: `1px solid ${T.neutral[200]}`,
        cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
        fontSize: 13.5, fontWeight: 600,
      }}
    >
      Cerrar sesión
    </button>
  )
}

// ─── 1. Registro: pide nombre y apellido ──────────────────────
export function RegistrationForm({ authUser }) {
  const [nombre, setNombre] = useState(authUser.displayName?.split(' ')[0] || '')
  const [apellido, setApellido] = useState(authUser.displayName?.split(' ').slice(1).join(' ') || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const valid = nombre.trim().length >= 2 && apellido.trim().length >= 2

  async function handleSubmit() {
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    try {
      await createPendingUser(authUser, nombre, apellido)
      // El watcher de userDoc detectará el nuevo doc y la app pasará a PendingApproval automáticamente
    } catch (err) {
      console.error(err)
      setError('No pudimos completar tu registro. Verifica tu conexión e intenta de nuevo.')
      setBusy(false)
    }
  }

  return (
    <StateLayout
      icon={
        <svg width="40" height="40" viewBox="0 0 28 28" fill="none">
          <circle cx="14" cy="10" r="4.5" stroke={T.copper[500]} strokeWidth="1.8" fill="none"/>
          <path d="M5 23 Q5 16 14 16 Q23 16 23 23" stroke={T.copper[500]} strokeWidth="1.8" fill="none" strokeLinecap="round"/>
        </svg>
      }
      title="Bienvenida 👋"
      footer={<SignOutFooter />}
    >
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 12px', marginBottom: 16,
        background: T.neutral[50], borderRadius: 12,
      }}>
        <UserAvatar user={authUser} size={36} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 12.5, fontWeight: 600, color: T.neutral[700],
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {authUser.email}
          </div>
        </div>
      </div>

      <div style={{ fontSize: 13.5, color: T.neutral[600], marginBottom: 18, lineHeight: 1.5 }}>
        Cuéntanos quién eres para enviar tu solicitud al administrador.
      </div>

      <Field
        label="Nombre"
        value={nombre}
        onChange={setNombre}
        placeholder="Ej. María"
        autoFocus
        disabled={busy}
      />

      <Field
        label="Apellido"
        value={apellido}
        onChange={setApellido}
        placeholder="Ej. González"
        disabled={busy}
      />

      {error && (
        <div style={{
          marginTop: 4, padding: '10px 12px', borderRadius: 10,
          background: '#FBE9E5', border: `1px solid #F0C8BE`, color: T.bad,
          fontSize: 12.5, fontWeight: 500, textAlign: 'center',
        }}>
          {error}
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={!valid || busy}
        style={{
          width: '100%', marginTop: 18, padding: '13px', borderRadius: 12,
          background: valid && !busy ? T.copper[500] : T.neutral[200],
          color: valid && !busy ? '#fff' : T.neutral[400],
          border: 'none', cursor: valid && !busy ? 'pointer' : 'not-allowed',
          fontFamily: 'inherit', fontSize: 14.5, fontWeight: 700,
          boxShadow: valid && !busy ? '0 3px 10px rgba(184,122,86,0.3)' : 'none',
          transition: 'all 0.15s',
        }}
      >
        {busy ? 'Enviando...' : 'Enviar solicitud'}
      </button>
    </StateLayout>
  )
}

function Field({ label, value, onChange, placeholder, autoFocus, disabled, type = 'text' }) {
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
          autoFocus={autoFocus}
          disabled={disabled}
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
    </div>
  )
}

// ─── 2. Cuenta pendiente de aprobación ───────────────────────
export function PendingApproval({ authUser, userDoc }) {
  return (
    <StateLayout
      icon={
        <svg width="40" height="40" viewBox="0 0 28 28" fill="none">
          <circle cx="14" cy="14" r="10" stroke={T.warn} strokeWidth="1.8" fill="none"/>
          <path d="M14 8 V14 L18 16" stroke={T.warn} strokeWidth="1.8" strokeLinecap="round" fill="none"/>
        </svg>
      }
      title="Solicitud enviada"
      footer={<SignOutFooter />}
    >
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 12px', marginBottom: 16,
        background: T.neutral[50], borderRadius: 12,
      }}>
        <UserAvatar user={authUser} size={36} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13.5, fontWeight: 700, color: T.neutral[900],
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {userDoc?.nombre} {userDoc?.apellido}
          </div>
          <div style={{
            fontSize: 11.5, color: T.neutral[500], marginTop: 1,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {authUser.email}
          </div>
        </div>
      </div>

      <div style={{
        fontSize: 13.5, color: T.neutral[600], lineHeight: 1.6, textAlign: 'center',
        padding: '8px 0',
      }}>
        Tu cuenta está <b style={{ color: T.warn }}>pendiente de aprobación</b>.
        <br />
        El administrador será notificado y revisará tu solicitud pronto.
      </div>

      <div style={{
        marginTop: 16, padding: '10px 12px', borderRadius: 10,
        background: T.copper[50], border: `1px solid ${T.copper[100]}`,
        fontSize: 12, color: T.copper[700], textAlign: 'center', lineHeight: 1.5,
      }}>
        Vuelve a abrir la app cuando seas aprobada.
      </div>
    </StateLayout>
  )
}

// ─── 3. Cuenta desactivada ───────────────────────────────────
export function Deactivated({ authUser, userDoc }) {
  return (
    <StateLayout
      icon={
        <svg width="40" height="40" viewBox="0 0 28 28" fill="none">
          <circle cx="14" cy="14" r="10" stroke={T.bad} strokeWidth="1.8" fill="none"/>
          <path d="M9 14 H19" stroke={T.bad} strokeWidth="1.8" strokeLinecap="round"/>
        </svg>
      }
      title="Cuenta desactivada"
      footer={<SignOutFooter />}
    >
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 12px', marginBottom: 16,
        background: T.neutral[50], borderRadius: 12,
      }}>
        <UserAvatar user={authUser} size={36} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13.5, fontWeight: 700, color: T.neutral[900],
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {userDoc?.nombre} {userDoc?.apellido}
          </div>
          <div style={{
            fontSize: 11.5, color: T.neutral[500], marginTop: 1,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {authUser.email}
          </div>
        </div>
      </div>

      <div style={{
        fontSize: 13.5, color: T.neutral[600], lineHeight: 1.6, textAlign: 'center',
        padding: '8px 0',
      }}>
        Tu cuenta fue <b style={{ color: T.bad }}>desactivada</b>.
        <br />
        Si crees que es un error, comunícate con el administrador.
      </div>
    </StateLayout>
  )
}

// ─── 4. Cajera aprobada (pendiente de Fases 2+) ──────────────
export function CashierComingSoon({ authUser, userDoc }) {
  return (
    <StateLayout
      icon={<TodyMark size={48} color={T.copper[500]} />}
      title={`Hola, ${userDoc?.nombre || 'cajera'} 👋`}
      footer={<SignOutFooter />}
    >
      <div style={{
        fontSize: 14, color: T.neutral[600], lineHeight: 1.6, textAlign: 'center',
      }}>
        Tu cuenta está <b style={{ color: T.ok }}>activa</b>.
      </div>

      <div style={{
        marginTop: 14, padding: '12px 14px', borderRadius: 12,
        background: T.copper[50], border: `1px solid ${T.copper[100]}`,
        fontSize: 13, color: T.copper[700], textAlign: 'center', lineHeight: 1.5,
      }}>
        Las funciones de cajera (ventas, caja, gastos) llegarán muy pronto.
        <br />
        Mientras tanto puedes cerrar sesión.
      </div>
    </StateLayout>
  )
}

// ─── 5. Bootstrap del admin (transición rápida) ──────────────
export function BootstrappingAdmin() {
  return (
    <div style={{
      minHeight: '100dvh', background: T.neutral[50],
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 14,
    }}>
      <div style={{ fontSize: 48 }}>🥖</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: T.copper[500], letterSpacing: 0.3 }}>
        Configurando panel admin...
      </div>
    </div>
  )
}

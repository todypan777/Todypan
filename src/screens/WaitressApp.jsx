import { useState } from 'react'
import { T } from '../tokens'
import { UserAvatar } from '../components/Atoms'
import { signOut } from '../auth'

/**
 * Placeholder de app para Domiciliaria / Mesera.
 * Por definir qué funcionalidad va a tener.
 *
 * assistMode (opt) → { onExit } cuando el admin entra a asistir desde el
 * dashboard. En ese caso se muestra una barra "Salir de asistir" y se OCULTA
 * el botón "Cerrar sesión" (para no desloguear al admin por accidente).
 */
export default function WaitressApp({ authUser, userDoc, session, assistMode }) {
  const [busy, setBusy] = useState(false)
  const isAssist = !!assistMode

  async function handleSignOut() {
    setBusy(true)
    try {
      await signOut()
    } catch (err) {
      console.error('Error al cerrar sesión:', err)
      setBusy(false)
    }
  }

  const firstName = userDoc?.nombre || authUser?.displayName?.split(' ')[0] || 'Hola'

  return (
    <div style={{
      minHeight: '100dvh', background: T.neutral[50],
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24, fontFamily: '-apple-system, "SF Pro Text", "Inter", system-ui, sans-serif',
    }}>
      {isAssist && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 30,
          background: T.copper[700], color: '#fff',
          padding: '10px 16px',
          display: 'flex', alignItems: 'center', gap: 10,
          boxShadow: '0 2px 10px rgba(0,0,0,0.22)',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', opacity: 0.85 }}>
              Estás asistiendo
            </div>
            <div style={{
              fontSize: 14.5, fontWeight: 800, letterSpacing: -0.2,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {session?.cashierName || 'Mesera'}{session?.branchName ? ` · ${session.branchName}` : ''}
            </div>
          </div>
          <button
            onClick={() => assistMode.onExit?.()}
            style={{
              padding: '9px 16px', borderRadius: 999,
              background: '#fff', color: T.copper[700],
              border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 13, fontWeight: 800, flexShrink: 0,
              boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
            }}
          >
            Salir de asistir
          </button>
        </div>
      )}
      <div style={{
        width: '100%', maxWidth: 360,
        background: '#fff', borderRadius: 22,
        padding: '32px 24px 24px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
        textAlign: 'center',
      }}>
        <div style={{ marginBottom: 14, display: 'flex', justifyContent: 'center' }}>
          <UserAvatar user={userDoc || authUser} size={64} />
        </div>
        <div style={{
          fontSize: 19, fontWeight: 800, color: T.neutral[900],
          letterSpacing: -0.3, marginBottom: 6,
        }}>
          Hola, {firstName}
        </div>
        <div style={{
          fontSize: 14, color: T.neutral[600], lineHeight: 1.5,
          marginBottom: 8,
        }}>
          Hoy estás como <b style={{ color: T.copper[700] }}>Domiciliaria / Mesera</b>
          {session?.branchName ? <> en <b>{session.branchName}</b></> : null}.
        </div>

        <div style={{
          marginTop: 18, padding: '14px 16px', borderRadius: 14,
          background: T.copper[50], border: `1px solid ${T.copper[100]}`,
          fontSize: 12.5, color: T.neutral[700], lineHeight: 1.5,
        }}>
          La app para este turno todavía está en construcción. Por ahora, coordina con el admin cómo registrar tu trabajo.
        </div>

        {!isAssist && (
          <button
            onClick={handleSignOut}
            disabled={busy}
            style={{
              width: '100%', marginTop: 18, padding: '11px',
              borderRadius: 12, border: `1px solid ${T.neutral[200]}`,
              background: 'transparent', color: T.neutral[600],
              fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
              cursor: busy ? 'wait' : 'pointer',
            }}
          >
            {busy ? 'Saliendo...' : 'Cerrar sesión'}
          </button>
        )}
      </div>
    </div>
  )
}

import { useState } from 'react'
import { T } from '../tokens'
import { UserAvatar } from '../components/Atoms'
import { signOut } from '../auth'

/**
 * Placeholder de app para Domiciliaria / Mesera.
 * Por definir qué funcionalidad va a tener.
 */
export default function WaitressApp({ authUser, userDoc, session }) {
  const [busy, setBusy] = useState(false)

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
      </div>
    </div>
  )
}

import { useState } from 'react'
import { T } from '../tokens'
import { UserAvatar } from '../components/Atoms'
import { signOut } from '../auth'
import ContactSupportButton from '../components/ContactSupportButton'

/**
 * Pantalla que ve un staff cuando no tiene ningún turno abierto.
 * El admin debe asignarle uno desde el panel central.
 */
export default function NoShiftScreen({ authUser, userDoc }) {
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
          marginBottom: 24,
        }}>
          Aún no tienes turno abierto. En cuanto el admin te asigne uno, esta pantalla cambiará automáticamente.
        </div>

        <div style={{
          padding: '14px 16px', borderRadius: 14,
          background: T.copper[50], border: `1px solid ${T.copper[100]}`,
          marginBottom: 16,
        }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: T.copper[700],
            letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4,
          }}>
            ¿Ya deberías estar trabajando?
          </div>
          <div style={{ fontSize: 12.5, color: T.neutral[700], lineHeight: 1.5 }}>
            Llama al admin para que te abra el turno desde su panel.
          </div>
        </div>

        <ContactSupportButton
          variant="card"
          reason="Necesito que me abran turno en TodyPan"
          userContext={`Cuenta: ${authUser?.email || ''} (${firstName})`}
        />

        <button
          onClick={handleSignOut}
          disabled={busy}
          style={{
            width: '100%', marginTop: 12, padding: '11px',
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

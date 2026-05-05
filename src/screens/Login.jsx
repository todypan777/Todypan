import { useEffect, useState } from 'react'
import { T } from '../tokens'
import { TodyMark } from '../components/Atoms'
import { signInWithGoogle, signOut, getAndClearRedirectError } from '../auth'

function describeAuthError(code) {
  switch (code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return null // cancelación voluntaria, no es error
    case 'auth/popup-blocked':
      return 'Tu navegador bloqueó la ventana. Permite popups o intenta de nuevo.'
    case 'auth/network-request-failed':
      return 'Sin conexión a internet. Verifica tu red e intenta de nuevo.'
    case 'auth/unauthorized-domain':
      return 'Este dominio no está autorizado en Firebase. El admin debe agregarlo en Authentication → Settings → Authorized domains.'
    case 'auth/operation-not-supported-in-this-environment':
      return 'Este navegador no soporta el inicio de sesión. Intenta con Chrome o Safari.'
    case 'auth/web-storage-unsupported':
      return 'Tu navegador tiene cookies/almacenamiento bloqueado. Habilítalo e intenta de nuevo.'
    default:
      return 'No pudimos iniciar sesión. Intenta de nuevo.'
  }
}

export default function Login({ unauthorizedEmail = null }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // Al montar: si volvimos de un redirect con error, mostrarlo
  useEffect(() => {
    const e = getAndClearRedirectError()
    if (e) setError(describeAuthError(e.code) || 'No pudimos iniciar sesión. Intenta de nuevo.')
  }, [])

  async function handleSignIn() {
    setError(null)
    setBusy(true)
    try {
      await signInWithGoogle()
    } catch (err) {
      console.error(err)
      const msg = describeAuthError(err?.code || '')
      if (msg) setError(msg)
      setBusy(false)
    }
  }

  async function handleSwitchAccount() {
    await signOut()
    handleSignIn()
  }

  return (
    <div style={{
      minHeight: '100dvh',
      background: T.neutral[50],
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '32px 24px',
      fontFamily: '-apple-system, "SF Pro Text", "Inter", system-ui, sans-serif',
      color: T.neutral[800],
    }}>
      {/* Logo + título */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        marginBottom: 40,
      }}>
        <div style={{
          width: 84, height: 84, borderRadius: 24,
          background: T.copper[50], border: `1px solid ${T.copper[100]}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 20,
          boxShadow: '0 8px 24px rgba(184,122,86,0.15)',
        }}>
          <TodyMark size={48} color={T.copper[500]} />
        </div>
        <div style={{
          fontSize: 32, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.8,
          marginBottom: 6,
        }}>
          TodyPan
        </div>
        <div style={{
          fontSize: 14, color: T.neutral[500], fontWeight: 500, textAlign: 'center',
        }}>
          Gestión de panaderías
        </div>
      </div>

      {/* Card de login */}
      <div style={{
        width: '100%', maxWidth: 380,
        background: '#fff', borderRadius: 20,
        border: `1px solid ${T.neutral[100]}`,
        padding: '28px 24px',
        boxShadow: '0 4px 16px rgba(45,35,25,0.04)',
      }}>
        {unauthorizedEmail ? (
          <UnauthorizedBlock
            email={unauthorizedEmail}
            onSwitch={handleSwitchAccount}
            busy={busy}
          />
        ) : (
          <>
            <div style={{
              fontSize: 18, fontWeight: 700, color: T.neutral[900],
              textAlign: 'center', marginBottom: 6, letterSpacing: -0.2,
            }}>
              Inicia sesión
            </div>
            <div style={{
              fontSize: 13, color: T.neutral[500], textAlign: 'center',
              marginBottom: 24, lineHeight: 1.45,
            }}>
              Accede al panel de administración con tu cuenta de Google.
            </div>

            <button
              onClick={handleSignIn}
              disabled={busy}
              style={{
                width: '100%', padding: '13px 16px', borderRadius: 12,
                background: '#fff', color: T.neutral[800],
                border: `1.5px solid ${T.neutral[200]}`,
                cursor: busy ? 'wait' : 'pointer',
                fontFamily: 'inherit', fontSize: 14.5, fontWeight: 600,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
                opacity: busy ? 0.6 : 1,
                transition: 'background 0.15s, border-color 0.15s',
              }}
              onMouseDown={e => { if (!busy) e.currentTarget.style.background = T.neutral[50] }}
              onMouseUp={e => { e.currentTarget.style.background = '#fff' }}
              onMouseLeave={e => { e.currentTarget.style.background = '#fff' }}
            >
              <GoogleLogo />
              {busy ? 'Conectando...' : 'Continuar con Google'}
            </button>

            {error && (
              <div style={{
                marginTop: 16, padding: '10px 12px', borderRadius: 10,
                background: '#FBE9E5', border: `1px solid #F0C8BE`, color: T.bad,
                fontSize: 12.5, fontWeight: 500, textAlign: 'center',
              }}>
                {error}
              </div>
            )}
          </>
        )}
      </div>

      <div style={{
        marginTop: 28, fontSize: 11.5, color: T.neutral[400],
        textAlign: 'center', maxWidth: 320, lineHeight: 1.5,
      }}>
        Solo cuentas autorizadas pueden acceder al panel.
      </div>
    </div>
  )
}

function UnauthorizedBlock({ email, onSwitch, busy }) {
  return (
    <>
      <div style={{
        width: 56, height: 56, borderRadius: 999, background: '#FBE9E5',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        margin: '0 auto 16px',
      }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <path d="M12 8 V13" stroke={T.bad} strokeWidth="2.2" strokeLinecap="round"/>
          <circle cx="12" cy="16.5" r="1.2" fill={T.bad}/>
          <circle cx="12" cy="12" r="9" stroke={T.bad} strokeWidth="2" fill="none"/>
        </svg>
      </div>
      <div style={{
        fontSize: 18, fontWeight: 700, color: T.neutral[900],
        textAlign: 'center', marginBottom: 8, letterSpacing: -0.2,
      }}>
        Acceso no autorizado
      </div>
      <div style={{
        fontSize: 13.5, color: T.neutral[600], textAlign: 'center',
        marginBottom: 4, lineHeight: 1.5,
      }}>
        La cuenta
      </div>
      <div style={{
        fontSize: 13.5, color: T.copper[700], fontWeight: 600,
        textAlign: 'center', marginBottom: 6, wordBreak: 'break-all',
      }}>
        {email}
      </div>
      <div style={{
        fontSize: 13.5, color: T.neutral[600], textAlign: 'center',
        marginBottom: 22, lineHeight: 1.5,
      }}>
        no tiene permiso para acceder a TodyPan.
      </div>

      <button
        onClick={onSwitch}
        disabled={busy}
        style={{
          width: '100%', padding: '13px 16px', borderRadius: 12,
          background: T.copper[500], color: '#fff',
          border: 'none', cursor: busy ? 'wait' : 'pointer',
          fontFamily: 'inherit', fontSize: 14.5, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          opacity: busy ? 0.7 : 1,
          boxShadow: '0 3px 10px rgba(184,122,86,0.3)',
        }}
      >
        Cambiar de cuenta
      </button>
    </>
  )
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18">
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.583-5.036-3.71H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
      <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
    </svg>
  )
}

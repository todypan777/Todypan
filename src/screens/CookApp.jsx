import { useState } from 'react'
import { T } from '../tokens'
import { UserAvatar } from '../components/Atoms'
import { signOut } from '../auth'

// ──────────────────────────────────────────────────────────────
// Vista de la cocinera. Por ahora es un placeholder limpio mientras
// definimos las funciones que tendrá. La pantalla la verán las personas
// con role='cook' y status='approved'.
// ──────────────────────────────────────────────────────────────
export default function CookApp({ authUser, userDoc }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmSignOut, setConfirmSignOut] = useState(false)

  const firstName = userDoc?.nombre || ''

  return (
    <div style={{
      minHeight: '100dvh', background: T.neutral[50],
      fontFamily: '-apple-system, "SF Pro Text", "Inter", system-ui, sans-serif',
      color: T.neutral[800],
    }}>
      {/* Top bar */}
      <div style={{
        padding: '14px 18px',
        display: 'flex', alignItems: 'center', gap: 10,
        background: '#fff',
        borderBottom: `1px solid ${T.neutral[100]}`,
        position: 'sticky', top: 0, zIndex: 20,
      }}>
        <img
          src="/Logo.png"
          alt="Infinity Eventos"
          style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3 }}>
            TodyPan
          </div>
          <div style={{
            fontSize: 11, color: T.neutral[500],
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {userDoc?.nombre} {userDoc?.apellido}
          </div>
        </div>

        <button
          onClick={() => setMenuOpen(true)}
          style={{
            width: 36, height: 36, borderRadius: 999,
            background: 'transparent', border: 'none', padding: 0,
            cursor: 'pointer', flexShrink: 0,
          }}
        >
          <UserAvatar user={authUser} size={34} />
        </button>
      </div>

      {/* Contenido — placeholder */}
      <div style={{
        padding: '60px 24px 40px', maxWidth: 480, margin: '0 auto',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18,
      }}>
        <div style={{
          width: 96, height: 96, borderRadius: 999,
          background: T.copper[50], border: `1px solid ${T.copper[100]}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {/* Gorro de chef */}
          <svg width="50" height="50" viewBox="0 0 24 24" fill="none">
            <path
              d="M7 13 V20 H17 V13"
              stroke={T.copper[600]} strokeWidth="1.6" fill="none" strokeLinejoin="round"
            />
            <path
              d="M6 13 Q3 13 3 10 Q3 6.5 7 6.5 Q8 4 12 4 Q16 4 17 6.5 Q21 6.5 21 10 Q21 13 18 13"
              stroke={T.copper[600]} strokeWidth="1.6" fill="none" strokeLinejoin="round"
            />
            <path d="M9 16 H15" stroke={T.copper[600]} strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
        </div>

        <div style={{
          fontSize: 22, fontWeight: 800, color: T.neutral[900],
          letterSpacing: -0.4, textAlign: 'center', lineHeight: 1.25,
        }}>
          {firstName ? `Hola, ${firstName}` : 'Hola'}
        </div>

        <div style={{
          fontSize: 14, color: T.neutral[600], textAlign: 'center',
          lineHeight: 1.55, maxWidth: 340,
        }}>
          Tu panel de cocina aún está en preparación.
          Pronto verás aquí tus recetas, producción del día y pedidos por preparar.
        </div>

        <div style={{
          marginTop: 6, padding: '14px 18px', borderRadius: 14,
          background: '#fff', border: `1px solid ${T.neutral[100]}`,
          fontSize: 12.5, color: T.neutral[600], textAlign: 'center',
          maxWidth: 340, lineHeight: 1.55,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: 999, flexShrink: 0,
            background: T.copper[50],
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14,
          }}>
            🥖
          </div>
          <div style={{ flex: 1, textAlign: 'left' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.neutral[700] }}>
              Cuenta activa
            </div>
            <div style={{ fontSize: 11.5, color: T.neutral[500], marginTop: 1 }}>
              El administrador te avisará cuando habilite las funciones.
            </div>
          </div>
        </div>
      </div>

      {/* Menú avatar */}
      {menuOpen && (
        <div onClick={() => setMenuOpen(false)} style={{
          position: 'fixed', inset: 0, zIndex: 90,
          background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            width: '100%', maxWidth: 340, background: '#fff', borderRadius: 20,
            padding: '20px 0 12px', boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '0 22px 16px', borderBottom: `1px solid ${T.neutral[100]}`,
            }}>
              <UserAvatar user={authUser} size={44} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 14.5, fontWeight: 700, color: T.neutral[900],
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {userDoc?.nombre} {userDoc?.apellido}
                </div>
                <div style={{
                  fontSize: 11.5, color: T.neutral[500],
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {authUser?.email}
                </div>
              </div>
            </div>

            <button
              onClick={() => { setMenuOpen(false); setConfirmSignOut(true) }}
              style={{
                width: '100%', padding: '14px 22px',
                background: 'transparent', border: 'none',
                cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 14.5, fontWeight: 600, color: T.bad,
                display: 'flex', alignItems: 'center', gap: 14,
                textAlign: 'left',
              }}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M8 4 L4 4 L4 16 L8 16" stroke={T.bad} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M11 7 L15 10 L11 13 M15 10 H7" stroke={T.bad} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span style={{ flex: 1 }}>Cerrar sesión</span>
            </button>

            <div style={{ padding: '8px 12px 0' }}>
              <button
                onClick={() => setMenuOpen(false)}
                style={{
                  width: '100%', padding: '10px', borderRadius: 12,
                  background: T.neutral[100], color: T.neutral[700],
                  border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 13.5, fontWeight: 600,
                }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmSignOut && (
        <SignOutModal
          onCancel={() => setConfirmSignOut(false)}
          onConfirm={async () => { await signOut() }}
        />
      )}
    </div>
  )
}

function SignOutModal({ onCancel, onConfirm }) {
  const [busy, setBusy] = useState(false)
  return (
    <div onClick={busy ? undefined : onCancel} style={{
      position: 'fixed', inset: 0, zIndex: 95,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 340, background: '#fff', borderRadius: 20,
        padding: '24px 22px', boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
      }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: T.neutral[900], textAlign: 'center', marginBottom: 8 }}>
          Cerrar sesión
        </div>
        <div style={{ fontSize: 13.5, color: T.neutral[600], textAlign: 'center', marginBottom: 22, lineHeight: 1.5 }}>
          ¿Seguro que quieres salir?
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCancel} disabled={busy} style={{
            flex: 1, padding: '12px', borderRadius: 12,
            background: T.neutral[100], color: T.neutral[700],
            border: 'none', cursor: busy ? 'wait' : 'pointer',
            fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
          }}>
            Cancelar
          </button>
          <button
            onClick={async () => { setBusy(true); await onConfirm() }}
            disabled={busy}
            style={{
              flex: 1, padding: '12px', borderRadius: 12,
              background: T.bad, color: '#fff',
              border: 'none', cursor: busy ? 'wait' : 'pointer',
              fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? 'Saliendo...' : 'Cerrar sesión'}
          </button>
        </div>
      </div>
    </div>
  )
}

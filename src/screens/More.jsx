import { useState } from 'react'
import { T } from '../tokens'
import { Card, TodyMark, UserAvatar } from '../components/Atoms'
import { ScreenHeader } from '../components/Nav'
import { useAuth } from '../context/AuthCtx'
import { signOut } from '../auth'

export default function More({ onOpen }) {
  const { user } = useAuth()
  const [signingOut, setSigningOut] = useState(false)
  const [confirmSignOut, setConfirmSignOut] = useState(false)

  const items = [
    {
      id: 'movements', label: 'Movimientos', desc: 'Historial de ingresos y gastos',
      icon: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M3 6 H13 M3 6 L6 3 M3 6 L6 9" stroke={T.copper[600]} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M17 14 H7 M17 14 L14 11 M17 14 L14 17" stroke={T.copper[600]} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ),
    },
    {
      id: 'reports', label: 'Reportes', desc: 'Análisis del mes',
      icon: (
        <svg width="20" height="20" viewBox="0 0 20 20"><path d="M4 16 V8 M9 16 V4 M14 16 V11" stroke={T.copper[600]} strokeWidth="2" strokeLinecap="round"/><path d="M3 18 H17" stroke={T.copper[600]} strokeWidth="1.5" strokeLinecap="round"/></svg>
      ),
    },
    {
      id: 'products', label: 'Productos', desc: 'Costos, precios y márgenes de ganancia',
      icon: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <rect x="3" y="8" width="14" height="9" rx="2" stroke={T.copper[600]} strokeWidth="1.6" fill="none"/>
          <path d="M6 8 Q6 4 10 4 Q14 4 14 8" stroke={T.copper[600]} strokeWidth="1.6" fill="none"/>
          <path d="M7 12.5 H13 M9.5 11 V14" stroke={T.copper[600]} strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
      ),
    },
    {
      id: 'reminders', label: 'Recordatorios', desc: 'Servicios y pagos fijos',
      icon: (
        <svg width="20" height="20" viewBox="0 0 20 20"><path d="M5 8 Q5 4 10 4 Q15 4 15 8 V12 L17 15 H3 L5 12 Z" stroke={T.copper[600]} strokeWidth="1.6" fill="none" strokeLinejoin="round"/><path d="M8 16 Q8 18 10 18 Q12 18 12 16" stroke={T.copper[600]} strokeWidth="1.6" fill="none"/></svg>
      ),
    },
    {
      id: 'branches', label: 'Panaderías', desc: 'Panadería Iglesia y Panadería Esquina',
      icon: (
        <svg width="20" height="20" viewBox="0 0 20 20"><path d="M3 9 L10 4 L17 9 V16 H3 Z" stroke={T.copper[600]} strokeWidth="1.6" fill="none" strokeLinejoin="round"/><path d="M8 16 V12 H12 V16" stroke={T.copper[600]} strokeWidth="1.6" fill="none"/></svg>
      ),
    },
  ]

  async function handleSignOut() {
    setSigningOut(true)
    try {
      await signOut()
    } catch (err) {
      console.error('Error al cerrar sesión:', err)
      setSigningOut(false)
      setConfirmSignOut(false)
    }
  }

  return (
    <div style={{ paddingBottom: 110 }}>
      <ScreenHeader title="Más" subtitle="TodyPan" right={<TodyMark size={30}/>}/>

      {/* Bloque de cuenta */}
      {user && (
        <div style={{ padding: '4px 16px 12px' }}>
          <Card padding={0}>
            <div style={{
              padding: '14px 16px',
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <UserAvatar user={user} size={42} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 14.5, fontWeight: 700, color: T.neutral[900],
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {user.displayName || 'Administrador'}
                </div>
                <div style={{
                  fontSize: 12, color: T.neutral[500], marginTop: 1,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {user.email}
                </div>
              </div>
              <span style={{
                fontSize: 10, fontWeight: 700, color: T.copper[700],
                background: T.copper[50], padding: '3px 8px', borderRadius: 999,
                letterSpacing: 0.4, textTransform: 'uppercase', flexShrink: 0,
              }}>
                Admin
              </span>
            </div>
          </Card>
        </div>
      )}

      <div style={{ padding: '4px 16px 0' }}>
        <Card padding={0}>
          {items.map((it, i) => (
            <div key={it.id} onClick={() => onOpen(it.id)} style={{
              padding: '15px 16px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 14,
              borderBottom: i < items.length - 1 ? `0.5px solid ${T.neutral[100]}` : 'none',
            }}>
              <div style={{
                width: 38, height: 38, borderRadius: 10, background: T.copper[50],
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>{it.icon}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: T.neutral[800] }}>{it.label}</div>
                <div style={{ fontSize: 12, color: T.neutral[500], marginTop: 2 }}>{it.desc}</div>
              </div>
              <svg width="7" height="12" viewBox="0 0 7 12"><path d="M1 1 L6 6 L1 11" stroke={T.neutral[300]} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
          ))}
        </Card>
      </div>

      {/* Cerrar sesión */}
      <div style={{ padding: '16px 16px 0' }}>
        <Card padding={0}>
          <button
            onClick={() => setConfirmSignOut(true)}
            style={{
              width: '100%', padding: '15px 16px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 14,
              background: 'none', border: 'none', fontFamily: 'inherit', textAlign: 'left',
            }}
          >
            <div style={{
              width: 38, height: 38, borderRadius: 10, background: '#FBE9E5',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M11 4 H6 Q4 4 4 6 V14 Q4 16 6 16 H11" stroke={T.bad} strokeWidth="1.6" fill="none" strokeLinecap="round"/>
                <path d="M14 7 L17 10 L14 13 M9 10 H17" stroke={T.bad} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: T.bad }}>Cerrar sesión</div>
            </div>
          </button>
        </Card>
      </div>

      <div style={{ padding: '24px 20px', textAlign: 'center', color: T.neutral[400], fontSize: 11 }}>
        TodyPan · versión 1.0
      </div>

      {confirmSignOut && (
        <SignOutModal
          busy={signingOut}
          onCancel={() => setConfirmSignOut(false)}
          onConfirm={handleSignOut}
        />
      )}
    </div>
  )
}

function SignOutModal({ busy, onCancel, onConfirm }) {
  return (
    <div
      onClick={busy ? undefined : onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 90,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 340,
          background: '#fff', borderRadius: 20,
          padding: '24px 22px',
          boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
          animation: 'fadeScaleIn 0.2s ease',
        }}
      >
        <div style={{
          fontSize: 17, fontWeight: 700, color: T.neutral[900],
          textAlign: 'center', marginBottom: 8, letterSpacing: -0.2,
        }}>
          Cerrar sesión
        </div>
        <div style={{
          fontSize: 13.5, color: T.neutral[600], textAlign: 'center',
          marginBottom: 22, lineHeight: 1.5,
        }}>
          ¿Seguro que quieres salir de TodyPan?
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
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
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

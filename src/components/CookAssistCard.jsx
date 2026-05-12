import { useState } from 'react'
import { T } from '../tokens'
import { useAuth } from '../context/AuthCtx'
import CookApp from '../screens/CookApp'
import ErrorBoundary from './ErrorBoundary'

// Card del Dashboard del admin que permite "Asistir cocinera": abre la
// vista de la cocinera (CookApp) en fullscreen con modo asistir. Reusa
// 100% los editores de menú/catálogo extraídos en components/MenuEditor.
//
// Patrón gemelo al "Asistir cajera" de ActiveTurnsCard — botón en el
// dashboard, overlay fullscreen, salida con flecha.
export default function CookAssistCard() {
  const { authUser, userDoc } = useAuth()
  const [open, setOpen] = useState(false)

  // Defensa: si por alguna razón un no-admin renderiza este componente,
  // no abrir nada. Las reglas Firestore tienen la palabra final, pero
  // aquí evitamos confusión visual.
  if (userDoc?.role !== 'admin') return null

  return (
    <>
      <div style={{ padding: '0 16px 12px' }}>
        <div style={{
          background: '#fff', borderRadius: 16,
          border: `1px solid ${T.neutral[100]}`,
          padding: '14px 16px',
          display: 'flex', alignItems: 'center', gap: 14,
          boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12, flexShrink: 0,
            background: T.copper[50], border: `1px solid ${T.copper[100]}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22,
          }}>
            🍳
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 14, fontWeight: 800, color: T.neutral[900],
              letterSpacing: -0.2,
            }}>
              Cocina
            </div>
            <div style={{
              fontSize: 11.5, color: T.neutral[500],
              lineHeight: 1.4, marginTop: 2,
            }}>
              Edita el menú del día o revisa pedidos archivados
            </div>
          </div>
          <button
            onClick={() => setOpen(true)}
            style={{
              padding: '10px 16px', borderRadius: 12,
              background: T.copper[500], color: '#fff',
              border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 12.5, fontWeight: 800, letterSpacing: 0.3,
              boxShadow: '0 3px 10px rgba(184,122,86,0.3)',
              flexShrink: 0,
            }}
          >
            Asistir cocinera
          </button>
        </div>
      </div>

      {open && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 80, background: T.neutral[50],
          animation: 'cookAssistSlide 0.25s cubic-bezier(0.2,0.9,0.3,1.05)',
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
        }}>
          <ErrorBoundary label="la vista de cocina">
            <CookApp
              authUser={authUser}
              userDoc={userDoc}
              assistMode={{ onExit: () => setOpen(false) }}
            />
          </ErrorBoundary>
          <style>{`
            @keyframes cookAssistSlide {
              from { transform: translateY(8%); opacity: 0; }
              to   { transform: translateY(0); opacity: 1; }
            }
          `}</style>
        </div>
      )}
    </>
  )
}

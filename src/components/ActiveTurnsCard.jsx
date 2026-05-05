import { useEffect, useState } from 'react'
import { T } from '../tokens'
import { Card } from './Atoms'
import { useAuth } from '../context/AuthCtx'
import { watchOpenSessions } from '../cashSessions'
import NewSale from '../screens/NewSale'

/**
 * Tarjeta para el dashboard del admin: lista los turnos activos de las
 * cajeras y permite "Asistir" (hacer ventas en su turno mientras la cajera
 * está ausente).
 *
 * Solo visible si hay sesiones abiertas (status 'open' — sin pending_close
 * porque ahí ya cerró el turno).
 */
export default function ActiveTurnsCard() {
  const { authUser, userDoc } = useAuth()
  const [openSessions, setOpenSessions] = useState([])
  const [assistingSession, setAssistingSession] = useState(null)

  useEffect(() => watchOpenSessions(setOpenSessions), [])

  // Solo turnos realmente abiertos (no los pending_close)
  const activeTurns = openSessions.filter(s => s.status === 'open')

  if (activeTurns.length === 0) return null

  const adminName = `${userDoc?.nombre || ''} ${userDoc?.apellido || ''}`.trim() || authUser?.email || 'Admin'

  return (
    <>
      <div style={{ padding: '0 16px 16px' }}>
        <Card padding={0} style={{
          background: '#fff',
          border: `1px solid ${T.copper[100]}`,
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '12px 16px 8px',
            display: 'flex', alignItems: 'center', gap: 8,
            borderBottom: `1px solid ${T.neutral[100]}`,
          }}>
            <div style={{
              width: 8, height: 8, borderRadius: 999, background: T.ok,
              boxShadow: `0 0 0 4px ${T.ok}22`,
            }}/>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.neutral[700], letterSpacing: 0.4, textTransform: 'uppercase' }}>
              Turnos activos · {activeTurns.length}
            </div>
          </div>
          {activeTurns.map((s, i) => (
            <div key={s.id} style={{
              padding: '12px 16px',
              borderBottom: i < activeTurns.length - 1 ? `0.5px solid ${T.neutral[100]}` : 'none',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 14, fontWeight: 700, color: T.neutral[900],
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {s.branchName || 'Panadería'}
                </div>
                <div style={{
                  fontSize: 12, color: T.neutral[500], marginTop: 2,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {s.cashierName || 'Cajera'}
                </div>
              </div>
              <button
                onClick={() => setAssistingSession(s)}
                style={{
                  padding: '8px 14px', borderRadius: 10,
                  background: T.copper[500], color: '#fff',
                  border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 12.5, fontWeight: 700,
                  boxShadow: '0 2px 6px rgba(184,122,86,0.3)',
                  display: 'flex', alignItems: 'center', gap: 6,
                  flexShrink: 0,
                }}
              >
                Asistir
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                  <path d="M3 1 L8 6 L3 11" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
          ))}
        </Card>
      </div>

      {/* Modal full-screen con el POS de la cajera */}
      {assistingSession && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 80, background: T.neutral[50],
          animation: 'slideUp 0.25s cubic-bezier(0.2,0.9,0.3,1.05)',
        }}>
          <NewSale
            session={assistingSession}
            authUser={authUser}
            userDoc={userDoc}
            assistMode={{ adminUid: authUser.uid, adminName }}
            onCancel={() => setAssistingSession(null)}
            onSaved={() => setAssistingSession(null)}
          />
        </div>
      )}
    </>
  )
}

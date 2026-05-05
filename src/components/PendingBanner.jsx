import { useEffect, useRef, useState } from 'react'
import { T } from '../tokens'
import { Card, UserAvatar } from './Atoms'
import { fmtCOP } from '../utils/format'
import { watchAllUsers } from '../users'
import { watchSessionsWithPendingReview } from '../cashSessions'
import { watchPendingExpenses } from '../cashExpenses'

/**
 * Banner en Dashboard que muestra todo lo que el admin tiene pendiente:
 * - Usuarios esperando aprobación
 * - Disputas de apertura de caja (Fase 2)
 * - Faltas de cierre de caja (Fase 2)
 * - (Más adelante) gastos de caja pendientes, solicitudes de edición, etc.
 *
 * La PRIMERA vez que el admin entra a la app en una sesión y hay usuarios
 * pendientes, abre un popup automático (decisión D13).
 */
export default function PendingBanner({ onOpenUsers, onOpenPendientes }) {
  const [pendingUsers, setPendingUsers] = useState([])
  const [pendingSessions, setPendingSessions] = useState([])
  const [pendingExpenses, setPendingExpenses] = useState([])
  const [showPopup, setShowPopup] = useState(false)
  const [popupShown, setPopupShown] = useState(false)
  const [closesPopup, setClosesPopup] = useState(null)  // sesiones nuevas a mostrar
  const seenCloseIdsRef = useRef(new Set())

  useEffect(() => {
    const unsub = watchAllUsers(list => {
      const pending = list.filter(u => u.status === 'pending')
      setPendingUsers(pending)
      if (pending.length > 0 && !popupShown) {
        setShowPopup(true)
        setPopupShown(true)
      }
    })
    return unsub
  }, [popupShown])

  useEffect(() => {
    const unsub = watchSessionsWithPendingReview(setPendingSessions)
    return unsub
  }, [])

  // Detectar nuevos cierres pending_close (al cargar o en tiempo real)
  // y mostrar popup llamativo al admin
  useEffect(() => {
    const closesNeedingApproval = pendingSessions.filter(s => s.status === 'pending_close')
    const newOnes = closesNeedingApproval.filter(s => !seenCloseIdsRef.current.has(s.id))

    if (newOnes.length > 0) {
      newOnes.forEach(s => seenCloseIdsRef.current.add(s.id))
      setClosesPopup(prev => {
        // Si ya hay un popup abierto, acumular los nuevos al existente
        if (prev && prev.length > 0) {
          const existingIds = new Set(prev.map(s => s.id))
          const merged = [...prev, ...newOnes.filter(s => !existingIds.has(s.id))]
          return merged
        }
        return newOnes
      })
    }
  }, [pendingSessions])

  useEffect(() => {
    const unsub = watchPendingExpenses(setPendingExpenses)
    return unsub
  }, [])

  // Separamos disputas de apertura de faltas de cierre
  const openingDisputes = pendingSessions.filter(s => s.openingDispute?.status === 'pending')
  const closingShortages = pendingSessions.filter(s =>
    s.closingDiscrepancy?.status === 'pending' && s.closingDiscrepancy?.type === 'shortage'
  )

  const total =
    pendingUsers.length +
    openingDisputes.length +
    closingShortages.length +
    pendingExpenses.length

  const subtitleParts = []
  if (pendingUsers.length > 0) {
    subtitleParts.push(
      pendingUsers.length === 1
        ? '1 solicitud de cuenta'
        : `${pendingUsers.length} solicitudes de cuenta`
    )
  }
  if (openingDisputes.length > 0) {
    subtitleParts.push(
      openingDisputes.length === 1
        ? '1 disputa de apertura'
        : `${openingDisputes.length} disputas de apertura`
    )
  }
  if (closingShortages.length > 0) {
    subtitleParts.push(
      closingShortages.length === 1
        ? '1 falta de cierre'
        : `${closingShortages.length} faltas de cierre`
    )
  }
  if (pendingExpenses.length > 0) {
    subtitleParts.push(
      pendingExpenses.length === 1
        ? '1 gasto de caja'
        : `${pendingExpenses.length} gastos de caja`
    )
  }

  // Si no hay nada pendiente, no renderizamos nada
  if (total === 0) return null

  return (
    <>
      {total > 0 && (
        <div style={{ padding: '8px 16px 0' }}>
          <Card padding={0} style={{
            background: T.copper[50],
            border: `1px solid ${T.copper[100]}`,
            boxShadow: 'none',
          }}>
            <button
              onClick={onOpenPendientes || onOpenUsers}
              style={{
                width: '100%', padding: '14px 16px',
                display: 'flex', alignItems: 'center', gap: 12,
                background: 'transparent', border: 'none',
                cursor: 'pointer', fontFamily: 'inherit',
                textAlign: 'left',
              }}
            >
              <div style={{
                width: 36, height: 36, borderRadius: 999,
                background: T.copper[100],
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                  <path d="M5 8 Q5 4 10 4 Q15 4 15 8 V12 L17 15 H3 L5 12 Z" stroke={T.copper[700]} strokeWidth="1.6" fill="none" strokeLinejoin="round"/>
                  <path d="M8 16 Q8 18 10 18 Q12 18 12 16" stroke={T.copper[700]} strokeWidth="1.6" fill="none"/>
                </svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.copper[700] }}>
                  Tienes {total} {total === 1 ? 'cosa' : 'cosas'} por revisar
                </div>
                <div style={{ fontSize: 12, color: T.copper[600], marginTop: 1 }}>
                  {subtitleParts.join(' · ')}
                </div>
              </div>
              <svg width="8" height="14" viewBox="0 0 7 12">
                <path d="M1 1 L6 6 L1 11" stroke={T.copper[700]} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </Card>

          {openingDisputes.length > 0 && (
            <DetailBox title="Disputa de apertura de caja" tone="warn">
              {openingDisputes.map(s => (
                <div key={s.id} style={{ marginTop: 4, fontWeight: 500 }}>
                  <b>{s.cashierName}</b> dice haber recibido <b>{fmtMoney(s.openingDispute.declared)}</b> pero la cajera anterior reportó haber entregado <b>{fmtMoney(s.openingDispute.expected)}</b> en {s.branchName || '(sin nombre)'}.
                </div>
              ))}
              <FaseFootnote />
            </DetailBox>
          )}

          {closingShortages.length > 0 && (
            <DetailBox title="Falta al cerrar caja" tone="bad">
              {closingShortages.map(s => (
                <div key={s.id} style={{ marginTop: 4, fontWeight: 500 }}>
                  <b>{s.cashierName}</b> cerró {s.branchName || '(sin nombre)'} con falta de <b>{fmtMoney(s.closingDiscrepancy.amount)}</b>.
                  {s.closingDiscrepancy.note && (
                    <div style={{ marginTop: 4, fontStyle: 'italic', color: T.neutral[600], fontWeight: 400 }}>
                      Nota: {s.closingDiscrepancy.note}
                    </div>
                  )}
                </div>
              ))}
              <FaseFootnote />
            </DetailBox>
          )}

          {pendingExpenses.length > 0 && (
            <DetailBox title="Gastos de caja pendientes de aprobar" tone="warn">
              {pendingExpenses.map(e => (
                <div key={e.id} style={{ marginTop: 4, fontWeight: 500 }}>
                  <b>{e.cashierName}</b> registró <b>{fmtMoney(e.amount)}</b> · {e.description}
                  {e.photoUrl && (
                    <span> · <a href={e.photoUrl} target="_blank" rel="noreferrer" style={{ color: T.copper[700], textDecoration: 'underline' }}>ver foto</a></span>
                  )}
                </div>
              ))}
              <FaseFootnote />
            </DetailBox>
          )}
        </div>
      )}

      {showPopup && (
        <PendingUsersPopup
          users={pendingUsers}
          onReview={() => { setShowPopup(false); onOpenUsers() }}
          onLater={() => setShowPopup(false)}
        />
      )}

      {closesPopup && closesPopup.length > 0 && (
        <PendingClosesPopup
          sessions={closesPopup}
          onReview={() => {
            setClosesPopup(null)
            ;(onOpenPendientes || onOpenUsers)?.()
          }}
          onLater={() => setClosesPopup(null)}
        />
      )}
    </>
  )
}

function DetailBox({ title, tone, children }) {
  const styles = {
    warn: { bg: '#FFF7E6', border: '#F4E0BC', text: T.warn },
    bad:  { bg: '#FBE9E5', border: '#F0C8BE', text: T.bad },
  }
  const s = styles[tone] || styles.warn
  return (
    <div style={{
      marginTop: 8, padding: '11px 14px', borderRadius: 12,
      background: s.bg, border: `1px solid ${s.border}`,
      fontSize: 12.5, color: s.text, lineHeight: 1.5,
    }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>⚠ {title}</div>
      {children}
    </div>
  )
}

function FaseFootnote() {
  return (
    <div style={{ marginTop: 6, fontSize: 11.5, color: T.neutral[500] }}>
      La pestaña de revisión llegará en una próxima fase.
    </div>
  )
}

function fmtMoney(n) {
  return '$' + (Number(n) || 0).toLocaleString('es-CO')
}

// ──────────────────────────────────────────────────────────────
// Popup MUY llamativo para cierres de turno pendientes
// ──────────────────────────────────────────────────────────────
function PendingClosesPopup({ sessions, onReview, onLater }) {
  const isPlural = sessions.length > 1

  return (
    <div
      onClick={onLater}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
        animation: 'fadeIn 0.18s ease',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 440,
          background: '#fff', borderRadius: 24,
          boxShadow: '0 24px 64px rgba(0,0,0,0.35)',
          animation: 'pulseIn 0.32s cubic-bezier(0.2, 0.9, 0.3, 1.2)',
          overflow: 'hidden',
        }}
      >
        {/* Header con color llamativo */}
        <div style={{
          background: `linear-gradient(135deg, ${T.warn} 0%, #C08A3E 100%)`,
          padding: '28px 24px 24px',
          textAlign: 'center', position: 'relative',
        }}>
          {/* Icono pulsante grande */}
          <div style={{
            width: 84, height: 84, borderRadius: 999,
            background: 'rgba(255,255,255,0.2)',
            border: '3px solid rgba(255,255,255,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 14px',
            animation: 'iconPulse 1.5s ease-in-out infinite',
          }}>
            <svg width="44" height="44" viewBox="0 0 32 32" fill="none">
              <rect x="6" y="10" width="20" height="14" rx="2" stroke="#fff" strokeWidth="2.4" fill="none"/>
              <path d="M11 10 V7 Q11 5 13 5 H19 Q21 5 21 7 V10" stroke="#fff" strokeWidth="2.4" fill="none"/>
              <circle cx="16" cy="17" r="1.6" fill="#fff"/>
              <path d="M16 18.5 V21" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"/>
            </svg>
          </div>

          <div style={{
            fontSize: 11.5, fontWeight: 800, color: 'rgba(255,255,255,0.85)',
            letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 6,
          }}>
            Acción requerida
          </div>
          <div style={{
            fontSize: 22, fontWeight: 800, color: '#fff',
            letterSpacing: -0.4, lineHeight: 1.2,
          }}>
            {isPlural
              ? `${sessions.length} cierres de turno por aprobar`
              : 'Cierre de turno por aprobar'}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 22px' }}>
          <div style={{
            fontSize: 13.5, color: T.neutral[600],
            textAlign: 'center', lineHeight: 1.55, marginBottom: 16,
          }}>
            {isPlural
              ? 'Hay panaderías bloqueadas esperando tu aprobación para liberarse.'
              : 'Hay una panadería bloqueada esperando tu aprobación para liberarse.'}
          </div>

          {/* Lista de cierres */}
          <div style={{
            background: T.neutral[50], borderRadius: 14,
            padding: '4px 0', marginBottom: 18,
            maxHeight: 240, overflowY: 'auto',
          }}>
            {sessions.slice(0, 4).map((s, i) => {
              const cd = s.closingDiscrepancy
              const hasShortage = cd?.type === 'shortage'
              const hasSurplus = cd?.type === 'surplus'
              return (
                <div key={s.id} style={{
                  padding: '10px 14px',
                  borderBottom: i < Math.min(sessions.length, 4) - 1
                    ? `0.5px solid ${T.neutral[100]}`
                    : 'none',
                }}>
                  <div style={{
                    fontSize: 13, fontWeight: 700, color: T.neutral[900],
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {s.cashierName} · {s.branchName || 'Sin nombre'}
                  </div>
                  <div style={{ fontSize: 11.5, color: T.neutral[600], marginTop: 2 }}>
                    Esperado <b>{fmtCOP(s.expectedCash || 0)}</b> · Declaró <b>{fmtCOP(s.declaredClosingCash || 0)}</b>
                  </div>
                  {hasShortage && (
                    <div style={{
                      display: 'inline-block', marginTop: 4,
                      fontSize: 10.5, fontWeight: 700, color: T.bad,
                      background: '#FBE9E5',
                      padding: '2px 8px', borderRadius: 999,
                      letterSpacing: 0.4, textTransform: 'uppercase',
                    }}>
                      Falta {fmtCOP(cd.amount)}
                    </div>
                  )}
                  {hasSurplus && (
                    <div style={{
                      display: 'inline-block', marginTop: 4,
                      fontSize: 10.5, fontWeight: 700, color: T.ok,
                      background: '#E8F4E8',
                      padding: '2px 8px', borderRadius: 999,
                      letterSpacing: 0.4, textTransform: 'uppercase',
                    }}>
                      Sobra {fmtCOP(cd.amount)}
                    </div>
                  )}
                  {!cd && (
                    <div style={{
                      display: 'inline-block', marginTop: 4,
                      fontSize: 10.5, fontWeight: 700, color: T.ok,
                      background: '#E8F4E8',
                      padding: '2px 8px', borderRadius: 999,
                      letterSpacing: 0.4, textTransform: 'uppercase',
                    }}>
                      Cuadre exacto
                    </div>
                  )}
                </div>
              )
            })}
            {sessions.length > 4 && (
              <div style={{
                padding: '8px 14px', fontSize: 11.5,
                color: T.neutral[500], textAlign: 'center',
              }}>
                + {sessions.length - 4} más
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={onLater}
              style={{
                flex: 1, padding: '14px', borderRadius: 14,
                background: T.neutral[100], color: T.neutral[700],
                border: 'none', cursor: 'pointer',
                fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
              }}
            >
              Después
            </button>
            <button
              onClick={onReview}
              style={{
                flex: 1.6, padding: '14px', borderRadius: 14,
                background: T.warn, color: '#fff',
                border: 'none', cursor: 'pointer',
                fontFamily: 'inherit', fontSize: 14.5, fontWeight: 800,
                boxShadow: '0 4px 14px rgba(192,138,62,0.45)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              Revisar ahora
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3 7 H11 M8 4 L11 7 L8 10" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes pulseIn {
          0%   { transform: scale(0.92); opacity: 0; }
          50%  { transform: scale(1.02); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes iconPulse {
          0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255,255,255,0.4); }
          50%      { transform: scale(1.06); box-shadow: 0 0 0 12px rgba(255,255,255,0); }
        }
      `}</style>
    </div>
  )
}

function PendingUsersPopup({ users, onReview, onLater }) {
  return (
    <div
      onClick={onLater}
      style={{
        position: 'fixed', inset: 0, zIndex: 95,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 380,
          background: '#fff', borderRadius: 22,
          padding: '28px 24px 22px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          animation: 'fadeScaleIn 0.22s ease',
        }}
      >
        <div style={{
          width: 68, height: 68, borderRadius: 999,
          background: T.copper[50], border: `1px solid ${T.copper[100]}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 16px',
        }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
            <path d="M6 10 Q6 5 12 5 Q18 5 18 10 V14 L20 18 H4 L6 14 Z" stroke={T.copper[600]} strokeWidth="1.8" fill="none" strokeLinejoin="round"/>
            <path d="M9 19 Q9 22 12 22 Q15 22 15 19" stroke={T.copper[600]} strokeWidth="1.8" fill="none"/>
          </svg>
        </div>

        <div style={{
          fontSize: 19, fontWeight: 800, color: T.neutral[900],
          textAlign: 'center', marginBottom: 6, letterSpacing: -0.3,
        }}>
          {users.length === 1
            ? 'Una solicitud nueva'
            : `${users.length} solicitudes nuevas`}
        </div>
        <div style={{
          fontSize: 13.5, color: T.neutral[600], textAlign: 'center',
          marginBottom: 18, lineHeight: 1.5,
        }}>
          {users.length === 1
            ? 'Una persona quiere acceso a TodyPan.'
            : 'Varias personas quieren acceso a TodyPan.'}
        </div>

        <div style={{
          maxHeight: 220, overflowY: 'auto',
          background: T.neutral[50], borderRadius: 12,
          padding: '4px 0', marginBottom: 18,
        }}>
          {users.slice(0, 4).map((u, i) => (
            <div key={u.uid} style={{
              padding: '10px 14px',
              display: 'flex', alignItems: 'center', gap: 10,
              borderBottom: i < Math.min(users.length, 4) - 1 ? `0.5px solid ${T.neutral[100]}` : 'none',
            }}>
              <UserAvatar user={u} size={32} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13, fontWeight: 700, color: T.neutral[900],
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {u.nombre} {u.apellido}
                </div>
                <div style={{
                  fontSize: 11, color: T.neutral[500],
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {u.email}
                </div>
              </div>
            </div>
          ))}
          {users.length > 4 && (
            <div style={{
              padding: '8px 14px', fontSize: 11.5, color: T.neutral[500], textAlign: 'center',
            }}>
              + {users.length - 4} más
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onLater}
            style={{
              flex: 1, padding: '12px', borderRadius: 12,
              background: T.neutral[100], color: T.neutral[700],
              border: 'none', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
            }}
          >
            Después
          </button>
          <button
            onClick={onReview}
            style={{
              flex: 1.4, padding: '12px', borderRadius: 12,
              background: T.copper[500], color: '#fff',
              border: 'none', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
              boxShadow: '0 3px 10px rgba(184,122,86,0.3)',
            }}
          >
            Revisar
          </button>
        </div>
      </div>
    </div>
  )
}

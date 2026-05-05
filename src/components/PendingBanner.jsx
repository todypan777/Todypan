import { useEffect, useState } from 'react'
import { T } from '../tokens'
import { Card, UserAvatar } from './Atoms'
import { watchAllUsers } from '../users'
import { watchSessionsWithPendingReview, watchSurplusFundBalance } from '../cashSessions'
import { watchPendingExpenses } from '../cashExpenses'

/**
 * Banner en Dashboard que muestra todo lo que el admin tiene pendiente:
 * - Usuarios esperando aprobación
 * - Disputas de apertura de caja (Fase 2)
 * - Faltas de cierre de caja (Fase 2)
 * - (Más adelante) gastos de caja pendientes, solicitudes de edición, etc.
 *
 * También muestra el saldo del fondo de sobras como info contextual.
 *
 * La PRIMERA vez que el admin entra a la app en una sesión y hay usuarios
 * pendientes, abre un popup automático (decisión D13).
 */
export default function PendingBanner({ onOpenUsers, onOpenPendientes }) {
  const [pendingUsers, setPendingUsers] = useState([])
  const [pendingSessions, setPendingSessions] = useState([])
  const [pendingExpenses, setPendingExpenses] = useState([])
  const [surplusBalance, setSurplusBalance] = useState(0)
  const [showPopup, setShowPopup] = useState(false)
  const [popupShown, setPopupShown] = useState(false)

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

  useEffect(() => {
    const unsub = watchPendingExpenses(setPendingExpenses)
    return unsub
  }, [])

  useEffect(() => {
    const unsub = watchSurplusFundBalance(setSurplusBalance)
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

  // Si no hay nada pendiente y no hay fondo, no renderizamos nada
  if (total === 0 && surplusBalance === 0) return null

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

      {surplusBalance > 0 && (
        <div style={{ padding: '8px 16px 0' }}>
          <div style={{
            padding: '11px 14px', borderRadius: 12,
            background: '#E8F4E8', border: `1px solid #C2DDC1`,
            fontSize: 12.5, color: T.ok, lineHeight: 1.5,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          }}>
            <div>
              <div style={{ fontWeight: 700 }}>Fondo de sobras</div>
              <div style={{ fontSize: 11.5, color: T.neutral[600], marginTop: 1 }}>
                Acumulado de cierres con excedente
              </div>
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
              {fmtMoney(surplusBalance)}
            </div>
          </div>
        </div>
      )}

      {showPopup && (
        <PendingUsersPopup
          users={pendingUsers}
          onReview={() => { setShowPopup(false); onOpenUsers() }}
          onLater={() => setShowPopup(false)}
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

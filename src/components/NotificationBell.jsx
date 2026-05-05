import { useEffect, useMemo, useRef, useState } from 'react'
import { T } from '../tokens'
import { Card, UserAvatar } from './Atoms'
import { fmtCOP } from '../utils/format'
import { watchAllUsers } from '../users'
import { watchSessionsWithPendingReview } from '../cashSessions'
import { watchAllSales } from '../sales'
import { watchCashierProducts } from '../products'
import { getData, getBogotaHour, getBogotaDateStr, isDayConfirmed } from '../db'

/**
 * Campana de notificaciones flotante (top-right) siempre visible para el admin.
 *
 * - Cuenta TODOS los pendientes: usuarios, cierres, disputas, faltas, gastos,
 *   ventas marcadas, productos sin costo
 * - Muestra badge con el número total
 * - Click → navega a Pendientes
 *
 * Además, dispara popup automático cuando llegan items urgentes:
 * - Cierre de turno pendiente (pending_close)
 * - Usuario nuevo esperando aprobación
 */
export default function NotificationBell({ onOpenPendientes, onOpenUsers, dataTick, hidden }) {
  const [pendingUsers, setPendingUsers] = useState([])
  const [pendingSessions, setPendingSessions] = useState([])
  const [allSales, setAllSales] = useState([])
  const [cashierProducts, setCashierProducts] = useState([])

  // Para popups automáticos
  const [closesPopup, setClosesPopup] = useState(null)
  const [usersPopup, setUsersPopup] = useState(null)
  const seenCloseIdsRef = useRef(new Set())
  const seenUserIdsRef = useRef(new Set())

  useEffect(() => watchAllUsers(list => setPendingUsers(list.filter(u => u.status === 'pending'))), [])
  useEffect(() => watchSessionsWithPendingReview(setPendingSessions), [])
  useEffect(() => watchAllSales(setAllSales), [])
  useEffect(() => watchCashierProducts(setCashierProducts), [])

  const flaggedSales = useMemo(() => allSales.filter(s => s.status === 'flagged'), [allSales])
  const openingDisputes = pendingSessions.filter(s => s.openingDispute?.status === 'pending')
  const pendingCloses = pendingSessions.filter(s => s.status === 'pending_close')
  const orphanShortages = pendingSessions.filter(s =>
    s.status === 'closed' &&
    s.closingDiscrepancy?.status === 'pending' &&
    s.closingDiscrepancy?.type === 'shortage'
  )

  // Reminders vencidos y confirmación de asistencia (legacy del admin)
  // dataTick fuerza recálculo cuando AppShell hace refresh
  const { overdueReminders, needsAttendanceConfirm } = useMemo(() => {
    const data = getData()
    const today = getBogotaDateStr()
    const reminders = data.reminders || []
    const overdue = reminders.filter(r => {
      if (r.paid) return false
      if (!r.due) return false
      const daysLeft = Math.ceil((new Date(r.due) - new Date(today + 'T00:00:00')) / 86400000)
      return daysLeft <= 0
    })
    const employees = data.employees || []
    const needsAttend = getBogotaHour() >= 20
      && !isDayConfirmed(today)
      && employees.some(e => e.type !== 'occasional')
    return { overdueReminders: overdue, needsAttendanceConfirm: needsAttend }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataTick])

  const totalCount =
    pendingUsers.length +
    pendingCloses.length +
    openingDisputes.length +
    orphanShortages.length +
    flaggedSales.length +
    cashierProducts.length +
    overdueReminders.length +
    (needsAttendanceConfirm ? 1 : 0)

  // Detectar cierres nuevos para popup
  useEffect(() => {
    const newOnes = pendingCloses.filter(s => !seenCloseIdsRef.current.has(s.id))
    if (newOnes.length > 0) {
      newOnes.forEach(s => seenCloseIdsRef.current.add(s.id))
      setClosesPopup(prev => {
        if (prev && prev.length > 0) {
          const existingIds = new Set(prev.map(s => s.id))
          return [...prev, ...newOnes.filter(s => !existingIds.has(s.id))]
        }
        return newOnes
      })
    }
  }, [pendingCloses])

  // Detectar usuarios nuevos para popup
  useEffect(() => {
    const newOnes = pendingUsers.filter(u => !seenUserIdsRef.current.has(u.uid))
    if (newOnes.length > 0) {
      newOnes.forEach(u => seenUserIdsRef.current.add(u.uid))
      setUsersPopup(newOnes)
    }
  }, [pendingUsers])

  return (
    <>
      {!hidden && (
      <button
        onClick={() => onOpenPendientes?.()}
        title={totalCount > 0 ? `${totalCount} cosas por revisar` : 'Sin pendientes'}
        style={{
          position: 'fixed',
          top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
          right: 12,
          zIndex: 50,
          width: 44, height: 44, borderRadius: 999,
          background: '#fff',
          border: `1px solid ${T.neutral[200]}`,
          cursor: 'pointer', fontFamily: 'inherit',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
          color: totalCount > 0 ? T.copper[700] : T.neutral[500],
          padding: 0,
        }}
      >
        <svg width="20" height="20" viewBox="0 0 22 22" fill="none">
          <path
            d="M5 9 Q5 4 11 4 Q17 4 17 9 V13 L19 16 H3 L5 13 Z"
            stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinejoin="round"
          />
          <path
            d="M9 17 Q9 19 11 19 Q13 19 13 17"
            stroke="currentColor" strokeWidth="1.7" fill="none"
          />
        </svg>
        {totalCount > 0 && (
          <span style={{
            position: 'absolute', top: -3, right: -3,
            minWidth: 20, height: 20, borderRadius: 999,
            background: T.bad, color: '#fff',
            fontSize: 11, fontWeight: 800,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 5px', border: `2px solid #fff`,
            fontVariantNumeric: 'tabular-nums',
            animation: 'bellPulse 1.6s ease-in-out infinite',
          }}>
            {totalCount > 99 ? '99+' : totalCount}
          </span>
        )}
        <style>{`
          @keyframes bellPulse {
            0%, 100% { transform: scale(1); }
            50%      { transform: scale(1.15); }
          }
        `}</style>
      </button>
      )}

      {/* Popup llamativo: cierres de turno pendientes */}
      {closesPopup && closesPopup.length > 0 && (
        <PendingClosesPopup
          sessions={closesPopup}
          onReview={() => {
            setClosesPopup(null)
            onOpenPendientes?.()
          }}
          onLater={() => setClosesPopup(null)}
        />
      )}

      {/* Popup: usuarios pendientes (solo al primer detect) */}
      {usersPopup && usersPopup.length > 0 && (
        <PendingUsersPopup
          users={usersPopup}
          onReview={() => {
            setUsersPopup(null)
            onOpenUsers?.()
          }}
          onLater={() => setUsersPopup(null)}
        />
      )}
    </>
  )
}

// ──────────────────────────────────────────────────────────────
// Popup grande para cierres de turno pendientes
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
        <div style={{
          background: `linear-gradient(135deg, ${T.warn} 0%, #C08A3E 100%)`,
          padding: '28px 24px 24px',
          textAlign: 'center', position: 'relative',
        }}>
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

        <div style={{ padding: '20px 22px' }}>
          <div style={{
            fontSize: 13.5, color: T.neutral[600],
            textAlign: 'center', lineHeight: 1.55, marginBottom: 16,
          }}>
            {isPlural
              ? 'Hay panaderías bloqueadas esperando tu aprobación para liberarse.'
              : 'Hay una panadería bloqueada esperando tu aprobación para liberarse.'}
          </div>

          <div style={{
            background: T.neutral[50], borderRadius: 14,
            padding: '4px 0', marginBottom: 18,
            maxHeight: 240, overflowY: 'auto',
          }}>
            {sessions.slice(0, 4).map((s, i) => {
              const cd = s.closingDiscrepancy
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
                  {cd?.type === 'shortage' && (
                    <Tag color={T.bad} bg="#FBE9E5">Falta {fmtCOP(cd.amount)}</Tag>
                  )}
                  {cd?.type === 'surplus' && (
                    <Tag color={T.ok} bg="#E8F4E8">Sobra {fmtCOP(cd.amount)}</Tag>
                  )}
                  {!cd && <Tag color={T.ok} bg="#E8F4E8">Cuadre exacto</Tag>}
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
            <button onClick={onLater} style={{
              flex: 1, padding: '14px', borderRadius: 14,
              background: T.neutral[100], color: T.neutral[700],
              border: 'none', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
            }}>
              Después
            </button>
            <button onClick={onReview} style={{
              flex: 1.6, padding: '14px', borderRadius: 14,
              background: T.warn, color: '#fff',
              border: 'none', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 14.5, fontWeight: 800,
              boxShadow: '0 4px 14px rgba(192,138,62,0.45)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
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
    <div onClick={onLater} style={{
      position: 'fixed', inset: 0, zIndex: 95,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 380,
        background: '#fff', borderRadius: 22,
        padding: '28px 24px 22px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        animation: 'fadeScaleIn 0.22s ease',
      }}>
        <div style={{
          width: 68, height: 68, borderRadius: 999,
          background: T.copper[50], border: `1px solid ${T.copper[100]}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 16px',
        }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="9" r="4" stroke={T.copper[600]} strokeWidth="1.8" fill="none"/>
            <path d="M4 21 Q4 14 12 14 Q20 14 20 21" stroke={T.copper[600]} strokeWidth="1.8" fill="none"/>
          </svg>
        </div>
        <div style={{
          fontSize: 19, fontWeight: 800, color: T.neutral[900],
          textAlign: 'center', marginBottom: 6,
        }}>
          {users.length === 1 ? 'Una solicitud nueva' : `${users.length} solicitudes nuevas`}
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
                <div style={{ fontSize: 13, fontWeight: 700, color: T.neutral[900] }}>
                  {u.nombre} {u.apellido}
                </div>
                <div style={{ fontSize: 11, color: T.neutral[500] }}>{u.email}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onLater} style={{
            flex: 1, padding: '12px', borderRadius: 12,
            background: T.neutral[100], color: T.neutral[700],
            border: 'none', cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
          }}>Después</button>
          <button onClick={onReview} style={{
            flex: 1.4, padding: '12px', borderRadius: 12,
            background: T.copper[500], color: '#fff',
            border: 'none', cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
            boxShadow: '0 3px 10px rgba(184,122,86,0.3)',
          }}>Revisar</button>
        </div>
      </div>
    </div>
  )
}

function Tag({ children, color, bg }) {
  return (
    <div style={{
      display: 'inline-block', marginTop: 4,
      fontSize: 10.5, fontWeight: 700, color, background: bg,
      padding: '2px 8px', borderRadius: 999,
      letterSpacing: 0.4, textTransform: 'uppercase',
    }}>
      {children}
    </div>
  )
}

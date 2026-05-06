import { useEffect, useMemo, useRef, useState } from 'react'
import { T } from '../tokens'
import { UserAvatar } from './Atoms'
import { watchAllUsers } from '../users'
import { watchSessionsWithPendingReview } from '../cashSessions'
import { watchAllSales } from '../sales'
import { watchCashierProducts } from '../products'
import { watchPendingChangeRequests } from '../productChangeRequests'
import { getData, getBogotaHour, getBogotaDateStr, isDayConfirmed } from '../db'

/**
 * Campana de notificaciones flotante (top-right) siempre visible para el admin.
 *
 * - Cuenta pendientes: usuarios, faltas legacy, ventas marcadas, productos sin costo,
 *   solicitudes de cambio, recordatorios vencidos, asistencia del día
 * - Muestra badge con el número total
 * - Click → navega a Pendientes
 *
 * En el modelo D25 los cierres y aperturas se manejan desde el panel central del
 * Dashboard, no aquí — por eso ya no hay popup de "cierre por aprobar".
 */
export default function NotificationBell({ onOpenPendientes, onOpenUsers, dataTick, hidden }) {
  const [pendingUsers, setPendingUsers] = useState([])
  const [pendingSessions, setPendingSessions] = useState([])
  const [allSales, setAllSales] = useState([])
  const [cashierProducts, setCashierProducts] = useState([])
  const [changeRequests, setChangeRequests] = useState([])

  // Para popups automáticos (solo usuarios pendientes — los cierres ya no
  // generan popup porque se cierran desde el panel central, no aquí).
  const [usersPopup, setUsersPopup] = useState(null)
  const seenUserIdsRef = useRef(new Set())

  useEffect(() => watchAllUsers(list => setPendingUsers(list.filter(u => u.status === 'pending'))), [])
  useEffect(() => watchSessionsWithPendingReview(setPendingSessions), [])
  useEffect(() => watchAllSales(setAllSales), [])
  useEffect(() => watchCashierProducts(setCashierProducts), [])
  useEffect(() => watchPendingChangeRequests(setChangeRequests), [])

  const flaggedSales = useMemo(() => allSales.filter(s => s.status === 'flagged'), [allSales])
  // (D25) Cierres y aperturas se manejan desde el panel central. Acá solo
  // contamos las shortages legacy que quedaron pendientes.
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
    orphanShortages.length +
    flaggedSales.length +
    cashierProducts.length +
    changeRequests.length +
    overdueReminders.length +
    (needsAttendanceConfirm ? 1 : 0)

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


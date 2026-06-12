import { useEffect, useMemo, useRef, useState } from 'react'
import { T } from '../tokens'
import { UserAvatar } from './Atoms'
import { watchAllUsers, rejectPendingUser } from '../users'
import { watchSessionsWithPendingReview } from '../cashSessions'
import { watchFlaggedSales } from '../sales'
import { watchPendingChangeRequests } from '../productChangeRequests'
import { getData, getBogotaDateStr } from '../db'
import { useAuth } from '../context/AuthCtx'
import { ApprovalModal } from '../screens/Users'

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
  const [flaggedSales, setFlaggedSales] = useState([])
  const [changeRequests, setChangeRequests] = useState([])

  // Para popups automáticos (solo usuarios pendientes — los cierres ya no
  // generan popup porque se cierran desde el panel central, no aquí).
  const [usersPopup, setUsersPopup] = useState(null)
  const seenUserIdsRef = useRef(new Set())

  useEffect(() => watchAllUsers(list => setPendingUsers(list.filter(u => u.status === 'pending'))), [])
  useEffect(() => watchSessionsWithPendingReview(setPendingSessions), [])
  useEffect(() => watchFlaggedSales(setFlaggedSales), [])
  useEffect(() => watchPendingChangeRequests(setChangeRequests), [])
  // (D25) Cierres y aperturas se manejan desde el panel central. Acá solo
  // contamos las shortages legacy que quedaron pendientes.
  const orphanShortages = pendingSessions.filter(s =>
    s.status === 'closed' &&
    s.closingDiscrepancy?.status === 'pending' &&
    s.closingDiscrepancy?.type === 'shortage'
  )
  const openingDisputes = pendingSessions.filter(s =>
    s.openingDispute?.status === 'pending'
  )

  // Reminders vencidos — dataTick fuerza recálculo cuando AppShell hace refresh
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const overdueReminders = useMemo(() => {
    const data = getData()
    const today = getBogotaDateStr()
    const reminders = data.reminders || []
    return reminders.filter(r => {
      if (r.paid) return false
      if (!r.due) return false
      const daysLeft = Math.ceil((new Date(r.due) - new Date(today + 'T00:00:00')) / 86400000)
      return daysLeft <= 0
    })
  }, [dataTick])

  const totalCount =
    pendingUsers.length +
    openingDisputes.length +
    orphanShortages.length +
    flaggedSales.length +
    changeRequests.length +
    overdueReminders.length

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

      {/* Popup: usuarios pendientes (solo al primer detect).
          Aprobar/Rechazar directo aquí — sin pasos intermedios. */}
      {usersPopup && usersPopup.length > 0 && (
        <PendingUsersPopup
          users={usersPopup}
          onClose={() => setUsersPopup(null)}
          onAllResolved={() => setUsersPopup(null)}
        />
      )}
    </>
  )
}

function PendingUsersPopup({ users, onClose, onAllResolved }) {
  const { authUser } = useAuth()
  // Lista local mutable: cuando se aprueba/rechaza uno, lo quitamos del popup
  const [pending, setPending] = useState(users)
  // user que está siendo aprobado (abre ApprovalModal)
  const [approving, setApproving] = useState(null)
  // user que está siendo rechazado (pide confirmación inline)
  const [rejecting, setRejecting] = useState(null)
  const [busyUid, setBusyUid] = useState(null)

  // Si ya no quedan, cerrar
  useEffect(() => {
    if (pending.length === 0) onAllResolved?.()
  }, [pending.length, onAllResolved])

  function removeUser(uid) {
    setPending(prev => prev.filter(u => u.uid !== uid))
  }

  async function handleReject(user) {
    if (busyUid) return
    setBusyUid(user.uid)
    try {
      await rejectPendingUser(user.uid)
      removeUser(user.uid)
      setRejecting(null)
    } catch (err) {
      console.error('[NotificationBell] reject failed:', err)
    } finally {
      setBusyUid(null)
    }
  }

  // Si hay un user en proceso de aprobación, ocultamos el popup chico para
  // que solo se vea el ApprovalModal arriba — evita el efecto "dos modales".
  return (
    <>
    {!approving && (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 95,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 420,
        background: '#fff', borderRadius: 22,
        padding: '24px 22px 18px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        animation: 'fadeScaleIn 0.22s ease',
        maxHeight: '92vh', overflowY: 'auto',
      }}>
        <div style={{
          width: 60, height: 60, borderRadius: 999,
          background: T.copper[50], border: `1px solid ${T.copper[100]}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 12px',
        }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="9" r="4" stroke={T.copper[600]} strokeWidth="1.8" fill="none"/>
            <path d="M4 21 Q4 14 12 14 Q20 14 20 21" stroke={T.copper[600]} strokeWidth="1.8" fill="none"/>
          </svg>
        </div>
        <div style={{
          fontSize: 18, fontWeight: 800, color: T.neutral[900],
          textAlign: 'center', marginBottom: 4, letterSpacing: -0.3,
        }}>
          {pending.length === 1 ? 'Una solicitud nueva' : `${pending.length} solicitudes nuevas`}
        </div>
        <div style={{
          fontSize: 12.5, color: T.neutral[500], textAlign: 'center',
          marginBottom: 16, lineHeight: 1.4,
        }}>
          Aprueba o rechaza desde aquí mismo.
        </div>

        <div style={{
          display: 'flex', flexDirection: 'column', gap: 8,
          marginBottom: 14,
        }}>
          {pending.map(u => (
            <PendingUserRow
              key={u.uid}
              user={u}
              busy={busyUid === u.uid}
              isRejecting={rejecting?.uid === u.uid}
              onApprove={() => setApproving(u)}
              onAskReject={() => setRejecting(u)}
              onCancelReject={() => setRejecting(null)}
              onConfirmReject={() => handleReject(u)}
            />
          ))}
        </div>

        <button onClick={onClose} style={{
          width: '100%', padding: '11px', borderRadius: 12,
          background: T.neutral[100], color: T.neutral[700],
          border: 'none', cursor: 'pointer',
          fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700,
        }}>Después</button>
      </div>
    </div>
    )}

    {/* Modal de aprobación con todos los datos (rol, nombre, salario, etc.) */}
    {approving && (
      <ApprovalModal
        user={approving}
        adminUid={authUser.uid}
        onCancel={() => setApproving(null)}
        onDone={() => {
          removeUser(approving.uid)
          setApproving(null)
        }}
      />
    )}
    </>
  )
}

function PendingUserRow({ user, busy, isRejecting, onApprove, onAskReject, onCancelReject, onConfirmReject }) {
  return (
    <div style={{
      padding: '10px 12px', borderRadius: 14,
      background: '#fff', border: `1px solid ${T.neutral[100]}`,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        marginBottom: isRejecting ? 10 : 8,
      }}>
        <UserAvatar user={user} size={36} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13.5, fontWeight: 700, color: T.neutral[900],
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {user.nombre} {user.apellido}
          </div>
          <div style={{
            fontSize: 11.5, color: T.neutral[500],
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {user.email}
          </div>
        </div>
      </div>

      {isRejecting ? (
        <div style={{
          padding: '10px 12px', borderRadius: 10,
          background: '#FBE9E5', border: `1px solid #F0C8BE`,
        }}>
          <div style={{ fontSize: 12.5, color: T.bad, fontWeight: 700, marginBottom: 8 }}>
            ¿Rechazar la solicitud?
          </div>
          <div style={{ fontSize: 11.5, color: T.neutral[700], marginBottom: 10, lineHeight: 1.4 }}>
            La cuenta queda inactiva. Podrás reactivarla luego desde Equipo.
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={onCancelReject} disabled={busy} style={{
              flex: 1, padding: '8px', borderRadius: 8,
              background: '#fff', color: T.neutral[700],
              border: `1px solid ${T.neutral[200]}`,
              cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
              fontSize: 12, fontWeight: 700,
            }}>No</button>
            <button onClick={onConfirmReject} disabled={busy} style={{
              flex: 1.4, padding: '8px', borderRadius: 8,
              background: T.bad, color: '#fff',
              border: 'none', cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
              fontSize: 12, fontWeight: 700,
              opacity: busy ? 0.7 : 1,
            }}>{busy ? 'Rechazando...' : 'Sí, rechazar'}</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={onAskReject} disabled={busy} style={{
            flex: 1, padding: '9px 10px', borderRadius: 10,
            background: 'transparent', color: T.bad,
            border: `1.5px solid ${T.bad}55`,
            cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
            fontSize: 12.5, fontWeight: 700,
          }}>Rechazar</button>
          <button onClick={onApprove} disabled={busy} style={{
            flex: 1.6, padding: '9px 10px', borderRadius: 10,
            background: T.copper[500], color: '#fff',
            border: 'none', cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
            fontSize: 12.5, fontWeight: 800,
            boxShadow: '0 3px 10px rgba(184,122,86,0.35)',
          }}>✓ Aprobar</button>
        </div>
      )}
    </div>
  )
}


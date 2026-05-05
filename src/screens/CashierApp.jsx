import { useEffect, useMemo, useRef, useState } from 'react'
import { T } from '../tokens'
import { Card, UserAvatar } from '../components/Atoms'
import { fmtCOP } from '../utils/format'
import { signOut } from '../auth'
import { getData } from '../db'
import {
  watchMyOpenSession,
  watchOpenSessions,
  getLatestClosedSessionForBranch,
  openSession,
  closeSession,
} from '../cashSessions'
import { watchAllUsers } from '../users'
import { watchSessionSales, flagSale } from '../sales'
import { createCashExpense, watchSessionExpenses } from '../cashExpenses'
import { watchAllDeductionsForCashier } from '../cashierDeductions'
import { compressAndUpload } from '../utils/imagebb'
import NewSale from './NewSale'

// ──────────────────────────────────────────────────────────────
// Wrapper top-level: decide StartTurn vs ActiveSession
// ──────────────────────────────────────────────────────────────
export default function CashierApp({ authUser, userDoc }) {
  const [mySession, setMySession] = useState(undefined) // undefined=loading
  const [openSessions, setOpenSessions] = useState([])

  useEffect(() => {
    const unsub1 = watchMyOpenSession(authUser.uid, setMySession)
    const unsub2 = watchOpenSessions(setOpenSessions)
    return () => { unsub1(); unsub2() }
  }, [authUser.uid])

  if (mySession === undefined) {
    return <LoadingScreen label="Verificando turno..." />
  }

  return (
    <div style={{
      minHeight: '100dvh', background: T.neutral[50],
      fontFamily: '-apple-system, "SF Pro Text", "Inter", system-ui, sans-serif',
      color: T.neutral[800],
    }}>
      <CashierTopBar authUser={authUser} userDoc={userDoc} />

      {mySession ? (
        <ActiveSession session={mySession} userDoc={userDoc} authUser={authUser} />
      ) : (
        <StartTurn
          authUser={authUser}
          userDoc={userDoc}
          openSessions={openSessions}
        />
      )}
    </div>
  )
}

function LoadingScreen({ label }) {
  return (
    <div style={{
      minHeight: '100dvh', background: T.neutral[50],
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 14,
    }}>
      <div style={{ fontSize: 48 }}>🥖</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: T.copper[500], letterSpacing: 0.3 }}>
        {label}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Top bar (avatar + nombre + cerrar sesión)
// ──────────────────────────────────────────────────────────────
function CashierTopBar({ authUser, userDoc }) {
  const [confirmSignOut, setConfirmSignOut] = useState(false)

  return (
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
        style={{ width: 32, height: 32, objectFit: 'contain', flexShrink: 0 }}
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
        onClick={() => setConfirmSignOut(true)}
        style={{
          width: 36, height: 36, borderRadius: 999,
          background: 'transparent', border: 'none', padding: 0,
          cursor: 'pointer', flexShrink: 0,
        }}
      >
        <UserAvatar user={authUser} size={34} />
      </button>

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
    <ModalOverlay onClose={busy ? undefined : onCancel}>
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
          <button onClick={onCancel} disabled={busy} style={btnSecondary()}>Cancelar</button>
          <button
            onClick={async () => { setBusy(true); await onConfirm() }}
            disabled={busy}
            style={{ ...btnPrimary(T.bad), opacity: busy ? 0.7 : 1 }}
          >
            {busy ? 'Saliendo...' : 'Cerrar sesión'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

// ──────────────────────────────────────────────────────────────
// PANTALLA: Iniciar turno (selector de panadería)
// ──────────────────────────────────────────────────────────────
function StartTurn({ authUser, userDoc, openSessions }) {
  const branches = getData().branches || []
  const [selectedBranch, setSelectedBranch] = useState(null)

  // Mis cierres pendientes de aprobación (puedo tener varios si trabajé en varias panaderías)
  const myPendingCloses = openSessions.filter(s =>
    s.status === 'pending_close' && s.cashierUid === authUser.uid
  )

  const branchStatus = useMemo(() => {
    const map = {}
    branches.forEach(b => {
      const session = openSessions.find(s => s.branchId === b.id)
      if (!session) {
        map[b.id] = { occupied: false }
      } else {
        map[b.id] = {
          occupied: true,
          byName: session.cashierName,
          isPendingClose: session.status === 'pending_close',
        }
      }
    })
    return map
  }, [branches, openSessions])

  return (
    <div style={{ padding: '24px 18px 40px', maxWidth: 540, margin: '0 auto' }}>
      {myPendingCloses.length > 0 && (
        <div style={{
          padding: '14px 16px', borderRadius: 14,
          background: '#FFF7E6', border: `1px solid #F4E0BC`,
          marginBottom: 18,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{
            width: 38, height: 38, borderRadius: 999, flexShrink: 0,
            background: '#F4E0BC',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="20" height="20" viewBox="0 0 22 22" fill="none">
              <circle cx="11" cy="11" r="8" stroke={T.warn} strokeWidth="1.7" fill="none"/>
              <path d="M11 7 V11 L14 13" stroke={T.warn} strokeWidth="1.7" strokeLinecap="round" fill="none"/>
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: T.warn }}>
              Tu cierre está pendiente de aprobación
            </div>
            <div style={{ fontSize: 11.5, color: T.neutral[600], marginTop: 2, lineHeight: 1.5 }}>
              El administrador debe aprobar el cierre de {myPendingCloses[0].branchName || 'tu turno anterior'} antes de que esa panadería se pueda volver a abrir.
            </div>
          </div>
        </div>
      )}

      <div style={{
        fontSize: 13, fontWeight: 600, color: T.copper[600], letterSpacing: 0.4, textTransform: 'uppercase',
        marginBottom: 4,
      }}>
        Inicia tu turno
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.6, marginBottom: 4 }}>
        ¿En qué panadería estás hoy?
      </div>
      <div style={{ fontSize: 13.5, color: T.neutral[500], marginBottom: 20, lineHeight: 1.5 }}>
        Selecciona la panadería donde vas a trabajar para empezar a registrar ventas.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {branches.length === 0 && (
          <Card>
            <div style={{ padding: '16px 0', textAlign: 'center', color: T.neutral[500], fontSize: 13 }}>
              No hay panaderías configuradas. Pídele al administrador que las cree.
            </div>
          </Card>
        )}
        {branches.map(b => (
          <BranchCard
            key={b.id}
            branch={b}
            status={branchStatus[b.id]}
            onSelect={() => setSelectedBranch(b)}
          />
        ))}
      </div>

      {selectedBranch && (
        <OpenTurnModal
          branch={selectedBranch}
          authUser={authUser}
          userDoc={userDoc}
          onCancel={() => setSelectedBranch(null)}
          onOpened={() => setSelectedBranch(null)}
        />
      )}
    </div>
  )
}

function BranchCard({ branch, status, onSelect }) {
  const colorKey = branch.colorKey || 'copper'
  const palette = T[colorKey] || T.copper
  const isOccupied = status.occupied

  return (
    <button
      onClick={isOccupied ? undefined : onSelect}
      disabled={isOccupied}
      style={{
        width: '100%', padding: '18px 18px', borderRadius: 18,
        background: '#fff',
        border: `1px solid ${isOccupied ? T.neutral[200] : (palette[200] || T.copper[200])}`,
        cursor: isOccupied ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit', textAlign: 'left',
        display: 'flex', alignItems: 'center', gap: 14,
        boxShadow: isOccupied ? 'none' : '0 1px 2px rgba(45,35,25,0.04)',
        opacity: isOccupied ? 0.65 : 1,
        transition: 'all 0.15s',
      }}
    >
      <div style={{
        width: 48, height: 48, borderRadius: 12,
        background: palette[50] || T.copper[50],
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <svg width="26" height="26" viewBox="0 0 22 22" fill="none">
          <path d="M3 9 L11 4 L19 9 V18 H3 Z" stroke={palette[500] || T.copper[500]} strokeWidth="1.6" fill="none" strokeLinejoin="round"/>
          <path d="M9 18 V13 H13 V18" stroke={palette[500] || T.copper[500]} strokeWidth="1.6" fill="none"/>
        </svg>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: T.neutral[900], letterSpacing: -0.2 }}>
          {branch.name}
        </div>
        {isOccupied ? (
          status.isPendingClose ? (
            <div style={{ fontSize: 12, color: T.warn, marginTop: 3, fontWeight: 600 }}>
              ⏳ Cierre pendiente de aprobar · {status.byName}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: T.bad, marginTop: 3, fontWeight: 600 }}>
              Turno activo · {status.byName}
            </div>
          )
        ) : (
          <div style={{ fontSize: 12, color: T.neutral[500], marginTop: 3 }}>
            Disponible · toca para iniciar turno
          </div>
        )}
      </div>
      {!isOccupied && (
        <svg width="9" height="14" viewBox="0 0 7 12">
          <path d="M1 1 L6 6 L1 11" stroke={T.neutral[300]} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
    </button>
  )
}

function OpenTurnModal({ branch, authUser, userDoc, onCancel, onOpened }) {
  const [pendingHandover, setPendingHandover] = useState(undefined) // undefined=loading
  const [step, setStep] = useState('asking') // 'asking' | 'disputing'
  const [actualAmountStr, setActualAmountStr] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const last = await getLatestClosedSessionForBranch(branch.id)
        if (cancelled) return

        if (last?.handover?.type === 'cashier' && last.handover.toUid === authUser.uid) {
          setPendingHandover({
            amount: last.handover.amount,
            fromCashierName: last.cashierName,
            fromSessionId: last.id,
          })
        } else {
          setPendingHandover(null)
        }
      } catch (err) {
        console.error(err)
        setPendingHandover(null)
      }
    })()
    return () => { cancelled = true }
  }, [branch.id, authUser.uid])

  const cashierName = `${userDoc?.nombre || ''} ${userDoc?.apellido || ''}`.trim() || authUser.email

  // Caso A: no hay handover → caja vacía, abre con $0
  async function handleOpenEmpty() {
    if (busy) return
    setBusy(true); setError(null)
    try {
      await openSession({
        branchId: branch.id, branchName: branch.name,
        cashierUid: authUser.uid, cashierName,
        openingFloat: 0,
        openingSource: { type: 'empty' },
      })
      onOpened()
    } catch (err) {
      console.error(err); setError('No pudimos iniciar el turno. Intenta de nuevo.')
      setBusy(false)
    }
  }

  // Caso B: handover, cajera confirma que recibió la cantidad esperada
  async function handleConfirmExpected() {
    if (busy || !pendingHandover) return
    setBusy(true); setError(null)
    try {
      await openSession({
        branchId: branch.id, branchName: branch.name,
        cashierUid: authUser.uid, cashierName,
        openingFloat: pendingHandover.amount,
        openingSource: {
          type: 'handover',
          fromSessionId: pendingHandover.fromSessionId,
          fromCashierName: pendingHandover.fromCashierName,
        },
      })
      onOpened()
    } catch (err) {
      console.error(err); setError('No pudimos iniciar el turno. Intenta de nuevo.')
      setBusy(false)
    }
  }

  // Caso C: handover, cajera dice haber recibido un monto distinto → reporte al admin
  async function handleSubmitDispute() {
    if (busy || !pendingHandover) return
    const declared = Number(actualAmountStr) || 0
    if (declared < 0) { setError('El monto no puede ser negativo'); return }
    if (declared === pendingHandover.amount) {
      setError('Si recibiste el monto exacto, vuelve y selecciona "Sí, los recibí completos"')
      return
    }
    setBusy(true); setError(null)
    try {
      await openSession({
        branchId: branch.id, branchName: branch.name,
        cashierUid: authUser.uid, cashierName,
        openingFloat: declared,
        openingSource: {
          type: 'handover_disputed',
          fromSessionId: pendingHandover.fromSessionId,
          fromCashierName: pendingHandover.fromCashierName,
        },
        openingDispute: {
          expected: pendingHandover.amount,
          declared,
        },
      })
      onOpened()
    } catch (err) {
      console.error(err); setError('No pudimos reportar la diferencia. Intenta de nuevo.')
      setBusy(false)
    }
  }

  return (
    <ModalOverlay onClose={busy ? undefined : onCancel}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 440, background: '#fff', borderRadius: 22,
        padding: '24px 22px 22px', boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
        animation: 'fadeScaleIn 0.2s ease',
        maxHeight: '94vh', overflowY: 'auto',
      }}>
        <div style={{ fontSize: 19, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3, marginBottom: 4 }}>
          Iniciar turno
        </div>
        <div style={{ fontSize: 13.5, color: T.neutral[500], marginBottom: 18 }}>
          {branch.name}
        </div>

        {pendingHandover === undefined && (
          <div style={{ padding: '12px 0', textAlign: 'center', color: T.neutral[500], fontSize: 13 }}>
            Verificando turno anterior...
          </div>
        )}

        {/* CASO A: caja vacía */}
        {pendingHandover === null && (
          <>
            <div style={{
              padding: '14px 16px', borderRadius: 14,
              background: T.neutral[50], border: `1px solid ${T.neutral[100]}`,
              marginBottom: 14,
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <div style={{
                width: 42, height: 42, borderRadius: 999, background: T.neutral[100],
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <svg width="20" height="20" viewBox="0 0 22 22" fill="none">
                  <rect x="3" y="6" width="16" height="12" rx="2" stroke={T.neutral[500]} strokeWidth="1.6" fill="none"/>
                  <circle cx="11" cy="12" r="2" stroke={T.neutral[500]} strokeWidth="1.4" fill="none"/>
                </svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.neutral[800] }}>Caja vacía</div>
                <div style={{ fontSize: 12, color: T.neutral[500], marginTop: 2 }}>Tu turno empieza con $0</div>
              </div>
            </div>
            <div style={{ fontSize: 13, color: T.neutral[600], textAlign: 'center', marginBottom: 16, lineHeight: 1.55 }}>
              No hay efectivo recibido de una cajera anterior.
              <br/>
              Si el administrador te entregó dinero, díselo a él para registrar el ajuste.
            </div>

            {error && <ErrorBox text={error} />}

            <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
              <button onClick={onCancel} disabled={busy} style={btnSecondary()}>Cancelar</button>
              <button onClick={handleOpenEmpty} disabled={busy} style={{ ...btnPrimary(T.copper[500]), flex: 1.4, opacity: busy ? 0.7 : 1 }}>
                {busy ? 'Iniciando...' : 'Iniciar turno'}
              </button>
            </div>
          </>
        )}

        {/* CASO B/C: handover detectado */}
        {pendingHandover && step === 'asking' && (
          <>
            <HandoverCard handover={pendingHandover} />
            <div style={{ fontSize: 14, fontWeight: 700, color: T.neutral[800], textAlign: 'center', marginBottom: 14 }}>
              ¿Recibiste exactamente {fmtCOP(pendingHandover.amount)}?
            </div>

            <button
              onClick={handleConfirmExpected}
              disabled={busy}
              style={{
                width: '100%', padding: '14px', borderRadius: 14,
                background: T.copper[500], color: '#fff',
                border: 'none', cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
                fontSize: 14.5, fontWeight: 700, marginBottom: 10,
                boxShadow: '0 3px 10px rgba(184,122,86,0.3)',
                opacity: busy ? 0.7 : 1,
              }}
            >
              {busy ? 'Iniciando...' : `Sí, recibí los ${fmtCOP(pendingHandover.amount)} completos`}
            </button>

            <button
              onClick={() => setStep('disputing')}
              disabled={busy}
              style={{
                width: '100%', padding: '14px', borderRadius: 14,
                background: '#fff', color: T.bad,
                border: `1.5px solid ${T.neutral[200]}`,
                cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 14, fontWeight: 700, marginBottom: 14,
              }}
            >
              No, recibí otra cantidad
            </button>

            {error && <ErrorBox text={error} />}

            <button onClick={onCancel} disabled={busy} style={{
              width: '100%', padding: '10px', borderRadius: 10,
              background: 'transparent', color: T.neutral[500],
              border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 13, fontWeight: 600,
            }}>
              Cancelar
            </button>
          </>
        )}

        {pendingHandover && step === 'disputing' && (
          <>
            <div style={{
              padding: '12px 14px', borderRadius: 12,
              background: T.neutral[50], marginBottom: 14,
            }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: T.neutral[500], letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 }}>
                {pendingHandover.fromCashierName} entregó
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: T.neutral[800], fontVariantNumeric: 'tabular-nums' }}>
                {fmtCOP(pendingHandover.amount)}
              </div>
            </div>

            <NumberField
              label="¿Cuánto recibiste realmente?"
              value={actualAmountStr}
              onChange={setActualAmountStr}
              placeholder="0"
              autoFocus
              disabled={busy}
            />

            <div style={{
              padding: '11px 14px', borderRadius: 12,
              background: '#FFF7E6', border: `1px solid #F4E0BC`,
              fontSize: 12.5, color: T.warn, fontWeight: 500, lineHeight: 1.5,
              marginTop: 4, marginBottom: 14,
            }}>
              ⚠ Reportarás una diferencia. El administrador será notificado para revisar y confirmar.
            </div>

            {error && <ErrorBox text={error} />}

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => { setStep('asking'); setError(null) }} disabled={busy} style={btnSecondary()}>
                Atrás
              </button>
              <button
                onClick={handleSubmitDispute}
                disabled={busy || !actualAmountStr}
                style={{
                  ...btnPrimary(T.warn), flex: 1.4,
                  opacity: (busy || !actualAmountStr) ? 0.6 : 1,
                  cursor: (busy || !actualAmountStr) ? 'not-allowed' : 'pointer',
                }}
              >
                {busy ? 'Reportando...' : 'Reportar y continuar'}
              </button>
            </div>
          </>
        )}
      </div>
    </ModalOverlay>
  )
}

function HandoverCard({ handover }) {
  return (
    <div style={{
      padding: '14px 16px', borderRadius: 14,
      background: T.copper[50], border: `1px solid ${T.copper[100]}`,
      marginBottom: 14,
    }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: T.copper[700], letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 }}>
        Recibes de cajera anterior
      </div>
      <div style={{ fontSize: 13.5, color: T.copper[700], marginBottom: 10 }}>
        {handover.fromCashierName}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: T.copper[700], fontVariantNumeric: 'tabular-nums', letterSpacing: -0.6 }}>
        {fmtCOP(handover.amount)}
      </div>
    </div>
  )
}

function ErrorBox({ text }) {
  return (
    <div style={{
      marginBottom: 10, padding: '10px 12px', borderRadius: 10,
      background: '#FBE9E5', border: `1px solid #F0C8BE`, color: T.bad,
      fontSize: 12.5, fontWeight: 500, textAlign: 'center',
    }}>
      {text}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// PANTALLA: Turno activo (header + cerrar turno)
// ──────────────────────────────────────────────────────────────
function ActiveSession({ session, userDoc, authUser }) {
  const [closing, setClosing] = useState(false)
  const [newSaleOpen, setNewSaleOpen] = useState(false)
  const [expenseOpen, setExpenseOpen] = useState(false)
  const [showDeductions, setShowDeductions] = useState(false)
  const [sessionSales, setSessionSales] = useState([])
  const [sessionExpenses, setSessionExpenses] = useState([])
  const [myDeductions, setMyDeductions] = useState([])
  const [reportSale, setReportSale] = useState(null)
  const branches = getData().branches || []

  useEffect(() => {
    const unsub = watchSessionSales(session.id, setSessionSales)
    return unsub
  }, [session.id])

  useEffect(() => {
    const unsub = watchSessionExpenses(session.id, setSessionExpenses)
    return unsub
  }, [session.id])

  useEffect(() => {
    const unsub = watchAllDeductionsForCashier(authUser.uid, setMyDeductions)
    return unsub
  }, [authUser.uid])

  // Mostrar últimas 15 ventas (D21: sin totales agregados)
  const recentSales = sessionSales.slice(0, 15)
  const pendingDeductions = myDeductions.filter(d => d.status === 'pending')
  const branch = branches.find(b => b.id === session.branchId) || { name: session.branchName, colorKey: 'copper' }
  const colorKey = branch.colorKey || 'copper'
  const palette = T[colorKey] || T.copper

  const openedAt = session.openedAt?.toDate?.() || new Date()
  const openedTime = openedAt.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false })
  const openedDay = openedAt.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' })

  return (
    <div style={{ padding: '24px 18px 40px', maxWidth: 540, margin: '0 auto' }}>
      <div style={{
        fontSize: 13, fontWeight: 700, color: palette[500] || T.copper[500],
        letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 4,
      }}>
        Turno activo
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.6, marginBottom: 4 }}>
        {branch.name}
      </div>
      <div style={{ fontSize: 13, color: T.neutral[500], marginBottom: 18 }}>
        Iniciado {openedDay} a las {openedTime}
      </div>

      {/* Botón principal: Nueva venta */}
      <button
        onClick={() => setNewSaleOpen(true)}
        style={{
          width: '100%', padding: '20px', borderRadius: 18,
          background: T.copper[500], color: '#fff',
          border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 17, fontWeight: 800, letterSpacing: -0.2,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          boxShadow: '0 6px 18px rgba(184,122,86,0.4)',
          marginBottom: 10,
        }}
      >
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <circle cx="11" cy="11" r="9" stroke="#fff" strokeWidth="2" fill="none"/>
          <path d="M11 7 V15 M7 11 H15" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/>
        </svg>
        Nueva venta
      </button>

      {/* Botón secundario: Gasto de caja */}
      <button
        onClick={() => setExpenseOpen(true)}
        style={{
          width: '100%', padding: '13px', borderRadius: 14,
          background: '#fff', color: T.neutral[700],
          border: `1.5px solid ${T.neutral[200]}`,
          cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 14, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          marginBottom: 14,
        }}
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
          <path d="M3 17 H17 M3 14 L7 10 L11 13 L17 5" stroke={T.neutral[600]} strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Registrar gasto de caja
      </button>

      {/* Card de estado activo (sin mostrar monto — control anti-fraude D21) */}
      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 999, flexShrink: 0,
            background: '#E8F4E8',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{ width: 12, height: 12, borderRadius: 999, background: T.ok }}/>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.neutral[900], marginBottom: 2 }}>
              Tu turno está activo
            </div>
            <div style={{ fontSize: 12, color: T.neutral[500], lineHeight: 1.45 }}>
              Cuando termines, cierra el turno y entrega el efectivo.
            </div>
          </div>
        </div>
      </Card>

      {/* Últimas ventas (sin montos — D21) */}
      {recentSales.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{
            fontSize: 12, fontWeight: 700, color: T.neutral[500],
            letterSpacing: 0.5, textTransform: 'uppercase',
            margin: '0 4px 8px',
          }}>
            Últimas ventas
          </div>
          <Card padding={0} style={{ overflow: 'hidden' }}>
            {recentSales.map((s, i) => (
              <SaleRow
                key={s.id}
                sale={s}
                isLast={i === recentSales.length - 1}
                onClick={() => setReportSale(s)}
              />
            ))}
          </Card>
          {sessionSales.length > 15 && (
            <div style={{
              fontSize: 11.5, color: T.neutral[400],
              textAlign: 'center', marginTop: 8,
            }}>
              + {sessionSales.length - 15} ventas anteriores en este turno
            </div>
          )}
        </div>
      )}

      {/* Gastos del turno */}
      {sessionExpenses.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{
            fontSize: 12, fontWeight: 700, color: T.neutral[500],
            letterSpacing: 0.5, textTransform: 'uppercase',
            margin: '0 4px 8px',
          }}>
            Gastos de caja del turno
          </div>
          <Card padding={0} style={{ overflow: 'hidden' }}>
            {sessionExpenses.map((e, i) => (
              <ExpenseRow
                key={e.id}
                expense={e}
                isLast={i === sessionExpenses.length - 1}
              />
            ))}
          </Card>
        </div>
      )}

      {/* Mis descuentos (transparencia para la cajera) */}
      {myDeductions.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <button
            onClick={() => setShowDeductions(v => !v)}
            style={{
              width: '100%', padding: '12px 14px', borderRadius: 14,
              background: pendingDeductions.length > 0 ? '#FBE9E5' : T.neutral[100],
              border: pendingDeductions.length > 0 ? `1px solid #F0C8BE` : `1px solid ${T.neutral[200]}`,
              cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}
          >
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: pendingDeductions.length > 0 ? T.bad : T.neutral[700] }}>
                Mis descuentos
              </div>
              <div style={{ fontSize: 11.5, color: T.neutral[500], marginTop: 1 }}>
                {pendingDeductions.length > 0
                  ? `${pendingDeductions.length} pendiente(s) · ${myDeductions.length - pendingDeductions.length} aplicado(s)`
                  : `${myDeductions.length} en total`}
              </div>
            </div>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ transform: showDeductions ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
              <path d="M3 5 L7 9 L11 5" stroke={T.neutral[600]} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          {showDeductions && (
            <Card padding={0} style={{ marginTop: 8, overflow: 'hidden' }}>
              {myDeductions.map((d, i) => (
                <div key={d.id} style={{
                  padding: '10px 14px',
                  borderBottom: i < myDeductions.length - 1 ? `0.5px solid ${T.neutral[100]}` : 'none',
                  display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.neutral[800] }}>
                      {d.reason === 'cash_shortage' ? 'Falta de caja' : d.reason}
                    </div>
                    <div style={{ fontSize: 11, color: T.neutral[500], marginTop: 1 }}>
                      {d.createdAt?.toDate?.().toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }) || ''}
                      {d.status === 'applied' && d.appliedToPaymentDate && ` · aplicado ${d.appliedToPaymentDate}`}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: d.status === 'pending' ? T.bad : T.neutral[600], fontVariantNumeric: 'tabular-nums' }}>
                      −{fmtCOP(d.amount)}
                    </div>
                    <span style={{
                      fontSize: 9.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
                      color: d.status === 'pending' ? T.bad : d.status === 'applied' ? T.neutral[500] : T.neutral[400],
                      background: d.status === 'pending' ? '#FBE9E5' : T.neutral[100],
                      padding: '2px 6px', borderRadius: 999,
                    }}>
                      {d.status === 'pending' ? 'pendiente' : d.status === 'applied' ? 'aplicado' : 'cancelado'}
                    </span>
                  </div>
                </div>
              ))}
            </Card>
          )}
        </div>
      )}

      <button
        onClick={() => setClosing(true)}
        style={{
          width: '100%', padding: '15px', borderRadius: 16,
          background: T.neutral[900], color: '#fff',
          border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 15, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
          <path d="M11 4 H6 Q4 4 4 6 V14 Q4 16 6 16 H11" stroke="#fff" strokeWidth="1.7" fill="none" strokeLinecap="round"/>
          <path d="M14 7 L17 10 L14 13 M9 10 H17" stroke="#fff" strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Cerrar turno
      </button>

      {closing && (
        <CloseTurnModal
          session={session}
          authUserUid={session.cashierUid}
          onCancel={() => setClosing(false)}
          onClosed={() => setClosing(false)}
        />
      )}

      {newSaleOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 60, background: T.neutral[50],
          animation: 'slideUp 0.25s cubic-bezier(0.2,0.9,0.3,1.05)',
        }}>
          <NewSale
            session={session}
            authUser={authUser}
            userDoc={userDoc}
            onCancel={() => setNewSaleOpen(false)}
            onSaved={() => setNewSaleOpen(false)}
          />
        </div>
      )}

      {reportSale && (
        <ReportSaleModal
          sale={reportSale}
          authUser={authUser}
          userDoc={userDoc}
          onCancel={() => setReportSale(null)}
          onDone={() => setReportSale(null)}
        />
      )}

      {expenseOpen && (
        <CashExpenseModal
          session={session}
          authUser={authUser}
          userDoc={userDoc}
          onCancel={() => setExpenseOpen(false)}
          onSaved={() => setExpenseOpen(false)}
        />
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Fila de gasto en lista (la cajera SI ve montos: ella misma los digitó)
// ──────────────────────────────────────────────────────────────
function ExpenseRow({ expense, isLast }) {
  const time = expense.createdAt?.toDate?.()
  const timeStr = time
    ? time.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false })
    : '—'

  const statusColor = {
    pending: T.warn,
    approved: T.ok,
    rejected: T.bad,
  }[expense.status] || T.neutral[500]

  const statusLabel = {
    pending: 'Pendiente',
    approved: 'Aprobado',
    rejected: 'Rechazado',
  }[expense.status] || expense.status

  return (
    <div style={{
      padding: '12px 14px',
      borderBottom: isLast ? 'none' : `0.5px solid ${T.neutral[100]}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <div style={{
          fontSize: 12, fontWeight: 700, color: T.neutral[500],
          fontVariantNumeric: 'tabular-nums', minWidth: 42, flexShrink: 0,
        }}>
          {timeStr}
        </div>
        <div style={{
          flex: 1, minWidth: 0,
          fontSize: 13.5, fontWeight: 600, color: T.neutral[900],
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {expense.description}
        </div>
        <div style={{
          fontSize: 13.5, fontWeight: 700, color: T.neutral[800],
          fontVariantNumeric: 'tabular-nums', flexShrink: 0,
        }}>
          {fmtCOP(expense.amount)}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 52 }}>
        <span style={{
          fontSize: 10.5, fontWeight: 700, color: statusColor,
          background: statusColor + '15',
          padding: '2px 8px', borderRadius: 999,
          letterSpacing: 0.4, textTransform: 'uppercase',
        }}>
          {statusLabel}
        </span>
        {expense.status === 'rejected' && expense.reviewNote && (
          <span style={{
            fontSize: 11.5, color: T.bad, fontStyle: 'italic',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {expense.reviewNote}
          </span>
        )}
        {expense.photoUrl && (
          <a
            href={expense.photoUrl}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 11, color: T.copper[600], textDecoration: 'none', fontWeight: 600 }}
          >
            📎 Ver foto
          </a>
        )}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Modal: Registrar gasto de caja
// ──────────────────────────────────────────────────────────────
function CashExpenseModal({ session, authUser, userDoc, onCancel, onSaved }) {
  const [description, setDescription] = useState('')
  const [amountStr, setAmountStr] = useState('')
  const [photoUrl, setPhotoUrl] = useState(null)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoError, setPhotoError] = useState(null)
  const fileInputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const amount = Number(amountStr) || 0
  const valid = description.trim().length >= 3 && amount > 0 && !photoUploading

  async function handleFileSelected(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setPhotoError(null)
    setPhotoUploading(true)
    try {
      const result = await compressAndUpload(file)
      setPhotoUrl(result.url)
    } catch (err) {
      console.error(err)
      setPhotoError(err.message || 'No pudimos subir la foto.')
      setPhotoUrl(null)
    } finally {
      setPhotoUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleSave() {
    if (!valid || busy) return
    setBusy(true); setError(null)
    try {
      const cashierName = `${userDoc?.nombre || ''} ${userDoc?.apellido || ''}`.trim() || authUser.email
      await createCashExpense({
        sessionId: session.id,
        branchId: session.branchId,
        branchName: session.branchName,
        cashierUid: authUser.uid,
        cashierName,
        description,
        amount,
        photoUrl: photoUrl || undefined,
      })
      onSaved()
    } catch (err) {
      console.error(err)
      setError('No pudimos guardar el gasto. Intenta de nuevo.')
      setBusy(false)
    }
  }

  return (
    <ModalOverlay onClose={busy ? undefined : onCancel}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 440, background: '#fff', borderRadius: 22,
        padding: '24px 22px 22px', boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
        animation: 'fadeScaleIn 0.2s ease',
        maxHeight: '92vh', overflowY: 'auto',
      }}>
        <div style={{ fontSize: 19, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3, marginBottom: 4 }}>
          Registrar gasto de caja
        </div>
        <div style={{ fontSize: 12.5, color: T.neutral[500], marginBottom: 16 }}>
          Quedará pendiente de aprobación del administrador.
        </div>

        <ExpenseTextField
          label="¿Para qué fue?"
          value={description}
          onChange={setDescription}
          placeholder="Ej: Compra de empaques al proveedor"
          autoFocus
          disabled={busy}
        />

        <ExpenseNumberField
          label="Monto"
          value={amountStr}
          onChange={setAmountStr}
          disabled={busy}
        />

        {/* Foto opcional */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: T.neutral[600], display: 'block', marginBottom: 6 }}>
            Foto del recibo (opcional)
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileSelected}
            style={{ display: 'none' }}
          />
          {!photoUrl && !photoUploading && !photoError && (
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                width: '100%', padding: '14px', borderRadius: 12,
                background: '#fff', color: T.neutral[600],
                border: `1.5px dashed ${T.neutral[300]}`,
                cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 13, fontWeight: 600,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              📸 Adjuntar foto
            </button>
          )}
          {photoUploading && (
            <div style={{
              padding: '14px', borderRadius: 12, textAlign: 'center',
              background: T.neutral[50], border: `1.5px solid ${T.neutral[200]}`,
              fontSize: 13, color: T.neutral[600], fontWeight: 600,
            }}>
              Subiendo foto...
            </div>
          )}
          {photoError && !photoUploading && (
            <div style={{
              padding: '11px 14px', borderRadius: 12,
              background: '#FBE9E5', border: `1px solid #F0C8BE`,
              fontSize: 12.5, color: T.bad, fontWeight: 500,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            }}>
              <span style={{ flex: 1 }}>{photoError}</span>
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{
                  padding: '6px 12px', borderRadius: 8,
                  background: T.bad, color: '#fff', border: 'none',
                  fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Reintentar
              </button>
            </div>
          )}
          {photoUrl && !photoUploading && (
            <div style={{
              borderRadius: 12, overflow: 'hidden',
              border: `1.5px solid ${T.ok}66`, background: '#fff',
            }}>
              <img
                src={photoUrl}
                alt="Recibo"
                style={{
                  display: 'block', width: '100%', maxHeight: 180,
                  objectFit: 'contain', background: T.neutral[900],
                }}
              />
              <button
                onClick={() => setPhotoUrl(null)}
                style={{
                  width: '100%', padding: '8px',
                  background: 'transparent', border: 'none',
                  borderTop: `1px solid ${T.neutral[100]}`,
                  cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 12, fontWeight: 600, color: T.neutral[600],
                }}
              >
                Quitar foto
              </button>
            </div>
          )}
        </div>

        <div style={{
          padding: '11px 14px', borderRadius: 12,
          background: '#FFF7E6', border: `1px solid #F4E0BC`,
          fontSize: 12.5, color: T.warn, fontWeight: 500, lineHeight: 1.5,
          marginBottom: 14,
        }}>
          ⚠ Este monto reduce tu caja del turno. Cuando cierres el turno, ya estará descontado.
        </div>

        {error && <ErrorBox text={error} />}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCancel} disabled={busy} style={btnSecondary()}>Cancelar</button>
          <button
            onClick={handleSave}
            disabled={!valid || busy}
            style={{
              ...btnPrimary(valid && !busy ? T.copper[500] : T.neutral[200]),
              flex: 1.4,
              color: valid && !busy ? '#fff' : T.neutral[400],
              cursor: valid && !busy ? 'pointer' : 'not-allowed',
              boxShadow: valid && !busy ? '0 3px 10px rgba(184,122,86,0.3)' : 'none',
            }}
          >
            {busy ? 'Guardando...' : 'Registrar gasto'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

function ExpenseTextField({ label, value, onChange, placeholder, autoFocus, disabled }) {
  const [focused, setFocused] = useState(false)
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: T.neutral[600], display: 'block', marginBottom: 6 }}>
        {label}
      </label>
      <div style={{
        border: `1.5px solid ${focused ? T.copper[400] : T.neutral[200]}`,
        borderRadius: 12, background: '#fff', transition: 'border-color 0.12s',
      }}>
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            width: '100%', padding: '12px 14px', border: 'none', outline: 'none',
            fontFamily: 'inherit', fontSize: 14.5, color: T.neutral[900],
            background: 'transparent', borderRadius: 12,
            opacity: disabled ? 0.6 : 1,
          }}
        />
      </div>
    </div>
  )
}

function ExpenseNumberField({ label, value, onChange, disabled }) {
  const [focused, setFocused] = useState(false)
  function sanitize(raw) {
    return raw.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '')
  }
  const display = value === '0' ? '' : value
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: T.neutral[600], display: 'block', marginBottom: 6 }}>
        {label}
      </label>
      <div style={{
        border: `1.5px solid ${focused ? T.copper[400] : T.neutral[200]}`,
        borderRadius: 12, background: '#fff', transition: 'border-color 0.12s',
        display: 'flex', alignItems: 'center',
      }}>
        <span style={{ paddingLeft: 14, color: T.neutral[500], fontSize: 15, fontWeight: 600 }}>$</span>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={display}
          onChange={e => onChange(sanitize(e.target.value))}
          placeholder="0"
          disabled={disabled}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            width: '100%', padding: '12px 14px 12px 8px', border: 'none', outline: 'none',
            fontFamily: 'inherit', fontSize: 16, color: T.neutral[900],
            background: 'transparent', borderRadius: 12,
            opacity: disabled ? 0.6 : 1,
            fontVariantNumeric: 'tabular-nums', fontWeight: 600,
          }}
        />
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Fila de venta en lista (sin monto — D21)
// ──────────────────────────────────────────────────────────────
function SaleRow({ sale, isLast, onClick }) {
  const time = sale.createdAt?.toDate?.()
  const timeStr = time
    ? time.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false })
    : '—'

  const itemsCount = sale.items?.length || 0
  const firstName = sale.items?.[0]?.name || ''
  const summary = itemsCount === 1
    ? firstName
    : itemsCount > 1
      ? `${firstName} + ${itemsCount - 1} más`
      : 'Sin productos'

  const methodIcons = {
    efectivo: '💵',
    nequi: '📱',
    daviplata: '📱',
    deuda: '🤝',
  }
  const methodIcon = methodIcons[sale.paymentMethod] || ''

  const isFlagged = sale.status === 'flagged'

  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', padding: '12px 14px',
        background: isFlagged ? '#FFF7E6' : 'transparent',
        border: 'none', cursor: 'pointer', fontFamily: 'inherit',
        borderBottom: isLast ? 'none' : `0.5px solid ${T.neutral[100]}`,
        display: 'flex', alignItems: 'center', gap: 10,
        textAlign: 'left',
      }}
    >
      <div style={{
        fontSize: 12, fontWeight: 700, color: T.neutral[500],
        fontVariantNumeric: 'tabular-nums', minWidth: 42, flexShrink: 0,
      }}>
        {timeStr}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13.5, fontWeight: 600, color: T.neutral[900],
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {summary}
        </div>
        {isFlagged && (
          <div style={{ fontSize: 11, color: T.warn, fontWeight: 600, marginTop: 2 }}>
            ⚠ Reportado al admin
          </div>
        )}
        {sale.paymentMethod === 'deuda' && sale.debtorName && !isFlagged && (
          <div style={{
            fontSize: 11, color: T.neutral[500], marginTop: 2,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            deudor: {sale.debtorName}
          </div>
        )}
      </div>
      <div style={{ fontSize: 16, flexShrink: 0 }} title={sale.paymentMethod}>
        {methodIcon}
      </div>
    </button>
  )
}

// ──────────────────────────────────────────────────────────────
// Modal: Reportar problema con una venta
// ──────────────────────────────────────────────────────────────
function ReportSaleModal({ sale, authUser, userDoc, onCancel, onDone }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const isAlreadyFlagged = sale.status === 'flagged'
  const valid = note.trim().length >= 10

  async function handleReport() {
    if (!valid || busy) return
    setBusy(true); setError(null)
    try {
      const cashierName = `${userDoc?.nombre || ''} ${userDoc?.apellido || ''}`.trim() || authUser.email
      await flagSale(sale.id, {
        note,
        byUid: authUser.uid,
        byName: cashierName,
      })
      onDone()
    } catch (err) {
      console.error(err)
      setError('No pudimos enviar el reporte. Intenta de nuevo.')
      setBusy(false)
    }
  }

  const time = sale.createdAt?.toDate?.()
  const timeStr = time
    ? time.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false })
    : '—'

  return (
    <ModalOverlay onClose={busy ? undefined : onCancel}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 420, background: '#fff', borderRadius: 22,
        padding: '24px 22px 22px', boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
        animation: 'fadeScaleIn 0.2s ease',
        maxHeight: '92vh', overflowY: 'auto',
      }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3, marginBottom: 4 }}>
          Reportar problema
        </div>
        <div style={{ fontSize: 12.5, color: T.neutral[500], marginBottom: 16 }}>
          Venta de las {timeStr} · {sale.items?.length || 0} producto(s)
        </div>

        {/* Lista de items para que la cajera identifique cuál es */}
        <div style={{
          padding: '10px 12px', borderRadius: 12,
          background: T.neutral[50], marginBottom: 14,
          maxHeight: 140, overflowY: 'auto',
        }}>
          {sale.items?.map((it, i) => (
            <div key={i} style={{
              fontSize: 12.5, color: T.neutral[700],
              padding: '3px 0',
              display: 'flex', justifyContent: 'space-between', gap: 8,
            }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {it.qty}× {it.name}
              </span>
            </div>
          ))}
        </div>

        {isAlreadyFlagged ? (
          <>
            <div style={{
              padding: '12px 14px', borderRadius: 12,
              background: '#FFF7E6', border: `1px solid #F4E0BC`,
              fontSize: 13, color: T.warn, lineHeight: 1.5, marginBottom: 14,
            }}>
              Esta venta ya está reportada al admin. Estas son las notas dejadas:
            </div>
            <div style={{
              padding: '10px 12px', borderRadius: 10,
              background: '#fff', border: `1px solid ${T.neutral[100]}`,
              maxHeight: 200, overflowY: 'auto', marginBottom: 14,
            }}>
              {(sale.notes || []).map((n, i) => (
                <div key={i} style={{
                  padding: '6px 0',
                  borderBottom: i < (sale.notes.length - 1) ? `0.5px solid ${T.neutral[100]}` : 'none',
                  fontSize: 12.5, color: T.neutral[700], lineHeight: 1.5,
                }}>
                  <div style={{ fontWeight: 600, color: T.neutral[800], marginBottom: 2 }}>
                    {n.byName || 'Cajera'}
                  </div>
                  <div>{n.message}</div>
                </div>
              ))}
            </div>
            <button onClick={onCancel} style={btnSecondary()}>Cerrar</button>
          </>
        ) : (
          <>
            <NoteField
              label="¿Qué pasó? (mínimo 10 caracteres)"
              value={note}
              onChange={setNote}
              placeholder="Ej: La cantidad de panes está mal, eran 3 no 5..."
              disabled={busy}
            />

            <div style={{
              padding: '11px 14px', borderRadius: 12,
              background: '#FFF7E6', border: `1px solid #F4E0BC`,
              fontSize: 12.5, color: T.warn, fontWeight: 500, lineHeight: 1.5,
              marginTop: 4, marginBottom: 14,
            }}>
              ⚠ La venta no se modifica ni se elimina. El admin verá tu reporte y decidirá qué hacer.
            </div>

            {error && <ErrorBox text={error} />}

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={onCancel} disabled={busy} style={btnSecondary()}>Cancelar</button>
              <button
                onClick={handleReport}
                disabled={!valid || busy}
                style={{
                  ...btnPrimary(valid && !busy ? T.warn : T.neutral[200]),
                  flex: 1.4,
                  color: valid && !busy ? '#fff' : T.neutral[400],
                  cursor: valid && !busy ? 'pointer' : 'not-allowed',
                }}
              >
                {busy ? 'Reportando...' : 'Reportar al admin'}
              </button>
            </div>
          </>
        )}
      </div>
    </ModalOverlay>
  )
}

// ──────────────────────────────────────────────────────────────
// MODAL: Cerrar turno (cuadre + handover)
// ──────────────────────────────────────────────────────────────
function CloseTurnModal({ session, authUserUid, onCancel, onClosed }) {
  // Fase 2: aún no hay ventas/gastos. expectedCash = openingFloat.
  // ⚠ Este valor NUNCA se muestra a la cajera. Solo se calcula internamente
  // y se reporta al admin si hay diferencia. La cajera declara a ciegas
  // lo que tiene físicamente (control anti-fraude).
  const expectedCash = session.openingFloat || 0

  const [declaredStr, setDeclaredStr] = useState('')
  const [closingNote, setClosingNote] = useState('')
  const [handoverType, setHandoverType] = useState('admin') // 'admin' | 'cashier'
  const [handoverToUid, setHandoverToUid] = useState(null)
  const [cashiers, setCashiers] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [step, setStep] = useState('count') // count → handover

  const declared = Number(declaredStr) || 0
  const difference = declared - expectedCash
  const hasShortage = difference < 0
  const hasSurplus = difference > 0

  useEffect(() => {
    const unsub = watchAllUsers(list => {
      const others = list.filter(u =>
        u.role === 'cashier' && u.status === 'approved' && u.uid !== authUserUid
      )
      setCashiers(others)
    })
    return unsub
  }, [authUserUid])

  const selectedCashier = handoverType === 'cashier' ? cashiers.find(c => c.uid === handoverToUid) : null

  const canConfirm =
    declared >= 0 &&
    (handoverType === 'admin' || (handoverType === 'cashier' && selectedCashier))

  async function handleConfirm() {
    if (!canConfirm || busy) return
    setBusy(true)
    setError(null)
    try {
      // El monto entregado siempre es lo que la cajera declara tener.
      const handover =
        handoverType === 'admin'
          ? { type: 'admin', toName: 'Jhonatan Miranda', amount: declared }
          : {
              type: 'cashier',
              toUid: selectedCashier.uid,
              toName: `${selectedCashier.nombre} ${selectedCashier.apellido}`.trim(),
              amount: declared,
            }

      // Si hay diferencia, construimos el closingDiscrepancy:
      // - sobra: status 'resolved' (se absorbe en el fondo automáticamente)
      // - falta: status 'pending' (admin decide en Pendientes)
      let closingDiscrepancy = null
      if (hasSurplus) {
        closingDiscrepancy = {
          type: 'surplus',
          amount: Math.abs(difference),
          status: 'resolved',
          note: closingNote.trim() || null,
        }
      } else if (hasShortage) {
        closingDiscrepancy = {
          type: 'shortage',
          amount: Math.abs(difference),
          status: 'pending',
          note: closingNote.trim() || null,
        }
      }

      await closeSession(session.id, {
        declaredClosingCash: declared,
        expectedCash,
        difference,
        handover,
        closingNote: closingNote.trim() || null,
        closingDiscrepancy,
      })
      onClosed()
    } catch (err) {
      console.error(err)
      setError('No pudimos cerrar el turno. Intenta de nuevo.')
      setBusy(false)
    }
  }

  return (
    <ModalOverlay onClose={busy ? undefined : onCancel}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 440, background: '#fff', borderRadius: 22,
        boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
        animation: 'fadeScaleIn 0.2s ease',
        maxHeight: '94vh', overflowY: 'auto',
      }}>

        <div style={{ padding: '22px 22px 8px' }}>
          <div style={{ fontSize: 19, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3 }}>
            Cerrar turno
          </div>
          <div style={{ fontSize: 12.5, color: T.neutral[500], marginTop: 2 }}>
            Paso {step === 'count' ? '1' : '2'} de 2 · {step === 'count' ? 'Conteo' : 'Entrega'}
          </div>
        </div>

        {step === 'count' && (
          <div style={{ padding: '8px 22px 4px' }}>
            <div style={{
              padding: '12px 14px', borderRadius: 12,
              background: T.neutral[50], border: `1px solid ${T.neutral[100]}`,
              marginBottom: 16, fontSize: 12.5, color: T.neutral[600], lineHeight: 1.55,
            }}>
              Cuenta el efectivo físico que tienes en caja y declara la cantidad exacta. El administrador se encarga del cuadre.
            </div>

            <NumberField
              label="¿Cuánto tienes en caja?"
              value={declaredStr}
              onChange={setDeclaredStr}
              placeholder="0"
              autoFocus
              disabled={busy}
            />

            <NoteField
              label="¿Quieres dejar alguna observación? (opcional)"
              value={closingNote}
              onChange={setClosingNote}
              placeholder="Ej: Le di vuelto de más a un cliente sin querer."
              disabled={busy}
            />
          </div>
        )}

        {step === 'handover' && (
          <div style={{ padding: '8px 22px 4px' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.neutral[700], marginBottom: 10 }}>
              ¿A quién entregas el dinero?
            </div>

            <RadioOption
              selected={handoverType === 'admin'}
              onClick={() => setHandoverType('admin')}
              icon="👤"
              title="Administrador"
              subtitle="Jhonatan Miranda"
            />

            <div style={{ height: 8 }}/>

            <RadioOption
              selected={handoverType === 'cashier'}
              onClick={() => setHandoverType('cashier')}
              icon="💁‍♀️"
              title="Otra cajera"
              subtitle={cashiers.length === 0 ? 'No hay otras cajeras activas' : `${cashiers.length} ${cashiers.length === 1 ? 'cajera disponible' : 'cajeras disponibles'}`}
              disabled={cashiers.length === 0}
            />

            {handoverType === 'cashier' && cashiers.length > 0 && (
              <div style={{ marginTop: 10, marginBottom: 4 }}>
                <select
                  value={handoverToUid || ''}
                  onChange={e => setHandoverToUid(e.target.value)}
                  disabled={busy}
                  style={{
                    width: '100%', padding: '12px 14px', borderRadius: 12,
                    border: `1.5px solid ${T.neutral[200]}`,
                    background: '#fff', color: T.neutral[900],
                    fontFamily: 'inherit', fontSize: 14, outline: 'none',
                  }}
                >
                  <option value="">Selecciona una cajera...</option>
                  {cashiers.map(c => (
                    <option key={c.uid} value={c.uid}>
                      {c.nombre} {c.apellido}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Resumen del monto que se entrega */}
            <div style={{
              marginTop: 18, padding: '14px 16px', borderRadius: 14,
              background: T.copper[50], border: `1px solid ${T.copper[100]}`,
            }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: T.copper[700], letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 }}>
                Vas a entregar
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, color: T.copper[700], fontVariantNumeric: 'tabular-nums', letterSpacing: -0.6 }}>
                {fmtCOP(declared)}
              </div>
            </div>
          </div>
        )}

        {error && (
          <div style={{
            margin: '0 22px 8px',
            padding: '10px 12px', borderRadius: 10,
            background: '#FBE9E5', border: `1px solid #F0C8BE`, color: T.bad,
            fontSize: 12.5, fontWeight: 500, textAlign: 'center',
          }}>
            {error}
          </div>
        )}

        <div style={{ padding: '8px 22px 22px', display: 'flex', gap: 10 }}>
          {step === 'count' ? (
            <>
              <button onClick={onCancel} disabled={busy} style={btnSecondary()}>Cancelar</button>
              <button
                onClick={() => setStep('handover')}
                disabled={busy || declared < 0}
                style={{ ...btnPrimary(T.neutral[900]), flex: 1.4 }}
              >
                Siguiente
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setStep('count')} disabled={busy} style={btnSecondary()}>Atrás</button>
              <button
                onClick={handleConfirm}
                disabled={!canConfirm || busy}
                style={{
                  ...btnPrimary(canConfirm && !busy ? T.copper[500] : T.neutral[200]),
                  flex: 1.4,
                  color: canConfirm && !busy ? '#fff' : T.neutral[400],
                  cursor: canConfirm && !busy ? 'pointer' : 'not-allowed',
                  boxShadow: canConfirm && !busy ? '0 3px 10px rgba(184,122,86,0.3)' : 'none',
                }}
              >
                {busy ? 'Cerrando...' : 'Confirmar cierre'}
              </button>
            </>
          )}
        </div>
      </div>
    </ModalOverlay>
  )
}

// ──────────────────────────────────────────────────────────────
// Componentes utilitarios
// ──────────────────────────────────────────────────────────────
function NumberField({ label, value, onChange, placeholder, autoFocus, disabled, hint }) {
  const [focused, setFocused] = useState(false)

  // Permite solo dígitos y elimina ceros a la izquierda (excepto "0" solo)
  function sanitize(raw) {
    const onlyDigits = raw.replace(/[^0-9]/g, '')
    return onlyDigits.replace(/^0+(?=\d)/, '')
  }

  // Muestra string vacío en vez de "0" para que la UX sea más limpia
  const displayValue = value === '0' ? '' : value

  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: T.neutral[600], display: 'block', marginBottom: 6 }}>
        {label}
      </label>
      <div style={{
        border: `1.5px solid ${focused ? T.copper[400] : T.neutral[200]}`,
        borderRadius: 12, background: '#fff',
        transition: 'border-color 0.12s',
        display: 'flex', alignItems: 'center',
      }}>
        <span style={{ paddingLeft: 14, color: T.neutral[500], fontSize: 15, fontWeight: 600 }}>$</span>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={displayValue}
          onChange={e => onChange(sanitize(e.target.value))}
          placeholder={placeholder || '0'}
          autoFocus={autoFocus}
          disabled={disabled}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            width: '100%', padding: '12px 14px 12px 8px', border: 'none', outline: 'none',
            fontFamily: 'inherit', fontSize: 16, color: T.neutral[900],
            background: 'transparent', borderRadius: 12,
            opacity: disabled ? 0.6 : 1,
            fontVariantNumeric: 'tabular-nums', fontWeight: 600,
          }}
        />
      </div>
      {hint && (
        <div style={{ fontSize: 11.5, color: T.neutral[400], marginTop: 4, lineHeight: 1.45 }}>{hint}</div>
      )}
    </div>
  )
}

function NoteField({ label, value, onChange, placeholder, disabled }) {
  const [focused, setFocused] = useState(false)
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: T.neutral[600], display: 'block', marginBottom: 6 }}>
        {label}
      </label>
      <div style={{
        border: `1.5px solid ${focused ? T.copper[400] : T.neutral[200]}`,
        borderRadius: 12, background: '#fff',
        transition: 'border-color 0.12s',
      }}>
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          rows={3}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            width: '100%', padding: '12px 14px', border: 'none', outline: 'none',
            fontFamily: 'inherit', fontSize: 14, color: T.neutral[900],
            background: 'transparent', borderRadius: 12, resize: 'vertical',
            opacity: disabled ? 0.6 : 1,
            minHeight: 64,
          }}
        />
      </div>
    </div>
  )
}

function RadioOption({ selected, onClick, icon, title, subtitle, disabled }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        width: '100%', padding: '14px 14px', borderRadius: 14,
        background: selected ? T.copper[50] : '#fff',
        border: `1.5px solid ${selected ? T.copper[400] : T.neutral[200]}`,
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit', textAlign: 'left',
        display: 'flex', alignItems: 'center', gap: 12,
        opacity: disabled ? 0.5 : 1,
        transition: 'all 0.12s',
      }}
    >
      <div style={{
        width: 38, height: 38, borderRadius: 10,
        background: selected ? T.copper[100] : T.neutral[100],
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, fontSize: 18,
      }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: T.neutral[900] }}>{title}</div>
        <div style={{ fontSize: 12, color: T.neutral[500], marginTop: 1 }}>{subtitle}</div>
      </div>
      <div style={{
        width: 20, height: 20, borderRadius: 999, flexShrink: 0,
        border: `2px solid ${selected ? T.copper[500] : T.neutral[300]}`,
        background: selected ? T.copper[500] : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {selected && (
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M2 5 L4 7 L8 3" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </div>
    </button>
  )
}

function ModalOverlay({ onClose, children }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 90,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      {children}
    </div>
  )
}

function btnPrimary(bg) {
  return {
    flex: 1, padding: '12px', borderRadius: 12,
    background: bg, color: '#fff',
    border: 'none', cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
  }
}
function btnSecondary() {
  return {
    flex: 1, padding: '12px', borderRadius: 12,
    background: T.neutral[100], color: T.neutral[700],
    border: 'none', cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
  }
}

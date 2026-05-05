import { useEffect, useMemo, useState } from 'react'
import { T } from '../tokens'
import { fmtCOP } from '../utils/format'
import { Card, UserAvatar } from '../components/Atoms'
import { ScreenHeader } from '../components/Nav'
import { useAuth } from '../context/AuthCtx'

import { watchAllUsers } from '../users'
import {
  watchSessionsWithPendingReview,
  watchSurplusFundBalance,
  resolveOpeningDispute,
  resolveClosingDiscrepancy,
  approveSessionClose,
} from '../cashSessions'
import {
  watchPendingExpenses,
  approveCashExpense,
  rejectCashExpense,
} from '../cashExpenses'
import { watchAllSales } from '../sales'
import { createDeduction } from '../cashierDeductions'
import { watchCashierProducts, deleteCashierProduct } from '../products'
import { addMovement, getData, getBogotaHour, getBogotaDateStr, isDayConfirmed, toggleReminderPaid } from '../db'
import { doc, updateDoc } from 'firebase/firestore'
import { firestoreDb } from '../firebase'

export default function Pendientes({ onOpenUsers, onOpenProducts, onOpenReminders, onConfirmAttendance, dataTick }) {
  const { authUser } = useAuth()

  const [pendingUsers, setPendingUsers] = useState([])
  const [allUsers, setAllUsers] = useState([])
  const [pendingSessions, setPendingSessions] = useState([])
  const [pendingExpenses, setPendingExpenses] = useState([])
  const [allSales, setAllSales] = useState([])
  const [surplusBalance, setSurplusBalance] = useState(0)
  const [cashierProducts, setCashierProducts] = useState([])

  useEffect(() => watchAllUsers(list => {
    setAllUsers(list)
    setPendingUsers(list.filter(u => u.status === 'pending'))
  }), [])
  useEffect(() => watchSessionsWithPendingReview(setPendingSessions), [])
  useEffect(() => watchPendingExpenses(setPendingExpenses), [])
  useEffect(() => watchAllSales(setAllSales), [])
  useEffect(() => watchSurplusFundBalance(setSurplusBalance), [])
  useEffect(() => watchCashierProducts(setCashierProducts), [])

  // Reminders y asistencia (legacy del admin) — recalcula al cambiar dataTick
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { overdueReminders, needsAttendanceConfirm } = useMemo(() => {
    const data = getData()
    const today = getBogotaDateStr()
    const reminders = data.reminders || []
    const overdue = reminders.filter(r => {
      if (r.paid) return false
      if (!r.due) return false
      const daysLeft = Math.ceil((new Date(r.due) - new Date(today + 'T00:00:00')) / 86400000)
      return daysLeft <= 0
    }).sort((a, b) => a.due.localeCompare(b.due))
    const employees = data.employees || []
    const needs = getBogotaHour() >= 20
      && !isDayConfirmed(today)
      && employees.some(e => e.type !== 'occasional')
    return { overdueReminders: overdue, needsAttendanceConfirm: needs }
  }, [dataTick])

  const openingDisputes = pendingSessions.filter(s => s.openingDispute?.status === 'pending')
  const pendingCloses = pendingSessions.filter(s => s.status === 'pending_close')
  // Discrepancias antiguas (de antes del cambio a pending_close) que aún están pending
  // y no son parte de un pending_close actual
  const orphanShortages = pendingSessions.filter(s =>
    s.status === 'closed' &&
    s.closingDiscrepancy?.status === 'pending' &&
    s.closingDiscrepancy?.type === 'shortage'
  )
  const flaggedSales = useMemo(
    () => allSales.filter(s => s.status === 'flagged'),
    [allSales]
  )

  const totalCount =
    pendingUsers.length +
    openingDisputes.length +
    pendingCloses.length +
    orphanShortages.length +
    pendingExpenses.length +
    flaggedSales.length +
    cashierProducts.length +
    overdueReminders.length +
    (needsAttendanceConfirm ? 1 : 0)

  return (
    <div style={{ paddingBottom: 110 }}>
      <ScreenHeader
        title="Pendientes"
        subtitle={totalCount > 0 ? `${totalCount} ${totalCount === 1 ? 'cosa' : 'cosas'} por revisar` : 'Todo al día'}
      />

      {totalCount === 0 && (
        <div style={{ padding: '64px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 56, marginBottom: 12 }}>✨</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: T.neutral[700] }}>
            ¡Sin pendientes!
          </div>
          <div style={{ fontSize: 13, color: T.neutral[500], marginTop: 6, maxWidth: 280, margin: '6px auto 0' }}>
            Cuando haya solicitudes de cuenta, gastos por aprobar o algo más por revisar, aparecerán aquí.
          </div>
        </div>
      )}

      {needsAttendanceConfirm && (
        <Section title="Asistencia del día" count={1} tone="copper" defaultOpen>
          <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: T.neutral[900] }}>
                Confirmar asistencia de hoy
              </div>
              <div style={{ fontSize: 11.5, color: T.neutral[600], marginTop: 2 }}>
                Registra los empleados que trabajaron hoy.
              </div>
            </div>
            <button onClick={() => onConfirmAttendance?.()} style={btnSmall(T.copper[500])}>
              Confirmar
            </button>
          </div>
        </Section>
      )}

      {overdueReminders.length > 0 && (
        <Section
          title="Pagos vencidos"
          count={overdueReminders.length}
          tone="bad"
          actionLabel="Ver todos"
          onAction={onOpenReminders}
        >
          {overdueReminders.slice(0, 5).map((r, i) => (
            <div key={r.id} style={{
              padding: '12px 14px',
              borderBottom: i < Math.min(overdueReminders.length, 5) - 1 ? `0.5px solid ${T.neutral[100]}` : 'none',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13.5, fontWeight: 700, color: T.neutral[900],
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {r.title}
                </div>
                <div style={{ fontSize: 11.5, color: T.bad, fontWeight: 600, marginTop: 2 }}>
                  {fmtCOP(r.amount || 0)} · vencido {r.due}
                </div>
              </div>
              <button
                onClick={() => { toggleReminderPaid(r.id) }}
                style={btnSmall(T.ok)}
              >
                Marcar pagado
              </button>
            </div>
          ))}
          {overdueReminders.length > 5 && (
            <div style={{ padding: '8px 14px', fontSize: 11.5, color: T.neutral[500], textAlign: 'center' }}>
              + {overdueReminders.length - 5} más
            </div>
          )}
        </Section>
      )}

      {pendingUsers.length > 0 && (
        <Section
          title="Solicitudes de cuenta"
          count={pendingUsers.length}
          tone="copper"
          actionLabel="Revisar en Usuarios"
          onAction={onOpenUsers}
        >
          {pendingUsers.slice(0, 3).map(u => (
            <div key={u.uid} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px' }}>
              <UserAvatar user={u} size={32} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: T.neutral[900] }}>
                  {u.nombre} {u.apellido}
                </div>
                <div style={{ fontSize: 11.5, color: T.neutral[500] }}>{u.email}</div>
              </div>
            </div>
          ))}
          {pendingUsers.length > 3 && (
            <div style={{ padding: '8px 14px', fontSize: 11.5, color: T.neutral[500] }}>
              + {pendingUsers.length - 3} más
            </div>
          )}
        </Section>
      )}

      {openingDisputes.length > 0 && (
        <OpeningDisputesSection sessions={openingDisputes} adminUid={authUser.uid} />
      )}

      {pendingCloses.length > 0 && (
        <PendingClosesSection
          sessions={pendingCloses}
          adminUid={authUser.uid}
          surplusBalance={surplusBalance}
          allUsers={allUsers}
        />
      )}

      {orphanShortages.length > 0 && (
        <ClosingShortagesSection
          sessions={orphanShortages}
          adminUid={authUser.uid}
          surplusBalance={surplusBalance}
          allUsers={allUsers}
        />
      )}

      {pendingExpenses.length > 0 && (
        <CashExpensesSection expenses={pendingExpenses} adminUid={authUser.uid} />
      )}

      {flaggedSales.length > 0 && (
        <FlaggedSalesSection sales={flaggedSales} adminUid={authUser.uid} />
      )}

      {cashierProducts.length > 0 && (
        <CashierProductsSection
          products={cashierProducts}
          onOpenProducts={onOpenProducts}
        />
      )}

      {/* Saldo del fondo de sobras (siempre visible si > 0) */}
      {surplusBalance > 0 && (
        <div style={{ padding: '0 16px 12px' }}>
          <Card style={{ background: '#E8F4E8', border: `1px solid #C2DDC1`, boxShadow: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.ok }}>Fondo de sobras</div>
                <div style={{ fontSize: 11.5, color: T.neutral[600], marginTop: 2 }}>
                  Disponible para cubrir faltas futuras
                </div>
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: T.ok, fontVariantNumeric: 'tabular-nums' }}>
                {fmtCOP(surplusBalance)}
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Productos creados por cajera (con acción inline)
// ──────────────────────────────────────────────────────────────
function CashierProductsSection({ products, onOpenProducts }) {
  const [confirmDel, setConfirmDel] = useState(null)
  const [busy, setBusy] = useState(false)

  async function handleDelete() {
    if (!confirmDel || busy) return
    setBusy(true)
    try {
      await deleteCashierProduct(confirmDel.id)
      setConfirmDel(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Section
        title="Productos sin costo"
        count={products.length}
        tone="copper"
      >
        {products.slice(0, 5).map((p, i) => (
          <div key={p.id} style={{
            padding: '12px 14px',
            display: 'flex', alignItems: 'center', gap: 10,
            borderBottom: i < Math.min(products.length, 5) - 1
              ? `0.5px solid ${T.neutral[100]}`
              : 'none',
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 13.5, fontWeight: 700, color: T.neutral[900],
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {p.name}
              </div>
              <div style={{ fontSize: 11.5, color: T.neutral[500], marginTop: 2 }}>
                Precio: <b style={{ color: T.neutral[700] }}>{fmtCOP(p.salePrice)}</b>
                {p.createdByName && ` · por ${p.createdByName}`}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <button onClick={() => onOpenProducts?.()} style={btnSmall(T.copper[500])}>
                Aceptar
              </button>
              <button
                onClick={() => setConfirmDel(p)}
                style={{
                  padding: '7px 12px', borderRadius: 10,
                  background: 'transparent', color: T.bad,
                  border: `1px solid ${T.bad}33`,
                  cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 12.5, fontWeight: 600,
                }}
              >
                Eliminar
              </button>
            </div>
          </div>
        ))}
        {products.length > 5 && (
          <div style={{ padding: '8px 14px', fontSize: 11.5, color: T.neutral[500], textAlign: 'center' }}>
            + {products.length - 5} más en la pestaña Productos
          </div>
        )}
      </Section>

      {confirmDel && (
        <ModalOverlay onClose={busy ? undefined : () => setConfirmDel(null)}>
          <ModalCard>
            <ModalTitle>¿Eliminar producto?</ModalTitle>
            <ModalSub>{confirmDel.name}</ModalSub>
            <div style={{ fontSize: 13, color: T.neutral[600], marginBottom: 18, lineHeight: 1.5 }}>
              Se eliminará del catálogo. Las ventas que ya lo usaron no se afectan.
            </div>
            <ModalActions
              onCancel={() => setConfirmDel(null)}
              onConfirm={handleDelete}
              confirmLabel={busy ? 'Eliminando...' : 'Eliminar'}
              confirmDisabled={busy}
              confirmColor={T.bad}
            />
          </ModalCard>
        </ModalOverlay>
      )}
    </>
  )
}

// ──────────────────────────────────────────────────────────────
// Sección colapsable (acordeón)
// ──────────────────────────────────────────────────────────────
function Section({ title, count, tone = 'copper', actionLabel, onAction, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  const tones = {
    copper: { bg: T.copper[50], border: T.copper[100], text: T.copper[700], iconBg: T.copper[100] },
    warn:   { bg: '#FFF7E6', border: '#F4E0BC', text: T.warn, iconBg: '#F4E0BC' },
    bad:    { bg: '#FBE9E5', border: '#F0C8BE', text: T.bad, iconBg: '#F0C8BE' },
  }
  const tn = tones[tone] || tones.copper

  return (
    <div style={{ padding: '0 16px 10px' }}>
      <Card padding={0} style={{ background: tn.bg, border: `1px solid ${tn.border}`, boxShadow: 'none', overflow: 'hidden' }}>
        {/* Header clickeable */}
        <button
          onClick={() => setOpen(o => !o)}
          style={{
            width: '100%', padding: '14px 16px',
            background: 'transparent', border: 'none',
            cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', gap: 12,
            textAlign: 'left',
          }}
        >
          <div style={{
            width: 30, height: 30, borderRadius: 999, flexShrink: 0,
            background: tn.iconBg, color: tn.text,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, fontWeight: 800,
          }}>
            {count}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 14, fontWeight: 700, color: tn.text,
            }}>
              {title}
            </div>
          </div>
          {actionLabel && onAction && (
            <button
              onClick={(e) => { e.stopPropagation(); onAction() }}
              style={{
                background: 'none', border: 'none', padding: '4px 8px',
                fontSize: 12, fontWeight: 700, color: T.copper[600],
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              {actionLabel}
            </button>
          )}
          <svg
            width="14" height="14" viewBox="0 0 14 14" fill="none"
            style={{
              transform: open ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.18s',
              flexShrink: 0,
            }}
          >
            <path d="M3 5 L7 9 L11 5" stroke={tn.text} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {/* Cuerpo */}
        {open && (
          <div style={{ borderTop: `1px solid ${tn.border}`, background: '#fff' }}>
            {children}
          </div>
        )}
      </Card>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Disputas de apertura
// ──────────────────────────────────────────────────────────────
function OpeningDisputesSection({ sessions, adminUid }) {
  const [resolving, setResolving] = useState(null)
  return (
    <>
      <Section title="Disputas de apertura" count={sessions.length} tone="warn">
        {sessions.map((s, i) => (
          <div key={s.id} style={{
            padding: '12px 14px',
            borderBottom: i < sessions.length - 1 ? `0.5px solid ${T.warn}33` : 'none',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: T.neutral[900] }}>
                {s.cashierName} · {s.branchName || 'Sin nombre'}
              </div>
              <div style={{ fontSize: 12, color: T.neutral[600], marginTop: 2 }}>
                Esperaba <b>{fmtCOP(s.openingDispute.expected)}</b> · recibió <b>{fmtCOP(s.openingDispute.declared)}</b>
              </div>
              <div style={{ fontSize: 12, color: T.bad, fontWeight: 600, marginTop: 2 }}>
                Diferencia: {fmtCOP(s.openingDispute.expected - s.openingDispute.declared)}
              </div>
            </div>
            <button onClick={() => setResolving(s)} style={btnSmall(T.warn)}>
              Resolver
            </button>
          </div>
        ))}
      </Section>

      {resolving && (
        <OpeningDisputeModal
          session={resolving}
          adminUid={adminUid}
          onCancel={() => setResolving(null)}
          onResolved={() => setResolving(null)}
        />
      )}
    </>
  )
}

function OpeningDisputeModal({ session, adminUid, onCancel, onResolved }) {
  const [resolution, setResolution] = useState(null) // 'accept' | 'reject'
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const d = session.openingDispute
  const diff = d.expected - d.declared

  async function handleConfirm() {
    if (!resolution || busy) return
    setBusy(true); setError(null)
    try {
      await resolveOpeningDispute(session.id, resolution, note.trim() || null, adminUid)
      onResolved()
    } catch (err) {
      console.error(err)
      setError('No pudimos guardar la decisión.')
      setBusy(false)
    }
  }

  return (
    <ModalOverlay onClose={busy ? undefined : onCancel}>
      <ModalCard>
        <ModalTitle>Disputa de apertura</ModalTitle>
        <ModalSub>
          {session.cashierName} · {session.branchName || 'Sin nombre'}
        </ModalSub>

        <div style={{
          padding: '14px', borderRadius: 12, background: T.neutral[50],
          marginBottom: 14,
        }}>
          <Row label="Cajera anterior entregó" value={fmtCOP(d.expected)} />
          <Row label="Cajera receptora dice haber recibido" value={fmtCOP(d.declared)} />
          <Row label="Diferencia" value={fmtCOP(diff)} highlight />
        </div>

        <RadioOption
          selected={resolution === 'accept'}
          onClick={() => setResolution('accept')}
          title="Aceptar declaración de la receptora"
          subtitle="Se cierra el caso. La cajera entregadora puede tener que justificar la diferencia."
        />
        <RadioOption
          selected={resolution === 'reject'}
          onClick={() => setResolution('reject')}
          title="Rechazar"
          subtitle="No estás de acuerdo con la receptora. Resuélvelo offline con ambas."
        />

        <NoteInput value={note} onChange={setNote} placeholder="Nota interna (opcional)" disabled={busy} />

        {error && <ErrorBox>{error}</ErrorBox>}

        <ModalActions
          onCancel={onCancel}
          onConfirm={handleConfirm}
          confirmLabel={busy ? 'Guardando...' : 'Confirmar'}
          confirmDisabled={!resolution || busy}
          confirmColor={T.copper[500]}
        />
      </ModalCard>
    </ModalOverlay>
  )
}

// ──────────────────────────────────────────────────────────────
// Cierres pendientes de aprobación (TODOS los cierres pasan por aquí)
// ──────────────────────────────────────────────────────────────
function PendingClosesSection({ sessions, adminUid, surplusBalance, allUsers }) {
  const [reviewing, setReviewing] = useState(null)
  return (
    <>
      <Section title="Cierres de turno por aprobar" count={sessions.length} tone="warn" defaultOpen>
        {sessions.map((s, i) => {
          const cd = s.closingDiscrepancy
          const hasShortage = cd?.type === 'shortage'
          const hasSurplus = cd?.type === 'surplus'
          return (
            <div key={s.id} style={{
              padding: '12px 14px',
              borderBottom: i < sessions.length - 1 ? `0.5px solid ${T.warn}33` : 'none',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: T.neutral[900] }}>
                  {s.cashierName} · {s.branchName || 'Sin nombre'}
                </div>
                <div style={{ fontSize: 12, color: T.neutral[600], marginTop: 2 }}>
                  Esperado <b>{fmtCOP(s.expectedCash || 0)}</b> · Declaró <b>{fmtCOP(s.declaredClosingCash || 0)}</b>
                </div>
                {hasShortage && (
                  <div style={{ fontSize: 12, color: T.bad, fontWeight: 700, marginTop: 2 }}>
                    Falta {fmtCOP(cd.amount)}
                  </div>
                )}
                {hasSurplus && (
                  <div style={{ fontSize: 12, color: T.ok, fontWeight: 700, marginTop: 2 }}>
                    Sobra {fmtCOP(cd.amount)} (al fondo si apruebas)
                  </div>
                )}
                {!cd && (
                  <div style={{ fontSize: 12, color: T.ok, fontWeight: 600, marginTop: 2 }}>
                    Cuadre exacto
                  </div>
                )}
              </div>
              <button onClick={() => setReviewing(s)} style={btnSmall(T.warn)}>
                Revisar
              </button>
            </div>
          )
        })}
      </Section>

      {reviewing && (
        <ApproveCloseModal
          session={reviewing}
          adminUid={adminUid}
          surplusBalance={surplusBalance}
          allUsers={allUsers}
          onCancel={() => setReviewing(null)}
          onResolved={() => setReviewing(null)}
        />
      )}
    </>
  )
}

function ApproveCloseModal({ session, adminUid, surplusBalance, allUsers, onCancel, onResolved }) {
  const cd = session.closingDiscrepancy
  const hasShortage = cd?.type === 'shortage'
  const hasSurplus = cd?.type === 'surplus'
  const amount = cd?.amount || 0
  const canCoverWithFund = surplusBalance >= amount

  const [resolution, setResolution] = useState(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // Si es exacto o sobra, no hay decisión que tomar
  const needsResolution = hasShortage
  const canConfirm = needsResolution ? !!resolution && !busy : !busy

  async function handleApprove() {
    if (!canConfirm) return
    setBusy(true); setError(null)
    try {
      let deductionId = null
      if (needsResolution && resolution === 'cashier_deduction') {
        const cashierUser = (allUsers || []).find(u => u.uid === session.cashierUid)
        const employeeId = cashierUser?.linkedEmployeeId || null
        deductionId = await createDeduction({
          cashierUid: session.cashierUid,
          cashierName: session.cashierName,
          employeeId,
          amount,
          reason: 'cash_shortage',
          sessionId: session.id,
          createdBy: adminUid,
        })
      }

      await approveSessionClose(session.id, {
        reviewedBy: adminUid,
        approveNote: note.trim() || null,
        resolution: needsResolution ? resolution : null,
        deductionId,
      })
      onResolved()
    } catch (err) {
      console.error(err)
      setError('No pudimos aprobar el cierre.')
      setBusy(false)
    }
  }

  // Hora apertura/cierre
  const opened = session.openedAt?.toDate?.()
  const closed = session.closedAt?.toDate?.()
  const fmtTime = (d) => d ? d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—'

  return (
    <ModalOverlay onClose={busy ? undefined : onCancel}>
      <ModalCard>
        <ModalTitle>Aprobar cierre de turno</ModalTitle>
        <ModalSub>
          {session.cashierName} · {session.branchName || 'Sin nombre'} · {fmtTime(opened)} → {fmtTime(closed)}
        </ModalSub>

        {/* Desglose */}
        <div style={{
          padding: '14px 16px', borderRadius: 12,
          background: T.neutral[50], marginBottom: 12,
        }}>
          <Row label="Apertura" value={fmtCOP(session.openingFloat || 0)} />
          <Row label="Esperado en caja" value={fmtCOP(session.expectedCash || 0)} />
          <Row label="Declarado por la cajera" value={fmtCOP(session.declaredClosingCash || 0)} />
          {hasShortage && (
            <div style={{ borderTop: `1px solid ${T.neutral[200]}`, marginTop: 6, paddingTop: 6 }}>
              <Row label="FALTA" value={fmtCOP(amount)} highlight />
            </div>
          )}
          {hasSurplus && (
            <div style={{ borderTop: `1px solid ${T.neutral[200]}`, marginTop: 6, paddingTop: 6 }}>
              <Row label="SOBRA" value={fmtCOP(amount)} highlight tone="ok" />
            </div>
          )}
        </div>

        {/* Handover info */}
        {session.handover && (
          <div style={{
            padding: '10px 14px', borderRadius: 12,
            background: T.copper[50], border: `1px solid ${T.copper[100]}`,
            marginBottom: 12,
          }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: T.copper[700], letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 4 }}>
              Entregó a {session.handover.type === 'admin' ? 'administrador' : 'cajera'}
            </div>
            <div style={{ fontSize: 13.5, color: T.copper[700], fontWeight: 600 }}>
              {session.handover.toName} · <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtCOP(session.handover.amount)}</span>
            </div>
          </div>
        )}

        {/* Nota de cajera */}
        {(session.closingNote || cd?.note) && (
          <div style={{
            padding: '10px 12px', borderRadius: 10,
            background: '#FFF7E6', border: `1px solid #F4E0BC`,
            fontSize: 12.5, color: T.neutral[700], fontStyle: 'italic',
            marginBottom: 12, lineHeight: 1.5,
          }}>
            <b style={{ fontStyle: 'normal', color: T.warn }}>Nota de la cajera:</b> "{cd?.note || session.closingNote}"
          </div>
        )}

        {/* Si es shortage: pide resolución */}
        {hasShortage && (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.neutral[600], marginBottom: 8 }}>
              ¿Qué hacer con la falta?
            </div>
            <RadioOption
              selected={resolution === 'business_loss'}
              onClick={() => setResolution('business_loss')}
              title="Asumir como pérdida del negocio"
              subtitle="No afecta a la cajera ni al fondo. Solo se registra."
            />
            <RadioOption
              selected={resolution === 'covered_by_fund'}
              onClick={() => canCoverWithFund && setResolution('covered_by_fund')}
              title="Cubrir con fondo de sobras"
              subtitle={canCoverWithFund
                ? `Disponible: ${fmtCOP(surplusBalance)}. Se descuentan ${fmtCOP(amount)}.`
                : `Saldo insuficiente (tienes ${fmtCOP(surplusBalance)}).`
              }
              disabled={!canCoverWithFund}
            />
            <RadioOption
              selected={resolution === 'cashier_deduction'}
              onClick={() => setResolution('cashier_deduction')}
              title="Descontar a la cajera"
              subtitle={`Se restará ${fmtCOP(amount)} del próximo pago de ${session.cashierName}.`}
            />
          </>
        )}

        {/* Si es exacto o sobra: solo aprobar */}
        {!hasShortage && (
          <div style={{
            padding: '12px 14px', borderRadius: 12,
            background: '#E8F4E8', border: `1px solid #C2DDC1`,
            fontSize: 12.5, color: T.ok, fontWeight: 600, lineHeight: 1.5,
            marginBottom: 12,
          }}>
            {hasSurplus
              ? `Al aprobar, ${fmtCOP(amount)} se sumarán al fondo de sobras y la panadería quedará libre.`
              : 'Al aprobar, la panadería quedará libre para nuevo turno.'}
          </div>
        )}

        <NoteInput value={note} onChange={setNote} placeholder="Nota interna (opcional)" disabled={busy} />

        {error && <ErrorBox>{error}</ErrorBox>}

        <ModalActions
          onCancel={onCancel}
          onConfirm={handleApprove}
          confirmLabel={busy ? 'Aprobando...' : 'Aprobar cierre'}
          confirmDisabled={!canConfirm}
          confirmColor={T.ok}
        />
      </ModalCard>
    </ModalOverlay>
  )
}

// ──────────────────────────────────────────────────────────────
// Faltas de cierre (LEGACY: solo para sesiones cerradas antes del cambio)
// ──────────────────────────────────────────────────────────────
function ClosingShortagesSection({ sessions, adminUid, surplusBalance, allUsers }) {
  const [resolving, setResolving] = useState(null)
  return (
    <>
      <Section title="Faltas al cerrar caja" count={sessions.length} tone="bad">
        {sessions.map((s, i) => (
          <div key={s.id} style={{
            padding: '12px 14px',
            borderBottom: i < sessions.length - 1 ? `0.5px solid ${T.bad}33` : 'none',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: T.neutral[900] }}>
                {s.cashierName} · {s.branchName || 'Sin nombre'}
              </div>
              <div style={{ fontSize: 12, color: T.bad, fontWeight: 700, marginTop: 2 }}>
                Falta {fmtCOP(s.closingDiscrepancy.amount)}
              </div>
              {s.closingDiscrepancy.note && (
                <div style={{ fontSize: 11.5, color: T.neutral[600], marginTop: 4, fontStyle: 'italic' }}>
                  "{s.closingDiscrepancy.note}"
                </div>
              )}
            </div>
            <button onClick={() => setResolving(s)} style={btnSmall(T.bad)}>
              Resolver
            </button>
          </div>
        ))}
      </Section>

      {resolving && (
        <ClosingShortageModal
          session={resolving}
          adminUid={adminUid}
          surplusBalance={surplusBalance}
          allUsers={allUsers}
          onCancel={() => setResolving(null)}
          onResolved={() => setResolving(null)}
        />
      )}
    </>
  )
}

function ClosingShortageModal({ session, adminUid, surplusBalance, allUsers, onCancel, onResolved }) {
  const [resolution, setResolution] = useState(null) // 'business_loss' | 'covered_by_fund' | 'cashier_deduction'
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const cd = session.closingDiscrepancy
  const amount = cd.amount
  const canCoverWithFund = surplusBalance >= amount

  async function handleConfirm() {
    if (!resolution || busy) return
    setBusy(true); setError(null)
    try {
      let deductionId = null
      if (resolution === 'cashier_deduction') {
        // Buscar el employeeId vinculado al user de la cajera
        const cashierUser = (allUsers || []).find(u => u.uid === session.cashierUid)
        const employeeId = cashierUser?.linkedEmployeeId || null
        deductionId = await createDeduction({
          cashierUid: session.cashierUid,
          cashierName: session.cashierName,
          employeeId,
          amount,
          reason: 'cash_shortage',
          sessionId: session.id,
          createdBy: adminUid,
        })
      }

      await resolveClosingDiscrepancy(session.id, {
        resolution,
        note: note.trim() || null,
        reviewedBy: adminUid,
        deductionId,
      })
      onResolved()
    } catch (err) {
      console.error(err)
      setError('No pudimos guardar la decisión.')
      setBusy(false)
    }
  }

  return (
    <ModalOverlay onClose={busy ? undefined : onCancel}>
      <ModalCard>
        <ModalTitle>Falta de caja</ModalTitle>
        <ModalSub>
          {session.cashierName} · {session.branchName || 'Sin nombre'}
        </ModalSub>

        <div style={{
          padding: '14px', borderRadius: 12, background: '#FBE9E5', border: `1px solid #F0C8BE`,
          marginBottom: 14,
        }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: T.bad, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 }}>
            Falta
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, color: T.bad, fontVariantNumeric: 'tabular-nums', letterSpacing: -0.5 }}>
            {fmtCOP(amount)}
          </div>
          {cd.note && (
            <div style={{ fontSize: 12.5, color: T.neutral[700], marginTop: 8, fontStyle: 'italic' }}>
              Nota de la cajera: "{cd.note}"
            </div>
          )}
        </div>

        <div style={{ fontSize: 12, fontWeight: 700, color: T.neutral[600], marginBottom: 8 }}>
          ¿Qué hacer con la diferencia?
        </div>

        <RadioOption
          selected={resolution === 'business_loss'}
          onClick={() => setResolution('business_loss')}
          title="Asumir como pérdida del negocio"
          subtitle="No afecta a la cajera ni al fondo. Solo se registra."
        />
        <RadioOption
          selected={resolution === 'covered_by_fund'}
          onClick={() => canCoverWithFund && setResolution('covered_by_fund')}
          title="Cubrir con fondo de sobras"
          subtitle={canCoverWithFund
            ? `Disponible: ${fmtCOP(surplusBalance)}. Se descuentan ${fmtCOP(amount)}.`
            : `Saldo insuficiente (tienes ${fmtCOP(surplusBalance)}).`
          }
          disabled={!canCoverWithFund}
        />
        <RadioOption
          selected={resolution === 'cashier_deduction'}
          onClick={() => setResolution('cashier_deduction')}
          title="Descontar a la cajera"
          subtitle={`Se restará ${fmtCOP(amount)} del próximo pago de ${session.cashierName}.`}
        />

        <NoteInput value={note} onChange={setNote} placeholder="Nota interna (opcional)" disabled={busy} />

        {error && <ErrorBox>{error}</ErrorBox>}

        <ModalActions
          onCancel={onCancel}
          onConfirm={handleConfirm}
          confirmLabel={busy ? 'Guardando...' : 'Confirmar'}
          confirmDisabled={!resolution || busy}
          confirmColor={T.copper[500]}
        />
      </ModalCard>
    </ModalOverlay>
  )
}

// ──────────────────────────────────────────────────────────────
// Gastos de caja pendientes
// ──────────────────────────────────────────────────────────────
function CashExpensesSection({ expenses, adminUid }) {
  const [reviewing, setReviewing] = useState(null)
  return (
    <>
      <Section title="Gastos de caja" count={expenses.length} tone="warn">
        {expenses.map((e, i) => (
          <div key={e.id} style={{
            padding: '12px 14px',
            borderBottom: i < expenses.length - 1 ? `0.5px solid ${T.warn}33` : 'none',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 13.5, fontWeight: 700, color: T.neutral[900],
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {e.description}
              </div>
              <div style={{ fontSize: 11.5, color: T.neutral[500], marginTop: 2 }}>
                {e.cashierName} · {e.branchName || 'Sin nombre'}
              </div>
            </div>
            <div style={{ fontSize: 14, fontWeight: 800, color: T.neutral[900], fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
              {fmtCOP(e.amount)}
            </div>
            <button onClick={() => setReviewing(e)} style={btnSmall(T.warn)}>
              Revisar
            </button>
          </div>
        ))}
      </Section>

      {reviewing && (
        <CashExpenseModal
          expense={reviewing}
          adminUid={adminUid}
          onCancel={() => setReviewing(null)}
          onResolved={() => setReviewing(null)}
        />
      )}
    </>
  )
}

function CashExpenseModal({ expense, adminUid, onCancel, onResolved }) {
  const [action, setAction] = useState(null) // 'approve' | 'reject'
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function handleConfirm() {
    if (!action || busy) return
    setBusy(true); setError(null)
    try {
      if (action === 'approve') {
        // Crear movement de tipo gasto + aprobar el cashExpense con su id
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
        const movementId = addMovement({
          type: 'expense',
          amount: expense.amount,
          date: today,
          note: expense.description,
          cat: 'otros_prov',                 // categoría por defecto; admin la puede ajustar después
          branch: expense.branchId || 'both',
          origin: 'caja',
          sessionId: expense.sessionId || null,
          cashierName: expense.cashierName,
        })
        await approveCashExpense(expense.id, { reviewedBy: adminUid, movementId })
      } else {
        if (note.trim().length < 5) {
          setError('Escribe al menos 5 caracteres explicando el rechazo.')
          setBusy(false)
          return
        }
        await rejectCashExpense(expense.id, { reviewedBy: adminUid, reviewNote: note.trim() })
      }
      onResolved()
    } catch (err) {
      console.error(err)
      setError('No pudimos guardar la decisión.')
      setBusy(false)
    }
  }

  return (
    <ModalOverlay onClose={busy ? undefined : onCancel}>
      <ModalCard>
        <ModalTitle>Gasto de caja</ModalTitle>
        <ModalSub>
          {expense.cashierName} · {expense.branchName || 'Sin nombre'}
        </ModalSub>

        <div style={{
          padding: '14px', borderRadius: 12, background: T.neutral[50],
          marginBottom: 14,
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.neutral[900], marginBottom: 4 }}>
            {expense.description}
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: T.neutral[900], fontVariantNumeric: 'tabular-nums' }}>
            {fmtCOP(expense.amount)}
          </div>
          {expense.photoUrl && (
            <a href={expense.photoUrl} target="_blank" rel="noreferrer" style={{
              display: 'inline-block', marginTop: 8,
              fontSize: 12, color: T.copper[600], textDecoration: 'underline', fontWeight: 600,
            }}>
              📎 Ver foto del recibo
            </a>
          )}
        </div>

        <RadioOption
          selected={action === 'approve'}
          onClick={() => setAction('approve')}
          title="Aprobar"
          subtitle="Se crea un movimiento de gasto que aparece en Reportes."
        />
        <RadioOption
          selected={action === 'reject'}
          onClick={() => setAction('reject')}
          title="Rechazar"
          subtitle="La cajera ve la nota explicativa. La plata salió igual; tú decides cómo manejarlo offline."
        />

        {action === 'reject' && (
          <NoteInput
            value={note}
            onChange={setNote}
            placeholder="Explica por qué rechazas (mínimo 5 caracteres)..."
            disabled={busy}
            required
          />
        )}

        {error && <ErrorBox>{error}</ErrorBox>}

        <ModalActions
          onCancel={onCancel}
          onConfirm={handleConfirm}
          confirmLabel={busy ? 'Guardando...' : (action === 'approve' ? 'Aprobar' : action === 'reject' ? 'Rechazar' : 'Confirmar')}
          confirmDisabled={!action || busy}
          confirmColor={action === 'reject' ? T.bad : T.ok}
        />
      </ModalCard>
    </ModalOverlay>
  )
}

// ──────────────────────────────────────────────────────────────
// Ventas marcadas (flagged)
// ──────────────────────────────────────────────────────────────
function FlaggedSalesSection({ sales, adminUid }) {
  const [reviewing, setReviewing] = useState(null)
  return (
    <>
      <Section title="Ventas marcadas con problema" count={sales.length} tone="warn">
        {sales.map((s, i) => (
          <div key={s.id} style={{
            padding: '12px 14px',
            borderBottom: i < sales.length - 1 ? `0.5px solid ${T.warn}33` : 'none',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: T.neutral[900] }}>
                {s.cashierName} · {fmtCOP(s.total)}
              </div>
              <div style={{ fontSize: 11.5, color: T.neutral[500], marginTop: 2 }}>
                {s.items?.length || 0} producto(s) · {s.paymentMethod}
              </div>
              {s.notes?.[0]?.message && (
                <div style={{ fontSize: 11.5, color: T.neutral[700], marginTop: 4, fontStyle: 'italic' }}>
                  "{s.notes[0].message}"
                </div>
              )}
            </div>
            <button onClick={() => setReviewing(s)} style={btnSmall(T.warn)}>
              Revisar
            </button>
          </div>
        ))}
      </Section>

      {reviewing && (
        <FlaggedSaleModal
          sale={reviewing}
          adminUid={adminUid}
          onCancel={() => setReviewing(null)}
          onResolved={() => setReviewing(null)}
        />
      )}
    </>
  )
}

function FlaggedSaleModal({ sale, adminUid, onCancel, onResolved }) {
  const [action, setAction] = useState(null) // 'reviewed' | 'delete'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function handleConfirm() {
    if (!action || busy) return
    setBusy(true); setError(null)
    try {
      const ref = doc(firestoreDb, 'sales', sale.id)
      if (action === 'reviewed') {
        await updateDoc(ref, { status: 'active' })
      } else {
        await updateDoc(ref, { status: 'deleted', deletedAt: new Date(), deletedBy: adminUid })
      }
      onResolved()
    } catch (err) {
      console.error(err)
      setError('No pudimos guardar la decisión.')
      setBusy(false)
    }
  }

  return (
    <ModalOverlay onClose={busy ? undefined : onCancel}>
      <ModalCard>
        <ModalTitle>Venta marcada</ModalTitle>
        <ModalSub>{sale.cashierName} · {fmtCOP(sale.total)}</ModalSub>

        <div style={{
          padding: '12px', borderRadius: 12, background: T.neutral[50],
          marginBottom: 14, maxHeight: 160, overflowY: 'auto',
        }}>
          {sale.items?.map((it, i) => (
            <div key={i} style={{ fontSize: 12.5, color: T.neutral[700], padding: '3px 0', display: 'flex', justifyContent: 'space-between' }}>
              <span>{it.qty}× {it.name}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtCOP(it.subtotal)}</span>
            </div>
          ))}
        </div>

        {sale.notes?.length > 0 && (
          <div style={{
            padding: '10px 12px', borderRadius: 10, background: '#FFF7E6',
            border: `1px solid #F4E0BC`, marginBottom: 14,
          }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: T.warn, marginBottom: 4, letterSpacing: 0.4, textTransform: 'uppercase' }}>
              Notas de la cajera
            </div>
            {sale.notes.map((n, i) => (
              <div key={i} style={{ fontSize: 12.5, color: T.neutral[700], marginTop: 4, fontStyle: 'italic' }}>
                "{n.message}"
              </div>
            ))}
          </div>
        )}

        <RadioOption
          selected={action === 'reviewed'}
          onClick={() => setAction('reviewed')}
          title="Marcar como revisado"
          subtitle="La venta queda activa, sin más acción. Las notas se conservan."
        />
        <RadioOption
          selected={action === 'delete'}
          onClick={() => setAction('delete')}
          title="Eliminar venta"
          subtitle="Se marca como eliminada. No aparecerá en reportes pero queda en el histórico."
        />

        {error && <ErrorBox>{error}</ErrorBox>}

        <ModalActions
          onCancel={onCancel}
          onConfirm={handleConfirm}
          confirmLabel={busy ? 'Guardando...' : 'Confirmar'}
          confirmDisabled={!action || busy}
          confirmColor={action === 'delete' ? T.bad : T.ok}
        />
      </ModalCard>
    </ModalOverlay>
  )
}

// ──────────────────────────────────────────────────────────────
// Componentes utilitarios compartidos
// ──────────────────────────────────────────────────────────────
function btnSmall(color) {
  return {
    padding: '7px 12px', borderRadius: 10,
    background: color, color: '#fff',
    border: 'none', cursor: 'pointer', fontFamily: 'inherit',
    fontSize: 12.5, fontWeight: 700, flexShrink: 0,
    boxShadow: `0 2px 6px ${color}44`,
  }
}

function Row({ label, value, highlight, tone }) {
  const highlightColor = tone === 'ok' ? T.ok : T.bad
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      padding: '4px 0', gap: 8,
    }}>
      <span style={{
        fontSize: highlight ? 11.5 : 12.5,
        color: highlight ? highlightColor : T.neutral[600],
        fontWeight: highlight ? 700 : 500,
        letterSpacing: highlight ? 0.5 : 0,
        textTransform: highlight ? 'uppercase' : 'none',
      }}>
        {label}
      </span>
      <span style={{
        fontSize: highlight ? 16 : 14, fontWeight: highlight ? 800 : 600,
        color: highlight ? highlightColor : T.neutral[900],
        fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </span>
    </div>
  )
}

function RadioOption({ selected, onClick, title, subtitle, disabled }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        width: '100%', padding: '12px 14px', borderRadius: 12,
        background: selected ? T.copper[50] : '#fff',
        border: `1.5px solid ${selected ? T.copper[400] : T.neutral[200]}`,
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit', textAlign: 'left',
        marginBottom: 8, opacity: disabled ? 0.5 : 1,
        display: 'flex', alignItems: 'center', gap: 10,
      }}
    >
      <div style={{
        width: 18, height: 18, borderRadius: 999, flexShrink: 0,
        border: `2px solid ${selected ? T.copper[500] : T.neutral[300]}`,
        background: selected ? T.copper[500] : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {selected && (
          <svg width="9" height="9" viewBox="0 0 9 9">
            <path d="M2 4.5 L4 6 L7 3" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: T.neutral[900] }}>{title}</div>
        {subtitle && (
          <div style={{ fontSize: 11.5, color: T.neutral[500], marginTop: 2, lineHeight: 1.4 }}>
            {subtitle}
          </div>
        )}
      </div>
    </button>
  )
}

function NoteInput({ value, onChange, placeholder, disabled, required }) {
  const [focused, setFocused] = useState(false)
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{
        border: `1.5px solid ${focused ? T.copper[400] : T.neutral[200]}`,
        borderRadius: 12, background: '#fff',
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
            width: '100%', padding: '10px 12px', border: 'none', outline: 'none',
            fontFamily: 'inherit', fontSize: 13.5, color: T.neutral[900],
            background: 'transparent', borderRadius: 12, resize: 'vertical',
            minHeight: 60,
          }}
        />
      </div>
    </div>
  )
}

function ErrorBox({ children }) {
  return (
    <div style={{
      marginBottom: 10, padding: '10px 12px', borderRadius: 10,
      background: '#FBE9E5', border: `1px solid #F0C8BE`, color: T.bad,
      fontSize: 12.5, fontWeight: 500, textAlign: 'center',
    }}>
      {children}
    </div>
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

function ModalCard({ children }) {
  return (
    <div onClick={e => e.stopPropagation()} style={{
      width: '100%', maxWidth: 460, background: '#fff', borderRadius: 22,
      padding: '24px 22px 22px', boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
      animation: 'fadeScaleIn 0.2s ease',
      maxHeight: '94vh', overflowY: 'auto',
    }}>
      {children}
    </div>
  )
}

function ModalTitle({ children }) {
  return (
    <div style={{ fontSize: 18, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3 }}>
      {children}
    </div>
  )
}
function ModalSub({ children }) {
  return (
    <div style={{ fontSize: 12.5, color: T.neutral[500], marginTop: 2, marginBottom: 16 }}>
      {children}
    </div>
  )
}

function ModalActions({ onCancel, onConfirm, confirmLabel, confirmDisabled, confirmColor }) {
  return (
    <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
      <button onClick={onCancel} style={{
        flex: 1, padding: '12px', borderRadius: 12,
        background: T.neutral[100], color: T.neutral[700],
        border: 'none', cursor: 'pointer', fontFamily: 'inherit',
        fontSize: 14, fontWeight: 700,
      }}>
        Cancelar
      </button>
      <button
        onClick={onConfirm}
        disabled={confirmDisabled}
        style={{
          flex: 1.4, padding: '12px', borderRadius: 12,
          background: confirmDisabled ? T.neutral[200] : confirmColor, color: '#fff',
          border: 'none', cursor: confirmDisabled ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
          boxShadow: confirmDisabled ? 'none' : `0 3px 10px ${confirmColor}44`,
          opacity: confirmDisabled ? 0.6 : 1,
        }}
      >
        {confirmLabel}
      </button>
    </div>
  )
}

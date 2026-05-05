import { useEffect, useMemo, useState } from 'react'
import { T } from '../tokens'
import { fmtCOP } from '../utils/format'
import { Card, UserAvatar } from '../components/Atoms'
import { ScreenHeader } from '../components/Nav'
import { useAuth } from '../context/AuthCtx'

import { watchAllUsers } from '../users'
import {
  watchSessionsWithPendingReview,
  resolveOpeningDispute,
  resolveClosingDiscrepancy,
  approveSessionClose,
} from '../cashSessions'
import {
  watchSessionExpenses,
  approveCashExpense,
  rejectCashExpense,
} from '../cashExpenses'
import { watchAllSales, watchSessionSales } from '../sales'
import { createDeduction } from '../cashierDeductions'
import { watchCashierProducts, deleteCashierProduct, patchCashierProduct } from '../products'
import {
  watchPendingChangeRequests,
  approveChangeRequest,
  rejectChangeRequest,
} from '../productChangeRequests'
import { addMovement, getData, getBogotaHour, getBogotaDateStr, isDayConfirmed, toggleReminderPaid } from '../db'
import { doc, updateDoc } from 'firebase/firestore'
import { firestoreDb } from '../firebase'

export default function Pendientes({ onOpenUsers, onOpenProducts, onOpenReminders, onConfirmAttendance, dataTick }) {
  const { authUser } = useAuth()

  const [pendingUsers, setPendingUsers] = useState([])
  const [allUsers, setAllUsers] = useState([])
  const [pendingSessions, setPendingSessions] = useState([])
  const [allSales, setAllSales] = useState([])
  const [cashierProducts, setCashierProducts] = useState([])
  const [changeRequests, setChangeRequests] = useState([])

  useEffect(() => watchAllUsers(list => {
    setAllUsers(list)
    setPendingUsers(list.filter(u => u.status === 'pending'))
  }), [])
  useEffect(() => watchSessionsWithPendingReview(setPendingSessions), [])
  useEffect(() => watchAllSales(setAllSales), [])
  useEffect(() => watchCashierProducts(setCashierProducts), [])
  useEffect(() => watchPendingChangeRequests(setChangeRequests), [])

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
    flaggedSales.length +
    cashierProducts.length +
    changeRequests.length +
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
          allUsers={allUsers}
        />
      )}

      {orphanShortages.length > 0 && (
        <ClosingShortagesSection
          sessions={orphanShortages}
          adminUid={authUser.uid}
          allUsers={allUsers}
        />
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

      {changeRequests.length > 0 && (
        <ChangeRequestsSection requests={changeRequests} adminUid={authUser.uid} />
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
                {(() => {
                  const branches = getData().branches || []
                  const items = branches
                    .map(b => {
                      const v = p.pricesByBranch?.[String(b.id)]
                      return v && Number(v) > 0
                        ? `${b.name}: ${fmtCOP(Number(v))}`
                        : null
                    })
                    .filter(Boolean)
                  return items.length > 0
                    ? items.join(' · ')
                    : <span style={{ fontStyle: 'italic' }}>sin precios todavía</span>
                })()}
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
        {/* Header clickeable (div role=button para permitir botones internos) */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setOpen(o => !o)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o) } }}
          style={{
            width: '100%', padding: '14px 16px',
            cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', gap: 12,
            textAlign: 'left',
            userSelect: 'none',
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
        </div>

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
function PendingClosesSection({ sessions, adminUid, allUsers }) {
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
                    Sobra {fmtCOP(cd.amount)} (se registra como ingreso)
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
          allUsers={allUsers}
          onCancel={() => setReviewing(null)}
          onResolved={() => setReviewing(null)}
        />
      )}
    </>
  )
}

function ApproveCloseModal({ session, adminUid, allUsers, onCancel, onResolved }) {
  // Cargar ventas y gastos del turno en vivo
  const [sales, setSales] = useState([])
  const [expenses, setExpenses] = useState([])
  useEffect(() => watchSessionSales(session.id, setSales), [session.id])
  useEffect(() => watchSessionExpenses(session.id, setExpenses), [session.id])

  // Decisiones tentativas del admin sobre los gastos pendientes:
  //   { [expenseId]: 'approve' | 'reject' }
  // Se aplican al confirmar el cierre.
  const [expenseDecisions, setExpenseDecisions] = useState({})

  const [resolution, setResolution] = useState(null) // para shortage
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // ── Cálculos en vivo ──
  const activeSales = useMemo(
    () => sales.filter(s => (s.status || 'active') !== 'deleted'),
    [sales]
  )
  const salesByMethod = useMemo(() => {
    const acc = { efectivo: 0, nequi: 0, daviplata: 0, deuda: 0 }
    activeSales.forEach(s => {
      const m = s.paymentMethod || 'efectivo'
      acc[m] = (acc[m] || 0) + (Number(s.total) || 0)
    })
    return acc
  }, [activeSales])
  const totalSales = activeSales.reduce((acc, s) => acc + (Number(s.total) || 0), 0)

  // Estado efectivo de cada gasto considerando decisiones tentativas
  function effectiveStatus(exp) {
    if (exp.status === 'approved' || exp.status === 'rejected') return exp.status
    const dec = expenseDecisions[exp.id]
    if (dec === 'approve') return 'approved'
    if (dec === 'reject') return 'rejected'
    return 'pending'
  }
  const approvedExpenseTotal = expenses.reduce((acc, e) =>
    effectiveStatus(e) === 'approved' ? acc + (Number(e.amount) || 0) : acc, 0
  )
  const pendingExpensesCount = expenses.filter(e => effectiveStatus(e) === 'pending').length

  // EXPECTED en caja = apertura + ventas en EFECTIVO − gastos aprobados
  const openingFloat = Number(session.openingFloat) || 0
  const declared = Number(session.declaredClosingCash) || 0
  const expectedCash = openingFloat + (salesByMethod.efectivo || 0) - approvedExpenseTotal
  const difference = declared - expectedCash
  const hasShortage = difference < 0
  const hasSurplus = difference > 0
  const isExact = difference === 0

  function setDecision(expenseId, decision) {
    setExpenseDecisions(prev => ({ ...prev, [expenseId]: decision }))
  }

  // Bloqueos para confirmar
  const canConfirm = !busy
    && pendingExpensesCount === 0   // no debe quedar ningún gasto sin decidir
    && (!hasShortage || !!resolution) // si hay falta, resolution requerida

  async function handleApprove() {
    if (!canConfirm) return
    setBusy(true); setError(null)
    try {
      // 1. Aplicar decisiones de gastos pendientes (las que el admin tomó en este modal)
      for (const exp of expenses) {
        if (exp.status !== 'pending') continue
        const dec = expenseDecisions[exp.id]
        if (dec === 'approve') {
          const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
          const movementId = addMovement({
            type: 'expense',
            amount: exp.amount,
            date: today,
            note: exp.description,
            cat: 'otros_prov',
            branch: exp.branchId || 'both',
            origin: 'caja',
            sessionId: exp.sessionId || null,
            cashierName: exp.cashierName,
          })
          await approveCashExpense(exp.id, { reviewedBy: adminUid, movementId })
        } else if (dec === 'reject') {
          await rejectCashExpense(exp.id, { reviewedBy: adminUid, reviewNote: null })
        }
      }

      // 2. Si hay falta a descontar a la cajera, crear la deduction
      let deductionId = null
      if (hasShortage && resolution === 'cashier_deduction') {
        const cashierUser = (allUsers || []).find(u => u.uid === session.cashierUid)
        const employeeId = cashierUser?.linkedEmployeeId || null
        deductionId = await createDeduction({
          cashierUid: session.cashierUid,
          cashierName: session.cashierName,
          employeeId,
          amount: Math.abs(difference),
          reason: 'cash_shortage',
          sessionId: session.id,
          createdBy: adminUid,
        })
      }

      // 3. Aprobar el cierre con el expectedCash calculado
      await approveSessionClose(session.id, {
        reviewedBy: adminUid,
        expectedCash,
        approveNote: note.trim() || null,
        resolution: hasShortage ? resolution : null,
        deductionId,
        session,
      })
      onResolved()
    } catch (err) {
      console.error(err)
      setError('No pudimos aprobar el cierre. Intenta de nuevo.')
      setBusy(false)
    }
  }

  const opened = session.openedAt?.toDate?.()
  const closed = session.closedAt?.toDate?.()
  const fmtTime = (d) => d ? d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Bogota' }) : '—'

  return (
    <ModalOverlay onClose={busy ? undefined : onCancel}>
      <ModalCard>
        <ModalTitle>Aprobar cierre de turno</ModalTitle>
        <ModalSub>
          {session.cashierName} · {session.branchName || 'Sin nombre'} · {fmtTime(opened)} → {fmtTime(closed)}
        </ModalSub>

        {/* Apertura */}
        <SectionLabel>Apertura</SectionLabel>
        <Row label="Float inicial" value={fmtCOP(openingFloat)} />

        {/* Ventas del turno por método */}
        <SectionLabel>Ventas del turno · {fmtCOP(totalSales)}</SectionLabel>
        <div style={{
          padding: '10px 14px', borderRadius: 12,
          background: T.neutral[50], marginBottom: 14,
        }}>
          <Row label="Efectivo (a caja)" value={fmtCOP(salesByMethod.efectivo || 0)} />
          <Row label="Nequi" value={fmtCOP(salesByMethod.nequi || 0)} muted />
          <Row label="Daviplata" value={fmtCOP(salesByMethod.daviplata || 0)} muted />
          <Row label="Deuda" value={fmtCOP(salesByMethod.deuda || 0)} muted />
        </div>

        {/* Gastos del turno */}
        <SectionLabel>
          Gastos del turno {expenses.length > 0 && `· ${expenses.length}`}
          {pendingExpensesCount > 0 && (
            <span style={{ color: T.warn, marginLeft: 6 }}>
              ({pendingExpensesCount} sin decidir)
            </span>
          )}
        </SectionLabel>
        {expenses.length === 0 ? (
          <div style={{
            padding: '10px 14px', borderRadius: 12, background: T.neutral[50],
            fontSize: 12, color: T.neutral[500], marginBottom: 14, textAlign: 'center',
          }}>
            Sin gastos en este turno
          </div>
        ) : (
          <div style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {expenses.map(e => (
              <ExpenseRow
                key={e.id}
                expense={e}
                effectiveStatus={effectiveStatus(e)}
                onApprove={() => setDecision(e.id, 'approve')}
                onReject={() => setDecision(e.id, 'reject')}
                disabled={busy}
              />
            ))}
          </div>
        )}

        {/* Cuadre */}
        <SectionLabel>Cuadre de caja</SectionLabel>
        <div style={{
          padding: '14px 16px', borderRadius: 12,
          background: T.neutral[50], marginBottom: 12,
        }}>
          <Row label="Esperado en caja" value={fmtCOP(expectedCash)} />
          <Row label="Declarado por la cajera" value={fmtCOP(declared)} />
          <div style={{ borderTop: `1px solid ${T.neutral[200]}`, marginTop: 6, paddingTop: 6 }}>
            {isExact && <Row label="✓ CUADRE EXACTO" value={fmtCOP(0)} highlight tone="ok" />}
            {hasSurplus && <Row label="SOBRA" value={fmtCOP(Math.abs(difference))} highlight tone="ok" />}
            {hasShortage && <Row label="FALTA" value={fmtCOP(Math.abs(difference))} highlight />}
          </div>
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
        {session.closingNote && (
          <div style={{
            padding: '10px 12px', borderRadius: 10,
            background: '#FFF7E6', border: `1px solid #F4E0BC`,
            fontSize: 12.5, color: T.neutral[700], fontStyle: 'italic',
            marginBottom: 12, lineHeight: 1.5,
          }}>
            <b style={{ fontStyle: 'normal', color: T.warn }}>Nota de la cajera:</b> "{session.closingNote}"
          </div>
        )}

        {/* Si hay FALTA: pide resolución */}
        {hasShortage && (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.neutral[600], marginBottom: 8 }}>
              ¿Qué hacer con la falta de {fmtCOP(Math.abs(difference))}?
            </div>
            <RadioOption
              selected={resolution === 'business_loss'}
              onClick={() => setResolution('business_loss')}
              title="Asumir como pérdida del negocio"
              subtitle="No afecta a la cajera. Solo se registra."
            />
            <RadioOption
              selected={resolution === 'cashier_deduction'}
              onClick={() => setResolution('cashier_deduction')}
              title="Descontar a la cajera"
              subtitle={`Se restará ${fmtCOP(Math.abs(difference))} del próximo pago de ${session.cashierName}.`}
            />
          </>
        )}

        {/* Si hay SOBRA */}
        {hasSurplus && (
          <div style={{
            padding: '12px 14px', borderRadius: 12,
            background: '#E8F4E8', border: `1px solid #C2DDC1`,
            fontSize: 12.5, color: T.ok, fontWeight: 600, lineHeight: 1.5,
            marginBottom: 12,
          }}>
            Al aprobar, se registrará un ingreso de {fmtCOP(Math.abs(difference))} como "Sobra de cierre".
          </div>
        )}

        <NoteInput value={note} onChange={setNote} placeholder="Nota interna (opcional)" disabled={busy} />

        {pendingExpensesCount > 0 && (
          <div style={{
            margin: '0 0 10px', padding: '10px 12px', borderRadius: 10,
            background: '#FFF7E6', border: `1px solid #F4E0BC`, color: T.warn,
            fontSize: 12.5, fontWeight: 600, textAlign: 'center',
          }}>
            Decide aprobar o rechazar todos los gastos antes de cerrar.
          </div>
        )}

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

// Pequeño label para secciones del modal
function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, color: T.neutral[500],
      textTransform: 'uppercase', letterSpacing: 0.5,
      marginBottom: 6, marginTop: 4,
    }}>
      {children}
    </div>
  )
}

// Fila de gasto con botones aprobar/rechazar inline
function ExpenseRow({ expense, effectiveStatus, onApprove, onReject, disabled }) {
  const isApproved = effectiveStatus === 'approved'
  const isRejected = effectiveStatus === 'rejected'
  const isPending = effectiveStatus === 'pending'
  const wasFinal = expense.status === 'approved' || expense.status === 'rejected'

  return (
    <div style={{
      padding: '10px 12px', borderRadius: 10,
      background: isApproved ? '#E8F4E8' : isRejected ? '#FBE9E5' : T.neutral[50],
      border: `1px solid ${isApproved ? '#C2DDC1' : isRejected ? '#F0C8BE' : T.neutral[100]}`,
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 700, color: T.neutral[900],
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {expense.description}
        </div>
        <div style={{ fontSize: 11.5, color: T.neutral[500], marginTop: 2 }}>
          {fmtCOP(expense.amount)}
          {expense.photoUrl && (
            <a href={expense.photoUrl} target="_blank" rel="noreferrer" style={{
              marginLeft: 8, color: T.copper[600], fontWeight: 600,
              textDecoration: 'underline', fontSize: 11,
            }}>
              📎 ver foto
            </a>
          )}
        </div>
      </div>
      {isPending && (
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button onClick={onReject} disabled={disabled} style={{
            padding: '6px 10px', borderRadius: 8,
            background: 'transparent', color: T.bad,
            border: `1px solid ${T.bad}55`,
            cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
            fontSize: 11.5, fontWeight: 700,
          }}>
            Rechazar
          </button>
          <button onClick={onApprove} disabled={disabled} style={{
            padding: '6px 10px', borderRadius: 8,
            background: T.ok, color: '#fff',
            border: 'none',
            cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
            fontSize: 11.5, fontWeight: 700,
          }}>
            Aprobar
          </button>
        </div>
      )}
      {isApproved && !wasFinal && (
        <span style={{
          padding: '4px 9px', borderRadius: 999,
          background: T.ok, color: '#fff',
          fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase',
          flexShrink: 0,
        }}>
          ✓ Aprobado
        </span>
      )}
      {isRejected && !wasFinal && (
        <span style={{
          padding: '4px 9px', borderRadius: 999,
          background: T.bad, color: '#fff',
          fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase',
          flexShrink: 0,
        }}>
          ✗ Rechazado
        </span>
      )}
      {wasFinal && (
        <span style={{
          padding: '4px 9px', borderRadius: 999,
          background: T.neutral[100], color: T.neutral[600],
          fontSize: 10.5, fontWeight: 600, letterSpacing: 0.3, textTransform: 'uppercase',
          flexShrink: 0,
        }}>
          {isApproved ? 'Aprobado antes' : 'Rechazado antes'}
        </span>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Faltas de cierre (LEGACY: solo para sesiones cerradas antes del cambio)
// ──────────────────────────────────────────────────────────────
function ClosingShortagesSection({ sessions, adminUid, allUsers }) {
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
          allUsers={allUsers}
          onCancel={() => setResolving(null)}
          onResolved={() => setResolving(null)}
        />
      )}
    </>
  )
}

function ClosingShortageModal({ session, adminUid, allUsers, onCancel, onResolved }) {
  const [resolution, setResolution] = useState(null) // 'business_loss' | 'cashier_deduction'
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const cd = session.closingDiscrepancy
  const amount = cd.amount

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
          subtitle="No afecta a la cajera. Solo se registra."
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
// Solicitudes de cambio de productos (cajera → admin)
// ──────────────────────────────────────────────────────────────
function ChangeRequestsSection({ requests, adminUid }) {
  const [reviewing, setReviewing] = useState(null)
  return (
    <>
      <Section title="Solicitudes de cambio en productos" count={requests.length} tone="copper">
        {requests.map((r, i) => {
          const nameChanged = (r.requestedName || '') !== (r.currentName || '')
          const branches = getData().branches || []
          const priceChanges = branches.filter(b => {
            const cur = Number(r.currentPricesByBranch?.[String(b.id)] || 0)
            const req = Number(r.requestedPricesByBranch?.[String(b.id)] || 0)
            return cur !== req
          })
          return (
            <div key={r.id} style={{
              padding: '12px 14px',
              borderBottom: i < requests.length - 1 ? `0.5px solid ${T.copper[100]}` : 'none',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13.5, fontWeight: 700, color: T.neutral[900],
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {r.currentName || 'Producto'}
                </div>
                <div style={{ fontSize: 11.5, color: T.neutral[600], marginTop: 2 }}>
                  {nameChanged && <>Nombre · </>}
                  {priceChanges.length > 0 && <>{priceChanges.length} precio{priceChanges.length === 1 ? '' : 's'}</>}
                  {!nameChanged && priceChanges.length === 0 && 'Sin cambios'}
                  {r.cashierName && ` · ${r.cashierName}`}
                </div>
              </div>
              <button onClick={() => setReviewing(r)} style={btnSmall(T.copper[500])}>
                Revisar
              </button>
            </div>
          )
        })}
      </Section>

      {reviewing && (
        <ChangeRequestModal
          request={reviewing}
          adminUid={adminUid}
          onCancel={() => setReviewing(null)}
          onResolved={() => setReviewing(null)}
        />
      )}
    </>
  )
}

function ChangeRequestModal({ request, adminUid, onCancel, onResolved }) {
  const branches = getData().branches || []
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const nameChanged = (request.requestedName || '') !== (request.currentName || '')

  async function handleApprove() {
    if (busy) return
    setBusy(true); setError(null)
    try {
      await approveChangeRequest(request, {
        adminUid,
        updateCashierProduct: patchCashierProduct,
      })
      onResolved()
    } catch (err) {
      console.error('[changeReq] approve failed:', err)
      setError('No se pudo aprobar la solicitud.')
      setBusy(false)
    }
  }

  async function handleReject() {
    if (busy) return
    setBusy(true); setError(null)
    try {
      await rejectChangeRequest(request.id, { adminUid })
      onResolved()
    } catch (err) {
      console.error('[changeReq] reject failed:', err)
      setError('No se pudo rechazar la solicitud.')
      setBusy(false)
    }
  }

  return (
    <ModalOverlay onClose={busy ? undefined : onCancel}>
      <ModalCard>
        <ModalTitle>Solicitud de cambio</ModalTitle>
        <ModalSub>
          {request.cashierName} · {request.branchName || 'Sin nombre'}
        </ModalSub>

        {/* Nombre */}
        <div style={{
          padding: '12px 14px', borderRadius: 12, background: T.neutral[50], marginBottom: 12,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.neutral[500], textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>
            Nombre
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 13.5, color: nameChanged ? T.neutral[500] : T.neutral[800],
              textDecoration: nameChanged ? 'line-through' : 'none',
            }}>
              {request.currentName || '—'}
            </span>
            {nameChanged && (
              <>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M3 7 H11 M8 4 L11 7 L8 10" stroke={T.copper[500]} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span style={{ fontSize: 14, fontWeight: 700, color: T.copper[700] }}>
                  {request.requestedName}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Precios */}
        <div style={{
          padding: '12px 14px', borderRadius: 12, background: T.neutral[50], marginBottom: 12,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.neutral[500], textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>
            Precios por panadería
          </div>
          {branches.map(b => {
            const cur = Number(request.currentPricesByBranch?.[String(b.id)] || 0)
            const req = Number(request.requestedPricesByBranch?.[String(b.id)] || 0)
            const changed = cur !== req
            return (
              <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                <span style={{ flex: 1, fontSize: 12.5, color: T.neutral[600] }}>{b.name}</span>
                <span style={{
                  fontSize: 13, color: changed ? T.neutral[500] : T.neutral[800],
                  textDecoration: changed ? 'line-through' : 'none',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {cur > 0 ? fmtCOP(cur) : '—'}
                </span>
                {changed && (
                  <>
                    <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                      <path d="M3 7 H11 M8 4 L11 7 L8 10" stroke={T.copper[500]} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <span style={{
                      fontSize: 14, fontWeight: 700, color: T.copper[700],
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      {req > 0 ? fmtCOP(req) : '—'}
                    </span>
                  </>
                )}
              </div>
            )
          })}
        </div>

        {/* Motivo */}
        {request.reason && (
          <div style={{
            padding: '10px 12px', borderRadius: 10,
            background: '#FFF7E6', border: `1px solid #F4E0BC`,
            fontSize: 12.5, color: T.neutral[700], fontStyle: 'italic',
            marginBottom: 12, lineHeight: 1.5,
          }}>
            <b style={{ fontStyle: 'normal', color: T.warn }}>Motivo:</b> "{request.reason}"
          </div>
        )}

        {error && <ErrorBox>{error}</ErrorBox>}

        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button onClick={handleReject} disabled={busy} style={{
            flex: 1, padding: '12px', borderRadius: 12,
            background: 'transparent', color: T.bad,
            border: `1.5px solid ${T.bad}55`,
            cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
            fontSize: 14, fontWeight: 700,
          }}>
            Rechazar
          </button>
          <button onClick={handleApprove} disabled={busy} style={{
            flex: 1.4, padding: '12px', borderRadius: 12,
            background: T.ok, color: '#fff',
            border: 'none', cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
            fontSize: 14, fontWeight: 700,
            boxShadow: `0 3px 10px ${T.ok}44`,
            opacity: busy ? 0.7 : 1,
          }}>
            {busy ? 'Guardando...' : 'Aprobar cambio'}
          </button>
        </div>
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

function Row({ label, value, highlight, tone, muted }) {
  const highlightColor = tone === 'ok' ? T.ok : T.bad
  const labelColor = highlight ? highlightColor : (muted ? T.neutral[400] : T.neutral[600])
  const valueColor = highlight ? highlightColor : (muted ? T.neutral[500] : T.neutral[900])
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      padding: '4px 0', gap: 8,
    }}>
      <span style={{
        fontSize: highlight ? 11.5 : 12.5,
        color: labelColor,
        fontWeight: highlight ? 700 : 500,
        letterSpacing: highlight ? 0.5 : 0,
        textTransform: highlight ? 'uppercase' : 'none',
      }}>
        {label}
      </span>
      <span style={{
        fontSize: highlight ? 16 : 14, fontWeight: highlight ? 800 : 600,
        color: valueColor,
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

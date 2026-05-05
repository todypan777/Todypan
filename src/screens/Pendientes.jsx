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
} from '../cashSessions'
import {
  watchPendingExpenses,
  approveCashExpense,
  rejectCashExpense,
} from '../cashExpenses'
import { watchAllSales } from '../sales'
import { createDeduction } from '../cashierDeductions'
import { addMovement } from '../db'
import { doc, updateDoc } from 'firebase/firestore'
import { firestoreDb } from '../firebase'

export default function Pendientes({ onOpenUsers, onOpenProducts }) {
  const { authUser } = useAuth()

  const [pendingUsers, setPendingUsers] = useState([])
  const [pendingSessions, setPendingSessions] = useState([])
  const [pendingExpenses, setPendingExpenses] = useState([])
  const [allSales, setAllSales] = useState([])
  const [surplusBalance, setSurplusBalance] = useState(0)

  useEffect(() => watchAllUsers(list => setPendingUsers(list.filter(u => u.status === 'pending'))), [])
  useEffect(() => watchSessionsWithPendingReview(setPendingSessions), [])
  useEffect(() => watchPendingExpenses(setPendingExpenses), [])
  useEffect(() => watchAllSales(setAllSales), [])
  useEffect(() => watchSurplusFundBalance(setSurplusBalance), [])

  const openingDisputes = pendingSessions.filter(s => s.openingDispute?.status === 'pending')
  const closingShortages = pendingSessions.filter(s =>
    s.closingDiscrepancy?.status === 'pending' && s.closingDiscrepancy?.type === 'shortage'
  )
  const flaggedSales = useMemo(
    () => allSales.filter(s => s.status === 'flagged'),
    [allSales]
  )

  const totalCount =
    pendingUsers.length +
    openingDisputes.length +
    closingShortages.length +
    pendingExpenses.length +
    flaggedSales.length

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

      {closingShortages.length > 0 && (
        <ClosingShortagesSection
          sessions={closingShortages}
          adminUid={authUser.uid}
          surplusBalance={surplusBalance}
        />
      )}

      {pendingExpenses.length > 0 && (
        <CashExpensesSection expenses={pendingExpenses} adminUid={authUser.uid} />
      )}

      {flaggedSales.length > 0 && (
        <FlaggedSalesSection sales={flaggedSales} adminUid={authUser.uid} />
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
// Sección genérica
// ──────────────────────────────────────────────────────────────
function Section({ title, count, tone = 'copper', actionLabel, onAction, children }) {
  const tones = {
    copper: { bg: T.copper[50], border: T.copper[100], text: T.copper[700] },
    warn:   { bg: '#FFF7E6', border: '#F4E0BC', text: T.warn },
    bad:    { bg: '#FBE9E5', border: '#F0C8BE', text: T.bad },
  }
  const tn = tones[tone] || tones.copper
  return (
    <div style={{ padding: '0 16px 12px' }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        padding: '0 4px 8px', gap: 8,
      }}>
        <div style={{
          fontSize: 12, fontWeight: 700, color: T.neutral[500],
          letterSpacing: 0.5, textTransform: 'uppercase',
        }}>
          {title} <span style={{ color: tn.text }}>· {count}</span>
        </div>
        {actionLabel && onAction && (
          <button onClick={onAction} style={{
            background: 'none', border: 'none', padding: 0,
            fontSize: 12.5, fontWeight: 700, color: T.copper[600],
            cursor: 'pointer', fontFamily: 'inherit',
          }}>
            {actionLabel}
          </button>
        )}
      </div>
      <Card padding={0} style={{ background: tn.bg, border: `1px solid ${tn.border}`, boxShadow: 'none', overflow: 'hidden' }}>
        {children}
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
// Faltas de cierre
// ──────────────────────────────────────────────────────────────
function ClosingShortagesSection({ sessions, adminUid, surplusBalance }) {
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
          onCancel={() => setResolving(null)}
          onResolved={() => setResolving(null)}
        />
      )}
    </>
  )
}

function ClosingShortageModal({ session, adminUid, surplusBalance, onCancel, onResolved }) {
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
        // Crear entrada en cashierDeductions
        deductionId = await createDeduction({
          cashierUid: session.cashierUid,
          cashierName: session.cashierName,
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

function Row({ label, value, highlight }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      padding: '4px 0', gap: 8,
    }}>
      <span style={{ fontSize: 12.5, color: T.neutral[600] }}>{label}</span>
      <span style={{
        fontSize: highlight ? 16 : 14, fontWeight: highlight ? 800 : 600,
        color: highlight ? T.bad : T.neutral[900],
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

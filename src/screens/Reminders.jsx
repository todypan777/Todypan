import { useState } from 'react'
import { T } from '../tokens'
import { fmtCOP, fmtDate, todayStr } from '../utils/format'
import { Card, SectionHeader, CatIcon, BranchChip, Amount, IconButton, BackButton, Modal, InputField, PrimaryButton } from '../components/Atoms'
import { ScreenHeader } from '../components/Nav'
import { addReminder, updateReminder, deleteReminder, toggleReminderPaid, getData } from '../db'

const CATS = [
  { id: 'arriendo', label: 'Arriendo' },
  { id: 'energia', label: 'Energía' },
  { id: 'agua', label: 'Agua' },
  { id: 'gas', label: 'Gas' },
  { id: 'internet', label: 'Internet' },
  { id: 'aseo', label: 'Aseo' },
  { id: 'harina', label: 'Harina' },
  { id: 'otros_prov', label: 'Otro' },
]

export default function Reminders({ reminders, onBack, onRefresh }) {
  const [showAdd, setShowAdd] = useState(false)
  const [editId, setEditId] = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)
  const today = todayStr()

  const sorted = [...reminders].sort((a, b) => {
    if (a.paid !== b.paid) return a.paid ? 1 : -1
    return a.due.localeCompare(b.due)
  })
  const pending = sorted.filter(r => !r.paid)
  const totalDue = pending.reduce((s, r) => s + r.amount, 0)

  function handleToggle(id) {
    toggleReminderPaid(id)
    onRefresh()
  }

  function handleDelete(id) {
    deleteReminder(id)
    setConfirmDel(null)
    onRefresh()
  }

  return (
    <div style={{ paddingBottom: 110 }}>
      <div style={{ padding: '56px 16px 0' }}>
        <BackButton onBack={onBack} label="Más"/>
      </div>
      <ScreenHeader title="Recordatorios"
        right={
          <IconButton tint={T.copper[50]} onClick={() => setShowAdd(true)}>
            <svg width="16" height="16" viewBox="0 0 16 16"><path d="M8 3 V13 M3 8 H13" stroke={T.copper[500]} strokeWidth="2" strokeLinecap="round"/></svg>
          </IconButton>
        }/>

      {/* Summary */}
      <div style={{ padding: '4px 16px 12px' }}>
        <Card padding={18} style={{ background: T.neutral[900], color: '#fff' }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.5, color: T.copper[300], textTransform: 'uppercase' }}>Por pagar</div>
          <div style={{ marginTop: 6, fontSize: 28, fontWeight: 700, letterSpacing: -0.8, fontVariantNumeric: 'tabular-nums' }}>
            {fmtCOP(totalDue)}
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 3 }}>
            {pending.length} {pending.length === 1 ? 'pago pendiente' : 'pagos pendientes'}
          </div>
        </Card>
      </div>

      {reminders.length === 0 && (
        <div style={{ padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 36 }}>🔔</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: T.neutral[600], marginTop: 12 }}>Sin recordatorios</div>
          <div style={{ fontSize: 13, color: T.neutral[400], marginTop: 6 }}>Agrega pagos recurrentes para recordarlos</div>
        </div>
      )}

      {sorted.length > 0 && (
        <div style={{ padding: '0 16px' }}>
          <Card padding={0}>
            {sorted.map((r, i) => {
              const daysLeft = Math.ceil((new Date(r.due) - new Date(today + 'T00:00:00')) / 86400000)
              const overdue  = daysLeft < 0 && !r.paid
              const urgent   = daysLeft <= 3 && !r.paid
              // Bloquear "Pagar" si faltan más de 10 días (excepto vencidos)
              const canPay   = !r.paid && (daysLeft <= 10 || overdue)
              // Próxima fecha para recurrentes (mismo día del mes siguiente)
              const nextDue  = (() => {
                if (!r.recurring || !r.due) return null
                const [y, m, d] = r.due.split('-').map(Number)
                return new Date(y, m, d).toLocaleDateString('en-CA')
              })()

              return (
                <div key={r.id} style={{
                  padding: '14px 16px', display: 'flex', alignItems: 'flex-start', gap: 12,
                  borderBottom: i < sorted.length - 1 ? `0.5px solid ${T.neutral[100]}` : 'none',
                  opacity: r.paid ? 0.6 : 1,
                }}>
                  <div style={{
                    width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                    background: r.paid ? T.neutral[100] : (urgent || overdue ? '#FBEAE6' : T.neutral[50]),
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    marginTop: 1,
                  }}>
                    <CatIcon cat={r.cat} size={18} color={r.paid ? T.neutral[400] : ((urgent || overdue) ? T.bad : T.neutral[600])}/>
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: T.neutral[800], textDecoration: r.paid ? 'line-through' : 'none' }}>
                      {r.title}
                    </div>
                    {/* Fecha y estado */}
                    <div style={{ fontSize: 12, marginTop: 3, display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap',
                      color: overdue ? T.bad : (urgent ? T.warn : T.neutral[500]) }}>
                      <span>
                        {r.paid ? `Pagado` :
                          overdue  ? `⚠ Vencido hace ${Math.abs(daysLeft)}d` :
                          daysLeft === 0 ? '🔴 Vence hoy' :
                          daysLeft === 1 ? '🟡 Mañana' :
                          daysLeft <= 10 ? `${fmtDate(r.due)} · en ${daysLeft}d` :
                          `${fmtDate(r.due)} · en ${daysLeft}d`}
                      </span>
                      {r.branch !== 'both' && <><span>·</span><BranchChip branch={r.branch} size="sm"/></>}
                      {r.recurring && <><span>·</span><span style={{ color: T.neutral[400] }}>Mensual</span></>}
                    </div>
                    {/* Último pago + próxima fecha para recurrentes */}
                    {r.recurring && r.lastPaid && (
                      <div style={{ fontSize: 11, color: T.neutral[400], marginTop: 4, display: 'flex', gap: 10 }}>
                        <span>Último pago: {fmtDate(r.lastPaid)}</span>
                        {nextDue && <span style={{ color: T.copper[500], fontWeight: 600 }}>· Próximo: {fmtDate(nextDue)}</span>}
                      </div>
                    )}
                    {/* Aviso de bloqueo de pago */}
                    {!r.paid && daysLeft > 10 && (
                      <div style={{ fontSize: 11, color: T.neutral[400], marginTop: 4, fontStyle: 'italic' }}>
                        Disponible para pagar en {daysLeft - 10}d
                      </div>
                    )}
                  </div>

                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <Amount value={r.amount} size={14} weight={700} color={r.paid ? T.neutral[400] : T.neutral[900]}/>
                    <div style={{ display: 'flex', gap: 6, marginTop: 5, justifyContent: 'flex-end' }}>
                      <button onClick={() => setEditId(r.id)} style={{
                        padding: '4px 8px', borderRadius: 999, border: 'none',
                        background: T.neutral[100], color: T.neutral[600],
                        fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                      }}>✏️</button>
                      {r.paid ? (
                        <button onClick={() => handleToggle(r.id)} style={{
                          padding: '4px 10px', borderRadius: 999, border: 'none',
                          background: T.neutral[100], color: T.neutral[600],
                          fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                        }}>Deshacer</button>
                      ) : (
                        <button
                          onClick={() => canPay && handleToggle(r.id)}
                          title={!canPay ? `Disponible en ${daysLeft - 10} días` : ''}
                          style={{
                            padding: '4px 10px', borderRadius: 999, border: 'none',
                            background: canPay ? T.ok : T.neutral[100],
                            color: canPay ? '#fff' : T.neutral[400],
                            fontSize: 11, fontWeight: 600,
                            cursor: canPay ? 'pointer' : 'not-allowed',
                            fontFamily: 'inherit',
                          }}>
                          {canPay ? 'Pagar' : `${daysLeft - 10}d`}
                        </button>
                      )}
                    </div>
                    <button onClick={() => setConfirmDel(r.id)} style={{
                      padding: '2px 0 0', background: 'none', border: 'none', cursor: 'pointer',
                      fontSize: 10, color: T.neutral[300], fontFamily: 'inherit',
                    }}>eliminar</button>
                  </div>
                </div>
              )
            })}
          </Card>
        </div>
      )}

      {/* Add modal */}
      {showAdd && (
        <ReminderForm
          onClose={() => setShowAdd(false)}
          onSave={() => { setShowAdd(false); onRefresh() }}
        />
      )}

      {/* Edit modal */}
      {editId && (
        <ReminderForm
          initial={reminders.find(r => r.id === editId)}
          onClose={() => setEditId(null)}
          onSave={() => { setEditId(null); onRefresh() }}
          isEdit
        />
      )}

      {/* Delete confirm */}
      {confirmDel && (
        <Modal onClose={() => setConfirmDel(null)} title="¿Eliminar recordatorio?">
          <div style={{ fontSize: 14, color: T.neutral[500], marginBottom: 20 }}>Esta acción no se puede deshacer.</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setConfirmDel(null)} style={{ flex: 1, padding: 13, borderRadius: 12, border: 'none', background: T.neutral[100], color: T.neutral[700], fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Cancelar</button>
            <button onClick={() => handleDelete(confirmDel)} style={{ flex: 1, padding: 13, borderRadius: 12, border: 'none', background: T.bad, color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Eliminar</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function ReminderForm({ initial, onClose, onSave, isEdit }) {
  const [title, setTitle] = useState(initial?.title || '')
  const [amount, setAmount] = useState(initial?.amount ? String(initial.amount) : '')
  const [due, setDue] = useState(initial?.due || todayStr())
  const [cat, setCat] = useState(initial?.cat || 'otros_prov')
  const [branch, setBranch] = useState(initial?.branch ?? 'both')
  const [recurring, setRecurring] = useState(initial?.recurring === 'monthly')

  const canSave = title && amount && due

  function handleSave() {
    if (!canSave) return
    const data = { title, amount: Number(amount), due, cat, branch, recurring: recurring ? 'monthly' : null, paid: initial?.paid || false }
    if (isEdit) {
      updateReminder(initial.id, data)
    } else {
      addReminder(data)
    }
    onSave()
  }

  return (
    <Modal onClose={onClose} title={isEdit ? 'Editar recordatorio' : 'Nuevo recordatorio'}>
      <InputField label="Nombre" value={title} onChange={setTitle} placeholder="Ej: Internet Claro"/>
      <InputField label="Valor ($)" value={amount} onChange={setAmount} type="number" placeholder="Ej: 180000"/>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: T.neutral[500], textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Fecha de vencimiento</div>
        <input type="date" value={due} onChange={e => setDue(e.target.value)} style={{
          width: '100%', padding: '12px 14px', borderRadius: 12, border: `1px solid ${T.neutral[200]}`,
          background: '#fff', fontSize: 15, color: T.neutral[800], fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
        }}/>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: T.neutral[500], textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Categoría</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {CATS.map(c => (
            <button key={c.id} onClick={() => setCat(c.id)} style={{
              padding: '6px 12px', borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              background: cat === c.id ? T.copper[500] : T.neutral[100],
              color: cat === c.id ? '#fff' : T.neutral[700],
              fontSize: 13, fontWeight: 600,
            }}>{c.label}</button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: T.neutral[500], textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Panadería</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[{ v: 'both', l: 'Ambas' }, ...getData().branches.map(b => ({ v: b.id, l: b.name }))].map(b => (
            <button key={b.v} onClick={() => setBranch(b.v)} style={{
              flex: 1, padding: '9px', borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              background: branch === b.v ? T.copper[500] : T.neutral[100],
              color: branch === b.v ? '#fff' : T.neutral[700],
              fontSize: 13, fontWeight: 600,
            }}>{b.l}</button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div onClick={() => setRecurring(r => !r)} style={{
          width: 44, height: 26, borderRadius: 999, cursor: 'pointer',
          background: recurring ? T.copper[500] : T.neutral[200],
          position: 'relative', transition: 'background 0.2s',
        }}>
          <div style={{
            position: 'absolute', top: 3, left: recurring ? 21 : 3,
            width: 20, height: 20, borderRadius: 999, background: '#fff',
            transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          }}/>
        </div>
        <span style={{ fontSize: 14, color: T.neutral[700], fontWeight: 500 }}>Pago mensual recurrente</span>
      </div>

      <PrimaryButton label={isEdit ? 'Guardar cambios' : 'Agregar recordatorio'} onClick={handleSave} disabled={!canSave}/>
    </Modal>
  )
}

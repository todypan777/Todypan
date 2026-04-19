import { useState } from 'react'
import { T } from '../tokens'
import { fmtCOP, fmtDate, fmtMonthLabel, currentMonth } from '../utils/format'
import { Card, SectionHeader, Chip, BranchChip, Amount, IconButton, BackButton, Modal, InputField, PrimaryButton, EmptyState } from '../components/Atoms'
import { ScreenHeader } from '../components/Nav'
import { addEmployee, updateEmployee, deleteEmployee, togglePaid, payAllPending } from '../db'
import { generatePayrollPDF } from '../utils/pdf'

export default function Team({ filter, setFilter, employees, attendance, onRefresh, initialEmpId, onClearEmpId }) {
  const [empOpen, setEmpOpen] = useState(initialEmpId || null)
  const [showAddEmp, setShowAddEmp] = useState(false)

  function openEmp(id) { setEmpOpen(id); onClearEmpId?.() }
  function closeEmp() { setEmpOpen(null) }

  if (empOpen) {
    const emp = employees.find(e => e.id === empOpen)
    if (!emp) { setEmpOpen(null); return null }
    return <EmployeeDetail emp={emp} attendance={attendance} onBack={closeEmp} onRefresh={onRefresh} />
  }

  const filtered = employees.filter(e => filter === 'all' || e.branch === filter)
  const stats = filtered.map(e => {
    const att = attendance[e.id] || {}
    const month = currentMonth()
    const entries = Object.entries(att).filter(([d]) => d.startsWith(month))
    const worked = entries.filter(([, a]) => a.worked).length
    const unpaid = entries.filter(([, a]) => a.worked && !a.paid)
    const owed = unpaid.reduce((s, [, a]) => s + e.rate + (a.extras || 0), 0)
    return { emp: e, worked, owed, unpaidDays: unpaid.length }
  })

  const totalOwed = stats.reduce((s, x) => s + x.owed, 0)

  return (
    <div style={{ paddingBottom: 110 }}>
      <ScreenHeader title="Equipo" subtitle={fmtMonthLabel(currentMonth())}
        right={
          <IconButton tint={T.copper[50]} onClick={() => setShowAddEmp(true)}>
            <svg width="16" height="16" viewBox="0 0 16 16"><path d="M8 3 V13 M3 8 H13" stroke={T.copper[500]} strokeWidth="2" strokeLinecap="round"/></svg>
          </IconButton>
        }/>

      <div style={{ padding: '4px 20px 12px', display: 'flex', gap: 8, overflowX: 'auto' }}>
        <Chip label="Todos" active={filter === 'all'} onClick={() => setFilter('all')} />
        <Chip label="Iglesia" active={filter === 1} onClick={() => setFilter(1)} />
        <Chip label="Esquina" active={filter === 2} onClick={() => setFilter(2)} />
      </div>

      {totalOwed > 0 && (
        <div style={{ padding: '0 16px 12px' }}>
          <Card padding={14} style={{ background: T.copper[50], border: `0.5px solid ${T.copper[100]}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: T.copper[700], letterSpacing: 0.5, textTransform: 'uppercase' }}>Por pagar</div>
                <div style={{ marginTop: 4, fontSize: 22, fontWeight: 700, color: T.copper[900], fontVariantNumeric: 'tabular-nums', letterSpacing: -0.5 }}>
                  {fmtCOP(totalOwed)}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11, color: T.copper[700] }}>{stats.filter(x => x.owed > 0).length} empleados</div>
                <div style={{ fontSize: 11, color: T.copper[700], marginTop: 2 }}>{stats.reduce((s, x) => s + x.unpaidDays, 0)} días pendientes</div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {employees.length === 0 ? (
        <EmptyState icon="👥" title="Sin empleados" subtitle="Agrega tu primer empleado con el botón +" />
      ) : (
        <div style={{ padding: '0 16px' }}>
          <Card padding={0}>
            {stats.map((x, i) => (
              <div key={x.emp.id} onClick={() => openEmp(x.emp.id)}
                style={{
                  padding: '14px 16px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 12,
                  borderBottom: i < stats.length - 1 ? `0.5px solid ${T.neutral[100]}` : 'none',
                }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 999,
                  background: T.branch[x.emp.branch]?.tagBg || T.neutral[100],
                  color: T.branch[x.emp.branch]?.tag || T.neutral[600],
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, fontSize: 14, flexShrink: 0,
                }}>
                  {x.emp.name.split(' ').map(p => p[0]).slice(0, 2).join('')}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: T.neutral[800] }}>{x.emp.name.split(' ').slice(0, 2).join(' ')}</div>
                  <div style={{ fontSize: 12, color: T.neutral[500], marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {x.emp.role} · <BranchChip branch={x.emp.branch} size="sm"/>
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  {x.owed > 0
                    ? <Amount value={x.owed} size={15} weight={700} color={T.copper[600]}/>
                    : <span style={{ fontSize: 12, color: T.ok, fontWeight: 600 }}>Al día</span>}
                  <div style={{ fontSize: 11, color: T.neutral[400], marginTop: 2 }}>{x.worked} días</div>
                </div>
              </div>
            ))}
          </Card>
        </div>
      )}

      {showAddEmp && <AddEmployeeModal onClose={() => setShowAddEmp(false)} onSave={() => { setShowAddEmp(false); onRefresh() }} />}
    </div>
  )
}

const REST_DAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

function AddEmployeeModal({ onClose, onSave }) {
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [branch, setBranch] = useState(1)
  const [rate, setRate] = useState('')
  const [phone, setPhone] = useState('')
  const [restDay, setRestDay] = useState(0)

  const canSave = name.trim() && rate && phone.trim()

  function handleSave() {
    if (!canSave) return
    addEmployee({ name: name.trim(), role, branch, rate: Number(rate), phone: phone.trim(), restDay })
    onSave()
  }

  return (
    <Modal onClose={onClose} title="Nuevo empleado">
      <InputField label="Nombre completo" value={name} onChange={setName} placeholder="Ej: María López"/>
      <InputField label="Cargo" value={role} onChange={setRole} placeholder="Ej: Panadera"/>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: T.neutral[500], textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Panadería</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {[{ v: 1, l: 'Iglesia' }, { v: 2, l: 'Esquina' }].map(b => (
            <button key={b.v} onClick={() => setBranch(b.v)} style={{
              flex: 1, padding: '10px', borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              background: branch === b.v ? T.copper[500] : T.neutral[100],
              color: branch === b.v ? '#fff' : T.neutral[700],
              fontSize: 14, fontWeight: 600,
            }}>{b.l}</button>
          ))}
        </div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: T.neutral[500], textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Día de descanso</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
          {REST_DAY_LABELS.map((label, idx) => (
            <button key={idx} onClick={() => setRestDay(idx)} style={{
              padding: '8px 0', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              background: restDay === idx ? T.neutral[800] : T.neutral[100],
              color: restDay === idx ? '#fff' : T.neutral[600],
              fontSize: 11, fontWeight: 600,
            }}>{label}</button>
          ))}
        </div>
      </div>
      <InputField label="Valor día ($)" value={rate} onChange={setRate} type="number" placeholder="Ej: 65000"/>
      <InputField label="WhatsApp *" value={phone} onChange={setPhone} type="tel" placeholder="Ej: 301 234 5678"/>
      <PrimaryButton label="Agregar empleado" onClick={handleSave} disabled={!canSave}/>
    </Modal>
  )
}

function EmployeeDetail({ emp, attendance, onBack, onRefresh }) {
  const [month, setMonth] = useState(currentMonth())
  const [showDelete, setShowDelete] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [showConfirmPay, setShowConfirmPay] = useState(false)
  const att = attendance[emp.id] || {}

  const [y, m] = month.split('-').map(Number)

  const entries = Object.entries(att).filter(([d]) => d.startsWith(month))
  const worked = entries.filter(([, a]) => a.worked).length
  const unpaid = entries.filter(([, a]) => a.worked && !a.paid)
  const owed = unpaid.reduce((s, [, a]) => s + emp.rate + (a.extras || 0), 0)
  const paid = entries.filter(([, a]) => a.worked && a.paid).reduce((s, [, a]) => s + emp.rate + (a.extras || 0), 0)

  function changeMonth(delta) {
    const d = new Date(y, m - 1 + delta, 1)
    setMonth(d.toISOString().slice(0, 7))
  }

  function handleTogglePaid(dateStr) {
    togglePaid(emp.id, dateStr)
    onRefresh()
  }

  async function handlePayWithPDF() {
    if (unpaid.length === 0) return
    const doc = generatePayrollPDF(emp, unpaid, month)
    const blob = doc.output('blob')
    const file = new File([blob], `nomina-${emp.name.split(' ')[0]}-${month}.pdf`, { type: 'application/pdf' })
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `Nómina ${emp.name.split(' ')[0]}` })
      } else {
        doc.save(`nomina-${emp.name.split(' ')[0]}-${month}.pdf`)
      }
    } catch (e) {
      if (e.name !== 'AbortError') doc.save(`nomina-${emp.name.split(' ')[0]}-${month}.pdf`)
    }
    setShowConfirmPay(true)
  }

  function handleDeleteEmp() {
    deleteEmployee(emp.id)
    onRefresh()
    onBack()
  }

  return (
    <div style={{ background: T.neutral[50], minHeight: '100%', paddingBottom: 120 }}>
      <div style={{ padding: '56px 16px 0' }}>
        <BackButton onBack={onBack} label="Equipo"/>
      </div>

      {/* Employee card */}
      <div style={{ padding: '12px 16px 0' }}>
        <Card padding={20}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 56, height: 56, borderRadius: 999, flexShrink: 0,
              background: T.branch[emp.branch]?.tagBg || T.neutral[100],
              color: T.branch[emp.branch]?.tag || T.neutral[600],
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: 20,
            }}>
              {emp.name.split(' ').map(p => p[0]).slice(0, 2).join('')}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: T.neutral[900], letterSpacing: -0.3 }}>{emp.name}</div>
              <div style={{ fontSize: 13, color: T.neutral[500], marginTop: 2 }}>
                {emp.role}
                {emp.phone && (
                  <a href={`https://wa.me/57${emp.phone.replace(/\D/g,'')}`} target="_blank" rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    style={{ color: '#25D366', marginLeft: 8, fontWeight: 600, textDecoration: 'none', fontSize: 12 }}>
                    WhatsApp
                  </a>
                )}
              </div>
              <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <BranchChip branch={emp.branch}/>
                {emp.restDay != null && (
                  <span style={{ fontSize: 11, color: T.neutral[400], fontWeight: 500 }}>
                    Descansa {REST_DAY_LABELS[emp.restDay]}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: `0.5px solid ${T.neutral[100]}`, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: T.neutral[400], textTransform: 'uppercase', letterSpacing: 0.6 }}>Tarifa</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: T.neutral[900], marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>
                {fmtCOP(emp.rate)}<span style={{ fontSize: 12, fontWeight: 500, color: T.neutral[500] }}> / día</span>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: T.neutral[400], textTransform: 'uppercase', letterSpacing: 0.6 }}>Días {fmtMonthLabel(month).split(' ')[0]}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: T.neutral[900], marginTop: 3 }}>
                {worked}<span style={{ fontSize: 12, fontWeight: 500, color: T.neutral[500] }}> trabajados</span>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Balance */}
      <div style={{ padding: '10px 16px 0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Card padding={14}>
          <div style={{ fontSize: 10.5, fontWeight: 600, color: T.neutral[400], textTransform: 'uppercase', letterSpacing: 0.6 }}>Por pagar</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: owed > 0 ? T.copper[600] : T.ok, marginTop: 4, fontVariantNumeric: 'tabular-nums', letterSpacing: -0.5 }}>
            {fmtCOP(owed, { compact: true })}
          </div>
          <div style={{ fontSize: 11, color: T.neutral[500], marginTop: 2 }}>{unpaid.length} días</div>
        </Card>
        <Card padding={14}>
          <div style={{ fontSize: 10.5, fontWeight: 600, color: T.neutral[400], textTransform: 'uppercase', letterSpacing: 0.6 }}>Ya pagado</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: T.neutral[700], marginTop: 4, fontVariantNumeric: 'tabular-nums', letterSpacing: -0.5 }}>
            {fmtCOP(paid, { compact: true })}
          </div>
          <div style={{ fontSize: 11, color: T.neutral[500], marginTop: 2 }}>en el mes</div>
        </Card>
      </div>

      {/* Pay button */}
      {unpaid.length > 0 && (
        <div style={{ padding: '12px 16px 0' }}>
          <button onClick={handlePayWithPDF} style={{
            width: '100%', padding: '15px', borderRadius: 14, border: 'none',
            background: T.neutral[900], color: '#fff',
            fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          }}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M2 9 L7 14 L16 4" stroke="#25D366" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Enviar comprobante y pagar · {fmtCOP(owed)}
          </button>
        </div>
      )}

      {/* Month nav + day list */}
      <div style={{ padding: '16px 16px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: T.neutral[700] }}>{fmtMonthLabel(month)}</div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={() => changeMonth(-1)} style={{ background: 'none', border: 'none', padding: '6px 10px', cursor: 'pointer', color: T.copper[500], fontFamily: 'inherit', fontSize: 13, fontWeight: 600 }}>‹</button>
          <button onClick={() => changeMonth(1)} disabled={month >= currentMonth()} style={{ background: 'none', border: 'none', padding: '6px 10px', cursor: month >= currentMonth() ? 'default' : 'pointer', color: month >= currentMonth() ? T.neutral[300] : T.copper[500], fontFamily: 'inherit', fontSize: 13, fontWeight: 600 }}>›</button>
        </div>
      </div>

      {entries.filter(([, a]) => a.worked).length > 0 ? (
        <div style={{ padding: '8px 16px 0' }}>
          <Card padding={0}>
            {entries.sort((a, b) => b[0].localeCompare(a[0])).filter(([, a]) => a.worked).map(([d, a], i, arr) => (
              <div key={d} style={{
                padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12,
                borderBottom: i < arr.length - 1 ? `0.5px solid ${T.neutral[100]}` : 'none',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: T.neutral[800], textTransform: 'capitalize' }}>{fmtDate(d, { weekday: true })}</div>
                  <div style={{ fontSize: 12, color: T.neutral[500], marginTop: 2 }}>
                    {fmtCOP(emp.rate)}{a.extras > 0 && ` + ${fmtCOP(a.extras)} extras`}
                  </div>
                </div>
                <Amount value={emp.rate + (a.extras || 0)} size={14} weight={700}/>
                <button onClick={() => handleTogglePaid(d)} style={{
                  padding: '6px 11px', borderRadius: 999, border: 'none',
                  background: a.paid ? T.neutral[100] : T.copper[500],
                  color: a.paid ? T.neutral[600] : '#fff',
                  fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', minWidth: 64,
                }}>
                  {a.paid ? 'Pagado' : 'Pagar'}
                </button>
              </div>
            ))}
          </Card>
        </div>
      ) : (
        <div style={{ padding: '8px 16px 0' }}>
          <Card padding={20}>
            <div style={{ textAlign: 'center', color: T.neutral[400], fontSize: 13 }}>Sin días registrados en {fmtMonthLabel(month)}</div>
          </Card>
        </div>
      )}

      {/* Edit + Delete */}
      <div style={{ padding: '20px 16px 0', display: 'flex', gap: 10 }}>
        <button onClick={() => setShowEdit(true)} style={{
          flex: 1, padding: '13px', borderRadius: 14, border: `1px solid ${T.neutral[200]}`,
          background: '#fff', color: T.neutral[700],
          fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3 L13 6 L6 13 H3 V10 Z" stroke={T.neutral[600]} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          Editar empleado
        </button>
        <button onClick={() => setShowDelete(true)} style={{
          padding: '13px 16px', borderRadius: 14, border: `1px solid #E8C4BC`,
          background: '#FBF0EE', color: T.bad,
          fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
        }}>
          Eliminar
        </button>
      </div>

      {/* Confirm pay modal */}
      {showConfirmPay && (
        <Modal onClose={() => setShowConfirmPay(false)} title="¿Confirmar pago?">
          <div style={{ fontSize: 14, color: T.neutral[600], marginBottom: 8 }}>
            ¿Ya enviaste el comprobante por WhatsApp?
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: T.neutral[900], marginBottom: 20, fontVariantNumeric: 'tabular-nums' }}>
            {fmtCOP(owed)}
            <span style={{ fontSize: 13, fontWeight: 500, color: T.neutral[500], marginLeft: 8 }}>· {unpaid.length} días</span>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setShowConfirmPay(false)} style={{
              flex: 1, padding: 13, borderRadius: 12, border: 'none',
              background: T.neutral[100], color: T.neutral[700],
              fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}>Cancelar</button>
            <button onClick={() => { payAllPending(emp.id, month); setShowConfirmPay(false); onRefresh() }} style={{
              flex: 1, padding: 13, borderRadius: 12, border: 'none',
              background: T.ok, color: '#fff',
              fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}>Confirmar pago</button>
          </div>
        </Modal>
      )}

      {/* Edit modal */}
      {showEdit && (
        <EditEmployeeModal emp={emp} onClose={() => setShowEdit(false)} onSave={() => { setShowEdit(false); onRefresh() }}/>
      )}

      {/* Delete confirm */}
      {showDelete && (
        <Modal onClose={() => setShowDelete(false)} title="¿Eliminar empleado?">
          <div style={{ fontSize: 14, color: T.neutral[500], marginBottom: 24 }}>Se eliminará {emp.name} y todos sus registros. Esta acción no se puede deshacer.</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setShowDelete(false)} style={{
              flex: 1, padding: 13, borderRadius: 12, border: 'none',
              background: T.neutral[100], color: T.neutral[700],
              fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}>Cancelar</button>
            <button onClick={handleDeleteEmp} style={{
              flex: 1, padding: 13, borderRadius: 12, border: 'none',
              background: T.bad, color: '#fff',
              fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}>Eliminar</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function EditEmployeeModal({ emp, onClose, onSave }) {
  const [name, setName] = useState(emp.name)
  const [role, setRole] = useState(emp.role || '')
  const [branch, setBranch] = useState(emp.branch)
  const [rate, setRate] = useState(String(emp.rate))
  const [phone, setPhone] = useState(emp.phone || '')
  const [restDay, setRestDay] = useState(emp.restDay ?? 0)
  const [workHours, setWorkHours] = useState(String(emp.workHours || 9))

  const canSave = name.trim() && rate && phone.trim()

  function handleSave() {
    if (!canSave) return
    updateEmployee(emp.id, { name: name.trim(), role, branch, rate: Number(rate), phone: phone.trim(), restDay, workHours: Number(workHours) || 9 })
    onSave()
  }

  return (
    <Modal onClose={onClose} title="Editar empleado">
      <InputField label="Nombre completo" value={name} onChange={setName} placeholder="Ej: María López"/>
      <InputField label="Cargo" value={role} onChange={setRole} placeholder="Ej: Panadera"/>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: T.neutral[500], textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Panadería</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {[{ v: 1, l: 'Iglesia' }, { v: 2, l: 'Esquina' }].map(b => (
            <button key={b.v} onClick={() => setBranch(b.v)} style={{
              flex: 1, padding: '10px', borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              background: branch === b.v ? T.copper[500] : T.neutral[100],
              color: branch === b.v ? '#fff' : T.neutral[700],
              fontSize: 14, fontWeight: 600,
            }}>{b.l}</button>
          ))}
        </div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: T.neutral[500], textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Día de descanso</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
          {REST_DAY_LABELS.map((label, idx) => (
            <button key={idx} onClick={() => setRestDay(idx)} style={{
              padding: '8px 0', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              background: restDay === idx ? T.neutral[800] : T.neutral[100],
              color: restDay === idx ? '#fff' : T.neutral[600],
              fontSize: 11, fontWeight: 600,
            }}>{label}</button>
          ))}
        </div>
      </div>
      <InputField label="Valor día ($)" value={rate} onChange={setRate} type="number" placeholder="Ej: 65000"/>
      <InputField label="Horas de jornada" value={workHours} onChange={setWorkHours} type="number" placeholder="Ej: 9"/>
      <InputField label="WhatsApp *" value={phone} onChange={setPhone} type="tel" placeholder="Ej: 301 234 5678"/>
      <PrimaryButton label="Guardar cambios" onClick={handleSave} disabled={!canSave}/>
    </Modal>
  )
}

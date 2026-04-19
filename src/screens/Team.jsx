import { useState } from 'react'
import { T } from '../tokens'
import { fmtCOP, fmtDate, fmtMonthLabel, currentMonth } from '../utils/format'
import { Card, SectionHeader, Chip, BranchChip, Amount, IconButton, BackButton, Modal, InputField, PrimaryButton, EmptyState } from '../components/Atoms'
import { ScreenHeader } from '../components/Nav'
import { addEmployee, updateEmployee, deleteEmployee, toggleWorked, togglePaid, payAllPending, setExtras } from '../db'
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

function AddEmployeeModal({ onClose, onSave }) {
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [branch, setBranch] = useState(1)
  const [rate, setRate] = useState('')
  const [phone, setPhone] = useState('')

  function handleSave() {
    if (!name || !rate) return
    addEmployee({ name, role, branch, rate: Number(rate), phone })
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
      <InputField label="Valor día ($)" value={rate} onChange={setRate} type="number" placeholder="Ej: 65000"/>
      <InputField label="Teléfono (opcional)" value={phone} onChange={setPhone} placeholder="Ej: 301 234 5678"/>
      <PrimaryButton label="Agregar empleado" onClick={handleSave} disabled={!name || !rate}/>
    </Modal>
  )
}

function EmployeeDetail({ emp, attendance, onBack, onRefresh }) {
  const [month, setMonth] = useState(currentMonth())
  const [showExtras, setShowExtras] = useState(null)
  const [extrasVal, setExtrasVal] = useState('')
  const [showDelete, setShowDelete] = useState(false)
  const att = attendance[emp.id] || {}

  const entries = Object.entries(att).filter(([d]) => d.startsWith(month))
  const worked = entries.filter(([, a]) => a.worked).length
  const unpaid = entries.filter(([, a]) => a.worked && !a.paid)
  const owed = unpaid.reduce((s, [, a]) => s + emp.rate + (a.extras || 0), 0)
  const paid = entries.filter(([, a]) => a.worked && a.paid).reduce((s, [, a]) => s + emp.rate + (a.extras || 0), 0)

  const [y, m] = month.split('-').map(Number)
  const firstDay = new Date(y, m - 1, 1)
  const daysInMonth = new Date(y, m, 0).getDate()
  const startOffset = (firstDay.getDay() + 6) % 7
  const today = new Date().toISOString().slice(0, 10)

  const cells = []
  for (let i = 0; i < startOffset; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  function changeMonth(delta) {
    const d = new Date(y, m - 1 + delta, 1)
    setMonth(d.toISOString().slice(0, 7))
  }

  function handleToggleWorked(dateStr) {
    toggleWorked(emp.id, dateStr)
    onRefresh()
  }

  function handleTogglePaid(dateStr) {
    togglePaid(emp.id, dateStr)
    onRefresh()
  }

  function handlePayAll() {
    payAllPending(emp.id, month)
    onRefresh()
  }

  function handleSetExtras() {
    setExtras(emp.id, showExtras, Number(extrasVal) || 0)
    setShowExtras(null)
    setExtrasVal('')
    onRefresh()
  }

  function handleDeleteEmp() {
    deleteEmployee(emp.id)
    onRefresh()
    onBack()
  }

  function handleExportPDF() {
    const allEntries = Object.entries(att).filter(([d]) => d.startsWith(month) && att[d].worked)
    const doc = generatePayrollPDF(emp, allEntries, month)
    doc.save(`comprobante-${emp.name.split(' ')[0]}-${month}.pdf`)
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
              <div style={{ fontSize: 13, color: T.neutral[500], marginTop: 2 }}>{emp.role}{emp.phone ? ` · ${emp.phone}` : ''}</div>
              <div style={{ marginTop: 6 }}><BranchChip branch={emp.branch}/></div>
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

      {/* Month nav */}
      <SectionHeader title={`Calendario · ${fmtMonthLabel(month)}`}/>
      <div style={{ padding: '0 16px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button onClick={() => changeMonth(-1)} style={{ background: 'none', border: 'none', padding: '6px 10px', cursor: 'pointer', color: T.copper[500], fontFamily: 'inherit', fontSize: 13, fontWeight: 600 }}>‹ Anterior</button>
        <button onClick={() => changeMonth(1)} disabled={month >= currentMonth()} style={{ background: 'none', border: 'none', padding: '6px 10px', cursor: month >= currentMonth() ? 'default' : 'pointer', color: month >= currentMonth() ? T.neutral[300] : T.copper[500], fontFamily: 'inherit', fontSize: 13, fontWeight: 600 }}>Siguiente ›</button>
      </div>

      {/* Calendar */}
      <div style={{ padding: '0 16px' }}>
        <Card padding={14}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 8 }}>
            {['L','M','X','J','V','S','D'].map((d, i) => (
              <div key={i} style={{ textAlign: 'center', fontSize: 10.5, fontWeight: 600, color: T.neutral[400], letterSpacing: 0.4 }}>{d}</div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {cells.map((d, i) => {
              if (!d) return <div key={i}/>
              const dateStr = `${month}-${String(d).padStart(2, '0')}`
              const a = att[dateStr]
              const isToday = dateStr === today
              const isFuture = dateStr > today
              let bg = 'transparent', border = `1px dashed ${T.neutral[200]}`, color = T.neutral[400]
              if (a?.worked) {
                if (a.paid) { bg = T.ok; border = 'none'; color = '#fff' }
                else { bg = T.copper[400]; border = 'none'; color = '#fff' }
              } else if (!isFuture && !a) {
                bg = T.neutral[50]; border = `1px solid ${T.neutral[100]}`; color = T.neutral[400]
              }
              return (
                <div key={i} style={{ position: 'relative' }}>
                  <div
                    onClick={() => !isFuture && handleToggleWorked(dateStr)}
                    onContextMenu={e => { e.preventDefault(); if (a?.worked) { setShowExtras(dateStr); setExtrasVal(String(a.extras || '')) } }}
                    style={{
                      aspectRatio: '1/1', borderRadius: 8, background: bg, border,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      cursor: !isFuture ? 'pointer' : 'default',
                      outline: isToday ? `2px solid ${T.copper[500]}` : 'none',
                      outlineOffset: 1,
                    }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color, lineHeight: 1 }}>{d}</div>
                    {a?.extras > 0 && (
                      <div style={{ position: 'absolute', top: 3, right: 3, width: 5, height: 5, borderRadius: 999, background: '#fff' }}/>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: `0.5px solid ${T.neutral[100]}`, display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: T.neutral[600] }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: T.copper[400] }}/>Pendiente
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: T.neutral[600] }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: T.ok }}/>Pagado
            </span>
            <span style={{ fontSize: 10, color: T.neutral[400] }}>Mantén presionado para agregar extras</span>
          </div>
        </Card>
      </div>

      {/* Day list */}
      <SectionHeader
        title={`${unpaid.length} días por pagar`}
        action={unpaid.length > 0 ? 'Pagar todo' : null}
        onAction={handlePayAll}
      />
      {entries.filter(([, a]) => a.worked).length > 0 ? (
        <div style={{ padding: '0 16px' }}>
          <Card padding={0}>
            {entries.sort((a, b) => b[0].localeCompare(a[0])).filter(([, a]) => a.worked).map(([d, a], i, arr) => (
              <div key={d} style={{
                padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12,
                borderBottom: i < arr.length - 1 ? `0.5px solid ${T.neutral[100]}` : 'none',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: T.neutral[800], textTransform: 'capitalize' }}>{fmtDate(d, { weekday: true })}</div>
                  <div style={{ fontSize: 12, color: T.neutral[500], marginTop: 2 }}>
                    Día · {fmtCOP(emp.rate)}{a.extras > 0 && ` + ${fmtCOP(a.extras)} extras`}
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
        <div style={{ padding: '0 16px' }}>
          <Card padding={20}>
            <div style={{ textAlign: 'center', color: T.neutral[400], fontSize: 13 }}>Toca un día en el calendario para marcar asistencia</div>
          </Card>
        </div>
      )}

      {/* PDF + Delete */}
      <div style={{ padding: '20px 16px 0', display: 'flex', gap: 10 }}>
        <button onClick={handleExportPDF} style={{
          flex: 1, padding: '13px', borderRadius: 14, border: `1px solid ${T.copper[200]}`,
          background: T.copper[50], color: T.copper[700],
          fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 13 H13 M8 3 V10 M4 7 L8 10 L12 7" stroke={T.copper[600]} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
          PDF comprobante
        </button>
        <button onClick={() => setShowDelete(true)} style={{
          padding: '13px 18px', borderRadius: 14, border: `1px solid #E8C4BC`,
          background: '#FBF0EE', color: T.bad,
          fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
        }}>
          Eliminar
        </button>
      </div>

      {/* Extras modal */}
      {showExtras && (
        <Modal onClose={() => setShowExtras(null)} title={`Extras · ${fmtDate(showExtras, { weekday: true })}`}>
          <InputField label="Valor extras ($)" value={extrasVal} onChange={setExtrasVal} type="number" placeholder="Ej: 15000"/>
          <PrimaryButton label="Guardar" onClick={handleSetExtras}/>
        </Modal>
      )}

      {/* Delete confirm */}
      {showDelete && (
        <Modal onClose={() => setShowDelete(false)} title="¿Eliminar empleado?">
          <div style={{ fontSize: 14, color: T.neutral[500], marginBottom: 24 }}>Se eliminará {emp.name} y todos sus registros de asistencia. Esta acción no se puede deshacer.</div>
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

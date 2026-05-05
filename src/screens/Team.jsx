import { useState, useEffect, useMemo } from 'react'
import { T } from '../tokens'
import { fmtCOP, fmtDate, fmtMonthLabel, currentMonth } from '../utils/format'
import { Card, SectionHeader, Chip, BranchChip, Amount, IconButton, BackButton, Modal, InputField, PrimaryButton, EmptyState, UserAvatar } from '../components/Atoms'
import { ScreenHeader } from '../components/Nav'
import { addEmployee, updateEmployee, deleteEmployee, togglePaid, payAllPending, getData } from '../db'
import { generatePayrollPDF } from '../utils/pdf'
import { watchPendingDeductionsForEmployee, applyDeductions } from '../cashierDeductions'
import { watchAllUsers, deactivateUser, reactivateUser, rejectPendingUser } from '../users'
import { useAuth } from '../context/AuthCtx'
import { ApprovalModal, ConfirmUserModal } from './Users'

export default function Team({ filter, setFilter, employees, attendance, onRefresh, initialEmpId, onClearEmpId }) {
  const { authUser } = useAuth()
  const [empOpen, setEmpOpen] = useState(initialEmpId || null)
  const [showAddEmp, setShowAddEmp] = useState(false)
  const [users, setUsers] = useState([])
  const [tab, setTab] = useState('active')
  const [approvingUser, setApprovingUser] = useState(null)
  const [confirmUserAction, setConfirmUserAction] = useState(null)

  useEffect(() => watchAllUsers(setUsers), [])

  function openEmp(id) { setEmpOpen(id); onClearEmpId?.() }
  function closeEmp() { setEmpOpen(null) }

  if (empOpen) {
    const emp = employees.find(e => e.id === empOpen)
    if (!emp) { setEmpOpen(null); return null }
    return <EmployeeDetail emp={emp} attendance={attendance} users={users} onBack={closeEmp} onRefresh={onRefresh} />
  }

  // Categorías de personas
  const pendingUsers = users.filter(u => u.status === 'pending')
  const inactiveUsers = users.filter(u => u.status === 'inactive')

  // Activos: empleados (con su user vinculado si existe)
  const filtered = employees.filter(e => filter === 'all' || e.branch === filter)
  const stats = filtered.map(e => {
    const att = attendance[e.id] || {}
    const month = currentMonth()
    const entries = Object.entries(att).filter(([d]) => d.startsWith(month))
    const worked = entries.filter(([, a]) => a.worked).length
    const unpaid = entries.filter(([, a]) => a.worked && !a.paid)
    const owed = unpaid.reduce((s, [, a]) => s + e.rate + (a.extras || 0), 0)
    const linkedUser = users.find(u => u.linkedEmployeeId === e.id)
    return { emp: e, worked, owed, unpaidDays: unpaid.length, linkedUser }
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

      {/* Tabs */}
      <div style={{ padding: '0 20px 8px', display: 'flex', gap: 6, overflowX: 'auto' }}>
        <Chip
          label={`Activos${employees.length > 0 ? ` (${employees.length})` : ''}`}
          active={tab === 'active'}
          onClick={() => setTab('active')}
        />
        <Chip
          label={`Pendientes${pendingUsers.length > 0 ? ` · ${pendingUsers.length}` : ''}`}
          active={tab === 'pending'}
          onClick={() => setTab('pending')}
        />
        <Chip
          label={`Inactivos${inactiveUsers.length > 0 ? ` (${inactiveUsers.length})` : ''}`}
          active={tab === 'inactive'}
          onClick={() => setTab('inactive')}
        />
      </div>

      {/* Filtro por panadería (solo en activos) */}
      {tab === 'active' && (
        <div style={{ padding: '0 20px 12px', display: 'flex', gap: 8, overflowX: 'auto' }}>
          <Chip label="Todos" active={filter === 'all'} onClick={() => setFilter('all')} />
          {getData().branches.map(br => (
            <Chip key={br.id} label={br.name} active={filter === br.id} onClick={() => setFilter(br.id)} />
          ))}
        </div>
      )}

      {/* TAB ACTIVOS — empleados con asistencia/nómina */}
      {tab === 'active' && (
        <>
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
                      <div style={{
                        fontSize: 15, fontWeight: 600, color: T.neutral[800],
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}>
                        {x.emp.name.split(' ').slice(0, 2).join(' ')}
                        {x.linkedUser && (
                          <span title={`Cuenta: ${x.linkedUser.email}`} style={{
                            fontSize: 9.5, fontWeight: 700, color: T.copper[700],
                            background: T.copper[50], padding: '2px 6px', borderRadius: 999,
                            letterSpacing: 0.4, textTransform: 'uppercase',
                          }}>
                            {x.linkedUser.role === 'admin' ? 'Admin' : 'Cajera'}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: T.neutral[500], marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {x.emp.role || (x.linkedUser ? 'Cajera' : 'Empleado')} · <BranchChip branch={x.emp.branch} size="sm"/>
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
        </>
      )}

      {/* TAB PENDIENTES — usuarios esperando aprobación */}
      {tab === 'pending' && (
        <div style={{ padding: '0 16px' }}>
          {pendingUsers.length === 0 ? (
            <Card>
              <div style={{ padding: '32px 0', textAlign: 'center', color: T.neutral[500] }}>
                <div style={{ fontSize: 36, marginBottom: 8 }}>✨</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: T.neutral[700], marginBottom: 4 }}>
                  No hay solicitudes pendientes
                </div>
                <div style={{ fontSize: 12, color: T.neutral[500] }}>
                  Las solicitudes de cajeras nuevas aparecerán aquí.
                </div>
              </div>
            </Card>
          ) : (
            <Card padding={0}>
              {pendingUsers.map((u, i) => (
                <div key={u.uid} style={{
                  padding: '14px 16px',
                  display: 'flex', alignItems: 'center', gap: 12,
                  borderBottom: i < pendingUsers.length - 1 ? `0.5px solid ${T.neutral[100]}` : 'none',
                }}>
                  <UserAvatar user={u} size={40} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 14.5, fontWeight: 700, color: T.neutral[900],
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {u.nombre} {u.apellido}
                    </div>
                    <div style={{
                      fontSize: 11.5, color: T.neutral[500], marginTop: 2,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {u.email}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button
                      onClick={() => setConfirmUserAction({ user: u, action: 'reject' })}
                      style={ghostBtn(T.bad)}
                    >Rechazar</button>
                    <button
                      onClick={() => setApprovingUser(u)}
                      style={primaryBtn()}
                    >Aprobar</button>
                  </div>
                </div>
              ))}
            </Card>
          )}
        </div>
      )}

      {/* TAB INACTIVOS — usuarios desactivados */}
      {tab === 'inactive' && (
        <div style={{ padding: '0 16px' }}>
          {inactiveUsers.length === 0 ? (
            <Card>
              <div style={{ padding: '32px 0', textAlign: 'center', color: T.neutral[500] }}>
                <div style={{ fontSize: 36, marginBottom: 8 }}>📭</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: T.neutral[700], marginBottom: 4 }}>
                  No hay usuarios desactivados
                </div>
              </div>
            </Card>
          ) : (
            <Card padding={0}>
              {inactiveUsers.map((u, i) => (
                <div key={u.uid} style={{
                  padding: '14px 16px',
                  display: 'flex', alignItems: 'center', gap: 12,
                  borderBottom: i < inactiveUsers.length - 1 ? `0.5px solid ${T.neutral[100]}` : 'none',
                  opacity: 0.7,
                }}>
                  <UserAvatar user={u} size={40} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 14.5, fontWeight: 700, color: T.neutral[900],
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {u.nombre} {u.apellido}
                    </div>
                    <div style={{
                      fontSize: 11.5, color: T.neutral[500], marginTop: 2,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {u.email}
                    </div>
                  </div>
                  <button onClick={() => reactivateUser(u.uid)} style={primaryBtn()}>
                    Reactivar
                  </button>
                </div>
              ))}
            </Card>
          )}
        </div>
      )}

      {showAddEmp && <AddEmployeeModal onClose={() => setShowAddEmp(false)} onSave={() => { setShowAddEmp(false); onRefresh() }} />}

      {approvingUser && (
        <ApprovalModal
          user={approvingUser}
          adminUid={authUser.uid}
          onCancel={() => setApprovingUser(null)}
          onDone={() => { setApprovingUser(null); onRefresh?.() }}
        />
      )}

      {confirmUserAction && (
        <ConfirmUserModal
          title="Rechazar solicitud"
          message={`¿Rechazar la solicitud de ${confirmUserAction.user.nombre} ${confirmUserAction.user.apellido}? Podrá volver a solicitar acceso después.`}
          confirmLabel="Rechazar"
          confirmColor={T.bad}
          onCancel={() => setConfirmUserAction(null)}
          onConfirm={async () => {
            await rejectPendingUser(confirmUserAction.user.uid)
            setConfirmUserAction(null)
          }}
        />
      )}
    </div>
  )
}

function ghostBtn(color) {
  return {
    padding: '7px 12px', borderRadius: 10,
    background: 'transparent', color,
    border: `1px solid ${T.neutral[200]}`,
    cursor: 'pointer', fontFamily: 'inherit',
    fontSize: 12.5, fontWeight: 600,
  }
}
function primaryBtn() {
  return {
    padding: '7px 14px', borderRadius: 10,
    background: T.copper[500], color: '#fff',
    border: 'none', cursor: 'pointer', fontFamily: 'inherit',
    fontSize: 12.5, fontWeight: 700,
    boxShadow: '0 2px 6px rgba(184,122,86,0.3)',
  }
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
          {getData().branches.map(b => (
            <button key={b.id} onClick={() => setBranch(b.id)} style={{
              flex: 1, padding: '10px', borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              background: branch === b.id ? T.copper[500] : T.neutral[100],
              color: branch === b.id ? '#fff' : T.neutral[700],
              fontSize: 14, fontWeight: 600,
            }}>{b.name}</button>
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

function EmployeeDetail({ emp, attendance, users, onBack, onRefresh }) {
  const [month, setMonth] = useState(currentMonth())
  const [showDelete, setShowDelete] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [showConfirmPay, setShowConfirmPay] = useState(false)
  const [pendingDeductions, setPendingDeductions] = useState([])
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)
  const att = attendance[emp.id] || {}

  // Buscar la cuenta vinculada (si existe)
  const linkedUser = (users || []).find(u => u.linkedEmployeeId === emp.id)

  const [y, m] = month.split('-').map(Number)

  const entries = Object.entries(att).filter(([d]) => d.startsWith(month))
  const worked = entries.filter(([, a]) => a.worked).length
  const unpaid = entries.filter(([, a]) => a.worked && !a.paid)
  const grossOwed = unpaid.reduce((s, [, a]) => s + emp.rate + (a.extras || 0), 0)
  const paid = entries.filter(([, a]) => a.worked && a.paid).reduce((s, [, a]) => s + emp.rate + (a.extras || 0), 0)

  // Descuentos pendientes (Fase 6.5)
  const totalDeductions = pendingDeductions.reduce((s, d) => s + (d.amount || 0), 0)
  const owed = Math.max(0, grossOwed - totalDeductions)

  useEffect(() => {
    const unsub = watchPendingDeductionsForEmployee(emp.id, setPendingDeductions)
    return unsub
  }, [emp.id])

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

      {/* Card Cuenta — solo si tiene linkedUser */}
      {linkedUser && (
        <div style={{ padding: '10px 16px 0' }}>
          <Card padding={14} style={{
            background: linkedUser.status === 'inactive' ? T.neutral[50] : T.copper[50],
            border: `1px solid ${linkedUser.status === 'inactive' ? T.neutral[200] : T.copper[100]}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <UserAvatar user={linkedUser} size={40} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 11, fontWeight: 700,
                  color: linkedUser.status === 'inactive' ? T.neutral[500] : T.copper[700],
                  letterSpacing: 0.5, textTransform: 'uppercase',
                }}>
                  Cuenta {linkedUser.role === 'admin' ? 'Administrador' : 'Cajera'}
                </div>
                <div style={{
                  fontSize: 13, fontWeight: 600, color: T.neutral[800], marginTop: 2,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {linkedUser.email}
                </div>
                <div style={{ marginTop: 4 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700,
                    color: linkedUser.status === 'approved' ? T.ok : linkedUser.status === 'inactive' ? T.bad : T.warn,
                    background: linkedUser.status === 'approved' ? '#E8F4E8' : linkedUser.status === 'inactive' ? '#FBE9E5' : '#FFF7E6',
                    padding: '2px 8px', borderRadius: 999,
                    letterSpacing: 0.4, textTransform: 'uppercase',
                  }}>
                    {linkedUser.status === 'approved' ? 'Activa' : linkedUser.status === 'inactive' ? 'Desactivada' : linkedUser.status}
                  </span>
                </div>
              </div>
              {linkedUser.role !== 'admin' && (
                linkedUser.status === 'approved' ? (
                  <button
                    onClick={() => setConfirmDeactivate(true)}
                    style={{
                      padding: '8px 12px', borderRadius: 10,
                      background: 'transparent', color: T.bad,
                      border: `1px solid ${T.bad}55`,
                      cursor: 'pointer', fontFamily: 'inherit',
                      fontSize: 12, fontWeight: 700,
                    }}
                  >
                    Desactivar
                  </button>
                ) : linkedUser.status === 'inactive' ? (
                  <button
                    onClick={async () => { await reactivateUser(linkedUser.uid); onRefresh?.() }}
                    style={{
                      padding: '8px 12px', borderRadius: 10,
                      background: T.ok, color: '#fff',
                      border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                      fontSize: 12, fontWeight: 700,
                    }}
                  >
                    Reactivar
                  </button>
                ) : null
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Balance */}
      <div style={{ padding: '10px 16px 0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Card padding={14}>
          <div style={{ fontSize: 10.5, fontWeight: 600, color: T.neutral[400], textTransform: 'uppercase', letterSpacing: 0.6 }}>Por pagar</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: owed > 0 ? T.copper[600] : T.ok, marginTop: 4, fontVariantNumeric: 'tabular-nums', letterSpacing: -0.5 }}>
            {fmtCOP(owed, { compact: true })}
          </div>
          <div style={{ fontSize: 11, color: T.neutral[500], marginTop: 2 }}>
            {unpaid.length} días
            {totalDeductions > 0 && ` · −${fmtCOP(totalDeductions, { compact: true })} desc.`}
          </div>
        </Card>
        <Card padding={14}>
          <div style={{ fontSize: 10.5, fontWeight: 600, color: T.neutral[400], textTransform: 'uppercase', letterSpacing: 0.6 }}>Ya pagado</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: T.neutral[700], marginTop: 4, fontVariantNumeric: 'tabular-nums', letterSpacing: -0.5 }}>
            {fmtCOP(paid, { compact: true })}
          </div>
          <div style={{ fontSize: 11, color: T.neutral[500], marginTop: 2 }}>en el mes</div>
        </Card>
      </div>

      {/* Descuentos pendientes (Fase 6.5) */}
      {pendingDeductions.length > 0 && (
        <div style={{ padding: '10px 16px 0' }}>
          <Card padding={0} style={{ background: '#FBE9E5', border: `1px solid #F0C8BE`, boxShadow: 'none' }}>
            <div style={{ padding: '12px 14px', borderBottom: `1px solid #F0C8BE` }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: T.bad, letterSpacing: 0.4, textTransform: 'uppercase' }}>
                Descuentos pendientes ({pendingDeductions.length})
              </div>
              <div style={{ fontSize: 11.5, color: T.neutral[600], marginTop: 2 }}>
                Se restarán automáticamente al confirmar el próximo pago.
              </div>
            </div>
            {pendingDeductions.map((d, i) => (
              <div key={d.id} style={{
                padding: '10px 14px',
                borderBottom: i < pendingDeductions.length - 1 ? `0.5px solid #F0C8BE` : 'none',
                display: 'flex', alignItems: 'center', gap: 10,
                background: '#fff',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.neutral[800] }}>
                    {d.reason === 'cash_shortage' ? 'Falta de caja' : d.reason}
                  </div>
                  <div style={{ fontSize: 11, color: T.neutral[500], marginTop: 1 }}>
                    {d.createdAt?.toDate?.().toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }) || ''}
                  </div>
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.bad, fontVariantNumeric: 'tabular-nums' }}>
                  −{fmtCOP(d.amount)}
                </div>
              </div>
            ))}
          </Card>
        </div>
      )}

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
            Enviar comprobante y pagar · {fmtCOP(owed)}{totalDeductions > 0 ? ` (neto)` : ''}
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
          <div style={{ fontSize: 14, color: T.neutral[600], marginBottom: 12 }}>
            ¿Ya enviaste el comprobante por WhatsApp?
          </div>

          {/* Desglose */}
          <div style={{
            padding: '12px 14px', borderRadius: 12,
            background: T.neutral[50], marginBottom: 16,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13.5, color: T.neutral[700] }}>
              <span>Días trabajados ({unpaid.length})</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmtCOP(grossOwed)}</span>
            </div>
            {totalDeductions > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13.5, color: T.bad }}>
                <span>Descuentos ({pendingDeductions.length})</span>
                <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>−{fmtCOP(totalDeductions)}</span>
              </div>
            )}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
              paddingTop: 8, marginTop: 6, borderTop: `1px solid ${T.neutral[200]}`,
            }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: T.neutral[800] }}>Neto a pagar</span>
              <span style={{ fontSize: 22, fontWeight: 800, color: T.neutral[900], fontVariantNumeric: 'tabular-nums', letterSpacing: -0.4 }}>
                {fmtCOP(owed)}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setShowConfirmPay(false)} style={{
              flex: 1, padding: 13, borderRadius: 12, border: 'none',
              background: T.neutral[100], color: T.neutral[700],
              fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}>Cancelar</button>
            <button
              onClick={async () => {
                payAllPending(emp.id, month)
                if (pendingDeductions.length > 0) {
                  try {
                    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
                    await applyDeductions(pendingDeductions.map(d => d.id), today)
                  } catch (err) {
                    console.error('[deductions] error aplicando:', err)
                  }
                }
                setShowConfirmPay(false)
                onRefresh()
              }}
              style={{
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

      {/* Confirmar desactivar cuenta */}
      {confirmDeactivate && linkedUser && (
        <Modal onClose={() => setConfirmDeactivate(false)} title="¿Desactivar cuenta?">
          <div style={{ fontSize: 14, color: T.neutral[500], marginBottom: 24, lineHeight: 1.5 }}>
            <b>{linkedUser.nombre} {linkedUser.apellido}</b> ya no podrá entrar a la app.
            Su registro como empleado se conserva. Puedes reactivarla cuando quieras.
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setConfirmDeactivate(false)} style={{
              flex: 1, padding: 13, borderRadius: 12, border: 'none',
              background: T.neutral[100], color: T.neutral[700],
              fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}>Cancelar</button>
            <button onClick={async () => { await deactivateUser(linkedUser.uid); setConfirmDeactivate(false); onRefresh?.() }} style={{
              flex: 1, padding: 13, borderRadius: 12, border: 'none',
              background: T.bad, color: '#fff',
              fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}>Desactivar</button>
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
          {getData().branches.map(b => (
            <button key={b.id} onClick={() => setBranch(b.id)} style={{
              flex: 1, padding: '10px', borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              background: branch === b.id ? T.copper[500] : T.neutral[100],
              color: branch === b.id ? '#fff' : T.neutral[700],
              fontSize: 14, fontWeight: 600,
            }}>{b.name}</button>
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

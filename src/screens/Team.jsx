import { useState, useEffect } from 'react'
import { T } from '../tokens'
import { Card, BackButton, Modal, InputField, PrimaryButton, EmptyState, UserAvatar } from '../components/Atoms'
import { ScreenHeader } from '../components/Nav'
import { updateEmployee, deleteEmployee } from '../db'
import { watchAllUsers, deactivateUser, reactivateUser, rejectPendingUser } from '../users'
import { useAuth } from '../context/AuthCtx'
import { ApprovalModal, ConfirmUserModal } from './Users'

// El rol funcional (caja, cocina, mesera) se asigna por turno, no es permanente.
// Acá solo distinguimos admin vs miembro del equipo.
function accountBadge(role) {
  if (role === 'admin') return 'Admin'
  return 'Equipo'
}

export default function Team({ employees, onRefresh, initialEmpId, onClearEmpId }) {
  const { authUser } = useAuth()
  const [empOpen, setEmpOpen] = useState(initialEmpId || null)
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
    return <EmployeeDetail emp={emp} users={users} onBack={closeEmp} onRefresh={onRefresh} />
  }

  const pendingUsers = users.filter(u => u.status === 'pending')
  const inactiveUsers = users.filter(u => u.status === 'inactive')

  const rows = employees.map(e => {
    const linkedUser = users.find(u => u.linkedEmployeeId === e.id)
    return { emp: e, linkedUser }
  })

  return (
    <div style={{ paddingBottom: 110 }}>
      <ScreenHeader title="Equipo" />

      <div style={{ padding: '0 16px 12px' }}>
        <div style={{
          display: 'flex',
          background: T.neutral[100],
          padding: 3,
          borderRadius: 12,
          gap: 2,
        }}>
          {[
            { id: 'active', label: 'Activos', count: employees.length, badgeColor: null },
            { id: 'pending', label: 'Pendientes', count: pendingUsers.length, badgeColor: T.warn },
            { id: 'inactive', label: 'Inactivos', count: inactiveUsers.length, badgeColor: null },
          ].map(t => {
            const isActive = tab === t.id
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  flex: 1, padding: '8px 6px', borderRadius: 9,
                  background: isActive ? '#fff' : 'transparent',
                  color: isActive ? T.neutral[900] : T.neutral[500],
                  border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 12.5, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  transition: 'all 0.15s',
                }}
              >
                {t.label}
                {t.count > 0 && (
                  <span style={{
                    fontSize: 10, fontWeight: 800,
                    minWidth: 16, height: 16, padding: '0 4px',
                    borderRadius: 999,
                    background: isActive
                      ? (t.badgeColor || T.copper[500])
                      : (t.badgeColor ? `${t.badgeColor}30` : T.neutral[200]),
                    color: isActive
                      ? '#fff'
                      : (t.badgeColor || T.neutral[600]),
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {t.count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {tab === 'active' && (
        employees.length === 0 ? (
          <EmptyState
            icon="👥"
            title="Sin miembros del equipo"
            subtitle="Cuando alguien solicite cuenta y la apruebes, aparecerá aquí."
          />
        ) : (
          <div style={{ padding: '0 16px' }}>
            <Card padding={0}>
              {rows.map((x, i) => (
                <div key={x.emp.id} onClick={() => openEmp(x.emp.id)}
                  style={{
                    padding: '14px 16px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 12,
                    borderBottom: i < rows.length - 1 ? `0.5px solid ${T.neutral[100]}` : 'none',
                  }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 999,
                    background: T.copper[50],
                    color: T.copper[700],
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 700, fontSize: 14, flexShrink: 0,
                  }}>
                    {x.emp.name.split(' ').map(p => p[0]).slice(0, 2).join('')}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 15, fontWeight: 600, color: T.neutral[800],
                    }}>
                      {x.emp.name}
                    </div>
                    <div style={{ fontSize: 12, color: T.neutral[500], marginTop: 2 }}>
                      {x.emp.phone || 'Sin WhatsApp'}
                      {x.linkedUser?.role === 'admin' && (
                        <>
                          {' · '}
                          <span style={{
                            fontSize: 10, fontWeight: 700, color: T.copper[700],
                            letterSpacing: 0.4, textTransform: 'uppercase',
                          }}>
                            Admin
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <svg width="7" height="12" viewBox="0 0 7 12"><path d="M1 1 L6 6 L1 11" stroke={T.neutral[300]} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
              ))}
            </Card>
          </div>
        )
      )}

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
                  Las solicitudes de personas nuevas aparecerán aquí.
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

function EmployeeDetail({ emp, users, onBack, onRefresh }) {
  const [showDelete, setShowDelete] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)

  const linkedUser = (users || []).find(u => u.linkedEmployeeId === emp.id)

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

      <div style={{ padding: '12px 16px 0' }}>
        <Card padding={20}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 56, height: 56, borderRadius: 999, flexShrink: 0,
              background: T.copper[50],
              color: T.copper[700],
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: 20,
            }}>
              {emp.name.split(' ').map(p => p[0]).slice(0, 2).join('')}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: T.neutral[900], letterSpacing: -0.3 }}>{emp.name}</div>
              {emp.phone && (
                <div style={{ fontSize: 13, color: T.neutral[500], marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {emp.phone}
                  <a href={`https://wa.me/57${emp.phone.replace(/\D/g,'')}`} target="_blank" rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    style={{ color: '#25D366', fontWeight: 600, textDecoration: 'none', fontSize: 12 }}>
                    WhatsApp
                  </a>
                </div>
              )}
            </div>
          </div>
        </Card>
      </div>

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
                  Cuenta · {accountBadge(linkedUser.role)}
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

      <div style={{ padding: '20px 16px 0', display: 'flex', gap: 10 }}>
        <button onClick={() => setShowEdit(true)} style={{
          flex: 1, padding: '13px', borderRadius: 14, border: `1px solid ${T.neutral[200]}`,
          background: '#fff', color: T.neutral[700],
          fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3 L13 6 L6 13 H3 V10 Z" stroke={T.neutral[600]} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          Editar
        </button>
        <button onClick={() => setShowDelete(true)} style={{
          padding: '13px 16px', borderRadius: 14, border: `1px solid #E8C4BC`,
          background: '#FBF0EE', color: T.bad,
          fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
        }}>
          Eliminar
        </button>
      </div>

      {showEdit && (
        <EditEmployeeModal emp={emp} onClose={() => setShowEdit(false)} onSave={() => { setShowEdit(false); onRefresh() }}/>
      )}

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
  const [phone, setPhone] = useState(emp.phone || '')

  const canSave = name.trim() && phone.trim()

  function handleSave() {
    if (!canSave) return
    updateEmployee(emp.id, { name: name.trim(), phone: phone.trim() })
    onSave()
  }

  return (
    <Modal onClose={onClose} title="Editar empleado">
      <InputField label="Nombre completo" value={name} onChange={setName} placeholder="Ej: María López"/>
      <InputField label="WhatsApp" value={phone} onChange={setPhone} type="tel" placeholder="Ej: 301 234 5678"/>
      <PrimaryButton label="Guardar cambios" onClick={handleSave} disabled={!canSave}/>
    </Modal>
  )
}

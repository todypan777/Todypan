import { useState, useEffect } from 'react'
import { T } from '../tokens'
import { Card, BackButton, Modal, InputField, EmptyState, UserAvatar } from '../components/Atoms'
import { ScreenHeader } from '../components/Nav'
import { updateEmployee, deleteEmployee } from '../db'
import { watchAllUsers, rejectPendingUser } from '../users'
import { useAuth } from '../context/AuthCtx'
import { ApprovalModal, ConfirmUserModal } from './Users'

export default function Team({ employees, onRefresh, initialEmpId, onClearEmpId }) {
  const { authUser } = useAuth()
  const [empOpen, setEmpOpen] = useState(initialEmpId || null)
  const [users, setUsers] = useState([])
  const [showPending, setShowPending] = useState(false)
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

  const rows = employees.map(e => {
    const linkedUser = users.find(u => u.linkedEmployeeId === e.id)
    return { emp: e, linkedUser }
  })

  return (
    <div style={{ paddingBottom: 110 }}>
      <ScreenHeader title="Equipo" />

      {/* Banner: solicitudes pendientes (solo si hay) */}
      {pendingUsers.length > 0 && (
        <div style={{ padding: '0 16px 12px' }}>
          <button
            onClick={() => setShowPending(true)}
            style={{
              width: '100%', padding: '14px 16px', borderRadius: 14,
              background: T.copper[50], border: `1px solid ${T.copper[200]}`,
              cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
              display: 'flex', alignItems: 'center', gap: 12,
            }}
          >
            <div style={{
              width: 32, height: 32, borderRadius: 999,
              background: T.copper[500], color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, fontWeight: 800,
              fontVariantNumeric: 'tabular-nums',
              flexShrink: 0,
            }}>
              {pendingUsers.length}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.copper[800] }}>
                {pendingUsers.length === 1 ? '1 solicitud pendiente' : `${pendingUsers.length} solicitudes pendientes`}
              </div>
              <div style={{ fontSize: 12, color: T.copper[700], marginTop: 2 }}>
                Toca para revisarlas y aprobar
              </div>
            </div>
            <svg width="7" height="12" viewBox="0 0 7 12">
              <path d="M1 1 L6 6 L1 11" stroke={T.copper[600]} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      )}

      {employees.length === 0 ? (
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
                  <div style={{ fontSize: 15, fontWeight: 600, color: T.neutral[800] }}>
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
                <svg width="7" height="12" viewBox="0 0 7 12">
                  <path d="M1 1 L6 6 L1 11" stroke={T.neutral[300]} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            ))}
          </Card>
        </div>
      )}

      {/* Modal lista de pendientes */}
      {showPending && (
        <PendingUsersModal
          users={pendingUsers}
          onClose={() => setShowPending(false)}
          onApprove={u => setApprovingUser(u)}
          onReject={u => setConfirmUserAction({ user: u, action: 'reject' })}
        />
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

function PendingUsersModal({ users, onClose, onApprove, onReject }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 90,
      background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 480, maxHeight: '92vh', overflowY: 'auto',
        background: '#fff', borderRadius: '20px 20px 0 0',
        boxShadow: '0 -8px 32px rgba(0,0,0,0.15)',
      }}>
        <div style={{
          position: 'sticky', top: 0, background: '#fff', zIndex: 2,
          padding: '18px 20px 14px', borderBottom: `1px solid ${T.neutral[100]}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3 }}>
            Solicitudes pendientes
          </div>
          <button onClick={onClose} style={{
            width: 32, height: 32, borderRadius: 999, border: 'none',
            background: T.neutral[100], color: T.neutral[700],
            cursor: 'pointer', fontSize: 18, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'inherit',
          }}>×</button>
        </div>

        <div style={{ padding: '8px 16px 24px' }}>
          {users.map((u, i) => (
            <div key={u.uid} style={{
              padding: '14px 4px',
              display: 'flex', alignItems: 'center', gap: 12,
              borderBottom: i < users.length - 1 ? `0.5px solid ${T.neutral[100]}` : 'none',
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
                <button onClick={() => onReject(u)} style={ghostBtn(T.bad)}>Rechazar</button>
                <button onClick={() => onApprove(u)} style={primaryBtn()}>Aprobar</button>
              </div>
            </div>
          ))}
        </div>
      </div>
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

// ──────────────────────────────────────────────────────────────
// Detalle / edición inline del empleado
// ──────────────────────────────────────────────────────────────
function EmployeeDetail({ emp, users, onBack, onRefresh }) {
  const [name, setName] = useState(emp.name || '')
  const [phone, setPhone] = useState(emp.phone || '')
  const [showDelete, setShowDelete] = useState(false)

  const linkedUser = (users || []).find(u => u.linkedEmployeeId === emp.id)

  const dirty = name.trim() !== (emp.name || '').trim() || phone.trim() !== (emp.phone || '').trim()
  const canSave = dirty && name.trim() && phone.trim()

  function handleSave() {
    if (!canSave) return
    updateEmployee(emp.id, { name: name.trim(), phone: phone.trim() })
    onRefresh()
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

      {/* Avatar + nombre grande */}
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
              {(name || '?').split(' ').map(p => p[0]).slice(0, 2).join('')}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: T.neutral[900], letterSpacing: -0.3 }}>
                {name || 'Sin nombre'}
              </div>
              {phone && (
                <a href={`https://wa.me/57${phone.replace(/\D/g,'')}`} target="_blank" rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  style={{ display: 'inline-block', marginTop: 4, color: '#25D366', fontWeight: 600, textDecoration: 'none', fontSize: 12 }}>
                  WhatsApp
                </a>
              )}
            </div>
          </div>
        </Card>
      </div>

      {/* Cuenta vinculada (read-only) */}
      {linkedUser && (
        <div style={{ padding: '10px 16px 0' }}>
          <Card padding={14} style={{
            background: T.copper[50],
            border: `1px solid ${T.copper[100]}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <UserAvatar user={linkedUser} size={40} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 11, fontWeight: 700, color: T.copper[700],
                  letterSpacing: 0.5, textTransform: 'uppercase',
                }}>
                  Cuenta {linkedUser.role === 'admin' ? '· Admin' : ''}
                </div>
                <div style={{
                  fontSize: 13, fontWeight: 600, color: T.neutral[800], marginTop: 2,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {linkedUser.email}
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Campos editables inline */}
      <div style={{ padding: '14px 16px 0' }}>
        <Card padding={18}>
          <InputField
            label="Nombre completo"
            value={name}
            onChange={setName}
            placeholder="Ej: María López"
          />
          <InputField
            label="WhatsApp"
            value={phone}
            onChange={setPhone}
            type="tel"
            placeholder="Ej: 301 234 5678"
          />

          <button
            onClick={handleSave}
            disabled={!canSave}
            style={{
              width: '100%', marginTop: 6, padding: '13px',
              borderRadius: 12, border: 'none',
              background: canSave ? T.copper[500] : T.neutral[200],
              color: canSave ? '#fff' : T.neutral[400],
              cursor: canSave ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
              boxShadow: canSave ? '0 3px 10px rgba(184,122,86,0.3)' : 'none',
            }}
          >
            Guardar cambios
          </button>
        </Card>
      </div>

      {/* Eliminar */}
      <div style={{ padding: '24px 16px 0' }}>
        <button onClick={() => setShowDelete(true)} style={{
          width: '100%', padding: '13px', borderRadius: 14,
          border: `1px solid #E8C4BC`,
          background: '#FBF0EE', color: T.bad,
          fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
        }}>
          Eliminar cuenta
        </button>
      </div>

      {showDelete && (
        <Modal onClose={() => setShowDelete(false)} title="¿Eliminar cuenta?">
          <div style={{ fontSize: 14, color: T.neutral[500], marginBottom: 24, lineHeight: 1.5 }}>
            Se eliminará <b>{emp.name}</b> del equipo. Esta acción no se puede deshacer.
          </div>
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

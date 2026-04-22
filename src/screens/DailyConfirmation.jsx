import { useState } from 'react'
import { T } from '../tokens'
import { fmtCOP, fmtDate } from '../utils/format'
import { Card, BranchChip, Modal, InputField, PrimaryButton } from '../components/Atoms'
import {
  confirmDay, addEmployee, calcHourRate, calcExtraPay, getBogotaDateStr, getData,
} from '../db'

const DAY_NAMES = ['dom','lun','mar','mié','jue','vie','sáb']

export default function DailyConfirmation({ date, employees, attendance, onDone, onRefresh }) {
  const scheduled = employees.filter(e => {
    if (e.type === 'occasional') return false
    const dayOfWeek = new Date(date + 'T00:00:00').getDay()
    return e.restDay !== dayOfWeek
  })

  const [entries, setEntries] = useState(() =>
    scheduled.map(e => {
      const a = attendance[e.id]?.[date]
      // Buscar si alguien ya reemplazó a este empleado en esta fecha
      const replacerEntry = Object.entries(attendance).find(
        ([rId, rDates]) => rId !== e.id && rDates[date]?.replacedFor === e.id
      )
      return {
        empId: e.id,
        worked: a ? !!a.worked : true,
        extraHours: a?.extraHours || 0,
        replacedBy: replacerEntry ? replacerEntry[0] : null,
        replacedByName: null,
        replacerExtraHours: replacerEntry ? (replacerEntry[1][date]?.extraHours || 0) : 0,
      }
    })
  )
  const [replacerModal, setReplacerModal] = useState(null) // empId of absent employee
  const [createOccasional, setCreateOccasional] = useState(false)

  const occasionals = employees.filter(e => e.type === 'occasional')

  function updateEntry(empId, changes) {
    setEntries(prev => prev.map(e => e.empId === empId ? { ...e, ...changes } : e))
  }

  function handleConfirm() {
    confirmDay(date, entries)
    onRefresh()
    onDone()
  }

  const displayDate = fmtDate(date, { weekday: true })

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(23,22,19,0.85)',
      display: 'flex', alignItems: 'flex-end',
    }}>
      <div style={{
        width: '100%', background: T.neutral[50],
        borderRadius: '28px 28px 0 0',
        maxHeight: '92vh', overflowY: 'auto',
        padding: '0 0 40px',
        animation: 'slideUp 0.3s cubic-bezier(0.2,0.9,0.3,1)',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 20px 16px',
          background: T.neutral[900],
          borderRadius: '28px 28px 0 0',
          position: 'sticky', top: 0, zIndex: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 999, background: T.copper[500],
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M10 3 V10 L14 13" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="10" cy="10" r="7.5" stroke="#fff" strokeWidth="1.5"/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 13, color: T.copper[300], fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                Confirmación del día
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', letterSpacing: -0.3, textTransform: 'capitalize' }}>
                {displayDate}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 12, fontSize: 13, color: 'rgba(255,255,255,0.55)' }}>
            Confirma la asistencia de cada empleado. Ajusta horas extra si las hubo.
          </div>
        </div>

        {scheduled.length === 0 && (
          <div style={{ padding: '40px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 36 }}>✅</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: T.neutral[700], marginTop: 12 }}>
              No hay empleados programados hoy
            </div>
            <div style={{ marginTop: 20 }}>
              <PrimaryButton label="Cerrar" onClick={onDone}/>
            </div>
          </div>
        )}

        {/* Employee list */}
        {entries.map(entry => {
          const emp = employees.find(e => e.id === entry.empId)
          if (!emp) return null
          const hourRate = calcHourRate(emp.rate, emp.workHours || 9)
          const extraPay = calcExtraPay(hourRate, entry.extraHours)
          const totalPay = entry.worked ? emp.rate + extraPay : 0
          const replacerEmp = entry.replacedBy ? employees.find(e => e.id === entry.replacedBy) : null

          return (
            <div key={entry.empId} style={{ padding: '0 16px', marginTop: 12 }}>
              <Card padding={16} style={{ border: entry.worked ? `1.5px solid ${T.ok}30` : `1.5px solid ${T.bad}30` }}>
                {/* Employee header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: 999, flexShrink: 0,
                    background: T.branch[emp.branch]?.tagBg || T.neutral[100],
                    color: T.branch[emp.branch]?.tag || T.neutral[600],
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 700, fontSize: 16,
                  }}>
                    {emp.name.split(' ').map(p => p[0]).slice(0, 2).join('')}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: T.neutral[900] }}>{emp.name.split(' ').slice(0, 2).join(' ')}</div>
                    <div style={{ fontSize: 12, color: T.neutral[500], marginTop: 2, display: 'flex', gap: 6, alignItems: 'center' }}>
                      {emp.role} · <BranchChip branch={emp.branch} size="sm"/>
                    </div>
                  </div>
                  {/* Worked toggle */}
                  <div style={{ display: 'flex', background: T.neutral[100], borderRadius: 10, padding: 2 }}>
                    <button onClick={() => updateEntry(entry.empId, { worked: true })} style={{
                      padding: '6px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                      background: entry.worked ? T.ok : 'transparent',
                      color: entry.worked ? '#fff' : T.neutral[500],
                      fontSize: 12, fontWeight: 700,
                    }}>✓ Fue</button>
                    <button onClick={() => updateEntry(entry.empId, { worked: false, extraHours: 0 })} style={{
                      padding: '6px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                      background: !entry.worked ? T.bad : 'transparent',
                      color: !entry.worked ? '#fff' : T.neutral[500],
                      fontSize: 12, fontWeight: 700,
                    }}>✗ No fue</button>
                  </div>
                </div>

                {/* If worked: extra hours */}
                {entry.worked && (
                  <div style={{
                    padding: '12px 14px', borderRadius: 12,
                    background: T.neutral[50], border: `1px solid ${T.neutral[100]}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: T.neutral[400], textTransform: 'uppercase', letterSpacing: 0.5 }}>Horas extra</div>
                        <div style={{ fontSize: 11, color: T.neutral[400], marginTop: 2 }}>
                          {fmtCOP(hourRate)} / hora · jornada de {emp.workHours || 9}h
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <button onClick={() => updateEntry(entry.empId, { extraHours: Math.max(-8, (entry.extraHours || 0) - 0.5) })} style={hourBtn}>−</button>
                        <div style={{ minWidth: 36, textAlign: 'center' }}>
                          <div style={{ fontSize: 16, fontWeight: 700, color: entry.extraHours > 0 ? T.ok : entry.extraHours < 0 ? T.bad : T.neutral[700] }}>
                            {entry.extraHours > 0 ? '+' : ''}{entry.extraHours}h
                          </div>
                        </div>
                        <button onClick={() => updateEntry(entry.empId, { extraHours: Math.min(12, (entry.extraHours || 0) + 0.5) })} style={hourBtn}>+</button>
                      </div>
                    </div>
                    {entry.extraHours !== 0 && (
                      <div style={{
                        marginTop: 10, paddingTop: 10, borderTop: `0.5px solid ${T.neutral[100]}`,
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      }}>
                        <span style={{ fontSize: 13, color: T.neutral[600] }}>Total del día</span>
                        <span style={{ fontSize: 15, fontWeight: 700, color: T.neutral[900], fontVariantNumeric: 'tabular-nums' }}>
                          {fmtCOP(totalPay)}
                          <span style={{ fontSize: 11, color: entry.extraHours > 0 ? T.ok : T.bad, marginLeft: 6 }}>
                            ({entry.extraHours > 0 ? '+' : ''}{fmtCOP(extraPay)})
                          </span>
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* If didn't work: replacement */}
                {!entry.worked && (
                  <div style={{ padding: '12px 14px', borderRadius: 12, background: '#FBF0EE', border: `1px solid #E8C4BC` }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: T.bad, marginBottom: 10 }}>
                      ¿Quién cubrió el turno?
                    </div>
                    {entry.replacedBy || entry.replacedByName ? (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: T.neutral[800] }}>
                            {replacerEmp ? replacerEmp.name.split(' ').slice(0,2).join(' ') : entry.replacedByName}
                          </div>
                          {replacerEmp && (
                            <div style={{ marginTop: 6 }}>
                              <div style={{ fontSize: 11, color: T.neutral[500], marginBottom: 4 }}>Horas extra del reemplazo:</div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <button onClick={() => updateEntry(entry.empId, { replacerExtraHours: Math.max(-8, (entry.replacerExtraHours || 0) - 0.5) })} style={hourBtn}>−</button>
                                <span style={{ fontSize: 14, fontWeight: 700, color: T.neutral[800], minWidth: 32, textAlign: 'center' }}>
                                  {entry.replacerExtraHours > 0 ? '+' : ''}{entry.replacerExtraHours || 0}h
                                </span>
                                <button onClick={() => updateEntry(entry.empId, { replacerExtraHours: Math.min(12, (entry.replacerExtraHours || 0) + 0.5) })} style={hourBtn}>+</button>
                              </div>
                            </div>
                          )}
                        </div>
                        <button onClick={() => updateEntry(entry.empId, { replacedBy: null, replacedByName: null, replacerExtraHours: 0 })} style={{
                          padding: '6px 10px', borderRadius: 8, border: 'none',
                          background: T.neutral[100], color: T.neutral[600],
                          fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                        }}>Cambiar</button>
                      </div>
                    ) : (
                      <button onClick={() => setReplacerModal(entry.empId)} style={{
                        width: '100%', padding: '10px', borderRadius: 10,
                        border: `1.5px dashed ${T.bad}60`, background: 'transparent',
                        color: T.bad, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      }}>
                        + Asignar reemplazo
                      </button>
                    )}
                    <div style={{ marginTop: 8, fontSize: 11, color: T.bad + 'AA' }}>
                      Nadie cubrió → este día no se paga
                    </div>
                  </div>
                )}
              </Card>
            </div>
          )
        })}

        {/* Confirm button */}
        {scheduled.length > 0 && (
          <div style={{ padding: '20px 16px 0' }}>
            <button onClick={handleConfirm} style={{
              width: '100%', padding: '16px', borderRadius: 16, border: 'none',
              background: T.copper[500], color: '#fff',
              fontSize: 16, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              letterSpacing: 0.2,
            }}>
              Confirmar asistencia del día
            </button>
          </div>
        )}

        <div style={{ padding: '12px 20px 0', textAlign: 'center' }}>
          <button onClick={onDone} style={{
            background: 'none', border: 'none', color: T.neutral[400],
            fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', padding: '4px 0',
          }}>Hacerlo más tarde</button>
        </div>
      </div>

      {/* Replacer picker modal */}
      {replacerModal && (
        <ReplacerModal
          absentEmpId={replacerModal}
          employees={employees}
          occasionals={occasionals}
          onSelect={(empId, name) => {
            updateEntry(replacerModal, { replacedBy: empId || null, replacedByName: name || null, replacerExtraHours: 0 })
            setReplacerModal(null)
          }}
          onCreateOccasional={() => { setReplacerModal(null); setCreateOccasional(replacerModal) }}
          onClose={() => setReplacerModal(null)}
        />
      )}

      {/* Create occasional employee */}
      {createOccasional && (
        <CreateOccasionalModal
          onClose={() => setCreateOccasional(null)}
          onSave={(emp) => {
            const id = addEmployee({ ...emp, type: 'occasional', restDay: null })
            updateEntry(createOccasional, { replacedBy: id, replacedByName: null, replacerExtraHours: 0 })
            setCreateOccasional(null)
            onRefresh()
          }}
        />
      )}
    </div>
  )
}

function ReplacerModal({ absentEmpId, employees, onSelect, onCreateOccasional, onClose }) {
  const [search, setSearch] = useState('')
  const available = employees.filter(e =>
    e.id !== absentEmpId &&
    (e.name.toLowerCase().includes(search.toLowerCase()) || e.role?.toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'flex-end',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', background: '#fff',
        borderRadius: '24px 24px 0 0', padding: '20px 20px 40px',
        maxHeight: '75vh', overflowY: 'auto',
      }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: T.neutral[900], marginBottom: 14 }}>¿Quién reemplazó?</div>
        <InputField value={search} onChange={setSearch} placeholder="Buscar por nombre..."/>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {available.map((e, i) => (
            <button key={e.id} onClick={() => onSelect(e.id, null)} style={{
              padding: '13px 0', background: 'none', border: 'none',
              borderBottom: i < available.length - 1 ? `0.5px solid ${T.neutral[100]}` : 'none',
              display: 'flex', alignItems: 'center', gap: 12,
              cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', width: '100%',
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 999, flexShrink: 0,
                background: T.branch[e.branch]?.tagBg || T.neutral[100],
                color: T.branch[e.branch]?.tag || T.neutral[600],
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: 13,
              }}>
                {e.name.split(' ').map(p => p[0]).slice(0,2).join('')}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: T.neutral[800] }}>{e.name.split(' ').slice(0,2).join(' ')}</div>
                <div style={{ fontSize: 12, color: T.neutral[500] }}>
                  {e.role} · {e.type === 'occasional' ? 'Ocasional' : <BranchChip branch={e.branch} size="sm"/>}
                </div>
              </div>
              <div style={{ fontSize: 12, color: T.copper[500], fontWeight: 600 }}>{fmtCOP(e.rate)}/día</div>
            </button>
          ))}
        </div>
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <button onClick={onCreateOccasional} style={{
            flex: 1, padding: '12px', borderRadius: 12,
            border: `1.5px dashed ${T.copper[300]}`, background: T.copper[50],
            color: T.copper[600], fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}>+ Crear empleado ocasional</button>
        </div>
      </div>
    </div>
  )
}

function CreateOccasionalModal({ onClose, onSave }) {
  const [name, setName] = useState('')
  const [rate, setRate] = useState('')
  const [role, setRole] = useState('')
  const [branch, setBranch] = useState(1)

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 300,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'flex-end',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', background: '#fff',
        borderRadius: '24px 24px 0 0', padding: '24px 20px 40px',
      }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: T.neutral[900], marginBottom: 16 }}>Empleado ocasional</div>
        <InputField label="Nombre completo" value={name} onChange={setName} placeholder="Ej: Pedro García"/>
        <InputField label="Cargo (opcional)" value={role} onChange={setRole} placeholder="Ej: Panadero"/>
        <InputField label="Valor día ($)" value={rate} onChange={setRate} type="number" placeholder="Ej: 65000"/>
        <div style={{ marginBottom: 16 }}>
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
        <PrimaryButton
          label="Crear y asignar reemplazo"
          onClick={() => name && rate && onSave({ name, role, branch, rate: Number(rate) })}
          disabled={!name || !rate}
        />
      </div>
    </div>
  )
}

// Also export an edit version for past days
export function DayEditModal({ date, employees, attendance, onDone, onRefresh }) {
  const scheduled = employees.filter(e => e.type !== 'occasional')
  const [entries, setEntries] = useState(() =>
    scheduled.map(e => {
      const a = attendance[e.id]?.[date]
      return {
        empId: e.id,
        worked: a?.worked || false,
        extraHours: a?.extraHours || 0,
        replacedBy: a?.replacedBy || null,
        replacedByName: a?.replacedByName || null,
        replacerExtraHours: 0,
      }
    })
  )

  function updateEntry(empId, changes) {
    setEntries(prev => prev.map(e => e.empId === empId ? { ...e, ...changes } : e))
  }

  function handleSave() {
    confirmDay(date, entries)
    onRefresh()
    onDone()
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 150,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'flex-end',
    }} onClick={onDone}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', background: T.neutral[50],
        borderRadius: '24px 24px 0 0',
        maxHeight: '85vh', overflowY: 'auto',
        padding: '24px 16px 40px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: T.neutral[900], textTransform: 'capitalize' }}>
            Editar · {fmtDate(date, { weekday: true })}
          </div>
          <button onClick={onDone} style={{ background: 'none', border: 'none', fontSize: 22, color: T.neutral[400], cursor: 'pointer' }}>×</button>
        </div>

        {scheduled.map(emp => {
          const entry = entries.find(e => e.empId === emp.id)
          if (!entry) return null
          const hourRate = calcHourRate(emp.rate, emp.workHours || 9)
          const extraPay = calcExtraPay(hourRate, entry.extraHours)
          const dayOfWeek = new Date(date + 'T00:00:00').getDay()
          const isRestDay = emp.restDay === dayOfWeek

          return (
            <div key={emp.id} style={{ marginBottom: 12 }}>
              <Card padding={14}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: isRestDay ? 0 : 12 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 999, flexShrink: 0,
                    background: T.branch[emp.branch]?.tagBg || T.neutral[100],
                    color: T.branch[emp.branch]?.tag || T.neutral[600],
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 700, fontSize: 13,
                  }}>
                    {emp.name.split(' ').map(p => p[0]).slice(0,2).join('')}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: T.neutral[800] }}>{emp.name.split(' ').slice(0,2).join(' ')}</div>
                    {isRestDay && <div style={{ fontSize: 11, color: T.neutral[400] }}>Día de descanso programado</div>}
                  </div>
                  <div style={{ display: 'flex', background: T.neutral[100], borderRadius: 8, padding: 2 }}>
                    <button onClick={() => updateEntry(emp.id, { worked: true })} style={{
                      padding: '5px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                      background: entry.worked ? T.ok : 'transparent',
                      color: entry.worked ? '#fff' : T.neutral[500], fontSize: 12, fontWeight: 700,
                    }}>✓</button>
                    <button onClick={() => updateEntry(emp.id, { worked: false, extraHours: 0 })} style={{
                      padding: '5px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                      background: !entry.worked ? T.bad : 'transparent',
                      color: !entry.worked ? '#fff' : T.neutral[500], fontSize: 12, fontWeight: 700,
                    }}>✗</button>
                  </div>
                </div>
                {entry.worked && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontSize: 12, color: T.neutral[500] }}>
                      Horas extra · <span style={{ color: T.neutral[700] }}>{fmtCOP(hourRate)}/h</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button onClick={() => updateEntry(emp.id, { extraHours: Math.max(-8, (entry.extraHours || 0) - 0.5) })} style={hourBtn}>−</button>
                      <span style={{ fontSize: 14, fontWeight: 700, color: entry.extraHours !== 0 ? (entry.extraHours > 0 ? T.ok : T.bad) : T.neutral[600], minWidth: 32, textAlign: 'center' }}>
                        {entry.extraHours > 0 ? '+' : ''}{entry.extraHours}h
                      </span>
                      <button onClick={() => updateEntry(emp.id, { extraHours: Math.min(12, (entry.extraHours || 0) + 0.5) })} style={hourBtn}>+</button>
                    </div>
                  </div>
                )}
                {entry.worked && entry.extraHours !== 0 && (
                  <div style={{ marginTop: 8, fontSize: 12, color: T.neutral[500], textAlign: 'right' }}>
                    Total: <strong style={{ color: T.neutral[800] }}>{fmtCOP(emp.rate + extraPay)}</strong>
                  </div>
                )}
              </Card>
            </div>
          )
        })}

        <PrimaryButton label="Guardar cambios" onClick={handleSave}/>
      </div>
    </div>
  )
}

const hourBtn = {
  width: 32, height: 32, borderRadius: 999, border: 'none',
  background: T.neutral[100], color: T.neutral[700],
  fontSize: 18, fontWeight: 700, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontFamily: 'inherit', lineHeight: 1,
}

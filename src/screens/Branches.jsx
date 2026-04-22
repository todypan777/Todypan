import { useState } from 'react'
import { T, BRANCH_PALETTE } from '../tokens'
import { Card, BackButton, Modal, InputField, PrimaryButton } from '../components/Atoms'
import { ScreenHeader } from '../components/Nav'
import { updateBranch } from '../db'

export default function Branches({ branches, onBack, onRefresh }) {
  const [editId, setEditId] = useState(null)

  return (
    <div style={{ paddingBottom: 110 }}>
      <div style={{ padding: '56px 16px 0' }}>
        <BackButton onBack={onBack} label="Más"/>
      </div>
      <ScreenHeader title="Panaderías"/>

      <div style={{ padding: '8px 16px 0' }}>
        <Card padding={0}>
          {branches.map((b, i) => {
            const pal = BRANCH_PALETTE[b.colorKey] || BRANCH_PALETTE.copper
            return (
              <div key={b.id} style={{
                padding: '16px', display: 'flex', alignItems: 'center', gap: 14,
                borderBottom: i < branches.length - 1 ? `0.5px solid ${T.neutral[100]}` : 'none',
              }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                  background: pal.light,
                  border: `1.5px solid ${pal.border}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="22" height="22" viewBox="0 0 20 20">
                    <path d="M3 9 L10 4 L17 9 V16 H3 Z" stroke={pal.main} strokeWidth="1.6" fill="none" strokeLinejoin="round"/>
                    <path d="M8 16 V12 H12 V16" stroke={pal.main} strokeWidth="1.6" fill="none"/>
                  </svg>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: T.neutral[900] }}>{b.name}</div>
                  <div style={{ fontSize: 12, color: pal.main, fontWeight: 600, marginTop: 2 }}>
                    {pal.label}
                  </div>
                </div>
                <button onClick={() => setEditId(b.id)} style={{
                  padding: '7px 14px', borderRadius: 10, border: 'none',
                  background: T.neutral[100], color: T.neutral[700],
                  fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                }}>Editar</button>
              </div>
            )
          })}
        </Card>
      </div>

      <div style={{ padding: '16px 20px 0', fontSize: 12, color: T.neutral[400], textAlign: 'center' }}>
        El color aparece en el formulario de movimientos para evitar errores.
      </div>

      {editId && (
        <EditBranchModal
          branch={branches.find(b => b.id === editId)}
          onClose={() => setEditId(null)}
          onSave={updates => {
            updateBranch(editId, updates)
            setEditId(null)
            onRefresh()
          }}
        />
      )}
    </div>
  )
}

function EditBranchModal({ branch, onClose, onSave }) {
  const [name, setName] = useState(branch?.name || '')
  const [colorKey, setColorKey] = useState(branch?.colorKey || 'copper')

  return (
    <Modal onClose={onClose} title="Editar panadería">
      <InputField label="Nombre" value={name} onChange={setName} placeholder="Ej: Panadería Centro"/>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: T.neutral[500], textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
          Color del formulario
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {Object.entries(BRANCH_PALETTE).map(([key, pal]) => {
            const isActive = colorKey === key
            return (
              <button key={key} onClick={() => setColorKey(key)} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12,
                  background: pal.light,
                  border: isActive ? `2.5px solid ${pal.main}` : `1.5px solid ${pal.border}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.15s',
                  boxShadow: isActive ? `0 2px 8px ${pal.main}44` : 'none',
                }}>
                  <div style={{ width: 20, height: 20, borderRadius: 999, background: pal.main }}/>
                </div>
                <span style={{
                  fontSize: 11, fontWeight: isActive ? 700 : 500,
                  color: isActive ? pal.main : T.neutral[400],
                }}>
                  {pal.label}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Preview */}
      {(() => {
        const pal = BRANCH_PALETTE[colorKey] || BRANCH_PALETTE.copper
        return (
          <div style={{
            marginBottom: 20, padding: '12px 16px', borderRadius: 14,
            background: pal.light, border: `1px solid ${pal.border}`,
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: pal.text, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
              Vista previa
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: pal.main }}>
              {name || 'Nombre de la panadería'}
            </div>
          </div>
        )
      })()}

      <PrimaryButton
        label="Guardar"
        onClick={() => name && onSave({ name: name.trim(), colorKey })}
        disabled={!name}
      />
    </Modal>
  )
}

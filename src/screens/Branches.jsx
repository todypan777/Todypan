import { useState } from 'react'
import { T } from '../tokens'
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
          {branches.map((b, i) => (
            <div key={b.id} style={{
              padding: '16px', display: 'flex', alignItems: 'center', gap: 14,
              borderBottom: i < branches.length - 1 ? `0.5px solid ${T.neutral[100]}` : 'none',
            }}>
              <div style={{
                width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                background: T.branch[b.id]?.tagBg || T.neutral[100],
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="22" height="22" viewBox="0 0 20 20">
                  <path d="M3 9 L10 4 L17 9 V16 H3 Z" stroke={T.branch[b.id]?.tag || T.neutral[500]} strokeWidth="1.6" fill="none" strokeLinejoin="round"/>
                  <path d="M8 16 V12 H12 V16" stroke={T.branch[b.id]?.tag || T.neutral[500]} strokeWidth="1.6" fill="none"/>
                </svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: T.neutral[900] }}>{b.name}</div>
                <div style={{ fontSize: 12, color: T.neutral[500], marginTop: 2 }}>Panadería {i + 1}</div>
              </div>
              <button onClick={() => setEditId(b.id)} style={{
                padding: '7px 14px', borderRadius: 10, border: 'none',
                background: T.neutral[100], color: T.neutral[700],
                fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              }}>Editar</button>
            </div>
          ))}
        </Card>
      </div>

      <div style={{ padding: '16px 20px 0', fontSize: 12, color: T.neutral[400], textAlign: 'center' }}>
        Los filtros y reportes usarán estos nombres en toda la app.
      </div>

      {editId && (
        <EditBranchModal
          branch={branches.find(b => b.id === editId)}
          onClose={() => setEditId(null)}
          onSave={name => {
            updateBranch(editId, name)
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
  return (
    <Modal onClose={onClose} title="Editar panadería">
      <InputField label="Nombre" value={name} onChange={setName} placeholder="Ej: Panadería Centro"/>
      <PrimaryButton label="Guardar" onClick={() => name && onSave(name)} disabled={!name}/>
    </Modal>
  )
}

import { useState } from 'react'
import { T, BRANCH_PALETTE } from '../tokens'
import { Card, BackButton, Modal, InputField, PrimaryButton } from '../components/Atoms'
import { ScreenHeader } from '../components/Nav'
import { updateBranch } from '../db'
import { FEATURES, branchFeatures } from '../utils/features'

export default function Branches({ branches, onBack, onRefresh }) {
  const [editId, setEditId] = useState(null)

  return (
    <div style={{ paddingBottom: 110 }}>
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
  const [features, setFeatures] = useState(() => branchFeatures(branch))

  const toggle = (key) => setFeatures(f => ({ ...f, [key]: !f[key] }))

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

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: T.neutral[500], textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
          Qué usa esta panadería
        </div>
        <div style={{ fontSize: 12.5, color: T.neutral[500], marginBottom: 12, lineHeight: 1.45 }}>
          Apaga lo que no venda aquí y desaparece del menú. No se borra nada:
          se puede volver a encender cuando quiera.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {FEATURES.map(f => {
            const on = features[f.key]
            return (
              <button
                key={f.key}
                onClick={() => toggle(f.key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left',
                  padding: '11px 13px', borderRadius: 12, cursor: 'pointer',
                  fontFamily: 'inherit', width: '100%',
                  border: on ? `1.5px solid ${T.copper[300]}` : `1px solid ${T.neutral[200]}`,
                  background: on ? T.copper[50] : '#fff',
                }}
              >
                <span style={{
                  width: 38, height: 22, borderRadius: 999, flexShrink: 0,
                  background: on ? T.copper[500] : T.neutral[300],
                  display: 'flex', alignItems: 'center',
                  padding: 2, transition: 'background 0.15s',
                }}>
                  <span style={{
                    width: 18, height: 18, borderRadius: '50%', background: '#fff',
                    transform: on ? 'translateX(16px)' : 'translateX(0)',
                    transition: 'transform 0.15s',
                  }}/>
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: on ? T.copper[700] : T.neutral[600] }}>
                    {f.label}
                  </span>
                  <span style={{ display: 'block', fontSize: 11.5, color: T.neutral[400], marginTop: 1 }}>
                    {f.desc}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <PrimaryButton
        label="Guardar"
        onClick={() => name && onSave({ name: name.trim(), colorKey, features })}
        disabled={!name}
      />
    </Modal>
  )
}

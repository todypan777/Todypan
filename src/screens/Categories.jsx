import { useState } from 'react'
import { T } from '../tokens'
import { Card, BackButton, Modal, InputField, PrimaryButton, CatIcon } from '../components/Atoms'
import { ScreenHeader } from '../components/Nav'
import { setIncomeCats, setExpenseCats } from '../db'

export default function Categories({ incomeCats, expenseCats, onBack, onRefresh }) {
  const [activeTab, setActiveTab] = useState('income')
  const [activeGroup, setActiveGroup] = useState('proveedores')
  const [showAdd, setShowAdd] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)

  const expGroups = [
    { id: 'proveedores', label: 'Proveedores' },
    { id: 'operacion', label: 'Operación' },
    { id: 'empresa', label: 'Empresa' },
  ]

  const currentList = activeTab === 'income' ? incomeCats : (expenseCats[activeGroup] || [])

  function handleAddCat(label) {
    const id = label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') + '_' + Date.now()
    if (activeTab === 'income') {
      setIncomeCats([...incomeCats, { id, label }])
    } else {
      const updated = { ...expenseCats, [activeGroup]: [...(expenseCats[activeGroup] || []), { id, label }] }
      setExpenseCats(updated)
    }
    onRefresh()
  }

  function handleEditCat(catId, label) {
    if (activeTab === 'income') {
      setIncomeCats(incomeCats.map(c => c.id === catId ? { ...c, label } : c))
    } else {
      const updated = {
        ...expenseCats,
        [activeGroup]: expenseCats[activeGroup].map(c => c.id === catId ? { ...c, label } : c)
      }
      setExpenseCats(updated)
    }
    onRefresh()
  }

  function handleDeleteCat(catId) {
    if (activeTab === 'income') {
      setIncomeCats(incomeCats.filter(c => c.id !== catId))
    } else {
      const updated = { ...expenseCats, [activeGroup]: expenseCats[activeGroup].filter(c => c.id !== catId) }
      setExpenseCats(updated)
    }
    setConfirmDel(null)
    onRefresh()
  }

  return (
    <div style={{ paddingBottom: 110 }}>
      <div style={{ padding: '56px 16px 0' }}>
        <BackButton onBack={onBack} label="Más"/>
      </div>
      <ScreenHeader title="Categorías"/>

      {/* Tab */}
      <div style={{ padding: '4px 16px 12px' }}>
        <div style={{ display: 'flex', background: T.neutral[100], borderRadius: 12, padding: 3, border: `0.5px solid ${T.neutral[200]}` }}>
          {[
            { id: 'income', label: 'Ingresos' },
            { id: 'expense', label: 'Gastos' },
          ].map(o => (
            <button key={o.id} onClick={() => setActiveTab(o.id)} style={{
              flex: 1, padding: '9px', borderRadius: 10, border: 'none',
              background: activeTab === o.id ? '#fff' : 'transparent',
              color: activeTab === o.id ? T.neutral[800] : T.neutral[500],
              fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              boxShadow: activeTab === o.id ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
            }}>{o.label}</button>
          ))}
        </div>
      </div>

      {activeTab === 'expense' && (
        <div style={{ padding: '0 16px 12px', display: 'flex', gap: 8 }}>
          {expGroups.map(g => (
            <button key={g.id} onClick={() => setActiveGroup(g.id)} style={{
              padding: '7px 13px', borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              background: activeGroup === g.id ? T.neutral[800] : T.neutral[100],
              color: activeGroup === g.id ? '#fff' : T.neutral[600],
              fontSize: 12, fontWeight: 600,
            }}>{g.label}</button>
          ))}
        </div>
      )}

      <div style={{ padding: '0 16px' }}>
        <Card padding={0}>
          {currentList.map((cat, i) => (
            <div key={cat.id} style={{
              padding: '13px 16px', display: 'flex', alignItems: 'center', gap: 12,
              borderBottom: i < currentList.length - 1 ? `0.5px solid ${T.neutral[100]}` : 'none',
            }}>
              <div style={{ width: 34, height: 34, borderRadius: 9, background: activeTab === 'income' ? `${T.ok}18` : T.copper[50], display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CatIcon cat={cat.id} size={16} color={activeTab === 'income' ? T.ok : T.copper[600]}/>
              </div>
              <div style={{ flex: 1, fontSize: 15, fontWeight: 600, color: T.neutral[800] }}>{cat.label}</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => setEditItem(cat)} style={{
                  padding: '5px 10px', borderRadius: 8, border: 'none',
                  background: T.neutral[100], color: T.neutral[600],
                  fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                }}>Editar</button>
                <button onClick={() => setConfirmDel(cat.id)} style={{
                  padding: '5px 10px', borderRadius: 8, border: 'none',
                  background: '#FBF0EE', color: T.bad,
                  fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                }}>✕</button>
              </div>
            </div>
          ))}
        </Card>
      </div>

      {/* Add button */}
      <div style={{ padding: '16px 16px 0' }}>
        <button onClick={() => setShowAdd(true)} style={{
          width: '100%', padding: '13px', borderRadius: 14, border: `1.5px dashed ${T.copper[300]}`,
          background: T.copper[50], color: T.copper[600],
          fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          <svg width="14" height="14" viewBox="0 0 14 14"><path d="M7 1 V13 M1 7 H13" stroke={T.copper[600]} strokeWidth="2" strokeLinecap="round"/></svg>
          Agregar categoría
        </button>
      </div>

      {/* Add modal */}
      {showAdd && <CatFormModal title="Nueva categoría" onClose={() => setShowAdd(false)} onSave={label => { handleAddCat(label); setShowAdd(false) }}/>}

      {/* Edit modal */}
      {editItem && <CatFormModal title="Editar categoría" initial={editItem.label} onClose={() => setEditItem(null)} onSave={label => { handleEditCat(editItem.id, label); setEditItem(null) }}/>}

      {/* Delete confirm */}
      {confirmDel && (
        <Modal onClose={() => setConfirmDel(null)} title="¿Eliminar categoría?">
          <div style={{ fontSize: 14, color: T.neutral[500], marginBottom: 20 }}>Los movimientos existentes con esta categoría no se borran.</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setConfirmDel(null)} style={{ flex: 1, padding: 13, borderRadius: 12, border: 'none', background: T.neutral[100], color: T.neutral[700], fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Cancelar</button>
            <button onClick={() => handleDeleteCat(confirmDel)} style={{ flex: 1, padding: 13, borderRadius: 12, border: 'none', background: T.bad, color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Eliminar</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function CatFormModal({ title, initial = '', onClose, onSave }) {
  const [label, setLabel] = useState(initial)
  return (
    <Modal onClose={onClose} title={title}>
      <InputField label="Nombre de la categoría" value={label} onChange={setLabel} placeholder="Ej: Ventas WhatsApp"/>
      <PrimaryButton label="Guardar" onClick={() => label && onSave(label)} disabled={!label}/>
    </Modal>
  )
}

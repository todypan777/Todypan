import { useEffect, useMemo, useState } from 'react'
import { T } from '../../tokens'
import {
  CATEGORIES, CATEGORY_BY_ID, CATEGORY_IDS,
  watchMenuItems, createMenuItem, renameMenuItem,
  archiveMenuItem, unarchiveMenuItem,
} from '../../menu'
import {
  ModalOverlay, ModalCard, ModalTitle, ModalSub, ModalActions,
  FieldLabel, inputStyle, btnPrimary, btnSecondary, btnGhost, ErrorBox,
} from './ui'

// ──────────────────────────────────────────────────────────────
// Editor del catálogo permanente. Compartido entre cocinera y admin.
//
// Props:
//   authUser  → para createdBy.
//   userDoc   → para createdByName.
// ──────────────────────────────────────────────────────────────
export default function CatalogView({ authUser, userDoc }) {
  const [allItems, setAllItems] = useState([])
  const [creatingFor, setCreatingFor] = useState(null) // categoryId
  const [editing, setEditing] = useState(null) // item
  const editorName = `${userDoc?.nombre || ''} ${userDoc?.apellido || ''}`.trim() || authUser?.email || 'Editor'

  useEffect(() => watchMenuItems(setAllItems), [])

  const itemsByCategory = useMemo(() => {
    const out = {}
    for (const cat of CATEGORY_IDS) out[cat] = []
    for (const item of allItems) {
      if (out[item.category]) out[item.category].push(item)
    }
    return out
  }, [allItems])

  return (
    <div style={{ padding: '16px 14px 80px' }}>
      <div style={{
        padding: '12px 14px', borderRadius: 12, marginBottom: 16,
        background: T.neutral[100], border: `1px solid ${T.neutral[200]}`,
        fontSize: 12.5, color: T.neutral[700], lineHeight: 1.5,
      }}>
        Aquí guardas todas las opciones que has cocinado alguna vez.
        Lo que crees aquí podrás activarlo cualquier día desde "Menú del día".
      </div>

      {CATEGORIES.map(cat => (
        <CatalogCategory
          key={cat.id}
          category={cat}
          items={itemsByCategory[cat.id]}
          onCreate={() => setCreatingFor(cat.id)}
          onEdit={(item) => setEditing(item)}
        />
      ))}

      {creatingFor && (
        <CreateMenuItemModal
          category={creatingFor}
          authUser={authUser}
          editorName={editorName}
          onCancel={() => setCreatingFor(null)}
          onCreated={() => setCreatingFor(null)}
        />
      )}

      {editing && (
        <EditMenuItemModal
          item={editing}
          onCancel={() => setEditing(null)}
          onDone={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function CatalogCategory({ category, items, onCreate, onEdit }) {
  const active = items.filter(it => !it.archived)
  const archived = items.filter(it => it.archived)

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        margin: '0 4px 8px',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 16 }}>{category.emoji}</span>
          <div style={{
            fontSize: 14, fontWeight: 800, color: T.neutral[900],
            letterSpacing: -0.2,
          }}>
            {category.label}
          </div>
          <div style={{ fontSize: 11.5, color: T.neutral[500], fontWeight: 600 }}>
            {active.length} {active.length === 1 ? 'opción' : 'opciones'}
          </div>
        </div>
        <button onClick={onCreate} style={{
          padding: '6px 12px', borderRadius: 999,
          background: T.copper[500], color: '#fff',
          border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 12, fontWeight: 700,
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          + Nueva
        </button>
      </div>

      {active.length === 0 && archived.length === 0 ? (
        <div style={{
          padding: '14px', textAlign: 'center', borderRadius: 12,
          background: T.neutral[50], border: `1px dashed ${T.neutral[200]}`,
          color: T.neutral[500], fontSize: 12.5,
        }}>
          Sin opciones todavía. Toca "+ Nueva" para crear la primera.
        </div>
      ) : (
        <div style={{
          background: '#fff', borderRadius: 12,
          border: `1px solid ${T.neutral[100]}`,
          overflow: 'hidden',
        }}>
          {active.map((item, i) => (
            <CatalogItemRow
              key={item.id}
              item={item}
              isLast={i === active.length - 1 && archived.length === 0}
              onEdit={() => onEdit(item)}
            />
          ))}
          {archived.map((item, i) => (
            <CatalogItemRow
              key={item.id}
              item={item}
              isLast={i === archived.length - 1}
              onEdit={() => onEdit(item)}
              archived
            />
          ))}
        </div>
      )}
    </div>
  )
}

function CatalogItemRow({ item, isLast, onEdit, archived }) {
  return (
    <div style={{
      padding: '12px 14px',
      borderBottom: isLast ? 'none' : `0.5px solid ${T.neutral[100]}`,
      display: 'flex', alignItems: 'center', gap: 10,
      opacity: archived ? 0.55 : 1,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14, fontWeight: 700, color: T.neutral[900],
          textDecoration: archived ? 'line-through' : 'none',
        }}>
          {item.name}
        </div>
        {archived && (
          <div style={{ fontSize: 10.5, color: T.neutral[500], marginTop: 1, letterSpacing: 0.3 }}>
            Archivado
          </div>
        )}
      </div>
      <button onClick={onEdit} style={{
        padding: '6px 10px', borderRadius: 8,
        background: 'transparent', color: T.neutral[600],
        border: `1px solid ${T.neutral[200]}`,
        cursor: 'pointer', fontFamily: 'inherit',
        fontSize: 11.5, fontWeight: 700,
      }}>
        ✎ Editar
      </button>
    </div>
  )
}

function CreateMenuItemModal({ category, authUser, editorName, onCancel, onCreated }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const cat = CATEGORY_BY_ID[category]

  async function handleCreate() {
    if (!name.trim() || busy) return
    setBusy(true); setError(null)
    try {
      await createMenuItem({
        category,
        name,
        createdBy: authUser.uid,
        createdByName: editorName,
      })
      onCreated()
    } catch (err) {
      console.error('[menu] create error:', err)
      setError('No pudimos crear la opción.')
      setBusy(false)
    }
  }

  return (
    <ModalOverlay onClose={busy ? undefined : onCancel}>
      <ModalCard>
        <ModalTitle>Nueva opción · {cat.label}</ModalTitle>
        <ModalSub>Esta opción quedará en tu catálogo permanente.</ModalSub>
        <FieldLabel>Nombre</FieldLabel>
        <input
          type="text" value={name} onChange={e => setName(e.target.value)}
          placeholder={`Ej: ${exampleByCategory(category)}`}
          autoFocus maxLength={60}
          style={inputStyle()}
        />
        {error && <ErrorBox>{error}</ErrorBox>}
        <ModalActions
          onCancel={onCancel}
          onConfirm={handleCreate}
          confirmLabel={busy ? 'Creando...' : 'Crear'}
          confirmDisabled={busy || !name.trim()}
          confirmColor={T.copper[500]}
        />
      </ModalCard>
    </ModalOverlay>
  )
}

function exampleByCategory(catId) {
  return {
    soup: 'Sopa de verduras',
    principio: 'Frijoles',
    protein: 'Carne de cerdo',
    side: 'Arroz blanco',
    salad: 'Ensalada de tomate',
    juice: 'Jugo de mora',
  }[catId] || 'Nombre'
}

function EditMenuItemModal({ item, onCancel, onDone }) {
  const [name, setName] = useState(item.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function handleSave() {
    if (!name.trim() || busy) return
    setBusy(true); setError(null)
    try {
      await renameMenuItem(item.id, name)
      onDone()
    } catch (err) {
      console.error(err); setError('No pudimos guardar.')
      setBusy(false)
    }
  }

  async function handleArchiveToggle() {
    setBusy(true); setError(null)
    try {
      if (item.archived) await unarchiveMenuItem(item.id)
      else await archiveMenuItem(item.id)
      onDone()
    } catch (err) {
      console.error(err); setError('No pudimos archivar.')
      setBusy(false)
    }
  }

  return (
    <ModalOverlay onClose={busy ? undefined : onCancel}>
      <ModalCard>
        <ModalTitle>Editar opción</ModalTitle>
        <ModalSub>{CATEGORY_BY_ID[item.category]?.label}</ModalSub>
        <FieldLabel>Nombre</FieldLabel>
        <input
          type="text" value={name} onChange={e => setName(e.target.value)}
          autoFocus maxLength={60}
          style={inputStyle()}
        />
        {error && <ErrorBox>{error}</ErrorBox>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={handleArchiveToggle} disabled={busy} style={btnGhost(item.archived ? T.copper[600] : T.bad)}>
            {item.archived ? '↺ Reactivar' : '🗂 Archivar'}
          </button>
          <button onClick={onCancel} disabled={busy} style={btnSecondary()}>Cerrar</button>
          <button onClick={handleSave} disabled={busy || !name.trim()} style={btnPrimary(T.copper[500])}>
            {busy ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </div>
      </ModalCard>
    </ModalOverlay>
  )
}

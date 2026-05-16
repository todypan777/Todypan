import { useEffect, useMemo, useState } from 'react'
import { T } from '../../tokens'
import { fmtCOP } from '../../utils/format'
import {
  CATEGORIES, CATEGORY_BY_ID, CATEGORY_IDS,
  watchMenuItems, createMenuItem, renameMenuItem,
  archiveMenuItem, unarchiveMenuItem,
  watchCorrienteConfig, setDailyCorriente, setAddonPrices,
} from '../../menu'
import {
  ModalOverlay, ModalCard, ModalTitle, ModalSub, ModalActions,
  FieldLabel, inputStyle, btnPrimary, btnSecondary, btnGhost, ErrorBox,
} from './ui'

// ──────────────────────────────────────────────────────────────
// Editor del catálogo permanente + precios del corriente.
// Compartido entre cocinera y admin.
//
// Estructura:
//   - Tarjeta de Precios del Corriente (mesa + llevar)
//   - Categorías con sus items (lista vertical refinada)
//
// Props:
//   authUser  → para createdBy / updatedBy
//   userDoc   → para createdByName / updatedByName
// ──────────────────────────────────────────────────────────────
export default function CatalogView({ authUser, userDoc }) {
  const [allItems, setAllItems] = useState([])
  const [corrienteConfig, setCorrienteConfig] = useState(null)
  const [creatingFor, setCreatingFor] = useState(null) // categoryId
  const [editing, setEditing] = useState(null) // item
  const editorName = `${userDoc?.nombre || ''} ${userDoc?.apellido || ''}`.trim()
    || authUser?.email || 'Editor'

  useEffect(() => watchMenuItems(setAllItems), [])
  useEffect(() => watchCorrienteConfig(setCorrienteConfig), [])

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
      <CorrientePricesCard
        config={corrienteConfig}
        authUser={authUser}
        editorName={editorName}
      />

      <AddonPricesCard
        config={corrienteConfig}
        authUser={authUser}
        editorName={editorName}
      />

      <div style={{
        padding: '12px 14px', borderRadius: 14, marginBottom: 18,
        background: T.neutral[25], border: `1px solid ${T.neutral[200]}`,
        fontSize: 12.5, color: T.neutral[600], lineHeight: 1.5,
      }}>
        📚 Aquí están <b>todas</b> las opciones que has cocinado alguna vez.
        Lo que crees acá podrás activarlo cualquier día desde el menú del día.
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

// ──────────────────────────────────────────────────────────────
// Tarjeta de precios del corriente. Vive arriba del catálogo
// porque cambiar precios es algo del "catálogo" (no del día).
// ──────────────────────────────────────────────────────────────
function CorrientePricesCard({ config, authUser, editorName }) {
  const priceMesa = Number(config?.priceMesa) || 0
  const priceLlevar = Number(config?.priceLlevar) || 0
  const hasPrices = priceMesa > 0

  const [editing, setEditing] = useState(false)
  const [draftMesa, setDraftMesa] = useState(String(priceMesa || ''))
  const [draftLlevar, setDraftLlevar] = useState(String(priceLlevar || ''))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!editing) {
      setDraftMesa(String(priceMesa || ''))
      setDraftLlevar(String(priceLlevar || ''))
    }
  }, [editing, priceMesa, priceLlevar])

  async function handleSave() {
    const pm = Number(draftMesa) || 0
    const pl = Number(draftLlevar) || 0
    if (pm <= 0) { setError('Pon al menos el precio de mesa.'); return }
    setBusy(true); setError(null)
    try {
      await setDailyCorriente(null, {
        priceMesa: pm,
        priceLlevar: pl > 0 ? pl : pm,
      }, { publishedBy: authUser?.uid, publishedByName: editorName })
      setEditing(false)
    } catch (err) {
      console.error('[catalog prices] save failed:', err)
      const code = err?.code || ''
      if (code === 'permission-denied') {
        setError('Permisos insuficientes. Avisa al admin.')
      } else if (code === 'unavailable') {
        setError('Sin conexión. Intenta cuando vuelva la red.')
      } else {
        setError('No se pudo guardar. Intenta de nuevo.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{
      marginBottom: 18, borderRadius: 18,
      background: `linear-gradient(135deg, ${T.copper[50]} 0%, #fff 100%)`,
      border: `1.5px solid ${T.copper[200]}`,
      boxShadow: '0 4px 14px rgba(184,122,86,0.10)',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '14px 18px 12px',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{ fontSize: 22, lineHeight: 1 }}>💰</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 15, fontWeight: 900, color: T.copper[700],
            letterSpacing: -0.3,
          }}>
            Precios del Almuerzo Corriente
          </div>
          <div style={{ fontSize: 11.5, color: T.neutral[600], marginTop: 1, lineHeight: 1.4 }}>
            Permanentes — no se reinician cada día. Cámbialos solo cuando suba el precio.
          </div>
        </div>
      </div>

      <div style={{ padding: '0 16px 16px' }}>
        {editing ? (
          <div style={{
            background: '#fff', borderRadius: 14, padding: 14,
            border: `1px solid ${T.copper[100]}`,
          }}>
            <FieldLabel>Precio para mesa ($)</FieldLabel>
            <input
              type="number" value={draftMesa}
              onChange={e => setDraftMesa(e.target.value)}
              placeholder="Ej: 15000"
              style={{ ...inputStyle(), fontSize: 15, padding: '12px 14px' }}
            />
            <FieldLabel>Precio para llevar ($)</FieldLabel>
            <input
              type="number" value={draftLlevar}
              onChange={e => setDraftLlevar(e.target.value)}
              placeholder="Si vacío, se usa el de mesa"
              style={{ ...inputStyle(), fontSize: 15, padding: '12px 14px' }}
            />
            {error && <ErrorBox>{error}</ErrorBox>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => { setEditing(false); setError(null) }}
                disabled={busy}
                style={{
                  flex: 1, padding: '12px', borderRadius: 12,
                  background: T.neutral[100], color: T.neutral[700],
                  border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 13.5, fontWeight: 700,
                }}
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={busy || !draftMesa}
                style={{
                  flex: 1.4, padding: '12px', borderRadius: 12,
                  background: !draftMesa ? T.neutral[200] : T.copper[500],
                  color: '#fff', border: 'none',
                  cursor: !draftMesa ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit', fontSize: 14, fontWeight: 800,
                  boxShadow: !draftMesa ? 'none' : `0 3px 10px ${T.copper[500]}44`,
                }}
              >
                {busy ? 'Guardando…' : 'Guardar precios'}
              </button>
            </div>
          </div>
        ) : hasPrices ? (
          <div style={{
            background: '#fff', borderRadius: 14, padding: 14,
            border: `1px solid ${T.copper[100]}`,
          }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <PriceBlock label="Para mesa" value={priceMesa} />
              <PriceBlock label="Para llevar" value={priceLlevar} />
            </div>
            <button
              onClick={() => setEditing(true)}
              style={{
                marginTop: 12, width: '100%', padding: '11px',
                background: 'transparent', color: T.copper[700],
                border: `1.5px solid ${T.copper[200]}`,
                borderRadius: 11, cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 13, fontWeight: 700,
              }}
            >
              ✎ Cambiar precios
            </button>
          </div>
        ) : (
          <div>
            <div style={{
              padding: '12px 14px', borderRadius: 12, marginBottom: 12,
              background: '#FFF7E6', border: `1px solid #F4E0BC`,
              fontSize: 12.5, color: T.warn, lineHeight: 1.45,
            }}>
              ⚠ Aún no hay precios. Sin esto la cajera no podrá vender el almuerzo.
            </div>
            <button
              onClick={() => setEditing(true)}
              style={{
                width: '100%', padding: '14px', borderRadius: 12,
                background: T.copper[500], color: '#fff',
                border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 14, fontWeight: 800,
                boxShadow: `0 3px 10px ${T.copper[500]}55`,
              }}
            >
              + Definir precios
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Tarjeta de precios de ADICIONES (sopa, huevo, proteína extra).
// Vive en el mismo doc corriente_config — persistente, no se reinicia.
// Si un precio es 0, esa adición NO se ofrece al cliente.
// ──────────────────────────────────────────────────────────────
function AddonPricesCard({ config, authUser, editorName }) {
  const soupPrice    = Number(config?.addonSoupPrice) || 0
  const eggPrice     = Number(config?.addonEggPrice) || 0
  const proteinPrice = Number(config?.addonProteinPrice) || 0
  const anyConfigured = soupPrice > 0 || eggPrice > 0 || proteinPrice > 0

  const [editing, setEditing] = useState(false)
  const [draftSoup, setDraftSoup] = useState(String(soupPrice || ''))
  const [draftEgg, setDraftEgg] = useState(String(eggPrice || ''))
  const [draftProtein, setDraftProtein] = useState(String(proteinPrice || ''))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!editing) {
      setDraftSoup(String(soupPrice || ''))
      setDraftEgg(String(eggPrice || ''))
      setDraftProtein(String(proteinPrice || ''))
    }
  }, [editing, soupPrice, eggPrice, proteinPrice])

  async function handleSave() {
    setBusy(true); setError(null)
    try {
      await setAddonPrices({
        addonSoupPrice:    Number(draftSoup) || 0,
        addonEggPrice:     Number(draftEgg) || 0,
        addonProteinPrice: Number(draftProtein) || 0,
      }, { publishedBy: authUser?.uid, publishedByName: editorName })
      setEditing(false)
    } catch (err) {
      console.error('[addon prices] save failed:', err)
      setError('No se pudo guardar. Intenta de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{
      marginBottom: 18, borderRadius: 18,
      background: `linear-gradient(135deg, #FFF7E6 0%, #fff 100%)`,
      border: `1.5px solid #F4E0BC`,
      boxShadow: '0 4px 14px rgba(192,138,62,0.10)',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '14px 18px 12px',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{ fontSize: 22, lineHeight: 1 }}>➕</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 15, fontWeight: 900, color: T.warn,
            letterSpacing: -0.3,
          }}>
            Precios de Adiciones
          </div>
          <div style={{ fontSize: 11.5, color: T.neutral[600], marginTop: 1, lineHeight: 1.4 }}>
            Lo que el cliente puede pedir extra. Si dejas precio en 0, esa adición no se ofrece.
          </div>
        </div>
      </div>

      <div style={{ padding: '0 16px 16px' }}>
        {editing ? (
          <div style={{
            background: '#fff', borderRadius: 14, padding: 14,
            border: `1px solid #F4E0BC`,
          }}>
            <FieldLabel>🥣 Sopa adicional ($)</FieldLabel>
            <input
              type="number" value={draftSoup}
              onChange={e => setDraftSoup(e.target.value)}
              placeholder="0 = no se ofrece"
              style={{ ...inputStyle(), fontSize: 15, padding: '12px 14px' }}
            />
            <FieldLabel>🍳 Huevo adicional ($)</FieldLabel>
            <input
              type="number" value={draftEgg}
              onChange={e => setDraftEgg(e.target.value)}
              placeholder="0 = no se ofrece"
              style={{ ...inputStyle(), fontSize: 15, padding: '12px 14px' }}
            />
            <FieldLabel>🍗 Proteína adicional ($)</FieldLabel>
            <input
              type="number" value={draftProtein}
              onChange={e => setDraftProtein(e.target.value)}
              placeholder="0 = no se ofrece"
              style={{ ...inputStyle(), fontSize: 15, padding: '12px 14px' }}
            />
            {error && <ErrorBox>{error}</ErrorBox>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => { setEditing(false); setError(null) }}
                disabled={busy}
                style={{
                  flex: 1, padding: '12px', borderRadius: 12,
                  background: T.neutral[100], color: T.neutral[700],
                  border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 13.5, fontWeight: 700,
                }}
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={busy}
                style={{
                  flex: 1.4, padding: '12px', borderRadius: 12,
                  background: T.warn,
                  color: '#fff', border: 'none',
                  cursor: busy ? 'wait' : 'pointer',
                  fontFamily: 'inherit', fontSize: 14, fontWeight: 800,
                  boxShadow: `0 3px 10px ${T.warn}44`,
                }}
              >
                {busy ? 'Guardando…' : 'Guardar precios'}
              </button>
            </div>
          </div>
        ) : anyConfigured ? (
          <div style={{
            background: '#fff', borderRadius: 14, padding: 14,
            border: `1px solid #F4E0BC`,
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <AddonPriceRow emoji="🥣" label="Sopa adicional"     price={soupPrice} />
              <AddonPriceRow emoji="🍳" label="Huevo adicional"    price={eggPrice} />
              <AddonPriceRow emoji="🍗" label="Proteína adicional" price={proteinPrice} />
            </div>
            <button
              onClick={() => setEditing(true)}
              style={{
                marginTop: 12, width: '100%', padding: '11px',
                background: 'transparent', color: T.warn,
                border: `1.5px solid #F4E0BC`,
                borderRadius: 11, cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 13, fontWeight: 700,
              }}
            >
              ✎ Cambiar precios
            </button>
          </div>
        ) : (
          <button
            onClick={() => setEditing(true)}
            style={{
              width: '100%', padding: '14px', borderRadius: 12,
              background: T.warn, color: '#fff',
              border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 14, fontWeight: 800,
              boxShadow: `0 3px 10px ${T.warn}44`,
            }}
          >
            + Configurar precios de adiciones
          </button>
        )}
      </div>
    </div>
  )
}

function AddonPriceRow({ emoji, label, price }) {
  const inactive = price <= 0
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 12px', borderRadius: 10,
      background: inactive ? T.neutral[50] : '#FFF7E6',
      border: `1px solid ${inactive ? T.neutral[200] : '#F4E0BC'}`,
    }}>
      <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>{emoji}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 700,
          color: inactive ? T.neutral[500] : T.neutral[900],
        }}>
          {label}
        </div>
        {inactive && (
          <div style={{ fontSize: 11, color: T.neutral[500], marginTop: 1 }}>
            No se ofrece al cliente
          </div>
        )}
      </div>
      <div style={{
        fontSize: 15, fontWeight: 900,
        color: inactive ? T.neutral[400] : T.warn,
        fontVariantNumeric: 'tabular-nums', letterSpacing: -0.3,
        flexShrink: 0,
      }}>
        {inactive ? '—' : fmtCOP(price)}
      </div>
    </div>
  )
}

function PriceBlock({ label, value }) {
  return (
    <div style={{
      flex: 1, padding: '12px 14px', borderRadius: 12,
      background: T.copper[50], border: `1px solid ${T.copper[100]}`,
      textAlign: 'center',
    }}>
      <div style={{
        fontSize: 10.5, fontWeight: 800, color: T.copper[700],
        letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 18, fontWeight: 900, color: T.neutral[900],
        fontVariantNumeric: 'tabular-nums', letterSpacing: -0.5,
      }}>
        {fmtCOP(value)}
      </div>
    </div>
  )
}

function CatalogCategory({ category, items, onCreate, onEdit }) {
  const active = items.filter(it => !it.archived)
  const archived = items.filter(it => it.archived)

  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        margin: '0 4px 10px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22, lineHeight: 1 }}>{category.emoji}</span>
          <div>
            <div style={{
              fontSize: 15, fontWeight: 800, color: T.neutral[900],
              letterSpacing: -0.2,
            }}>
              {category.label}
            </div>
            <div style={{ fontSize: 11, color: T.neutral[500], fontWeight: 600, marginTop: 1 }}>
              {active.length} {active.length === 1 ? 'opción activa' : 'opciones activas'}
              {archived.length > 0 && ` · ${archived.length} archivada${archived.length === 1 ? '' : 's'}`}
            </div>
          </div>
        </div>
        <button onClick={onCreate} style={{
          padding: '8px 14px', borderRadius: 999,
          background: T.copper[500], color: '#fff',
          border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 12.5, fontWeight: 800,
          display: 'flex', alignItems: 'center', gap: 4,
          boxShadow: `0 2px 6px ${T.copper[500]}55`,
        }}>
          + Nueva
        </button>
      </div>

      {active.length === 0 && archived.length === 0 ? (
        <div style={{
          padding: '18px', textAlign: 'center', borderRadius: 14,
          background: T.neutral[25], border: `1.5px dashed ${T.neutral[200]}`,
          color: T.neutral[500], fontSize: 13, lineHeight: 1.5,
        }}>
          Sin opciones todavía. Toca <b>"+ Nueva"</b> para crear la primera.
        </div>
      ) : (
        <div style={{
          background: '#fff', borderRadius: 14,
          border: `1px solid ${T.neutral[100]}`,
          overflow: 'hidden',
          boxShadow: '0 2px 6px rgba(0,0,0,0.03)',
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
      padding: '14px 16px',
      borderBottom: isLast ? 'none' : `0.5px solid ${T.neutral[100]}`,
      display: 'flex', alignItems: 'center', gap: 10,
      opacity: archived ? 0.55 : 1,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 15, fontWeight: 700, color: T.neutral[900],
          textDecoration: archived ? 'line-through' : 'none',
        }}>
          {item.name}
        </div>
        {archived && (
          <div style={{ fontSize: 10.5, color: T.neutral[500], marginTop: 2, letterSpacing: 0.3, textTransform: 'uppercase', fontWeight: 700 }}>
            Archivada
          </div>
        )}
      </div>
      <button onClick={onEdit} style={{
        padding: '8px 12px', borderRadius: 10,
        background: 'transparent', color: T.neutral[600],
        border: `1px solid ${T.neutral[200]}`,
        cursor: 'pointer', fontFamily: 'inherit',
        fontSize: 12, fontWeight: 700,
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

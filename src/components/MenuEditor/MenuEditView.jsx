import { useEffect, useMemo, useRef, useState } from 'react'
import { T } from '../../tokens'
import { fmtCOP } from '../../utils/format'
import {
  CORRIENTE_CATEGORIES, CATEGORY_BY_ID, resolveDailyMenu, getCorrienteState,
  createMenuItem, setDailyMenuItem, setDailySpecial,
} from '../../menu'
import { FieldLabel, inputStyle, ErrorBox } from './ui'

// ──────────────────────────────────────────────────────────────
// Vista de edición rápida del menú del día ya publicado.
// Pantalla completa. Lista vertical única (no burbujas).
// La cocinera puede:
//   - Quitar items que se acabaron (✕ Se acabó)
//   - Agregar más opciones (+ Agregar) — abre picker con autocomplete
//   - Activar/desactivar/editar el almuerzo especial
//   - Ver precios y enlace al catálogo para cambiarlos
//
// Props:
//   today, authUser, publisherName, allMenuItems
//   dailyMenu, corrienteConfig
//   onClose → cierra y vuelve a Hoy
//   onGoToCatalog → opcional, navega al tab Catálogo
// ──────────────────────────────────────────────────────────────
export default function MenuEditView({
  today, authUser, publisherName, allMenuItems,
  dailyMenu, corrienteConfig,
  onClose, onGoToCatalog,
}) {
  const [adding, setAdding] = useState(null) // categoryId mientras está abierto el picker

  // Bloquear scroll del body
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  const resolved = useMemo(
    () => resolveDailyMenu(dailyMenu, allMenuItems),
    [dailyMenu, allMenuItems]
  )
  const corriente = useMemo(
    () => getCorrienteState(dailyMenu, allMenuItems, corrienteConfig),
    [dailyMenu, allMenuItems, corrienteConfig]
  )

  async function removeItem(categoryId, itemId) {
    const current = resolved[categoryId] || []
    const next = current.filter(it => it.id !== itemId).map(it => it.id)
    try {
      await setDailyMenuItem(today, categoryId, next, {
        publishedBy: authUser?.uid,
        publishedByName: publisherName,
      })
    } catch (err) {
      console.error('[edit] remove failed:', err)
      alert('No pudimos actualizar el menú. Intenta de nuevo.')
    }
  }

  async function addItem(categoryId, itemId) {
    const current = resolved[categoryId] || []
    const cat = CATEGORY_BY_ID[categoryId]
    let nextIds
    if (cat.multi) {
      nextIds = [...current.map(it => it.id), itemId]
    } else {
      nextIds = [itemId]
    }
    try {
      await setDailyMenuItem(today, categoryId, nextIds, {
        publishedBy: authUser?.uid,
        publishedByName: publisherName,
      })
      setAdding(null)
    } catch (err) {
      console.error('[edit] add failed:', err)
      alert('No pudimos agregar la opción. Intenta de nuevo.')
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: T.neutral[50],
      display: 'flex', flexDirection: 'column',
      paddingTop: 'env(safe-area-inset-top, 0px)',
    }}>
      <EditHeader onClose={onClose} />

      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{
          maxWidth: 620, margin: '0 auto',
          padding: '16px 14px',
          paddingBottom: 'calc(40px + env(safe-area-inset-bottom, 0px))',
        }}>
          {/* Precios (info + link al catálogo) */}
          <PricesInfoCard
            corriente={corriente}
            onGoToCatalog={onGoToCatalog}
          />

          {/* Aviso */}
          <div style={{
            padding: '12px 14px', borderRadius: 12, marginBottom: 14,
            background: T.copper[50], border: `1px solid ${T.copper[100]}`,
            fontSize: 12.5, color: T.copper[700], lineHeight: 1.5,
          }}>
            💡 Si algo se acaba, toca <b>"✕ Se acabó"</b>. La cajera lo deja de ver al instante.
          </div>

          {/* Categorías */}
          {CORRIENTE_CATEGORIES.map(cat => (
            <CategoryBlock
              key={cat.id}
              category={cat}
              items={resolved[cat.id]}
              onRemove={(itemId) => removeItem(cat.id, itemId)}
              onAddClick={() => setAdding(cat.id)}
            />
          ))}

          {/* Almuerzo Especial */}
          <SpecialEditCard
            dailyMenu={dailyMenu}
            today={today}
            authUser={authUser}
            publisherName={publisherName}
          />
        </div>
      </div>

      <div style={{
        padding: '12px 14px',
        paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
        background: '#fff',
        borderTop: `1px solid ${T.neutral[100]}`,
      }}>
        <button
          onClick={onClose}
          style={{
            width: '100%', padding: '16px', borderRadius: 14,
            background: T.copper[500], color: '#fff',
            border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 15, fontWeight: 800, letterSpacing: -0.2,
            boxShadow: `0 4px 12px ${T.copper[500]}55`,
          }}
        >
          ✓ Listo
        </button>
      </div>

      {adding && (
        <AddItemPicker
          category={CATEGORY_BY_ID[adding]}
          allMenuItems={allMenuItems}
          alreadySelected={(resolved[adding] || []).map(it => it.id)}
          authUser={authUser}
          publisherName={publisherName}
          onCancel={() => setAdding(null)}
          onPick={(itemId) => addItem(adding, itemId)}
        />
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Header con botón cerrar
// ──────────────────────────────────────────────────────────────
function EditHeader({ onClose }) {
  return (
    <div style={{
      padding: '14px 16px',
      background: '#fff',
      borderBottom: `1px solid ${T.neutral[100]}`,
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <button
        onClick={onClose}
        aria-label="Volver"
        style={{
          width: 38, height: 38, borderRadius: 999,
          background: T.neutral[100], border: 'none',
          cursor: 'pointer', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'inherit',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M9 2 L3 7 L9 12" stroke={T.neutral[700]} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 900, color: T.neutral[900], letterSpacing: -0.3 }}>
          Editar menú del día
        </div>
        <div style={{ fontSize: 11.5, color: T.neutral[500], marginTop: 1 }}>
          Cambios al instante para la cajera
        </div>
      </div>
    </div>
  )
}

function PricesInfoCard({ corriente, onGoToCatalog }) {
  if (corriente.priceMesa <= 0) {
    return (
      <div style={{
        padding: '14px 16px', borderRadius: 14, marginBottom: 14,
        background: '#FFF7E6', border: `1.5px solid #F4E0BC`,
      }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: T.warn, marginBottom: 4 }}>
          ⚠ Falta poner precios del corriente
        </div>
        <div style={{ fontSize: 12.5, color: T.neutral[600], marginBottom: 10, lineHeight: 1.45 }}>
          Sin precios, la cajera no podrá vender el almuerzo. Ponlos en el Catálogo.
        </div>
        {onGoToCatalog && (
          <button
            onClick={onGoToCatalog}
            style={{
              padding: '10px 14px', borderRadius: 10,
              background: T.warn, color: '#fff',
              border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 13, fontWeight: 700,
            }}
          >
            Ir al Catálogo →
          </button>
        )}
      </div>
    )
  }

  return (
    <div style={{
      padding: '12px 14px', borderRadius: 14, marginBottom: 14,
      background: '#fff', border: `1px solid ${T.neutral[200]}`,
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 10.5, fontWeight: 800, color: T.neutral[500],
          letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4,
        }}>
          Precios del corriente
        </div>
        <div style={{
          display: 'flex', gap: 14,
          fontSize: 13.5, fontWeight: 700, color: T.neutral[900],
          fontVariantNumeric: 'tabular-nums',
        }}>
          <span>Mesa <b>{fmtCOP(corriente.priceMesa)}</b></span>
          <span style={{ color: T.neutral[300] }}>·</span>
          <span>Llevar <b>{fmtCOP(corriente.priceLlevar)}</b></span>
        </div>
      </div>
      {onGoToCatalog && (
        <button
          onClick={onGoToCatalog}
          style={{
            padding: '8px 12px', borderRadius: 999,
            background: T.neutral[100], color: T.neutral[700],
            border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 12, fontWeight: 700, flexShrink: 0,
          }}
        >
          Cambiar →
        </button>
      )}
    </div>
  )
}

function CategoryBlock({ category, items, onRemove, onAddClick }) {
  const isEmpty = !items || items.length === 0
  const canAddMore = category.multi || isEmpty

  return (
    <div style={{
      marginBottom: 14, borderRadius: 16,
      background: '#fff', border: `1px solid ${T.neutral[100]}`,
      overflow: 'hidden',
    }}>
      {/* Header categoría */}
      <div style={{
        padding: '12px 14px',
        borderBottom: isEmpty ? 'none' : `1px solid ${T.neutral[100]}`,
        background: T.neutral[25],
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{ fontSize: 22, lineHeight: 1 }}>{category.emoji}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14.5, fontWeight: 800, color: T.neutral[900],
            letterSpacing: -0.2,
          }}>
            {category.label}
          </div>
          <div style={{ fontSize: 11.5, color: T.neutral[500], marginTop: 1 }}>
            {isEmpty
              ? 'Sin opciones hoy'
              : `${items.length} ${items.length === 1 ? 'opción activa' : 'opciones activas'}`
            }
          </div>
        </div>
        {!category.multi && !isEmpty && (
          <span style={{
            fontSize: 9.5, fontWeight: 800, color: T.neutral[500],
            letterSpacing: 0.5, textTransform: 'uppercase',
            padding: '3px 7px', borderRadius: 999,
            background: T.neutral[100],
          }}>
            Una sola
          </span>
        )}
      </div>

      {/* Lista de items */}
      {!isEmpty && (
        <div>
          {items.map((item, i) => (
            <div key={item.id} style={{
              padding: '14px 14px',
              borderBottom: i === items.length - 1
                ? 'none'
                : `0.5px solid ${T.neutral[100]}`,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{
                flex: 1, minWidth: 0,
                fontSize: 15.5, fontWeight: 700, color: T.neutral[900],
              }}>
                {item.name}
              </div>
              <button
                onClick={() => onRemove(item.id)}
                style={{
                  padding: '8px 12px', borderRadius: 10,
                  background: '#FBE9E5', color: T.bad,
                  border: `1px solid #F0C8BE`,
                  cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 12.5, fontWeight: 800, flexShrink: 0,
                  display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                ✕ Se acabó
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add más */}
      {canAddMore && (
        <button
          onClick={onAddClick}
          style={{
            width: '100%', padding: '14px',
            background: 'transparent', color: T.copper[600],
            border: 'none',
            borderTop: isEmpty ? 'none' : `0.5px solid ${T.neutral[100]}`,
            cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 13.5, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}
        >
          + Agregar {isEmpty ? category.label.toLowerCase() : 'otra'}
        </button>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Picker modal: buscar item del catálogo o crear nuevo
// ──────────────────────────────────────────────────────────────
function AddItemPicker({
  category, allMenuItems, alreadySelected,
  authUser, publisherName,
  onCancel, onPick,
}) {
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState(null)
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const categoryItems = useMemo(() => {
    return allMenuItems
      .filter(it => it.category === category.id && !it.archived)
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  }, [allMenuItems, category.id])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const base = categoryItems.filter(it => !alreadySelected.includes(it.id))
    if (!q) return base
    return base.filter(it => (it.name || '').toLowerCase().includes(q))
  }, [categoryItems, query, alreadySelected])

  const hasExactMatch = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return categoryItems.some(it => (it.name || '').toLowerCase() === q)
  }, [categoryItems, query])

  async function handleCreate() {
    const name = query.trim()
    if (!name || creating) return
    setCreating(true); setCreateError(null)
    try {
      const newId = await createMenuItem({
        category: category.id,
        name,
        createdBy: authUser?.uid,
        createdByName: publisherName,
      })
      onPick(newId)
    } catch (err) {
      console.error('[picker] create failed:', err)
      setCreateError('No pudimos crear la opción.')
      setCreating(false)
    }
  }

  return (
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, zIndex: 110,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 540,
        background: '#fff',
        borderRadius: '22px 22px 0 0',
        padding: '20px 18px',
        paddingBottom: 'calc(20px + env(safe-area-inset-bottom, 0px))',
        maxHeight: '85vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 -10px 40px rgba(0,0,0,0.25)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14,
        }}>
          <span style={{ fontSize: 26 }}>{category.emoji}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 17, fontWeight: 900, color: T.neutral[900],
              letterSpacing: -0.3,
            }}>
              Agregar {category.label.toLowerCase()}
            </div>
            <div style={{ fontSize: 12, color: T.neutral[500], marginTop: 1 }}>
              Busca o escribe una nueva
            </div>
          </div>
          <button
            onClick={onCancel}
            aria-label="Cerrar"
            style={{
              width: 34, height: 34, borderRadius: 999,
              background: T.neutral[100], border: 'none',
              cursor: 'pointer', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'inherit',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M3 3 L9 9 M9 3 L3 9" stroke={T.neutral[700]} strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setCreateError(null) }}
          placeholder="Buscar o nombre nuevo…"
          maxLength={60}
          style={{ ...inputStyle(), fontSize: 16, padding: '14px 16px', marginBottom: 12 }}
        />

        {createError && <ErrorBox>{createError}</ErrorBox>}

        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {filtered.length > 0 && (
            <div style={{
              borderRadius: 14, background: '#fff',
              border: `1px solid ${T.neutral[100]}`,
              overflow: 'hidden', marginBottom: 12,
            }}>
              {filtered.map((it, i) => (
                <button
                  key={it.id}
                  onClick={() => onPick(it.id)}
                  style={{
                    width: '100%', padding: '14px 16px',
                    background: 'transparent', border: 'none',
                    borderBottom: i === filtered.length - 1
                      ? 'none'
                      : `0.5px solid ${T.neutral[100]}`,
                    cursor: 'pointer', fontFamily: 'inherit',
                    fontSize: 15, color: T.neutral[900], fontWeight: 600,
                    textAlign: 'left',
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}
                >
                  <span style={{
                    width: 22, height: 22, borderRadius: 999,
                    background: T.copper[50], color: T.copper[600],
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, fontWeight: 800, flexShrink: 0,
                  }}>
                    +
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>{it.name}</span>
                </button>
              ))}
            </div>
          )}

          {query.trim() && !hasExactMatch && (
            <button
              onClick={handleCreate}
              disabled={creating}
              style={{
                width: '100%', padding: '14px 16px', borderRadius: 14,
                background: '#fff', color: T.copper[700],
                border: `2px dashed ${T.copper[300]}`,
                cursor: creating ? 'wait' : 'pointer',
                fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
                textAlign: 'left', lineHeight: 1.4,
                opacity: creating ? 0.7 : 1,
              }}
            >
              {creating ? 'Creando…' : (
                <>+ Crear <b>"{query.trim()}"</b> y guardarla en el catálogo</>
              )}
            </button>
          )}

          {filtered.length === 0 && !query.trim() && (
            <div style={{
              padding: 18, borderRadius: 14, textAlign: 'center',
              background: T.neutral[50], border: `1px dashed ${T.neutral[200]}`,
              color: T.neutral[600], fontSize: 13, lineHeight: 1.5,
            }}>
              {categoryItems.length === 0
                ? 'No hay opciones en el catálogo. Escribe el nombre para crear.'
                : 'Todas las opciones del catálogo ya están en el menú.'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Tarjeta de Almuerzo Especial (editor inline)
// ──────────────────────────────────────────────────────────────
function SpecialEditCard({ dailyMenu, today, authUser, publisherName }) {
  const special = dailyMenu?.special || { active: false }
  const [editing, setEditing] = useState(false)
  const [priceMesa, setPriceMesa] = useState(String(special.priceMesa || ''))
  const [priceLlevar, setPriceLlevar] = useState(String(special.priceLlevar || ''))
  const [description, setDescription] = useState(special.description || '')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!editing) {
      setPriceMesa(String(special.priceMesa || ''))
      setPriceLlevar(String(special.priceLlevar || ''))
      setDescription(special.description || '')
    }
  }, [editing, special.priceMesa, special.priceLlevar, special.description])

  async function handleSave() {
    const pm = Number(priceMesa) || 0
    const pl = Number(priceLlevar) || 0
    if (pm <= 0) return
    setBusy(true)
    try {
      await setDailySpecial(today, {
        active: true,
        priceMesa: pm,
        priceLlevar: pl > 0 ? pl : pm,
        description,
      }, { publishedBy: authUser?.uid, publishedByName: publisherName })
      setEditing(false)
    } catch (err) {
      console.error(err)
      alert('No pudimos guardar el especial.')
    } finally {
      setBusy(false)
    }
  }

  async function handleDeactivate() {
    if (!confirm('¿Desactivar el especial de hoy?')) return
    setBusy(true)
    try {
      await setDailySpecial(today, { active: false }, {
        publishedBy: authUser?.uid, publishedByName: publisherName,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{
      marginTop: 18, borderRadius: 16,
      background: special.active ? '#FFF7E6' : '#fff',
      border: `1.5px solid ${special.active ? '#F4E0BC' : T.neutral[200]}`,
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '12px 14px',
        borderBottom: editing || special.active ? `1px solid ${special.active ? '#F4E0BC' : T.neutral[100]}` : 'none',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{ fontSize: 22, lineHeight: 1 }}>⭐</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.2 }}>
            Almuerzo Especial
          </div>
          <div style={{ fontSize: 11.5, color: T.neutral[500], marginTop: 1 }}>
            {special.active ? 'Activo hoy' : 'Sin especial hoy'}
          </div>
        </div>
        {special.active && !editing && (
          <span style={{
            fontSize: 10, fontWeight: 800, color: T.warn,
            letterSpacing: 0.4, textTransform: 'uppercase',
            padding: '3px 8px', borderRadius: 999,
            background: '#fff', border: `1px solid #F4E0BC`,
          }}>
            En venta
          </span>
        )}
      </div>

      <div style={{ padding: '12px 14px 14px' }}>
        {editing ? (
          <div>
            <FieldLabel>Precio para mesa ($)</FieldLabel>
            <input
              type="number" value={priceMesa}
              onChange={e => setPriceMesa(e.target.value)}
              placeholder="Ej: 20000"
              style={{ ...inputStyle(), fontSize: 15, padding: '12px 14px' }}
            />
            <FieldLabel>Precio para llevar ($)</FieldLabel>
            <input
              type="number" value={priceLlevar}
              onChange={e => setPriceLlevar(e.target.value)}
              placeholder="Si vacío, se usa el de mesa"
              style={{ ...inputStyle(), fontSize: 15, padding: '12px 14px' }}
            />
            <FieldLabel>Qué incluye <span style={{ color: T.neutral[400], fontWeight: 500 }}>· opcional</span></FieldLabel>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Ej: Bandeja paisa con aguacate y jugo"
              rows={2}
              style={{ ...inputStyle(), fontSize: 14, padding: '12px 14px', resize: 'vertical', minHeight: 60 }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setEditing(false)} disabled={busy}
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
                disabled={busy || !priceMesa}
                style={{
                  flex: 1.4, padding: '12px', borderRadius: 12,
                  background: !priceMesa ? T.neutral[200] : T.warn,
                  color: '#fff', border: 'none',
                  cursor: !priceMesa ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit', fontSize: 14, fontWeight: 800,
                }}
              >
                {busy ? 'Guardando…' : 'Guardar especial'}
              </button>
            </div>
          </div>
        ) : special.active ? (
          <div>
            <div style={{
              padding: '12px', borderRadius: 12, background: '#fff',
              border: `1px solid #F4E0BC`, marginBottom: 10,
            }}>
              {special.description && (
                <div style={{
                  fontSize: 13.5, color: T.neutral[800], lineHeight: 1.45,
                  marginBottom: 6, fontStyle: 'italic',
                }}>
                  "{special.description}"
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 2 }}>
                <span style={{ color: T.neutral[600] }}>Mesa</span>
                <span style={{ fontWeight: 800, color: T.warn, fontVariantNumeric: 'tabular-nums' }}>
                  {fmtCOP(special.priceMesa || 0)}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: T.neutral[600] }}>Llevar</span>
                <span style={{ fontWeight: 800, color: T.warn, fontVariantNumeric: 'tabular-nums' }}>
                  {fmtCOP(special.priceLlevar || 0)}
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setEditing(true)} disabled={busy}
                style={{
                  flex: 1, padding: '11px', borderRadius: 11,
                  background: '#fff', color: T.neutral[700],
                  border: `1.5px solid ${T.neutral[200]}`,
                  cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 13, fontWeight: 700,
                }}
              >
                ✎ Editar
              </button>
              <button
                onClick={handleDeactivate} disabled={busy}
                style={{
                  flex: 1, padding: '11px', borderRadius: 11,
                  background: 'transparent', color: T.bad,
                  border: `1.5px solid ${T.bad}55`,
                  cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 13, fontWeight: 700,
                }}
              >
                Desactivar
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setEditing(true)} disabled={busy}
            style={{
              width: '100%', padding: '14px', borderRadius: 12,
              background: T.warn, color: '#fff',
              border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 14, fontWeight: 800,
              boxShadow: `0 3px 10px ${T.warn}44`,
            }}
          >
            + Activar especial de hoy
          </button>
        )}
      </div>
    </div>
  )
}

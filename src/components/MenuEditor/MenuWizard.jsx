import { useEffect, useMemo, useRef, useState } from 'react'
import { T } from '../../tokens'
import { fmtCOP } from '../../utils/format'
import {
  CATEGORIES, CATEGORY_IDS,
  createMenuItem, setDailyMenuItem, setDailySpecial,
} from '../../menu'
import { FieldLabel, inputStyle, ErrorBox } from './ui'

// ──────────────────────────────────────────────────────────────
// Wizard paso a paso para crear el menú del día desde cero.
// Pantalla completa. Una categoría por paso → especial → resumen.
//
// Steps:
//   0..5 → CATEGORIES (sopa, principio, proteína, acompañante, ensalada, jugo)
//   6   → especial (toggle + precios opcionales)
//   7   → resumen + publicar
//
// Props:
//   today (YYYY-MM-DD), authUser, publisherName, allMenuItems
//   onClose → cierra el wizard sin publicar
//   onDone  → se ejecuta tras publicar exitosamente
// ──────────────────────────────────────────────────────────────
export default function MenuWizard({
  today, authUser, publisherName, allMenuItems,
  onClose, onDone,
}) {
  const TOTAL_STEPS = CATEGORIES.length + 2 // categorías + especial + resumen
  const [step, setStep] = useState(0)

  // Selecciones por categoría (arrays de itemIds)
  const [selections, setSelections] = useState(() => {
    const out = {}
    for (const c of CATEGORY_IDS) out[c] = []
    return out
  })

  // Estado del especial
  const [special, setSpecial] = useState({
    active: false,
    priceMesa: '',
    priceLlevar: '',
    description: '',
  })

  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState(null)

  // Bloquear scroll del body mientras el wizard está abierto
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  function setCategorySelection(catId, ids) {
    setSelections(prev => ({ ...prev, [catId]: ids }))
  }

  function next() { setStep(s => Math.min(s + 1, TOTAL_STEPS - 1)) }
  function back() { setStep(s => Math.max(s - 1, 0)) }

  async function publish() {
    setPublishing(true); setPublishError(null)
    try {
      // Guardar cada categoría
      for (const cat of CATEGORY_IDS) {
        await setDailyMenuItem(today, cat, selections[cat] || [], {
          publishedBy: authUser?.uid,
          publishedByName: publisherName,
        })
      }
      // Guardar especial
      if (special.active) {
        const pm = Number(special.priceMesa) || 0
        const pl = Number(special.priceLlevar) || 0
        if (pm > 0) {
          await setDailySpecial(today, {
            active: true,
            priceMesa: pm,
            priceLlevar: pl > 0 ? pl : pm,
            description: special.description,
          }, { publishedBy: authUser?.uid, publishedByName: publisherName })
        } else {
          await setDailySpecial(today, { active: false },
            { publishedBy: authUser?.uid, publishedByName: publisherName })
        }
      } else {
        await setDailySpecial(today, { active: false },
          { publishedBy: authUser?.uid, publishedByName: publisherName })
      }
      onDone?.()
    } catch (err) {
      console.error('[wizard] publish failed:', err)
      setPublishError('No pudimos publicar el menú. Intenta de nuevo.')
    } finally {
      setPublishing(false)
    }
  }

  const isCategoryStep = step < CATEGORIES.length
  const isSpecialStep = step === CATEGORIES.length
  const isSummaryStep = step === CATEGORIES.length + 1

  return (
    <FullscreenOverlay>
      <WizardHeader
        step={step}
        total={TOTAL_STEPS}
        onClose={onClose}
      />

      <div style={{
        flex: 1, overflowY: 'auto',
        background: T.neutral[50],
      }}>
        <div style={{ maxWidth: 540, margin: '0 auto', padding: '20px 18px 120px' }}>
          {isCategoryStep && (
            <CategoryStep
              category={CATEGORIES[step]}
              allMenuItems={allMenuItems}
              selected={selections[CATEGORIES[step].id]}
              onChange={ids => setCategorySelection(CATEGORIES[step].id, ids)}
              authUser={authUser}
              publisherName={publisherName}
            />
          )}

          {isSpecialStep && (
            <SpecialStep
              special={special}
              onChange={setSpecial}
            />
          )}

          {isSummaryStep && (
            <SummaryStep
              selections={selections}
              allMenuItems={allMenuItems}
              special={special}
            />
          )}
        </div>
      </div>

      <WizardFooter
        step={step}
        total={TOTAL_STEPS}
        category={isCategoryStep ? CATEGORIES[step] : null}
        selectionForCategory={isCategoryStep ? selections[CATEGORIES[step].id] : null}
        publishing={publishing}
        publishError={publishError}
        onBack={back}
        onNext={next}
        onPublish={publish}
      />
    </FullscreenOverlay>
  )
}

// ──────────────────────────────────────────────────────────────
// Overlay primitivo de pantalla completa
// ──────────────────────────────────────────────────────────────
function FullscreenOverlay({ children }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: '#fff',
      display: 'flex', flexDirection: 'column',
      paddingTop: 'env(safe-area-inset-top, 0px)',
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
    }}>
      {children}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Header del wizard: progreso + botón cerrar
// ──────────────────────────────────────────────────────────────
function WizardHeader({ step, total, onClose }) {
  const pct = ((step + 1) / total) * 100
  return (
    <div style={{
      padding: '14px 18px 12px',
      background: '#fff',
      borderBottom: `1px solid ${T.neutral[100]}`,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10,
      }}>
        <button
          onClick={onClose}
          aria-label="Cerrar"
          style={{
            width: 36, height: 36, borderRadius: 999,
            background: T.neutral[100], border: 'none',
            cursor: 'pointer', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'inherit',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 3 L11 11 M11 3 L3 11"
              stroke={T.neutral[700]} strokeWidth="2.2"
              strokeLinecap="round" />
          </svg>
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 11.5, fontWeight: 800, color: T.neutral[500],
            letterSpacing: 0.5, textTransform: 'uppercase',
          }}>
            Paso {step + 1} de {total}
          </div>
          <div style={{ fontSize: 14, fontWeight: 800, color: T.neutral[900] }}>
            Armar menú del día
          </div>
        </div>
      </div>
      <div style={{
        height: 6, borderRadius: 999, background: T.neutral[100],
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${pct}%`, height: '100%',
          background: T.copper[500],
          transition: 'width 0.3s ease',
        }} />
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Footer: botones Atrás / Saltar / Siguiente / Publicar
// ──────────────────────────────────────────────────────────────
function WizardFooter({
  step, total, category, selectionForCategory,
  publishing, publishError,
  onBack, onNext, onPublish,
}) {
  const isFirst = step === 0
  const isSummary = step === total - 1
  const canSkip = category && !category.required
  const hasSelection = selectionForCategory && selectionForCategory.length > 0
  const nextDisabled = category && category.required && !hasSelection

  return (
    <div style={{
      padding: '12px 14px',
      paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
      background: '#fff',
      borderTop: `1px solid ${T.neutral[100]}`,
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      {publishError && (
        <div style={{
          padding: '10px 12px', borderRadius: 10,
          background: '#FBE9E5', border: `1px solid #F0C8BE`,
          color: T.bad, fontSize: 12.5, textAlign: 'center',
        }}>
          ⚠ {publishError}
        </div>
      )}
      <div style={{ display: 'flex', gap: 10 }}>
        {!isFirst && (
          <button
            onClick={onBack}
            disabled={publishing}
            style={{
              padding: '14px 18px', borderRadius: 14,
              background: T.neutral[100], color: T.neutral[700],
              border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 14, fontWeight: 700, flexShrink: 0,
            }}
          >
            ← Atrás
          </button>
        )}
        {canSkip && !hasSelection && (
          <button
            onClick={onNext}
            disabled={publishing}
            style={{
              padding: '14px 16px', borderRadius: 14,
              background: 'transparent', color: T.neutral[600],
              border: `1.5px solid ${T.neutral[200]}`,
              cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 13.5, fontWeight: 700, flexShrink: 0,
            }}
          >
            Saltar
          </button>
        )}
        {isSummary ? (
          <button
            onClick={onPublish}
            disabled={publishing}
            style={{
              flex: 1, padding: '16px', borderRadius: 14,
              background: T.ok, color: '#fff',
              border: 'none', cursor: publishing ? 'wait' : 'pointer',
              fontFamily: 'inherit', fontSize: 16, fontWeight: 800,
              letterSpacing: -0.2, opacity: publishing ? 0.75 : 1,
              boxShadow: `0 4px 14px ${T.ok}55`,
            }}
          >
            {publishing ? 'Publicando…' : '✓ Publicar menú del día'}
          </button>
        ) : (
          <button
            onClick={onNext}
            disabled={nextDisabled}
            style={{
              flex: 1, padding: '16px', borderRadius: 14,
              background: nextDisabled ? T.neutral[200] : T.copper[500],
              color: nextDisabled ? T.neutral[500] : '#fff',
              border: 'none', cursor: nextDisabled ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', fontSize: 15, fontWeight: 800,
              letterSpacing: -0.2,
              boxShadow: nextDisabled ? 'none' : `0 4px 12px ${T.copper[500]}55`,
            }}
          >
            Siguiente →
          </button>
        )}
      </div>
      {nextDisabled && (
        <div style={{
          fontSize: 11.5, color: T.neutral[500], textAlign: 'center',
        }}>
          Esta categoría es obligatoria
        </div>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Step de categoría: input con autocompletado + chips
// ──────────────────────────────────────────────────────────────
function CategoryStep({
  category, allMenuItems, selected, onChange,
  authUser, publisherName,
}) {
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState(null)
  const inputRef = useRef(null)

  // Items del catálogo en esta categoría (no archivados, ordenados)
  const categoryItems = useMemo(() => {
    return allMenuItems
      .filter(it => it.category === category.id && !it.archived)
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  }, [allMenuItems, category.id])

  // Filtrado por búsqueda
  const filteredSuggestions = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return categoryItems.filter(it => !selected.includes(it.id))
    return categoryItems
      .filter(it => !selected.includes(it.id))
      .filter(it => (it.name || '').toLowerCase().includes(q))
  }, [categoryItems, query, selected])

  // Detectar si hay match exacto (para saber si mostrar "crear")
  const hasExactMatch = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return categoryItems.some(it => (it.name || '').toLowerCase() === q)
  }, [categoryItems, query])

  const selectedItems = useMemo(() => {
    return selected
      .map(id => allMenuItems.find(it => it.id === id))
      .filter(Boolean)
  }, [selected, allMenuItems])

  function addItem(itemId) {
    if (selected.includes(itemId)) return
    if (category.multi) {
      onChange([...selected, itemId])
    } else {
      onChange([itemId])
    }
    setQuery('')
    inputRef.current?.focus()
  }

  function removeItem(itemId) {
    onChange(selected.filter(id => id !== itemId))
  }

  async function handleCreateAndAdd() {
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
      addItem(newId)
    } catch (err) {
      console.error('[wizard] create item failed:', err)
      setCreateError('No pudimos crear la opción. Intenta de nuevo.')
    } finally {
      setCreating(false)
    }
  }

  const helpText = category.multi
    ? '¿Qué opciones hay hoy? Puedes agregar varias.'
    : 'Esta categoría va con UNA sola opción.'

  return (
    <div>
      {/* Hero del paso */}
      <div style={{
        textAlign: 'center', padding: '20px 0 24px',
      }}>
        <div style={{ fontSize: 60, lineHeight: 1, marginBottom: 8 }}>
          {category.emoji}
        </div>
        <div style={{
          fontSize: 26, fontWeight: 900, color: T.neutral[900],
          letterSpacing: -0.6, lineHeight: 1.15, marginBottom: 6,
        }}>
          {category.label}
        </div>
        <div style={{
          fontSize: 14, color: T.neutral[600], lineHeight: 1.5,
          maxWidth: 360, marginLeft: 'auto', marginRight: 'auto',
        }}>
          {helpText}
        </div>
      </div>

      {/* Chips de seleccionados */}
      {selectedItems.length > 0 && (
        <div style={{
          marginBottom: 16, padding: 14, borderRadius: 14,
          background: T.copper[50], border: `1px solid ${T.copper[100]}`,
        }}>
          <div style={{
            fontSize: 11, fontWeight: 800, color: T.copper[700],
            letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8,
          }}>
            Agregadas ({selectedItems.length})
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {selectedItems.map(it => (
              <div key={it.id} style={{
                padding: '8px 10px 8px 14px', borderRadius: 999,
                background: T.copper[500], color: '#fff',
                display: 'inline-flex', alignItems: 'center', gap: 8,
                fontSize: 14, fontWeight: 700,
                boxShadow: `0 2px 6px ${T.copper[500]}55`,
              }}>
                {it.name}
                <button
                  onClick={() => removeItem(it.id)}
                  aria-label={`Quitar ${it.name}`}
                  style={{
                    width: 22, height: 22, borderRadius: 999,
                    background: 'rgba(255,255,255,0.25)', border: 'none',
                    color: '#fff', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: 'inherit', padding: 0,
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2 2 L8 8 M8 2 L2 8" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Input de búsqueda */}
      {(category.multi || selected.length === 0) && (
        <>
          <FieldLabel>Buscar o escribir</FieldLabel>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setCreateError(null) }}
            placeholder={`Ej: ${exampleByCategory(category.id)}`}
            autoFocus
            maxLength={60}
            style={{
              ...inputStyle(),
              padding: '14px 16px',
              fontSize: 16,
            }}
          />

          {createError && <ErrorBox>{createError}</ErrorBox>}

          {/* Sugerencias */}
          {filteredSuggestions.length > 0 && (
            <div style={{
              marginTop: 4, marginBottom: 12,
              borderRadius: 14, background: '#fff',
              border: `1px solid ${T.neutral[100]}`,
              overflow: 'hidden',
            }}>
              {filteredSuggestions.map((it, i) => (
                <button
                  key={it.id}
                  onClick={() => addItem(it.id)}
                  style={{
                    width: '100%', padding: '14px 16px',
                    background: 'transparent', border: 'none',
                    borderBottom: i === filteredSuggestions.length - 1
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

          {/* Crear nuevo si no hay match exacto */}
          {query.trim() && !hasExactMatch && (
            <button
              onClick={handleCreateAndAdd}
              disabled={creating}
              style={{
                width: '100%', padding: '14px 16px', borderRadius: 14,
                background: '#fff', color: T.copper[700],
                border: `2px dashed ${T.copper[300]}`,
                cursor: creating ? 'wait' : 'pointer',
                fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
                textAlign: 'left', lineHeight: 1.4,
                opacity: creating ? 0.7 : 1, marginBottom: 12,
              }}
            >
              {creating ? 'Creando…' : (
                <>
                  + Crear <b>"{query.trim()}"</b> y guardarla en el catálogo
                </>
              )}
            </button>
          )}

          {filteredSuggestions.length === 0 && !query.trim() && categoryItems.length === 0 && (
            <div style={{
              padding: 18, borderRadius: 14, textAlign: 'center',
              background: T.neutral[50], border: `1px dashed ${T.neutral[200]}`,
              color: T.neutral[600], fontSize: 13, lineHeight: 1.5,
            }}>
              Aún no tienes opciones de <b>{category.label.toLowerCase()}</b> en el catálogo.
              Escribe el nombre arriba para crear la primera.
            </div>
          )}
        </>
      )}

      {/* Caso "una sola" ya seleccionada: ofrecer cambiar */}
      {!category.multi && selected.length > 0 && (
        <button
          onClick={() => onChange([])}
          style={{
            width: '100%', padding: '14px 16px', borderRadius: 14,
            background: 'transparent', color: T.neutral[600],
            border: `1.5px dashed ${T.neutral[300]}`,
            cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 13.5, fontWeight: 700,
          }}
        >
          Cambiar por otra
        </button>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Step del Almuerzo Especial
// ──────────────────────────────────────────────────────────────
function SpecialStep({ special, onChange }) {
  return (
    <div>
      <div style={{ textAlign: 'center', padding: '20px 0 24px' }}>
        <div style={{ fontSize: 60, lineHeight: 1, marginBottom: 8 }}>⭐</div>
        <div style={{
          fontSize: 26, fontWeight: 900, color: T.neutral[900],
          letterSpacing: -0.6, lineHeight: 1.15, marginBottom: 6,
        }}>
          Almuerzo Especial
        </div>
        <div style={{
          fontSize: 14, color: T.neutral[600], lineHeight: 1.5,
          maxWidth: 380, marginLeft: 'auto', marginRight: 'auto',
        }}>
          Un plato fuera de menú con su propio precio. Sin categorías.
        </div>
      </div>

      <div style={{
        padding: 18, borderRadius: 16,
        background: special.active ? '#FFF7E6' : T.neutral[50],
        border: `1.5px solid ${special.active ? '#F4E0BC' : T.neutral[200]}`,
        marginBottom: 16,
      }}>
        <label style={{
          display: 'flex', alignItems: 'center', gap: 12,
          cursor: 'pointer',
        }}>
          <input
            type="checkbox"
            checked={special.active}
            onChange={e => onChange({ ...special, active: e.target.checked })}
            style={{ width: 22, height: 22, accentColor: T.warn, cursor: 'pointer' }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: T.neutral[900] }}>
              ¿Hay especial hoy?
            </div>
            <div style={{ fontSize: 12.5, color: T.neutral[600], marginTop: 2 }}>
              {special.active ? 'Sí, lo activo' : 'No por hoy'}
            </div>
          </div>
        </label>
      </div>

      {special.active && (
        <div>
          <FieldLabel>Precio para mesa ($)</FieldLabel>
          <input
            type="number"
            value={special.priceMesa}
            onChange={e => onChange({ ...special, priceMesa: e.target.value })}
            placeholder="Ej: 20000"
            style={{ ...inputStyle(), fontSize: 16, padding: '14px 16px' }}
          />
          <FieldLabel>Precio para llevar ($)</FieldLabel>
          <input
            type="number"
            value={special.priceLlevar}
            onChange={e => onChange({ ...special, priceLlevar: e.target.value })}
            placeholder="Si vacío, se usa el de mesa"
            style={{ ...inputStyle(), fontSize: 16, padding: '14px 16px' }}
          />
          <FieldLabel>Qué incluye <span style={{ color: T.neutral[400], fontWeight: 500 }}>· opcional</span></FieldLabel>
          <textarea
            value={special.description}
            onChange={e => onChange({ ...special, description: e.target.value })}
            placeholder="Ej: Bandeja paisa con aguacate y jugo natural"
            rows={3}
            style={{
              ...inputStyle(), fontSize: 15, padding: '12px 14px',
              resize: 'vertical', minHeight: 80,
            }}
          />
        </div>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Step final: resumen y botón publicar
// ──────────────────────────────────────────────────────────────
function SummaryStep({ selections, allMenuItems, special }) {
  const resolved = useMemo(() => {
    const out = {}
    for (const c of CATEGORIES) {
      const ids = selections[c.id] || []
      out[c.id] = ids
        .map(id => allMenuItems.find(it => it.id === id))
        .filter(Boolean)
    }
    return out
  }, [selections, allMenuItems])

  const visibleCategories = CATEGORIES.filter(c => resolved[c.id].length > 0)
  const totalItems = visibleCategories.reduce(
    (sum, c) => sum + resolved[c.id].length, 0
  )

  return (
    <div>
      <div style={{ textAlign: 'center', padding: '20px 0 24px' }}>
        <div style={{ fontSize: 60, lineHeight: 1, marginBottom: 8 }}>✨</div>
        <div style={{
          fontSize: 26, fontWeight: 900, color: T.neutral[900],
          letterSpacing: -0.6, lineHeight: 1.15, marginBottom: 6,
        }}>
          Listo el menú
        </div>
        <div style={{
          fontSize: 14, color: T.neutral[600], lineHeight: 1.5,
        }}>
          Revisa antes de publicar.
        </div>
      </div>

      <div style={{
        borderRadius: 18, background: '#fff',
        border: `1.5px solid ${T.copper[200]}`,
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '14px 18px',
          background: T.copper[50],
          borderBottom: `1px solid ${T.copper[100]}`,
          fontSize: 12.5, fontWeight: 800, color: T.copper[700],
          letterSpacing: 0.4, textTransform: 'uppercase',
        }}>
          Resumen · {totalItems} {totalItems === 1 ? 'opción' : 'opciones'}
        </div>

        {visibleCategories.length === 0 && !special.active && (
          <div style={{
            padding: 24, textAlign: 'center',
            color: T.neutral[500], fontSize: 13.5, lineHeight: 1.5,
          }}>
            No agregaste nada. Vuelve atrás para llenar al menos una categoría.
          </div>
        )}

        <div style={{ padding: '8px 18px 14px' }}>
          {visibleCategories.map((cat, idx) => (
            <div key={cat.id} style={{
              padding: '10px 0',
              borderBottom: idx === visibleCategories.length - 1 && !special.active
                ? 'none'
                : `1px solid ${T.neutral[100]}`,
              display: 'flex', gap: 12, alignItems: 'flex-start',
            }}>
              <div style={{ width: 28, fontSize: 20, flexShrink: 0, textAlign: 'center' }}>
                {cat.emoji}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 11.5, fontWeight: 800, color: T.neutral[500],
                  letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 3,
                }}>
                  {cat.label}
                </div>
                <div style={{ fontSize: 14, color: T.neutral[900], lineHeight: 1.45, fontWeight: 600 }}>
                  {resolved[cat.id].map(it => it.name).join(' · ')}
                </div>
              </div>
            </div>
          ))}

          {special.active && (
            <div style={{
              padding: '10px 0', marginTop: 4,
              borderTop: `1px dashed ${T.neutral[200]}`,
              display: 'flex', gap: 12, alignItems: 'flex-start',
            }}>
              <div style={{ width: 28, fontSize: 20, flexShrink: 0, textAlign: 'center' }}>⭐</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 11.5, fontWeight: 800, color: T.warn,
                  letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 3,
                }}>
                  Almuerzo Especial
                </div>
                <div style={{ fontSize: 14, color: T.neutral[900], lineHeight: 1.45, fontWeight: 600 }}>
                  {special.description || 'Sin descripción'}
                </div>
                <div style={{
                  fontSize: 12, color: T.neutral[600], marginTop: 3,
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  Mesa {fmtCOP(Number(special.priceMesa) || 0)} ·
                  Llevar {fmtCOP(Number(special.priceLlevar) || Number(special.priceMesa) || 0)}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function exampleByCategory(catId) {
  return {
    soup: 'Sopa de arroz',
    principio: 'Frijoles',
    protein: 'Pollo Dorado',
    side: 'Arroz blanco',
    salad: 'Lechuga y tomate',
    juice: 'Jugo de mora',
  }[catId] || 'Nombre'
}

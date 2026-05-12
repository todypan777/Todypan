import { useEffect, useMemo, useState } from 'react'
import { T } from '../../tokens'
import { fmtCOP } from '../../utils/format'
import {
  CATEGORIES, CATEGORY_BY_ID, CATEGORY_IDS,
  watchMenuItems, watchDailyMenu, watchCorrienteConfig,
  setDailyMenuItem, setDailySpecial, setDailyCorriente,
  getCorrienteState, copyMenuFromDate, previousDateStr,
} from '../../menu'
import { useBogotaDate } from '../../utils/useBogotaDate'
import { FieldLabel, inputStyle, btnPrimary, btnSecondary, btnGhost } from './ui'

// ──────────────────────────────────────────────────────────────
// Editor del menú del día. Compartido entre la cocinera (CookApp)
// y el admin (modo Asistir cocinera).
//
// Props:
//   authUser  → para metadata publishedBy.
//   userDoc   → para publishedByName.
// ──────────────────────────────────────────────────────────────
export default function DailyMenuView({ authUser, userDoc }) {
  const today = useBogotaDate()
  const [allItems, setAllItems] = useState([])
  const [dailyMenu, setDailyMenu] = useState(null)
  const [corrienteConfig, setCorrienteConfig] = useState(null)
  const publisherName = `${userDoc?.nombre || ''} ${userDoc?.apellido || ''}`.trim() || authUser?.email || 'Editor'

  useEffect(() => watchMenuItems(setAllItems), [])
  useEffect(() => watchDailyMenu(today, setDailyMenu), [today])
  useEffect(() => watchCorrienteConfig(setCorrienteConfig), [])

  const itemsByCategory = useMemo(() => {
    const out = {}
    for (const cat of CATEGORY_IDS) out[cat] = []
    for (const item of allItems) {
      if (item.archived) continue
      if (out[item.category]) out[item.category].push(item)
    }
    return out
  }, [allItems])

  const activeIds = useMemo(() => {
    const out = {}
    for (const cat of CATEGORY_IDS) {
      out[cat] = new Set(dailyMenu?.itemsByCategory?.[cat] || [])
    }
    return out
  }, [dailyMenu])

  const corriente = useMemo(
    () => getCorrienteState(dailyMenu, allItems, corrienteConfig),
    [dailyMenu, allItems, corrienteConfig]
  )

  const dailyIsEmpty = !dailyMenu
    || (
      !dailyMenu.itemsByCategory
      && (!dailyMenu.special || !dailyMenu.special.active)
    )

  async function toggleItem(category, itemId) {
    const cat = CATEGORY_BY_ID[category]
    const current = dailyMenu?.itemsByCategory?.[category] || []
    let next
    if (cat.multi) {
      next = current.includes(itemId)
        ? current.filter(id => id !== itemId)
        : [...current, itemId]
    } else {
      next = current.includes(itemId) ? [] : [itemId]
    }
    await setDailyMenuItem(today, category, next, {
      publishedBy: authUser.uid,
      publishedByName: publisherName,
    })
  }

  return (
    <div style={{ padding: '16px 14px 80px' }}>
      {dailyIsEmpty && (
        <CopyYesterdayCard
          today={today}
          authUser={authUser}
          publisherName={publisherName}
        />
      )}

      <CorrienteSection
        corriente={corriente}
        date={today}
        authUser={authUser}
        publisherName={publisherName}
        existingPriceMesa={corrienteConfig?.priceMesa}
        existingPriceLlevar={corrienteConfig?.priceLlevar}
      />

      <div style={{
        padding: '10px 14px', borderRadius: 12, margin: '4px 0 14px',
        background: T.copper[50], border: `1px solid ${T.copper[100]}`,
        fontSize: 12.5, color: T.copper[700], lineHeight: 1.5,
      }}>
        💡 Activa lo que hay disponible <b>hoy</b>. Los cambios aplican en vivo —
        si algo se acaba, desactívalo y desaparece del menú de la cajera al instante.
      </div>

      {CATEGORIES.map(cat => (
        <CategorySection
          key={cat.id}
          category={cat}
          items={itemsByCategory[cat.id]}
          activeIds={activeIds[cat.id]}
          onToggle={(itemId) => toggleItem(cat.id, itemId)}
        />
      ))}

      <SpecialSection
        dailyMenu={dailyMenu}
        date={today}
        authUser={authUser}
        publisherName={publisherName}
      />
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Card "Almuerzo Corriente": precios + estado de disponibilidad
// ──────────────────────────────────────────────────────────────
function CorrienteSection({ corriente, date, authUser, publisherName, existingPriceMesa, existingPriceLlevar }) {
  const [editing, setEditing] = useState(false)
  const [priceMesa, setPriceMesa] = useState(String(existingPriceMesa || ''))
  const [priceLlevar, setPriceLlevar] = useState(String(existingPriceLlevar || ''))
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState(null)

  useEffect(() => {
    if (!editing) {
      setPriceMesa(String(existingPriceMesa || ''))
      setPriceLlevar(String(existingPriceLlevar || ''))
    }
  }, [editing, existingPriceMesa, existingPriceLlevar])

  async function handleSave() {
    const pm = Number(priceMesa) || 0
    const pl = Number(priceLlevar) || 0
    if (pm <= 0) return
    setBusy(true)
    setSaveError(null)
    try {
      await setDailyCorriente(date, {
        priceMesa: pm,
        priceLlevar: pl > 0 ? pl : pm,
      }, { publishedBy: authUser.uid, publishedByName: publisherName })
      setEditing(false)
    } catch (err) {
      console.error('[corriente] no se pudo guardar el precio:', err)
      const code = err?.code || ''
      if (code === 'permission-denied') {
        setSaveError('Permisos insuficientes. Avisa al admin para revisar reglas de Firestore.')
      } else if (code === 'invalid-argument' || /reserved/i.test(err?.message || '')) {
        setSaveError('Error interno con el id del documento. Avisa al programador.')
      } else if (code === 'unavailable') {
        setSaveError('Sin conexión. Intenta de nuevo cuando vuelva la red.')
      } else {
        setSaveError(`No se pudo guardar. ${err?.message || 'Intenta de nuevo.'}`)
      }
    } finally {
      setBusy(false)
    }
  }

  const tone = corriente.available
    ? { bg: '#E8F4E8', border: T.ok + '55', label: 'Disponible', labelColor: T.ok }
    : { bg: '#FFF7E6', border: '#F4E0BC', label: 'Falta configurar', labelColor: T.warn }

  return (
    <div style={{
      padding: '14px 16px', borderRadius: 16, marginBottom: 14,
      background: tone.bg, border: `1.5px solid ${tone.border}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 18 }}>🍽️</span>
        <div style={{ fontSize: 14, fontWeight: 800, color: T.neutral[900] }}>
          Almuerzo Corriente
        </div>
        <span style={{
          fontSize: 10, fontWeight: 700, color: tone.labelColor,
          letterSpacing: 0.4, textTransform: 'uppercase',
          padding: '2px 7px', borderRadius: 999,
          background: '#fff', border: `1px solid ${tone.border}`,
        }}>
          {tone.label}
        </span>
      </div>

      {!corriente.available && (
        <div style={{ fontSize: 12, color: T.neutral[600], marginBottom: 12, lineHeight: 1.5 }}>
          {corriente.missingPrice && 'Falta poner precio. '}
          {corriente.missingCategories.length > 0 && (
            <>Falta activar opciones de: <b>{corriente.missingCategories.join(', ')}</b>.</>
          )}
        </div>
      )}

      {editing ? (
        <div>
          <FieldLabel>Precio para mesa ($)</FieldLabel>
          <input type="number" value={priceMesa} onChange={e => setPriceMesa(e.target.value)}
            placeholder="Ej. 15000" style={inputStyle()} />
          <FieldLabel>Precio para llevar ($)</FieldLabel>
          <input type="number" value={priceLlevar} onChange={e => setPriceLlevar(e.target.value)}
            placeholder="Si vacío, se usa el de mesa" style={inputStyle()} />
          <div style={{
            fontSize: 11.5, color: T.neutral[600], lineHeight: 1.45,
            marginTop: 4, marginBottom: 8,
          }}>
            💡 Estos precios <b>se guardan permanentes</b> — no se reinician al día siguiente. Solo cámbialos cuando suba el precio.
          </div>
          {saveError && (
            <div style={{
              padding: '10px 12px', borderRadius: 10, marginBottom: 8,
              background: '#FBE9E5', border: `1px solid #F0C8BE`, color: T.bad,
              fontSize: 12.5, fontWeight: 600, lineHeight: 1.4,
            }}>
              ⚠ {saveError}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button onClick={() => { setEditing(false); setSaveError(null) }} disabled={busy} style={btnSecondary()}>Cancelar</button>
            <button onClick={handleSave} disabled={busy || !priceMesa} style={btnPrimary(T.copper[500])}>
              {busy ? 'Guardando...' : 'Guardar precios'}
            </button>
          </div>
        </div>
      ) : (
        <>
          {(corriente.priceMesa > 0 || corriente.priceLlevar > 0) ? (
            <div style={{
              padding: '10px 12px', borderRadius: 10, background: '#fff',
              marginBottom: 10, border: `1px solid ${T.neutral[100]}`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
                <span style={{ fontSize: 12.5, color: T.neutral[600] }}>Para mesa</span>
                <span style={{ fontSize: 14, fontWeight: 800, color: T.neutral[900], fontVariantNumeric: 'tabular-nums' }}>
                  {fmtCOP(corriente.priceMesa || 0)}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ fontSize: 12.5, color: T.neutral[600] }}>Para llevar</span>
                <span style={{ fontSize: 14, fontWeight: 800, color: T.neutral[900], fontVariantNumeric: 'tabular-nums' }}>
                  {fmtCOP(corriente.priceLlevar || 0)}
                </span>
              </div>
            </div>
          ) : null}
          <button onClick={() => setEditing(true)} disabled={busy} style={btnGhost(T.copper[600])}>
            ✎ {corriente.priceMesa > 0 ? 'Cambiar precios' : 'Definir precios'}
          </button>
        </>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Botón "Copiar lo de ayer"
// ──────────────────────────────────────────────────────────────
function CopyYesterdayCard({ today, authUser, publisherName }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)

  async function handleCopy() {
    if (busy) return
    setBusy(true); setError(null)
    try {
      const yesterday = previousDateStr(today)
      const ok = await copyMenuFromDate(yesterday, today, {
        publishedBy: authUser.uid,
        publishedByName: publisherName,
      })
      if (!ok) {
        setError('No hay menú del día anterior para copiar.')
      } else {
        setDone(true)
      }
    } catch (err) {
      console.error('[menu] copy failed:', err)
      setError('No pudimos copiar el menú. Intenta de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  if (done) return null

  return (
    <div style={{
      padding: '12px 14px', borderRadius: 14, marginBottom: 14,
      background: T.neutral[100], border: `1px dashed ${T.neutral[300]}`,
    }}>
      <div style={{ fontSize: 13, color: T.neutral[700], marginBottom: 8, lineHeight: 1.4 }}>
        ¿Mismo menú que ayer? Cópialo y solo ajusta lo que cambia.
      </div>
      <button
        onClick={handleCopy}
        disabled={busy}
        style={{
          width: '100%', padding: '11px 14px', borderRadius: 12,
          background: T.neutral[800], color: '#fff',
          border: 'none', cursor: busy ? 'wait' : 'pointer',
          fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700,
          opacity: busy ? 0.7 : 1,
        }}
      >
        {busy ? 'Copiando...' : '📋 Copiar lo de ayer'}
      </button>
      {error && (
        <div style={{
          marginTop: 8, padding: '8px 10px', borderRadius: 8,
          background: '#FBE9E5', border: `1px solid #F0C8BE`,
          color: T.bad, fontSize: 12, textAlign: 'center',
        }}>
          {error}
        </div>
      )}
    </div>
  )
}

function CategorySection({ category, items, activeIds, onToggle }) {
  const activeCount = items.filter(it => activeIds.has(it.id)).length
  const subtitle = category.multi
    ? `${activeCount} de ${items.length} activas`
    : activeCount > 0 ? 'Definida' : 'Sin definir'

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
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
          {!category.multi && (
            <span style={{
              fontSize: 10, fontWeight: 700, color: T.neutral[500],
              letterSpacing: 0.4, textTransform: 'uppercase',
              padding: '2px 7px', borderRadius: 999,
              background: T.neutral[100],
            }}>
              Una sola
            </span>
          )}
        </div>
        <div style={{ fontSize: 11.5, color: T.neutral[500], fontWeight: 600 }}>
          {subtitle}
        </div>
      </div>

      {items.length === 0 ? (
        <div style={{
          padding: '14px', textAlign: 'center', borderRadius: 12,
          background: T.neutral[50], border: `1px dashed ${T.neutral[200]}`,
          color: T.neutral[500], fontSize: 12.5,
        }}>
          Sin opciones en el catálogo. Agrégalas en la pestaña Catálogo.
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {items.map(item => {
            const active = activeIds.has(item.id)
            return (
              <button
                key={item.id}
                onClick={() => onToggle(item.id)}
                style={{
                  padding: '10px 16px', borderRadius: 12,
                  background: active ? T.copper[500] : '#fff',
                  color: active ? '#fff' : T.neutral[700],
                  border: `1.5px solid ${active ? T.copper[500] : T.neutral[200]}`,
                  cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 14, fontWeight: 700,
                  display: 'flex', alignItems: 'center', gap: 8,
                  transition: 'background 0.15s, border-color 0.15s',
                  boxShadow: active ? '0 3px 10px rgba(184,122,86,0.3)' : 'none',
                }}
              >
                {active && (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M2 7 L6 11 L12 4" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
                {item.name}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function SpecialSection({ dailyMenu, date, authUser, publisherName }) {
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
      await setDailySpecial(date, {
        active: true,
        priceMesa: pm,
        priceLlevar: pl || pm,
        description,
      }, { publishedBy: authUser.uid, publishedByName: publisherName })
      setEditing(false)
    } finally {
      setBusy(false)
    }
  }

  async function handleDeactivate() {
    setBusy(true)
    try {
      await setDailySpecial(date, { active: false }, { publishedBy: authUser.uid, publishedByName: publisherName })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{
      marginTop: 24, padding: '14px 16px', borderRadius: 16,
      background: special.active ? '#FFF7E6' : T.neutral[50],
      border: `1.5px solid ${special.active ? '#F4E0BC' : T.neutral[200]}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 18 }}>⭐</span>
        <div style={{ fontSize: 14, fontWeight: 800, color: T.neutral[900] }}>
          Almuerzo Especial
        </div>
        {special.active && (
          <span style={{
            fontSize: 10, fontWeight: 700, color: T.warn,
            letterSpacing: 0.4, textTransform: 'uppercase',
            padding: '2px 7px', borderRadius: 999,
            background: '#fff', border: `1px solid #F4E0BC`,
          }}>
            Activo hoy
          </span>
        )}
      </div>
      <div style={{ fontSize: 12, color: T.neutral[600], marginBottom: 12, lineHeight: 1.5 }}>
        Sin categorías. La cajera lo vende como un almuerzo aparte con la descripción que pongas.
      </div>

      {editing ? (
        <div>
          <FieldLabel>Precio para mesa ($)</FieldLabel>
          <input type="number" value={priceMesa} onChange={e => setPriceMesa(e.target.value)}
            placeholder="Ej. 20000" style={inputStyle()} />
          <FieldLabel>Precio para llevar ($)</FieldLabel>
          <input type="number" value={priceLlevar} onChange={e => setPriceLlevar(e.target.value)}
            placeholder="Si no pones, se usa el de mesa" style={inputStyle()} />
          <FieldLabel>Qué incluye <span style={{ color: T.neutral[400], fontWeight: 500 }}>· opcional</span></FieldLabel>
          <textarea value={description} onChange={e => setDescription(e.target.value)}
            placeholder="Ej: Bandeja paisa con aguacate, jugo natural"
            rows={2}
            style={{ ...inputStyle(), resize: 'vertical', minHeight: 60 }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button onClick={() => setEditing(false)} disabled={busy} style={btnSecondary()}>Cancelar</button>
            <button onClick={handleSave} disabled={busy || !priceMesa} style={btnPrimary(T.warn)}>
              {busy ? 'Guardando...' : 'Activar especial'}
            </button>
          </div>
        </div>
      ) : (
        <div>
          {special.active ? (
            <>
              <div style={{
                padding: '12px 14px', borderRadius: 12, background: '#fff',
                marginBottom: 10, border: `1px solid #F4E0BC`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
                  <span style={{ fontSize: 12.5, color: T.neutral[600] }}>Para mesa</span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: T.warn, fontVariantNumeric: 'tabular-nums' }}>
                    {fmtCOP(special.priceMesa || 0)}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ fontSize: 12.5, color: T.neutral[600] }}>Para llevar</span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: T.warn, fontVariantNumeric: 'tabular-nums' }}>
                    {fmtCOP(special.priceLlevar || 0)}
                  </span>
                </div>
                {special.description && (
                  <div style={{
                    marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${T.neutral[200]}`,
                    fontSize: 12.5, color: T.neutral[700], lineHeight: 1.45, fontStyle: 'italic',
                  }}>
                    "{special.description}"
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setEditing(true)} disabled={busy} style={btnGhost()}>
                  ✎ Editar
                </button>
                <button onClick={handleDeactivate} disabled={busy} style={btnGhost(T.bad)}>
                  Desactivar especial
                </button>
              </div>
            </>
          ) : (
            <button onClick={() => setEditing(true)} disabled={busy} style={btnPrimary(T.warn)}>
              + Activar especial de hoy
            </button>
          )}
        </div>
      )}
    </div>
  )
}

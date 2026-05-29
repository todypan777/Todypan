import { useEffect, useRef, useState } from 'react'
import { T } from '../../tokens'
import { fmtCOP } from '../../utils/format'
import {
  watchBreakfastConfig,
  setBreakfastActive,
  setBreakfastPrices,
  setBreakfastCombos,
  BREAKFAST_DEFAULTS,
} from '../../breakfast'
import { FieldLabel, inputStyle, ErrorBox } from './ui'

// ──────────────────────────────────────────────────────────────
// Tarjeta de configuración de DESAYUNO en el catálogo.
//
// Funciona como un panel autónomo (vive arriba en CatalogView).
//
// Estados:
//   1. Desayuno DESACTIVADO (default inicial)
//      → tarjeta colapsada con CTA "+ Activar desayuno"
//   2. Desayuno ACTIVADO
//      → switch para apagar + secciones expandibles de:
//         - Componentes (caldo, huevos, recargos, arroz, bebida, llevar)
//         - Combos con descuento (4 combos)
//
// La cocinera/admin edita libremente. Los cambios se guardan al confirmar
// cada bloque (no autosave) para evitar guardar mientras escribe.
// ──────────────────────────────────────────────────────────────

export default function BreakfastPricesCard({ authUser, editorName }) {
  const [config, setConfig] = useState(null)
  useEffect(() => watchBreakfastConfig(setConfig), [])

  // Mientras carga, mostramos un skeleton mínimo para no flashear.
  if (!config) {
    return (
      <div style={{
        marginBottom: 18, borderRadius: 18, padding: '20px',
        background: T.neutral[25], border: `1.5px dashed ${T.neutral[200]}`,
        color: T.neutral[500], fontSize: 13, textAlign: 'center',
      }}>
        Cargando configuración de desayuno…
      </div>
    )
  }

  if (!config.active) {
    return (
      <InactiveCard
        authUser={authUser}
        editorName={editorName}
        onActivate={() => setBreakfastActive(true, {
          publishedBy: authUser?.uid,
          publishedByName: editorName,
        })}
      />
    )
  }

  return (
    <ActiveCard
      config={config}
      authUser={authUser}
      editorName={editorName}
    />
  )
}

// ─── Estado INACTIVO ─────────────────────────────────────────
function InactiveCard({ onActivate }) {
  const [busy, setBusy] = useState(false)
  // Tras activar, el padre re-renderiza y este componente se desmonta antes
  // de que setBusy(false) corra → React warning. mountedRef lo evita.
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])

  async function handleActivate() {
    if (busy) return
    setBusy(true)
    try { await onActivate() }
    catch (err) {
      console.error('[breakfast] activate failed:', err)
      if (mountedRef.current) {
        alert('No pudimos activar el desayuno. Intenta de nuevo.')
      }
    }
    finally {
      if (mountedRef.current) setBusy(false)
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
        padding: '16px 18px',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: 14, flexShrink: 0,
          background: '#fff', border: `1.5px solid #F4E0BC`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 26,
        }}>
          ☕
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 15.5, fontWeight: 900, color: T.warn,
            letterSpacing: -0.3,
          }}>
            Desayuno
          </div>
          <div style={{
            fontSize: 12, color: T.neutral[600], marginTop: 2, lineHeight: 1.4,
          }}>
            Caldo + huevos + arroz + bebida con motor de precios y 4 combos.
          </div>
        </div>
        <button
          onClick={handleActivate}
          disabled={busy}
          style={{
            padding: '10px 16px', borderRadius: 12,
            background: T.warn, color: '#fff',
            border: 'none', cursor: busy ? 'wait' : 'pointer',
            fontFamily: 'inherit', fontSize: 13, fontWeight: 800,
            boxShadow: `0 3px 10px ${T.warn}44`,
            flexShrink: 0,
          }}
        >
          {busy ? 'Activando…' : '+ Activar'}
        </button>
      </div>
    </div>
  )
}

// ─── Estado ACTIVO ───────────────────────────────────────────
function ActiveCard({ config, authUser, editorName }) {
  const [busyToggle, setBusyToggle] = useState(false)

  async function handleDeactivate() {
    if (!confirm('¿Desactivar el desayuno? Dejará de aparecer en la cajera y en /menu.')) return
    setBusyToggle(true)
    try {
      await setBreakfastActive(false, {
        publishedBy: authUser?.uid,
        publishedByName: editorName,
      })
    } catch (err) {
      console.error('[breakfast] deactivate failed:', err)
      alert('No pudimos desactivar. Intenta de nuevo.')
    } finally {
      setBusyToggle(false)
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
      {/* Header con switch */}
      <div style={{
        padding: '14px 18px',
        display: 'flex', alignItems: 'center', gap: 12,
        borderBottom: '1px solid #F4E0BC',
        background: '#fff',
      }}>
        <span style={{ fontSize: 24, lineHeight: 1 }}>☕</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 15, fontWeight: 900, color: T.warn,
            letterSpacing: -0.3, display: 'flex', alignItems: 'center', gap: 8,
          }}>
            Desayuno
            <span style={{
              fontSize: 10, fontWeight: 800, color: T.ok,
              letterSpacing: 0.4, textTransform: 'uppercase',
              padding: '2px 7px', borderRadius: 999,
              background: '#E8F1E5', border: `1px solid #C0D4BA`,
            }}>
              Activo
            </span>
          </div>
          <div style={{ fontSize: 11.5, color: T.neutral[600], marginTop: 1, lineHeight: 1.4 }}>
            Se ofrece en cajera y en /menu mientras esté activo.
          </div>
        </div>
        <button
          onClick={handleDeactivate}
          disabled={busyToggle}
          style={{
            padding: '8px 12px', borderRadius: 10,
            background: 'transparent', color: T.bad,
            border: `1.5px solid ${T.bad}55`,
            cursor: busyToggle ? 'wait' : 'pointer',
            fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {busyToggle ? 'Desactivando…' : 'Desactivar'}
        </button>
      </div>

      {/* Componentes */}
      <ComponentsBlock config={config} authUser={authUser} editorName={editorName} />

      {/* Combos */}
      <CombosBlock config={config} authUser={authUser} editorName={editorName} />
    </div>
  )
}

// ─── Bloque: Componentes ─────────────────────────────────────
function ComponentsBlock({ config, authUser, editorName }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(() => fromConfig(config))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!editing) setDraft(fromConfig(config))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, config])

  function fromConfig(c) {
    return {
      caldoCostillaPrice:   String(c.caldoCostillaPrice || ''),
      caldoPescadoPrice:    String(c.caldoPescadoPrice || ''),
      huevosNormalesPrice:  String(c.huevosNormalesPrice || ''),
      rancherosRecargo:     String(c.rancherosRecargo || ''),
      arrozPanPrice:        String(c.arrozPanPrice || ''),
      bebidaPrice:          String(c.bebidaPrice || ''),
      llevarSurcharge:      String(c.llevarSurcharge || ''),
    }
  }

  function setField(key, val) { setDraft(prev => ({ ...prev, [key]: val })) }

  async function handleSave() {
    setBusy(true); setError(null)
    try {
      await setBreakfastPrices({
        caldoCostillaPrice:   Number(draft.caldoCostillaPrice) || 0,
        caldoPescadoPrice:    Number(draft.caldoPescadoPrice) || 0,
        huevosNormalesPrice:  Number(draft.huevosNormalesPrice) || 0,
        rancherosRecargo:     Number(draft.rancherosRecargo) || 0,
        arrozPanPrice:        Number(draft.arrozPanPrice) || 0,
        bebidaPrice:          Number(draft.bebidaPrice) || 0,
        llevarSurcharge:      Number(draft.llevarSurcharge) || 0,
      }, { publishedBy: authUser?.uid, publishedByName: editorName })
      setEditing(false)
    } catch (err) {
      console.error('[breakfast] save components failed:', err)
      setError('No se pudo guardar. Intenta de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ padding: '14px 16px', borderBottom: '1px solid #F4E0BC' }}>
      <div style={{
        fontSize: 11, fontWeight: 800, color: T.warn,
        letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8,
      }}>
        Componentes
      </div>

      {editing ? (
        <div style={{
          background: '#fff', borderRadius: 14, padding: 14,
          border: `1px solid #F4E0BC`,
        }}>
          <PriceField label="🍲 Caldo de costilla"           value={draft.caldoCostillaPrice}  onChange={v => setField('caldoCostillaPrice', v)} />
          <PriceField label="🐟 Caldo de pescado"            value={draft.caldoPescadoPrice}   onChange={v => setField('caldoPescadoPrice', v)} />
          <PriceField label="🥚 Huevos (revueltos/fritos/pericos)" value={draft.huevosNormalesPrice} onChange={v => setField('huevosNormalesPrice', v)} />
          <PriceField label="🍳 Recargo huevos rancheros"    value={draft.rancherosRecargo}    onChange={v => setField('rancherosRecargo', v)}    hint="Se SUMA al precio de huevos cuando son rancheros" />
          <PriceField label="🍚 Arroz con pan"               value={draft.arrozPanPrice}       onChange={v => setField('arrozPanPrice', v)} />
          <PriceField label="☕ Bebida caliente"             value={draft.bebidaPrice}         onChange={v => setField('bebidaPrice', v)} />
          <PriceField label="📦 Recargo por llevar"          value={draft.llevarSurcharge}     onChange={v => setField('llevarSurcharge', v)}    hint="Se suma al total mesa para obtener el total llevar" />

          {error && <ErrorBox>{error}</ErrorBox>}

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => { setEditing(false); setError(null) }}
              disabled={busy}
              style={{
                flex: 1, padding: '11px', borderRadius: 11,
                background: T.neutral[100], color: T.neutral[700],
                border: 'none', cursor: busy ? 'wait' : 'pointer',
                fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
              }}
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={busy}
              style={{
                flex: 1.4, padding: '11px', borderRadius: 11,
                background: T.warn, color: '#fff', border: 'none',
                cursor: busy ? 'wait' : 'pointer',
                fontFamily: 'inherit', fontSize: 13.5, fontWeight: 800,
                boxShadow: `0 3px 10px ${T.warn}44`,
              }}
            >
              {busy ? 'Guardando…' : 'Guardar componentes'}
            </button>
          </div>
        </div>
      ) : (
        <ComponentsReadOnly config={config} onEdit={() => setEditing(true)} />
      )}
    </div>
  )
}

function ComponentsReadOnly({ config, onEdit }) {
  const rows = [
    { emoji: '🍲', label: 'Caldo de costilla',       value: config.caldoCostillaPrice },
    { emoji: '🐟', label: 'Caldo de pescado',        value: config.caldoPescadoPrice },
    { emoji: '🥚', label: 'Huevos',                  value: config.huevosNormalesPrice },
    { emoji: '🍳', label: 'Recargo rancheros',       value: config.rancherosRecargo, isExtra: true },
    { emoji: '🍚', label: 'Arroz con pan',           value: config.arrozPanPrice },
    { emoji: '☕', label: 'Bebida caliente',         value: config.bebidaPrice },
    { emoji: '📦', label: 'Recargo por llevar',      value: config.llevarSurcharge, isExtra: true },
  ]
  return (
    <div>
      <div style={{
        background: '#fff', borderRadius: 12,
        border: `1px solid #F4E0BC`, overflow: 'hidden',
      }}>
        {rows.map((row, i) => (
          <div key={row.label} style={{
            padding: '10px 12px',
            borderBottom: i === rows.length - 1 ? 'none' : `0.5px solid #F4E0BC`,
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ fontSize: 16, lineHeight: 1, width: 22, textAlign: 'center', flexShrink: 0 }}>{row.emoji}</span>
            <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: T.neutral[800] }}>
              {row.label}
            </div>
            <div style={{
              fontSize: 13.5, fontWeight: 900, color: row.isExtra ? T.warn : T.neutral[900],
              fontVariantNumeric: 'tabular-nums', flexShrink: 0,
            }}>
              {row.isExtra ? '+' : ''}{fmtCOP(row.value)}
            </div>
          </div>
        ))}
      </div>
      <button
        onClick={onEdit}
        style={{
          marginTop: 10, width: '100%', padding: '10px',
          background: 'transparent', color: T.warn,
          border: `1.5px solid #F4E0BC`,
          borderRadius: 11, cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 12.5, fontWeight: 700,
        }}
      >
        ✎ Cambiar componentes
      </button>
    </div>
  )
}

function PriceField({ label, value, onChange, hint }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <FieldLabel>{label}</FieldLabel>
      <input
        type="number" value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="0"
        style={{ ...inputStyle(), fontSize: 14, padding: '11px 13px', marginBottom: hint ? 4 : 0 }}
      />
      {hint && (
        <div style={{
          fontSize: 11, color: T.neutral[500], lineHeight: 1.4, marginTop: -2,
          fontStyle: 'italic',
        }}>
          {hint}
        </div>
      )}
    </div>
  )
}

// ─── Bloque: Combos ──────────────────────────────────────────
function CombosBlock({ config, authUser, editorName }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(() => fromConfig(config))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!editing) setDraft(fromConfig(config))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, config])

  function fromConfig(c) {
    // Garantizar 4 combos: si la config tiene menos, completar con defaults.
    const defaults = BREAKFAST_DEFAULTS.combos
    const out = defaults.map(d => {
      const existing = (c.combos || []).find(x => x.id === d.id) || d
      return { ...d, priceMesa: String(existing.priceMesa || '') }
    })
    return out
  }

  function setComboPrice(id, val) {
    setDraft(prev => prev.map(c => c.id === id ? { ...c, priceMesa: val } : c))
  }

  async function handleSave() {
    setBusy(true); setError(null)
    try {
      const combos = draft.map(c => ({
        id: c.id, name: c.name,
        caldo: c.caldo, huevos: c.huevos,
        arroz: c.arroz, bebida: c.bebida,
        priceMesa: Number(c.priceMesa) || 0,
      }))
      await setBreakfastCombos(combos, {
        publishedBy: authUser?.uid,
        publishedByName: editorName,
      })
      setEditing(false)
    } catch (err) {
      console.error('[breakfast] save combos failed:', err)
      setError('No se pudo guardar. Intenta de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ padding: '14px 16px' }}>
      <div style={{
        fontSize: 11, fontWeight: 800, color: T.warn,
        letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8,
      }}>
        Combos con descuento
      </div>

      {editing ? (
        <div style={{
          background: '#fff', borderRadius: 14, padding: 14,
          border: `1px solid #F4E0BC`,
        }}>
          <div style={{
            fontSize: 11.5, color: T.neutral[600], lineHeight: 1.45,
            marginBottom: 10,
          }}>
            Cada combo es una combinación completa (caldo + huevos + arroz + bebida) que cobra el precio mesa que pongas aquí en lugar de la suma de componentes. Para llevar se suma el recargo automáticamente.
          </div>

          {draft.map(combo => (
            <div key={combo.id} style={{ marginBottom: 12 }}>
              <FieldLabel>{combo.name}</FieldLabel>
              <div style={{
                fontSize: 11, color: T.neutral[500], lineHeight: 1.4, marginBottom: 6,
              }}>
                {describeCombo(combo)}
              </div>
              <input
                type="number" value={combo.priceMesa}
                onChange={e => setComboPrice(combo.id, e.target.value)}
                placeholder="Precio mesa"
                style={{ ...inputStyle(), fontSize: 14, padding: '11px 13px', marginBottom: 0 }}
              />
            </div>
          ))}

          {error && <ErrorBox>{error}</ErrorBox>}

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => { setEditing(false); setError(null) }}
              disabled={busy}
              style={{
                flex: 1, padding: '11px', borderRadius: 11,
                background: T.neutral[100], color: T.neutral[700],
                border: 'none', cursor: busy ? 'wait' : 'pointer',
                fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
              }}
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={busy}
              style={{
                flex: 1.4, padding: '11px', borderRadius: 11,
                background: T.warn, color: '#fff', border: 'none',
                cursor: busy ? 'wait' : 'pointer',
                fontFamily: 'inherit', fontSize: 13.5, fontWeight: 800,
                boxShadow: `0 3px 10px ${T.warn}44`,
              }}
            >
              {busy ? 'Guardando…' : 'Guardar combos'}
            </button>
          </div>
        </div>
      ) : (
        <CombosReadOnly config={config} onEdit={() => setEditing(true)} />
      )}
    </div>
  )
}

function CombosReadOnly({ config, onEdit }) {
  const combos = config.combos || []
  const llevar = config.llevarSurcharge || 0
  return (
    <div>
      <div style={{
        background: '#fff', borderRadius: 12,
        border: `1px solid #F4E0BC`, overflow: 'hidden',
      }}>
        {combos.map((c, i) => (
          <div key={c.id} style={{
            padding: '10px 12px',
            borderBottom: i === combos.length - 1 ? 'none' : `0.5px solid #F4E0BC`,
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <div style={{ flex: 1, fontSize: 13, fontWeight: 800, color: T.neutral[900], minWidth: 0 }}>
                {c.name}
              </div>
              <div style={{
                fontSize: 13.5, fontWeight: 900, color: T.warn,
                fontVariantNumeric: 'tabular-nums', flexShrink: 0,
              }}>
                {fmtCOP(c.priceMesa)}
              </div>
            </div>
            <div style={{ fontSize: 11, color: T.neutral[500], marginTop: 2, lineHeight: 1.4 }}>
              {describeCombo(c)}
              {' · '}
              <span style={{ color: T.neutral[600] }}>Llevar {fmtCOP(c.priceMesa + llevar)}</span>
            </div>
          </div>
        ))}
      </div>
      <button
        onClick={onEdit}
        style={{
          marginTop: 10, width: '100%', padding: '10px',
          background: 'transparent', color: T.warn,
          border: `1.5px solid #F4E0BC`,
          borderRadius: 11, cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 12.5, fontWeight: 700,
        }}
      >
        ✎ Cambiar combos
      </button>
    </div>
  )
}

function describeCombo(c) {
  const parts = []
  if (c.caldo === 'costilla') parts.push('🍲 Costilla')
  else if (c.caldo === 'pescado') parts.push('🐟 Pescado')
  if (c.huevos === 'normal') parts.push('🥚 Huevos')
  else if (c.huevos === 'rancheros') parts.push('🍳 Rancheros')
  if (c.arroz) parts.push('🍚 Arroz con pan')
  if (c.bebida) parts.push('☕ Bebida')
  return parts.join(' + ')
}

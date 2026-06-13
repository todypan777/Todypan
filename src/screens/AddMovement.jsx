import { useMemo, useState } from 'react'
import { T } from '../tokens'
import { fmtCOP, todayStr } from '../utils/format'
import { addMovement, getAccounts, getData } from '../db'

export default function AddMovement({ initialKind = 'income', onBack, onSave }) {
  const [kind, setKind] = useState(initialKind)
  const [amount, setAmount] = useState('')
  const [catText, setCatText] = useState('')   // categoría escrita (OBLIGATORIA)
  const date = todayStr()

  // Cuentas del admin: a cuál entra/sale la plata. Elegir cuenta es OBLIGATORIO.
  const accounts = getAccounts()
  const [accountId, setAccountId] = useState(accounts[0]?.id || null)

  // Categorías que YA existen = las que el usuario ha usado antes (en cualquier
  // movimiento de cuenta). No hay predeterminadas: se van creando al escribir.
  const existingCats = useMemo(() => {
    const seen = new Map() // minúsculas -> texto original
    ;(getData().movements || []).forEach(m => {
      if (!m.accountId) return
      const label = String(m.cat || '').trim()
      if (!label) return
      const key = label.toLowerCase()
      if (!seen.has(key)) seen.set(key, label)
    })
    return [...seen.values()].sort((a, b) => a.localeCompare(b, 'es'))
  }, [])

  const isIncome = kind === 'income'

  // Si lo escrito ya existe (sin importar mayúsculas), reutilizamos esa categoría.
  function resolveCat(text) {
    const t = text.trim()
    return existingCats.find(c => c.toLowerCase() === t.toLowerCase()) || t
  }

  const q = catText.trim().toLowerCase()
  const suggestions = (q
    ? existingCats.filter(c => c.toLowerCase().includes(q) && c.toLowerCase() !== q)
    : existingCats
  ).slice(0, 8)

  const canSave = amount && Number(amount) > 0 && !!accountId && !!catText.trim()

  // ── Tema por tipo: INGRESO = verde, GASTO = rojo. Tiñe toda la pantalla.
  const theme = isIncome
    ? { main: T.ok,  text: '#356B34', light: '#E8F4E8', soft: '#F2F9F1', border: '#BFDCBE' }
    : { main: T.bad, text: '#8A3526', light: '#FBE9E5', soft: '#FDF2EF', border: '#F0C8BE' }

  function handleKeypad(k) {
    if (k === 'back') setAmount(a => a.slice(0, -1))
    else if (k === '000') setAmount(a => (a + '000').slice(0, 10))
    else setAmount(a => (a + k).slice(0, 10))
  }

  function handleSave() {
    if (!canSave) return
    addMovement({
      date,
      type: kind,
      amount: Number(amount),
      cat: resolveCat(catText),
      branch: 'both',
      accountId: accountId || undefined,
    })
    onSave()
  }

  const keys = [['1','2','3'],['4','5','6'],['7','8','9'],['000','0','back']]

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: theme.soft, transition: 'background 0.25s ease',
    }}>

      {/* ── Zona superior con color del tipo (verde / rojo) ── */}
      <div style={{
        background: theme.light,
        borderBottom: `1px solid ${theme.border}`,
        transition: 'background 0.25s ease, border-color 0.25s ease',
      }}>
        {/* Top bar */}
        <div style={{ padding: '20px 20px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={onBack} style={{
            background: 'none', border: 'none', padding: '6px 0',
            cursor: 'pointer', fontSize: 15, color: theme.text,
            fontFamily: 'inherit', fontWeight: 500, opacity: 0.85,
          }}>
            Cancelar
          </button>
          <div style={{ fontSize: 14, fontWeight: 700, color: theme.text, letterSpacing: 0.1 }}>
            Nuevo movimiento
          </div>
          <button onClick={handleSave} style={{
            background: 'none', border: 'none', padding: '6px 0',
            cursor: canSave ? 'pointer' : 'default',
            fontSize: 15, color: canSave ? theme.main : `${theme.main}55`,
            fontFamily: 'inherit', fontWeight: 800,
            transition: 'color 0.25s',
          }}>
            Guardar
          </button>
        </div>

        {/* Switch Ingreso / Gasto — grande y notorio */}
        <div style={{ padding: '18px 16px 0' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { id: 'income',  label: 'Ingreso', color: T.ok,  emoji: '↑' },
              { id: 'expense', label: 'Gasto',   color: T.bad, emoji: '↓' },
            ].map(o => {
              const active = kind === o.id
              return (
                <button key={o.id} onClick={() => setKind(o.id)} style={{
                  flex: 1, padding: '15px 10px', borderRadius: 16, border: 'none',
                  background: active ? o.color : '#fff',
                  color: active ? '#fff' : T.neutral[400],
                  fontSize: 17, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  boxShadow: active ? `0 6px 18px ${o.color}55` : `inset 0 0 0 1.5px ${T.neutral[200]}`,
                  transform: active ? 'scale(1.02)' : 'scale(1)',
                  transition: 'all 0.18s ease',
                }}>
                  <span style={{ fontSize: 18 }}>{o.emoji}</span>
                  {o.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Amount display */}
        <div style={{ padding: '22px 20px 22px', textAlign: 'center' }}>
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: 0.8,
            color: theme.text, opacity: 0.7,
            textTransform: 'uppercase', marginBottom: 6,
            transition: 'color 0.25s',
          }}>
            {isIncome ? 'Monto que entra' : 'Monto que sale'}
          </div>
          <div style={{
            fontSize: 52, fontWeight: 800, letterSpacing: -1.5,
            color: amount ? theme.main : `${theme.main}44`,
            fontVariantNumeric: 'tabular-nums', lineHeight: 1,
            transition: 'color 0.25s',
          }}>
            {amount ? fmtCOP(Number(amount)) : '$ 0'}
          </div>
        </div>
      </div>

      {/* ── Zona inferior (controles) — scrollable por si no cabe ── */}
      <div style={{ flex: 1, overflowY: 'auto' }}>

        {/* Cuenta (obligatorio): a qué cuenta entra/sale la plata */}
        <div style={{ padding: '14px 16px 0' }}>
          <SectionLabel theme={theme}>
            {isIncome ? '¿A qué cuenta entró?' : '¿De qué cuenta salió?'}
          </SectionLabel>
          {accounts.length === 0 ? (
            <Warn>No hay cuentas creadas. Crea una en la pestaña Cuentas para registrar movimientos.</Warn>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              {accounts.map(acc => {
                const isActive = accountId === acc.id
                return (
                  <button key={acc.id} onClick={() => setAccountId(acc.id)} style={{
                    flex: '1 1 0', minWidth: 92, padding: '10px 12px', borderRadius: 12,
                    border: isActive ? `2px solid ${theme.main}` : `1.5px solid ${T.neutral[200]}`,
                    background: isActive ? theme.light : '#fff',
                    color: isActive ? theme.text : T.neutral[600],
                    cursor: 'pointer', fontFamily: 'inherit',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                    fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap',
                    transition: 'all 0.15s',
                  }}>
                    <span style={{ fontSize: 16 }}>{acc.emoji || '💳'}</span>
                    {acc.name}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Categoría (OBLIGATORIO) — se escribe; si ya existe, sugiere */}
        <div style={{ padding: '16px 16px 0' }}>
          <SectionLabel theme={theme}>
            {isIncome ? '¿A qué categoría entró?' : '¿A qué categoría va el gasto?'}
          </SectionLabel>

          <input
            value={catText}
            onChange={e => setCatText(e.target.value)}
            placeholder={isIncome ? 'Escribe la categoría (ej: Préstamo Carlos)' : 'Escribe la categoría (ej: Arriendo)'}
            style={{
              width: '100%', padding: '12px 14px', borderRadius: 12,
              border: `1.5px solid ${catText.trim() ? theme.main : T.neutral[200]}`,
              background: catText.trim() ? theme.light : '#fff',
              color: catText.trim() ? theme.text : T.neutral[700],
              fontSize: 14, fontWeight: 700, fontFamily: 'inherit',
              outline: 'none', boxSizing: 'border-box',
            }}
          />

          {/* Sugerencias de categorías existentes */}
          {suggestions.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {suggestions.map(c => (
                <button key={c} onClick={() => setCatText(c)} style={{
                  padding: '7px 12px', borderRadius: 999,
                  background: '#fff', color: T.neutral[700],
                  border: `1px solid ${T.neutral[200]}`,
                  cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700,
                }}>{c}</button>
              ))}
            </div>
          )}

          {/* Aviso de categoría nueva */}
          {catText.trim() && !existingCats.some(c => c.toLowerCase() === catText.trim().toLowerCase()) && (
            <div style={{ fontSize: 11.5, color: theme.text, opacity: 0.85, marginTop: 8, fontWeight: 600 }}>
              ✦ Se creará la categoría nueva «{catText.trim()}»
            </div>
          )}
        </div>

        <div style={{ height: 16 }} />
      </div>

      {/* Teclado */}
      <div style={{
        padding: '12px 12px 100px', background: '#fff',
        borderTop: `0.5px solid ${T.neutral[100]}`,
        borderRadius: '20px 20px 0 0',
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          {keys.flat().map(k => (
            <button key={k} onClick={() => handleKeypad(k)} style={{
              height: 52, borderRadius: 14, border: 'none',
              background: k === 'back' ? T.neutral[100] : T.neutral[50],
              cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 22, fontWeight: 500, color: T.neutral[800],
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {k === 'back'
                ? <svg width="22" height="16" viewBox="0 0 22 16" fill="none">
                    <path d="M7 1 H20 Q21 1 21 2 V14 Q21 15 20 15 H7 L1 8 Z M10 5 L16 11 M16 5 L10 11"
                      stroke={T.neutral[700]} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                  </svg>
                : k}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function SectionLabel({ children, theme }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, color: theme.text, opacity: 0.7,
      textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8,
    }}>
      {children}
    </div>
  )
}

function Warn({ children }) {
  return (
    <div style={{
      padding: '11px 14px', borderRadius: 10, background: '#FFF7E6',
      border: '1px solid #F4E0BC', fontSize: 12.5, color: '#8A6A1A', fontWeight: 600,
    }}>
      {children}
    </div>
  )
}

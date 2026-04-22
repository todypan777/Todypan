import { useState } from 'react'
import { T, BRANCH_PALETTE } from '../tokens'
import { fmtCOP, todayStr } from '../utils/format'
import { addMovement, getData } from '../db'

export default function AddMovement({ initialKind = 'income', onBack, onSave, incomeCats, expenseCats }) {
  const [kind, setKind] = useState(initialKind)
  const [amount, setAmount] = useState('')
  const [group, setGroup] = useState('proveedores')
  const [branch, setBranch] = useState(1)
  const [note, setNote] = useState('')
  const date = todayStr()

  const canSave = amount && Number(amount) > 0

  const autoCat = kind === 'income'
    ? 'ventas_mostrador'
    : group === 'proveedores' ? 'otros_prov'
    : group === 'operacion' ? 'aseo'
    : 'mejora'

  // Color del tema según la panadería seleccionada
  const branches = getData().branches || []
  const selectedBranch = branches.find(b => b.id === branch)
  const pal = selectedBranch
    ? (BRANCH_PALETTE[selectedBranch.colorKey] || BRANCH_PALETTE.copper)
    : null  // null = "Ambas" → sin color especial

  // Colores de la zona superior del formulario
  const topBg    = pal ? pal.light  : T.neutral[50]
  const topBorder = pal ? pal.border : T.neutral[200]
  const accentColor = pal ? pal.main : T.copper[500]

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
      cat: autoCat,
      group: kind === 'expense' ? group : undefined,
      branch,
      note: note.trim() || undefined,
    })
    onSave()
  }

  const keys = [['1','2','3'],['4','5','6'],['7','8','9'],['000','0','back']]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: T.neutral[50] }}>

      {/* ── Zona superior con color de panadería ── */}
      <div style={{
        background: topBg,
        borderBottom: `1px solid ${topBorder}`,
        transition: 'background 0.25s ease, border-color 0.25s ease',
      }}>
        {/* Top bar */}
        <div style={{ padding: '20px 20px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={onBack} style={{
            background: 'none', border: 'none', padding: '6px 0',
            cursor: 'pointer', fontSize: 15, color: T.neutral[500],
            fontFamily: 'inherit', fontWeight: 500,
          }}>
            Cancelar
          </button>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.neutral[700], letterSpacing: 0.1 }}>
            Nuevo movimiento
          </div>
          <button onClick={handleSave} style={{
            background: 'none', border: 'none', padding: '6px 0',
            cursor: canSave ? 'pointer' : 'default',
            fontSize: 15, color: canSave ? accentColor : T.neutral[300],
            fontFamily: 'inherit', fontWeight: 700,
            transition: 'color 0.25s',
          }}>
            Guardar
          </button>
        </div>

        {/* Selector de panadería */}
        <div style={{ padding: '16px 16px 0' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: pal ? pal.text : T.neutral[400], textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8, transition: 'color 0.25s' }}>
            Panadería
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {branches.map(b => {
              const bPal = BRANCH_PALETTE[b.colorKey] || BRANCH_PALETTE.copper
              const isActive = branch === b.id
              return (
                <button key={b.id} onClick={() => setBranch(b.id)} style={{
                  flex: 1, padding: '10px 8px', borderRadius: 12,
                  border: isActive ? `2px solid ${bPal.main}` : `1.5px solid ${bPal.border}`,
                  background: isActive ? bPal.main : bPal.light,
                  color: isActive ? '#fff' : bPal.text,
                  cursor: 'pointer', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', gap: 8,
                  transition: 'all 0.2s ease',
                  boxShadow: isActive ? `0 3px 10px ${bPal.main}44` : 'none',
                }}>
                  <div style={{
                    width: 10, height: 10, borderRadius: 999, flexShrink: 0,
                    background: isActive ? 'rgba(255,255,255,0.8)' : bPal.main,
                    transition: 'background 0.2s',
                  }}/>
                  <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {b.name}
                  </span>
                </button>
              )
            })}
            {/* Ambas */}
            <button onClick={() => setBranch('both')} style={{
              padding: '10px 12px', borderRadius: 12,
              border: branch === 'both' ? `2px solid ${T.neutral[600]}` : `1.5px solid ${T.neutral[200]}`,
              background: branch === 'both' ? T.neutral[700] : T.neutral[100],
              color: branch === 'both' ? '#fff' : T.neutral[500],
              cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 13, fontWeight: 700,
              transition: 'all 0.2s ease',
            }}>
              Ambas
            </button>
          </div>
        </div>

        {/* Income/Expense switch */}
        <div style={{ padding: '12px 16px 0' }}>
          <div style={{
            display: 'flex',
            background: pal ? `${pal.border}66` : T.neutral[100],
            borderRadius: 12, padding: 3,
            border: `0.5px solid ${topBorder}`,
            transition: 'background 0.25s',
          }}>
            {[
              { id: 'income', label: 'Ingreso', color: T.ok },
              { id: 'expense', label: 'Gasto', color: pal ? pal.main : T.copper[500] },
            ].map(o => (
              <button key={o.id} onClick={() => setKind(o.id)} style={{
                flex: 1, padding: '9px', borderRadius: 10, border: 'none',
                background: kind === o.id ? '#fff' : 'transparent',
                color: kind === o.id ? o.color : T.neutral[500],
                fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                boxShadow: kind === o.id ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                transition: 'all 0.15s',
              }}>{o.label}</button>
            ))}
          </div>
        </div>

        {/* Amount display */}
        <div style={{ padding: '20px 20px 20px', textAlign: 'center' }}>
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: 0.8,
            color: pal ? pal.text : T.neutral[400],
            textTransform: 'uppercase', marginBottom: 6,
            transition: 'color 0.25s',
          }}>
            Monto
          </div>
          <div style={{
            fontSize: 52, fontWeight: 700, letterSpacing: -1.5,
            color: amount
              ? (kind === 'income' ? T.ok : (pal ? pal.main : T.neutral[900]))
              : (pal ? `${pal.main}44` : T.neutral[300]),
            fontVariantNumeric: 'tabular-nums', lineHeight: 1,
            transition: 'color 0.25s',
          }}>
            {amount ? fmtCOP(Number(amount)) : '$ 0'}
          </div>
        </div>
      </div>

      {/* ── Zona inferior (controles + teclado) ── */}

      {/* Group (only for expenses) */}
      {kind === 'expense' && (
        <div style={{ padding: '12px 16px 0', display: 'flex', gap: 8 }}>
          {[
            { id: 'proveedores', label: 'Proveedores' },
            { id: 'operacion',   label: 'Operación' },
            { id: 'empresa',     label: 'Empresa' },
          ].map(g => (
            <button key={g.id} onClick={() => setGroup(g.id)} style={{
              padding: '7px 13px', borderRadius: 999, border: 'none',
              cursor: 'pointer', fontFamily: 'inherit',
              background: group === g.id ? T.neutral[800] : T.neutral[100],
              color: group === g.id ? '#fff' : T.neutral[600],
              fontSize: 12, fontWeight: 600,
            }}>{g.label}</button>
          ))}
        </div>
      )}

      {/* Note */}
      <div style={{ padding: '12px 16px 0' }}>
        <input
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Nota (ej: Caja del sábado, Harina Haz de Oros...)"
          style={{
            width: '100%', padding: '11px 14px', borderRadius: 10,
            border: `1px solid ${T.neutral[200]}`, background: '#fff',
            fontSize: 14, color: T.neutral[700], fontFamily: 'inherit',
            outline: 'none', boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Teclado */}
      <div style={{ flex: 1 }}/>
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

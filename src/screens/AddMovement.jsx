import { useState } from 'react'
import { T } from '../tokens'
import { fmtCOP, todayStr } from '../utils/format'
import { CatIcon } from '../components/Atoms'
import { addMovement } from '../db'

export default function AddMovement({ initialKind = 'income', onBack, onSave, incomeCats, expenseCats }) {
  const [kind, setKind] = useState(initialKind)
  const [amount, setAmount] = useState('')
  const [group, setGroup] = useState('proveedores')
  const [cat, setCat] = useState('')
  const [branch, setBranch] = useState(1)
  const [note, setNote] = useState('')
  const [date, setDate] = useState(todayStr())

  const cats = kind === 'income' ? incomeCats : (expenseCats[group] || [])
  const canSave = amount && cat && Number(amount) > 0

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
      cat,
      group: kind === 'expense' ? group : undefined,
      branch,
      note: note.trim() || undefined,
    })
    onSave()
  }

  const keys = [['1','2','3'],['4','5','6'],['7','8','9'],['000','0','back']]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: T.neutral[50] }}>
      {/* Top bar */}
      <div style={{ padding: '56px 20px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', padding: 8, cursor: 'pointer', fontSize: 15, color: T.neutral[600], fontFamily: 'inherit', fontWeight: 500 }}>
          Cancelar
        </button>
        <div style={{ fontSize: 15, fontWeight: 600, color: T.neutral[800] }}>Nuevo movimiento</div>
        <button onClick={handleSave} style={{
          background: 'none', border: 'none', padding: 8, cursor: canSave ? 'pointer' : 'default',
          fontSize: 15, color: canSave ? T.copper[500] : T.neutral[300],
          fontFamily: 'inherit', fontWeight: 600,
        }}>Guardar</button>
      </div>

      {/* Income/Expense switch */}
      <div style={{ padding: '16px 20px 0' }}>
        <div style={{ display: 'flex', background: T.neutral[100], borderRadius: 12, padding: 3, border: `0.5px solid ${T.neutral[200]}` }}>
          {[
            { id: 'income', label: 'Ingreso', color: T.ok },
            { id: 'expense', label: 'Gasto', color: T.copper[500] },
          ].map(o => (
            <button key={o.id} onClick={() => { setKind(o.id); setCat('') }} style={{
              flex: 1, padding: '9px', borderRadius: 10, border: 'none',
              background: kind === o.id ? '#fff' : 'transparent',
              color: kind === o.id ? o.color : T.neutral[500],
              fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              boxShadow: kind === o.id ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
              transition: 'all 0.15s',
            }}>{o.label}</button>
          ))}
        </div>
      </div>

      {/* Amount display */}
      <div style={{ padding: '20px 20px 12px', textAlign: 'center' }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.8, color: T.neutral[400], textTransform: 'uppercase', marginBottom: 4 }}>Monto</div>
        <div style={{
          fontSize: 48, fontWeight: 700, letterSpacing: -1.5,
          color: amount ? (kind === 'income' ? T.ok : T.neutral[900]) : T.neutral[300],
          fontVariantNumeric: 'tabular-nums', lineHeight: 1,
        }}>
          {amount ? fmtCOP(Number(amount)) : '$ 0'}
        </div>
      </div>

      {/* Date picker */}
      <div style={{ padding: '0 20px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: 12, color: T.neutral[500], fontWeight: 600 }}>Fecha:</div>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{
          border: `1px solid ${T.neutral[200]}`, borderRadius: 8, padding: '4px 10px',
          fontSize: 13, color: T.neutral[700], fontFamily: 'inherit', background: '#fff', outline: 'none',
        }}/>
      </div>

      {/* Branch + group */}
      <div style={{ padding: '0 16px 8px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {[
          { v: 1, l: 'Iglesia' },
          { v: 2, l: 'Esquina' },
          { v: 'both', l: 'Ambas' },
        ].map(b => (
          <BranchBtn key={b.v} label={b.l} active={branch === b.v} onClick={() => setBranch(b.v)} branch={b.v}/>
        ))}
      </div>

      {kind === 'expense' && (
        <div style={{ padding: '0 16px 8px', display: 'flex', gap: 8 }}>
          {[
            { id: 'proveedores', label: 'Proveedores' },
            { id: 'operacion', label: 'Operación' },
            { id: 'empresa', label: 'Empresa' },
          ].map(g => (
            <button key={g.id} onClick={() => { setGroup(g.id); setCat('') }} style={{
              padding: '7px 13px', borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              background: group === g.id ? T.neutral[800] : T.neutral[100],
              color: group === g.id ? '#fff' : T.neutral[600],
              fontSize: 12, fontWeight: 600,
            }}>{g.label}</button>
          ))}
        </div>
      )}

      {/* Categories */}
      <div style={{ padding: '0 16px 6px', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <div style={{ display: 'flex', gap: 8, paddingBottom: 4 }}>
          {cats.map(c => (
            <button key={c.id} onClick={() => setCat(c.id)} style={{
              padding: '9px 14px', borderRadius: 12, border: 'none',
              background: cat === c.id ? T.copper[500] : '#fff',
              color: cat === c.id ? '#fff' : T.neutral[700],
              fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6,
              boxShadow: cat === c.id ? `0 2px 8px rgba(200,143,106,0.3)` : `0 0 0 1px rgba(45,35,25,0.06)`,
              flexShrink: 0,
            }}>
              <CatIcon cat={c.id} size={15} color={cat === c.id ? '#fff' : T.neutral[600]}/>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Note */}
      <div style={{ padding: '0 16px 6px' }}>
        <input
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Nota (opcional)"
          style={{
            width: '100%', padding: '10px 14px', borderRadius: 10,
            border: `1px solid ${T.neutral[200]}`, background: '#fff',
            fontSize: 13, color: T.neutral[700], fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Keypad */}
      <div style={{ flex: 1 }} />
      <div style={{ padding: '12px 12px 100px', background: '#fff', borderTop: `0.5px solid ${T.neutral[100]}`, borderRadius: '20px 20px 0 0' }}>
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
                ? <svg width="22" height="16" viewBox="0 0 22 16" fill="none"><path d="M7 1 H20 Q21 1 21 2 V14 Q21 15 20 15 H7 L1 8 Z M10 5 L16 11 M16 5 L10 11" stroke={T.neutral[700]} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>
                : k}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function BranchBtn({ label, active, onClick, branch }) {
  const colors = {
    1: { active: T.copper[500], bg: T.copper[50], text: T.copper[700] },
    2: { active: '#6B7F5C', bg: '#E8EADF', text: '#4A5840' },
    both: { active: T.neutral[600], bg: T.neutral[100], text: T.neutral[700] },
  }
  const c = colors[branch] || colors.both
  return (
    <button onClick={onClick} style={{
      padding: '7px 13px', borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
      background: active ? c.active : c.bg,
      color: active ? '#fff' : c.text,
      fontSize: 12, fontWeight: 600,
    }}>{label}</button>
  )
}

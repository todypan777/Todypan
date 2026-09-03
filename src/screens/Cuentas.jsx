import { useEffect, useMemo, useState } from 'react'
import { T, BRANCH_PALETTE } from '../tokens'
import { visibleAccounts, visibleBranches } from '../utils/branchScope'
import { fmtCOP } from '../utils/format'
import { Card } from '../components/Atoms'
import { ScreenHeader } from '../components/Nav'
import { useIsDesktop } from '../context/DesktopCtx'
import {
  getAccounts, addAccount, updateAccount, deleteAccount,
  setAccountBalance, addAccountMovement, deleteAccountMovement,
  getAccountBalance, getAccountAssignedMovements, getData,
  getBaseRepositionMovements, deleteBaseRepositionMovements,
  watchSharedData,
} from '../db'

// Emojis sugeridos para cuentas nuevas
const EMOJI_OPTIONS = ['📱', '💵', '🏦', '💳', '💰', '🪙', '📲', '🧾', '💼', '🐷']
const COLOR_KEYS = Object.keys(BRANCH_PALETTE)

export default function Cuentas({ userDoc }) {
  const isDesktop = useIsDesktop()
  // El doc compartido se refresca con watchSharedData; usamos un tick para
  // repintar cuando llega un cambio (de este u otro dispositivo).
  const [, setTick] = useState(0)
  useEffect(() => watchSharedData(() => setTick(t => t + 1)), [])

  // Solo las cuentas de las panaderías de este usuario. El Nequi de un dueño no
  // es el del otro: son personas y números distintos.
  const accounts = visibleAccounts(userDoc, getAccounts())
  const misSedes = visibleBranches(userDoc, getData().branches || [])
  const [detail, setDetail] = useState(null)      // cuenta abierta en modal
  const [creating, setCreating] = useState(false)  // modal de cuenta nueva
  const [visible, setVisible] = useState(15)      // cuántos movimientos del feed se muestran

  const total = useMemo(
    () => accounts.reduce((s, a) => s + getAccountBalance(a), 0),
    [accounts],
  )

  // La cuenta abierta siempre en vivo (tras editar saldo/movimientos).
  const detailLive = detail ? accounts.find(a => a.id === detail.id) || null : null

  // ── Feed de movimientos: todos los que tocaron una cuenta, en orden, con
  //    la cuenta que movieron y la categoría a la que se dirigen.
  const { movements = [], incomeCats = [], expenseCats = {} } = getData()
  const accountsById = useMemo(
    () => Object.fromEntries(accounts.map(a => [a.id, a])),
    [accounts],
  )
  const catLabel = useMemo(() => {
    const map = {}
    ;(incomeCats || []).forEach(c => { map[c.id] = c.label })
    Object.values(expenseCats || {}).flat().forEach(c => { map[c.id] = c.label })
    return map
  }, [incomeCats, expenseCats])
  const feed = useMemo(() => (
    (movements || [])
      .filter(m => m.accountId && accountsById[m.accountId])
      .map(m => ({
        ...m,
        _ts: /^m\d+$/.test(m.id || '') ? Number(m.id.slice(1)) : (m.date ? new Date(m.date + 'T00:00:00').getTime() : 0),
      }))
      .sort((a, b) => (b._ts || 0) - (a._ts || 0))
  ), [movements, accountsById])

  function refresh() { setTick(t => t + 1) }

  return (
    <div style={{ paddingBottom: isDesktop ? 24 : 110 }}>
      <ScreenHeader
        title="Cuentas"
        subtitle={`${accounts.length} ${accounts.length === 1 ? 'cuenta' : 'cuentas'} · saldos del administrador`}
      />

      {/* Tarjeta de saldo total */}
      <div style={{ padding: '0 16px 12px' }}>
        <Card style={{
          background: `linear-gradient(145deg, ${T.neutral[800]} 0%, ${T.neutral[900]} 100%)`,
          color: '#fff',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: T.copper[300], textTransform: 'uppercase' }}>
            Saldo total
          </div>
          <div style={{ fontSize: 34, fontWeight: 800, marginTop: 4, letterSpacing: -0.8, fontVariantNumeric: 'tabular-nums' }}>
            {fmtCOP(total)}
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', marginTop: 4 }}>
            Sumando todas las cuentas
          </div>
        </Card>
      </div>

      {/* Lista de cuentas */}
      <div style={{
        padding: '0 16px',
        display: 'grid',
        gridTemplateColumns: isDesktop ? '1fr 1fr' : '1fr',
        gap: 12,
      }}>
        {accounts.map(acc => (
          <AccountCard key={acc.id} account={acc} onOpen={() => setDetail(acc)} />
        ))}

        {/* El modal de cuenta nueva existía pero nunca se había conectado: no
            había forma de crear una cuenta desde la app. Hace falta ahora, que
            cada panadería lleva las suyas. */}
        <button
          onClick={() => setCreating(true)}
          style={{
            padding: '16px', borderRadius: 16, cursor: 'pointer',
            border: `1.5px dashed ${T.neutral[300]}`, background: 'transparent',
            color: T.neutral[500], fontFamily: 'inherit',
            fontSize: 14, fontWeight: 600, minHeight: 64,
          }}
        >
          ＋ Nueva cuenta
        </button>
      </div>

      {creating && (
        <NewAccountModal
          branches={misSedes}
          onCancel={() => setCreating(false)}
          onCreated={() => { setCreating(false); setTick(t => t + 1) }}
        />
      )}

      {/* Feed de movimientos */}
      <div style={{ padding: '22px 16px 0' }}>
        <div style={{
          fontSize: 11.5, fontWeight: 700, color: T.neutral[500],
          letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 10, paddingLeft: 2,
        }}>
          Movimientos
        </div>
        {feed.length === 0 ? (
          <Card>
            <div style={{ padding: '32px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 34, marginBottom: 6 }}>🧾</div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: T.neutral[700] }}>
                Aún no hay movimientos
              </div>
              <div style={{ fontSize: 12, color: T.neutral[500], marginTop: 4 }}>
                Registra uno con el botón <b>＋</b> y aparecerá aquí con su cuenta y categoría.
              </div>
            </div>
          </Card>
        ) : (
          <>
            <Card padding={0} style={{ overflow: 'hidden' }}>
              {feed.slice(0, visible).map((m, i, arr) => (
                <FeedRow
                  key={m.id}
                  mov={m}
                  account={accountsById[m.accountId]}
                  categoryLabel={catLabel[m.cat] || m.cat || 'Sin categoría'}
                  isLast={i === arr.length - 1}
                />
              ))}
            </Card>
            {feed.length > visible && (
              <button
                onClick={() => setVisible(v => v + 15)}
                style={{
                  width: '100%', marginTop: 10, padding: '12px', borderRadius: 12,
                  background: '#fff', color: T.copper[700],
                  border: `1px solid ${T.neutral[200]}`,
                  cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700,
                }}
              >
                Ver más · {feed.length - visible} restantes
              </button>
            )}
          </>
        )}
      </div>

      {detailLive && (
        <AccountDetailModal
          account={detailLive}
          onClose={() => setDetail(null)}
          onChanged={refresh}
          onDeleted={() => { setDetail(null); refresh() }}
        />
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Fila del feed de movimientos (cuenta + categoría)
// ──────────────────────────────────────────────────────────────
function FeedRow({ mov, account, categoryLabel, isLast }) {
  const pal = BRANCH_PALETTE[account?.colorKey] || BRANCH_PALETTE.copper
  const isIncome = mov.type === 'income'
  // Fecha + hora: el timestamp real está en _ts (del id 'm'+Date.now()).
  // Si no hay timestamp válido (data vieja), caemos al día solo.
  const date = (mov._ts && mov._ts > 1e12)
    ? new Date(mov._ts).toLocaleString('es-CO', {
        day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
        hour12: true, timeZone: 'America/Bogota',
      })
    : mov.date
      ? new Date(mov.date + 'T00:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
      : '—'
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
      borderBottom: isLast ? 'none' : `0.5px solid ${T.neutral[100]}`,
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: 11, flexShrink: 0,
        background: pal.light, border: `1px solid ${pal.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19,
      }}>
        {account?.emoji || '💳'}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14, fontWeight: 700, color: T.neutral[900],
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {categoryLabel}
        </div>
        <div style={{ fontSize: 11.5, color: T.neutral[500], marginTop: 2, display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontWeight: 600, color: pal.text }}>{account?.name || 'Cuenta'}</span>
          <span style={{ color: T.neutral[300] }}>·</span>
          <span>{date}</span>
        </div>
      </div>
      <div style={{
        fontSize: 15, fontWeight: 800, flexShrink: 0,
        color: isIncome ? T.ok : T.bad, fontVariantNumeric: 'tabular-nums', letterSpacing: -0.3,
      }}>
        {isIncome ? '+' : '−'}{fmtCOP(mov.amount || 0)}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Tarjeta de cuenta
// ──────────────────────────────────────────────────────────────
function AccountCard({ account, onOpen }) {
  const pal = BRANCH_PALETTE[account.colorKey] || BRANCH_PALETTE.copper
  const balance = getAccountBalance(account)
  const movs = (account.adjustments?.length || 0) + getAccountAssignedMovements(account.id).length
  return (
    <Card onClick={onOpen} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{
        width: 48, height: 48, borderRadius: 14, flexShrink: 0,
        background: pal.light, border: `1px solid ${pal.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24,
      }}>
        {account.emoji || '💳'}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 15, fontWeight: 700, color: T.neutral[900],
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {account.name}
        </div>
        <div style={{ fontSize: 11.5, color: T.neutral[500], marginTop: 2 }}>
          {movs} {movs === 1 ? 'movimiento' : 'movimientos'}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{
          fontSize: 18, fontWeight: 800,
          color: balance < 0 ? T.bad : pal.text,
          fontVariantNumeric: 'tabular-nums', letterSpacing: -0.4,
        }}>
          {fmtCOP(balance)}
        </div>
      </div>
    </Card>
  )
}

// ──────────────────────────────────────────────────────────────
// Modal de detalle / gestión de una cuenta
// ──────────────────────────────────────────────────────────────
function AccountDetailModal({ account, onClose, onChanged, onDeleted }) {
  const pal = BRANCH_PALETTE[account.colorKey] || BRANCH_PALETTE.copper
  const balance = getAccountBalance(account)
  // mode: 'view' | 'set' | 'in' | 'out' | 'edit' | 'confirmDelete'
  const [mode, setMode] = useState('view')
  const [amountStr, setAmountStr] = useState('')
  const [note, setNote] = useState('')
  // edición de identidad
  const [name, setName] = useState(account.name)
  const [emoji, setEmoji] = useState(account.emoji || '💳')
  const [colorKey, setColorKey] = useState(account.colorKey || 'copper')

  const amount = Number(amountStr.replace(/[^0-9]/g, '')) || 0

  function resetForm() { setAmountStr(''); setNote(''); setMode('view') }

  function handleSet() {
    setAccountBalance(account.id, amount, note.trim())
    onChanged(); resetForm()
  }
  function handleMovement(type) {
    if (amount <= 0) return
    addAccountMovement(account.id, { type, amount, note: note.trim() })
    onChanged(); resetForm()
  }
  function handleSaveIdentity() {
    if (name.trim().length < 1) return
    updateAccount(account.id, { name: name.trim(), emoji, colorKey })
    onChanged(); setMode('view')
  }
  function handleDelete() {
    deleteAccount(account.id)
    onDeleted()
  }
  function handleDeleteMov(movId) {
    deleteAccountMovement(account.id, movId)
    onChanged()
  }

  // Historial combinado: ajustes manuales (editables aquí) + movimientos del
  // botón "Nuevo movimiento" asignados a esta cuenta (de solo lectura: se
  // editan/borran en la pestaña Movimientos).
  const branches = getData().branches || []
  const branchName = (b) => b === 'both' ? 'Ambas' : (branches.find(x => x.id === b)?.name || '')
  const manualEntries = (account.adjustments || []).map(m => ({ ...m, source: 'manual' }))
  const globalEntries = getAccountAssignedMovements(account.id).map(m => ({
    source: 'global',
    id: m.id,
    type: m.type === 'income' ? 'in' : 'out',
    amount: Number(m.amount) || 0,
    note: m.note || '',
    date: m.date,
    branch: m.branch,
    branchLabel: branchName(m.branch),
    createdAt: /^m\d+$/.test(m.id || '') ? Number(m.id.slice(1)) : (m.date ? new Date(m.date + 'T00:00:00').getTime() : 0),
  }))
  const history = [...manualEntries, ...globalEntries].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 90,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 480, background: '#fff', borderRadius: 22,
        boxShadow: '0 16px 48px rgba(0,0,0,0.2)', maxHeight: '92vh', overflowY: 'auto',
      }}>
        {/* Header con saldo */}
        <div style={{
          padding: '22px 22px 18px',
          background: `linear-gradient(135deg, ${pal.main} 0%, ${pal.text} 100%)`,
          color: '#fff',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 26 }}>{account.emoji || '💳'}</span>
            <span style={{ fontSize: 16, fontWeight: 800 }}>{account.name}</span>
          </div>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: 'rgba(255,255,255,0.8)', letterSpacing: 0.5, textTransform: 'uppercase' }}>
            Saldo actual
          </div>
          <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: -0.8, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
            {fmtCOP(balance)}
          </div>
        </div>

        {/* Acciones */}
        {mode === 'view' && (
          <div style={{ padding: '16px 22px 0' }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <ActionBtn label="＋ Ingreso" tone="ok" onClick={() => { setAmountStr(''); setNote(''); setMode('in') }} />
              <ActionBtn label="－ Egreso" tone="bad" onClick={() => { setAmountStr(''); setNote(''); setMode('out') }} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <ActionBtn label="✎ Fijar saldo" tone="copper" onClick={() => { setAmountStr(String(Math.round(balance))); setNote(''); setMode('set') }} />
              <ActionBtn label="⚙ Editar" tone="neutral" onClick={() => { setName(account.name); setEmoji(account.emoji || '💳'); setColorKey(account.colorKey || 'copper'); setMode('edit') }} />
            </div>
          </div>
        )}

        {/* Form de ingreso / egreso / fijar saldo */}
        {(mode === 'in' || mode === 'out' || mode === 'set') && (
          <div style={{ padding: '16px 22px 0' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.neutral[800], marginBottom: 10 }}>
              {mode === 'in' ? 'Registrar ingreso' : mode === 'out' ? 'Registrar egreso' : 'Fijar saldo exacto'}
            </div>
            <Label>{mode === 'set' ? 'Nuevo saldo' : 'Monto'}</Label>
            <div style={moneyWrap}>
              <span style={moneyPrefix}>$</span>
              <input
                type="text" inputMode="numeric" autoFocus
                value={amountStr === '0' ? '' : amountStr}
                onChange={e => setAmountStr(e.target.value.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, ''))}
                placeholder="0"
                style={moneyInput}
              />
            </div>

            {mode !== 'set' && (
              <div style={{
                marginTop: -4, marginBottom: 12, padding: '8px 12px', borderRadius: 10,
                background: T.neutral[50], fontSize: 12, color: T.neutral[600], fontWeight: 600,
                display: 'flex', justifyContent: 'space-between',
              }}>
                <span>Quedaría en</span>
                <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 800, color: T.neutral[800] }}>
                  {fmtCOP(balance + (mode === 'in' ? amount : -amount))}
                </span>
              </div>
            )}

            <Label>Nota (opcional)</Label>
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Ej: retiro cajero, consignación..."
              style={textInput}
            />

            <div style={{ display: 'flex', gap: 8, marginTop: 14, marginBottom: 4 }}>
              <button onClick={resetForm} style={btnSecondary}>Cancelar</button>
              <button
                onClick={() => mode === 'set' ? handleSet() : handleMovement(mode)}
                disabled={mode !== 'set' && amount <= 0}
                style={{
                  ...btnPrimary,
                  background: (mode === 'set' || amount > 0) ? T.copper[500] : T.neutral[200],
                  color: (mode === 'set' || amount > 0) ? '#fff' : T.neutral[400],
                  cursor: (mode === 'set' || amount > 0) ? 'pointer' : 'not-allowed',
                }}
              >
                Guardar
              </button>
            </div>
          </div>
        )}

        {/* Form de editar identidad */}
        {mode === 'edit' && (
          <div style={{ padding: '16px 22px 0' }}>
            <Label>Nombre</Label>
            <input value={name} onChange={e => setName(e.target.value)} style={textInput} />

            <div style={{ marginTop: 12 }}>
              <Label>Ícono</Label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {EMOJI_OPTIONS.map(em => (
                  <button key={em} onClick={() => setEmoji(em)} style={{
                    width: 38, height: 38, borderRadius: 10, fontSize: 20,
                    background: emoji === em ? T.copper[50] : '#fff',
                    border: `1.5px solid ${emoji === em ? T.copper[400] : T.neutral[200]}`,
                    cursor: 'pointer',
                  }}>{em}</button>
                ))}
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <Label>Color</Label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {COLOR_KEYS.map(ck => {
                  const p = BRANCH_PALETTE[ck]
                  return (
                    <button key={ck} onClick={() => setColorKey(ck)} style={{
                      width: 34, height: 34, borderRadius: 999, background: p.main,
                      border: colorKey === ck ? `3px solid ${T.neutral[800]}` : `2px solid #fff`,
                      boxShadow: '0 0 0 1px rgba(0,0,0,0.08)', cursor: 'pointer',
                    }} title={p.label} />
                  )
                })}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button onClick={() => setMode('view')} style={btnSecondary}>Cancelar</button>
              <button onClick={handleSaveIdentity} style={{ ...btnPrimary, background: T.copper[500], color: '#fff' }}>
                Guardar
              </button>
            </div>

            <button
              onClick={() => setMode('confirmDelete')}
              style={{
                width: '100%', marginTop: 10, padding: '11px', borderRadius: 12,
                background: 'transparent', color: T.bad, border: `1px solid #F0C8BE`,
                cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
              }}
            >
              🗑 Eliminar esta cuenta
            </button>
          </div>
        )}

        {mode === 'confirmDelete' && (
          <div style={{ padding: '16px 22px 0' }}>
            <div style={{
              padding: '12px 14px', borderRadius: 12,
              background: '#FBE9E5', border: '1px solid #F0C8BE',
              fontSize: 13, color: T.bad, fontWeight: 600, lineHeight: 1.5,
            }}>
              ¿Eliminar la cuenta <b>{account.name}</b> y todo su historial? Esta acción no se puede deshacer.
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={() => setMode('edit')} style={btnSecondary}>Cancelar</button>
              <button onClick={handleDelete} style={{ ...btnPrimary, background: T.bad, color: '#fff' }}>
                Sí, eliminar
              </button>
            </div>
          </div>
        )}

        {/* Limpieza de "Reposición de base" de cierres viejos (solo aparece si
            esta cuenta tiene gastos automáticos de cierre por revertir). */}
        {mode === 'view' && <BaseRepositionCleanup account={account} onChanged={onChanged} />}

        {/* Historial */}
        <div style={{ padding: '18px 22px 22px' }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: T.neutral[500], letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8 }}>
            Historial ({history.length})
          </div>
          {history.length === 0 ? (
            <div style={{ padding: '18px 0', textAlign: 'center', color: T.neutral[500], fontSize: 12.5 }}>
              Sin movimientos todavía.
            </div>
          ) : (
            <div style={{ background: T.neutral[50], borderRadius: 12, padding: '4px 0', maxHeight: 280, overflowY: 'auto' }}>
              {history.map((m, i) => (
                <MovementRow key={m.id || i} mov={m} isLast={i === history.length - 1} onDelete={() => handleDeleteMov(m.id)} />
              ))}
            </div>
          )}
        </div>

        <div style={{ padding: '0 22px 22px' }}>
          <button onClick={onClose} style={{
            width: '100%', padding: '12px', borderRadius: 12,
            background: T.neutral[100], color: T.neutral[700],
            border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 14, fontWeight: 700,
          }}>Cerrar</button>
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Panel de limpieza: revierte de una sola vez los gastos automáticos de
// "Reposición de base" que dejaron los cierres viejos (cuando el sistema
// asumía que el admin reponía y le bajaba el saldo a Efectivo sin que se
// moviera plata real). Solo aparece si hay reposiciones por revertir; se
// esconde solo cuando ya no queda ninguna.
// ──────────────────────────────────────────────────────────────
function BaseRepositionCleanup({ account, onChanged }) {
  const [confirming, setConfirming] = useState(false)
  const [done, setDone] = useState(null) // { count, total } tras revertir

  const movs = getBaseRepositionMovements(account.id)
  const branches = getData().branches || []
  const branchName = (b) => b === 'both' ? 'Ambas' : (branches.find(x => x.id === b)?.name || '')

  // Ya no queda nada por revertir: si acabamos de hacerlo, mostramos el OK.
  if (movs.length === 0) {
    if (!done) return null
    return (
      <div style={{ padding: '16px 22px 0' }}>
        <div style={{
          padding: '12px 14px', borderRadius: 12,
          background: '#E8F4E8', border: '1px solid #C2DDC1',
          fontSize: 12.5, color: T.ok, fontWeight: 600, lineHeight: 1.5,
        }}>
          ✓ Listo. Se revirtieron {done.count} {done.count === 1 ? 'reposición' : 'reposiciones'} y volvieron <b style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtCOP(done.total)}</b> al saldo de {account.name}.
        </div>
      </div>
    )
  }

  const total = movs.reduce((s, m) => s + (Number(m.amount) || 0), 0)
  const fmtRowDate = (d) => d
    ? new Date(d + 'T00:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—'

  function handleDeleteAll() {
    const res = deleteBaseRepositionMovements(account.id)
    setDone(res)
    setConfirming(false)
    onChanged()
  }

  return (
    <div style={{ padding: '16px 22px 0' }}>
      <div style={{
        borderRadius: 14, overflow: 'hidden',
        border: `1.5px solid ${T.copper[200]}`, background: T.copper[50],
      }}>
        <div style={{ padding: '14px 16px 10px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.copper[700], textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
            🧹 Arreglar cierres viejos
          </div>
          <div style={{ fontSize: 13, color: T.neutral[700], lineHeight: 1.5 }}>
            Hay <b>{movs.length}</b> {movs.length === 1 ? 'gasto' : 'gastos'} de <b>"Reposición de base"</b> que bajaron este saldo sin que se moviera plata real. Al revertirlos, <b style={{ color: T.copper[700], fontVariantNumeric: 'tabular-nums' }}>{fmtCOP(total)}</b> vuelven a {account.name}.
          </div>
        </div>

        {/* Lista compacta de lo que se va a revertir */}
        <div style={{ maxHeight: 168, overflowY: 'auto', background: '#fff', borderTop: `1px solid ${T.copper[100]}`, borderBottom: `1px solid ${T.copper[100]}` }}>
          {movs.map((m, i) => (
            <div key={m.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
              padding: '8px 16px',
              borderBottom: i === movs.length - 1 ? 'none' : `0.5px solid ${T.neutral[100]}`,
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: T.neutral[800] }}>
                  {fmtRowDate(m.date)}
                </div>
                <div style={{ fontSize: 11, color: T.neutral[500], whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {branchName(m.branch)}{m.cashierName ? ` · ${m.cashierName}` : ''}
                </div>
              </div>
              <div style={{ fontSize: 13, fontWeight: 800, color: T.bad, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                −{fmtCOP(Number(m.amount) || 0)}
              </div>
            </div>
          ))}
        </div>

        <div style={{ padding: '12px 16px' }}>
          {!confirming ? (
            <button
              onClick={() => setConfirming(true)}
              style={{
                width: '100%', padding: '12px', borderRadius: 12, border: 'none',
                background: T.copper[500], color: '#fff', cursor: 'pointer',
                fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700,
              }}
            >
              Revertir todas y restaurar {fmtCOP(total)}
            </button>
          ) : (
            <div>
              <div style={{ fontSize: 12.5, color: T.neutral[700], fontWeight: 600, textAlign: 'center', marginBottom: 8 }}>
                ¿Revertir las {movs.length} reposiciones? Esta acción no se puede deshacer.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setConfirming(false)} style={{
                  flex: 1, padding: '11px', borderRadius: 12, background: '#fff',
                  color: T.neutral[700], border: `1px solid ${T.neutral[200]}`,
                  cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700,
                }}>Cancelar</button>
                <button onClick={handleDeleteAll} style={{
                  flex: 1.4, padding: '11px', borderRadius: 12, border: 'none',
                  background: T.bad, color: '#fff', cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700,
                }}>Sí, revertir todas</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function MovementRow({ mov, isLast, onDelete }) {
  const isGlobal = mov.source === 'global'
  const tone = mov.type === 'in'
    ? { bg: '#E8F4E8', color: T.ok, icon: '↑', sign: '+' }
    : mov.type === 'out'
      ? { bg: '#FBE9E5', color: T.bad, icon: '↓', sign: '−' }
      : { bg: T.neutral[100], color: T.neutral[600], icon: '＝', sign: '' }
  const title = isGlobal
    ? (mov.type === 'in' ? 'Ingreso' : 'Gasto')
    : (mov.type === 'in' ? 'Ajuste +' : mov.type === 'out' ? 'Ajuste −' : 'Saldo fijado')
  const date = mov.date
    ? new Date(mov.date + 'T00:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—'
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px',
      borderBottom: isLast ? 'none' : `0.5px solid ${T.neutral[100]}`,
    }}>
      <div style={{
        width: 30, height: 30, borderRadius: 999, flexShrink: 0,
        background: tone.bg, color: tone.color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, fontWeight: 800, marginTop: 1,
      }}>{tone.icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: T.neutral[900] }}>{title}</span>
          {isGlobal && (
            <span style={{
              fontSize: 9.5, fontWeight: 700, color: T.copper[700], background: T.copper[50],
              padding: '1px 6px', borderRadius: 999, letterSpacing: 0.3, textTransform: 'uppercase',
            }}>Movimiento</span>
          )}
        </div>
        <div style={{ fontSize: 11, color: T.neutral[500], marginTop: 1 }}>
          {date}{isGlobal && mov.branchLabel ? ` · ${mov.branchLabel}` : ''}
        </div>
        {mov.note && (
          <div style={{ fontSize: 11.5, color: T.neutral[600], fontStyle: 'italic', marginTop: 2 }}>"{mov.note}"</div>
        )}
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: tone.color, fontVariantNumeric: 'tabular-nums' }}>
          {tone.sign}{fmtCOP(mov.amount || 0)}
        </div>
        {isGlobal ? (
          <div style={{ marginTop: 2, fontSize: 10, color: T.neutral[400], fontWeight: 500 }}>en Movimientos</div>
        ) : (
          <button onClick={onDelete} style={{
            marginTop: 2, background: 'transparent', border: 'none', cursor: 'pointer',
            color: T.neutral[400], fontSize: 11, fontWeight: 600, fontFamily: 'inherit', padding: 0,
          }}>borrar</button>
        )}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Modal de cuenta nueva
// ──────────────────────────────────────────────────────────────
function NewAccountModal({ branches = [], onCancel, onCreated }) {
  const [name, setName] = useState('')
  const [branchId, setBranchId] = useState(branches[0]?.id ?? null)
  const [emoji, setEmoji] = useState('💳')
  const [colorKey, setColorKey] = useState('copper')
  const [balanceStr, setBalanceStr] = useState('')

  // Sin panadería no se puede crear: una cuenta que no pertenece a ninguna sede
  // no se podría separar después.
  const valid = name.trim().length >= 1 && branchId != null
  function handleCreate() {
    if (!valid) return
    addAccount({
      name, emoji, colorKey, branchId,
      balance: Number(balanceStr.replace(/[^0-9]/g, '')) || 0,
    })
    onCreated()
  }

  return (
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, zIndex: 95,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 440, background: '#fff', borderRadius: 22,
        boxShadow: '0 16px 48px rgba(0,0,0,0.2)', maxHeight: '92vh', overflowY: 'auto',
        padding: '22px',
      }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3, marginBottom: 16 }}>
          Nueva cuenta
        </div>

        <Label>Nombre</Label>
        <input value={name} onChange={e => setName(e.target.value)} autoFocus placeholder="Ej: Bancolombia, Caja fuerte..." style={textInput} />

        <div style={{ marginTop: 12 }}>
          <Label>Ícono</Label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {EMOJI_OPTIONS.map(em => (
              <button key={em} onClick={() => setEmoji(em)} style={{
                width: 38, height: 38, borderRadius: 10, fontSize: 20,
                background: emoji === em ? T.copper[50] : '#fff',
                border: `1.5px solid ${emoji === em ? T.copper[400] : T.neutral[200]}`,
                cursor: 'pointer',
              }}>{em}</button>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <Label>Color</Label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {COLOR_KEYS.map(ck => {
              const p = BRANCH_PALETTE[ck]
              return (
                <button key={ck} onClick={() => setColorKey(ck)} style={{
                  width: 34, height: 34, borderRadius: 999, background: p.main,
                  border: colorKey === ck ? `3px solid ${T.neutral[800]}` : `2px solid #fff`,
                  boxShadow: '0 0 0 1px rgba(0,0,0,0.08)', cursor: 'pointer',
                }} title={p.label} />
              )
            })}
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <Label>Saldo inicial (opcional)</Label>
          <div style={moneyWrap}>
            <span style={moneyPrefix}>$</span>
            <input
              type="text" inputMode="numeric"
              value={balanceStr === '0' ? '' : balanceStr}
              onChange={e => setBalanceStr(e.target.value.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, ''))}
              placeholder="0"
              style={moneyInput}
            />
          </div>
        </div>

        {branches.length > 1 && (
          <div style={{ marginTop: 12 }}>
            <Label>¿De cuál panadería?</Label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {branches.map(b => (
                <button
                  key={b.id}
                  onClick={() => setBranchId(b.id)}
                  style={{
                    flex: '1 1 0', minWidth: 100, padding: '10px 12px', borderRadius: 12,
                    cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
                    border: branchId === b.id ? `2px solid ${T.copper[500]}` : `1.5px solid ${T.neutral[200]}`,
                    background: branchId === b.id ? T.copper[50] : '#fff',
                    color: branchId === b.id ? T.copper[700] : T.neutral[600],
                  }}
                >
                  {b.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={onCancel} style={btnSecondary}>Cancelar</button>
          <button
            onClick={handleCreate}
            disabled={!valid}
            style={{
              ...btnPrimary,
              background: valid ? T.copper[500] : T.neutral[200],
              color: valid ? '#fff' : T.neutral[400],
              cursor: valid ? 'pointer' : 'not-allowed',
            }}
          >
            Crear cuenta
          </button>
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Helpers de estilo
// ──────────────────────────────────────────────────────────────
function Label({ children }) {
  return (
    <label style={{
      display: 'block', fontSize: 11, fontWeight: 700, color: T.neutral[600],
      letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 5,
    }}>{children}</label>
  )
}

function ActionBtn({ label, tone, onClick }) {
  const map = {
    ok:      { bg: '#E8F4E8', color: T.ok, border: '#C5E0C5' },
    bad:     { bg: '#FBE9E5', color: T.bad, border: '#F0C8BE' },
    copper:  { bg: T.copper[50], color: T.copper[700], border: T.copper[200] },
    neutral: { bg: T.neutral[100], color: T.neutral[700], border: T.neutral[200] },
  }
  const c = map[tone] || map.neutral
  return (
    <button onClick={onClick} style={{
      flex: 1, padding: '11px', borderRadius: 12,
      background: c.bg, color: c.color, border: `1px solid ${c.border}`,
      cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
    }}>{label}</button>
  )
}

const moneyWrap = {
  display: 'flex', alignItems: 'center',
  border: `1px solid ${T.neutral[200]}`, borderRadius: 12, background: '#fff', marginBottom: 12,
}
const moneyPrefix = { paddingLeft: 12, color: T.neutral[500], fontSize: 14, fontWeight: 600 }
const moneyInput = {
  width: '100%', padding: '11px 14px 11px 6px', border: 'none', outline: 'none',
  fontFamily: 'inherit', fontSize: 16, fontWeight: 700, color: T.neutral[900],
  background: 'transparent', fontVariantNumeric: 'tabular-nums',
}
const textInput = {
  width: '100%', padding: '11px 12px', borderRadius: 12,
  border: `1px solid ${T.neutral[200]}`, background: '#fff',
  fontFamily: 'inherit', fontSize: 14, fontWeight: 600, color: T.neutral[900],
  outline: 'none', boxSizing: 'border-box',
}
const btnSecondary = {
  flex: 1, padding: '12px', borderRadius: 12, background: '#fff', color: T.neutral[700],
  border: `1px solid ${T.neutral[200]}`, cursor: 'pointer', fontFamily: 'inherit',
  fontSize: 14, fontWeight: 700,
}
const btnPrimary = {
  flex: 1.4, padding: '12px', borderRadius: 12, border: 'none',
  fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
}

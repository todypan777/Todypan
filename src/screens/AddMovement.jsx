import { useEffect, useMemo, useRef, useState } from 'react'
import { T } from '../tokens'
import { fmtCOP, todayStr } from '../utils/format'
import { visibleBranches, accountsOfBranch } from '../utils/branchScope'
import { addMovement, getAccounts, getData, getBogotaDateStr, getTransfersStartDate, normalizeCatKey } from '../db'
import { useAuth } from '../context/AuthCtx'
import {
  autoMatchTransferByMovement,
  findMismarkedTransferCandidates,
  reclassifySaleToTransfer,
} from '../sales'
import { recomputeSessionIfClosed } from '../cashSessions'

// Categoría fija siempre disponible: dispara la conciliación de transferencias.
const TRANSFER_CAT = 'Venta por Transferencia'
const FIXED_CATS = [TRANSFER_CAT]

// Fecha (Bogotá) restando N días, en formato YYYY-MM-DD.
function bogotaMinusDays(n) {
  const d = new Date(getBogotaDateStr() + 'T12:00:00')
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

// Ventana de conciliación: desde el inicio del control (nunca antes), con tope
// de 7 días atrás para no leer de más. Permite registrar mañana lo de hoy.
function reconcileSinceDate() {
  const start = getTransfersStartDate() || getBogotaDateStr()
  const cap = bogotaMinusDays(7)
  return start > cap ? start : cap
}

// Cuenta → método de transferencia (nequi / daviplata) por id o por nombre.
function accountMethod(acc) {
  if (!acc) return null
  const id = acc.id || ''
  const name = String(acc.name || '').toLowerCase()
  if (id === 'acc_nequi' || name.includes('nequi')) return 'nequi'
  if (id === 'acc_daviplata' || name.includes('daviplata')) return 'daviplata'
  return null
}

export default function AddMovement({ initialKind = 'income', userDoc, onBack, onSave }) {
  const [kind, setKind] = useState(initialKind)
  const [amount, setAmount] = useState('')
  const [catText, setCatText] = useState('')   // categoría escrita (OBLIGATORIA)
  const date = todayStr()

  // Cuentas del admin: a cuál entra/sale la plata. Elegir cuenta es OBLIGATORIO.
  // Panaderías que este usuario puede ver. Si tiene una sola, se elige sola y
  // el selector ni se muestra: no tiene sentido preguntarle algo con una única
  // respuesta posible.
  const myBranches = visibleBranches(userDoc, getData().branches || [])
  const [branchId, setBranchId] = useState(myBranches[0]?.id ?? null)

  // Solo las cuentas de la panadería elegida. Antes salían todas juntas, así
  // que era posible cargarle un gasto de una sede al Nequi de la otra.
  const accounts = accountsOfBranch(getAccounts(), branchId)

  // En el formulario los botones van en orden Efectivo → Nequi → Daviplata
  // (las creadas por el usuario quedan después). NO cambia el orden de la
  // pestaña Cuentas, solo el de estos botones.
  const orderedAccounts = useMemo(() => {
    const pref = ['acc_efectivo', 'acc_nequi', 'acc_daviplata']
    const rank = (a) => {
      const byId = pref.indexOf(a.id)
      if (byId !== -1) return byId
      const n = String(a.name || '').toLowerCase()
      const byName = pref.findIndex(p => n === p.replace('acc_', ''))
      return byName !== -1 ? byName : 99
    }
    return [...accounts].sort((a, b) => rank(a) - rank(b))
  }, [accounts])
  const [accountId, setAccountId] = useState(orderedAccounts[0]?.id || null)

  // Al cambiar de panadería, la cuenta elegida puede ser de la otra sede y ya
  // no estar en la lista. Sin esto el movimiento se guardaría contra el Nequi
  // del otro dueño, que es justo lo que este filtro viene a evitar.
  useEffect(() => {
    if (accountId && orderedAccounts.some(a => a.id === accountId)) return
    setAccountId(orderedAccounts[0]?.id || null)
  }, [orderedAccounts, accountId])
  const selectedAccount = accounts.find(a => a.id === accountId) || null

  // Conciliación de transferencias: cuando se dispara, reemplazamos el form
  // por el panel de resultado (match / sin match).
  const [reconcile, setReconcile] = useState(null)

  // Para que al escribir la categoría el teclado del sistema NO tape las
  // sugerencias: al enfocar subimos el campo arriba; al salir, volvemos a bajar.
  const [catFocused, setCatFocused] = useState(false)
  const scrollAreaRef = useRef(null)
  const catSectionRef = useRef(null)
  function scrollCatUp() {
    setTimeout(() => {
      catSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 200) // espera a que el teclado del sistema abra
  }
  function scrollBackDown() {
    scrollAreaRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Categorías existentes = fijas + las que el usuario ya usó. Sin predeterminadas.
  // Se deduplican por clave normalizada (ignora tildes y espacios).
  const existingCats = useMemo(() => {
    const seen = new Map() // key normalizada → etiqueta
    FIXED_CATS.forEach(c => seen.set(normalizeCatKey(c), c))
    ;(getData().movements || []).forEach(m => {
      if (!m.accountId) return
      const label = String(m.cat || '').trim().replace(/\s+/g, ' ')
      if (!label) return
      const key = normalizeCatKey(label)
      if (!key || seen.has(key)) return
      seen.set(key, label)
    })
    const fixedKeys = new Set(FIXED_CATS.map(c => normalizeCatKey(c)))
    const rest = [...seen.entries()]
      .filter(([k]) => !fixedKeys.has(k))
      .map(([, l]) => l)
      .sort((a, b) => a.localeCompare(b, 'es'))
    return [...FIXED_CATS, ...rest]
  }, [])

  const isIncome = kind === 'income'

  function resolveCat(text) {
    const key = normalizeCatKey(text)
    return existingCats.find(c => normalizeCatKey(c) === key) || text.trim().replace(/\s+/g, ' ')
  }

  // Sugerencias: solo al escribir; las existentes que contienen lo tecleado
  // (ignorando tildes/espacios). Si nada coincide exacto, se avisa que se creará.
  const typedKey = normalizeCatKey(catText)
  const matching = typedKey
    ? existingCats.filter(c => normalizeCatKey(c).includes(typedKey)).slice(0, 6)
    : []
  const exactExists = typedKey ? existingCats.some(c => normalizeCatKey(c) === typedKey) : false

  const canSave = amount && Number(amount) > 0 && !!accountId && !!catText.trim() && branchId != null

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
    const finalCat = resolveCat(catText)
    const movementId = addMovement({
      date, type: kind, amount: Number(amount),
      cat: finalCat, branch: branchId, accountId: accountId || undefined,
    })
    // ¿Es una conciliación de transferencia? (ingreso + categoría fija + cuenta Nequi/Daviplata)
    const method = accountMethod(selectedAccount)
    if (kind === 'income' && finalCat.toLowerCase() === TRANSFER_CAT.toLowerCase() && method) {
      setReconcile({ method, amount: Number(amount), movementId })
      return
    }
    onSave()
  }

  const keys = [['1','2','3'],['4','5','6'],['7','8','9'],['000','0','back']]

  // Panel de conciliación reemplaza al formulario una vez registrada la transferencia.
  if (reconcile) {
    return (
      <TransferReconcilePanel
        method={reconcile.method}
        amount={reconcile.amount}
        movementId={reconcile.movementId}
        sinceDate={reconcileSinceDate()}
        onDone={onSave}
      />
    )
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: theme.soft, transition: 'background 0.25s ease',
    }}>

      {/* Animaciones de presentación (pulso del monto + entrada de sugerencias).
          Respetan prefers-reduced-motion. */}
      <style>{`
        @keyframes tpAmountPulse { 0% { transform: scale(1); } 38% { transform: scale(1.045); } 100% { transform: scale(1); } }
        .tp-amount-pulse { animation: tpAmountPulse 160ms ease-out; }
        @keyframes tpSuggestIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
        .tp-suggest-in { animation: tpSuggestIn 180ms ease-out; }
        @media (prefers-reduced-motion: reduce) {
          .tp-amount-pulse, .tp-suggest-in { animation: none !important; }
        }
      `}</style>

      {/* ── Zona superior con color del tipo (verde / rojo) ── */}
      <div style={{
        background: theme.light,
        borderBottom: `1px solid ${theme.border}`,
        transition: 'background 0.25s ease, border-color 0.25s ease',
      }}>
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

        {/* Switch Ingreso / Gasto */}
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
          }}>
            {isIncome ? 'Monto que entra' : 'Monto que sale'}
          </div>
          <div
            key={amount || 'empty'}
            className={amount ? 'tp-amount-pulse' : undefined}
            style={{
              fontSize: 52, fontWeight: 800, letterSpacing: -1.5,
              color: amount ? theme.main : `${theme.main}44`,
              fontVariantNumeric: 'tabular-nums', lineHeight: 1,
            }}>
            {amount ? fmtCOP(Number(amount)) : '$ 0'}
          </div>
        </div>
      </div>

      {/* ── Zona inferior (controles) ── */}
      <div ref={scrollAreaRef} style={{
        flex: 1, overflowY: 'auto',
        // Espacio extra solo al escribir la categoría: deja subir el campo para
        // que las primeras sugerencias queden por encima del teclado del sistema.
        paddingBottom: catFocused ? 340 : 0,
        transition: 'padding-bottom 0.2s ease',
      }}>

        {/* Panadería (obligatorio si hay más de una) */}
        {myBranches.length > 1 && (
          <div style={{ padding: '14px 16px 0' }}>
            <SectionLabel theme={theme}>¿De cuál panadería?</SectionLabel>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              {myBranches.map(b => {
                const isActive = branchId === b.id
                return (
                  <button key={b.id} onClick={() => setBranchId(b.id)} style={{
                    flex: '1 1 0', minWidth: 92, padding: '10px 12px', borderRadius: 12,
                    border: isActive ? `2px solid ${theme.main}` : `1.5px solid ${T.neutral[200]}`,
                    background: isActive ? theme.light : '#fff',
                    color: isActive ? theme.text : T.neutral[600],
                    cursor: 'pointer', fontFamily: 'inherit',
                    fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap',
                    transition: 'all 0.15s',
                  }}>
                    {b.name}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Cuenta (obligatorio) */}
        <div style={{ padding: '14px 16px 0' }}>
          <SectionLabel theme={theme}>
            {isIncome ? '¿A qué cuenta entró?' : '¿De qué cuenta salió?'}
          </SectionLabel>
          {accounts.length === 0 ? (
            <Warn>No hay cuentas creadas. Crea una en la pestaña Cuentas para registrar movimientos.</Warn>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              {orderedAccounts.map(acc => {
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

        {/* Categoría (OBLIGATORIO) */}
        <div ref={catSectionRef} style={{ padding: '16px 16px 0' }}>
          <SectionLabel theme={theme}>
            {isIncome ? '¿A qué categoría entró?' : '¿A qué categoría va el gasto?'}
          </SectionLabel>

          <input
            value={catText}
            onChange={e => setCatText(e.target.value)}
            onFocus={() => { setCatFocused(true); scrollCatUp() }}
            onBlur={() => { setCatFocused(false); scrollBackDown() }}
            placeholder={isIncome ? 'Escribe la categoría (ej: Venta por Transferencia)' : 'Escribe la categoría (ej: Arriendo)'}
            style={{
              width: '100%', padding: '12px 14px', borderRadius: 12,
              border: `1.5px solid ${catText.trim() ? theme.main : T.neutral[200]}`,
              background: catText.trim() ? theme.light : '#fff',
              color: catText.trim() ? theme.text : T.neutral[700],
              fontSize: 14, fontWeight: 700, fontFamily: 'inherit',
              outline: 'none', boxSizing: 'border-box',
            }}
          />

          {/* Sugerencias que aparecen al escribir (las que ya existen) */}
          {catText.trim() && matching.length > 0 && (
            <div className="tp-suggest-in" style={{
              marginTop: 8, borderRadius: 12, overflow: 'hidden',
              border: `1px solid ${T.neutral[200]}`, background: '#fff',
            }}>
              {matching.map((c, i) => (
                <button key={c} onClick={() => setCatText(c)} style={{
                  width: '100%', padding: '11px 14px', textAlign: 'left',
                  background: 'transparent', border: 'none',
                  borderBottom: i === matching.length - 1 ? 'none' : `0.5px solid ${T.neutral[100]}`,
                  cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 13.5, fontWeight: 700, color: T.neutral[800],
                  display: 'flex', alignItems: 'center', gap: 9,
                }}>
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                    <path d="M2 7.5 L5.5 11 L12 3.5" stroke={theme.main} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  {c}
                </button>
              ))}
            </div>
          )}

          {/* Aviso de categoría nueva (solo si lo escrito no coincide con ninguna) */}
          {catText.trim() && !exactExists && (
            <div style={{ fontSize: 11.5, color: theme.text, opacity: 0.85, marginTop: 8, fontWeight: 600 }}>
              ✦ No existe — se creará la categoría «{catText.trim()}»
            </div>
          )}
        </div>

        <div style={{ height: 16 }} />
      </div>

      {/* Teclado */}
      <div style={{
        padding: '12px 12px calc(env(safe-area-inset-bottom, 0px) + 16px)', background: '#fff',
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

// ──────────────────────────────────────────────────────────────
// Panel de conciliación de transferencia (tras registrar el ingreso)
// ──────────────────────────────────────────────────────────────
function TransferReconcilePanel({ method, amount, movementId, sinceDate, onDone }) {
  const { authUser, userDoc } = useAuth()
  const adminName = `${userDoc?.nombre || ''} ${userDoc?.apellido || ''}`.trim() || 'Admin'
  const methodLabel = method === 'daviplata' ? 'DAVIPLATA' : 'NEQUI'
  const methodIcon = method === 'daviplata' ? '📲' : '📱'

  const [phase, setPhase] = useState('matching') // matching | matched | nomatch
  const [matched, setMatched] = useState(null)   // { sale, discrepancy }
  const [error, setError] = useState(null)

  // Búsqueda por hora (caso sin match)
  const [timeStr, setTimeStr] = useState(currentHHMM())
  const [candidates, setCandidates] = useState(null) // null = aún no busca
  const [searching, setSearching] = useState(false)
  const [busyId, setBusyId] = useState(null)

  useEffect(() => {
    let alive = true
    autoMatchTransferByMovement({ method, amount, sinceDate, movementId, byUid: authUser?.uid, byName: adminName })
      .then(res => {
        if (!alive) return
        if (res.matched) { setMatched({ sale: res.matched, discrepancy: res.discrepancy }); setPhase('matched') }
        else setPhase('nomatch')
      })
      .catch(err => {
        console.error('[reconcile]', err)
        if (alive) { setError('No se pudo conciliar, pero el ingreso quedó registrado.'); setPhase('nomatch') }
      })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function doSearch() {
    setSearching(true); setError(null)
    try {
      const list = await findMismarkedTransferCandidates({ sinceDate, method, amount, targetMinutes: parseHHMM(timeStr) })
      setCandidates(list)
    } catch (err) {
      console.error('[reconcile] search', err)
      setError('No se pudo buscar. Revisa tu conexión.')
    } finally {
      setSearching(false)
    }
  }

  async function pick(sale) {
    if (busyId) return
    setBusyId(sale.id); setError(null)
    try {
      await reclassifySaleToTransfer(sale.id, { method, byUid: authUser?.uid, byName: adminName })
      await recomputeSessionIfClosed(sale.sessionId, authUser?.uid)
      onDone()
    } catch (err) {
      console.error('[reconcile] pick', err)
      setError('No se pudo corregir la venta.')
      setBusyId(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#fff' }}>
      <div style={{
        padding: '20px 20px 16px', background: '#E8F4E8',
        borderBottom: `1px solid #BFDCBE`,
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#356B34', textTransform: 'uppercase', letterSpacing: 0.6 }}>
          {methodIcon} {methodLabel} · conciliación
        </div>
        <div style={{ fontSize: 30, fontWeight: 800, color: '#356B34', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
          {fmtCOP(amount)}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 18px' }}>
        {error && (
          <div style={{
            marginBottom: 14, padding: '10px 12px', borderRadius: 10,
            background: '#FBE9E5', border: '1px solid #F0C8BE', color: T.bad,
            fontSize: 12.5, fontWeight: 600, textAlign: 'center',
          }}>{error}</div>
        )}

        {phase === 'matching' && (
          <div style={{ padding: '40px 0', textAlign: 'center', color: T.neutral[500] }}>
            <div style={{ fontSize: 34, marginBottom: 10 }}>🔎</div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Buscando la venta…</div>
          </div>
        )}

        {phase === 'matched' && matched && (
          <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
            <div style={{ fontSize: 42, marginBottom: 8 }}>
              {matched.discrepancy ? '⚠️' : '✅'}
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: matched.discrepancy ? T.warn : T.ok }}>
              {matched.discrepancy ? 'Conciliada con desfase' : 'Conciliada'}
            </div>
            <div style={{ fontSize: 13, color: T.neutral[600], marginTop: 6, lineHeight: 1.5 }}>
              Chuleé la venta de <b>{fmtCOP(Number(matched.sale.total) || 0)}</b>
              {' '}({saleTime(matched.sale)}{matched.sale.cashierName ? ` · ${matched.sale.cashierName}` : ''}).
            </div>
            {matched.discrepancy ? (
              <div style={{
                margin: '12px auto 0', maxWidth: 320,
                padding: '10px 12px', borderRadius: 10,
                background: '#FFF7E6', border: '1px solid #F4E0BC',
                fontSize: 12.5, color: '#8A6A1A', fontWeight: 600, lineHeight: 1.5,
              }}>
                La venta era {fmtCOP(Number(matched.sale.total) || 0)} y registraste {fmtCOP(amount)}
                {' '}(desfase de {fmtCOP(Math.abs(matched.discrepancy))}). Queda señalada en Transferencias por si quieres revisarla.
              </div>
            ) : null}
            <button onClick={onDone} style={{ ...primaryBtn(T.ok), marginTop: 18 }}>Listo</button>
          </div>
        )}

        {phase === 'nomatch' && (
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: T.neutral[900], marginBottom: 6 }}>
              No encontré una transferencia de {fmtCOP(amount)} por {methodLabel}
            </div>
            <div style={{ fontSize: 12.5, color: T.neutral[600], lineHeight: 1.5, marginBottom: 14 }}>
              A veces la cajera la marca mal (ej. como efectivo). Pon la <b>hora</b> de la transferencia
              y busco entre las ventas cercanas (±{fmtCOP(500)} y ±15 min).
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.neutral[500], textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 5 }}>
                  Hora de la transferencia
                </div>
                <input
                  type="time" value={timeStr} onChange={e => setTimeStr(e.target.value)}
                  style={{
                    width: '100%', padding: '11px 12px', borderRadius: 10,
                    border: `1px solid ${T.neutral[200]}`, background: '#fff',
                    fontFamily: 'inherit', fontSize: 14, color: T.neutral[900],
                    outline: 'none', boxSizing: 'border-box',
                  }}
                />
              </div>
              <button onClick={doSearch} disabled={searching} style={{
                ...primaryBtn(T.copper[500]), width: 'auto', padding: '11px 18px',
                opacity: searching ? 0.7 : 1,
              }}>
                {searching ? '…' : 'Buscar'}
              </button>
            </div>

            {candidates != null && (
              candidates.length === 0 ? (
                <div style={{ padding: '14px', textAlign: 'center', color: T.neutral[500], fontSize: 12.5 }}>
                  No hay ventas parecidas en ese rango. Prueba otra hora o revisa el valor.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 260, overflowY: 'auto' }}>
                  {candidates.map(sale => (
                    <div key={sale.id} style={{
                      border: `1px solid ${T.neutral[200]}`, borderRadius: 12,
                      padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10,
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 700, color: T.neutral[900] }}>
                          {fmtCOP(sale.total || 0)} · {methodTag(sale)}
                        </div>
                        <div style={{ fontSize: 11.5, color: T.neutral[500], marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {saleDateLabel(sale)}{saleTime(sale)}{sale.cashierName ? ` · ${sale.cashierName}` : ''}
                        </div>
                      </div>
                      <button onClick={() => pick(sale)} disabled={!!busyId} style={{
                        ...primaryBtn(T.copper[500]), width: 'auto', flexShrink: 0,
                        padding: '8px 16px', fontSize: 12.5,
                      }}>
                        {busyId === sale.id ? '…' : 'Es esta'}
                      </button>
                    </div>
                  ))}
                </div>
              )
            )}

            <button onClick={onDone} style={{
              width: '100%', marginTop: 14, padding: '12px', borderRadius: 12,
              background: T.neutral[100], color: T.neutral[700], border: 'none',
              cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700,
            }}>
              Dejar sin conciliar por ahora
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function primaryBtn(bg) {
  return {
    width: '100%', padding: '12px', borderRadius: 12, border: 'none',
    background: bg, color: '#fff', cursor: 'pointer', fontFamily: 'inherit',
    fontSize: 14, fontWeight: 800,
  }
}

function saleTime(sale) {
  const d = sale.createdAt?.toDate?.()
  if (!d) return '—'
  return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Bogota' })
}

// Muestra la fecha solo si la venta NO es de hoy (para desambiguar entre días).
function saleDateLabel(sale) {
  if (!sale.date || sale.date === getBogotaDateStr()) return ''
  const d = new Date(sale.date + 'T00:00:00')
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }) + ' · '
}

function methodTag(sale) {
  const map = { efectivo: 'Efectivo', nequi: 'NEQUI', daviplata: 'DAVIPLATA', mixto: 'Mixto', deuda: 'Deuda' }
  return map[sale.paymentMethod] || sale.paymentMethod
}

function currentHHMM() {
  return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Bogota' })
}
function parseHHMM(str) {
  if (!str || !/^\d{1,2}:\d{2}$/.test(str)) return null
  const [h, m] = str.split(':').map(Number)
  return h * 60 + m
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

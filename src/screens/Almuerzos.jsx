import { useEffect, useMemo, useState } from 'react'
import { T } from '../tokens'
import { fmtDate } from '../utils/format'
import { Card } from '../components/Atoms'
import { ScreenHeader } from '../components/Nav'
import { getBogotaDateStr } from '../db'
import { watchKitchenOrdersForDate } from '../kitchenOrders'
import { CORRIENTE_CATEGORIES, CATEGORY_BY_ID } from '../menu'

// ──────────────────────────────────────────────────────────────
// Pantalla "Almuerzos": estadísticas de venta del día para el admin.
//   - Nav de fecha (mismo patrón que Registro).
//   - Cuenta TODOS los kitchenOrders del día que no estén cancelados
//     (pending + ready + delivered). El usuario quiere ver "lo que entró
//     a cocina ese día" — incluye lo que aún se está cocinando.
//   - Total general + corriente vs especial.
//   - Por cada categoría: lista ordenada descendente con cuántas veces
//     se pidió cada opción (carne asada 22, pollo 18, ...).
//
// Total combinado por panadería (sin desglose). Si en el futuro quieres
// filtrar por sucursal, el watcher trae `branchId` y se filtra en cliente.
// ──────────────────────────────────────────────────────────────

export default function Almuerzos() {
  const todayStr = getBogotaDateStr()
  const [date, setDate] = useState(todayStr)
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    return watchKitchenOrdersForDate(date, list => {
      setOrders(list)
      setLoading(false)
    })
  }, [date])

  const stats = useMemo(() => computeStats(orders), [orders])

  function changeDate(delta) {
    const d = new Date(date + 'T12:00:00')
    d.setDate(d.getDate() + delta)
    const next = d.toISOString().slice(0, 10)
    if (next <= todayStr) setDate(next)
  }

  const isToday = date === todayStr
  const isFuture = date > todayStr
  const displayDate = fmtDate(date, { weekday: true })

  return (
    <div style={{ paddingBottom: 110 }}>
      <ScreenHeader title="Almuerzos" subtitle="Estadísticas de venta" />

      {/* Navegador de fecha — mismo look que Registro para sentir continuidad */}
      <div style={{ padding: '0 16px 16px' }}>
        <div style={{
          borderRadius: 18, overflow: 'hidden',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        }}>
          <div style={{
            background: T.neutral[900], padding: '16px 20px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <button onClick={() => changeDate(-1)} style={navBtn} aria-label="Día anterior">
              <svg width="8" height="14" viewBox="0 0 8 14">
                <path d="M6 1 L1 7 L6 13" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <div style={{ textAlign: 'center' }}>
              <div style={{
                fontSize: 11, fontWeight: 600, color: T.copper[300],
                letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 4,
              }}>
                {isToday ? 'Hoy' : 'Fecha seleccionada'}
              </div>
              <div style={{
                fontSize: 19, fontWeight: 700, color: '#fff',
                textTransform: 'capitalize',
              }}>
                {displayDate}
              </div>
            </div>
            <button
              onClick={() => changeDate(1)}
              disabled={isToday}
              style={{ ...navBtn, opacity: isToday ? 0.2 : 1, cursor: isToday ? 'default' : 'pointer' }}
              aria-label="Día siguiente"
            >
              <svg width="8" height="14" viewBox="0 0 8 14">
                <path d="M2 1 L7 7 L2 13" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>

          {/* Sub-bar con resumen rápido del día */}
          <div style={{
            padding: '10px 20px', background: T.neutral[50],
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderTop: `1px solid ${T.neutral[100]}`,
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: T.neutral[600] }}>
              {loading
                ? 'Cargando…'
                : stats.total === 0
                  ? 'Sin almuerzos'
                  : `${stats.total} ${stats.total === 1 ? 'almuerzo vendido' : 'almuerzos vendidos'}`}
            </div>
            {stats.cancelled > 0 && (
              <div style={{ fontSize: 11.5, fontWeight: 600, color: T.neutral[500] }}>
                {stats.cancelled} cancelado{stats.cancelled === 1 ? '' : 's'} (no cuentan)
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Estados especiales */}
      {isFuture ? (
        <EmptyState emoji="📅" title="Fecha futura" hint="Todavía no hay datos para ese día." />
      ) : loading ? (
        <EmptyState emoji="🥣" title="Cargando…" hint="Buscando almuerzos del día." />
      ) : stats.total === 0 ? (
        <EmptyState
          emoji="🍽️"
          title={isToday ? 'Aún no hay almuerzos hoy' : 'Sin ventas este día'}
          hint={isToday
            ? 'Cuando una cajera mande una comanda aparecerá aquí.'
            : 'No se registraron almuerzos en esa fecha.'}
        />
      ) : (
        <>
          {/* ── Total + breakdown corriente vs especial ── */}
          <div style={{ padding: '0 16px 12px' }}>
            <Card padding={20} style={{ background: T.neutral[900], color: '#fff' }}>
              <div style={{
                fontSize: 11, fontWeight: 700, color: T.copper[300],
                letterSpacing: 0.8, textTransform: 'uppercase',
              }}>
                Total del día
              </div>
              <div style={{
                marginTop: 6, fontSize: 42, fontWeight: 800,
                letterSpacing: -1.2, fontVariantNumeric: 'tabular-nums',
                lineHeight: 1,
              }}>
                {stats.total}
                <span style={{ fontSize: 18, fontWeight: 600, marginLeft: 10, color: 'rgba(255,255,255,0.7)' }}>
                  {stats.total === 1 ? 'almuerzo' : 'almuerzos'}
                </span>
              </div>
              <div style={{
                marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap',
              }}>
                <SplitChip label="Corrientes" value={stats.corriente} accent={T.copper[300]} />
                <SplitChip label="Especiales" value={stats.especial} accent="#FFD58A" emoji="⭐" />
                {stats.llevar > 0 && (
                  <SplitChip label="Para llevar" value={stats.llevar} accent="rgba(255,255,255,0.6)" emoji="📦" />
                )}
              </div>
            </Card>
          </div>

          {/* ── Desglose por categoría ──
              Una card por cada categoría con datos. Si una categoría no
              se pidió en todo el día (raro), no se muestra. */}
          <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Especial primero si hay (es el más destacado) */}
            {stats.byCategory.especial && (
              <CategoryCard
                catId="especial"
                breakdown={stats.byCategory.especial}
              />
            )}
            {/* Resto: en el orden de CORRIENTE_CATEGORIES para consistencia */}
            {CORRIENTE_CATEGORIES.map(cat => {
              const b = stats.byCategory[cat.id]
              if (!b) return null
              return <CategoryCard key={cat.id} catId={cat.id} breakdown={b} />
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Stats
// ──────────────────────────────────────────────────────────────

/**
 * Recorre los orders del día y devuelve:
 *   { total, corriente, especial, llevar, cancelled, byCategory }
 *
 * byCategory: { [catId]: { total, items: [{ name, count, isCancelledOpt }] } }
 *   - 'items' viene ordenado desc por count.
 *   - 'isCancelledOpt' es para opciones tipo "Sin sopa" (cajera quitó la cat).
 */
function computeStats(orders) {
  const out = {
    total: 0,
    corriente: 0,
    especial: 0,
    llevar: 0,
    cancelled: 0,
    byCategory: {},
  }

  for (const o of orders) {
    if (o.status === 'cancelled') {
      out.cancelled += 1
      continue
    }
    out.total += 1
    if (o.destination === 'llevar') out.llevar += 1
    if (o.kind === 'special') {
      out.especial += 1
      addSpecialToStats(o, out)
    } else {
      out.corriente += 1
      addMenuToStats(o, out)
    }
  }

  // Ordenar items dentro de cada categoría por count desc; "Sin X" al
  // final aunque sea numeroso (es info distinta, no compite con opciones).
  for (const catId of Object.keys(out.byCategory)) {
    const bucket = out.byCategory[catId]
    bucket.items = Object.entries(bucket.counts).map(([key, count]) => ({
      key,
      name: bucket.names[key] || key,
      count,
      isSinOpt: bucket.sinKeys.has(key),
      isMixto: bucket.mixtoKeys.has(key),
    }))
    bucket.items.sort((a, b) => {
      if (a.isSinOpt !== b.isSinOpt) return a.isSinOpt ? 1 : -1
      return b.count - a.count
    })
    // Limpiar accumuladores internos antes de devolver.
    delete bucket.counts
    delete bucket.names
    delete bucket.sinKeys
    delete bucket.mixtoKeys
  }

  return out
}

function ensureBucket(out, catId) {
  if (!out.byCategory[catId]) {
    out.byCategory[catId] = {
      total: 0,
      counts: {},
      names: {},
      sinKeys: new Set(),
      mixtoKeys: new Set(),
    }
  }
  return out.byCategory[catId]
}

function bumpOption(bucket, key, displayName, { isSinOpt = false, isMixto = false } = {}) {
  bucket.counts[key] = (bucket.counts[key] || 0) + 1
  bucket.names[key] = displayName
  if (isSinOpt) bucket.sinKeys.add(key)
  if (isMixto) bucket.mixtoKeys.add(key)
  bucket.total += 1
}

function addMenuToStats(order, out) {
  const sel = order.selections || {}
  for (const cat of CORRIENTE_CATEGORIES) {
    const value = sel[cat.id]
    const bucket = ensureBucket(out, cat.id)

    // Principio puede ser array (mixto), objeto único, o null.
    if (cat.id === 'principio') {
      const arr = Array.isArray(value) ? value.filter(Boolean) : (value ? [value] : [])
      if (arr.length === 0) {
        // Principio es opcional — si no eligió, no contamos nada (no es
        // "Sin principio" porque la categoría misma es opcional).
        continue
      }
      if (arr.length >= 2) {
        // Mixto: una entrada propia con nombre combinado, ordenando
        // alfabéticamente para que "X+Y" y "Y+X" cuenten igual.
        const names = arr.map(p => p.name).sort((a, b) => a.localeCompare(b))
        const key = `mixto:${names.join('|')}`
        bumpOption(bucket, key, `Mixto: ${names.join(' / ')}`, { isMixto: true })
      } else {
        const p = arr[0]
        bumpOption(bucket, `id:${p.id || p.name}`, p.name)
      }
      continue
    }

    // Resto de categorías: objeto único o null.
    if (value && value.name) {
      bumpOption(bucket, `id:${value.id || value.name}`, value.name)
    } else if (cat.alwaysServed && (value === null || value === undefined)) {
      // alwaysServed=true significa que el cliente lo recibe por defecto.
      // Si la cajera lo quitó, eso es info útil: "Sin acompañante: 5".
      bumpOption(bucket, '__sin__', `Sin ${cat.label.toLowerCase()}`, { isSinOpt: true })
    }
    // Si no es alwaysServed y viene null, no contamos nada (sopa/proteína
    // ausentes en un corriente sería raro pero no lo inventamos).
  }
}

function addSpecialToStats(order, out) {
  const sel = order.selections || {}

  // 1. La proteína/plato especial → categoría 'especial'.
  const esp = sel.especial
  const bucketEsp = ensureBucket(out, 'especial')
  if (esp && esp.name) {
    bumpOption(bucketEsp, `id:${esp.id || esp.name}`, esp.name)
  } else if (order.description) {
    // Especiales viejos sin selections.especial — usar description.
    bumpOption(bucketEsp, `desc:${order.description.slice(0, 40)}`, order.description)
  } else {
    bumpOption(bucketEsp, '__sin__', 'Sin descripción', { isSinOpt: true })
  }

  // 2. Sopa y ensalada van a las MISMAS categorías que el corriente
  //    (la cocinera publica una sola lista para ambos).
  for (const catId of ['soup', 'salad']) {
    const cat = CATEGORY_BY_ID[catId]
    const value = sel[catId]
    const bucket = ensureBucket(out, catId)
    if (value && value.name) {
      bumpOption(bucket, `id:${value.id || value.name}`, value.name)
    } else if (cat?.alwaysServed && (value === null || value === undefined)) {
      bumpOption(bucket, '__sin__', `Sin ${cat.label.toLowerCase()}`, { isSinOpt: true })
    }
  }
}

// ──────────────────────────────────────────────────────────────
// UI bits
// ──────────────────────────────────────────────────────────────

function SplitChip({ label, value, accent, emoji }) {
  return (
    <div style={{
      padding: '8px 14px', borderRadius: 999,
      background: 'rgba(255,255,255,0.10)',
      display: 'inline-flex', alignItems: 'center', gap: 8,
      fontFamily: 'inherit',
    }}>
      {emoji && <span style={{ fontSize: 13 }}>{emoji}</span>}
      <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.75)' }}>
        {label}
      </span>
      <span style={{
        fontSize: 16, fontWeight: 800, color: accent,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </span>
    </div>
  )
}

function CategoryCard({ catId, breakdown }) {
  // El 'especial' no existe en CATEGORY_BY_ID con su mismo label visible
  // ("Almuerzo Especial") — usar metadata custom para que la card luzca.
  const cat = CATEGORY_BY_ID[catId]
  const emoji = cat?.emoji || '🍽️'
  const label = catId === 'especial' ? 'Almuerzo Especial' : (cat?.label || catId)

  return (
    <Card padding={0}>
      <div style={{
        padding: '14px 18px 10px',
        borderBottom: `1px solid ${T.neutral[100]}`,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{ fontSize: 22, lineHeight: 1 }}>{emoji}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14.5, fontWeight: 800, color: T.neutral[900],
            letterSpacing: -0.2,
          }}>
            {label}
          </div>
          <div style={{ fontSize: 11.5, color: T.neutral[500], marginTop: 1 }}>
            {breakdown.total} {breakdown.total === 1 ? 'almuerzo' : 'almuerzos'}
          </div>
        </div>
      </div>
      <div>
        {breakdown.items.map((it, i) => (
          <BreakdownRow
            key={it.key}
            name={it.name}
            count={it.count}
            isLast={i === breakdown.items.length - 1}
            isSinOpt={it.isSinOpt}
            isMixto={it.isMixto}
            total={breakdown.total}
          />
        ))}
      </div>
    </Card>
  )
}

function BreakdownRow({ name, count, total, isLast, isSinOpt, isMixto }) {
  // Barra de proporción minimalista en el fondo para leer rápido.
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  const tone = isSinOpt
    ? { name: T.bad, bar: T.bad + '18' }
    : isMixto
      ? { name: T.copper[700], bar: T.copper[100] + '88' }
      : { name: T.neutral[800], bar: T.copper[100] + '55' }

  return (
    <div style={{
      position: 'relative',
      padding: '12px 18px',
      borderBottom: isLast ? 'none' : `1px solid ${T.neutral[100]}`,
      display: 'flex', alignItems: 'center', gap: 12,
      overflow: 'hidden',
    }}>
      {/* Fondo gradiente con la proporción */}
      <div style={{
        position: 'absolute', inset: 0,
        width: `${pct}%`,
        background: tone.bar,
        zIndex: 0,
      }} />
      <div style={{
        position: 'relative', zIndex: 1, flex: 1, minWidth: 0,
        fontSize: 14, fontWeight: 600, color: tone.name,
        letterSpacing: -0.1,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {isSinOpt && <span style={{ marginRight: 6 }}>⚠</span>}
        {name}
      </div>
      <div style={{
        position: 'relative', zIndex: 1, display: 'flex',
        alignItems: 'baseline', gap: 6, flexShrink: 0,
      }}>
        <span style={{
          fontSize: 18, fontWeight: 800, color: T.neutral[900],
          fontVariantNumeric: 'tabular-nums',
        }}>
          {count}
        </span>
        <span style={{ fontSize: 11, fontWeight: 600, color: T.neutral[500] }}>
          {pct}%
        </span>
      </div>
    </div>
  )
}

function EmptyState({ emoji, title, hint }) {
  return (
    <div style={{ padding: '52px 28px', textAlign: 'center' }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>{emoji}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: T.neutral[800] }}>{title}</div>
      {hint && (
        <div style={{
          fontSize: 13, color: T.neutral[500], marginTop: 6,
          maxWidth: 320, margin: '6px auto 0', lineHeight: 1.5,
        }}>
          {hint}
        </div>
      )}
    </div>
  )
}

const navBtn = {
  width: 38, height: 38, borderRadius: 999, border: 'none', cursor: 'pointer',
  background: 'rgba(255,255,255,0.12)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}

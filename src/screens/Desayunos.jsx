import { useEffect, useMemo, useState } from 'react'
import { T } from '../tokens'
import { fmtDate } from '../utils/format'
import { Card } from '../components/Atoms'
import { ScreenHeader } from '../components/Nav'
import { getBogotaDateStr } from '../db'
import { watchKitchenOrdersForDate } from '../kitchenOrders'
import { BREAKFAST_CATEGORIES, BREAKFAST_CATEGORY_BY_ID } from '../breakfast'

// ──────────────────────────────────────────────────────────────
// Pantalla "Desayunos": estadísticas de venta del día para el admin.
//   - Nav de fecha (mismo patrón que Almuerzos.jsx).
//   - Cuenta los kitchenOrders del día con kind === 'breakfast' que
//     no estén cancelados.
//   - Total general + cuántos combos vs armados.
//   - Desglose por cada una de las 4 categorías (caldo, huevos, arroz, bebida).
// ──────────────────────────────────────────────────────────────

export default function Desayunos() {
  const todayStr = getBogotaDateStr()
  const [date, setDate] = useState(todayStr)
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    return watchKitchenOrdersForDate(date, list => {
      // Solo desayunos
      setOrders(list.filter(o => o.kind === 'breakfast'))
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
      <ScreenHeader title="Desayunos" subtitle="Estadísticas de venta" />

      {/* Navegador de fecha */}
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
                fontSize: 11, fontWeight: 600, color: '#F4E0BC',
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

          <div style={{
            padding: '10px 20px', background: T.neutral[50],
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderTop: `1px solid ${T.neutral[100]}`,
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: T.neutral[600] }}>
              {loading
                ? 'Cargando…'
                : stats.total === 0
                  ? 'Sin desayunos'
                  : `${stats.total} ${stats.total === 1 ? 'desayuno vendido' : 'desayunos vendidos'}`}
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
        <EmptyState emoji="☕" title="Cargando…" hint="Buscando desayunos del día." />
      ) : stats.total === 0 ? (
        <EmptyState
          emoji="🍳"
          title={isToday ? 'Aún no hay desayunos hoy' : 'Sin ventas este día'}
          hint={isToday
            ? 'Cuando una cajera mande una comanda aparecerá aquí.'
            : 'No se registraron desayunos en esa fecha.'}
        />
      ) : (
        <>
          {/* Total + breakdown combos vs armados */}
          <div style={{ padding: '0 16px 12px' }}>
            <Card padding={20} style={{ background: T.neutral[900], color: '#fff' }}>
              <div style={{
                fontSize: 11, fontWeight: 700, color: '#F4E0BC',
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
                  {stats.total === 1 ? 'desayuno' : 'desayunos'}
                </span>
              </div>
              <div style={{
                marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap',
              }}>
                {stats.combos > 0 && (
                  <SplitChip label="Combos" value={stats.combos} accent="#FFD58A" emoji="⭐" />
                )}
                {stats.armados > 0 && (
                  <SplitChip label="Armados" value={stats.armados} accent="#F4E0BC" />
                )}
                {stats.llevar > 0 && (
                  <SplitChip label="Para llevar" value={stats.llevar} accent="rgba(255,255,255,0.6)" emoji="📦" />
                )}
              </div>
            </Card>
          </div>

          {/* Combos vendidos */}
          {stats.combosByName.length > 0 && (
            <div style={{ padding: '0 16px 12px' }}>
              <CategoryCard
                catEmoji="⭐"
                catLabel="Combos vendidos"
                breakdown={{ total: stats.combos, items: stats.combosByName }}
              />
            </div>
          )}

          {/* Desglose por categoría */}
          <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {BREAKFAST_CATEGORIES.map(cat => {
              const b = stats.byCategory[cat.id]
              if (!b) return null
              return <CategoryCard
                key={cat.id}
                catEmoji={cat.emoji}
                catLabel={cat.label}
                breakdown={b}
              />
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

function computeStats(orders) {
  const out = {
    total: 0,
    combos: 0,
    armados: 0,
    llevar: 0,
    cancelled: 0,
    byCategory: {},
    combosByName: [],
  }

  const comboCounts = {}

  for (const o of orders) {
    if (o.status === 'cancelled') {
      out.cancelled += 1
      continue
    }
    out.total += 1
    if (o.destination === 'llevar') out.llevar += 1

    if (o.comboId || o.comboName) {
      out.combos += 1
      const key = o.comboId || o.comboName
      if (!comboCounts[key]) {
        comboCounts[key] = { key, name: o.comboName || key, count: 0 }
      }
      comboCounts[key].count += 1
    } else {
      out.armados += 1
    }

    const sel = o.selections || {}
    for (const cat of BREAKFAST_CATEGORIES) {
      const value = sel[cat.id]
      const bucket = ensureBucket(out, cat.id)
      if (value && value.name) {
        bumpOption(bucket, `id:${value.id || value.name}`, value.name)
      } else {
        // Sin esta categoría: lo contamos como "Sin X" para que el admin vea
        // qué se omite con frecuencia.
        bumpOption(bucket, '__sin__', `Sin ${cat.label.toLowerCase()}`, { isSinOpt: true })
      }
    }
  }

  // Ordenar items dentro de cada categoría
  for (const catId of Object.keys(out.byCategory)) {
    const bucket = out.byCategory[catId]
    bucket.items = Object.entries(bucket.counts).map(([key, count]) => ({
      key,
      name: bucket.names[key] || key,
      count,
      isSinOpt: bucket.sinKeys.has(key),
    }))
    bucket.items.sort((a, b) => {
      if (a.isSinOpt !== b.isSinOpt) return a.isSinOpt ? 1 : -1
      return b.count - a.count
    })
    delete bucket.counts
    delete bucket.names
    delete bucket.sinKeys
  }

  // Lista de combos vendidos ordenada desc
  out.combosByName = Object.values(comboCounts)
    .sort((a, b) => b.count - a.count)
    .map(c => ({ key: c.key, name: c.name, count: c.count, isSinOpt: false }))

  return out
}

function ensureBucket(out, catId) {
  if (!out.byCategory[catId]) {
    out.byCategory[catId] = {
      total: 0,
      counts: {},
      names: {},
      sinKeys: new Set(),
    }
  }
  return out.byCategory[catId]
}

function bumpOption(bucket, key, displayName, { isSinOpt = false } = {}) {
  bucket.counts[key] = (bucket.counts[key] || 0) + 1
  bucket.names[key] = displayName
  if (isSinOpt) bucket.sinKeys.add(key)
  bucket.total += 1
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

function CategoryCard({ catEmoji, catLabel, breakdown }) {
  return (
    <Card padding={0}>
      <div style={{
        padding: '14px 18px 10px',
        borderBottom: `1px solid ${T.neutral[100]}`,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{ fontSize: 22, lineHeight: 1 }}>{catEmoji}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14.5, fontWeight: 800, color: T.neutral[900],
            letterSpacing: -0.2,
          }}>
            {catLabel}
          </div>
          <div style={{ fontSize: 11.5, color: T.neutral[500], marginTop: 1 }}>
            {breakdown.total} {breakdown.total === 1 ? 'desayuno' : 'desayunos'}
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
            total={breakdown.total}
          />
        ))}
      </div>
    </Card>
  )
}

function BreakdownRow({ name, count, total, isLast, isSinOpt }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  const tone = isSinOpt
    ? { name: T.bad, bar: T.bad + '18' }
    : { name: T.neutral[800], bar: '#FFF7E6' + '88' }

  return (
    <div style={{
      position: 'relative',
      padding: '12px 18px',
      borderBottom: isLast ? 'none' : `1px solid ${T.neutral[100]}`,
      display: 'flex', alignItems: 'center', gap: 12,
      overflow: 'hidden',
    }}>
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

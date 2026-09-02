import { useEffect, useState, useMemo } from 'react'
import { T } from '../tokens'
import { fmtCOP, fmtMonthLabel, currentMonth, todayStr } from '../utils/format'
import { Card, SectionHeader, Chip, Amount, CatIcon } from '../components/Atoms'
import { ScreenHeader } from '../components/Nav'
import { getData } from '../db'
import { watchSalesBetween } from '../sales'
import { watchInventoryStockAll, stockValue } from '../inventory'
import { watchCashierProducts, mergeProductCatalogs } from '../products'
import { saleCost, saleHasMissingCost } from '../utils/cost'
import { addSaleToBreakdown } from '../utils/payment'
import { movementMatchesBranch, userBranchIds, visibleBranches } from '../utils/branchScope'
import {
  toCSV, downloadCSV, salesToRows, movementsToRows, summaryToCSV,
  SALES_HEADERS, EXPENSE_HEADERS,
} from '../utils/export'

function catLabel(cat, incomeCats, expenseCats) {
  if (cat === 'ventas_cajera') return 'Ventas (cajera)'
  const all = [...incomeCats, ...expenseCats.proveedores, ...expenseCats.operacion, ...expenseCats.empresa]
  return all.find(c => c.id === cat)?.label || cat
}

/** Suma n días a un YYYY-MM-DD. Aritmética en UTC: solo mueve el string. */
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}

/** Último día del mes YYYY-MM. */
function endOfMonth(ym) {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

const PAY_META = [
  { id: 'efectivo',  label: 'Efectivo',  color: T.ok },
  { id: 'nequi',     label: 'Nequi',     color: T.copper[500] },
  { id: 'daviplata', label: 'Daviplata', color: T.copper[300] },
  { id: 'deuda',     label: 'Fiado',     color: T.neutral[400] },
]

export default function Reports({ filter, setFilter, movements, incomeCats, expenseCats, userDoc }) {
  const [period, setPeriod] = useState('month')   // 'day' | 'week' | 'month'
  const [month, setMonth] = useState(currentMonth())
  const [sales, setSales] = useState([])
  const [stock, setStock] = useState([])
  const [cashierProducts, setCashierProducts] = useState([])

  const today = todayStr()

  // Rango de fechas del período activo (ambas inclusive, YYYY-MM-DD).
  const [from, to] = useMemo(() => {
    if (period === 'day') return [today, today]
    if (period === 'week') return [addDays(today, -6), today]
    return [`${month}-01`, endOfMonth(month)]
  }, [period, month, today])

  // Solo las ventas del rango. Antes se traía la colección completa y se
  // filtraba en cliente, lo que agotaba la cuota diaria de Firestore.
  // Panaderías del usuario (null = sin restricción). Se serializa para que el
  // efecto no se re-suscriba en cada render por recibir un array nuevo.
  const myBranchIds = userBranchIds(userDoc)
  const branchKey = myBranchIds ? myBranchIds.join(',') : ''
  useEffect(
    () => watchSalesBetween(from, to, setSales, branchKey ? branchKey.split(',') : null),
    [from, to, branchKey]
  )
  useEffect(() => watchInventoryStockAll(setStock), [])
  useEffect(() => watchCashierProducts(setCashierProducts), [])

  const branches = visibleBranches(userDoc, getData().branches || [])

  // movementMatchesBranch traduce el 'both' histórico (los movimientos viejos
  // no traían panadería) para que filtrar por sede no muestre lo del otro local.
  const matchMov = (m) => movementMatchesBranch(m, filter) && m.date >= from && m.date <= to
  const matchSale = (s) => filter === 'all' || String(s.branchId) === String(filter)

  const movs = movements.filter(matchMov)
  const periodSales = sales.filter(s => (s.status || 'active') !== 'deleted' && matchSale(s))

  // ── Cuentas del período ──────────────────────────────────────
  const ventas = periodSales.reduce((s, x) => s + (Number(x.total) || 0), 0)
  const costoVentas = periodSales.reduce((s, x) => s + saleCost(x), 0)
  const gananciaBruta = ventas - costoVentas

  const otrosIngresos = movs.filter(m => m.type === 'income').reduce((s, m) => s + m.amount, 0)
  const gastos = movs.filter(m => m.type === 'expense').reduce((s, m) => s + m.amount, 0)
  const utilidadNeta = gananciaBruta + otrosIngresos - gastos

  // Ventas a las que les falta costo: la ganancia mostrada está incompleta.
  const sinCosto = periodSales.filter(saleHasMissingCost).length

  // ── Cómo entró la plata ──────────────────────────────────────
  const breakdown = { efectivo: 0, nequi: 0, daviplata: 0, deuda: 0 }
  periodSales.forEach(s => addSaleToBreakdown(breakdown, s))
  const breakdownTotal = Object.values(breakdown).reduce((a, b) => a + b, 0)

  // ── Ganancia por producto ────────────────────────────────────
  const byProduct = {}
  periodSales.forEach(s => {
    (s.items || []).forEach(it => {
      const key = it.name || 'Sin nombre'
      const qty = Number(it.qty) || 0
      const venta = Number(it.subtotal) || 0
      const costo = (Number(it.unitCost) || 0) * qty
      if (!byProduct[key]) byProduct[key] = { name: key, qty: 0, venta: 0, costo: 0, faltaCosto: false }
      byProduct[key].qty += qty
      byProduct[key].venta += venta
      byProduct[key].costo += costo
      if (!(Number(it.unitCost) > 0)) byProduct[key].faltaCosto = true
    })
  })
  const topProducts = Object.values(byProduct)
    .map(p => ({ ...p, ganancia: p.venta - p.costo }))
    .sort((a, b) => b.ganancia - a.ganancia)
    .slice(0, 8)

  // ── Gastos por tipo y categoría ──────────────────────────────
  const byGroup = { proveedores: 0, operacion: 0, empresa: 0 }
  movs.filter(m => m.type === 'expense').forEach(m => {
    if (m.group) byGroup[m.group] = (byGroup[m.group] || 0) + m.amount
  })

  const byCat = {}
  movs.filter(m => m.type === 'expense').forEach(m => { byCat[m.cat] = (byCat[m.cat] || 0) + m.amount })
  const topCats = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 6)

  // ── Ventas por panadería (sin sedes quemadas en código) ───────
  const byBranch = branches.map(b => ({
    ...b,
    total: periodSales
      .filter(s => String(s.branchId) === String(b.id))
      .reduce((sum, s) => sum + (Number(s.total) || 0), 0),
  })).filter(b => b.total > 0)
  const branchTotal = byBranch.reduce((s, b) => s + b.total, 0)

  // Valor del inventario a costo. No depende del período: es una foto de HOY,
  // no algo que ocurrió dentro del rango, y por eso se muestra aparte.
  const costOf = (() => {
    const cat = mergeProductCatalogs(getData().products || [], cashierProducts)
    const map = new Map(cat.map(p => [p.id, p.unitCost || 0]))
    return (id) => map.get(id) || 0
  })()
  const stockDeSede = filter === 'all'
    ? stock
    : stock.filter(s => String(s.branchId) === String(filter))
  const valorInventario = stockValue(stockDeSede, costOf)

  const periodLabel = period === 'day' ? 'Hoy'
    : period === 'week' ? 'Últimos 7 días'
    : fmtMonthLabel(month)

  const vacio = periodSales.length === 0 && movs.length === 0

  // ── Descargas ────────────────────────────────────────────────
  const branchName = (id) => branches.find(b => String(b.id) === String(id))?.name || ''
  const sufijo = from === to ? from : `${from}_a_${to}`

  function descargarVentas() {
    const rows = salesToRows(periodSales, branchName)
    const resumen = summaryToCSV({ desde: from, hasta: to, sales: periodSales, movements: movs })
    // El resumen va arriba y el detalle debajo: al abrirlo, lo primero que se
    // ve es cuanto quedo, sin tener que sumar nada a mano.
    const csv = resumen + '\r\n\r\n' + toCSV(rows, SALES_HEADERS)
    downloadCSV(`ventas_${sufijo}.csv`, csv)
  }

  function descargarGastos() {
    const rows = movementsToRows(movs, c => catLabel(c, incomeCats, expenseCats), branchName)
    downloadCSV(`gastos_${sufijo}.csv`, toCSV(rows, EXPENSE_HEADERS))
  }

  return (
    <div style={{ paddingBottom: 110 }}>
      <ScreenHeader title="Balance" subtitle={periodLabel}/>

      {/* Período */}
      <div style={{ padding: '0 20px 10px', display: 'flex', gap: 8 }}>
        <Chip label="Hoy"     active={period === 'day'}   onClick={() => setPeriod('day')} />
        <Chip label="Semana"  active={period === 'week'}  onClick={() => setPeriod('week')} />
        <Chip label="Mes"     active={period === 'month'} onClick={() => setPeriod('month')} />
      </div>

      {period === 'month' && (
        <div style={{ padding: '0 20px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button onClick={() => {
            const [y, m] = month.split('-').map(Number)
            setMonth(new Date(y, m - 2, 1).toISOString().slice(0, 7))
          }} style={navBtn(false)}>‹ Anterior</button>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.neutral[700] }}>{fmtMonthLabel(month)}</div>
          <button
            onClick={() => {
              const [y, m] = month.split('-').map(Number)
              setMonth(new Date(y, m, 1).toISOString().slice(0, 7))
            }}
            disabled={month >= currentMonth()}
            style={navBtn(month >= currentMonth())}
          >Siguiente ›</button>
        </div>
      )}

      {/* Panadería */}
      {branches.length > 1 && (
        <div style={{ padding: '0 20px 12px', display: 'flex', gap: 8, overflowX: 'auto' }}>
          <Chip label="Todas" active={filter === 'all'} onClick={() => setFilter('all')} />
          {branches.map(br => (
            <Chip key={br.id} label={br.name} active={filter === br.id} onClick={() => setFilter(br.id)} />
          ))}
        </div>
      )}

      {/* Resumen */}
      <div style={{ padding: '0 16px' }}>
        <Card padding={20} style={{
          background: `linear-gradient(145deg, ${T.neutral[800]} 0%, ${T.neutral[900]} 100%)`,
          color: '#fff',
        }}>
          <div style={{ fontSize: 11, color: T.copper[300], fontWeight: 600, letterSpacing: 0.8, textTransform: 'uppercase' }}>
            Le quedó
          </div>
          <div style={{
            fontSize: 34, fontWeight: 700, marginTop: 6, fontVariantNumeric: 'tabular-nums',
            letterSpacing: -1, color: utilidadNeta >= 0 ? '#fff' : '#E8A090',
          }}>
            {fmtCOP(utilidadNeta, { sign: true })}
          </div>

          <div style={{
            marginTop: 16, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.1)',
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14,
          }}>
            <MiniStat label="Vendió"          value={ventas}        color="#fff"/>
            <MiniStat label="Costo de lo vendido" value={costoVentas} color={T.copper[300]}/>
            <MiniStat label="Ganancia en ventas"  value={gananciaBruta} color={T.ok}/>
            <MiniStat label="Gastos"          value={gastos}        color={T.copper[300]}/>
          </div>

          {otrosIngresos > 0 && (
            <div style={{ marginTop: 12, fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>
              Incluye {fmtCOP(otrosIngresos)} de otros ingresos registrados.
            </div>
          )}
        </Card>
      </div>

      {valorInventario > 0 && (
        <div style={{ padding: '12px 16px 0' }}>
          <Card padding={16}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.neutral[800] }}>En inventario</div>
                <div style={{ fontSize: 11.5, color: T.neutral[400], marginTop: 2 }}>
                  Valorizado al costo, a día de hoy
                </div>
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: T.neutral[900], fontVariantNumeric: 'tabular-nums' }}>
                {fmtCOP(valorInventario)}
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Descargar a Excel */}
      {!vacio && (
        <div style={{ padding: '12px 16px 0' }}>
          <Card padding={14}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.neutral[800] }}>Descargar a Excel</div>
            <div style={{ fontSize: 12, color: T.neutral[500], marginTop: 3 }}>
              {periodLabel}{filter !== 'all' ? ` · ${branchName(filter)}` : ''}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={descargarVentas} disabled={periodSales.length === 0} style={dlBtn(periodSales.length === 0, true)}>
                Ventas ({periodSales.length})
              </button>
              <button onClick={descargarGastos} disabled={movs.length === 0} style={dlBtn(movs.length === 0, false)}>
                Gastos ({movs.length})
              </button>
            </div>
          </Card>
        </div>
      )}

      {/* Aviso de costos faltantes */}
      {sinCosto > 0 && (
        <div style={{ padding: '12px 16px 0' }}>
          <Card padding={14} style={{ background: T.copper[50], border: `1px solid ${T.copper[200]}` }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.copper[700] }}>
              La ganancia está incompleta
            </div>
            <div style={{ fontSize: 12.5, color: T.neutral[600], marginTop: 4, lineHeight: 1.45 }}>
              {sinCosto === 1
                ? 'Hay 1 venta con productos sin costo cargado.'
                : `Hay ${sinCosto} ventas con productos sin costo cargado.`}
              {' '}Mientras falte el costo, esos productos cuentan como ganancia total.
              Cárgalos en <b>Productos</b> para ver la ganancia real.
            </div>
          </Card>
        </div>
      )}

      {/* Cómo entró la plata */}
      {breakdownTotal > 0 && (
        <>
          <SectionHeader title="Cómo entró la plata"/>
          <div style={{ padding: '0 16px' }}>
            <Card padding={16}>
              {PAY_META.filter(p => breakdown[p.id] > 0).map((p, i, arr) => {
                const pct = (breakdown[p.id] / breakdownTotal) * 100
                return (
                  <div key={p.id} style={{ marginBottom: i < arr.length - 1 ? 14 : 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: T.neutral[700], display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color }}/>
                        {p.label}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: T.neutral[800], fontVariantNumeric: 'tabular-nums' }}>
                        {fmtCOP(breakdown[p.id])}
                        <span style={{ color: T.neutral[400], fontWeight: 500 }}> · {pct.toFixed(0)}%</span>
                      </span>
                    </div>
                    <div style={{ height: 6, borderRadius: 3, background: T.neutral[100], overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: p.color, borderRadius: 3, transition: 'width 0.4s' }}/>
                    </div>
                  </div>
                )
              })}
            </Card>
          </div>
        </>
      )}

      {/* Ganancia por producto */}
      {topProducts.length > 0 && (
        <>
          <SectionHeader title="Lo que más le deja"/>
          <div style={{ padding: '0 16px' }}>
            <Card padding={0}>
              {topProducts.map((p, i) => (
                <div key={p.name} style={{
                  padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12,
                  borderBottom: i < topProducts.length - 1 ? `0.5px solid ${T.neutral[100]}` : 'none',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: T.neutral[800] }}>{p.name}</div>
                    <div style={{ fontSize: 11.5, color: T.neutral[400], marginTop: 2 }}>
                      {p.qty} vendidos · {fmtCOP(p.venta)}
                      {p.faltaCosto && <span style={{ color: T.copper[500] }}> · falta costo</span>}
                    </div>
                  </div>
                  <Amount value={p.ganancia} size={14} weight={700} color={p.ganancia >= 0 ? T.ok : T.bad}/>
                </div>
              ))}
            </Card>
          </div>
        </>
      )}

      {/* Ventas por panadería */}
      {filter === 'all' && byBranch.length > 1 && (
        <>
          <SectionHeader title="Ventas por panadería"/>
          <div style={{ padding: '0 16px' }}>
            <Card padding={16}>
              {byBranch.map((b, i) => {
                const pct = branchTotal > 0 ? (b.total / branchTotal) * 100 : 0
                return (
                  <div key={b.id} style={{ marginBottom: i < byBranch.length - 1 ? 14 : 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: T.neutral[700] }}>{b.name}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: T.neutral[800], fontVariantNumeric: 'tabular-nums' }}>
                        {fmtCOP(b.total)}
                        <span style={{ color: T.neutral[400], fontWeight: 500 }}> · {pct.toFixed(0)}%</span>
                      </span>
                    </div>
                    <div style={{ height: 6, borderRadius: 3, background: T.neutral[100], overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: T.copper[400], borderRadius: 3, transition: 'width 0.4s' }}/>
                    </div>
                  </div>
                )
              })}
            </Card>
          </div>
        </>
      )}

      {/* Gastos por tipo */}
      {gastos > 0 && (
        <>
          <SectionHeader title="Gastos por tipo"/>
          <div style={{ padding: '0 16px' }}>
            <Card padding={16}>
              {[
                { id: 'proveedores', label: 'Proveedores', color: T.copper[400] },
                { id: 'operacion',   label: 'Operación',   color: T.copper[600] },
                { id: 'empresa',     label: 'Empresa',     color: T.copper[300] },
              ].map((g, i, arr) => {
                const pct = gastos > 0 ? (byGroup[g.id] / gastos) * 100 : 0
                return (
                  <div key={g.id} style={{ marginBottom: i < arr.length - 1 ? 16 : 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: T.neutral[700], display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: g.color }}/>
                        {g.label}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: T.neutral[800], fontVariantNumeric: 'tabular-nums' }}>
                        {fmtCOP(byGroup[g.id])}
                        <span style={{ color: T.neutral[400], fontWeight: 500 }}> · {pct.toFixed(0)}%</span>
                      </span>
                    </div>
                    <div style={{ height: 6, borderRadius: 3, background: T.neutral[100], overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: g.color, borderRadius: 3, transition: 'width 0.4s' }}/>
                    </div>
                  </div>
                )
              })}
            </Card>
          </div>
        </>
      )}

      {/* Mayores gastos */}
      {topCats.length > 0 && (
        <>
          <SectionHeader title="Mayores gastos"/>
          <div style={{ padding: '0 16px' }}>
            <Card padding={0}>
              {topCats.map(([cat, amt], i) => (
                <div key={cat} style={{
                  padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12,
                  borderBottom: i < topCats.length - 1 ? `0.5px solid ${T.neutral[100]}` : 'none',
                }}>
                  <div style={{ width: 32, height: 32, borderRadius: 9, background: T.copper[50], display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <CatIcon cat={cat} size={16} color={T.copper[600]}/>
                  </div>
                  <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: T.neutral[800] }}>
                    {catLabel(cat, incomeCats, expenseCats)}
                  </div>
                  <Amount value={amt} size={14} weight={700}/>
                </div>
              ))}
            </Card>
          </div>
        </>
      )}

      {vacio && (
        <div style={{ padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 36 }}>📊</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: T.neutral[600], marginTop: 12 }}>
            Sin movimiento en este período
          </div>
          <div style={{ fontSize: 13, color: T.neutral[400], marginTop: 6 }}>
            Las ventas y los gastos aparecen aquí apenas se registren
          </div>
        </div>
      )}
    </div>
  )
}

function MiniStat({ label, value, color }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, marginTop: 3, color, fontVariantNumeric: 'tabular-nums' }}>
        {fmtCOP(value)}
      </div>
    </div>
  )
}

function navBtn(disabled) {
  return {
    background: 'none', border: 'none', padding: '8px 12px',
    cursor: disabled ? 'default' : 'pointer',
    color: disabled ? T.neutral[300] : T.copper[500],
    fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
  }
}

function dlBtn(disabled, primary) {
  return {
    flex: 1, padding: '10px 12px', borderRadius: 10, cursor: disabled ? 'default' : 'pointer',
    fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
    border: primary ? 'none' : `1px solid ${T.neutral[200]}`,
    background: disabled ? T.neutral[100] : (primary ? T.copper[500] : '#fff'),
    color: disabled ? T.neutral[400] : (primary ? '#fff' : T.neutral[700]),
  }
}

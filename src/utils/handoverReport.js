// ─────────────────────────────────────────────────────────────────────────────
// REPORTE DE UNA PANADERIA ENTRE DOS MOMENTOS
//
// Nace de una pregunta muy concreta: una panadería cambió de dueño un lunes al
// mediodía y hay que entregar, en un solo documento, TODO lo que pasó en ella
// desde esa hora. No un mes, no "desde el 1": desde esa hora.
//
// Por eso el corte es por MOMENTO y no por día. Las ventas de la mañana del
// lunes son del dueño anterior y las de la tarde del nuevo; un informe que
// corte por fecha se las suma todas al mismo y no sirve para lo único que se
// le pide.
//
// ── De dónde sale cada cifra ─────────────────────────────────────────────────
//   ventas          /sales                 (branchId + rango de fecha)
//   gastos/ingresos /movements             (branch + rango de fecha)
//   cierres de caja /cashSessions          (branchId, cerrados dentro del rango)
//   fiados          /debtors               (branchId, historial dentro del rango)
//   inventario      /inventoryStock + /inventoryMoves
//
// Todas las consultas van ACOTADAS a la panadería. No es solo por eficiencia:
// las reglas de Firestore rechazan la consulta entera si pudiera devolver algo
// que el usuario no puede leer, así que un dueño restringido a su sede recibe
// permission-denied —y una pantalla en blanco— si la consulta no filtra.
//
// ── Sobre la hora de corte ───────────────────────────────────────────────────
// Las ventas y los movimientos guardan `createdAt` (hora del servidor), y con
// eso el corte del primer día es exacto. Un registro viejo sin `createdAt` cae
// al criterio de solo fecha: se incluye el día del corte completo. Se cuentan
// aparte y el informe lo dice en la nota de método, en vez de callarlo.
// ─────────────────────────────────────────────────────────────────────────────

import { collection, query, where, getDocs } from 'firebase/firestore'
import { firestoreDb } from '../firebase'
import { saleCost, saleHasMissingCost, productUnitCost } from './cost'
import { addSaleToBreakdown } from './payment'
import {
  Sheet, money, moneyShort, CAT, VENTAS, GASTOS, BAD, WARN, INK, MUTED,
} from './pdfKit'

// Colombia no tiene horario de verano, así que el desfase es fijo. Se escribe
// explícito y no se confía en la hora del equipo: el informe tiene que dar lo
// mismo si se genera desde un celular con la zona horaria mal puesta.
const BOGOTA_OFFSET = '-05:00'
const TZ = { timeZone: 'America/Bogota' }

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** Momento exacto a partir de una fecha YYYY-MM-DD y una hora HH:MM de Bogotá. */
export function bogotaMoment(dateStr, timeStr = '00:00') {
  return new Date(`${dateStr}T${timeStr}:00${BOGOTA_OFFSET}`)
}

/** Fecha (YYYY-MM-DD) de Bogotá de un instante. */
export function bogotaDate(ms) {
  return new Date(ms).toLocaleDateString('en-CA', TZ)
}

/** Hora del día (0-23) en Bogotá. */
function bogotaHour(ms) {
  return Number(new Date(ms).toLocaleString('en-US', { ...TZ, hour: '2-digit', hour12: false }))
}

/** HH:MM en Bogotá. */
function bogotaTime(ms) {
  return new Date(ms).toLocaleTimeString('es-CO', {
    ...TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

/** "lunes 31 de agosto de 2026" */
export function fechaLarga(dateStr) {
  const parts = dateStr.split('-').map(Number)
  const dow = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay()
  return `${DIAS[dow]} ${parts[2]} de ${MESES[parts[1] - 1]} de ${parts[0]}`
}

/** "12:00 m", "3:40 p.m." — como se dice la hora en Colombia. */
export function horaColombiana(timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  if (h === 12 && m === 0) return '12:00 m (mediodía)'
  if (h === 0 && m === 0) return '12:00 a.m. (medianoche)'
  const suf = h < 12 ? 'a.m.' : 'p.m.'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${suf}`
}

/** "3 ventas" / "1 venta" — sin el "(s)" que delata que lo escribió una máquina. */
function plural(n, sing, plur) {
  return `${n} ${n === 1 ? sing : plur}`
}

/** "lun 31 ago" — para las tablas, que pueden cruzar de mes. */
function fechaTabla(dateStr) {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-').map(Number)
  if (!y || !m || !d) return dateStr
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return `${DIAS_CORTOS[dow]} ${d} ${MESES[m - 1].slice(0, 3)}`
}

/** "lun 31" */
function diaCorto(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return `${DIAS_CORTOS[dow]} ${d}`
}

/** Todos los días YYYY-MM-DD entre dos fechas, ambas incluidas. */
function listarDias(from, to) {
  const out = []
  const [y, m, d] = from.split('-').map(Number)
  const cur = new Date(Date.UTC(y, m - 1, d))
  while (true) {
    const s = cur.toISOString().slice(0, 10)
    if (s > to) break
    out.push(s)
    cur.setUTCDate(cur.getUTCDate() + 1)
    if (out.length > 400) break   // cinturón: nunca un bucle infinito
  }
  return out
}

/** Instante de un documento, o null si no quedó registrado. */
function tsOf(d) {
  return d?.createdAt?.toMillis?.() ?? (Number(d?.createdAtClient) || null)
}

// ─────────────────────────────────────────────────────────────────────────────
// LECTURA
// ─────────────────────────────────────────────────────────────────────────────

const col = (name) => collection(firestoreDb, name)
const docs = async (q) => (await getDocs(q)).docs.map(d => ({ id: d.id, ...d.data() }))

/**
 * Trae de Firestore todo lo de UNA panadería en el rango. Cada consulta va por
 * separado y con su propio try: si el inventario falla por falta de un índice,
 * el informe sale igual sin esa sección en vez de no salir.
 */
export async function fetchBranchActivity({ branchId, fromDate, toDate }) {
  const bid = branchId
  const safe = async (label, fn) => {
    try { return await fn() } catch (e) {
      console.warn(`[reporte] no se pudo leer ${label}:`, e?.message || e)
      return { __error: e?.message || String(e) }
    }
  }

  const [sales, movements, sessions, debtors, stock, invMoves] = await Promise.all([
    safe('ventas', () => docs(query(col('sales'),
      where('branchId', '==', bid),
      where('date', '>=', fromDate),
      where('date', '<=', toDate)))),
    safe('movimientos', () => docs(query(col('movements'),
      where('branch', '==', bid),
      where('date', '>=', fromDate),
      where('date', '<=', toDate)))),
    safe('turnos', () => docs(query(col('cashSessions'), where('branchId', '==', bid)))),
    safe('fiados', () => docs(query(col('debtors'), where('branchId', '==', bid)))),
    safe('inventario', () => docs(query(col('inventoryStock'), where('branchId', '==', bid)))),
    safe('movimientos de inventario', () => docs(query(col('inventoryMoves'), where('branchId', '==', bid)))),
  ])

  return { sales, movements, sessions, debtors, stock, invMoves }
}

// ─────────────────────────────────────────────────────────────────────────────
// CALCULO
// ─────────────────────────────────────────────────────────────────────────────

const list = (x) => (Array.isArray(x) ? x : [])

/**
 * Convierte lo leído en las cifras del informe.
 *
 * `startMs`/`endMs` son el corte real. `fromDate`/`toDate` son las fechas que
 * envolvían ese corte, y se usan solo para lo que no tiene hora registrada.
 */
export function buildReport({ raw, startMs, endMs, fromDate, toDate, products = [], catLabel = (c) => c }) {
  const dentro = (d) => {
    const ts = tsOf(d)
    if (ts != null) return ts >= startMs && ts <= endMs
    const f = d?.date
    return typeof f === 'string' && f >= fromDate && f <= toDate
  }
  const sinHora = (d) => tsOf(d) == null

  // ── Ventas ────────────────────────────────────────────────────────────────
  const ventasTodas = list(raw.sales).filter(dentro)
  const ventas = ventasTodas.filter(s => (s.status || 'active') !== 'deleted')
  const ventasAnuladas = ventasTodas.filter(s => (s.status || 'active') === 'deleted')

  const vendido = ventas.reduce((a, s) => a + (Number(s.total) || 0), 0)
  const costoVendido = ventas.reduce((a, s) => a + saleCost(s), 0)
  const gananciaVentas = vendido - costoVendido
  const ventasSinCosto = ventas.filter(saleHasMissingCost).length
  const recargoDigital = ventas.reduce((a, s) => a + (Number(s.digitalSurcharge) || 0), 0)

  // ── Gastos e ingresos del administrador ───────────────────────────────────
  const movs = list(raw.movements).filter(dentro)
  const ingresos = movs.filter(m => m.type === 'income')
  const gastos = movs.filter(m => m.type === 'expense')
  const totalIngresos = ingresos.reduce((a, m) => a + (Number(m.amount) || 0), 0)
  const totalGastos = gastos.reduce((a, m) => a + (Number(m.amount) || 0), 0)

  const leQuedo = gananciaVentas + totalIngresos - totalGastos

  // ── Día a día ─────────────────────────────────────────────────────────────
  const dias = listarDias(fromDate, toDate)
  const porDiaMap = new Map(dias.map(d => [d, {
    date: d, ventas: 0, nVentas: 0, costo: 0, gastos: 0, ingresos: 0,
  }]))
  const diaDe = (d) => {
    const ts = tsOf(d)
    return ts != null ? bogotaDate(ts) : d.date
  }
  ventas.forEach(s => {
    const row = porDiaMap.get(diaDe(s)); if (!row) return
    row.ventas += Number(s.total) || 0
    row.nVentas += 1
    row.costo += saleCost(s)
  })
  movs.forEach(m => {
    const row = porDiaMap.get(diaDe(m)); if (!row) return
    if (m.type === 'income') row.ingresos += Number(m.amount) || 0
    else row.gastos += Number(m.amount) || 0
  })
  const porDia = dias.map(d => {
    const r = porDiaMap.get(d)
    return { ...r, ganancia: r.ventas - r.costo, neto: r.ventas - r.costo + r.ingresos - r.gastos }
  })
  const diasConVenta = porDia.filter(d => d.nVentas > 0).length

  // ── Cómo pagó la gente ────────────────────────────────────────────────────
  // El orden es fijo y los colores se asignan en ese mismo orden: así el verde
  // es "efectivo" en todo el documento y no cambia de una gráfica a la otra.
  const bd = { efectivo: 0, nequi: 0, daviplata: 0, deuda: 0 }
  ventas.forEach(s => addSaleToBreakdown(bd, s))
  const porMetodo = [
    { key: 'efectivo',  label: 'Efectivo',  value: bd.efectivo || 0,  color: CAT[0] },
    { key: 'nequi',     label: 'Nequi',     value: bd.nequi || 0,     color: CAT[1] },
    { key: 'daviplata', label: 'Daviplata', value: bd.daviplata || 0, color: CAT[2] },
    { key: 'deuda',     label: 'Fiado',     value: bd.deuda || 0,     color: CAT[3] },
  ]

  // ── A qué horas se vende ──────────────────────────────────────────────────
  const horas = Array.from({ length: 24 }, () => ({ total: 0, n: 0 }))
  let ventasSinHora = 0
  ventas.forEach(s => {
    const ts = tsOf(s)
    if (ts == null) { ventasSinHora += 1; return }
    const h = bogotaHour(ts)
    horas[h].total += Number(s.total) || 0
    horas[h].n += 1
  })
  const conVenta = horas.map((h, i) => ({ h, i })).filter(x => x.h.n > 0)
  const horaIni = conVenta.length ? conVenta[0].i : 6
  const horaFin = conVenta.length ? conVenta[conVenta.length - 1].i : 20
  const porHora = []
  for (let i = horaIni; i <= horaFin; i++) {
    porHora.push({ hora: i, total: horas[i].total, n: horas[i].n })
  }

  // ── Productos ─────────────────────────────────────────────────────────────
  const prodMap = new Map()
  ventas.forEach(s => list(s.items).forEach(it => {
    const name = it.name || 'Sin nombre'
    const cur = prodMap.get(name) || { name, qty: 0, venta: 0, costo: 0, faltaCosto: false }
    const qty = Number(it.qty) || 0
    cur.qty += qty
    cur.venta += Number(it.subtotal) || 0
    cur.costo += (Number(it.unitCost) || 0) * qty
    if (!(Number(it.unitCost) > 0)) cur.faltaCosto = true
    prodMap.set(name, cur)
  }))
  const porProducto = [...prodMap.values()]
    .map(p => ({ ...p, ganancia: p.venta - p.costo }))
    .sort((a, b) => b.venta - a.venta)

  // ── Quién atendió ─────────────────────────────────────────────────────────
  const cajMap = new Map()
  ventas.forEach(s => {
    const name = s.cashierName || 'Sin registrar'
    const cur = cajMap.get(name) || { name, n: 0, total: 0 }
    cur.n += 1
    cur.total += Number(s.total) || 0
    cajMap.set(name, cur)
  })
  const porCajera = [...cajMap.values()].sort((a, b) => b.total - a.total)

  // ── Gastos por categoría ──────────────────────────────────────────────────
  const catMap = new Map()
  gastos.forEach(m => {
    const key = m.cat || 'sin_categoria'
    const cur = catMap.get(key) || { key, label: catLabel(key) || key, total: 0, n: 0 }
    cur.total += Number(m.amount) || 0
    cur.n += 1
    catMap.set(key, cur)
  })
  const gastosPorCat = [...catMap.values()].sort((a, b) => b.total - a.total)

  // ── Cierres de caja ───────────────────────────────────────────────────────
  const turnos = list(raw.sessions)
    .filter(s => !s.mergedIntoSession)
    .filter(s => (s.type || 'cash') === 'cash')
    .map(s => ({ ...s, _closed: s.closedAt?.toMillis?.() ?? (Number(s.closedAtClient) || null) }))
    .filter(s => s._closed != null && s._closed >= startMs && s._closed <= endMs)
    .sort((a, b) => a._closed - b._closed)
  const turnosAbiertos = list(raw.sessions).filter(s => s.status === 'open' && !s.mergedIntoSession)
  const faltantes = turnos.filter(t => (Number(t.difference) || 0) < 0)
  const sobrantes = turnos.filter(t => (Number(t.difference) || 0) > 0)
  const totalFaltante = faltantes.reduce((a, t) => a + Math.abs(Number(t.difference) || 0), 0)
  const totalSobrante = sobrantes.reduce((a, t) => a + Math.abs(Number(t.difference) || 0), 0)

  // ── Fiados ────────────────────────────────────────────────────────────────
  // Un movimiento de fiado no es un documento propio: vive dentro del historial
  // del cliente. Se recorre ese historial y se toma lo que cae en el rango.
  const fiadoEventos = []
  list(raw.debtors).forEach(d => {
    list(d.history).forEach(e => {
      const ts = Number(e?.createdAt) || null
      const dentroFiado = ts != null
        ? (ts >= startMs && ts <= endMs)
        : (typeof e?.date === 'string' && e.date >= fromDate && e.date <= toDate)
      if (!dentroFiado) return
      fiadoEventos.push({
        cliente: d.name || 'Sin nombre',
        tipo: e.type === 'payment' ? 'Abono' : e.type === 'adjustment' ? 'Ajuste' : 'Fiado nuevo',
        monto: e.type === 'adjustment' ? (Number(e.delta) || 0) : (Number(e.amount) || 0),
        signo: e.type === 'payment' ? -1 : 1,
        fecha: ts != null ? bogotaDate(ts) : (e.date || ''),
        ts,
      })
    })
  })
  fiadoEventos.sort((a, b) => (a.ts || 0) - (b.ts || 0))
  const fiadoNuevo = fiadoEventos.filter(e => e.tipo === 'Fiado nuevo').reduce((a, e) => a + e.monto, 0)
  const fiadoAbonos = fiadoEventos.filter(e => e.tipo === 'Abono').reduce((a, e) => a + e.monto, 0)

  const deudores = list(raw.debtors)
    .filter(d => !d.mergedInto)
    .map(d => ({ name: d.name || 'Sin nombre', saldo: computeOwed(d) }))
    .filter(d => Math.abs(d.saldo) >= 1)
    .sort((a, b) => b.saldo - a.saldo)
  const totalPorCobrar = deudores.reduce((a, d) => a + Math.max(0, d.saldo), 0)

  // ── Inventario ────────────────────────────────────────────────────────────
  const costoDe = (() => {
    const m = new Map(list(products).map(p => [p.id, p.unitCost != null ? p.unitCost : productUnitCost(p)]))
    return (id) => Number(m.get(id)) || 0
  })()
  const existencias = list(raw.stock)
    .filter(s => (Number(s.qty) || 0) !== 0)
    .map(s => ({
      name: s.productName || 'Sin nombre',
      qty: Number(s.qty) || 0,
      valor: (Number(s.qty) || 0) * costoDe(s.productId),
    }))
    .sort((a, b) => b.valor - a.valor)
  const valorInventario = existencias.reduce((a, s) => a + s.valor, 0)
  const invEnRango = list(raw.invMoves).filter(dentro).sort((a, b) => (tsOf(a) || 0) - (tsOf(b) || 0))
  const entradas = invEnRango.filter(m => (Number(m.delta) || 0) > 0).reduce((a, m) => a + Number(m.delta), 0)
  const salidas = invEnRango.filter(m => (Number(m.delta) || 0) < 0).reduce((a, m) => a + Math.abs(Number(m.delta)), 0)

  // ── Calidad del dato ──────────────────────────────────────────────────────
  // Lo que el informe NO puede saber va escrito arriba y en palabras, no en una
  // nota al pie. Una cifra con una salvedad escondida se lee como una cifra
  // firme, y sobre eso se toman decisiones.
  const avisos = []
  if (ventasSinCosto > 0) {
    avisos.push(`De las ${ventas.length} ventas del periodo, ${ventasSinCosto} ${ventasSinCosto === 1 ? 'tiene' : 'tienen'} productos sin precio de costo cargado. En esas ventas la ganancia que aparece está INFLADA: el producto se cuenta como si no costara nada. Se corrige cargando el costo en la pantalla de Productos.`)
  }
  const cuentasSinHora = ventasTodas.filter(sinHora).length + movs.filter(sinHora).length
  if (cuentasSinHora > 0) {
    avisos.push(`Hay ${plural(cuentasSinHora, 'registro', 'registros')} sin hora exacta, de los que quedaron pendientes de sincronizar. Para no dejarlos por fuera se incluyó el día completo del corte, así que puede que traigan algo de antes de la hora del cambio de dueño.`)
  }
  if (ventasAnuladas.length > 0) {
    avisos.push(`Se ${ventasAnuladas.length === 1 ? 'anuló 1 venta' : 'anularon ' + ventasAnuladas.length + ' ventas'} dentro del periodo. No se ${ventasAnuladas.length === 1 ? 'suma' : 'suman'} en ninguna cifra de este informe: quedan listadas al final para que haya rastro.`)
  }
  if (turnosAbiertos.length > 0) {
    avisos.push(`En este momento hay ${plural(turnosAbiertos.length, 'turno de caja abierto', 'turnos de caja abiertos')}. Sus ventas ya están contadas, pero el cuadre de ese turno todavía no existe.`)
  }
  for (const k of ['sales', 'movements', 'sessions', 'debtors', 'stock', 'invMoves']) {
    if (raw[k]?.__error) avisos.push(`No se pudo leer "${k}": ${raw[k].__error}. Esa parte del informe salió vacía.`)
  }

  return {
    resumen: {
      vendido, costoVendido, gananciaVentas, totalIngresos, totalGastos, leQuedo,
      nVentas: ventas.length,
      ticket: ventas.length ? vendido / ventas.length : 0,
      diasConVenta, nDias: dias.length,
      recargoDigital, ventasSinCosto, ventasSinHora,
      mejorDia: porDia.reduce((best, d) => (d.ventas > (best?.ventas ?? -1) ? d : best), null),
    },
    porDia, porMetodo, porHora, porProducto, porCajera, gastosPorCat,
    ingresos, gastos, ventas, ventasAnuladas,
    turnos, turnosAbiertos, faltantes, sobrantes, totalFaltante, totalSobrante,
    fiadoEventos, fiadoNuevo, fiadoAbonos, deudores, totalPorCobrar,
    existencias, valorInventario, invEnRango, entradas, salidas,
    avisos,
  }
}

/** Saldo real de un cliente: se suma su historial, que es la fuente de verdad. */
function computeOwed(d) {
  const h = d?.history
  if (!Array.isArray(h) || h.length === 0) return Number(d?.totalOwed) || 0
  return h.reduce((acc, e) => {
    if (e?.type === 'payment') return acc - (Number(e.amount) || 0)
    if (e?.type === 'adjustment') return acc + (Number(e.delta) || 0)
    return acc + (Number(e?.amount) || 0)
  }, 0)
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSICION DEL PDF
// ─────────────────────────────────────────────────────────────────────────────

const METODO_LABEL = {
  efectivo: 'Efectivo', nequi: 'Nequi', daviplata: 'Daviplata',
  deuda: 'Fiado', mixto: 'Mixto',
}

function metodoDeVenta(s) {
  const m = s.paymentMethod || 'efectivo'
  if (m === 'mixto' && s.paymentSplit) {
    return Object.entries(s.paymentSplit)
      .filter(([, a]) => Number(a) > 0)
      .map(([k, a]) => `${METODO_LABEL[k] || k} ${moneyShort(a)}`)
      .join(' + ')
  }
  return METODO_LABEL[m] || m
}

/** Para ordenar: la hora real, y si no quedó, el final de su día. */
function ordenDe(d) {
  const ts = tsOf(d)
  if (ts != null) return ts
  return d?.date ? bogotaMoment(d.date, '23:59').getTime() : 0
}

/**
 * Arma el PDF completo.
 *
 * El orden de las secciones no es casual: primero la cifra que resume todo,
 * después de dónde salió, y el detalle al final. Quien solo quiera saber cómo
 * le fue lee la primera página y cierra; quien tenga que auditar, sigue.
 */
export function renderHandoverPdf(r, meta) {
  const { branchName, fromDate, fromTime, toDate, generadoPor } = meta
  const desdeTxt = `${fechaLarga(fromDate)}, ${horaColombiana(fromTime)}`
  const hastaTxt = fechaLarga(toDate)

  const sheet = new Sheet({
    title: `Reporte ${branchName}`,
    footerLeft: `${branchName} · desde el ${fechaTabla(fromDate)} a las ${fromTime}`,
  })

  // ── Portada y resumen ─────────────────────────────────────────────────────
  sheet.cover({
    eyebrow: 'Reporte de operación',
    title: branchName,
    lines: [
      `Desde: ${desdeTxt}`,
      `Hasta: ${hastaTxt}`,
      `Generado el ${fechaLarga(bogotaDate(Date.now()))} a las ${bogotaTime(Date.now())}${generadoPor ? ' por ' + generadoPor : ''}`,
    ],
  })

  const R = r.resumen
  sheet.hero({
    label: 'Le quedó en el periodo',
    value: money(R.leQuedo),
    positive: R.leQuedo >= 0,
    help: 'Ganancia de las ventas, más otros ingresos, menos los gastos.',
  })

  sheet.kpis([
    { label: 'Vendió', value: money(R.vendido), accent: VENTAS, note: plural(R.nVentas, 'venta', 'ventas') },
    { label: 'Costo de lo vendido', value: money(R.costoVendido), note: 'lo que costó la mercancía' },
    { label: 'Ganancia en ventas', value: money(R.gananciaVentas), color: R.gananciaVentas >= 0 ? INK : BAD, note: 'vendido menos costo' },
    { label: 'Otros ingresos', value: money(R.totalIngresos), note: 'fuera de las ventas' },
    { label: 'Gastos', value: money(R.totalGastos), accent: GASTOS, note: plural(r.gastos.length, 'registro', 'registros') },
    { label: 'Venta promedio', value: money(R.ticket), note: 'por cada venta' },
  ], { cols: 3 })

  sheet.gap(2)
  sheet.callout(
    'Vendió es toda la plata que entró por ventas. De ahí se descuenta lo que costó la mercancía, y eso deja la ganancia en ventas. Sumando otros ingresos y restando los gastos del periodo se llega a "le quedó", que es la cifra grande de arriba.',
    { titleText: 'Cómo leer este reporte' }
  )

  if (r.avisos.length) {
    sheet.h2('Antes de leer las cifras', 'Cosas que afectan lo que dice este informe', { keep: 18 })
    r.avisos.forEach(a => sheet.callout(a, { tone: 'warn' }))
  }

  // ── Día a día ─────────────────────────────────────────────────────────────
  sheet.newPage()
  sheet.h2('Día por día', `Cuánto se vendió cada día entre el ${fechaTabla(fromDate)} y el ${fechaTabla(toDate)}`, { keep: 62 })
  sheet.barsV({
    data: r.porDia.map(d => ({
      label: diaCorto(d.date),
      value: d.ventas,
      note: d.nVentas ? plural(d.nVentas, 'venta', 'ventas') : 'sin ventas',
    })),
    color: VENTAS,
    footnote: R.mejorDia && R.mejorDia.ventas > 0
      ? `El mejor día fue el ${diaCorto(R.mejorDia.date)} con ${money(R.mejorDia.ventas)}. Se vendió en ${R.diasConVenta} de ${plural(R.nDias, 'día', 'días')}.`
      : undefined,
  })

  sheet.gap(2)
  sheet.table({
    columns: [
      { key: 'dia', title: 'Día', width: 1.5 },
      { key: 'n', title: 'Ventas', width: 0.9, align: 'right' },
      { key: 'vendido', title: 'Vendió', width: 1.3, align: 'right' },
      { key: 'ganancia', title: 'Ganancia', width: 1.3, align: 'right' },
      { key: 'gastos', title: 'Gastos', width: 1.2, align: 'right' },
      { key: 'neto', title: 'Le quedó', width: 1.3, align: 'right', bold: true,
        color: (row) => (row._neto >= 0 ? INK : BAD) },
    ],
    rows: r.porDia.map(d => ({
      dia: diaCorto(d.date), n: String(d.nVentas), vendido: money(d.ventas),
      ganancia: money(d.ganancia), gastos: money(d.gastos), neto: money(d.neto), _neto: d.neto,
    })),
    totalRow: {
      dia: 'TOTAL', n: String(R.nVentas), vendido: money(R.vendido),
      ganancia: money(R.gananciaVentas), gastos: money(R.totalGastos), neto: money(R.leQuedo),
    },
  })

  // ── Cómo pagó la gente ────────────────────────────────────────────────────
  sheet.h2('Cómo pagó la gente', 'Reparto de lo vendido según la forma de pago', { keep: 56 })
  sheet.donut({
    data: r.porMetodo,
    centerValue: moneyShort(R.vendido),
    centerLabel: 'vendido',
    footnote: r.porMetodo[3].value > 0
      ? `Ojo: ${money(r.porMetodo[3].value)} se vendió fiado. Esa plata está contada en lo vendido, pero todavía no ha entrado a la caja.`
      : undefined,
  })

  // ── Horas ─────────────────────────────────────────────────────────────────
  if (r.porHora.length) {
    sheet.h2('A qué horas se vende', 'Suma de lo vendido en cada hora del día, en todo el periodo', { keep: 54 })
    sheet.barsV({
      data: r.porHora.map(h => ({
        label: `${h.hora}h`,
        value: h.total,
        note: h.n ? String(h.n) : '',
      })),
      // Mismo verde que el resto de las ventas: es la misma plata, cortada de
      // otra forma. Cambiar de color aqui sugeriria que se mide otra cosa.
      color: VENTAS,
      height: 38,
      footnote: 'El número debajo de cada barra es la cantidad de ventas de esa hora.'
        + (R.ventasSinHora ? ` No se ${R.ventasSinHora === 1 ? 'pudo ubicar 1 venta' : 'pudieron ubicar ' + R.ventasSinHora + ' ventas'} por hora: no quedó registrada.` : ''),
    })
  }

  // ── Productos ─────────────────────────────────────────────────────────────
  sheet.h2('Qué se vendió', 'Los productos que más plata movieron', { keep: 60 })
  if (r.porProducto.length) {
    sheet.barsH({
      data: r.porProducto.slice(0, 10).map(p => ({ label: p.name, value: p.venta })),
      color: VENTAS,
      labelW: 55,
      footnote: `Se vendieron ${plural(r.porProducto.length, 'producto distinto', 'productos distintos')}.`,
    })
    sheet.gap(2)
    const faltanCostos = r.porProducto.some(p => p.faltaCosto)
    sheet.table({
      columns: [
        { key: 'producto', title: 'Producto', width: 2.6 },
        { key: 'cant', title: 'Unidades', width: 1, align: 'right' },
        { key: 'vendido', title: 'Vendió', width: 1.3, align: 'right' },
        { key: 'costo', title: 'Costo', width: 1.2, align: 'right' },
        { key: 'ganancia', title: 'Ganancia', width: 1.3, align: 'right', bold: true },
      ],
      rows: r.porProducto.map(p => ({
        producto: p.name + (p.faltaCosto ? ' *' : ''),
        cant: String(Math.round(p.qty * 100) / 100),
        vendido: money(p.venta), costo: money(p.costo), ganancia: money(p.ganancia),
      })),
      maxRows: 30,
      moreLabel: `y ${plural(Math.max(0, r.porProducto.length - 30), 'producto más', 'productos más')} (están en la descarga a Excel)`,
      totalRow: {
        producto: 'TOTAL', vendido: money(R.vendido - R.recargoDigital),
        costo: money(R.costoVendido), ganancia: money(R.vendido - R.recargoDigital - R.costoVendido),
      },
    })
    if (faltanCostos) {
      sheet.p('* A este producto le falta el precio de costo en alguna de sus ventas. Ahí el costo se contó como cero, así que la ganancia que aparece es más alta de la que fue en realidad.', { size: 8, color: MUTED })
    }
    if (R.recargoDigital > 0) {
      sheet.p(`Además de los productos entraron ${money(R.recargoDigital)} en recargos por pago digital. Por eso no aparecen en esta tabla, pero sí en el total vendido.`, { size: 8, color: MUTED })
    }
  } else {
    sheet.empty('No se registraron ventas en este periodo')
  }

  // ── Quién atendió ─────────────────────────────────────────────────────────
  if (r.porCajera.length) {
    sheet.h2('Quién atendió', 'Ventas registradas por cada persona', { keep: 20 + r.porCajera.length * 6.2 })
    sheet.table({
      columns: [
        { key: 'nombre', title: 'Persona', width: 3 },
        { key: 'n', title: 'Ventas', width: 1, align: 'right' },
        { key: 'total', title: 'Vendió', width: 1.4, align: 'right', bold: true },
        { key: 'prom', title: 'Venta promedio', width: 1.4, align: 'right' },
      ],
      rows: r.porCajera.map(c => ({
        nombre: c.name, n: String(c.n), total: money(c.total),
        prom: money(c.n ? c.total / c.n : 0),
      })),
    })
  }

  // ── Gastos ────────────────────────────────────────────────────────────────
  sheet.h2('En qué se gastó', 'Gastos del periodo agrupados por categoría', { keep: 50 })
  if (r.gastosPorCat.length) {
    sheet.barsH({
      data: r.gastosPorCat.slice(0, 10).map(c => ({ label: c.label, value: c.total })),
      color: GASTOS,
      labelW: 55,
      footnote: `${plural(r.gastos.length, 'gasto registrado', 'gastos registrados')}, ${money(R.totalGastos)} en total.`,
    })
  } else {
    sheet.empty('No se registraron gastos en este periodo')
  }

  if (r.gastos.length || r.ingresos.length) {
    sheet.gap(2)
    sheet.h2('Detalle de gastos e ingresos', 'Uno por uno, en orden de fecha', { keep: 34 })
    const filas = [...r.gastos, ...r.ingresos]
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
      .map(m => ({
        fecha: fechaTabla(m.date),
        tipo: m.type === 'income' ? 'Ingreso' : 'Gasto',
        cat: m._catLabel || m.cat || '',
        nota: m.note || '',
        monto: money(m.amount),
        _tipo: m.type,
      }))
    sheet.table({
      columns: [
        { key: 'fecha', title: 'Fecha', width: 1.3 },
        { key: 'tipo', title: 'Tipo', width: 0.9, color: (row) => (row._tipo === 'income' ? VENTAS : GASTOS), bold: true },
        { key: 'cat', title: 'Categoría', width: 1.6 },
        { key: 'nota', title: 'Detalle', width: 2.5 },
        { key: 'monto', title: 'Monto', width: 1.3, align: 'right', bold: true },
      ],
      rows: filas,
      maxRows: 60,
      moreLabel: `y ${plural(Math.max(0, filas.length - 60), 'registro más', 'registros más')} (están en la descarga a Excel)`,
    })
  }

  // ── Caja ──────────────────────────────────────────────────────────────────
  sheet.h2('Cierres de caja', 'Cada turno cerrado dentro del periodo y cómo cuadró', { keep: 46 })
  if (r.turnos.length) {
    sheet.kpis([
      { label: 'Turnos cerrados', value: String(r.turnos.length) },
      { label: 'Faltó en caja', value: money(r.totalFaltante), color: r.totalFaltante > 0 ? BAD : INK, note: plural(r.faltantes.length, 'turno', 'turnos') },
      { label: 'Sobró en caja', value: money(r.totalSobrante), note: plural(r.sobrantes.length, 'turno', 'turnos') },
    ], { cols: 3 })
    sheet.gap(2)
    sheet.table({
      columns: [
        { key: 'fecha', title: 'Cerró', width: 1.6 },
        { key: 'cajera', title: 'Cajera', width: 2 },
        { key: 'base', title: 'Base', width: 1.1, align: 'right' },
        { key: 'esperado', title: 'Debía haber', width: 1.3, align: 'right' },
        { key: 'contado', title: 'Se contó', width: 1.3, align: 'right' },
        { key: 'dif', title: 'Diferencia', width: 1.3, align: 'right', bold: true,
          color: (row) => (row._dif < 0 ? BAD : row._dif > 0 ? WARN : INK) },
      ],
      rows: r.turnos.map(t => ({
        fecha: `${fechaTabla(bogotaDate(t._closed))} ${bogotaTime(t._closed)}`,
        cajera: t.cashierName || 'Sin registrar',
        base: money(t.openingFloat),
        esperado: money(t.expectedCash),
        contado: money(t.declaredClosingCash),
        dif: money(t.difference),
        _dif: Number(t.difference) || 0,
      })),
    })
    sheet.p('"Debía haber" es lo que el sistema calcula que tenía que estar en la caja al cerrar. "Se contó" es la plata física que se contó. Una diferencia en negativo es plata que faltó.', { size: 8, color: MUTED })
  } else {
    sheet.empty('No se cerró ningún turno de caja dentro del periodo')
  }

  // ── Fiados ────────────────────────────────────────────────────────────────
  sheet.h2('Fiados', 'Lo que se fió y lo que abonaron en el periodo', { keep: 30 })
  const conDeuda = r.deudores.filter(d => d.saldo > 0).length
  sheet.kpis([
    { label: 'Se fió en el periodo', value: money(r.fiadoNuevo), accent: CAT[3] },
    { label: 'Abonaron en el periodo', value: money(r.fiadoAbonos), accent: VENTAS },
    { label: 'Deuda pendiente hoy', value: money(r.totalPorCobrar), note: plural(conDeuda, 'cliente', 'clientes') },
  ], { cols: 3 })
  if (r.deudores.length) {
    sheet.gap(2)
    sheet.table({
      columns: [
        { key: 'cliente', title: 'Cliente', width: 3 },
        { key: 'saldo', title: 'Debe hoy', width: 1.4, align: 'right', bold: true,
          color: (row) => (row._saldo < 0 ? VENTAS : INK) },
      ],
      rows: r.deudores.map(d => ({
        cliente: d.name,
        saldo: d.saldo < 0 ? `${money(-d.saldo)} a favor` : money(d.saldo),
        _saldo: d.saldo,
      })),
      maxRows: 25,
      moreLabel: `y ${plural(Math.max(0, r.deudores.length - 25), 'cliente más', 'clientes más')}`,
    })
  }

  // ── Inventario ────────────────────────────────────────────────────────────
  sheet.h2('Inventario', 'Lo que hay hoy en la sede y lo que se movió en el periodo', { keep: 30 })
  sheet.kpis([
    { label: 'Valor de lo que hay hoy', value: money(r.valorInventario), note: 'valorado al costo' },
    { label: 'Entró en el periodo', value: `${Math.round(r.entradas * 100) / 100} und.`, accent: VENTAS },
    { label: 'Salió en el periodo', value: `${Math.round(r.salidas * 100) / 100} und.`, accent: GASTOS },
  ], { cols: 3 })
  if (r.existencias.length) {
    sheet.gap(2)
    sheet.table({
      columns: [
        { key: 'producto', title: 'Producto', width: 3 },
        { key: 'cant', title: 'Cantidad', width: 1.2, align: 'right' },
        { key: 'valor', title: 'Valor al costo', width: 1.5, align: 'right', bold: true },
      ],
      rows: r.existencias.map(x => ({
        producto: x.name, cant: String(Math.round(x.qty * 100) / 100), valor: money(x.valor),
      })),
      maxRows: 25,
      totalRow: { producto: 'TOTAL', valor: money(r.valorInventario) },
    })
  } else {
    sheet.empty('No hay existencias registradas en esta sede')
  }

  if (r.invEnRango.length) {
    sheet.h2('Movimientos de inventario', 'Entradas, salidas y ajustes del periodo', { keep: 34 })
    sheet.table({
      columns: [
        { key: 'fecha', title: 'Fecha', width: 1.3 },
        { key: 'tipo', title: 'Tipo', width: 1 },
        { key: 'producto', title: 'Producto', width: 2.5 },
        { key: 'cant', title: 'Cantidad', width: 1.1, align: 'right', bold: true },
        { key: 'quien', title: 'Registró', width: 1.6 },
      ],
      rows: r.invEnRango.map(m => ({
        fecha: fechaTabla(m.date),
        tipo: m.type === 'entrada' ? 'Entrada' : m.type === 'salida' ? 'Salida' : 'Ajuste',
        producto: m.productName || '',
        cant: (Number(m.delta) > 0 ? '+' : '') + (Math.round((Number(m.delta) || 0) * 100) / 100),
        quien: m.createdByName || '',
      })),
      maxRows: 40,
      moreLabel: `y ${plural(Math.max(0, r.invEnRango.length - 40), 'movimiento más', 'movimientos más')}`,
    })
  }

  // ── Detalle de ventas ─────────────────────────────────────────────────────
  sheet.newPage()
  sheet.h2('Todas las ventas', 'El detalle completo, por si hay que verificar alguna', { keep: 34 })
  const ventasOrdenadas = [...r.ventas].sort((a, b) => ordenDe(a) - ordenDe(b))
  sheet.table({
    columns: [
      { key: 'fecha', title: 'Fecha', width: 1.2 },
      { key: 'hora', title: 'Hora', width: 0.8 },
      { key: 'cod', title: 'Código', width: 1 },
      { key: 'cajera', title: 'Atendió', width: 1.6 },
      { key: 'items', title: 'Productos', width: 2.3 },
      { key: 'pago', title: 'Pago', width: 1.5 },
      { key: 'total', title: 'Total', width: 1.2, align: 'right', bold: true },
    ],
    rows: ventasOrdenadas.map(v => {
      const ts = tsOf(v)
      const items = (v.items || []).map(i => `${Math.round((Number(i.qty) || 0) * 100) / 100}x ${i.name || ''}`).join(', ')
      return {
        fecha: fechaTabla(ts != null ? bogotaDate(ts) : v.date),
        hora: ts != null ? bogotaTime(ts) : 's/h',
        cod: String(v.id || '').slice(0, 6).toUpperCase(),
        cajera: v.cashierName || '',
        items: items || '(sin detalle)',
        pago: metodoDeVenta(v),
        total: money(v.total),
      }
    }),
    maxRows: 120,
    moreLabel: `y ${plural(Math.max(0, ventasOrdenadas.length - 120), 'venta más', 'ventas más')} (están completas en la descarga a Excel)`,
    totalRow: { fecha: 'TOTAL', items: plural(r.ventas.length, 'venta', 'ventas'), total: money(R.vendido) },
  })
  if (ventasOrdenadas.some(v => tsOf(v) == null)) {
    sheet.p('"s/h" en la columna de hora quiere decir que esa venta se registró sin conexión y no guardó la hora exacta.', { size: 8, color: MUTED })
  }

  if (r.ventasAnuladas.length) {
    sheet.h2('Ventas anuladas', 'No se suman en ninguna cifra del informe; quedan aquí como rastro', { keep: 30 })
    sheet.table({
      columns: [
        { key: 'fecha', title: 'Fecha', width: 1.3 },
        { key: 'cod', title: 'Código', width: 1 },
        { key: 'cajera', title: 'Atendió', width: 2 },
        { key: 'total', title: 'Era por', width: 1.3, align: 'right' },
      ],
      rows: r.ventasAnuladas.map(v => ({
        fecha: fechaTabla(v.date), cod: String(v.id || '').slice(0, 6).toUpperCase(),
        cajera: v.cashierName || '', total: money(v.total),
      })),
      maxRows: 30,
    })
  }

  // ── Nota de método ────────────────────────────────────────────────────────
  sheet.h2('Cómo se hizo este reporte', 'Para que cualquiera pueda verificarlo', { keep: 40 })
  sheet.p(`Se tomó todo lo registrado en la aplicación para ${branchName} entre el ${desdeTxt} y el ${hastaTxt}, hora de Colombia. Nada de otra sede entra en estas cifras.`, { size: 8.5 })
  sheet.p('El corte del primer día es por HORA, no por fecha: lo vendido antes de la hora de corte no aparece aquí. Cada venta se ubica con la hora en que quedó registrada en el servidor.', { size: 8.5 })
  sheet.p('La ganancia sale del precio de costo que tenía cada producto EL DÍA de la venta. Si después sube el precio del proveedor, lo que ya se vendió no cambia de ganancia. Los productos sin costo cargado cuentan como si costaran cero y por eso inflan la ganancia; el aviso del comienzo dice cuántas ventas están así.', { size: 8.5 })
  sheet.p('Lo vendido fiado está contado dentro de las ventas aunque esa plata todavía no haya entrado. El apartado de Fiados muestra cuánto está pendiente de cobro.', { size: 8.5 })
  sheet.p('Este informe solo puede mostrar lo que se registró en la aplicación. Una venta que no se marcó, o un gasto que no se anotó, no aparece aquí.', { size: 8.5 })

  return sheet
}

/** Todo junto: leer, calcular, armar y descargar. */
export async function downloadHandoverReport({
  branchId, branchName, fromDate, fromTime, toDate, products, catLabel, generadoPor,
}) {
  const startMs = bogotaMoment(fromDate, fromTime).getTime()
  const endMs = Date.now()
  const raw = await fetchBranchActivity({ branchId, fromDate, toDate })
  const r = buildReport({ raw, startMs, endMs, fromDate, toDate, products, catLabel })
  // La categoría se resuelve aquí y no en la tabla: el detalle mezcla gastos e
  // ingresos, y cada uno busca su etiqueta en una lista distinta.
  r.gastos.forEach(m => { m._catLabel = catLabel(m.cat) })
  r.ingresos.forEach(m => { m._catLabel = catLabel(m.cat) })
  const sheet = renderHandoverPdf(r, { branchName, fromDate, fromTime, toDate, generadoPor })
  const slug = String(branchName).toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  sheet.save(`reporte-${slug}-${fromDate}-a-${toDate}.pdf`)
  return r
}

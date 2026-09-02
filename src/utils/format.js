export function fmtCOP(n, { sign = false, compact = false } = {}) {
  const abs = Math.abs(Math.round(n || 0))
  let str
  if (compact && abs >= 1_000_000) {
    str = '$ ' + (abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1).replace('.', ',') + 'M'
  } else if (compact && abs >= 1_000) {
    str = '$ ' + Math.round(abs / 1_000) + 'k'
  } else {
    str = '$ ' + abs.toLocaleString('es-CO')
  }
  if (sign) return (n < 0 ? '− ' : '+ ') + str.replace('$ ', '')
  return (n < 0 ? '−' : '') + str
}

export function fmtDate(d, { weekday = false } = {}) {
  const dt = typeof d === 'string' ? new Date(d + 'T00:00:00') : d
  const months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
  const days = ['dom','lun','mar','mié','jue','vie','sáb']
  if (weekday) return `${days[dt.getDay()]} ${dt.getDate()} ${months[dt.getMonth()]}`
  return `${dt.getDate()} ${months[dt.getMonth()]}`
}

export function fmtMonthLabel(ym) {
  const [y, m] = ym.split('-').map(Number)
  const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
  return `${months[m - 1]} ${y}`
}

// Fecha de HOY en zona Bogotá (YYYY-MM-DD).
//
// Antes usaba `toISOString()`, que devuelve UTC: como Colombia es UTC-5, entre
// las 7:00 p.m. y la medianoche daba la fecha del DIA SIGUIENTE. Eso sellaba
// con fecha equivocada los movimientos creados de noche (AddMovement) y movía
// el corte de mes en los reportes. Las ventas siempre se guardaron con hora de
// Bogotá, así que aquel desfase también las descuadraba contra los gastos.
export function todayStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
}

/** Mes actual (YYYY-MM) en zona Bogotá. Mismo motivo que `todayStr`. */
export function currentMonth() {
  return todayStr().slice(0, 7)
}

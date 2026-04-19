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

export function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

export function currentMonth() {
  return new Date().toISOString().slice(0, 7)
}

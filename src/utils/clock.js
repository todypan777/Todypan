// ─────────────────────────────────────────────────────────────────────────────
// RELOJ CONFIABLE
//
// La fecha de cada venta, abono y movimiento sale del reloj del equipo. El PC
// de caja de una panaderia tenia la pila interna agotada: su reloj se detenia
// cada vez que lo apagaban y seguia desde ahi al prenderlo, asi que avanzaba a
// la mitad de la velocidad real. En noviembre marcaba 20 de octubre, y miles
// de ventas quedaron anotadas en el dia equivocado — Transferencias, Ventas y
// Reportes mostraban $0 en los dias reales.
//
// Aqui se mide la diferencia entre el reloj del equipo y la hora del servidor
// (la cabecera `Date` de cualquier respuesta de Vercel) y toda la app pide la
// hora a este modulo. Sin red se usa la ultima diferencia medida, guardada en
// el navegador; si nunca se pudo medir, se confia en el equipo como antes.
// ─────────────────────────────────────────────────────────────────────────────

const LS_KEY = 'todypan_clock_offset'
const RESYNC_MS = 15 * 60 * 1000
// Por debajo de esto no vale la pena avisar: la cabecera Date tiene precision
// de un segundo y la red agrega su propio retraso.
const SKEW_WARN_MS = 5 * 60 * 1000

let _offset = readStored()
const _listeners = new Set()

function readStored() {
  try {
    const n = Number(localStorage.getItem(LS_KEY))
    return Number.isFinite(n) ? n : 0
  } catch { return 0 }
}

/** Milisegundos actuales corregidos con la hora del servidor. */
export function nowMs() {
  return Date.now() + _offset
}

/** Fecha de HOY en zona Bogota (YYYY-MM-DD), con la hora corregida. */
export function bogotaTodayStr() {
  return new Date(nowMs()).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
}

/** Diferencia actual (servidor − equipo) en ms. Positivo = el equipo va atrasado. */
export function clockOffsetMs() {
  return _offset
}

/** True si el reloj del equipo esta lo bastante mal como para avisarle a quien lo usa. */
export function clockIsWrong() {
  return Math.abs(_offset) > SKEW_WARN_MS
}

/** Avisa cada vez que cambia la diferencia medida. Devuelve la funcion para desuscribirse. */
export function onClockChange(fn) {
  _listeners.add(fn)
  return () => _listeners.delete(fn)
}

/**
 * Mide la diferencia contra el servidor. El parametro unico evita que el
 * service worker o la cache del navegador respondan con una cabecera vieja.
 */
export async function syncClock() {
  try {
    const t0 = Date.now()
    const res = await fetch(`/__clock?t=${t0}`, { method: 'HEAD', cache: 'no-store' })
    const t1 = Date.now()
    const server = Date.parse(res.headers.get('date') || '')
    if (!Number.isFinite(server)) return
    // La cabecera trunca al segundo: se le suma medio para centrar el error.
    const next = Math.round(server + 500 - (t0 + t1) / 2)
    _offset = Math.abs(next) < 2000 ? 0 : next
    try { localStorage.setItem(LS_KEY, String(_offset)) } catch {}
    _listeners.forEach(fn => { try { fn(_offset) } catch {} })
  } catch {
    // Sin red: se conserva la ultima diferencia conocida.
  }
}

/** Sincroniza al arrancar, cada 15 min, al volver la red y al volver a la app. */
export function startClockSync() {
  syncClock()
  const id = setInterval(syncClock, RESYNC_MS)
  const onVisible = () => { if (document.visibilityState === 'visible') syncClock() }
  window.addEventListener('online', syncClock)
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    clearInterval(id)
    window.removeEventListener('online', syncClock)
    document.removeEventListener('visibilitychange', onVisible)
  }
}

// Persistencia y salud del almacenamiento del dispositivo.
//
// El offline de la app vive en IndexedDB (caché de Firestore + cola de
// escrituras sin subir). En celulares con poco espacio, el navegador puede
// PURGAR esa IndexedDB → se pierden ventas/gastos/mesas encolados. Aquí:
//   - requestPersistentStorage(): pide al SO que NO borre el almacenamiento.
//   - getStorageHealth() / useStorageHealth(): detecta si el celular está en
//     riesgo (persistencia denegada o espacio casi lleno) para avisarle a la cajera.
//   - notify/onLocalWriteFailure(): canal para avisar cuando una escritura NO
//     quedó guardada localmente (ej. IndexedDB sin espacio).

import { useEffect, useState } from 'react'

/**
 * Pide almacenamiento persistente. En PWA instalada Chrome lo concede sin
 * preguntar; se puede reintentar tras 'engagement' (ej. confirmar turno) porque
 * Chrome lo concede más fácil cuando hay uso real. Idempotente y silencioso.
 */
export async function requestPersistentStorage() {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return null
    if (await navigator.storage.persisted?.()) return true
    const granted = await navigator.storage.persist()
    console.log('[storage] persistente:', granted ? 'concedido' : 'no concedido')
    return granted
  } catch (e) {
    console.warn('[storage] persist no disponible:', e?.message)
    return null
  }
}

/**
 * Lee la salud del almacenamiento.
 *   atRisk = persistencia denegada (el SO puede purgar) O caché casi al límite.
 */
export async function getStorageHealth() {
  const out = {
    supported: false, persisted: null,
    usage: 0, quota: 0, freeRatio: 1, lowSpace: false, atRisk: false,
  }
  try {
    if (typeof navigator === 'undefined' || !navigator.storage) return out
    out.supported = true
    if (navigator.storage.persisted) out.persisted = await navigator.storage.persisted()
    if (navigator.storage.estimate) {
      const est = await navigator.storage.estimate()
      out.usage = est.usage || 0
      out.quota = est.quota || 0
      if (out.quota > 0) out.freeRatio = Math.max(0, 1 - out.usage / out.quota)
      // Riesgo de espacio: queda menos del 8% del cupo libre.
      out.lowSpace = out.quota > 0 && out.freeRatio < 0.08
    }
    out.atRisk = out.persisted === false || out.lowSpace
  } catch (e) {
    console.warn('[storage] getStorageHealth:', e?.message)
  }
  return out
}

/** Hook: evalúa la salud del almacenamiento al montar. null mientras carga. */
export function useStorageHealth() {
  const [health, setHealth] = useState(null)
  useEffect(() => {
    let alive = true
    getStorageHealth().then(h => { if (alive) setHealth(h) })
    return () => { alive = false }
  }, [])
  return health
}

// ── Canal de aviso: una escritura NO quedó guardada localmente ──
// Lo dispara firestoreOffline cuando detecta que un doc recién escrito no
// aparece en la caché (IndexedDB rechazó la escritura, típico sin espacio).
const WRITE_FAIL_EVENT = 'todypan-local-write-failed'

export function notifyLocalWriteFailure(path) {
  try {
    window.dispatchEvent(new CustomEvent(WRITE_FAIL_EVENT, { detail: { path } }))
  } catch {}
}

export function onLocalWriteFailure(handler) {
  const fn = (e) => handler(e?.detail || {})
  window.addEventListener(WRITE_FAIL_EVENT, fn)
  return () => window.removeEventListener(WRITE_FAIL_EVENT, fn)
}

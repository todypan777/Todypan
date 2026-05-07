// Utilidades de red, sincronizacion y reloj para modo offline.
//
// La app funciona offline porque Firestore tiene IndexedDB persistence
// (configurado en firebase.js). Aqui exponemos:
//  - useOnlineStatus(): hook que dice si hay red o no
//  - usePendingWrites(): hook que dice si hay escrituras encoladas sin subir
//  - getClientTimestamp(): timestamp local (con punto de extension futuro)
//  - flushPendingWrites(): espera a que Firestore vuelque la cola
//  - reconnectFirestore(): forzar reconexion (util si la app parece colgada)

import { useEffect, useState } from 'react'
import {
  waitForPendingWrites,
  disableNetwork,
  enableNetwork,
} from 'firebase/firestore'
import { firestoreDb } from '../firebase'

/**
 * Timestamp local. Hoy retorna Date.now(); existe como helper porque a
 * futuro podemos corregir la deriva del reloj del celular si detectamos
 * que esta mal puesto. Por ahora confiamos en el reloj del dispositivo
 * para timestamps de UI inmediata; el server siempre tiene el ultimo
 * canto via serverTimestamp() para auditoria.
 */
export function getClientTimestamp() {
  return Date.now()
}

/**
 * Hook: true cuando el navegador reporta red.
 * navigator.onLine puede dar falsos positivos (dice true pero no hay
 * internet real); para detectar "Firestore puede sincronizar" combinar
 * con usePendingWrites.
 */
export function useOnlineStatus() {
  const [online, setOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  )

  useEffect(() => {
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  return online
}

/**
 * Hook: true si Firestore tiene escrituras pendientes de subir.
 * Se basa en waitForPendingWrites: si resuelve inmediato no hay cola;
 * si tarda mas que `graceMs` asumimos que hay cola.
 *
 * Refresca cada `intervalMs`. Suficiente para la UI; no es estricto.
 */
export function usePendingWrites({ intervalMs = 2000, graceMs = 80 } = {}) {
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let alive = true
    let timer = null

    async function tick() {
      if (!alive) return
      let resolved = false
      const p = waitForPendingWrites(firestoreDb)
        .then(() => { resolved = true })
        .catch(() => { resolved = true })
      await Promise.race([p, new Promise(r => setTimeout(r, graceMs))])
      if (!alive) return
      setPending(!resolved)
      timer = setTimeout(tick, intervalMs)
    }
    tick()

    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [intervalMs, graceMs])

  return pending
}

/** Forzar a Firestore que vuelque la cola ahora (util tras reconectar). */
export async function flushPendingWrites() {
  try {
    await waitForPendingWrites(firestoreDb)
  } catch (e) {
    console.debug('[network] flushPendingWrites:', e?.message)
  }
}

/** Forzar reconexion (util si el usuario sospecha que la app esta colgada). */
export async function reconnectFirestore() {
  try {
    await disableNetwork(firestoreDb)
    await enableNetwork(firestoreDb)
  } catch (e) {
    console.debug('[network] reconnectFirestore:', e?.message)
  }
}

// ─── Modo Ahorro de Datos ──────────────────────────────────────────────
//
// La cajera puede activar un "modo ahorro" para no consumir datos móviles
// durante el turno. Mientras esté activo, llamamos disableNetwork(firestoreDb)
// para que Firestore NO haga ningún request al servidor — todo se sirve
// desde el caché local (persistentLocalCache) y las escrituras quedan
// encoladas. Al desactivarlo (o tocar "Sincronizar ahora") llamamos
// enableNetwork() y todo lo encolado se sube de una.
//
// El estado se persiste en localStorage para que sobreviva recargas de la app.

const DATA_SAVER_KEY = 'todypan_data_saver_v1'

export function isDataSaverEnabled() {
  try { return localStorage.getItem(DATA_SAVER_KEY) === 'on' } catch { return false }
}

function writeDataSaverFlag(on) {
  try {
    if (on) localStorage.setItem(DATA_SAVER_KEY, 'on')
    else localStorage.removeItem(DATA_SAVER_KEY)
  } catch {}
}

/** Activar modo ahorro: desconectar Firestore del servidor. */
export async function enableDataSaver() {
  writeDataSaverFlag(true)
  try {
    await disableNetwork(firestoreDb)
  } catch (e) {
    console.warn('[network] enableDataSaver:', e?.message)
  }
}

/** Desactivar modo ahorro: reconectar Firestore (sube todo lo encolado). */
export async function disableDataSaver() {
  writeDataSaverFlag(false)
  try {
    await enableNetwork(firestoreDb)
  } catch (e) {
    console.warn('[network] disableDataSaver:', e?.message)
  }
}

/**
 * Sincronizar ahora SIN apagar el modo ahorro: enableNetwork → esperar a
 * que se vuelque la cola → disableNetwork de nuevo. La cajera ve "Listo"
 * y queda otra vez en modo ahorro (no quema datos en el resto del turno).
 *
 * Devuelve { ok: true } o { ok: false, error } para que la UI muestre
 * un mensaje claro.
 */
export async function syncNowKeepingDataSaver() {
  try {
    await enableNetwork(firestoreDb)
    await waitForPendingWrites(firestoreDb)
    await disableNetwork(firestoreDb)
    return { ok: true }
  } catch (e) {
    console.error('[network] syncNowKeepingDataSaver:', e)
    // Reintenta dejar el ahorro activo aunque haya fallado el flush
    try { await disableNetwork(firestoreDb) } catch {}
    return { ok: false, error: e?.message || 'Error al sincronizar' }
  }
}

/**
 * Hook: estado reactivo de modo ahorro. Devuelve `enabled` y el setter.
 * Sincroniza con localStorage entre componentes mediante un evento custom.
 */
const DATA_SAVER_EVENT = 'todypan-data-saver-changed'

export function useDataSaver() {
  const [enabled, setEnabled] = useState(isDataSaverEnabled())

  useEffect(() => {
    const onChange = () => setEnabled(isDataSaverEnabled())
    window.addEventListener(DATA_SAVER_EVENT, onChange)
    window.addEventListener('storage', onChange) /* otra pestaña / DevTools */
    return () => {
      window.removeEventListener(DATA_SAVER_EVENT, onChange)
      window.removeEventListener('storage', onChange)
    }
  }, [])

  async function turnOn() {
    await enableDataSaver()
    window.dispatchEvent(new Event(DATA_SAVER_EVENT))
  }
  async function turnOff() {
    await disableDataSaver()
    window.dispatchEvent(new Event(DATA_SAVER_EVENT))
  }
  async function syncNow() {
    const result = await syncNowKeepingDataSaver()
    return result
  }

  return { enabled, turnOn, turnOff, syncNow }
}

/**
 * Aplica el estado persistido del modo ahorro al arrancar la app. Llamar UNA
 * vez tras inicializar Firestore. Si la cajera dejó "modo ahorro" activado y
 * recargó la app, esto vuelve a desconectar Firestore para que no consuma
 * datos en el primer arranque.
 */
export async function applyDataSaverOnBoot() {
  if (!isDataSaverEnabled()) return
  try {
    await disableNetwork(firestoreDb)
  } catch (e) {
    console.debug('[network] applyDataSaverOnBoot:', e?.message)
  }
}

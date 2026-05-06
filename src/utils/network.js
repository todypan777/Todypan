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

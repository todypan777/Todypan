import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App.jsx'
import { startPhotoQueueWorker } from './utils/photoQueue'

// ── Kill switch one-shot ──
// Los celulares con SW viejo (sin skipWaiting) quedaban atascados sirviendo
// bundle antiguo. Esta limpieza se ejecuta UNA vez por dispositivo: desregistra
// SWs antiguos, vacia caches y recarga limpio. Despues no vuelve a correr.
const SW_CLEANUP_KEY = 'sw_cleanup_v3'
async function cleanupOldServiceWorkers() {
  if (typeof window === 'undefined') return
  if (localStorage.getItem(SW_CLEANUP_KEY)) return
  if (!('serviceWorker' in navigator)) {
    localStorage.setItem(SW_CLEANUP_KEY, '1')
    return
  }
  try {
    const regs = await navigator.serviceWorker.getRegistrations()
    if (regs.length > 0) {
      await Promise.all(regs.map(r => r.unregister()))
    }
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map(k => caches.delete(k)))
    }
    localStorage.setItem(SW_CLEANUP_KEY, '1')
    if (regs.length > 0) {
      window.location.reload()
      return
    }
  } catch (e) {
    console.warn('[sw cleanup]', e)
    localStorage.setItem(SW_CLEANUP_KEY, '1')
  }
}

cleanupOldServiceWorkers().then(() => {
  // Auto-actualiza el SW: si hay nueva version, recarga la pagina.
  registerSW({
    immediate: true,
    onNeedRefresh() {
      window.location.reload()
    },
  })
})

// Worker de cola de fotos offline: vacia la cola al volver la red.
startPhotoQueueWorker()

// Pedir storage persistente: en PWA instalada esto se concede sin
// preguntar y blinda IndexedDB ante limpiezas automaticas del SO cuando
// el almacenamiento del dispositivo se llena. Sin esto, la cola de
// ventas/fotos offline podria perderse en celulares con poco espacio.
async function requestPersistentStorage() {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      const already = await navigator.storage.persisted?.()
      if (!already) {
        const granted = await navigator.storage.persist()
        console.log('[storage] persistente:', granted ? 'concedido' : 'no concedido')
      }
    }
  } catch (e) {
    console.warn('[storage] no se pudo solicitar persistencia:', e?.message)
  }
}
requestPersistentStorage()

createRoot(document.getElementById('root')).render(<App />)

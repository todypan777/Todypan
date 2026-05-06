// Cola de fotos offline
//
// Las fotos de comprobantes (NEQUI/DAVIPLATA, gastos de caja) se suben a
// ImageBB. Cuando NO hay red o ImageBB falla, guardamos la foto comprimida
// en IndexedDB y un worker la sube cuando la red vuelve.
//
// Flujo:
//   1. enqueuePhoto(blob, { collection, docId }) -> guarda blob en IDB
//   2. La venta/gasto se crea con photoStatus: 'pending' + photoLocalId
//   3. Worker (intervalo + evento 'online') intenta subir cada item
//   4. Al subir: updateDoc del target con photoUrl y photoStatus='uploaded';
//      borra el item de IDB
//   5. Si falla MAX_ATTEMPTS veces: marca photoStatus='failed' en el doc
//      y saca el item de la cola activa
//
// IndexedDB schema:
//   db: 'todypan-offline'
//   store 'photos':
//     { id, blob, mimeType, target: { collection, docId },
//       attempts, lastError, createdAt, nextRetryAt }

import { useEffect, useState } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { firestoreDb } from '../firebase'
import { uploadToImageBB } from './imagebb'

const DB_NAME = 'todypan-offline'
const DB_VERSION = 1
const STORE = 'photos'

const MAX_ATTEMPTS = 8
const BACKOFF_MS = [2_000, 10_000, 30_000, 120_000, 300_000, 600_000, 1_800_000, 3_600_000]

// EventTarget interno para que la UI se entere de cambios sin polling agresivo
const bus = new EventTarget()
function emitChange() {
  bus.dispatchEvent(new Event('change'))
}

// ──────────────────────────────────────────────────────────────
// IndexedDB helpers
// ──────────────────────────────────────────────────────────────
let _dbPromise = null

function openDB() {
  if (_dbPromise) return _dbPromise
  _dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB no disponible'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return _dbPromise
}

async function tx(mode, fn) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const store = t.objectStore(STORE)
    let result
    Promise.resolve(fn(store))
      .then(r => { result = r })
      .catch(reject)
    t.oncomplete = () => resolve(result)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// ──────────────────────────────────────────────────────────────
// API pública
// ──────────────────────────────────────────────────────────────

/**
 * Genera un id local nuevo para una foto en cola.
 * Útil cuando queremos pasarle el id a `createSale`/`createCashExpense`
 * desde el principio (evita un updateDoc extra después).
 */
export function makePhotoLocalId() {
  return 'ph_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7)
}

/**
 * Encola un blob para subir a ImageBB.
 * `target` describe a qué doc de Firestore hay que escribirle el photoUrl
 * cuando el upload tenga éxito.
 *
 * Si pasas `providedId`, se usa ese id en lugar de generar uno nuevo
 * (útil si lo pre-generaste con makePhotoLocalId() para asociarlo al
 * doc en su creación).
 *
 * Devuelve el localId.
 */
export async function enqueuePhoto(blob, target, providedId) {
  if (!blob) throw new Error('Foto vacía')
  if (!target?.collection || !target?.docId) {
    throw new Error('Falta target { collection, docId }')
  }
  const id = providedId || makePhotoLocalId()
  const item = {
    id,
    blob,
    mimeType: blob.type || 'image/jpeg',
    target,
    attempts: 0,
    lastError: null,
    createdAt: Date.now(),
    nextRetryAt: Date.now(),
  }
  await tx('readwrite', store => reqToPromise(store.put(item)))
  emitChange()
  // Disparar worker en background — sin esperar
  scheduleTick(0)
  return id
}

/** Retorna metadata de los items en cola (sin el blob, para no llenar memoria). */
export async function listPendingPhotos() {
  const items = await tx('readonly', store => reqToPromise(store.getAll()))
  // Descartamos blob para no inflar memoria (puede ser MB por foto).
  return (items || []).map(item => {
    const meta = { ...item }
    delete meta.blob
    return meta
  })
}

/** Lee el blob de una foto encolada (para preview en UI). */
export async function getPhotoBlob(localId) {
  const item = await tx('readonly', store => reqToPromise(store.get(localId)))
  return item?.blob || null
}

/** Borra explicitamente una foto de la cola (ej: la venta fue cancelada). */
export async function removeFromQueue(localId) {
  await tx('readwrite', store => reqToPromise(store.delete(localId)))
  emitChange()
}

/** Cuenta items pendientes. Útil para mostrar en el chip. */
export async function getPendingCount() {
  return await tx('readonly', store => reqToPromise(store.count()))
}

/**
 * Hook: devuelve { count, items, refresh }.
 * Se actualiza cuando la cola cambia (eventos del bus interno) y cada
 * `intervalMs` como respaldo.
 */
export function usePendingPhotos({ intervalMs = 5000 } = {}) {
  const [state, setState] = useState({ count: 0, items: [] })

  useEffect(() => {
    let alive = true
    async function refresh() {
      try {
        const items = await listPendingPhotos()
        if (!alive) return
        setState({ count: items.length, items })
      } catch {
        if (!alive) return
        setState({ count: 0, items: [] })
      }
    }
    refresh()
    const onChange = () => refresh()
    bus.addEventListener('change', onChange)
    const timer = setInterval(refresh, intervalMs)
    return () => {
      alive = false
      bus.removeEventListener('change', onChange)
      clearInterval(timer)
    }
  }, [intervalMs])

  return state
}

/**
 * Fuerza un intento de vaciar la cola ahora. Útil al reconectar manualmente.
 */
export function flushQueueNow() {
  scheduleTick(0)
}

// ──────────────────────────────────────────────────────────────
// Worker
// ──────────────────────────────────────────────────────────────
let _workerStarted = false
let _tickTimer = null
let _runningTick = false

/**
 * Arranca el worker. Llamar UNA VEZ al inicio de la app (en main.jsx
 * o App.jsx). Idempotente.
 */
export function startPhotoQueueWorker() {
  if (_workerStarted) return
  _workerStarted = true
  // Tick inicial
  scheduleTick(500)
  // Re-intentar cuando vuelve la red
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => scheduleTick(0))
  }
}

function scheduleTick(delayMs) {
  if (_tickTimer) {
    clearTimeout(_tickTimer)
    _tickTimer = null
  }
  _tickTimer = setTimeout(runTick, delayMs)
}

async function runTick() {
  _tickTimer = null
  if (_runningTick) return
  _runningTick = true
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      // Sin red: programar reintento en 30s
      scheduleTick(30_000)
      return
    }
    const items = await tx('readonly', store => reqToPromise(store.getAll()))
    const now = Date.now()
    const ready = (items || []).filter(it => (it.nextRetryAt || 0) <= now)
    if (ready.length === 0) {
      // Calcular cuándo despertar de nuevo
      const next = (items || [])
        .map(it => it.nextRetryAt || 0)
        .filter(t => t > now)
        .sort((a, b) => a - b)[0]
      if (next) scheduleTick(Math.max(1000, next - now))
      else scheduleTick(60_000) // idle
      return
    }
    for (const item of ready) {
      await processOne(item)
    }
    // Vuelve a evaluar si quedan más
    scheduleTick(500)
  } catch (e) {
    console.warn('[photoQueue] tick error:', e)
    scheduleTick(30_000)
  } finally {
    _runningTick = false
  }
}

async function processOne(item) {
  try {
    // Si ya subimos la foto pero el updateDoc fallo en una vuelta anterior,
    // no resubir — solo reintentar el link.
    let url = item.uploadedUrl
    if (!url) {
      const result = await uploadToImageBB(item.blob)
      url = result.url
    }
    // Éxito: actualizar el doc destino
    try {
      await updateDoc(doc(firestoreDb, item.target.collection, item.target.docId), {
        photoUrl: url,
        photoStatus: 'uploaded',
        photoUploadedAt: Date.now(),
      })
    } catch (e) {
      // El doc puede no existir aún (escritura offline encolada en Firestore).
      // Firestore reintentará automáticamente la actualización; pero la foto
      // ya se subió a ImageBB. Para no resubirla, guardamos la URL en el item
      // con status 'uploaded_pending_link' y reintentamos el updateDoc luego.
      console.warn('[photoQueue] upload OK pero updateDoc falló, reintentando:', e?.message)
      const updated = {
        ...item,
        attempts: (item.attempts || 0) + 1,
        lastError: 'updateDoc: ' + (e?.message || 'unknown'),
        nextRetryAt: Date.now() + 5000,
        uploadedUrl: url, // próxima vuelta salta el upload, solo intenta el link
      }
      await tx('readwrite', store => reqToPromise(store.put(updated)))
      emitChange()
      return
    }
    await tx('readwrite', store => reqToPromise(store.delete(item.id)))
    emitChange()
  } catch (e) {
    const attempts = (item.attempts || 0) + 1
    if (attempts >= MAX_ATTEMPTS) {
      // Rendirse: marcar el doc como photoStatus='failed' y sacar de la cola.
      try {
        await updateDoc(doc(firestoreDb, item.target.collection, item.target.docId), {
          photoStatus: 'failed',
          photoFailedAt: Date.now(),
          photoFailedReason: e?.message || 'Upload falló tras múltiples intentos',
        })
      } catch (e2) {
        console.warn('[photoQueue] no se pudo marcar el doc como failed:', e2?.message)
      }
      await tx('readwrite', store => reqToPromise(store.delete(item.id)))
      emitChange()
      return
    }
    const backoff = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]
    const updated = {
      ...item,
      attempts,
      lastError: e?.message || 'unknown',
      nextRetryAt: Date.now() + backoff,
    }
    await tx('readwrite', store => reqToPromise(store.put(updated)))
    emitChange()
  }
}

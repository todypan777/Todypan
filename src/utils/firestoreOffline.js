import { doc, setDoc, getDocFromCache } from 'firebase/firestore'
import { notifyLocalWriteFailure } from './storage'

/**
 * Variante de `addDoc` que NO espera la respuesta del servidor.
 *
 * Problema que resuelve:
 *   En modo offline / modo ahorro de datos (`disableNetwork`), Firestore
 *   encola las escrituras en IndexedDB pero la promesa de `addDoc` con
 *   `await` se queda colgada hasta que la red vuelva. Eso bloquea el botón
 *   "Confirmar venta" de la cajera y deja la app aparentemente buggeada.
 *
 * Comportamiento:
 *   - Genera el ID localmente con `doc(colRef)` (instantáneo).
 *   - Dispara `setDoc(ref, data)` SIN `await` — se encola y resuelve cuando
 *     haya red. Si la escritura falla (regla, schema), se loguea pero NO
 *     bloquea al usuario.
 *   - Verifica que el doc SÍ haya quedado en la caché local (IndexedDB). En
 *     celulares sin espacio, IndexedDB puede rechazar la escritura → el doc
 *     nunca aparece (ej. "no se crea la burbuja") y al recargar se pierde.
 *     Si no quedó en caché, avisa por notifyLocalWriteFailure para que la UI
 *     le muestre a la cajera que algo no se guardó.
 *   - Retorna el `DocumentReference` con `id` y `path`, igual que `addDoc`.
 */
export function addDocOffline(colRef, data) {
  const ref = doc(colRef)
  // Fire-and-forget: la cola offline de Firestore lo persiste en IndexedDB
  // y lo subirá cuando vuelva la red.
  setDoc(ref, data).catch(err => {
    console.warn('[firestoreOffline] addDoc deferred:', err?.message || err)
  })
  verifyLocalWrite(ref)
  return ref
}

/**
 * Confirma que la escritura local quedó en la caché. La mutación local se
 * aplica casi al instante incluso offline; si tras dos intentos el doc no
 * está en caché, IndexedDB rechazó la escritura (típico: sin espacio).
 */
async function verifyLocalWrite(ref) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await new Promise(r => setTimeout(r, 600))
    try {
      await getDocFromCache(ref)
      return // quedó en caché → todo bien
    } catch {
      // sigue al próximo intento
    }
  }
  console.error('[firestoreOffline] la escritura NO quedó en caché local:', ref.path)
  notifyLocalWriteFailure(ref.path)
}

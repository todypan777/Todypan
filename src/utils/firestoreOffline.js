import { doc, setDoc } from 'firebase/firestore'

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
 *   - Retorna el `DocumentReference` con `id` y `path`, igual que `addDoc`.
 *
 * Trade-off:
 *   El caller asume que la escritura tendrá éxito eventualmente. Si falla
 *   por una regla, la cajera no se entera. Esto es aceptable para escrituras
 *   transaccionales (venta, pedido, gasto) donde la intención del usuario ya
 *   se cumplió en su mente y los datos se consolidan offline-first.
 */
export function addDocOffline(colRef, data) {
  const ref = doc(colRef)
  // Fire-and-forget: la cola offline de Firestore lo persiste en IndexedDB
  // y lo subirá cuando vuelva la red.
  setDoc(ref, data).catch(err => {
    console.warn('[firestoreOffline] addDoc deferred:', err?.message || err)
  })
  return ref
}

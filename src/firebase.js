import { initializeApp } from 'firebase/app'
import {
  initializeFirestore,
  persistentLocalCache,
  getFirestore,
} from 'firebase/firestore'
import {
  getAuth,
  GoogleAuthProvider,
  setPersistence,
  browserLocalPersistence,
} from 'firebase/auth'

const firebaseConfig = {
  apiKey: "AIzaSyCQxi5ZWQYcpfdFX0db7UNeDRX-Oht8gEQ",
  authDomain: "todypan-47059.firebaseapp.com",
  projectId: "todypan-47059",
  storageBucket: "todypan-47059.firebasestorage.app",
  messagingSenderId: "1021735934495",
  appId: "1:1021735934495:web:87d89868cce8690a6b532a"
}

export const firebaseApp = initializeApp(firebaseConfig)

// Persistencia offline para Firestore. Antes usábamos persistentMultipleTabManager
// pero dejaba locks colgados cuando la cajera cerraba la PWA abruptamente, lo que
// trababa la siguiente apertura por minutos. Sin él, una pestaña a la vez (caso
// real de las cajeras), zero locks.
let _firestoreDb
try {
  _firestoreDb = initializeFirestore(firebaseApp, {
    localCache: persistentLocalCache(),
  })
} catch (e) {
  console.warn('[firebase] persistentLocalCache no disponible, usando memoria:', e?.message)
  _firestoreDb = getFirestore(firebaseApp)
}
export const firestoreDb = _firestoreDb

export const firebaseAuth = getAuth(firebaseApp)
export const googleProvider = new GoogleAuthProvider()
googleProvider.setCustomParameters({ prompt: 'select_account' })

// Persistencia de Auth en localStorage (browserLocalPersistence) en lugar de
// IndexedDB. Razones:
// - iOS Safari PWA borra IndexedDB tras 7 días sin uso → la cajera abre la app
//   un lunes y aparece deslogueada sin haber cerrado sesión. localStorage no
//   sufre esa purga.
// - Android Chrome purga IndexedDB antes que localStorage bajo presión de storage.
// - Es lo que usan Horión y (vía default) Mercado Negro, que NO tienen este bug.
setPersistence(firebaseAuth, browserLocalPersistence)
  .catch(err => console.warn('[firebase] No se pudo setear persistencia:', err?.message))

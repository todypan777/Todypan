import { initializeApp } from 'firebase/app'
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  getFirestore,
} from 'firebase/firestore'
import {
  getAuth,
  GoogleAuthProvider,
  setPersistence,
  browserLocalPersistence,
  indexedDBLocalPersistence,
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

// Persistencia offline: las lecturas siguen funcionando desde IndexedDB y las
// escrituras se encolan automaticamente y se reproducen al volver la red.
// persistentMultipleTabManager evita conflictos si la PWA esta abierta en
// varias pestañas (celular + desktop a la vez).
//
// Si IndexedDB no esta disponible (modo incognito Safari, navegador raro),
// caemos a getFirestore() en memoria — la app sigue funcionando online.
let _firestoreDb
try {
  _firestoreDb = initializeFirestore(firebaseApp, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
    }),
  })
} catch (e) {
  console.warn('[firebase] persistentLocalCache no disponible, usando memoria:', e?.message)
  _firestoreDb = getFirestore(firebaseApp)
}
export const firestoreDb = _firestoreDb

export const firebaseAuth = getAuth(firebaseApp)
export const googleProvider = new GoogleAuthProvider()
googleProvider.setCustomParameters({ prompt: 'select_account' })

// Persistencia explícita: en PWA standalone (Android Chrome / iOS Safari) el
// flujo de signInWithRedirect a veces deja la sesión en una pestaña distinta
// del navegador. Con persistencia en IndexedDB (con fallback a localStorage),
// cuando el usuario vuelve a abrir la PWA, Firebase encuentra la sesión y
// onAuthStateChanged dispara automáticamente.
setPersistence(firebaseAuth, indexedDBLocalPersistence)
  .catch(() => setPersistence(firebaseAuth, browserLocalPersistence))
  .catch(err => console.warn('[firebase] No se pudo setear persistencia:', err?.message))

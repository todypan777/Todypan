import { createContext, useContext, useEffect, useState, useRef } from 'react'
import { onAuthChange, consumeRedirectResult, ADMIN_EMAIL } from '../auth'
import { firebaseAuth } from '../firebase'
import { watchUserDoc, bootstrapAdminIfNeeded } from '../users'

const AuthCtx = createContext({
  authUser: null,
  userDoc: null,
  loading: true,
  isAdmin: false,
  isCashier: false,
  isCook: false,
  status: null,
})

// ─── Cachés en localStorage ──────────────────────────────────────────────
//
// userDoc: el documento completo del user en Firestore.
//
// Para detectar "este celular tuvo sesión antes" NO usamos un caché
// propio (que requeriría que un commit anterior lo hubiera escrito).
// En cambio, leemos DIRECTO de las keys que Firebase Auth guarda en
// localStorage (`firebase:authUser:...`). Eso funciona sin importar
// qué versión del código creó la sesión, y no depende de timing del
// onAuthStateChanged.
const USERDOC_CACHE_KEY = 'todypan_userdoc_cache_v1'

export function readUserDocCache(uid) {
  if (!uid) return null
  try {
    const raw = localStorage.getItem(USERDOC_CACHE_KEY)
    if (!raw) return null
    const cached = JSON.parse(raw)
    if (cached.uid !== uid) return null
    return cached.doc || null
  } catch {
    return null
  }
}

function writeUserDocCache(uid, doc) {
  try {
    if (uid && doc) {
      localStorage.setItem(USERDOC_CACHE_KEY, JSON.stringify({ uid, doc }))
    } else {
      localStorage.removeItem(USERDOC_CACHE_KEY)
    }
  } catch {}
}

/**
 * True si Firebase Auth tiene una sesión guardada en localStorage. Detecta
 * la presencia de cualquier key `firebase:authUser:...` que Firebase escribe
 * al hacer setPersistence(browserLocalPersistence) + signIn exitoso. Esto
 * sobrevive entre deploys y entre versiones del código — no depende de
 * que nuestro código haya hecho algo "primero".
 */
export function hasCachedFirebaseSession() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith('firebase:authUser:')) {
        return true
      }
    }
  } catch {}
  return false
}

export function AuthProvider({ children }) {
  // Inicialización SÍNCRONA. Si Firebase ya cargó la sesión antes del primer
  // render (browserLocalPersistence puede ser síncrono o no según el browser),
  // partimos con esos datos. Si no, intentamos con el caché de userDoc — eso
  // es suficiente para mostrar la app sin pasar por "Verificando sesión...".
  const initialUser = firebaseAuth.currentUser
  const initialDoc = readUserDocCache(initialUser?.uid)

  const [authUser, setAuthUser] = useState(initialUser)
  const [userDoc, setUserDoc] = useState(initialDoc)
  const [authLoading, setAuthLoading] = useState(!initialUser)
  const [docLoading, setDocLoading] = useState(!!initialUser && !initialDoc)
  const bootstrappedFor = useRef(null)

  // 1. Auth listener (Firebase Auth)
  useEffect(() => {
    consumeRedirectResult()

    // authStateReady() garantiza que Firebase haya terminado de leer su
    // almacenamiento persistente (localStorage). Es más robusto que
    // depender del primer onAuthStateChanged, que en algunos celulares
    // Android lentos puede tardar varios segundos en disparar al inicio.
    // Si después de authStateReady currentUser es null Y estamos offline
    // Y teníamos sesión cacheada → Firebase no logró validar y debemos
    // esperar reconexión, NO tirar la sesión.
    if (firebaseAuth.authStateReady) {
      firebaseAuth.authStateReady().then(() => {
        const u = firebaseAuth.currentUser
        if (u) {
          setAuthUser(u)
          setAuthLoading(false)
        } else if (!navigator.onLine && hasCachedFirebaseSession()) {
          // Sesión cacheada pero Firebase no terminó de validar offline.
          // Liberamos el splash para que App.jsx muestre la pantalla de
          // "Sin conexión - reconectando..." en lugar de "Verificando sesión...".
          setAuthLoading(false)
        } else {
          // Online sin user, o nunca hubo sesión: continuamos al Login.
          setAuthLoading(false)
        }
      }).catch(() => {})
    }

    const unsub = onAuthChange(u => {
      // Cuando llega null pero estamos offline Y teníamos sesión cacheada,
      // lo más probable es que sea un fluke transitorio mientras Firebase
      // intenta refrescar el token. Si lo aceptamos, mostraríamos Login y
      // la cajera no podría entrar (sin red el botón de Google falla).
      // Mejor mantener el authUser anterior y esperar a que vuelva la red.
      if (!u && !navigator.onLine && hasCachedFirebaseSession()) {
        console.warn('[Auth] onAuthChange(null) ignorado: estamos offline y había sesión cacheada')
        setAuthLoading(false)
        return
      }
      setAuthUser(u)
      setAuthLoading(false)
      if (!u) {
        // Logout real (online): limpiar todo
        setUserDoc(null)
        setDocLoading(false)
        writeUserDocCache(null, null)
      }
    })

    // Safety-net: si Firebase Auth no resuelve el estado en 5s (lock de
    // IndexedDB colgado, SW interceptando /__/auth/, redirect roto, lo que
    // sea), liberamos el splash. Si tenemos caché de userDoc, también
    // liberamos docLoading aunque el listener no haya respondido aún.
    const safetyNet = setTimeout(() => {
      setAuthLoading(prev => {
        if (prev) console.warn('[Auth] safety-net: liberando authLoading tras 5s')
        return false
      })
      setDocLoading(false)
    }, 5000)

    // PWA standalone: cuando el usuario regresa a la app después de un
    // redirect (Android Chrome a menudo abre el OAuth en una Custom Tab y
    // la PWA queda "atrás"), re-consumir el redirect y forzar a Firebase
    // a re-leer su estado persistido. Sin esto, la PWA puede quedarse en
    // pantalla de login aunque la sesión ya esté guardada.
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        consumeRedirectResult().catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus', handleVisibility)

    return () => {
      clearTimeout(safetyNet)
      unsub()
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('focus', handleVisibility)
    }
  }, [])

  // 2. User doc listener (Firestore). Va a devolver desde el caché offline
  // de Firestore si no hay red, así que normalmente resuelve aunque no haya
  // internet. El caché de localStorage que escribimos aquí es un respaldo
  // adicional: lo leemos ANTES de iniciar el listener para que la cajera
  // entre de inmediato aunque Firestore tarde en responder offline.
  useEffect(() => {
    if (!authUser) return

    // Hidratar desde caché si aún no tenemos doc en estado.
    if (!userDoc) {
      const cached = readUserDocCache(authUser.uid)
      if (cached) {
        setUserDoc(cached)
        setDocLoading(false)
      }
    }

    const unsub = watchUserDoc(authUser.uid, doc => {
      setDocLoading(false)
      // Solo aceptamos null si online (significa que el doc realmente no existe).
      // Offline + null = error transitorio; mantener lo que ya teníamos.
      if (!doc && !navigator.onLine && userDoc) {
        return
      }
      setUserDoc(doc)
      if (doc) writeUserDocCache(authUser.uid, doc)

      // Si es admin email y no tiene doc → bootstrap
      if (!doc && authUser.email === ADMIN_EMAIL && bootstrappedFor.current !== authUser.uid) {
        bootstrappedFor.current = authUser.uid
        bootstrapAdminIfNeeded(authUser).catch(err => {
          console.error('[Auth] bootstrap admin falló:', err)
        })
      }
    })
    return unsub
    // userDoc en deps adrede: si llega vacío y luego llenamos por caché,
    // el listener no se reconfigura — solo `authUser` es la dep que importa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser])

  const loading = authLoading || (authUser && docLoading)
  const isAdmin = !!userDoc && userDoc.role === 'admin' && userDoc.status === 'approved'
  const isCashier = !!userDoc && userDoc.role === 'cashier' && userDoc.status === 'approved'
  const isCook = !!userDoc && userDoc.role === 'cook' && userDoc.status === 'approved'

  const value = {
    authUser,
    userDoc,
    loading,
    isAdmin,
    isCashier,
    isCook,
    status: userDoc?.status || null,
  }

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export const useAuth = () => useContext(AuthCtx)

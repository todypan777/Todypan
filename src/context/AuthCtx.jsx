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
  status: null,
})

// Caché del documento de usuario en localStorage. Permite que la cajera entre
// de inmediato a su cuenta cuando está offline (sin esperar al servidor) si
// previamente ya había iniciado sesión en este celular.
const USERDOC_CACHE_KEY = 'todypan_userdoc_cache_v1'

function readUserDocCache(uid) {
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

export function AuthProvider({ children }) {
  // Inicialización SÍNCRONA: si Firebase ya cargó la sesión de localStorage al
  // arrancar, partimos con esa sesión en mano — sin pasar por "Verificando
  // sesión...". Si además tenemos el userDoc cacheado, también arrancamos
  // con él. Resultado: la cajera entra inmediata aunque no haya internet.
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
    const unsub = onAuthChange(u => {
      setAuthUser(u)
      setAuthLoading(false)
      if (!u) {
        setUserDoc(null)
        setDocLoading(false)
        writeUserDocCache(null, null)
      }
    })

    // Safety-net: si Firebase Auth no resuelve el estado en 5s (lock de
    // IndexedDB colgado, SW interceptando /__/auth/, redirect roto, lo que
    // sea), liberamos el splash para que la cajera al menos vea el Login
    // y pueda reintentar. Sin esto la pantalla "Verificando sesión..." se
    // queda eterna y la cajera no puede hacer nada.
    const safetyNet = setTimeout(() => {
      setAuthLoading(prev => {
        if (prev) console.warn('[Auth] safety-net: liberando loading tras 5s')
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
  // adicional para el primer arranque.
  //
  // IMPORTANTE: solo escribimos al caché cuando llega un doc real. Cuando
  // llega null (snapshot vacío = doc no existe) no borramos el caché para
  // no dejar a la cajera sin respaldo si lo del null es un fluke transitorio
  // (cosa que watchUserDoc ahora ya filtra ignorando errores, pero por si
  // acaso). El caché solo se limpia cuando hay logout explícito (u=null
  // arriba en onAuthChange).
  useEffect(() => {
    if (!authUser) return
    const unsub = watchUserDoc(authUser.uid, doc => {
      setUserDoc(doc)
      setDocLoading(false)
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
  }, [authUser])

  const loading = authLoading || (authUser && docLoading)
  const isAdmin = !!userDoc && userDoc.role === 'admin' && userDoc.status === 'approved'
  const isCashier = !!userDoc && userDoc.role === 'cashier' && userDoc.status === 'approved'

  const value = {
    authUser,
    userDoc,
    loading,
    isAdmin,
    isCashier,
    status: userDoc?.status || null,
  }

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export const useAuth = () => useContext(AuthCtx)

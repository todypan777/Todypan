import { createContext, useContext, useEffect, useState, useRef } from 'react'
import { onAuthChange, consumeRedirectResult, ADMIN_EMAIL } from '../auth'
import { watchUserDoc, bootstrapAdminIfNeeded } from '../users'

const AuthCtx = createContext({
  authUser: null,
  userDoc: null,
  loading: true,
  isAdmin: false,
  isCashier: false,
  status: null,
})

export function AuthProvider({ children }) {
  const [authUser, setAuthUser] = useState(null)
  const [userDoc, setUserDoc] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [docLoading, setDocLoading] = useState(true)
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
      }
    })

    // PWA standalone: cuando el usuario regresa a la app después de un
    // redirect (Android Chrome a menudo abre el OAuth en una Custom Tab y
    // la PWA queda "atrás"), re-consumir el redirect y forzar a Firebase
    // a re-leer su estado persistido. Sin esto, la PWA puede quedarse en
    // pantalla de login aunque la sesión ya esté guardada en IndexedDB.
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        consumeRedirectResult().catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus', handleVisibility)

    return () => {
      unsub()
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('focus', handleVisibility)
    }
  }, [])

  // 2. User doc listener (Firestore)
  useEffect(() => {
    if (!authUser) return
    setDocLoading(true)
    const unsub = watchUserDoc(authUser.uid, doc => {
      setUserDoc(doc)
      setDocLoading(false)

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

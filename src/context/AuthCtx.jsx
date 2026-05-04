import { createContext, useContext, useEffect, useState } from 'react'
import { onAuthChange, consumeRedirectResult, isAdmin } from '../auth'

const AuthCtx = createContext({ user: null, loading: true, isAdmin: false })

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    consumeRedirectResult()

    const unsub = onAuthChange(u => {
      setUser(u)
      setLoading(false)
    })
    return unsub
  }, [])

  const value = {
    user,
    loading,
    isAdmin: isAdmin(user),
  }

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export const useAuth = () => useContext(AuthCtx)

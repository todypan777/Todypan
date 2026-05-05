import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut as fbSignOut,
  onAuthStateChanged,
} from 'firebase/auth'
import { firebaseAuth, googleProvider } from './firebase'

export const ADMIN_EMAIL = 'todypan777@gmail.com'

// Solo usamos redirect cuando la app está instalada como PWA standalone:
// ahí no se puede abrir un popup. En navegador normal (incluido mobile web),
// signInWithPopup funciona perfectamente.
const isStandalonePWA = () => {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator.standalone === true
}

const REDIRECT_ERROR_KEY = 'todypan_auth_redirect_error'

export async function signInWithGoogle() {
  // PWA instalada: redirect es la única opción
  if (isStandalonePWA()) {
    try {
      sessionStorage.removeItem(REDIRECT_ERROR_KEY)
    } catch {}
    await signInWithRedirect(firebaseAuth, googleProvider)
    return null // el resultado llega tras la redirección
  }

  // Navegador (mobile o desktop): popup
  const result = await signInWithPopup(firebaseAuth, googleProvider)
  return result.user
}

/**
 * Procesa el resultado del redirect. Si hubo un error en el flujo de Google,
 * lo guarda en sessionStorage para que Login pueda mostrarlo.
 */
export async function consumeRedirectResult() {
  try {
    const result = await getRedirectResult(firebaseAuth)
    return result?.user || null
  } catch (err) {
    console.error('[auth] redirect error:', err)
    try {
      sessionStorage.setItem(REDIRECT_ERROR_KEY, JSON.stringify({
        code: err?.code || 'unknown',
        message: err?.message || 'Error desconocido',
      }))
    } catch {}
    return null
  }
}

export function getAndClearRedirectError() {
  try {
    const raw = sessionStorage.getItem(REDIRECT_ERROR_KEY)
    if (!raw) return null
    sessionStorage.removeItem(REDIRECT_ERROR_KEY)
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function signOut() {
  return fbSignOut(firebaseAuth)
}

export function onAuthChange(callback) {
  return onAuthStateChanged(firebaseAuth, callback)
}

export function isAdmin(user) {
  return !!user && user.email === ADMIN_EMAIL
}

import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut as fbSignOut,
  onAuthStateChanged,
} from 'firebase/auth'
import { firebaseAuth, googleProvider } from './firebase'

export const ADMIN_EMAIL = 'todypan777@gmail.com'

// En móvil, los popups suelen ser bloqueados por el navegador. Usamos redirect.
// En desktop, popup es mejor UX.
const preferRedirect = () => {
  if (typeof window === 'undefined') return false
  const ua = navigator.userAgent || ''
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua)
  const isStandalone = window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator.standalone === true
  return isMobile || isStandalone
}

export async function signInWithGoogle() {
  if (preferRedirect()) {
    await signInWithRedirect(firebaseAuth, googleProvider)
    return null // el resultado llega tras la redirección
  }
  const result = await signInWithPopup(firebaseAuth, googleProvider)
  return result.user
}

export async function consumeRedirectResult() {
  try {
    const result = await getRedirectResult(firebaseAuth)
    return result?.user || null
  } catch (err) {
    console.error('Error procesando redirect de Google:', err)
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

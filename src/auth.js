import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut as fbSignOut,
  onAuthStateChanged,
} from 'firebase/auth'
import { firebaseAuth, googleProvider } from './firebase'

// Correos DUEÑOS del sistema. Entran siempre, ven las dos panaderías y no
// quedan sujetos al alcance por sede: son quienes mantienen la app.
//
// Es una lista y no un solo correo porque quien desarrolla necesita su propia
// cuenta para probar sin usar la del negocio.
export const ROOT_EMAILS = [
  'todypan777@gmail.com',
  'sinfiniity@gmail.com',
]

/** True si el correo es de un dueño del sistema. */
export function isRootEmail(email) {
  return !!email && ROOT_EMAILS.includes(String(email).toLowerCase())
}

// Compatibilidad: varias pantallas todavía comparan contra un único correo.
export const ADMIN_EMAIL = ROOT_EMAILS[0]

const isStandalonePWA = () => {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator.standalone === true
}

const isIOS = () => {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  return /iPad|iPhone|iPod/.test(ua) && !window.MSStream
}

const REDIRECT_ERROR_KEY = 'todypan_auth_redirect_error'

// Errores de popup que justifican caer al redirect (popup bloqueado, no soportado,
// o cerrado por el navegador). NO cae a redirect si el usuario simplemente cerró
// el popup adrede — ahí solo devuelve null y el botón vuelve a estar disponible.
const POPUP_FALLBACK_CODES = new Set([
  'auth/popup-blocked',
  'auth/operation-not-supported-in-this-environment',
  'auth/internal-error',
])

export async function signInWithGoogle() {
  try {
    sessionStorage.removeItem(REDIRECT_ERROR_KEY)
  } catch {}

  // iOS PWA standalone: el popup está bloqueado por WebKit, redirect directo.
  // En el resto de casos (Android Chrome PWA incluido) intentamos popup primero
  // porque evita el bug de storage partitioning donde el redirect aterriza en
  // el navegador y no en la PWA, dejando a la cajera en bucle de login.
  if (isStandalonePWA() && isIOS()) {
    await signInWithRedirect(firebaseAuth, googleProvider)
    return null
  }

  try {
    const result = await signInWithPopup(firebaseAuth, googleProvider)
    return result.user
  } catch (err) {
    // Cancelación voluntaria: no es error, no caemos a redirect.
    if (err?.code === 'auth/popup-closed-by-user' || err?.code === 'auth/cancelled-popup-request') {
      throw err
    }
    // Popup imposible en este entorno: caemos a redirect.
    if (POPUP_FALLBACK_CODES.has(err?.code)) {
      await signInWithRedirect(firebaseAuth, googleProvider)
      return null
    }
    throw err
  }
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
  return isRootEmail(user?.email)
}

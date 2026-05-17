// Sonido de notificación para llamadas urgentes (ej. cocina → cajera).
//
// Usa Web Audio API para sintetizar un "ding-dong" tipo campana sin
// necesitar archivos descargables — funciona offline y no agrega peso
// al bundle.
//
// iOS / Safari bloquean la reproducción de audio hasta que el usuario
// haya hecho al menos un gesto en la página. Por eso exponemos
// `setupAudioUnlock()`: registra UNA vez un listener que crea/resume
// el AudioContext en el primer pointerdown/touchstart de la sesión.
// Después de eso, `playKitchenCallSound()` ya puede sonar sin gesto
// directo del usuario.

let ctx = null
let unlocked = false
let unlockBound = false

function getCtx() {
  if (ctx) return ctx
  const Ctor = typeof window !== 'undefined'
    ? (window.AudioContext || window.webkitAudioContext)
    : null
  if (!Ctor) return null
  try {
    ctx = new Ctor()
  } catch {
    ctx = null
  }
  return ctx
}

/**
 * Desbloqueo de audio: en iOS/Safari el primer sonido solo puede
 * dispararse desde dentro de un user gesture. Registramos un listener
 * UNA SOLA VEZ por sesión que crea y resume el contexto al primer
 * touchstart/pointerdown. A partir de ese momento podemos disparar
 * sonidos cuando queramos (timer, evento Firestore, etc).
 *
 * Es idempotente: llamar varias veces no agrega listeners duplicados.
 */
export function setupAudioUnlock() {
  if (unlockBound || unlocked) return
  if (typeof window === 'undefined') return
  unlockBound = true

  const handler = () => {
    if (unlocked) return
    const c = getCtx()
    if (!c) return
    try {
      if (c.state === 'suspended') c.resume()
      // Tocar un buffer silencioso para "calentar" el output en iOS.
      const buf = c.createBuffer(1, 1, 22050)
      const src = c.createBufferSource()
      src.buffer = buf
      src.connect(c.destination)
      src.start(0)
      unlocked = true
    } catch {
      // Si algo falla, lo reintentamos en el próximo gesto.
      unlocked = false
      return
    }
    // Una vez logrado, removemos los listeners — ya no se necesitan.
    window.removeEventListener('pointerdown', handler, true)
    window.removeEventListener('touchstart', handler, true)
    window.removeEventListener('keydown', handler, true)
  }

  window.addEventListener('pointerdown', handler, true)
  window.addEventListener('touchstart', handler, true)
  window.addEventListener('keydown', handler, true)
}

/**
 * Reproduce un "ding-dong" agradable y notorio (~0.7s en total).
 * Si el contexto aún no está desbloqueado, intenta resumirlo de
 * todos modos — en Android Chrome / Firefox normalmente funciona
 * mientras la PWA esté en foreground.
 */
export function playKitchenCallSound() {
  const c = getCtx()
  if (!c) return
  try {
    if (c.state === 'suspended') {
      c.resume().catch(() => {})
    }
    // Dos notas: La5 (880 Hz) → Mi5 (659.25 Hz). Tipo campana de tienda.
    playBellNote(c, 880, 0)
    playBellNote(c, 659.25, 0.18)
  } catch (err) {
    // Silenciar — el sonido es opcional, nunca debe romper la app.
    console.warn('[notificationSound] no se pudo reproducir:', err?.message || err)
  }
}

function playBellNote(c, freq, delaySec) {
  const startAt = c.currentTime + delaySec
  const duration = 0.6

  // Oscilador principal (sine, cuerpo de la campana).
  const osc = c.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(freq, startAt)

  // Oscilador armónico para darle "metálico" sin sonar áspero.
  const osc2 = c.createOscillator()
  osc2.type = 'sine'
  osc2.frequency.setValueAtTime(freq * 2, startAt)

  const gain = c.createGain()
  const gain2 = c.createGain()

  // Envelope ADSR rápido tipo campana: ataque casi instantáneo,
  // decaimiento exponencial.
  gain.gain.setValueAtTime(0, startAt)
  gain.gain.linearRampToValueAtTime(0.35, startAt + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + duration)

  gain2.gain.setValueAtTime(0, startAt)
  gain2.gain.linearRampToValueAtTime(0.08, startAt + 0.01)
  gain2.gain.exponentialRampToValueAtTime(0.001, startAt + duration * 0.6)

  osc.connect(gain).connect(c.destination)
  osc2.connect(gain2).connect(c.destination)

  osc.start(startAt)
  osc2.start(startAt)
  osc.stop(startAt + duration + 0.05)
  osc2.stop(startAt + duration + 0.05)
}

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
let masterChain = null   // { input, compressor, master } — todo lo que vamos a tocar pasa por aquí
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
 * Cadena master: todos los osciladores se conectan al `input`. Aplica un
 * DynamicsCompressor para "subir el piso" del sonido (perceptual loudness
 * mucho mayor sin clipear) y luego un gain master casi al máximo.
 *
 * Esto multiplica el volumen percibido vs conectar directo al destination
 * — Web Audio sin compresión suena suave incluso con gain alto porque el
 * peak es corto.
 */
function getMasterChain(c) {
  if (masterChain && masterChain.ctx === c) return masterChain
  const input = c.createGain()
  input.gain.value = 1.0

  const compressor = c.createDynamicsCompressor()
  compressor.threshold.setValueAtTime(-24, c.currentTime)
  compressor.knee.setValueAtTime(20, c.currentTime)
  compressor.ratio.setValueAtTime(12, c.currentTime)
  compressor.attack.setValueAtTime(0.003, c.currentTime)
  compressor.release.setValueAtTime(0.18, c.currentTime)

  const master = c.createGain()
  master.gain.value = 1.0  // Tras compresión, queda fuerte sin clip.

  input.connect(compressor).connect(master).connect(c.destination)
  masterChain = { ctx: c, input, compressor, master }
  return masterChain
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
 * Reproduce un patrón triple de campana ALTO y notorio (~1.2s en total).
 * Pasa por un compresor master para aprovechar todo el headroom del
 * dispositivo (suena fuerte sin distorsionar).
 *
 * Si el contexto aún no está desbloqueado, intenta resumirlo de todos
 * modos — en Android Chrome / Firefox normalmente funciona mientras la
 * PWA esté en foreground.
 */
export function playKitchenCallSound() {
  const c = getCtx()
  if (!c) return
  try {
    if (c.state === 'suspended') {
      c.resume().catch(() => {})
    }
    // Patrón triple: La5 → Mi5 → La5. Tipo timbre de tienda. La triple
    // repetición es lo que hace que se "sienta" fuerte aunque cada nota
    // dure poco. La gente percibe la duración como volumen.
    playBellNote(c, 880, 0)
    playBellNote(c, 659.25, 0.22)
    playBellNote(c, 880, 0.44)
  } catch (err) {
    // Silenciar — el sonido es opcional, nunca debe romper la app.
    console.warn('[notificationSound] no se pudo reproducir:', err?.message || err)
  }
}

/**
 * Sonido para "almuerzo listo": notificación corta, ascendente y agradable
 * (~0.5s). Es deliberadamente DISTINTO al de llamada urgente para que la
 * cajera no las confunda — esta es informativa, no requiere correr.
 *
 * Patrón Mi6 → Sol6 → Si6 (tercer mayor ascendente). Sale por la misma
 * cadena master con compresor, así que también se oye fuerte sin ser
 * agresiva.
 */
export function playOrderReadySound() {
  const c = getCtx()
  if (!c) return
  try {
    if (c.state === 'suspended') {
      c.resume().catch(() => {})
    }
    playSoftBlip(c, 1318.51, 0)    // Mi6
    playSoftBlip(c, 1567.98, 0.08) // Sol6
    playSoftBlip(c, 1975.53, 0.18) // Si6
  } catch (err) {
    console.warn('[notificationSound] orderReady no se pudo reproducir:', err?.message || err)
  }
}

function playSoftBlip(c, freq, delaySec) {
  const chain = getMasterChain(c)
  const startAt = c.currentTime + delaySec
  const duration = 0.32

  const osc = c.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(freq, startAt)

  const gain = c.createGain()
  gain.gain.setValueAtTime(0, startAt)
  gain.gain.linearRampToValueAtTime(0.55, startAt + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + duration)

  osc.connect(gain).connect(chain.input)
  osc.start(startAt)
  osc.stop(startAt + duration + 0.04)
}

function playBellNote(c, freq, delaySec) {
  const chain = getMasterChain(c)
  const startAt = c.currentTime + delaySec
  const duration = 0.9

  // Oscilador principal (sine, cuerpo cálido de la campana).
  const osc = c.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(freq, startAt)

  // Segundo armónico (sine x2) — le da brillo "metálico".
  const osc2 = c.createOscillator()
  osc2.type = 'sine'
  osc2.frequency.setValueAtTime(freq * 2, startAt)

  // Tercer armónico (triangle x3) — agrega presencia para que se note
  // incluso en altavoces malos de celular.
  const osc3 = c.createOscillator()
  osc3.type = 'triangle'
  osc3.frequency.setValueAtTime(freq * 3, startAt)

  const gain = c.createGain()
  const gain2 = c.createGain()
  const gain3 = c.createGain()

  // Envelopes ADSR tipo campana. Subimos los peaks bien arriba — el
  // compresor master se encarga de evitar clipping.
  gain.gain.setValueAtTime(0, startAt)
  gain.gain.linearRampToValueAtTime(0.95, startAt + 0.008)
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + duration)

  gain2.gain.setValueAtTime(0, startAt)
  gain2.gain.linearRampToValueAtTime(0.45, startAt + 0.008)
  gain2.gain.exponentialRampToValueAtTime(0.001, startAt + duration * 0.7)

  gain3.gain.setValueAtTime(0, startAt)
  gain3.gain.linearRampToValueAtTime(0.18, startAt + 0.008)
  gain3.gain.exponentialRampToValueAtTime(0.001, startAt + duration * 0.4)

  osc.connect(gain).connect(chain.input)
  osc2.connect(gain2).connect(chain.input)
  osc3.connect(gain3).connect(chain.input)

  osc.start(startAt)
  osc2.start(startAt)
  osc3.start(startAt)
  osc.stop(startAt + duration + 0.05)
  osc2.stop(startAt + duration + 0.05)
  osc3.stop(startAt + duration + 0.05)
}

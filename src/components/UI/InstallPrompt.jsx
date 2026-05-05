import { useState, useEffect } from 'react'
import './InstallPrompt.css'

/**
 * Modal de instalación PWA. Aparece SIEMPRE que la app no esté ya instalada
 * (display-mode: standalone). Al hacer X y recargar, vuelve a aparecer.
 *
 * Comportamiento por plataforma:
 *  - Android/Chrome con beforeinstallprompt disponible → botón "Instalar" nativo
 *  - Android sin prompt disponible (ya se uso, o Chrome decidió no dispararlo)
 *    → instrucciones manuales del menú ⋮
 *  - iOS Safari → instrucciones de Compartir → Añadir a pantalla de inicio
 *  - iOS Chrome → aviso de abrir en Safari (Apple no permite instalar PWA desde Chrome iOS)
 *  - Desktop → no se muestra (no es prioridad)
 */
export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [show, setShow] = useState(false)
  const [platform, setPlatform] = useState(null) // 'android' | 'ios-safari' | 'ios-chrome'

  useEffect(() => {
    // Ya está instalada → no mostrar nada
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
    if (isStandalone) return

    const ua = navigator.userAgent || ''
    const isIos = /ipad|iphone|ipod/i.test(ua)
    const isSafari = /safari/i.test(ua) && !/chrome|crios|fxios/i.test(ua)
    const isAndroid = /android/i.test(ua)
    const isMobile = isIos || isAndroid

    // Solo móvil: instalar en desktop no es prioridad
    if (!isMobile) return

    if (isIos) {
      setPlatform(isSafari ? 'ios-safari' : 'ios-chrome')
      const t = setTimeout(() => setShow(true), 1500)
      return () => clearTimeout(t)
    }

    if (isAndroid) {
      setPlatform('android')

      // Capturar el prompt nativo si Chrome lo dispara
      const handler = (e) => {
        e.preventDefault()
        setDeferredPrompt(e)
      }
      window.addEventListener('beforeinstallprompt', handler)

      // Mostrar el modal de todas formas tras 1.5s, con o sin prompt nativo
      const t = setTimeout(() => setShow(true), 1500)

      return () => {
        clearTimeout(t)
        window.removeEventListener('beforeinstallprompt', handler)
      }
    }
  }, [])

  const handleInstall = async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') {
      setShow(false)
      setDeferredPrompt(null)
    }
  }

  const handleDismiss = () => setShow(false)

  if (!show) return null

  // ── ANDROID ──
  if (platform === 'android') {
    return (
      <div className="install-overlay fade-in" role="dialog" aria-modal="true">
        <div className="install-card slide-up">
          <button className="install-close" onClick={handleDismiss} aria-label="Cerrar">×</button>
          <img src="/Logo.png" alt="TodyPan" className="install-logo"
            onError={(e) => { e.target.style.display = 'none' }} />
          <h3 className="install-title">Instala TodyPan</h3>
          <p className="install-desc">
            Añade la app a tu pantalla de inicio para abrirla más rápido, sin navegador.
          </p>

          {deferredPrompt ? (
            <button className="install-btn-primary" onClick={handleInstall}>
              📲 Instalar App
            </button>
          ) : (
            <ol className="install-steps">
              <li className="install-step">
                <span className="step-num">1</span>
                <span className="step-text">
                  Toca el menú <strong>⋮</strong> arriba a la derecha de Chrome
                </span>
              </li>
              <li className="install-step">
                <span className="step-num">2</span>
                <span className="step-text">
                  Toca <strong>"Instalar app"</strong> o <strong>"Añadir a pantalla de inicio"</strong>
                </span>
              </li>
              <li className="install-step">
                <span className="step-num">3</span>
                <span className="step-text">Confirma <strong>"Instalar"</strong></span>
              </li>
            </ol>
          )}

          <button className="install-btn-secondary" onClick={handleDismiss}>
            Ahora no
          </button>
        </div>
      </div>
    )
  }

  // ── iOS SAFARI ──
  if (platform === 'ios-safari') {
    return (
      <div className="install-overlay fade-in" role="dialog" aria-modal="true">
        <div className="install-card slide-up">
          <button className="install-close" onClick={handleDismiss} aria-label="Cerrar">×</button>
          <img src="/Logo.png" alt="TodyPan" className="install-logo"
            onError={(e) => { e.target.style.display = 'none' }} />
          <h3 className="install-title">Instala TodyPan</h3>
          <p className="install-desc">Sigue estos pasos en Safari:</p>
          <ol className="install-steps">
            <li className="install-step">
              <span className="step-num">1</span>
              <span className="step-text">
                Toca el ícono <strong>Compartir</strong>{' '}
                <span className="step-icon">⎙</span> en la barra inferior
              </span>
            </li>
            <li className="install-step">
              <span className="step-num">2</span>
              <span className="step-text">
                Desplázate y toca <strong>"Añadir a pantalla de inicio"</strong>{' '}
                <span className="step-icon">＋</span>
              </span>
            </li>
            <li className="install-step">
              <span className="step-num">3</span>
              <span className="step-text">Toca <strong>"Añadir"</strong> para confirmar</span>
            </li>
          </ol>
          <button className="install-btn-secondary" onClick={handleDismiss}>
            Entendido
          </button>
        </div>
      </div>
    )
  }

  // ── iOS CHROME (Apple no permite instalar PWA desde Chrome iOS) ──
  if (platform === 'ios-chrome') {
    return (
      <div className="install-overlay fade-in" role="dialog" aria-modal="true">
        <div className="install-card slide-up">
          <button className="install-close" onClick={handleDismiss} aria-label="Cerrar">×</button>
          <img src="/Logo.png" alt="TodyPan" className="install-logo"
            onError={(e) => { e.target.style.display = 'none' }} />
          <h3 className="install-title">Instala desde Safari</h3>
          <p className="install-desc">
            En iPhone solo se puede instalar la app desde el navegador <strong>Safari</strong>.
            Abre esta misma página en Safari y verás las instrucciones.
          </p>
          <button className="install-btn-secondary" onClick={handleDismiss}>
            Entendido
          </button>
        </div>
      </div>
    )
  }

  return null
}

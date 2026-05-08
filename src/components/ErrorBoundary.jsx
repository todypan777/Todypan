import { Component } from 'react'
import { T } from '../tokens'

const SUPPORT_PHONE = '573208435143' // formato internacional para wa.me
const SUPPORT_PHONE_DISPLAY = '+57 320 843 5143'

/**
 * ErrorBoundary global. Si un componente hijo lanza una excepción durante
 * el render o un effect, en lugar de pantalla en blanco mostramos una UI
 * amigable con detalles del error y un botón directo a WhatsApp del
 * programador.
 *
 * Capturar errores en class component (los hooks no soportan errorBoundary).
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo)
    this.setState({ errorInfo })
  }

  render() {
    if (!this.state.error) return this.props.children

    const errMsg = this.state.error?.message || String(this.state.error)
    const stack = this.state.errorInfo?.componentStack || this.state.error?.stack || ''
    const where = this.props.label || 'la app'

    // Mensaje pre-armado para WhatsApp
    const userAgent = (typeof navigator !== 'undefined' ? navigator.userAgent : '').slice(0, 80)
    const waText = encodeURIComponent(
      `Hola, la app TodyPan se rompió en ${where}.\n\n` +
      `Error: ${errMsg}\n\n` +
      `Dispositivo: ${userAgent}\n` +
      `Hora: ${new Date().toLocaleString('es-CO')}`
    )
    const waUrl = `https://wa.me/${SUPPORT_PHONE}?text=${waText}`

    return (
      <div style={{
        minHeight: '100dvh', background: T.neutral[50],
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '32px 24px',
        fontFamily: '-apple-system, "SF Pro Text", "Inter", system-ui, sans-serif',
        color: T.neutral[800],
      }}>
        <div style={{
          width: '100%', maxWidth: 420,
          background: '#fff', borderRadius: 22,
          padding: '28px 24px',
          border: `1px solid ${T.neutral[100]}`,
          boxShadow: '0 8px 32px rgba(0,0,0,0.08)',
        }}>
          <div style={{
            width: 72, height: 72, borderRadius: 999,
            background: '#FBE9E5',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 18px',
            fontSize: 36,
          }}>
            ⚠️
          </div>

          <div style={{
            fontSize: 20, fontWeight: 800, color: T.neutral[900],
            textAlign: 'center', letterSpacing: -0.4, marginBottom: 8,
          }}>
            Algo salió mal
          </div>

          <div style={{
            fontSize: 13.5, color: T.neutral[600],
            textAlign: 'center', lineHeight: 1.55, marginBottom: 22,
          }}>
            Hay un error en {where}. No te preocupes, tus ventas están guardadas.
            Contacta al programador para que lo arregle rápido.
          </div>

          {/* Botón principal: WhatsApp */}
          <a
            href={waUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              width: '100%', padding: '14px 16px', borderRadius: 14,
              background: '#25D366', color: '#fff',
              textDecoration: 'none', boxSizing: 'border-box',
              fontSize: 15.5, fontWeight: 800, letterSpacing: 0.2,
              boxShadow: '0 6px 18px rgba(37,211,102,0.4)',
              marginBottom: 12,
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="#fff">
              <path d="M17.6 14.2c-.3-.1-1.7-.8-2-.9s-.5-.1-.7.1-.8.9-.9 1.1-.3.2-.6 0c-1.7-.9-2.8-1.6-3.9-3.5-.3-.5.3-.5.8-1.6.1-.2 0-.4 0-.5s-.7-1.6-.9-2.2c-.2-.6-.5-.5-.7-.5h-.5c-.2 0-.5.1-.7.4-.3.4-1 1-1 2.4 0 1.4 1 2.8 1.2 3 .1.2 2 3.1 4.9 4.3 1.7.7 2.4.8 3.3.7.5-.1 1.7-.7 2-1.4.2-.7.2-1.2.2-1.4-.1-.1-.3-.2-.5-.3z"/>
              <path d="M20.5 3.5C18.3 1.2 15.3 0 12 0 5.4 0 .1 5.4.1 12c0 2.1.6 4.2 1.6 6L0 24l6.2-1.6c1.7.9 3.7 1.4 5.7 1.4h.1c6.6 0 12-5.4 12-12 0-3.2-1.2-6.2-3.5-8.3zM12 21.8c-1.8 0-3.6-.5-5.1-1.4l-.4-.2-3.7 1 1-3.6-.2-.4c-1-1.6-1.5-3.4-1.5-5.3 0-5.5 4.5-9.9 9.9-9.9 2.7 0 5.1 1 7 2.9 1.9 1.9 2.9 4.4 2.9 7-.1 5.5-4.5 9.9-9.9 9.9z" fillRule="evenodd"/>
            </svg>
            Contactar al programador
          </a>

          <div style={{
            fontSize: 11, color: T.neutral[500],
            textAlign: 'center', marginBottom: 20,
          }}>
            WhatsApp · {SUPPORT_PHONE_DISPLAY}
          </div>

          {/* Botón secundario: recargar */}
          <button
            onClick={() => {
              this.setState({ error: null, errorInfo: null })
              if (typeof window !== 'undefined') window.location.reload()
            }}
            style={{
              width: '100%', padding: '11px 16px', borderRadius: 12,
              background: T.neutral[100], color: T.neutral[700],
              border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 13.5, fontWeight: 700,
              marginBottom: 8,
            }}
          >
            ↺ Recargar la app
          </button>

          {/* Detalle técnico colapsado (para que el programador lo lea si lo piden) */}
          <details style={{ marginTop: 14, fontSize: 11.5 }}>
            <summary style={{
              cursor: 'pointer', color: T.neutral[500],
              fontWeight: 600, padding: '6px 0',
            }}>
              Ver detalle técnico
            </summary>
            <div style={{
              marginTop: 8, padding: '10px 12px', borderRadius: 10,
              background: T.neutral[50], border: `1px solid ${T.neutral[100]}`,
              fontSize: 11, color: T.neutral[700],
              fontFamily: 'monospace',
              maxHeight: 160, overflowY: 'auto',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              lineHeight: 1.4,
            }}>
              <strong>Error:</strong> {errMsg}
              {stack && (
                <>
                  {'\n\n'}<strong>Stack:</strong>{'\n'}{stack}
                </>
              )}
            </div>
          </details>
        </div>
      </div>
    )
  }
}

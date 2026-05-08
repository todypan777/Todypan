import { T } from '../tokens'

const SUPPORT_PHONE = '573208435143'
const SUPPORT_PHONE_DISPLAY = '+57 320 843 5143'

/**
 * Botón "Contactar al programador" reutilizable. Abre WhatsApp directo con
 * un mensaje pre-armado que incluye contexto del usuario y dispositivo.
 *
 * Variantes:
 *   - 'menu'    → fila estilo opción de menú (avatar dropdowns)
 *   - 'card'    → tarjeta con icono grande (Login, AccountStates)
 *   - 'inline'  → botón compacto verde
 *
 * Props:
 *   variant?: 'menu' | 'card' | 'inline'  (default 'menu')
 *   userContext?: string  (texto extra que va al mensaje, ej: email o turno)
 *   reason?: string       (razón visible en el botón, ej: 'no puedo iniciar sesión')
 *   onClick?: () => void  (callback adicional, ej: cerrar el menú abierto)
 */
export default function ContactSupportButton({
  variant = 'menu',
  userContext,
  reason,
  onClick,
}) {
  const userAgent = (typeof navigator !== 'undefined' ? navigator.userAgent : '').slice(0, 80)
  const text = encodeURIComponent(
    `Hola, necesito ayuda con TodyPan.\n\n` +
    (reason ? `Motivo: ${reason}\n\n` : '') +
    (userContext ? `${userContext}\n` : '') +
    `Dispositivo: ${userAgent}\n` +
    `Hora: ${new Date().toLocaleString('es-CO')}`
  )
  const href = `https://wa.me/${SUPPORT_PHONE}?text=${text}`

  function handleClick(e) {
    onClick?.(e)
    // No prevenimos default — el <a> abre WhatsApp normalmente.
  }

  if (variant === 'menu') {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        onClick={handleClick}
        style={{
          display: 'flex', alignItems: 'center', gap: 14,
          width: '100%', padding: '14px 22px',
          background: 'transparent', border: 'none',
          cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 14.5, fontWeight: 600, color: T.neutral[800],
          textDecoration: 'none', boxSizing: 'border-box',
          textAlign: 'left',
        }}
      >
        <WhatsAppIcon size={20} color="#25D366" />
        <span style={{ flex: 1 }}>
          <span style={{ display: 'block' }}>Contactar al programador</span>
          <span style={{
            display: 'block', fontSize: 11, color: T.neutral[500],
            fontWeight: 500, marginTop: 1,
          }}>
            WhatsApp · {SUPPORT_PHONE_DISPLAY}
          </span>
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M3 1 L8 6 L3 11" stroke={T.neutral[400]} strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </a>
    )
  }

  if (variant === 'card') {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        onClick={handleClick}
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '13px 16px', borderRadius: 14,
          background: '#fff', border: `1.5px solid ${T.neutral[200]}`,
          textDecoration: 'none', boxSizing: 'border-box',
          fontFamily: 'inherit',
        }}
      >
        <div style={{
          width: 36, height: 36, borderRadius: 10, flexShrink: 0,
          background: '#E8F8EE',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <WhatsAppIcon size={20} color="#25D366" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: T.neutral[800] }}>
            ¿Algún problema? Escríbeme
          </div>
          <div style={{ fontSize: 11.5, color: T.neutral[500], marginTop: 1 }}>
            WhatsApp · {SUPPORT_PHONE_DISPLAY}
          </div>
        </div>
        <svg width="10" height="14" viewBox="0 0 10 14" style={{ flexShrink: 0 }}>
          <path d="M2 1 L8 7 L2 13" stroke={T.neutral[300]} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </a>
    )
  }

  // inline
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={handleClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '10px 16px', borderRadius: 12,
        background: '#25D366', color: '#fff',
        textDecoration: 'none', boxSizing: 'border-box',
        fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700,
        boxShadow: '0 3px 10px rgba(37,211,102,0.35)',
      }}
    >
      <WhatsAppIcon size={16} color="#fff" />
      Contactar programador
    </a>
  )
}

function WhatsAppIcon({ size = 20, color = '#25D366' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ flexShrink: 0 }}>
      <path d="M17.6 14.2c-.3-.1-1.7-.8-2-.9s-.5-.1-.7.1-.8.9-.9 1.1-.3.2-.6 0c-1.7-.9-2.8-1.6-3.9-3.5-.3-.5.3-.5.8-1.6.1-.2 0-.4 0-.5s-.7-1.6-.9-2.2c-.2-.6-.5-.5-.7-.5h-.5c-.2 0-.5.1-.7.4-.3.4-1 1-1 2.4 0 1.4 1 2.8 1.2 3 .1.2 2 3.1 4.9 4.3 1.7.7 2.4.8 3.3.7.5-.1 1.7-.7 2-1.4.2-.7.2-1.2.2-1.4-.1-.1-.3-.2-.5-.3z"/>
      <path d="M20.5 3.5C18.3 1.2 15.3 0 12 0 5.4 0 .1 5.4.1 12c0 2.1.6 4.2 1.6 6L0 24l6.2-1.6c1.7.9 3.7 1.4 5.7 1.4h.1c6.6 0 12-5.4 12-12 0-3.2-1.2-6.2-3.5-8.3zM12 21.8c-1.8 0-3.6-.5-5.1-1.4l-.4-.2-3.7 1 1-3.6-.2-.4c-1-1.6-1.5-3.4-1.5-5.3 0-5.5 4.5-9.9 9.9-9.9 2.7 0 5.1 1 7 2.9 1.9 1.9 2.9 4.4 2.9 7-.1 5.5-4.5 9.9-9.9 9.9z" fillRule="evenodd"/>
    </svg>
  )
}

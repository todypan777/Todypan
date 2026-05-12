import { T } from '../../tokens'

// Primitivos de UI compartidos por DailyMenuView, CatalogView y los modales
// del CookApp. Extraídos del CookApp original para que el admin pueda
// reutilizar los mismos editores en su modo "Asistir cocinera" sin duplicar
// código.

export function ModalOverlay({ onClose, children }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 90,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      {children}
    </div>
  )
}

export function ModalCard({ children }) {
  return (
    <div onClick={e => e.stopPropagation()} style={{
      width: '100%', maxWidth: 460, background: '#fff', borderRadius: 22,
      padding: '24px 22px 22px', boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
      maxHeight: '94vh', overflowY: 'auto',
    }}>
      {children}
    </div>
  )
}

export function ModalTitle({ children }) {
  return (
    <div style={{ fontSize: 18, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3 }}>
      {children}
    </div>
  )
}

export function ModalSub({ children }) {
  return (
    <div style={{ fontSize: 12.5, color: T.neutral[500], marginTop: 4, marginBottom: 16, lineHeight: 1.5 }}>
      {children}
    </div>
  )
}

export function ModalActions({ onCancel, onConfirm, confirmLabel, confirmDisabled, confirmColor }) {
  return (
    <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
      <button onClick={onCancel} style={btnSecondary()}>Cancelar</button>
      <button
        onClick={onConfirm}
        disabled={confirmDisabled}
        style={{
          ...btnPrimary(confirmDisabled ? T.neutral[200] : confirmColor),
          opacity: confirmDisabled ? 0.6 : 1,
          cursor: confirmDisabled ? 'not-allowed' : 'pointer',
        }}
      >
        {confirmLabel}
      </button>
    </div>
  )
}

export function FieldLabel({ children }) {
  return (
    <div style={{
      fontSize: 11.5, fontWeight: 700, color: T.neutral[600],
      letterSpacing: 0.3, textTransform: 'uppercase',
      marginBottom: 6, marginTop: 4,
    }}>
      {children}
    </div>
  )
}

export function inputStyle() {
  return {
    width: '100%', padding: '11px 12px', borderRadius: 12,
    border: `1.5px solid ${T.neutral[200]}`,
    fontSize: 14, fontFamily: 'inherit',
    background: '#fff', color: T.neutral[900],
    outline: 'none', marginBottom: 12,
    boxSizing: 'border-box',
  }
}

export function btnPrimary(bg) {
  return {
    flex: 1.4, padding: '12px', borderRadius: 12,
    background: bg, color: '#fff',
    border: 'none', cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
    boxShadow: `0 3px 10px ${bg}44`,
  }
}

export function btnSecondary() {
  return {
    flex: 1, padding: '12px', borderRadius: 12,
    background: T.neutral[100], color: T.neutral[700],
    border: 'none', cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
  }
}

export function btnGhost(color) {
  const c = color || T.neutral[700]
  return {
    padding: '11px 14px', borderRadius: 12,
    background: 'transparent', color: c,
    border: `1.5px solid ${c}33`,
    cursor: 'pointer', fontFamily: 'inherit',
    fontSize: 13.5, fontWeight: 700,
  }
}

export function ErrorBox({ children }) {
  return (
    <div style={{
      marginBottom: 10, padding: '10px 12px', borderRadius: 10,
      background: '#FBE9E5', border: `1px solid #F0C8BE`, color: T.bad,
      fontSize: 12.5, fontWeight: 500, textAlign: 'center',
    }}>
      {children}
    </div>
  )
}

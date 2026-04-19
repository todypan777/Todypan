import { T } from '../tokens'
import { TodyMark } from './Atoms'

export function TabBar({ active, onChange }) {
  const tabs = [
    { id: 'home', label: 'Inicio', icon: (c) => (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path d="M3 11 L11 4 L19 11 V18 Q19 19 18 19 H14 V14 H8 V19 H4 Q3 19 3 18 Z" stroke={c} strokeWidth="1.7" fill="none" strokeLinejoin="round"/>
      </svg>
    )},
    { id: 'registro', label: 'Registro', icon: (c) => (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <rect x="4" y="3" width="14" height="16" rx="2.5" stroke={c} strokeWidth="1.7" fill="none"/>
        <path d="M8 8 H14 M8 11.5 H14 M8 15 H11" stroke={c} strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    )},
    { id: 'add', label: '', icon: () => (
      <div style={{
        width: 46, height: 46, borderRadius: 999, background: T.copper[500],
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 6px 16px rgba(184,122,86,0.45)',
        marginBottom: 2,
      }}>
        <svg width="20" height="20" viewBox="0 0 20 20">
          <path d="M10 3 V17 M3 10 H17" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/>
        </svg>
      </div>
    )},
    { id: 'team', label: 'Equipo', icon: (c) => (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <circle cx="8" cy="8" r="3" stroke={c} strokeWidth="1.7" fill="none"/>
        <path d="M2 18 Q2 12 8 12 Q14 12 14 18" stroke={c} strokeWidth="1.7" fill="none"/>
        <circle cx="15" cy="7" r="2.3" stroke={c} strokeWidth="1.5" fill="none"/>
        <path d="M13 13 Q15 11.5 17 12.5 Q20 13.5 20 17" stroke={c} strokeWidth="1.5" fill="none"/>
      </svg>
    )},
    { id: 'more', label: 'Más', icon: (c) => (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <circle cx="5" cy="11" r="1.6" fill={c}/>
        <circle cx="11" cy="11" r="1.6" fill={c}/>
        <circle cx="17" cy="11" r="1.6" fill={c}/>
      </svg>
    )},
  ]

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 30,
      paddingBottom: 'env(safe-area-inset-bottom, 20px)',
      paddingTop: 8,
      background: 'rgba(255,255,255,0.94)',
      backdropFilter: 'blur(20px) saturate(180%)',
      WebkitBackdropFilter: 'blur(20px) saturate(180%)',
      borderTop: `0.5px solid rgba(45,35,25,0.07)`,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-around', padding: '0 4px' }}>
        {tabs.map(t => {
          const isActive = active === t.id
          const c = isActive ? T.copper[500] : T.neutral[400]
          return (
            <button key={t.id} onClick={() => onChange(t.id)} style={{
              background: 'none', border: 'none', padding: '4px 6px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
              cursor: 'pointer', fontFamily: 'inherit', flex: 1, maxWidth: 80,
            }}>
              {t.icon(c)}
              {t.label && (
                <span style={{ fontSize: 10.5, fontWeight: 600, color: c, letterSpacing: 0.1 }}>
                  {t.label}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function ScreenHeader({ title, subtitle, right }) {
  return (
    <div style={{
      padding: '56px 20px 12px',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {subtitle && (
          <div style={{ fontSize: 13, color: T.neutral[500], fontWeight: 500, marginBottom: 2 }}>{subtitle}</div>
        )}
        <div style={{ fontSize: 28, fontWeight: 700, color: T.neutral[900], letterSpacing: -0.6, lineHeight: 1.15 }}>
          {title}
        </div>
      </div>
      {right && <div>{right}</div>}
    </div>
  )
}

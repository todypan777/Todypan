import { T } from '../tokens'
import { TodyMark } from './Atoms'
import { useIsDesktop } from '../context/DesktopCtx'

const MAIN_TABS = [
  { id: 'home', label: 'Inicio', icon: (c) => (
    <svg width="20" height="20" viewBox="0 0 22 22" fill="none">
      <path d="M3 11 L11 4 L19 11 V18 Q19 19 18 19 H14 V14 H8 V19 H4 Q3 19 3 18 Z" stroke={c} strokeWidth="1.7" fill="none" strokeLinejoin="round"/>
    </svg>
  )},
  { id: 'registro', label: 'Registro', icon: (c) => (
    <svg width="20" height="20" viewBox="0 0 22 22" fill="none">
      <rect x="4" y="3" width="14" height="16" rx="2.5" stroke={c} strokeWidth="1.7" fill="none"/>
      <path d="M8 8 H14 M8 11.5 H14 M8 15 H11" stroke={c} strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )},
  { id: 'team', label: 'Equipo', icon: (c) => (
    <svg width="20" height="20" viewBox="0 0 22 22" fill="none">
      <circle cx="8" cy="8" r="3" stroke={c} strokeWidth="1.7" fill="none"/>
      <path d="M2 18 Q2 12 8 12 Q14 12 14 18" stroke={c} strokeWidth="1.7" fill="none"/>
      <circle cx="15" cy="7" r="2.3" stroke={c} strokeWidth="1.5" fill="none"/>
      <path d="M13 13 Q15 11.5 17 12.5 Q20 13.5 20 17" stroke={c} strokeWidth="1.5" fill="none"/>
    </svg>
  )},
]

const MORE_TABS = [
  { id: 'movements', label: 'Movimientos', icon: (c) => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M3 6 H13 M3 6 L6 3 M3 6 L6 9" stroke={c} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M17 14 H7 M17 14 L14 11 M17 14 L14 17" stroke={c} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )},
  { id: 'reports', label: 'Reportes', icon: (c) => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M4 16 V8 M9 16 V4 M14 16 V11" stroke={c} strokeWidth="2" strokeLinecap="round"/>
      <path d="M3 18 H17" stroke={c} strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )},
  { id: 'reminders', label: 'Recordatorios', icon: (c) => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M5 8 Q5 4 10 4 Q15 4 15 8 V12 L17 15 H3 L5 12 Z" stroke={c} strokeWidth="1.6" fill="none" strokeLinejoin="round"/>
      <path d="M8 16 Q8 18 10 18 Q12 18 12 16" stroke={c} strokeWidth="1.6" fill="none"/>
    </svg>
  )},
  { id: 'branches', label: 'Panaderías', icon: (c) => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M3 9 L10 4 L17 9 V16 H3 Z" stroke={c} strokeWidth="1.6" fill="none" strokeLinejoin="round"/>
      <path d="M8 16 V12 H12 V16" stroke={c} strokeWidth="1.6" fill="none"/>
    </svg>
  )},
]

// Para móvil (TabBar) — sigue usando "Más"
const MOBILE_MORE_TAB = { id: 'more', label: 'Más', icon: (c) => (
  <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
    <circle cx="5" cy="11" r="1.6" fill={c}/>
    <circle cx="11" cy="11" r="1.6" fill={c}/>
    <circle cx="17" cy="11" r="1.6" fill={c}/>
  </svg>
)}

// ── Tab bar móvil ──────────────────────────────────────────────
export function TabBar({ active, onChange }) {
  const mobileTabs = [
    MAIN_TABS[0],
    MAIN_TABS[1],
    {
      id: 'add', label: '', icon: () => (
        <div style={{
          width: 46, height: 46, borderRadius: 999, background: T.copper[500],
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 6px 16px rgba(184,122,86,0.45)', marginBottom: 2,
        }}>
          <svg width="20" height="20" viewBox="0 0 20 20">
            <path d="M10 3 V17 M3 10 H17" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/>
          </svg>
        </div>
      ),
    },
    MAIN_TABS[2],
    MOBILE_MORE_TAB,
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
        {mobileTabs.map(t => {
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

// ── Sidebar desktop ────────────────────────────────────────────
export function Sidebar({ active, onChange }) {
  return (
    <aside style={{
      position: 'fixed', left: 0, top: 0, bottom: 0, width: 230,
      background: '#fff',
      borderRight: `1px solid ${T.neutral[100]}`,
      display: 'flex', flexDirection: 'column',
      zIndex: 50,
    }}>
      {/* Logo */}
      <div style={{
        padding: '28px 22px 20px',
        display: 'flex', alignItems: 'center', gap: 12,
        borderBottom: `1px solid ${T.neutral[100]}`,
      }}>
        <TodyMark size={34} color={T.copper[500]}/>
        <div>
          <div style={{ fontSize: 19, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.6 }}>
            TodyPan
          </div>
          <div style={{ fontSize: 11, color: T.neutral[400], fontWeight: 500, marginTop: 1 }}>
            Gestión de panaderías
          </div>
        </div>
      </div>

      {/* Botón nuevo movimiento */}
      <div style={{ padding: '16px 14px 8px' }}>
        <button onClick={() => onChange('add')} style={{
          width: '100%', padding: '11px 14px', borderRadius: 12,
          background: T.copper[500], color: '#fff',
          border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 14, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          boxShadow: '0 3px 10px rgba(184,122,86,0.3)',
        }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 1 V13 M1 7 H13" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/>
          </svg>
          Nuevo movimiento
        </button>
      </div>

      {/* Navegación principal */}
      <nav style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {MAIN_TABS.map(t => <SidebarItem key={t.id} tab={t} active={active} onChange={onChange}/>)}
      </nav>

      {/* Separador */}
      <div style={{ margin: '4px 16px', borderTop: `1px solid ${T.neutral[100]}` }}/>

      {/* Sección secundaria */}
      <div style={{ padding: '2px 10px 0', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ padding: '4px 12px 6px', fontSize: 10, fontWeight: 700, color: T.neutral[300], textTransform: 'uppercase', letterSpacing: 0.8 }}>
          Gestión
        </div>
        {MORE_TABS.map(t => <SidebarItem key={t.id} tab={t} active={active} onChange={onChange}/>)}
      </div>

      <div style={{ flex: 1 }}/>

      {/* Footer */}
      <div style={{
        padding: '16px 22px',
        borderTop: `1px solid ${T.neutral[100]}`,
        fontSize: 11, color: T.neutral[300], fontWeight: 500,
      }}>
        TodyPan · versión 1.0
      </div>
    </aside>
  )
}

function SidebarItem({ tab: t, active, onChange }) {
  const isActive = active === t.id
  const c = isActive ? T.copper[600] : T.neutral[500]
  return (
    <button onClick={() => onChange(t.id)} style={{
      width: '100%', padding: '9px 12px', borderRadius: 10,
      background: isActive ? T.copper[50] : 'transparent',
      border: isActive ? `1px solid ${T.copper[100]}` : '1px solid transparent',
      cursor: 'pointer', fontFamily: 'inherit',
      display: 'flex', alignItems: 'center', gap: 11,
      color: c, fontSize: 14, fontWeight: isActive ? 700 : 500,
      textAlign: 'left', transition: 'background 0.12s',
    }}>
      {t.icon(c)}
      {t.label}
    </button>
  )
}

// ── Screen header ──────────────────────────────────────────────
export function ScreenHeader({ title, subtitle, right }) {
  const isDesktop = useIsDesktop()
  return (
    <div style={{
      padding: isDesktop ? '28px 32px 16px' : '56px 20px 12px',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {subtitle && (
          <div style={{ fontSize: 13, color: T.neutral[500], fontWeight: 500, marginBottom: 2 }}>{subtitle}</div>
        )}
        <div style={{ fontSize: isDesktop ? 26 : 28, fontWeight: 700, color: T.neutral[900], letterSpacing: -0.6, lineHeight: 1.15 }}>
          {title}
        </div>
      </div>
      {right && <div>{right}</div>}
    </div>
  )
}

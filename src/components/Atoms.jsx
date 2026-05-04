import { useState } from 'react'
import { T } from '../tokens'
import { fmtCOP } from '../utils/format'
import { getData } from '../db'

export function UserAvatar({ user, size = 36 }) {
  const initial = (user?.displayName || user?.email || '?').trim().charAt(0).toUpperCase()
  const [imgError, setImgError] = useState(false)

  if (user?.photoURL && !imgError) {
    return (
      <img
        src={user.photoURL}
        alt={user.displayName || user.email}
        referrerPolicy="no-referrer"
        onError={() => setImgError(true)}
        style={{
          width: size, height: size, borderRadius: 999, flexShrink: 0,
          objectFit: 'cover', background: T.copper[50],
        }}
      />
    )
  }

  return (
    <div style={{
      width: size, height: size, borderRadius: 999, flexShrink: 0,
      background: T.copper[100], color: T.copper[700],
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.42, fontWeight: 700,
    }}>
      {initial}
    </div>
  )
}

export function TodyMark({ size = 20, color = T.copper[500] }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
      <path d="M14 4 V10" stroke={color} strokeWidth="1.4" strokeLinecap="round"/>
      <path d="M14 6 Q11 6 10 4.5" stroke={color} strokeWidth="1.2" strokeLinecap="round" fill="none"/>
      <path d="M14 6 Q17 6 18 4.5" stroke={color} strokeWidth="1.2" strokeLinecap="round" fill="none"/>
      <path d="M14 9 Q11 9 10 7.5" stroke={color} strokeWidth="1.2" strokeLinecap="round" fill="none"/>
      <path d="M14 9 Q17 9 18 7.5" stroke={color} strokeWidth="1.2" strokeLinecap="round" fill="none"/>
      <path d="M5 18 Q5 12 14 12 Q23 12 23 18 Z" fill={color} fillOpacity="0.18" stroke={color} strokeWidth="1.4"/>
      <path d="M9 14 L11 17" stroke={color} strokeWidth="1" strokeLinecap="round"/>
      <path d="M13 13.5 L15 17" stroke={color} strokeWidth="1" strokeLinecap="round"/>
      <path d="M17 14 L19 17" stroke={color} strokeWidth="1" strokeLinecap="round"/>
      <path d="M3 21 H25" stroke={color} strokeWidth="1" strokeLinecap="round" opacity="0.5"/>
    </svg>
  )
}

export function BranchChip({ branch, size = 'md' }) {
  const b = T.branch[branch] || T.branch.both
  const branches = getData().branches || []
  const found = branches.find(br => br.id === branch)
  const label = found ? found.name : 'Ambas'
  const pad = size === 'sm' ? '2px 7px' : '3px 9px'
  const fs = size === 'sm' ? 10.5 : 11.5
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: pad, borderRadius: 999,
      background: b.tagBg, color: b.tag,
      fontSize: fs, fontWeight: 600, letterSpacing: 0.2, lineHeight: 1,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: 999, background: b.tag }} />
      {label}
    </span>
  )
}

export function CatIcon({ cat, size = 18, color }) {
  const c = color || T.neutral[600]
  const s = size
  const icons = {
    ventas_mostrador: <><rect x="3" y="8" width="14" height="9" rx="1" stroke={c} strokeWidth="1.4" fill="none"/><path d="M6 8 V6 Q6 4 10 4 Q14 4 14 6 V8" stroke={c} strokeWidth="1.4" fill="none"/></>,
    pedidos:    <><rect x="3" y="5" width="14" height="12" rx="1.5" stroke={c} strokeWidth="1.4" fill="none"/><path d="M6 9 H14 M6 12 H14 M6 15 H11" stroke={c} strokeWidth="1.2" strokeLinecap="round"/></>,
    domicilios: <><circle cx="6" cy="15" r="2" stroke={c} strokeWidth="1.4" fill="none"/><circle cx="14" cy="15" r="2" stroke={c} strokeWidth="1.4" fill="none"/><path d="M3 9 H12 L15 13 H17" stroke={c} strokeWidth="1.4" fill="none" strokeLinejoin="round"/></>,
    mayorista:  <><path d="M3 8 L10 4 L17 8 V16 L10 20 L3 16 Z" stroke={c} strokeWidth="1.4" fill="none" strokeLinejoin="round"/><path d="M3 8 L10 12 L17 8 M10 12 V20" stroke={c} strokeWidth="1.2" fill="none"/></>,
    harina:     <><path d="M5 17 Q5 8 10 8 Q15 8 15 17 Z" stroke={c} strokeWidth="1.4" fill="none"/><path d="M8 6 Q8 4 10 4 Q12 4 12 6" stroke={c} strokeWidth="1.4" fill="none"/><path d="M8 8 H12" stroke={c} strokeWidth="1.2"/></>,
    levadura:   <><circle cx="10" cy="10" r="6" stroke={c} strokeWidth="1.4" fill="none"/><circle cx="8" cy="9" r="1" fill={c}/><circle cx="12" cy="11" r="1" fill={c}/><circle cx="10" cy="13" r="0.8" fill={c}/></>,
    lacteos:    <><path d="M7 4 H13 V8 L14 10 V17 H6 V10 L7 8 Z" stroke={c} strokeWidth="1.4" fill="none" strokeLinejoin="round"/></>,
    huevos:     <><ellipse cx="10" cy="11" rx="5" ry="6" stroke={c} strokeWidth="1.4" fill="none"/></>,
    frutas:     <><path d="M10 5 Q5 6 5 12 Q5 17 10 17 Q15 17 15 12 Q15 6 10 5 Z" stroke={c} strokeWidth="1.4" fill="none"/><path d="M10 5 Q11 3 13 3" stroke={c} strokeWidth="1.2" strokeLinecap="round" fill="none"/></>,
    empaques:   <><path d="M3 7 L10 4 L17 7 V15 L10 18 L3 15 Z" stroke={c} strokeWidth="1.4" fill="none" strokeLinejoin="round"/><path d="M3 7 L10 10 L17 7" stroke={c} strokeWidth="1.2" fill="none"/></>,
    otros_prov: <><circle cx="10" cy="10" r="6" stroke={c} strokeWidth="1.4" fill="none"/><path d="M10 7 V10 L12 12" stroke={c} strokeWidth="1.4" strokeLinecap="round" fill="none"/></>,
    arriendo:   <><path d="M3 10 L10 4 L17 10 V17 H3 Z" stroke={c} strokeWidth="1.4" fill="none" strokeLinejoin="round"/><path d="M8 17 V12 H12 V17" stroke={c} strokeWidth="1.4" fill="none"/></>,
    energia:    <><path d="M11 3 L5 12 H10 L9 17 L15 8 H10 Z" stroke={c} strokeWidth="1.4" fill="none" strokeLinejoin="round"/></>,
    agua:       <><path d="M10 3 Q5 9 5 13 Q5 17 10 17 Q15 17 15 13 Q15 9 10 3 Z" stroke={c} strokeWidth="1.4" fill="none"/></>,
    gas:        <><path d="M10 4 Q7 7 8 10 Q6 11 6 14 Q6 17 10 17 Q14 17 14 14 Q14 10 10 4 Z" stroke={c} strokeWidth="1.4" fill="none"/></>,
    internet:   <><path d="M3 8 Q10 3 17 8 M5 11 Q10 7 15 11 M7 14 Q10 12 13 14" stroke={c} strokeWidth="1.4" fill="none" strokeLinecap="round"/><circle cx="10" cy="16" r="1" fill={c}/></>,
    aseo:       <><path d="M9 3 H11 V9 H9 Z" stroke={c} strokeWidth="1.4" fill="none"/><path d="M6 9 H14 L13 17 H7 Z" stroke={c} strokeWidth="1.4" fill="none" strokeLinejoin="round"/></>,
    reparacion: <><path d="M4 16 L11 9 M9 7 L13 3 L17 7 L13 11 Z" stroke={c} strokeWidth="1.4" fill="none" strokeLinejoin="round"/></>,
    equipo:     <><rect x="3" y="6" width="14" height="10" rx="1" stroke={c} strokeWidth="1.4" fill="none"/><circle cx="10" cy="11" r="2.5" stroke={c} strokeWidth="1.4" fill="none"/></>,
    mejora:     <><path d="M3 17 H17 M5 17 V11 H9 V17 M11 17 V7 H15 V17" stroke={c} strokeWidth="1.4" fill="none" strokeLinejoin="round"/></>,
    publicidad: <><path d="M4 8 V12 H7 L13 16 V4 L7 8 Z" stroke={c} strokeWidth="1.4" fill="none" strokeLinejoin="round"/></>,
    nomina:     <><circle cx="10" cy="8" r="3" stroke={c} strokeWidth="1.4" fill="none"/><path d="M4 17 Q4 12 10 12 Q16 12 16 17" stroke={c} strokeWidth="1.4" fill="none"/></>,
    campana:    <><path d="M5 8 Q5 4 10 4 Q15 4 15 8 V12 L17 15 H3 L5 12 Z" stroke={c} strokeWidth="1.4" fill="none" strokeLinejoin="round"/><path d="M8 16 Q8 18 10 18 Q12 18 12 16" stroke={c} strokeWidth="1.4" fill="none"/></>,
  }
  return (
    <svg width={s} height={s} viewBox="0 0 20 20" fill="none">
      {icons[cat] || icons.otros_prov}
    </svg>
  )
}

export function Card({ children, style, onClick, padding = 16 }) {
  return (
    <div onClick={onClick} style={{
      background: '#fff',
      borderRadius: 18,
      padding,
      boxShadow: '0 1px 2px rgba(45,35,25,0.04), 0 0 0 1px rgba(45,35,25,0.05)',
      cursor: onClick ? 'pointer' : 'default',
      ...style,
    }}>
      {children}
    </div>
  )
}

export function Amount({ value, sign = false, size = 16, weight = 600, color, compact = false }) {
  return (
    <span style={{
      fontSize: size, fontWeight: weight,
      color: color || T.neutral[800],
      fontVariantNumeric: 'tabular-nums',
      letterSpacing: -0.3,
    }}>
      {fmtCOP(value, { sign, compact })}
    </span>
  )
}

export function SectionHeader({ title, action, onAction }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      padding: '20px 20px 10px',
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: 0.6, color: T.neutral[500], textTransform: 'uppercase' }}>
        {title}
      </div>
      {action && (
        <button onClick={onAction} style={{
          background: 'none', border: 'none', padding: 0,
          fontSize: 14, fontWeight: 600, color: T.copper[500],
          cursor: 'pointer', fontFamily: 'inherit',
        }}>{action}</button>
      )}
    </div>
  )
}

export function Chip({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: '7px 14px', borderRadius: 999,
      border: active ? `1px solid ${T.copper[400]}` : `1px solid ${T.neutral[200]}`,
      background: active ? T.copper[50] : '#fff',
      color: active ? T.copper[700] : T.neutral[600],
      fontSize: 13, fontWeight: 600, cursor: 'pointer',
      fontFamily: 'inherit', whiteSpace: 'nowrap',
    }}>{label}</button>
  )
}

export function IconButton({ onClick, children, tint }) {
  return (
    <button onClick={onClick} style={{
      width: 36, height: 36, borderRadius: 999,
      background: tint || T.neutral[100],
      border: 'none', cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
    }}>{children}</button>
  )
}

export function BackButton({ onBack, label = 'Atrás' }) {
  return (
    <button onClick={onBack} style={{
      background: 'none', border: 'none', padding: '8px 0', cursor: 'pointer',
      color: T.copper[500], fontSize: 15, fontFamily: 'inherit', fontWeight: 500,
      display: 'flex', alignItems: 'center', gap: 4,
    }}>
      <svg width="10" height="16" viewBox="0 0 10 16">
        <path d="M8 2 L2 8 L8 14" stroke={T.copper[500]} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      {label}
    </button>
  )
}

export function EmptyState({ icon, title, subtitle }) {
  return (
    <div style={{ padding: '48px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>{icon}</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: T.neutral[700], marginBottom: 6 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 13, color: T.neutral[400] }}>{subtitle}</div>}
    </div>
  )
}

export function InputField({ label, value, onChange, type = 'text', placeholder = '' }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <div style={{ fontSize: 11, fontWeight: 600, color: T.neutral[500], textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>{label}</div>}
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%', padding: '12px 14px', borderRadius: 12,
          border: `1px solid ${T.neutral[200]}`,
          background: '#fff', fontSize: 15, color: T.neutral[800],
          fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
        }}
      />
    </div>
  )
}

export function Modal({ children, onClose, title }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'flex-end',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', background: '#fff',
        borderRadius: '24px 24px 0 0',
        padding: '24px 20px 40px',
        maxHeight: '85vh', overflowY: 'auto',
        animation: 'slideUp 0.25s cubic-bezier(0.2,0.9,0.3,1.1)',
      }}>
        {title && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: T.neutral[900] }}>{title}</div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: T.neutral[400], cursor: 'pointer', padding: 0 }}>×</button>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}

export function PrimaryButton({ label, onClick, disabled, color }) {
  return (
    <button onClick={disabled ? undefined : onClick} style={{
      width: '100%', padding: '15px', borderRadius: 14, border: 'none',
      background: disabled ? T.neutral[200] : (color || T.copper[500]),
      color: disabled ? T.neutral[400] : '#fff',
      fontSize: 16, fontWeight: 700, cursor: disabled ? 'default' : 'pointer',
      fontFamily: 'inherit', letterSpacing: 0.2,
    }}>{label}</button>
  )
}

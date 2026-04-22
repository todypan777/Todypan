import { useState } from 'react'
import { T } from '../tokens'
import { Card } from '../components/Atoms'
import { ScreenHeader } from '../components/Nav'
import { TodyMark } from '../components/Atoms'

export default function More({ onOpen }) {
  const items = [
    {
      id: 'movements', label: 'Movimientos', desc: 'Historial de ingresos y gastos',
      icon: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M3 6 H13 M3 6 L6 3 M3 6 L6 9" stroke={T.copper[600]} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M17 14 H7 M17 14 L14 11 M17 14 L14 17" stroke={T.copper[600]} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ),
    },
    {
      id: 'reports', label: 'Reportes', desc: 'Análisis del mes',
      icon: (
        <svg width="20" height="20" viewBox="0 0 20 20"><path d="M4 16 V8 M9 16 V4 M14 16 V11" stroke={T.copper[600]} strokeWidth="2" strokeLinecap="round"/><path d="M3 18 H17" stroke={T.copper[600]} strokeWidth="1.5" strokeLinecap="round"/></svg>
      ),
    },
    {
      id: 'reminders', label: 'Recordatorios', desc: 'Servicios y pagos fijos',
      icon: (
        <svg width="20" height="20" viewBox="0 0 20 20"><path d="M5 8 Q5 4 10 4 Q15 4 15 8 V12 L17 15 H3 L5 12 Z" stroke={T.copper[600]} strokeWidth="1.6" fill="none" strokeLinejoin="round"/><path d="M8 16 Q8 18 10 18 Q12 18 12 16" stroke={T.copper[600]} strokeWidth="1.6" fill="none"/></svg>
      ),
    },
    {
      id: 'branches', label: 'Panaderías', desc: 'Panadería Iglesia y Panadería Esquina',
      icon: (
        <svg width="20" height="20" viewBox="0 0 20 20"><path d="M3 9 L10 4 L17 9 V16 H3 Z" stroke={T.copper[600]} strokeWidth="1.6" fill="none" strokeLinejoin="round"/><path d="M8 16 V12 H12 V16" stroke={T.copper[600]} strokeWidth="1.6" fill="none"/></svg>
      ),
    },
  ]

  return (
    <div style={{ paddingBottom: 110 }}>
      <ScreenHeader title="Más" subtitle="TodyPan" right={<TodyMark size={30}/>}/>

      <div style={{ padding: '8px 16px 0' }}>
        <Card padding={0}>
          {items.map((it, i) => (
            <div key={it.id} onClick={() => onOpen(it.id)} style={{
              padding: '15px 16px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 14,
              borderBottom: i < items.length - 1 ? `0.5px solid ${T.neutral[100]}` : 'none',
            }}>
              <div style={{
                width: 38, height: 38, borderRadius: 10, background: T.copper[50],
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>{it.icon}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: T.neutral[800] }}>{it.label}</div>
                <div style={{ fontSize: 12, color: T.neutral[500], marginTop: 2 }}>{it.desc}</div>
              </div>
              <svg width="7" height="12" viewBox="0 0 7 12"><path d="M1 1 L6 6 L1 11" stroke={T.neutral[300]} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
          ))}
        </Card>
      </div>

      <div style={{ padding: '24px 20px', textAlign: 'center', color: T.neutral[400], fontSize: 11 }}>
        TodyPan · versión 1.0
      </div>
    </div>
  )
}

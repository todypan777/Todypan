import { useState } from 'react'
import { T } from '../tokens'
import { Card, TodyMark, UserAvatar } from '../components/Atoms'
import { ScreenHeader } from '../components/Nav'
import { useAuth } from '../context/AuthCtx'
import { getData } from '../db'
import { visibleBranches } from '../utils/branchScope'
import { anyBranchHasFeature } from '../utils/features'
import BranchViewSwitcher from '../components/BranchViewSwitcher'
import { signOut } from '../auth'
import ContactSupportButton from '../components/ContactSupportButton'

export default function More({ onOpen, userDoc, canViewAs, allBranches, viewAs, onViewAs }) {
  const { user } = useAuth()
  const [signingOut, setSigningOut] = useState(false)
  const [confirmSignOut, setConfirmSignOut] = useState(false)

  const items = [
    {
      id: 'team', label: 'Equipo', desc: 'Tu personal, turnos y asistencia',
      icon: (
        <svg width="20" height="20" viewBox="0 0 22 22" fill="none">
          <circle cx="8" cy="8" r="3" stroke={T.copper[600]} strokeWidth="1.7" fill="none"/>
          <path d="M2 18 Q2 12 8 12 Q14 12 14 18" stroke={T.copper[600]} strokeWidth="1.7" fill="none"/>
          <circle cx="15" cy="7" r="2.3" stroke={T.copper[600]} strokeWidth="1.5" fill="none"/>
          <path d="M13 13 Q15 11.5 17 12.5 Q20 13.5 20 17" stroke={T.copper[600]} strokeWidth="1.5" fill="none"/>
        </svg>
      ),
    },
    {
      id: 'movements', label: 'Movimientos', desc: 'Ingresos, gastos y ventas — todo en un lugar',
      icon: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M3 6 H13 M3 6 L6 3 M3 6 L6 9" stroke={T.copper[600]} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M17 14 H7 M17 14 L14 11 M17 14 L14 17" stroke={T.copper[600]} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ),
    },
    {
      feature: 'almuerzos',
      id: 'almuerzos', label: 'Almuerzos', desc: 'Cuántos almuerzos vendidos y qué se pidió más',
      icon: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          {/* Plato con cubiertos: minimalista y consistente con el resto */}
          <circle cx="11" cy="11" r="5.5" stroke={T.copper[600]} strokeWidth="1.6" fill="none"/>
          <circle cx="11" cy="11" r="2.2" stroke={T.copper[600]} strokeWidth="1.4" fill="none"/>
          <path d="M3 3 V8 Q3 9.5 4.5 9.5 V17" stroke={T.copper[600]} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ),
    },
    {
      feature: 'desayunos',
      id: 'desayunos', label: 'Desayunos', desc: 'Cuántos desayunos vendidos y qué combos se pidieron',
      icon: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          {/* Taza con vapor */}
          <path d="M5 8 H15 V13 Q15 16 12 16 H8 Q5 16 5 13 Z" stroke={T.copper[600]} strokeWidth="1.6" fill="none" strokeLinejoin="round"/>
          <path d="M15 9 H17 Q18 9 18 10 V11 Q18 12 17 12 H15" stroke={T.copper[600]} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M8 4 Q8 6 9 6 Q10 6 10 4" stroke={T.copper[600]} strokeWidth="1.4" fill="none" strokeLinecap="round"/>
          <path d="M11 4 Q11 6 12 6 Q13 6 13 4" stroke={T.copper[600]} strokeWidth="1.4" fill="none" strokeLinecap="round"/>
        </svg>
      ),
    },
    {
      id: 'deudores', label: 'Deudores', desc: 'Personas que deben y registrar pagos',
      icon: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="7" r="3" stroke={T.copper[600]} strokeWidth="1.6" fill="none"/>
          <path d="M3 17 Q3 11 10 11 Q17 11 17 17" stroke={T.copper[600]} strokeWidth="1.6" fill="none"/>
          <circle cx="14" cy="14" r="3.5" stroke={T.copper[600]} strokeWidth="1.4" fill="none"/>
          <path d="M14 12.5 V14 L15 14.8" stroke={T.copper[600]} strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
      ),
    },
    {
      id: 'transferencias', label: 'Transferencias', desc: 'Confirma las ventas por Nequi y Daviplata del día',
      icon: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M4 7 H15 M12 4 L15 7 L12 10" stroke={T.copper[600]} strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M16 13 H5 M8 16 L5 13 L8 10" stroke={T.copper[600]} strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ),
    },
    {
      id: 'tasks', label: 'Tareas', desc: 'Asigna pendientes a tus cajeras',
      icon: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <rect x="3" y="3" width="14" height="14" rx="3" stroke={T.copper[600]} strokeWidth="1.6" fill="none"/>
          <path d="M6.5 10 L9 12.5 L13.5 7.5" stroke={T.copper[600]} strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ),
    },
    {
      id: 'reports', label: 'Balance', desc: 'Ventas, costos y ganancia',
      icon: (
        <svg width="20" height="20" viewBox="0 0 20 20"><path d="M4 16 V8 M9 16 V4 M14 16 V11" stroke={T.copper[600]} strokeWidth="2" strokeLinecap="round"/><path d="M3 18 H17" stroke={T.copper[600]} strokeWidth="1.5" strokeLinecap="round"/></svg>
      ),
    },
    {
      id: 'inventario', label: 'Inventario', desc: 'Entradas, salidas y existencias',
      icon: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M3 6.5 L10 3 L17 6.5 V14 L10 17.5 L3 14 Z" stroke={T.copper[600]} strokeWidth="1.6" strokeLinejoin="round" fill="none"/>
          <path d="M3 6.5 L10 10 L17 6.5 M10 10 V17.5" stroke={T.copper[600]} strokeWidth="1.4" strokeLinejoin="round"/>
        </svg>
      ),
    },
    {
      id: 'products', label: 'Productos', desc: 'Costos, precios y márgenes de ganancia',
      icon: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <rect x="3" y="8" width="14" height="9" rx="2" stroke={T.copper[600]} strokeWidth="1.6" fill="none"/>
          <path d="M6 8 Q6 4 10 4 Q14 4 14 8" stroke={T.copper[600]} strokeWidth="1.6" fill="none"/>
          <path d="M7 12.5 H13 M9.5 11 V14" stroke={T.copper[600]} strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
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

  async function handleSignOut() {
    setSigningOut(true)
    try {
      await signOut()
    } catch (err) {
      console.error('Error al cerrar sesión:', err)
      setSigningOut(false)
      setConfirmSignOut(false)
    }
  }

  // Se ocultan las secciones que ninguna de sus panaderías usa. Una panadería
  // sin `features` las tiene todas, así que quien no haya configurado nada ve
  // exactamente el mismo menú de siempre.
  const misSedes = visibleBranches(userDoc, getData().branches || [])
  const visibles = items.filter(it => !it.feature || anyBranchHasFeature(misSedes, it.feature))

  return (
    <div style={{ paddingBottom: 110 }}>
      <ScreenHeader title="Más" subtitle="TodyPan" right={<TodyMark size={30}/>}/>

      {/* Solo para los dueños del sistema: permite ver la app tal cual la ve
          el dueño de cada panadería, sin tener que entrar con su cuenta. */}
      {canViewAs && (
        <BranchViewSwitcher
          branches={allBranches}
          value={viewAs}
          onChange={onViewAs}
        />
      )}

      {/* Bloque de cuenta */}
      {user && (
        <div style={{ padding: '4px 16px 12px' }}>
          <Card padding={0}>
            <div style={{
              padding: '14px 16px',
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <UserAvatar user={user} size={42} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 14.5, fontWeight: 700, color: T.neutral[900],
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {user.displayName || 'Administrador'}
                </div>
                <div style={{
                  fontSize: 12, color: T.neutral[500], marginTop: 1,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {user.email}
                </div>
              </div>
              <span style={{
                fontSize: 10, fontWeight: 700, color: T.copper[700],
                background: T.copper[50], padding: '3px 8px', borderRadius: 999,
                letterSpacing: 0.4, textTransform: 'uppercase', flexShrink: 0,
              }}>
                Admin
              </span>
            </div>
          </Card>
        </div>
      )}

      <div style={{ padding: '4px 16px 0' }}>
        <Card padding={0}>
          {visibles.map((it, i) => (
            <div key={it.id} onClick={() => onOpen(it.id)} style={{
              padding: '15px 16px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 14,
              borderBottom: i < visibles.length - 1 ? `0.5px solid ${T.neutral[100]}` : 'none',
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

      {/* Soporte */}
      <div style={{ padding: '16px 16px 0' }}>
        <ContactSupportButton
          variant="card"
          reason="Necesito ayuda con TodyPan (admin)"
          userContext={`Cuenta: ${user?.email || ''} (${user?.displayName || 'Admin'})`}
        />
      </div>

      {/* Cerrar sesión */}
      <div style={{ padding: '16px 16px 0' }}>
        <Card padding={0}>
          <button
            onClick={() => setConfirmSignOut(true)}
            style={{
              width: '100%', padding: '15px 16px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 14,
              background: 'none', border: 'none', fontFamily: 'inherit', textAlign: 'left',
            }}
          >
            <div style={{
              width: 38, height: 38, borderRadius: 10, background: '#FBE9E5',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M11 4 H6 Q4 4 4 6 V14 Q4 16 6 16 H11" stroke={T.bad} strokeWidth="1.6" fill="none" strokeLinecap="round"/>
                <path d="M14 7 L17 10 L14 13 M9 10 H17" stroke={T.bad} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: T.bad }}>Cerrar sesión</div>
            </div>
          </button>
        </Card>
      </div>

      <div style={{ padding: '24px 20px', textAlign: 'center', color: T.neutral[400], fontSize: 11 }}>
        TodyPan · versión 1.0
      </div>

      {confirmSignOut && (
        <SignOutModal
          busy={signingOut}
          onCancel={() => setConfirmSignOut(false)}
          onConfirm={handleSignOut}
        />
      )}
    </div>
  )
}

function SignOutModal({ busy, onCancel, onConfirm }) {
  return (
    <div
      onClick={busy ? undefined : onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 90,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 340,
          background: '#fff', borderRadius: 20,
          padding: '24px 22px',
          boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
          animation: 'fadeScaleIn 0.2s ease',
        }}
      >
        <div style={{
          fontSize: 17, fontWeight: 700, color: T.neutral[900],
          textAlign: 'center', marginBottom: 8, letterSpacing: -0.2,
        }}>
          Cerrar sesión
        </div>
        <div style={{
          fontSize: 13.5, color: T.neutral[600], textAlign: 'center',
          marginBottom: 22, lineHeight: 1.5,
        }}>
          ¿Seguro que quieres salir de TodyPan?
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onCancel}
            disabled={busy}
            style={{
              flex: 1, padding: '12px', borderRadius: 12,
              background: T.neutral[100], color: T.neutral[700],
              border: 'none', cursor: busy ? 'wait' : 'pointer',
              fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
            }}
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            style={{
              flex: 1, padding: '12px', borderRadius: 12,
              background: T.bad, color: '#fff',
              border: 'none', cursor: busy ? 'wait' : 'pointer',
              fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? 'Saliendo...' : 'Cerrar sesión'}
          </button>
        </div>
      </div>
    </div>
  )
}

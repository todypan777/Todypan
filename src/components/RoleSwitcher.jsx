import { T } from '../tokens'
import { sessionRoleLabel } from '../cashSessions'

/**
 * Lista de turnos abiertos del empleado para cambiar de rol desde el menú de
 * perfil. No renderiza nada si solo hay un turno (no hay nada que cambiar).
 *
 * Props:
 *   - sessions: array de sesiones abiertas del usuario.
 *   - currentId: id del turno activo (se marca y no es clickeable).
 *   - onSwitch(id): cambia el turno activo (lo maneja StaffApp).
 *   - onAfterSwitch(): opcional, se llama tras elegir (ej. cerrar el menú).
 */
export default function RoleSwitcher({ sessions, currentId, onSwitch, onAfterSwitch }) {
  if (!Array.isArray(sessions) || sessions.length < 2) return null
  return (
    <div style={{ padding: '8px 0', borderBottom: `1px solid ${T.neutral[100]}` }}>
      <div style={{
        padding: '4px 22px 8px', fontSize: 11, fontWeight: 800,
        letterSpacing: 0.5, textTransform: 'uppercase', color: T.neutral[500],
      }}>
        Cambiar de rol
      </div>
      {sessions.map(s => {
        const { label, icon } = sessionRoleLabel(s)
        const active = s.id === currentId
        return (
          <button
            key={s.id}
            onClick={() => { if (!active) { onSwitch?.(s.id); onAfterSwitch?.() } }}
            disabled={active}
            style={{
              width: '100%', padding: '12px 22px', textAlign: 'left',
              background: active ? T.copper[50] : 'transparent',
              border: 'none', cursor: active ? 'default' : 'pointer',
              fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 12,
            }}
          >
            <span style={{ fontSize: 18, width: 22, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.neutral[900] }}>{label}</div>
              {s.branchName && (
                <div style={{ fontSize: 11.5, color: T.neutral[500], marginTop: 1 }}>{s.branchName}</div>
              )}
            </span>
            {active && (
              <span style={{ fontSize: 11, fontWeight: 800, color: T.copper[600], flexShrink: 0 }}>Actual</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

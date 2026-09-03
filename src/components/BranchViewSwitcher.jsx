import { T } from '../tokens'

// ─────────────────────────────────────────────────────────────────────────────
// VER COMO — cambiar de panaderia para probar
//
// Solo para los correos dueños del sistema. Al elegir una panaderia, la app
// se comporta EXACTAMENTE como la ve el dueño de esa sede: mismo menu, mismas
// cuentas, mismas ventas, mismos fiados.
//
// No hay codigo especial detras: se le pone esa sede al usuario efectivo y
// todas las pantallas, que ya saben respetar el alcance por panaderia, hacen
// el resto. Si funciona aqui, funciona para el dueño real — que es justamente
// lo que se quiere poder comprobar.
//
// Es una vista, no un permiso: las reglas de Firestore siguen viendo al correo
// raiz y no le restringen nada. Sirve para PROBAR que la separacion se ve
// bien, no para demostrar que es segura; eso lo demuestran las reglas.
// ─────────────────────────────────────────────────────────────────────────────

export default function BranchViewSwitcher({ branches, value, onChange }) {
  if (!branches || branches.length === 0) return null

  const opciones = [{ id: null, name: 'Todas' }, ...branches]

  return (
    <div style={{ padding: '0 16px 4px' }}>
      <div style={{
        fontSize: 11, fontWeight: 700, color: T.neutral[500],
        letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8, paddingLeft: 2,
      }}>
        Ver como
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {opciones.map(o => {
          const activo = String(o.id) === String(value)
          return (
            <button
              key={String(o.id)}
              onClick={() => onChange(o.id)}
              style={{
                flex: '1 1 0', minWidth: 96, padding: '10px 12px', borderRadius: 12,
                cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
                border: activo ? `2px solid ${T.copper[500]}` : `1.5px solid ${T.neutral[200]}`,
                background: activo ? T.copper[50] : '#fff',
                color: activo ? T.copper[700] : T.neutral[600],
                transition: 'all 0.15s',
              }}
            >
              {o.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Aviso fijo mientras la vista está puesta en una panadería.
 *
 * Va siempre visible a propósito: sin él es facilísimo olvidar que se está
 * mirando una sola sede y creer que la app perdió datos.
 */
export function BranchViewBanner({ branchName, onClear }) {
  if (!branchName) return null
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 16px', background: T.copper[500], color: '#fff',
      fontSize: 12.5, fontWeight: 600,
    }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        Viendo como <b>{branchName}</b>
      </span>
      <button
        onClick={onClear}
        style={{
          border: '1px solid rgba(255,255,255,0.55)', background: 'transparent',
          color: '#fff', borderRadius: 8, padding: '4px 10px',
          fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        Ver todas
      </button>
    </div>
  )
}

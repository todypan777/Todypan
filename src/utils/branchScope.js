// ─────────────────────────────────────────────────────────────────────────────
// ALCANCE POR PANADERIA
//
// Un usuario puede tener `branchIds: [2]` en su documento. Eso significa "solo
// ve esta panaderia". Un usuario SIN `branchIds` no tiene restriccion y ve
// todo, que es como funciono la app hasta ahora.
//
// Ese default es deliberado: cuando esto se publique, el dueño anterior y su
// equipo siguen trabajando sin branchIds y su app no cambia en nada. La
// restriccion se activa persona por persona, asignandole su panaderia — no de
// golpe para todos.
//
// Las reglas de Firestore aplican exactamente el mismo criterio; esto es solo
// el lado del cliente, para que las consultas pidan unicamente lo que el
// usuario puede leer. Filtrar en pantalla no seria seguridad: cualquiera puede
// abrir la consola del navegador. Quien manda son las reglas.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Panaderías que puede ver el usuario, o `null` si no tiene restricción.
 * `null` y `[]` NO son lo mismo: null = ve todo; [] seria "no ve nada".
 */
export function userBranchIds(userDoc) {
  const list = userDoc?.branchIds
  if (!Array.isArray(list) || list.length === 0) return null
  return list
}

/** True si el usuario puede ver esa panadería. */
export function canSeeBranch(userDoc, branchId) {
  const allowed = userBranchIds(userDoc)
  if (allowed === null) return true
  return allowed.some(b => String(b) === String(branchId))
}

/** Las panaderías que el usuario puede ver, de una lista dada. */
export function visibleBranches(userDoc, branches = []) {
  const allowed = userBranchIds(userDoc)
  if (allowed === null) return branches
  return branches.filter(b => allowed.some(a => String(a) === String(b.id)))
}

// Panaderia a la que pertenecen los movimientos historicos.
//
// Hasta ahora AddMovement guardaba SIEMPRE `branch: 'both'` — no habia
// selector, asi que ningun gasto quedo atribuido a una panaderia concreta.
// Todo eso ocurrio mientras el dueño anterior manejaba el negocio, asi que se
// interpreta como suyo. No se reescriben los documentos: se traducen al
// leerlos. Reescribir el historico exigiria tocar el documento compartido
// mientras hay gente trabajando en el, y ahi se pierden datos.
export const LEGACY_MOVEMENT_BRANCH = 1

/** Panadería real de un movimiento, traduciendo el 'both' histórico. */
export function movementBranch(m) {
  if (!m) return null
  return (m.branch === 'both' || m.branch == null) ? LEGACY_MOVEMENT_BRANCH : m.branch
}

/** True si el movimiento pertenece a la panadería filtrada ('all' = todas). */
export function movementMatchesBranch(m, filter) {
  if (filter === 'all') return true
  return String(movementBranch(m)) === String(filter)
}

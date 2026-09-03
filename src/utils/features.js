// ─────────────────────────────────────────────────────────────────────────────
// FUNCIONES POR PANADERIA
//
// Mas de la mitad del codigo de esta app es un sistema de restaurante:
// almuerzos, desayunos, comandas a cocina, meseras, menu publico y pedidos web.
// Una panaderia de barrio que solo vende pan al mostrador no usa nada de eso, y
// tenerlo en pantalla le vuelve la app un laberinto.
//
// Borrarlo no es opcion: la otra panaderia si lo usa a diario.
//
// Entonces cada panaderia enciende lo que necesita. Mismo codigo, misma base de
// datos, dos aplicaciones distintas en la practica. Es tambien lo que permite
// vender esto a una tercera panaderia sin obligarla a cargar con funciones que
// no le sirven.
//
// El default es TODO ENCENDIDO: una panaderia sin `features` se comporta igual
// que siempre, asi que publicar esto no le cambia nada a quien ya venia
// trabajando. Apagar es una decision explicita de cada dueño.
// ─────────────────────────────────────────────────────────────────────────────

/** Catalogo de lo que se puede encender o apagar. */
export const FEATURES = [
  {
    key: 'almuerzos',
    label: 'Almuerzos',
    desc: 'Menú del día, corrientazo y comandas a la cocina',
  },
  {
    key: 'desayunos',
    label: 'Desayunos',
    desc: 'Combos de desayuno y sus precios',
  },
  {
    key: 'cocina',
    label: 'Cocina',
    desc: 'Pantalla de cocina, comandas y llamadas a la cajera',
  },
  {
    key: 'meseras',
    label: 'Meseras y mesas',
    desc: 'Tomar pedidos en mesa y cobrarlos después',
  },
  {
    key: 'menuWeb',
    label: 'Menú y pedidos por internet',
    desc: 'Página pública del menú y pedidos que llegan por WhatsApp',
  },
]

export const FEATURE_KEYS = FEATURES.map(f => f.key)

/**
 * True si la panaderia tiene encendida esa funcion.
 * Sin `features` definido = todo encendido (comportamiento historico).
 */
export function branchHasFeature(branch, key) {
  if (!branch) return true
  const f = branch.features
  if (!f || typeof f !== 'object') return true
  return f[key] !== false
}

/**
 * True si ALGUNA de las panaderias visibles la tiene encendida.
 *
 * Es la regla para el menu del admin: si maneja dos locales y solo uno vende
 * almuerzos, la seccion tiene que seguir a la vista. Ocultarla porque el otro
 * local no la usa le quitaria acceso a algo que si necesita.
 */
export function anyBranchHasFeature(branches, key) {
  if (!Array.isArray(branches) || branches.length === 0) return true
  return branches.some(b => branchHasFeature(b, key))
}

/** Mapa completo de una panadería, con los valores por defecto resueltos. */
export function branchFeatures(branch) {
  const out = {}
  for (const k of FEATURE_KEYS) out[k] = branchHasFeature(branch, k)
  return out
}

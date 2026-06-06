import { buildKitchenNoteFromCustomerItem, buildLunchCommanda } from './lunchFormat'

// ──────────────────────────────────────────────────────────────
// Pedidos web (/menu → customerOrders): utilidades compartidas para
// atender un pedido desde la caja. Las usan tanto el panel del admin
// (ActiveTurnsCard, modo asistir) como la cajera dueña del turno
// (CashierApp). Tener una sola fuente evita que las dos rutas conviertan
// el carrito de formas distintas.
// ──────────────────────────────────────────────────────────────

// Panadería destino de los pedidos web. Debe coincidir EXACTAMENTE con el
// nombre en Más → Panaderías. También se referencia en OrderConfirm.jsx.
export const WEB_ORDER_BRANCH_NAME = 'Panadería B'

// Convierte un item del cart de customerOrder al shape que usa el state
// `lunchCommanda` de NewSale (mismo que producen CashierLunchWizard /
// CashierSpecialWizard al armar un almuerzo).
// Los `replacements` (reemplazos del wizard cuando el cliente dice NO a
// sopa/principio) se concatenan al `note` para que viajen a cocina sin
// tocar el modelo de kitchenOrders.
export function customerOrderItemToLunchPayload(item) {
  // Desayuno: kind 'breakfast', selections con caldo/huevos/arroz/bebida.
  // El cliente web siempre pide para llevar.
  if (item.kind === 'breakfast') {
    return {
      kind: 'breakfast',
      productId: '__breakfast__',
      productName: item.comboName || 'Desayuno',
      destination: 'llevar',
      selections: item.selections || null,
      description: null,
      price: Number(item.price) || 0,
      note: (item.note || '').toString().trim() || null,
      comboId: item.comboId || null,
      comboName: item.comboName || null,
    }
  }
  const isEspecial = item.kind === 'especial'
  // Ambos (corriente y especial) pueden tener replacements en el note
  // (corriente: soup/principio, especial: solo soup).
  const note = buildKitchenNoteFromCustomerItem({
    replacements: item.replacements,
    note: item.note,
  })
  return {
    kind: isEspecial ? 'special' : 'menu',
    productId: null,
    productName: isEspecial ? 'Almuerzo Especial' : 'Almuerzo Corriente',
    destination: 'llevar',
    // El especial NUEVO tiene selections (soup, especial, salad); el viejo
    // tenía solo description. Pasamos ambos para máxima compatibilidad.
    selections: item.selections || null,
    description: isEspecial ? (item.description || null) : null,
    price: Number(item.price) || 0,
    note,
  }
}

// Convierte el cart COMPLETO (con almuerzos + adiciones) al lunchCommanda
// que entiende NewSale. Reusa el helper compartido — la única lógica
// específica del cliente es mapear cada almuerzo a su payload (eso lo
// hace customerOrderItemToLunchPayload).
export function customerCartToLunchCommanda(cart) {
  return buildLunchCommanda(cart, customerOrderItemToLunchPayload)
}

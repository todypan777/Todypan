import { useEffect, useMemo, useRef, useState } from 'react'
import { T } from '../tokens'
import { fmtCOP } from '../utils/format'
import { Card } from '../components/Atoms'
import { getData, setProductPriceForBranch } from '../db'
import { useBogotaDate, useBogotaHour } from '../utils/useBogotaDate'
import {
  watchCashierProducts,
  mergeProductCatalogs,
  createCashierProduct,
  setCashierProductPriceForBranch,
  getProductPrice,
} from '../products'
import { watchDebtors, addDebtSale, normalizeName } from '../debtors'
import { createSale } from '../sales'
import {
  watchOpenTabsForSession,
  createOpenTab,
  updateOpenTab,
  deleteOpenTab,
  nextFreeTableNumber,
  isTableNumberTaken,
  nextTableSuffix,
  formatTableLabel,
} from '../openTabs'
import { createKitchenOrder, newCommandaId, watchOrdersForTab, updateKitchenOrder, watchKitchenOrdersForDate } from '../kitchenOrders'
import { watchDailyMenu, watchMenuItems, watchCorrienteConfig, getCorrienteState, getSpecialState, getAddonPrices, countConsumedByItem } from '../menu'
import CashierLunchWizard from '../components/CashierLunchWizard'
import CashierSpecialWizard from '../components/CashierSpecialWizard'
import LunchTypeChooserModal from '../components/LunchTypeChooserModal'
import PublicAddonsModal from '../components/PublicAddonsModal'
import { buildLunchCommanda, formatAddonLine } from '../utils/lunchFormat'

/**
 * Pantalla "Nueva venta" para cajera.
 * Flow:
 *  1. Buscar producto en catálogo (admin + cajera)
 *  2. Click → añadir al carrito
 *  3. Si no existe el producto buscado → modal "Crear al vuelo"
 *  4. Editar cantidades en carrito
 *  5. Botón "Cobrar" → modal de método de pago
 *  6. Confirmar → guarda venta en Firestore
 */
export default function NewSale({
  session, authUser, userDoc, tab, assistMode,
  // Cuando admin entra a atender un pedido web (/comanda/{id}), recibe los
  // almuerzos pre-armados aquí. NewSale los carga en lunchCommanda y abre
  // el modal de envío automáticamente para que el admin solo ponga el
  // nombre del cliente y mande. Al enviar exitoso, si assistMode trae
  // `customerOrderId`, se marca ese pedido web como confirmado.
  initialLunchCommanda,
  // Modo "mesera": toma pedidos en piso para la caja de su panadería. Recibe
  // { waitressUid, waitressName }. La mesa/almuerzo se contabiliza a la cajera
  // dueña del turno (igual que asistir) pero la mesera NO ve precios y NO
  // cobra: solo arma la mesa y la deja lista para que la cajera cobre.
  waitressMode,
  onCancel, onSaved,
}) {
  // Modo "asistir": admin haciendo ventas en el turno de una cajera.
  // Las ventas/mesas quedan a nombre de la cajera (session.cashierUid),
  // pero registradas como recordedByUid del admin.
  const isAssistMode = !!assistMode

  // ── Modo mesera (ver descripción del prop arriba) ──
  const isWaitress = !!waitressMode
  // La mesera no ve dinero en ninguna parte del flujo.
  const hidePrices = isWaitress
  const actorUid = isWaitress ? (waitressMode.waitressUid || authUser.uid) : authUser.uid
  const actorName = isWaitress
    ? (waitressMode.waitressName || `${userDoc?.nombre || ''} ${userDoc?.apellido || ''}`.trim())
    : `${userDoc?.nombre || ''} ${userDoc?.apellido || ''}`.trim()
  // Dueño de cobro de la mesa/almuerzo: la cajera del turno cuando asiste el
  // admin o trabaja una mesera; si no, la propia cajera.
  const tabOwnerUid = (isAssistMode || isWaitress) ? (session.cashierUid || authUser.uid) : authUser.uid
  // Atribución de quién ABRIÓ la mesa — solo se marca para mesera (la burbuja
  // muestra su nombre y el aviso de "listo" la encuentra). Para asistir se
  // mantiene el recordedBy* de siempre.
  const tabAttribution = isWaitress
    ? { openedByUid: actorUid, openedByName: actorName, openedByRole: 'waitress' }
    : isAssistMode
      ? { recordedByUid: authUser.uid, recordedByName: assistMode.adminName, recordedByRole: 'admin' }
      : {}
  // Atribución del almuerzo en cocina (quién lo originó).
  const orderAttribution = isWaitress
    ? { createdByRole: 'waitress', createdByUid: actorUid, createdByName: actorName }
    : isAssistMode
      ? { createdByRole: 'admin', createdByUid: authUser.uid, createdByName: assistMode.adminName }
      : { createdByRole: 'cashier' }
  const [cashierProducts, refreshCashierProducts] = useCashierProducts()
  const adminProducts = getData().products || []
  const catalog = useMemo(
    () => mergeProductCatalogs(adminProducts, cashierProducts),
    [adminProducts, cashierProducts],
  )

  // Modo "edit tab": precargar items del tab y mostrar número editable
  const isTabMode = !!tab
  const [query, setQuery] = useState('')
  const [cart, setCart] = useState(() => tab?.items ? [...tab.items] : [])
  const [tableNumber, setTableNumber] = useState(tab?.tableNumber || null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createInitialName, setCreateInitialName] = useState('')
  const [paymentOpen, setPaymentOpen] = useState(false)
  // Modal "primera vez": producto que falta precio en la panaderia activa
  const [missingPriceProduct, setMissingPriceProduct] = useState(null)
  // Modal "¿De cuánto?" para productos de venta libre. Si trae editingKey,
  // se está editando un item del carrito; si no, se agrega uno nuevo.
  const [freeAmountTarget, setFreeAmountTarget] = useState(null)
  // Modal "convertir en mesa" (modo venta nueva)
  const [convertOpen, setConvertOpen] = useState(false)
  // Modal de almuerzo abierto (cuando la cajera escoge un producto isLunch)
  // shape: { product, kind: 'menu' | 'special' }
  const [lunchModal, setLunchModal] = useState(null)
  // Chooser que aparece al tocar "Almuerzo" o al pedir + Otro en cualquier
  // flujo. Boolean: true = abierto, false = cerrado.
  const [lunchChooserOpen, setLunchChooserOpen] = useState(false)
  // Modal de adición (sopa/huevo/proteína extra). null o 'menu' | 'soup'
  // | 'egg' | 'protein' (entrada directa al selector de cantidad).
  const [addonsModalState, setAddonsModalState] = useState(null)
  // Lo último que la cajera tipeó en el SendCommandaModal — persiste entre
  // aperturas del modal cuando agrega más items a la misma comanda. Sin
  // esto, cada nuevo item resetearía el número de mesa al default.
  const lastCommandaInputRef = useRef({ tableNumber: null, customerName: '' })
  // Comanda en construcción: lista de almuerzos seleccionados antes de enviar.
  // Cada item lleva SU PROPIA `note` — ya no hay nota global. Si la cajera
  // agrega varios almuerzos, cada uno carga su comentario independiente.
  // shape: [{ kind, productId, productName, destination, selections|description, price, note }]
  //
  // Si initialLunchCommanda viene poblada (admin entró a atender un pedido
  // web), arrancamos con esa comanda lista. Lazy init: el prop se lee una
  // sola vez al montar.
  const [lunchCommanda, setLunchCommanda] = useState(
    () => Array.isArray(initialLunchCommanda) && initialLunchCommanda.length > 0
      ? [...initialLunchCommanda]
      : []
  )
  // Modal de envío de la comanda (pide # de mesa o nombre cliente).
  // Si entramos con un pedido web pre-cargado, lo abrimos de una — los
  // almuerzos del pedido siempre son 'llevar', así que el modal pide el
  // nombre del cliente (obligatorio) y el admin lo escribe.
  // shape: { tableNumber, customerName, error, busy }
  const [sendCommandaModal, setSendCommandaModal] = useState(
    () => (Array.isArray(initialLunchCommanda) && initialLunchCommanda.length > 0)
      ? { tableNumber: 0, customerName: '', error: null, busy: false }
      : null
  )
  // Modal de confirmación para eliminar mesa (botón rojo del footer en modo
  // tab). shape: null | { busy, error }
  const [confirmDeleteTab, setConfirmDeleteTab] = useState(null)

  // Listener de tabs abiertas para validar números duplicados
  const [openTabs, setOpenTabs] = useState([])
  useEffect(() => watchOpenTabsForSession(session.id, setOpenTabs), [session.id])

  // Estado EN VIVO de los kitchenOrders de esta mesa. Necesario para saber
  // qué almuerzos siguen 'pending' (editables) vs 'ready' (ya cocinados,
  // no editables). El shim del carrito guarda un kitchenStatus estático que
  // no refleja la realidad — por eso watcheamos directo.
  const [tabOrders, setTabOrders] = useState([])
  useEffect(() => {
    if (!isTabMode || !tab?.id) { setTabOrders([]); return }
    return watchOrdersForTab(tab.id, setTabOrders)
  }, [isTabMode, tab?.id])
  // Mapa id → order para lookups O(1) en el render del carrito.
  const liveOrderById = useMemo(() => {
    const m = {}
    for (const o of tabOrders) m[o.id] = o
    return m
  }, [tabOrders])

  // Fecha REACTIVA — al cruzar medianoche, el watcher del dailyMenu salta al
  // doc del día nuevo (que estará vacío hasta que la cocinera lo configure).
  const today = useBogotaDate()

  // Listeners del menú del día y el catálogo de opciones (para evaluar si el
  // corriente está disponible: precio + sopas/proteínas/jugos activos).
  // El precio del corriente vive en un doc PERSISTENTE (no por día).
  const [dailyMenu, setDailyMenu] = useState(null)
  const [allMenuItems, setAllMenuItems] = useState([])
  const [corrienteConfig, setCorrienteConfig] = useState(null)
  useEffect(() => watchDailyMenu(today, setDailyMenu), [today])
  useEffect(() => watchMenuItems(setAllMenuItems), [])
  useEffect(() => watchCorrienteConfig(setCorrienteConfig), [])

  // Comandas de hoy → para saber cuántas porciones de cada opción ya se
  // vendieron y respetar el "quedan N" que fijó la cocinera (avisar/bloquear).
  const [dayOrders, setDayOrders] = useState([])
  useEffect(() => watchKitchenOrdersForDate(today, setDayOrders), [today])

  // Porciones consumidas por item = vendidas en comandas de hoy + las que ya
  // están en la comanda en construcción (sin enviar). En modo edición se
  // excluye el propio almuerzo que se corrige para no bloquearse a sí mismo.
  const consumedByItem = useMemo(() => {
    const editOrderId = lunchModal?.edit?.orderId || null
    const committed = editOrderId
      ? dayOrders.filter(o => o.id !== editOrderId)
      : dayOrders
    return countConsumedByItem([...committed, ...lunchCommanda])
  }, [dayOrders, lunchCommanda, lunchModal?.edit?.orderId])

  const branchId = session.branchId

  const total = cart.reduce((s, it) => s + it.qty * it.unitPrice, 0)

  // Catálogo enriquecido con productos VIRTUALES de almuerzo:
  //   - "Almuerzo Corriente" si está disponible (precio + opciones suficientes)
  //   - "Almuerzo Especial" si la cocinera lo activó hoy
  // Ambos definidos por la cocinera en el menú del día. NO vienen del admin.
  //
  // Estado del corriente, del especial y de los addons — usado tanto en
  // el catálogo virtual como en el modal chooser.
  const corrienteState = useMemo(
    () => getCorrienteState(dailyMenu, allMenuItems, corrienteConfig),
    [dailyMenu, allMenuItems, corrienteConfig]
  )
  // Estado completo del especial (incluye items publicados). Solo se
  // ofrece como opción si está available (active + tiene plato + precios).
  const specialState = useMemo(
    () => getSpecialState(dailyMenu, allMenuItems),
    [dailyMenu, allMenuItems]
  )
  const specialFromDay = specialState.available ? specialState : null
  const addonPrices = useMemo(
    () => getAddonPrices(corrienteConfig),
    [corrienteConfig]
  )
  const proteinOptionsForDay = useMemo(() => {
    const ids = dailyMenu?.itemsByCategory?.protein || []
    return ids
      .map(id => allMenuItems.find(m => m.id === id))
      .filter(m => m && !m.archived)
      .map(m => ({ id: m.id, name: m.name }))
  }, [dailyMenu, allMenuItems])
  const anyAddonAvailable = (
    addonPrices.soup > 0 ||
    addonPrices.egg > 0 ||
    (addonPrices.protein > 0 && proteinOptionsForDay.length > 0)
  )

  // Catálogo virtual: UN solo producto "Almuerzo" que al tocar abre el
  // chooser de tipo (corriente / especial / adición). Esto unifica el
  // flujo y permite que el cliente solo pida UNA sopa sin almuerzo
  // completo. Defensiva: filtra productos del admin con isLunch=true por
  // error histórico.
  const enrichedCatalog = useMemo(() => {
    const baseCatalog = catalog.filter(p => p.isLunch !== true)
    const anyLunchOptionAvailable = corrienteState.available || !!specialFromDay || anyAddonAvailable
    if (!anyLunchOptionAvailable) return baseCatalog
    // Precios "info" solo para mostrar en el cuadrito del catálogo.
    const priceForInfo = Number(corrienteState.priceMesa)
      || Number(specialFromDay?.priceMesa)
      || 0
    const priceLlevarForInfo = Number(corrienteState.priceLlevar)
      || Number(specialFromDay?.priceLlevar)
      || priceForInfo
    return [
      {
        id: '__lunch_chooser__',
        source: 'lunch',
        name: 'Almuerzo',
        isLunch: true,
        lunchKind: 'chooser',
        priceMesa: priceForInfo,
        priceLlevar: priceLlevarForInfo,
      },
      ...baseCatalog,
    ]
  }, [catalog, corrienteState, specialFromDay, anyAddonAvailable])

  // ── Acceso rápido a almuerzos en hora pico ──────────────────────
  // De 11am a 2:59pm (Bogotá), si la cocinera publicó menú/especial,
  // mostramos botones grandes debajo del buscador para que la cajera
  // no tenga que escribir "Almu" cuando hay voleo.
  const bogotaHour = useBogotaHour()
  const isLunchTime = bogotaHour >= 11 && bogotaHour < 15
  const availableLunchProducts = useMemo(
    () => enrichedCatalog.filter(p => p.isLunch === true),
    [enrichedCatalog]
  )
  const showLunchQuickAccess = isLunchTime && availableLunchProducts.length > 0

  const filtered = useMemo(() => {
    const q = normalizeName(query)
    if (!q) return enrichedCatalog.slice(0, 12)
    // Ordena por relevancia: el que empieza con la búsqueda va primero,
    // el que solo la contiene va al final. Así "Pan" sale arriba aunque
    // existan "Empanada", "Panela", etc.
    return enrichedCatalog
      .map(p => ({ p, score: scoreNameMatch(normalizeName(p.name), q) }))
      .filter(x => x.score >= 0)
      .sort((a, b) => a.score - b.score || a.p.name.localeCompare(b.p.name))
      .slice(0, 30)
      .map(x => x.p)
  }, [enrichedCatalog, query])

  const exactMatch = filtered.some(p => normalizeName(p.name) === normalizeName(query))
  const showCreateOption = query.trim().length >= 2 && !exactMatch

  function addProductToCart(product, unitPrice) {
    setCart(prev => {
      const existing = prev.findIndex(it => it.productId === product.id && it.source === product.source)
      if (existing >= 0) {
        const next = [...prev]
        next[existing] = { ...next[existing], qty: next[existing].qty + 1 }
        return next
      }
      return [
        ...prev,
        {
          key: `${product.source}_${product.id}`,
          productId: product.id,
          source: product.source,
          name: product.name,
          qty: 1,
          unitPrice: Number(unitPrice) || 0,
        },
      ]
    })
    setQuery('')
  }

  function handleSelectProduct(product) {
    // Producto unificado "Almuerzo": abre el chooser con 3 opciones
    // (corriente / especial / adición) para que la cajera elija.
    if (product.isLunch) {
      setLunchChooserOpen(true)
      setQuery('')
      return
    }
    // Mesera: nunca fija precios. Venta libre y productos sin precio en la
    // panadería entran en $0; la cajera pone el valor real al cobrar.
    if (isWaitress) {
      if (product.freeAmount) {
        setCart(prev => [
          ...prev,
          {
            key: `free_${product.source}_${product.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            productId: product.id,
            source: product.source,
            name: product.name,
            qty: 1,
            unitPrice: 0,
            freeAmount: true,
          },
        ])
        setQuery('')
        return
      }
      const wp = getProductPrice(product, branchId)
      addProductToCart(product, wp === null ? 0 : wp)
      return
    }
    // Productos de venta libre (ej: "Pan"): cajera escribe el monto al vender.
    // Se salta la lógica de "primera vez" porque no hay precio guardado.
    if (product.freeAmount) {
      setFreeAmountTarget({ product, editingKey: null })
      return
    }
    const price = getProductPrice(product, branchId)
    if (price !== null) {
      addProductToCart(product, price)
    } else {
      // Primera vez en esta panaderia: pedir precio
      setMissingPriceProduct(product)
    }
  }

  // Confirmar monto del producto de venta libre (agregar nuevo o editar existente)
  function handleConfirmFreeAmount(amount) {
    if (!freeAmountTarget) return
    const num = Number(amount)
    if (!num || num < 400) return
    const { product, editingKey } = freeAmountTarget

    if (editingKey) {
      // Edición de un item del carrito: solo actualiza unitPrice
      setCart(prev => prev.map(it =>
        it.key === editingKey ? { ...it, unitPrice: num } : it
      ))
    } else {
      // Nuevo item: cada agregado de venta libre es una línea independiente
      // (no agrupar como qty++) porque pueden ser montos distintos del mismo producto.
      setCart(prev => [
        ...prev,
        {
          key: `free_${product.source}_${product.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          productId: product.id,
          source: product.source,
          name: product.name,
          qty: 1,
          unitPrice: num,
          freeAmount: true,
        },
      ])
      setQuery('')
    }
    setFreeAmountTarget(null)
  }

  function handleConfirmFirstTimePrice(price) {
    const product = missingPriceProduct
    if (!product || !price || Number(price) <= 0) return
    const num = Number(price)
    // Agregar al carrito de inmediato — la cajera NO debe esperar Firestore.
    addProductToCart(product, num)
    setMissingPriceProduct(null)
    // Persistir el precio en background; si falla solo se queda como precio
    // del item del carrito (la venta igual queda con unitPrice congelado).
    if (product.source === 'admin') {
      try { setProductPriceForBranch(product.id, branchId, num) } catch (e) { console.warn('[POS] no se pudo persistir precio admin:', e) }
    } else if (product.source === 'cashier') {
      setCashierProductPriceForBranch(product.id, branchId, num)
        .catch(e => console.warn('[POS] no se pudo persistir precio cajera:', e))
    }
  }

  function addInlineToCart({ name, salePrice, productId }) {
    setCart(prev => [
      ...prev,
      {
        key: `inline_${Date.now()}`,
        productId: productId || null,
        source: productId ? 'cashier' : 'inline',
        name,
        qty: 1,
        unitPrice: Number(salePrice) || 0,
      },
    ])
    setQuery('')
  }

  function updateQty(key, delta) {
    setCart(prev => prev
      .map(it => it.key === key ? { ...it, qty: Math.max(0, it.qty + delta) } : it)
      .filter(it => it.qty > 0)
    )
  }

  // Quién está cancelando: en modo asistir es el admin, no la cajera dueña
  // del turno. Usamos authUser (el que tiene la sesión activa) + userDoc para
  // el nombre legible. Lo recalculamos en cada cancel — los datos son estables
  // mientras el componente está montado, no vale la pena memoizar.
  function currentActor() {
    const name = `${userDoc?.nombre || ''} ${userDoc?.apellido || ''}`.trim()
      || authUser?.email
      || null
    return { uid: authUser?.uid || null, name }
  }

  function removeItem(key) {
    setCart(prev => {
      const it = prev.find(x => x.key === key)
      // Si es un item shim de cocina, cancelamos el kitchenOrder asociado.
      // Lo hacemos best-effort sin esperar (UI optimista).
      if (it?.source === 'kitchen' && it.kitchenOrderId) {
        const actor = currentActor()
        import('../kitchenOrders').then(m =>
          m.cancelKitchenOrder(it.kitchenOrderId, {
            reason: 'Eliminado de la mesa',
            cancelledBy: actor.uid,
            cancelledByName: actor.name,
          })
        ).catch(err => console.warn('[NewSale] cancel kitchen order:', err))
      }
      return prev.filter(x => x.key !== key)
    })
  }

  // ── Handlers de mesas (tabs) ──

  // Minimizar: en modo tab, persiste cambios y vuelve. En modo venta nueva,
  // si hay items abre el modal de convertir; si no, cancela.
  // Si hay almuerzos en construcción sin enviar, preguntar para no perderlos.
  async function handleMinimize() {
    if (lunchCommanda.length > 0) {
      const ok = confirm(
        `Tienes ${lunchCommanda.length} ${lunchCommanda.length === 1 ? 'almuerzo' : 'almuerzos'} sin enviar a cocina. Si sales se pierden. ¿Continuar?`
      )
      if (!ok) return
      setLunchCommanda([])
    }
    if (isTabMode) {
      // Si la cajera vacio el carrito, eliminar la mesa (no dejar burbujas vacias)
      if (cart.length === 0) {
        try { await deleteOpenTab(tab.id) } catch (err) {
          console.warn('[NewSale] no se pudo eliminar mesa vacia:', err)
        }
        onCancel()
        return
      }
      // Persistir items actuales en la tab y salir
      try {
        await updateOpenTab(tab.id, { items: cart })
      } catch (err) {
        console.error('[NewSale] no se pudo guardar la mesa:', err)
      }
      onCancel()
      return
    }
    // Modo venta nueva: si NO hay items, equivale a cancelar
    if (cart.length === 0) {
      onCancel()
      return
    }
    // Hay items y no es tab → ofrecer convertir en mesa
    setConvertOpen(true)
  }

  // Convertir venta nueva → mesa con número escogido.
  // Devuelve un mensaje de error si falla, null si OK (para que el modal lo muestre).
  async function handleConvertToTab(numberToUse) {
    try {
      await createOpenTab({
        sessionId: session.id,
        cashierUid: tabOwnerUid,
        branchId: session.branchId,
        branchName: session.branchName,
        tableNumber: numberToUse,
        items: cart,
        ...tabAttribution,
      })
      setConvertOpen(false)
      onCancel() // cerrar el modal de venta; la burbuja aparecerá vía listener
      return null
    } catch (err) {
      console.error('[NewSale] no se pudo crear la mesa:', err)
      // Detectar errores típicos de Firestore para mostrar mensaje claro
      const code = err?.code || ''
      if (code === 'permission-denied') {
        return 'Las reglas de Firestore bloquean crear mesas. El admin debe habilitar /openTabs en Firebase.'
      }
      if (code === 'unavailable' || code === 'failed-precondition') {
        return 'Sin conexión a la base de datos. Verifica tu red.'
      }
      return `No se pudo crear la mesa. ${err?.message || 'Intenta de nuevo.'}`
    }
  }

  // Guardar el carrito actual como pedido "para llevar" (mesera, cart sin
  // almuerzos). Devuelve mensaje de error o null si OK.
  async function handleConvertToLlevar(name) {
    const cn = String(name || '').trim()
    if (!cn) return 'Pon un nombre para identificar al cliente.'
    try {
      await createOpenTab({
        sessionId: session.id,
        cashierUid: tabOwnerUid,
        branchId: session.branchId,
        branchName: session.branchName,
        kind: 'llevar',
        customerName: cn,
        items: cart,
        ...tabAttribution,
      })
      setConvertOpen(false)
      onCancel()
      return null
    } catch (err) {
      console.error('[NewSale] no se pudo crear el pedido para llevar:', err)
      const code = err?.code || ''
      if (code === 'permission-denied') {
        return 'Las reglas de Firestore bloquean crear pedidos. El admin debe habilitar /openTabs en Firebase.'
      }
      return `No se pudo guardar el pedido. ${err?.message || 'Intenta de nuevo.'}`
    }
  }

  // Abre el SendCommandaModal preservando los valores que la cajera ya
  // tipeó (mesa #, nombre cliente) si abrió el modal antes y luego volvió
  // a agregar otro item. Si es la primera vez, usa defaults.
  function openSendCommandaModal() {
    const last = lastCommandaInputRef.current
    setSendCommandaModal({
      tableNumber: last.tableNumber ?? (tableNumber || nextFreeTableNumber(openTabs)),
      customerName: last.customerName || '',
      error: null,
      busy: false,
    })
  }

  // ── Handlers de almuerzos ──
  function handleAddLunchToCommanda(payload, { another }) {
    setLunchCommanda(prev => [...prev, payload])
    if (another) {
      // El modal hace su propio reset; mantenemos abierto.
      return
    }
    // Cerrar modal y abrir el de envío de comanda
    setLunchModal(null)
    openSendCommandaModal()
  }

  // Adición agregada desde PublicAddonsModal. Entra al lunchCommanda como
  // item con kind 'addon'. handleSendCommanda lo procesará al enviar:
  // concatenándolo al note del primer almuerzo si hay; o creando un
  // "especial sintético" si solo hay adiciones.
  function handleAddAddonToCommanda(payload) {
    setLunchCommanda(prev => [...prev, payload])
    setAddonsModalState(null)
    openSendCommandaModal()
  }

  // Abre el chooser de tipo desde donde sea (POS principal, SendCommandaModal,
  // o CashierLunchWizard next-action). Cierra todos los demás modales para
  // evitar superposición.
  function openLunchChooser() {
    setSendCommandaModal(null)
    setLunchModal(null)
    setAddonsModalState(null)
    setLunchChooserOpen(true)
  }
  function handleChooseCorriente() {
    setLunchChooserOpen(false)
    setLunchModal({
      kind: 'menu',
      product: {
        id: '__lunch_corriente__',
        name: 'Almuerzo Corriente',
        priceMesa: corrienteState.priceMesa,
        priceLlevar: corrienteState.priceLlevar,
      },
    })
  }
  function handleChooseSpecial() {
    if (!specialFromDay) return
    setLunchChooserOpen(false)
    setLunchModal({
      kind: 'special',
      product: { name: 'Almuerzo Especial' },
    })
  }
  function handleChooseAddon() {
    setLunchChooserOpen(false)
    setLunchModal(null)
    setAddonsModalState('menu')
  }

  // Eliminar un almuerzo de la comanda en construcción (antes de enviarla a
  // cocina). Permite a la cajera corregir un error sin perder los demás.
  function handleRemoveLunchFromCommanda(index) {
    setLunchCommanda(prev => {
      const next = prev.filter((_, i) => i !== index)
      // Si se queda sin almuerzos, también cerramos el modal de envío y
      // reseteamos los valores persistidos — la próxima comanda arranca fresh.
      if (next.length === 0) {
        setSendCommandaModal(null)
        lastCommandaInputRef.current = { tableNumber: null, customerName: '' }
      }
      return next
    })
  }

  // Reabrir el flujo de pedido para agregar otro item a la misma comanda.
  // Antes reabría el último tipo. Ahora abre el chooser unificado para que
  // la cajera pueda mezclar corriente / especial / adición libremente.
  function handleAddAnotherLunch() {
    if (lunchCommanda.length === 0) return
    openLunchChooser()
  }

  // Convierte cada almuerzo de la comanda en un item shim para el carrito de la mesa.
  // Guarda denormalizado lo necesario para que la cajera pueda RE-VER las
  // selecciones después de enviar (sin tener que ir a buscar el kitchenOrder).
  function lunchToCartItem(lunch, kitchenOrderId) {
    const destLabel = lunch.destination === 'llevar' ? '📦 Para llevar' : '🍽️ Mesa'
    return {
      key: `lunch_${kitchenOrderId}`,
      productId: lunch.productId || null,
      source: 'kitchen',
      kitchenOrderId,
      kitchenStatus: 'pending',
      name: `${lunch.productName} · ${destLabel}`,
      qty: 1,
      unitPrice: Number(lunch.price) || 0,
      // Denormalizado para que CartItem pueda mostrar lo que se envió:
      lunchKind: lunch.kind,                  // 'menu' | 'special'
      lunchDestination: lunch.destination,    // 'mesa' | 'llevar'
      lunchProductName: lunch.productName,    // sin el sufijo del destino
      lunchSelections: lunch.selections || null,    // {soup,principio,...}
      lunchDescription: lunch.description || null,  // para 'special'
      // Nota PER-ALMUERZO. El campo Firestore se mantiene como `commandaNote`
      // para no romper datos viejos, pero semánticamente ahora es per-lunch.
      commandaNote: lunch.note || null,
    }
  }

  // ── Edición de almuerzo YA enviado a cocina ──
  // La cajera toca un almuerzo del carrito que ya está en cocina. Si sigue
  // 'pending' lo puede corregir; si la cocinera ya lo marcó 'ready', no.
  function handleEditKitchenItem(item) {
    const order = liveOrderById[item.kitchenOrderId]
    if (!order) {
      alert('Estoy cargando el estado del almuerzo. Intenta de nuevo en un segundo.')
      return
    }
    if (order.status !== 'pending') {
      if (order.status === 'ready') {
        alert('Este almuerzo ya está LISTO en cocina — no se puede modificar. Si hay un error, quítalo con la ✕ y agrega uno nuevo.')
      } else {
        alert('Este almuerzo ya no se puede modificar.')
      }
      return
    }

    if (order.kind === 'special') {
      setLunchModal({
        kind: 'special',
        product: { name: 'Almuerzo Especial' },
        edit: {
          orderId: order.id,
          cartKey: item.key,
          // Nuevo modelo: selections (soup, especial, salad). Backward-compat:
          // si solo hay description (datos viejos), la pasamos como fallback.
          initialSelections: order.selections || null,
          initialDescription: order.description || '',
          initialNote: order.commandaNote || '',
          initialDestination: order.destination || null,
          initialPrice: Number(order.price) || 0,
        },
      })
      return
    }

    // kind 'menu' — reconstruir el producto con los precios ACTUALES del
    // corriente para que pueda re-cotizar si cambia mesa↔llevar. Si el
    // corriente ya no está disponible, caemos al precio del propio pedido.
    const corrienteState = getCorrienteState(dailyMenu, allMenuItems, corrienteConfig)
    const fallbackPrice = Number(order.price) || 0
    const product = {
      id: order.productId || '__lunch_corriente__',
      name: order.productName || 'Almuerzo Corriente',
      priceMesa: corrienteState.priceMesa || fallbackPrice,
      priceLlevar: corrienteState.priceLlevar || fallbackPrice,
    }
    setLunchModal({
      kind: 'menu',
      product,
      edit: {
        orderId: order.id,
        cartKey: item.key,
        initialSelections: order.selections || {},
        initialNote: order.commandaNote || '',
        initialDestination: order.destination || null,
      },
    })
  }

  // Guarda la corrección: actualiza el kitchenOrder en Firestore y refleja
  // el cambio en el shim del carrito + persiste la openTab. UI optimista —
  // el updateKitchenOrder es fire-and-forget (modo ahorro / offline).
  function handleSaveKitchenEdit(payload) {
    const edit = lunchModal?.edit
    if (!edit) return

    updateKitchenOrder(edit.orderId, {
      destination: payload.destination,
      selections: payload.kind === 'menu' ? payload.selections : undefined,
      description: payload.kind === 'special' ? payload.description : undefined,
      note: payload.note,
      price: payload.price,
    }).catch(err => console.warn('[NewSale] updateKitchenOrder deferred:', err?.message || err))

    const destLabel = payload.destination === 'llevar' ? '📦 Para llevar' : '🍽️ Mesa'
    const nextCart = cart.map(it => {
      if (it.key !== edit.cartKey) return it
      return {
        ...it,
        name: `${payload.productName} · ${destLabel}`,
        unitPrice: Number(payload.price) || 0,
        lunchDestination: payload.destination,
        lunchSelections: payload.kind === 'menu' ? payload.selections : null,
        lunchDescription: payload.kind === 'special' ? payload.description : null,
        commandaNote: payload.note || null,
      }
    })
    setCart(nextCart)
    if (isTabMode && tab?.id) {
      updateOpenTab(tab.id, { items: nextCart }).catch(err =>
        console.warn('[NewSale] persistir edición del shim deferred:', err?.message || err))
    }
    setLunchModal(null)
  }

  // Envía la comanda: crea mesa si no existe, kitchenOrders, items shim al carrito.
  // Orden de operaciones diseñado para que un fallo intermedio NO deje datos huérfanos:
  //   1. Crear/usar openTab (con o sin items normales).
  //   2. Crear kitchenOrders apuntando al tabId REAL.
  //   3. Actualizar la openTab para incluir los items shim.
  // Si falla en el paso 2, la mesa queda creada normal (sin shims) y la cajera
  // ve sus items normales — los almuerzos no se cobran sin haberse cocinado.
  //
  // payload: { kind: 'mesa' | 'llevar', tableNumber?: number, customerName?: string }
  //   En modo tab (mesa ya abierta), kind se ignora — se usa el de la tab existente.
  async function handleSendCommanda(payload) {
    if (lunchCommanda.length === 0) return null
    const ownerUid = tabOwnerUid
    const cashierName = session.cashierName || `${userDoc?.nombre || ''} ${userDoc?.apellido || ''}`.trim()
    const commandaId = newCommandaId()

    try {
      let targetTabId
      let targetTableNumber = null
      let targetTableSuffix = 0
      let targetCustomerName = null
      let targetTabKind = 'mesa'

      // Paso 1: asegurar la mesa o el "ticket llevar".
      if (!isTabMode) {
        targetTabKind = payload.kind === 'llevar' ? 'llevar' : 'mesa'
        if (targetTabKind === 'mesa') {
          const numberToUse = Number(payload.tableNumber)
          if (!numberToUse || numberToUse <= 0) {
            return 'Pon un número de mesa válido.'
          }
          // Si la mesa ya existe (otro grupo en la misma mesa física),
          // asignar sufijo .1, .2, etc. Nunca combinar — son cuentas
          // independientes aunque compartan mesa.
          const suffix = nextTableSuffix(openTabs, numberToUse)
          targetTableNumber = numberToUse
          targetTableSuffix = suffix
          targetTabId = await createOpenTab({
            sessionId: session.id,
            cashierUid: ownerUid,
            branchId: session.branchId,
            branchName: session.branchName,
            kind: 'mesa',
            tableNumber: numberToUse,
            tableSuffix: suffix,
            items: cart,
            ...tabAttribution,
          })
        } else {
          // kind === 'llevar' — necesita nombre del cliente.
          const cn = String(payload.customerName || '').trim()
          if (!cn) return 'Pon un nombre para identificar al cliente.'
          targetCustomerName = cn
          targetTabId = await createOpenTab({
            sessionId: session.id,
            cashierUid: ownerUid,
            branchId: session.branchId,
            branchName: session.branchName,
            kind: 'llevar',
            customerName: cn,
            items: cart,
            ...tabAttribution,
          })
        }
      } else {
        targetTabId = tab.id
        targetTabKind = tab.kind || 'mesa'
        targetTableNumber = tab.tableNumber || null
        targetTableSuffix = Number(tab.tableSuffix) || 0
        targetCustomerName = tab.customerName || null
      }

      // Paso 2: pre-procesar las adiciones antes de crear los kitchenOrders.
      // buildLunchCommanda mergea las adiciones al primer almuerzo (como nota)
      // o crea un "Almuerzo Especial" sintético si solo hay adiciones.
      // El destination del sintético se ajusta al tab real (mesa o llevar).
      const processedCommanda = buildLunchCommanda(lunchCommanda, lunch => lunch)
        .map(item => {
          if (item.productName === 'Adiciones') {
            return { ...item, destination: targetTabKind === 'llevar' ? 'llevar' : 'mesa' }
          }
          return item
        })

      // Paso 3: crear los kitchenOrders apuntando al tabId real.
      // tableNumber puede ser null cuando la tab es 'llevar' — la cocinera
      // verá el customerName en lugar del número.
      const orderIds = []
      for (const lunch of processedCommanda) {
        const orderId = await createKitchenOrder({
          tabId: targetTabId,
          tableNumber: targetTableNumber,
          tableSuffix: targetTableSuffix,
          customerName: targetCustomerName,
          sessionId: session.id,
          branchId: session.branchId,
          branchName: session.branchName,
          cashierUid: ownerUid,
          cashierName,
          destination: lunch.destination,
          kind: lunch.kind,
          selections: lunch.selections || null,
          description: lunch.description || null,
          price: lunch.price,
          productId: lunch.productId,
          productName: lunch.productName,
          commandaId,
          // commandaNote es per-almuerzo. Mantenemos el nombre del campo
          // por backward compat con la cocina que ya lo lee.
          commandaNote: lunch.note || null,
          ...orderAttribution,
        })
        orderIds.push(orderId)
      }

      // Paso 4: agregar los items shim a la openTab (final).
      const lunchItems = processedCommanda.map((lunch, i) => lunchToCartItem(lunch, orderIds[i]))
      const finalCart = [...cart, ...lunchItems]
      setCart(finalCart)
      await updateOpenTab(targetTabId, { items: finalCart })

      // Si veniamos de un pedido web (/comanda/{id}), marcarlo como
      // confirmado para que el cliente y otros que abran el link vean
      // "✓ Pedido confirmado". Fire-and-forget — no bloquea el cierre.
      if (assistMode?.customerOrderId) {
        import('../customerOrders').then(m =>
          m.markCustomerOrderConfirmed(assistMode.customerOrderId, {
            confirmedBy: authUser.uid,
            confirmedByName: assistMode.adminName || null,
            customerName: targetCustomerName,
            tabId: targetTabId,
            orderIds,
          })
        ).catch(err =>
          console.warn('[NewSale] no se pudo marcar customerOrder confirmado:', err?.message || err))
      }

      // Reset y cerrar
      setLunchCommanda([])
      setSendCommandaModal(null)
      setLunchModal(null)
      lastCommandaInputRef.current = { tableNumber: null, customerName: '' }
      onCancel() // vuelve al home — la burbuja roja aparece sola
      return null
    } catch (err) {
      console.error('[NewSale] enviar comanda falló:', err)
      const code = err?.code || ''
      if (code === 'permission-denied') {
        return 'Las reglas de Firestore bloquean. El admin debe habilitar /kitchenOrders y /openTabs.'
      }
      return `No se pudo enviar la comanda. ${err?.message || 'Intenta de nuevo.'}`
    }
  }

  // Auto-cleanup: si está editando una mesa y la deja vacía, eliminar la mesa
  // y cerrar el modal. La cajera elimina mesa quitando todos los items.
  useEffect(() => {
    if (isTabMode && cart.length === 0) {
      let cancelled = false
      ;(async () => {
        try { await deleteOpenTab(tab.id) } catch (err) {
          console.warn('[NewSale] no se pudo eliminar mesa vacia:', err)
        }
        if (!cancelled) onCancel()
      })()
      return () => { cancelled = true }
    }
  }, [isTabMode, cart.length, tab?.id])

  // Cambio de número de mesa (solo en modo tab) — valida duplicados
  async function handleChangeTableNumber(newNumber) {
    const num = Number(newNumber)
    if (!num || num <= 0) return false
    if (isTableNumberTaken(openTabs, num, tab.id)) {
      return false // UI debe avisar
    }
    try {
      await updateOpenTab(tab.id, { tableNumber: num })
      setTableNumber(num)
      return true
    } catch (err) {
      console.error('[NewSale] no se pudo cambiar el número:', err)
      return false
    }
  }

  // Después de cobrar exitoso: si era tab, eliminarla. También cualquier
  // kitchenOrder activo asociado pasa a 'delivered' (la cajera entregó).
  async function handleSaleConfirmed() {
    if (isTabMode) {
      // Almuerzos de cocina de esta mesa.
      const kitchenItems = cart.filter(it => it.source === 'kitchen' && it.kitchenOrderId)
      // Fire-and-forget: en modo ahorro el await de updateDoc/deleteDoc se
      // cuelga. La cajera ya cobró — no hay que bloquearla esperando red.
      if (kitchenItems.length > 0) {
        import('../kitchenOrders').then(m => {
          kitchenItems.forEach(it => {
            // Estado EN VIVO del almuerzo (el shim del carrito puede estar viejo).
            const status = liveOrderById[it.kitchenOrderId]?.status || it.kitchenStatus || 'pending'
            if (status === 'ready') {
              // Ya estaba cocinado → al cobrar queda entregado (va a Archivados).
              m.markOrderDelivered(it.kitchenOrderId).catch(err =>
                console.warn('[NewSale] markOrderDelivered deferred:', err?.message || err))
            } else if (status === 'pending') {
              // Todavía se está cocinando → solo lo marcamos PAGADO y lo dejamos
              // en la cola de cocina. Pasará a entregado cuando la cocinera lo
              // marque Listo. Así no desaparece de la cocina al cobrar.
              m.markOrderPaid(it.kitchenOrderId)
            }
            // delivered/cancelled → no tocar.
          })
        })
      }
      deleteOpenTab(tab.id).catch(err =>
        console.warn('[NewSale] deleteOpenTab deferred tras cobro:', err?.message || err))
    }
    setPaymentOpen(false)
    onSaved?.()
  }

  return (
    <div style={{
      // height (no minHeight) + overflowY: auto convierten a NewSale en su
      // propio contenedor scrollable. Necesario porque NewSale siempre se
      // monta dentro de un wrapper `position: fixed; inset: 0` (CashierApp,
      // ActiveTurnsCard modo asistir): ese wrapper fija el tamaño al
      // viewport y bloquea el scroll del documento. Sin esto, los últimos
      // items del carrito quedan tapados por el footer sticky con muchos
      // almuerzos y no hay manera de hacer scroll.
      height: '100dvh', background: T.neutral[50],
      display: 'flex', flexDirection: 'column',
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
    }}>
      {/* Header (fondo full-width, contenido en maxWidth) */}
      <div style={{
        background: '#fff', borderBottom: `1px solid ${T.neutral[100]}`,
        position: 'sticky', top: 0, zIndex: 20,
      }}>
        <div style={{
          maxWidth: 640, margin: '0 auto',
          padding: '16px 18px',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <button
            onClick={handleMinimize}
            title={isTabMode ? 'Minimizar mesa' : (cart.length > 0 ? 'Convertir en mesa' : 'Cancelar')}
            style={{
              width: 36, height: 36, borderRadius: 999,
              background: T.neutral[100], border: 'none',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {isTabMode ? (
              // Ícono "minimizar a burbuja"
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M3 11 L3 14 L6 14 M15 7 L15 4 L12 4" stroke={T.neutral[700]} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M11 4 L5 9 L11 14" stroke={T.neutral[700]} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: isTabMode && (tab?.kind || 'mesa') === 'llevar' ? 19 : 17,
              fontWeight: 800, color: T.neutral[900], letterSpacing: -0.2,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {isTabMode
                ? ((tab?.kind || 'mesa') === 'llevar'
                    ? `📦 ${tab?.customerName || 'Cliente'}`
                    : `Mesa ${formatTableLabel(tab)}`)
                : 'Nueva venta'}
            </div>
            <div style={{ fontSize: 12, color: T.neutral[500] }}>
              {isTabMode && (tab?.kind || 'mesa') === 'llevar' && (
                <span style={{ color: '#9A7200', fontWeight: 700 }}>Para llevar · </span>
              )}
              {session.branchName || 'Panadería'}
              {isAssistMode && session.cashierName && ` · turno de ${session.cashierName}`}
              {isTabMode && tab?.openedByRole === 'waitress' && tab?.openedByName &&
                ` · abrió ${tab.openedByName.split(' ')[0]}`}
            </div>
          </div>
          {isTabMode && (tab?.kind || 'mesa') === 'mesa' && (
            <TableNumberEditButton
              currentNumber={tableNumber}
              openTabs={openTabs}
              currentTabId={tab.id}
              onChange={handleChangeTableNumber}
            />
          )}
        </div>
      </div>

      {/* Banner modo asistir: aviso para que el admin no se confunda */}
      {isAssistMode && (
        <div style={{
          background: '#FFF7E6', borderBottom: `1px solid #F4E0BC`,
        }}>
          <div style={{
            maxWidth: 640, margin: '0 auto',
            padding: '10px 18px',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: 999, flexShrink: 0,
              background: T.warn, color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, fontWeight: 800,
            }}>
              !
            </div>
            <div style={{ flex: 1, fontSize: 12.5, color: '#7A5C00', lineHeight: 1.4 }}>
              <b>Asistiendo el turno de {session.cashierName || 'la cajera'}.</b><br/>
              La venta se contabiliza a su caja. Deja el efectivo en caja.
            </div>
          </div>
        </div>
      )}

      {/* Banner: comanda en construcción (almuerzos sin enviar todavía) */}
      {lunchCommanda.length > 0 && !lunchModal && !sendCommandaModal && (
        <div style={{
          background: '#FFF7E6', borderBottom: `1px solid #F4E0BC`,
        }}>
          <div style={{
            maxWidth: 640, margin: '0 auto',
            padding: '12px 18px',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <div style={{ fontSize: 22, lineHeight: 1, flexShrink: 0 }}>🍽️</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#7A5C00' }}>
                {lunchCommanda.length} {lunchCommanda.length === 1 ? 'almuerzo en comanda' : 'almuerzos en comanda'}
              </div>
              <div style={{ fontSize: 11.5, color: '#9A7200', lineHeight: 1.4 }}>
                Sin enviar a cocina. Busca otro almuerzo para agregar o envíalos ya.
              </div>
            </div>
            <button
              onClick={() => {
                if (lunchCommanda.length === 0) return
                if (!confirm('¿Descartar los almuerzos en construcción? No se han enviado a cocina.')) return
                setLunchCommanda([])
              }}
              style={{
                padding: '6px 10px', borderRadius: 8,
                background: 'transparent', color: T.bad,
                border: `1px solid ${T.bad}55`,
                cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 11.5, fontWeight: 700, flexShrink: 0,
              }}
            >
              Descartar
            </button>
            <button
              onClick={openSendCommandaModal}
              style={{
                padding: '8px 14px', borderRadius: 10,
                background: T.copper[500], color: '#fff',
                border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 12.5, fontWeight: 800, flexShrink: 0,
                boxShadow: '0 3px 10px rgba(184,122,86,0.35)',
              }}
            >
              Enviar 🚀
            </button>
          </div>
        </div>
      )}

      {/* Buscador + boton refresh catalogo */}
      <div style={{ padding: '14px 18px 6px', maxWidth: 640, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
          <div style={{ flex: 1 }}>
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Buscar producto..."
            />
          </div>
          <button
            onClick={refreshCashierProducts}
            title="Actualizar lista de productos"
            style={{
              width: 46, flexShrink: 0,
              background: '#fff', border: `1.5px solid ${T.neutral[200]}`,
              borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: T.copper[600],
            }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M16 4 V8 H12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M4 16 V12 H8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M5.5 8 A6 6 0 0 1 15 5 L16 8 M14.5 12 A6 6 0 0 1 5 15 L4 12" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

        {/* Acceso rápido a almuerzos en hora de comida (11am – 2:59pm).
            Solo aparece si la cocinera publicó menú o activó el especial.
            Reusa exactamente los productos virtuales del enrichedCatalog
            (__lunch_corriente__ / __lunch_special__) y los pasa por el
            mismo handleSelectProduct — cero lógica nueva de negocio. */}
        {showLunchQuickAccess && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{
              fontSize: 10.5, fontWeight: 800, color: T.neutral[500],
              letterSpacing: 0.5, textTransform: 'uppercase', paddingLeft: 4,
            }}>
              Almuerzo del día · Acceso rápido
            </div>
            {availableLunchProducts.map(p => {
              const isSpecial = p.lunchKind === 'special'
              const bg = isSpecial ? '#FFF7E6' : T.copper[50]
              const border = isSpecial ? '#F4E0BC' : T.copper[200]
              const accent = isSpecial ? T.warn : T.copper[700]
              return (
                <button
                  key={p.id}
                  onClick={() => handleSelectProduct(p)}
                  style={{
                    width: '100%', padding: '12px 14px', borderRadius: 14,
                    background: bg, border: `1.5px solid ${border}`,
                    cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                    display: 'flex', alignItems: 'center', gap: 12,
                    transition: 'transform 0.1s ease, background 0.15s',
                  }}
                  onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.985)')}
                  onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
                  onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
                >
                  <div style={{
                    width: 40, height: 40, borderRadius: 12, flexShrink: 0,
                    background: '#fff', border: `1px solid ${border}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 22,
                  }}>
                    {isSpecial ? '⭐' : '🍽️'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 15, fontWeight: 800, color: accent,
                      letterSpacing: -0.2,
                    }}>
                      {p.name}
                    </div>
                    {!hidePrices && (
                      <div style={{
                        fontSize: 11.5, color: T.neutral[500], marginTop: 2,
                        letterSpacing: 0.2,
                      }}>
                        Mesa {fmtCOP(p.priceMesa)} · Llevar {fmtCOP(p.priceLlevar)}
                      </div>
                    )}
                  </div>
                  <div style={{
                    fontSize: 11, fontWeight: 800, color: accent,
                    letterSpacing: 0.3, textTransform: 'uppercase',
                    flexShrink: 0,
                  }}>
                    Toca →
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {/* Resultados de búsqueda */}
        {query.trim().length > 0 && (
          <div style={{
            background: '#fff', borderRadius: 16, border: `1px solid ${T.neutral[100]}`,
            marginTop: 8, overflow: 'hidden',
          }}>
            {filtered.length === 0 && !showCreateOption && (
              <div style={{ padding: '20px 16px', textAlign: 'center', color: T.neutral[500], fontSize: 13 }}>
                Sin resultados
              </div>
            )}
            {filtered.map((p, i) => {
              const isLunchItem = p.isLunch === true
              const isSpecial = p.lunchKind === 'special'
              const isFreeAmount = !isLunchItem && p.freeAmount === true
              const priceHere = isLunchItem
                ? Number(p.priceMesa) || 0
                : (isFreeAmount ? null : getProductPrice(p, branchId))
              const needsPrice = !isLunchItem && !isFreeAmount && priceHere === null
              return (
                <button
                  key={p.source + '_' + p.id}
                  onClick={() => handleSelectProduct(p)}
                  style={{
                    width: '100%', padding: '12px 16px',
                    background: isLunchItem ? (isSpecial ? '#FFF7E6' : T.copper[50]) : 'transparent',
                    border: 'none',
                    borderBottom: i < filtered.length - 1 || showCreateOption ? `0.5px solid ${T.neutral[100]}` : 'none',
                    cursor: 'pointer', fontFamily: 'inherit',
                    display: 'flex', alignItems: 'center', gap: 12,
                    textAlign: 'left',
                  }}
                >
                  {isLunchItem && (
                    <div style={{
                      width: 32, height: 32, borderRadius: 10, flexShrink: 0,
                      background: '#fff',
                      border: `1px solid ${isSpecial ? '#F4E0BC' : T.copper[100]}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 16,
                    }}>
                      {isSpecial ? '⭐' : '🍽️'}
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 14, fontWeight: isLunchItem ? 800 : 600,
                      color: isLunchItem ? (isSpecial ? T.warn : T.copper[700]) : T.neutral[900],
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {p.name}
                    </div>
                    {isLunchItem && !hidePrices && (
                      <div style={{
                        fontSize: 11, color: T.neutral[500], marginTop: 1,
                        letterSpacing: 0.3,
                      }}>
                        Mesa {fmtCOP(p.priceMesa || 0)} · Llevar {fmtCOP(p.priceLlevar || p.priceMesa || 0)}
                      </div>
                    )}
                  </div>
                  {isLunchItem ? (
                    <div style={{
                      fontSize: 11, fontWeight: 700, color: isSpecial ? T.warn : T.copper[700],
                      background: '#fff', padding: '4px 10px', borderRadius: 999,
                      letterSpacing: 0.3, flexShrink: 0,
                      border: `1px solid ${isSpecial ? '#F4E0BC' : T.copper[200]}`,
                    }}>
                      {isSpecial ? 'Especial' : 'Almuerzo'}
                    </div>
                  ) : isFreeAmount ? (
                    <div style={{
                      fontSize: 11, fontWeight: 700, color: T.copper[700],
                      background: T.copper[50], padding: '4px 10px', borderRadius: 999,
                      letterSpacing: 0.3, flexShrink: 0,
                    }}>
                      Venta libre
                    </div>
                  ) : (needsPrice && !hidePrices) ? (
                    <div style={{
                      fontSize: 11, fontWeight: 700, color: T.copper[700],
                      background: T.copper[50], padding: '4px 10px', borderRadius: 999,
                      letterSpacing: 0.3, flexShrink: 0,
                    }}>
                      Poner precio
                    </div>
                  ) : hidePrices ? null : (
                    <div style={{ fontSize: 14, fontWeight: 700, color: T.neutral[800], fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                      {fmtCOP(priceHere)}
                    </div>
                  )}
                </button>
              )
            })}
            {showCreateOption && (
              <button
                onClick={() => { setCreateInitialName(query); setCreateOpen(true) }}
                style={{
                  width: '100%', padding: '12px 16px',
                  background: T.copper[50], border: 'none',
                  cursor: 'pointer', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', gap: 10,
                  color: T.copper[700], fontSize: 13.5, fontWeight: 700,
                  textAlign: 'left',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
                  <circle cx="8" cy="8" r="7" stroke={T.copper[700]} strokeWidth="1.5" fill="none"/>
                  <path d="M8 5 V11 M5 8 H11" stroke={T.copper[700]} strokeWidth="1.6" strokeLinecap="round"/>
                </svg>
                Crear producto: "{query.trim()}"
              </button>
            )}
          </div>
        )}
      </div>

      {/* Carrito */}
      {/* paddingBottom generoso: el footer es sticky y, con muchos almuerzos,
          el carrito crece más que el viewport. Sin esta reserva, el botón
          Cobrar tapa los últimos items al hacer scroll. 220px cubre el peor
          caso (Total + Cobrar + botón secundario + safe-area iOS). */}
      <div style={{ flex: 1, padding: '8px 18px 220px', maxWidth: 640, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        {cart.length === 0 ? (
          <div style={{
            marginTop: 20, padding: '32px 20px', textAlign: 'center',
            background: '#fff', borderRadius: 16, border: `1px dashed ${T.neutral[200]}`,
          }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>🛒</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.neutral[700], marginBottom: 4 }}>
              El carrito está vacío
            </div>
            <div style={{ fontSize: 12, color: T.neutral[500] }}>
              Busca productos arriba para agregarlos.
            </div>
          </div>
        ) : (
          <Card padding={0} style={{ marginTop: 8, overflow: 'hidden' }}>
            {cart.map((it, i) => (
              <CartItem
                key={it.key}
                item={it}
                isLast={i === cart.length - 1}
                hidePrices={hidePrices}
                // Estado en vivo del kitchenOrder (si es un shim de cocina):
                // 'pending' = editable, 'ready' = ya cocinado.
                kitchenLiveStatus={
                  it.source === 'kitchen' && it.kitchenOrderId
                    ? (liveOrderById[it.kitchenOrderId]?.status || null)
                    : null
                }
                onMinus={() => updateQty(it.key, -1)}
                onPlus={() => updateQty(it.key, +1)}
                onRemove={() => removeItem(it.key)}
                onEditKitchen={() => handleEditKitchenItem(it)}
                onEditAmount={hidePrices ? undefined : () => setFreeAmountTarget({
                  product: { id: it.productId, source: it.source, name: it.name },
                  editingKey: it.key,
                })}
              />
            ))}
          </Card>
        )}
      </div>

      {/* Footer con total + acciones (fondo full-width, contenido en maxWidth) */}
      {cart.length > 0 && (
        <div style={{
          background: '#fff', borderTop: `1px solid ${T.neutral[100]}`,
          position: 'sticky', bottom: 0,
        }}>
          <div style={{
            maxWidth: 640, margin: '0 auto',
            padding: '14px 18px',
            paddingBottom: 'calc(14px + env(safe-area-inset-bottom, 0px))',
          }}>
            {!hidePrices && (
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: T.neutral[600] }}>Total</span>
                <span style={{ fontSize: 28, fontWeight: 800, color: T.neutral[900], fontVariantNumeric: 'tabular-nums', letterSpacing: -0.5 }}>
                  {fmtCOP(total)}
                </span>
              </div>
            )}
            {!isWaitress && (
              <button
                onClick={() => setPaymentOpen(true)}
                style={{
                  width: '100%', padding: '15px', borderRadius: 16,
                  background: T.copper[500], color: '#fff',
                  border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 15.5, fontWeight: 700,
                  boxShadow: '0 4px 14px rgba(184,122,86,0.35)',
                }}
              >
                Cobrar {fmtCOP(total)}
              </button>
            )}
            {/* Mesera en modo mesa: botón "Listo" que guarda y vuelve. */}
            {isWaitress && isTabMode && (
              <button
                onClick={handleMinimize}
                style={{
                  width: '100%', padding: '15px', borderRadius: 16,
                  background: T.copper[500], color: '#fff',
                  border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 15.5, fontWeight: 700,
                  boxShadow: '0 4px 14px rgba(184,122,86,0.35)',
                }}
              >
                Listo · guardar mesa
              </button>
            )}
            {!isTabMode && (
              <button
                onClick={() => setConvertOpen(true)}
                style={{
                  width: '100%', marginTop: isWaitress ? 0 : 10, padding: '14px',
                  background: isWaitress ? T.copper[500] : T.neutral[900], color: '#fff',
                  border: 'none', borderRadius: 16,
                  cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: isWaitress ? 15.5 : 14.5, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  boxShadow: isWaitress ? '0 4px 14px rgba(184,122,86,0.35)' : '0 3px 12px rgba(0,0,0,0.18)',
                }}
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <circle cx="9" cy="9" r="7" stroke="#fff" strokeWidth="1.6" fill="none"/>
                  <path d="M9 5 V9 L11.5 11" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round"/>
                </svg>
                {isWaitress ? 'Guardar pedido' : 'Enviar a mesa'}
              </button>
            )}
            {/* En modo mesa: botón secundario "Eliminar mesa" */}
            {isTabMode && (
              <button
                onClick={() => setConfirmDeleteTab({ busy: false, error: null })}
                style={{
                  width: '100%', marginTop: 8, padding: '12px',
                  background: 'transparent', color: T.bad,
                  border: `1.5px solid ${T.bad}55`, borderRadius: 14,
                  cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 14, fontWeight: 700,
                }}
              >
                Eliminar mesa
              </button>
            )}
          </div>
        </div>
      )}

      {createOpen && (
        <CreateProductModal
          initialName={createInitialName}
          authUser={authUser}
          userDoc={userDoc}
          branchId={branchId}
          branchName={session.branchName}
          onCancel={() => setCreateOpen(false)}
          onCreated={({ name, salePrice, productId }) => {
            addInlineToCart({ name, salePrice, productId })
            setCreateOpen(false)
          }}
        />
      )}

      {missingPriceProduct && (
        <FirstTimePriceModal
          product={missingPriceProduct}
          branchName={session.branchName}
          onCancel={() => setMissingPriceProduct(null)}
          onConfirm={handleConfirmFirstTimePrice}
        />
      )}

      {freeAmountTarget && (
        <FreeAmountModal
          product={freeAmountTarget.product}
          isEditing={!!freeAmountTarget.editingKey}
          initialAmount={freeAmountTarget.editingKey
            ? cart.find(it => it.key === freeAmountTarget.editingKey)?.unitPrice
            : null}
          onCancel={() => setFreeAmountTarget(null)}
          onConfirm={handleConfirmFreeAmount}
        />
      )}

      {paymentOpen && (
        <PaymentModal
          session={session}
          authUser={authUser}
          userDoc={userDoc}
          assistMode={assistMode}
          cart={cart}
          total={total}
          onCancel={() => setPaymentOpen(false)}
          onConfirmed={handleSaleConfirmed}
        />
      )}

      {convertOpen && (
        <ConvertToTabModal
          openTabs={openTabs}
          waitress={isWaitress}
          onCancel={() => setConvertOpen(false)}
          onConfirm={handleConvertToTab}
          onConfirmLlevar={handleConvertToLlevar}
        />
      )}

      {/* Modal de almuerzo (menú o especial).
          - Modo normal: arma un almuerzo nuevo para la comanda.
          - Modo edición (lunchModal.edit): corrige un almuerzo YA enviado.
          Si la cajera intenta cerrar pero ya tiene almuerzos en construcción,
          abrimos el modal de envío en lugar de descartar el progreso. */}
      {lunchModal?.kind === 'menu' && (
        <CashierLunchWizard
          product={lunchModal.product}
          hidePrices={hidePrices}
          currentCount={lunchCommanda.length}
          stockDailyMenu={dailyMenu}
          consumedByItem={consumedByItem}
          editMode={!!lunchModal.edit}
          initialSelections={lunchModal.edit?.initialSelections || null}
          initialNote={lunchModal.edit?.initialNote || ''}
          initialDestination={lunchModal.edit?.initialDestination || null}
          onSaveEdit={handleSaveKitchenEdit}
          onCancel={() => {
            // En edición, cerrar es simplemente cerrar — sin flujo de comanda.
            if (lunchModal.edit) {
              setLunchModal(null)
              return
            }
            // Cerrar y, si ya hay almuerzos, abrir el send modal para que
            // la cajera no pierda el progreso.
            setLunchModal(null)
            if (lunchCommanda.length > 0) {
              openSendCommandaModal()
            }
          }}
          onAdd={handleAddLunchToCommanda}
        />
      )}
      {lunchModal?.kind === 'special' && (
        <CashierSpecialWizard
          currentCount={lunchCommanda.length}
          hidePrices={hidePrices}
          editMode={!!lunchModal.edit}
          initialSelections={lunchModal.edit?.initialSelections || null}
          initialNote={lunchModal.edit?.initialNote || ''}
          initialDestination={lunchModal.edit?.initialDestination || null}
          onSaveEdit={handleSaveKitchenEdit}
          onCancel={() => {
            if (lunchModal.edit) {
              setLunchModal(null)
              return
            }
            setLunchModal(null)
            if (lunchCommanda.length > 0) {
              openSendCommandaModal()
            }
          }}
          onAdd={handleAddLunchToCommanda}
        />
      )}

      {/* Chooser de tipo: aparece al tocar "Almuerzo" del catálogo o
          al pedir "+ Otro" desde SendCommandaModal. Filtra opciones
          según disponibilidad del día. */}
      {lunchChooserOpen && (
        <LunchTypeChooserModal
          hidePrices={hidePrices}
          corrienteAvailable={corrienteState.available}
          corrientePrice={corrienteState.priceMesa}
          specialActive={!!specialFromDay}
          specialDescription={specialFromDay
            ? specialFromDay.resolved.especial.map(it => it.name).join(' · ')
            : ''}
          specialPrice={Number(specialFromDay?.priceMesa) || 0}
          addonAvailable={anyAddonAvailable}
          onCancel={() => {
            setLunchChooserOpen(false)
            // Si la cajera cancela pero ya tiene almuerzos, vuelve al send
            // modal para que pueda enviar lo que ya armó.
            if (lunchCommanda.length > 0) {
              openSendCommandaModal()
            }
          }}
          onPickCorriente={handleChooseCorriente}
          onPickSpecial={handleChooseSpecial}
          onPickAddon={handleChooseAddon}
        />
      )}

      {/* Modal de adición (sopa/huevo/proteína extra) reusado del cliente. */}
      {addonsModalState && (
        <PublicAddonsModal
          prices={addonPrices}
          hidePrices={hidePrices}
          proteinOptions={proteinOptionsForDay}
          initialType={addonsModalState === 'menu' ? null : addonsModalState}
          onCancel={() => {
            setAddonsModalState(null)
            if (lunchCommanda.length > 0) {
              openSendCommandaModal()
            }
          }}
          onAdd={handleAddAddonToCommanda}
        />
      )}

      {/* Modal de envío de comanda: si no estamos en tab, pide MESA# o
          NOMBRE CLIENTE según el tipo de tab a crear (llevar vs mesa).
          Permite editar el pedido (✕ por almuerzo, comentario, + otro) antes
          de enviarlo a cocina. */}
      {sendCommandaModal && (
        <SendCommandaModal
          state={sendCommandaModal}
          setState={(updater) => {
            // Cada cambio (tabla #, nombre cliente) lo persistimos en el ref
            // para que si la cajera cierra el send modal para agregar otro
            // item, al reabrirlo conserve los valores que ya tipeó.
            setSendCommandaModal(prev => {
              const next = typeof updater === 'function' ? updater(prev) : updater
              if (next && typeof next === 'object') {
                lastCommandaInputRef.current = {
                  tableNumber: next.tableNumber ?? lastCommandaInputRef.current.tableNumber,
                  customerName: next.customerName ?? lastCommandaInputRef.current.customerName,
                }
              }
              return next
            })
          }}
          isTabMode={isTabMode}
          hidePrices={hidePrices}
          tab={tab}
          openTabs={openTabs}
          lunchCommanda={lunchCommanda}
          onRemoveLunch={handleRemoveLunchFromCommanda}
          onAddAnother={handleAddAnotherLunch}
          onSubmit={handleSendCommanda}
          onBack={() => setSendCommandaModal(null)}
        />
      )}

      {confirmDeleteTab && isTabMode && (
        <ConfirmDeleteTabModal
          tab={tab}
          cart={cart}
          state={confirmDeleteTab}
          setState={setConfirmDeleteTab}
          actor={currentActor()}
          onConfirmed={() => {
            setConfirmDeleteTab(null)
            onCancel()
          }}
        />
      )}

    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Modal de envío de comanda (mesa# o nombre cliente + comentario + confirmar)
//
// Determina el "kind" de la tab a crear/usar:
//   - Modo tab (mesa ya abierta): se hereda tab.kind.
//   - Modo nuevo: si TODOS los almuerzos son 'llevar' → kind 'llevar' (pide nombre).
//                 Si hay al menos uno 'mesa' → kind 'mesa' (pide número).
//
// Ojo: el destino es POR ALMUERZO. Una mesa numerada PUEDE contener almuerzos
// con destination='llevar' (cliente sentado pero pide algo para llevar).
// ──────────────────────────────────────────────────────────────
function SendCommandaModal({ state, setState, isTabMode, hidePrices, tab, openTabs, lunchCommanda, onRemoveLunch, onAddAnother, onSubmit, onBack }) {
  // Determinar kind de la tab destino.
  const tabKind = isTabMode
    ? (tab?.kind || 'mesa')
    : (lunchCommanda.length > 0 && lunchCommanda.every(l => l.destination === 'llevar')
        ? 'llevar'
        : 'mesa')

  const num = state.tableNumber
  const customerName = (state.customerName || '').trim()
  // taken: ya hay una mesa con ese número. NO bloquea — solo indica que se
  // creará con sufijo .1/.2 (no se combina con la otra cuenta).
  const taken = !isTabMode && tabKind === 'mesa' && isTableNumberTaken(openTabs, num, null)
  // Sufijo que se asignará si la mesa ya existe (preview para la cajera).
  const previewSuffix = !isTabMode && tabKind === 'mesa' && num
    ? nextTableSuffix(openTabs, num)
    : 0
  const previewLabel = previewSuffix > 0 ? `${num}.${previewSuffix}` : String(num || '')

  // Lista de números ya ocupados — útil para que la cajera vea qué evitar.
  const occupiedNumbers = useMemo(() => {
    if (isTabMode || tabKind !== 'mesa') return []
    return (openTabs || [])
      .filter(t => (t.kind || 'mesa') === 'mesa')
      .map(t => formatTableLabel(t))
      .filter(label => !!label)
      .sort()
  }, [openTabs, isTabMode, tabKind])

  // Reparto del breakdown — si hay mezcla mesa+llevar, lo mostramos.
  const countMesa = lunchCommanda.filter(l => l.destination === 'mesa').length
  const countLlevar = lunchCommanda.filter(l => l.destination === 'llevar').length
  const isMixed = countMesa > 0 && countLlevar > 0

  async function handleConfirm() {
    if (state.busy) return
    if (isTabMode) {
      // Ya tenemos tabId — solo enviar.
      setState(s => ({ ...s, busy: true, error: null }))
      const error = await onSubmit({ kind: tabKind })
      if (error) setState(s => ({ ...s, busy: false, error }))
      return
    }
    if (tabKind === 'mesa') {
      if (!num || num <= 0) {
        setState(s => ({ ...s, error: 'Pon un número de mesa válido.' }))
        return
      }
    } else {
      if (!customerName) {
        setState(s => ({ ...s, error: 'Escribe el nombre del cliente.' }))
        return
      }
    }
    setState(s => ({ ...s, busy: true, error: null }))
    const error = await onSubmit({
      kind: tabKind,
      tableNumber: tabKind === 'mesa' ? num : null,
      customerName: tabKind === 'llevar' ? customerName : null,
    })
    if (error) {
      setState(s => ({ ...s, busy: false, error }))
    }
  }

  // Ya NO bloqueamos por mesa duplicada — se crea con sufijo automático.
  const canConfirm = !state.busy && (
    isTabMode ||
    (tabKind === 'mesa' ? !!num : customerName.length > 0)
  )

  return (
    <div onClick={state.busy ? undefined : () => setState(null)} style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 460, background: '#fff', borderRadius: 22,
        padding: '24px 22px 22px', boxShadow: '0 16px 48px rgba(0,0,0,0.25)',
        maxHeight: 'calc(100vh - 48px)', overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
      }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3 }}>
          Enviar comanda a cocina
        </div>
        <div style={{ fontSize: 12.5, color: T.neutral[500], marginTop: 4, marginBottom: 14, lineHeight: 1.5 }}>
          {lunchCommanda.length} {lunchCommanda.length === 1 ? 'item' : 'items'} listos para enviar. Quítalos con la ✕ si te equivocaste.
        </div>

        {/* Resumen de lo que se envía — con ✕ por item para corregir antes de enviar */}
        <div style={{
          padding: '6px 10px', borderRadius: 12,
          background: T.neutral[50], border: `1px solid ${T.neutral[100]}`,
          marginBottom: 10,
        }}>
          {lunchCommanda.map((l, i) => {
            const isAddon = l.kind === 'addon'
            const label = isAddon
              ? (formatAddonLine(l) || 'Adicional')
              : `${l.productName} · ${l.destination === 'llevar' ? '📦' : '🍽️'}`
            return (
            <div key={i} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              fontSize: 12.5, color: T.neutral[700], padding: '6px 0', gap: 8,
              borderBottom: i < lunchCommanda.length - 1 ? `0.5px dashed ${T.neutral[200]}` : 'none',
            }}>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {isAddon && <span style={{ marginRight: 4 }}>➕</span>}
                {label}
              </span>
              {!hidePrices && (
                <span style={{ fontWeight: 700, color: T.neutral[900], fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                  ${(l.price || 0).toLocaleString('es-CO')}
                </span>
              )}
              {onRemoveLunch && (
                <button
                  type="button"
                  onClick={() => {
                    if (state.busy) return
                    if (lunchCommanda.length === 1) {
                      if (!confirm('Es el único almuerzo. ¿Descartar la comanda?')) return
                    }
                    onRemoveLunch(i)
                  }}
                  disabled={state.busy}
                  title="Quitar este almuerzo"
                  style={{
                    width: 26, height: 26, borderRadius: 999,
                    background: '#fff', color: T.bad,
                    border: `1px solid ${T.bad}55`,
                    cursor: state.busy ? 'wait' : 'pointer',
                    fontFamily: 'inherit', fontSize: 13, fontWeight: 800,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0, padding: 0,
                  }}
                >
                  ✕
                </button>
              )}
            </div>
            )
          })}
        </div>

        {/* Botón para volver al modal del almuerzo y agregar otro a la misma comanda */}
        {onAddAnother && (
          <button
            type="button"
            onClick={() => { if (!state.busy) onAddAnother() }}
            disabled={state.busy}
            style={{
              width: '100%', padding: '10px', borderRadius: 12,
              background: '#fff', color: T.copper[700],
              border: `1.5px dashed ${T.copper[400]}`,
              cursor: state.busy ? 'wait' : 'pointer',
              fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
              marginBottom: 14,
            }}
          >
            + Agregar otro almuerzo o adición
          </button>
        )}

        {/* Breakdown si hay mezcla — la cajera ve cuántos van a mesa y cuántos llevar */}
        {isMixed && (
          <div style={{
            marginBottom: 10, padding: '8px 12px', borderRadius: 10,
            background: T.neutral[50], border: `1px dashed ${T.neutral[200]}`,
            fontSize: 12, color: T.neutral[700], lineHeight: 1.5,
            display: 'flex', justifyContent: 'space-around',
          }}>
            <span>🍽️ <b>{countMesa}</b> {countMesa === 1 ? 'mesa' : 'mesa'}</span>
            <span>📦 <b>{countLlevar}</b> {countLlevar === 1 ? 'llevar' : 'llevar'}</span>
          </div>
        )}

        {/* Selector de mesa (solo si no estamos en tab y kind='mesa').
            Usamos el TableNumberStepper para coherencia visual con el
            modal de "Crear mesa" (mismo control − N + en cualquier lugar
            donde la cajera elige número de mesa). */}
        {!isTabMode && tabKind === 'mesa' && (
          <>
            <div style={{
              fontSize: 11.5, fontWeight: 700, color: T.neutral[600],
              letterSpacing: 0.3, textTransform: 'uppercase', marginBottom: 6,
              textAlign: 'center',
            }}>
              Número de mesa
            </div>
            <TableNumberStepper
              value={String(num || 1)}
              onChange={(v) => setState(s => ({ ...s, tableNumber: Number(v) || 0, error: null }))}
              error={taken}
            />
            {taken && (
              <div style={{
                marginBottom: 10, padding: '10px 12px', borderRadius: 10,
                background: '#FFF7E6', border: `1px solid #F4E0BC`,
                fontSize: 12.5, color: '#7A5C00', lineHeight: 1.45,
              }}>
                Esa mesa ya tiene una cuenta. Se creará como{' '}
                <b style={{ fontVariantNumeric: 'tabular-nums' }}>Mesa {previewLabel}</b>{' '}
                — son cuentas separadas, no se combinan. Si quieres agregar a la mesa existente, toca su burbuja en vez.
              </div>
            )}
            {occupiedNumbers.length > 0 && !taken && (
              <div style={{
                marginBottom: 10, padding: '8px 12px', borderRadius: 10,
                background: T.neutral[50], border: `1px solid ${T.neutral[100]}`,
                fontSize: 11.5, color: T.neutral[600], lineHeight: 1.45,
              }}>
                <span style={{ fontWeight: 700 }}>Mesas abiertas:</span>{' '}
                {occupiedNumbers.join(', ')}
              </div>
            )}
          </>
        )}

        {/* Input nombre cliente (solo si no estamos en tab y kind='llevar') */}
        {!isTabMode && tabKind === 'llevar' && (
          <>
            <div style={{
              fontSize: 11.5, fontWeight: 700, color: '#7A5C00',
              letterSpacing: 0.3, textTransform: 'uppercase', marginBottom: 6,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ fontSize: 14 }}>📦</span>
              Nombre del cliente para llevar
            </div>
            <input
              type="text" value={state.customerName || ''}
              onChange={e => setState(s => ({ ...s, customerName: e.target.value, error: null }))}
              placeholder='Ej: "Juan", "Cliente con gorra azul"'
              maxLength={40}
              autoFocus
              style={{
                width: '100%', padding: '14px', borderRadius: 12,
                border: `1.5px solid #F0D699`,
                fontSize: 16, fontFamily: 'inherit', fontWeight: 700,
                background: '#fff', color: T.neutral[900],
                outline: 'none', marginBottom: 10,
                boxSizing: 'border-box',
              }}
            />
            <div style={{
              marginBottom: 10, padding: '8px 12px', borderRadius: 10,
              background: '#FFF7E6', border: `1px solid #F4E0BC`,
              fontSize: 11.5, color: '#7A5C00', lineHeight: 1.45,
            }}>
              Para llevar no se asigna mesa. La cajera ve este nombre en la burbuja de la izquierda.
            </div>
          </>
        )}

        {/* Nota: el comentario va PER-ALMUERZO desde el modal de armar
            el almuerzo. No hay nota global para toda la comanda — cada
            almuerzo lleva su propio contexto a la cocina. */}

        {state.error && (
          <div style={{
            marginBottom: 12, padding: '10px 12px', borderRadius: 10,
            background: '#FBE9E5', border: `1px solid #F0C8BE`, color: T.bad,
            fontSize: 12.5, fontWeight: 500, textAlign: 'center',
          }}>
            {state.error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onBack}
            disabled={state.busy}
            title="Cierra este modal sin enviar; el pedido queda listo en el banner para enviarlo cuando quieras"
            style={{
              flex: 1, padding: '12px', borderRadius: 12,
              background: T.neutral[100], color: T.neutral[700],
              border: 'none', cursor: state.busy ? 'wait' : 'pointer',
              fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700,
            }}
          >Más tarde</button>
          <button onClick={handleConfirm} disabled={!canConfirm} style={{
            flex: 1.6, padding: '12px', borderRadius: 12,
            background: !canConfirm ? T.neutral[200] : T.copper[500],
            color: !canConfirm ? T.neutral[500] : '#fff',
            border: 'none', cursor: !canConfirm ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit', fontSize: 14, fontWeight: 800, letterSpacing: 0.2,
            boxShadow: !canConfirm ? 'none' : '0 4px 14px rgba(184,122,86,0.35)',
          }}>
            {state.busy ? 'Enviando...' : '🚀 Enviar comanda'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Construye un resumen del almuerzo enviado para mostrarlo a la CAJERA.
//
// Diferencia clave con la vista de cocinera:
//   - Cocinera (CookApp): oculta acompañante/ensalada/jugo cuando van por
//     defecto. Solo le interesa lo "diferente" para no llenarse la pantalla.
//   - Cajera (aquí): muestra TODO el menú que el cliente pidió. Necesita
//     poder revisar y confirmar con el cliente. Si la cajera quitó algún
//     componente, sale como SIN [X] resaltado.
//
// Devuelve un objeto con filas estructuradas para render flexible (sin
// truncar): [{ icon, label, value, isSin }] + commandaNote opcional.
//
// Casos especiales:
//   - 'special': el "value" único es la descripción libre del almuerzo.
//   - 'menu' con principio array de 2 → "MIXTO Frijol / Pasta".
function buildLunchSummary(item) {
  const rows = []
  if (item.lunchKind === 'special' && item.lunchDescription) {
    rows.push({ icon: '⭐', label: 'Especial', value: item.lunchDescription })
  } else if (item.lunchKind === 'menu' && item.lunchSelections) {
    const sel = item.lunchSelections
    const ICONS = { soup: '🥣', principio: '🫘', protein: '🍗', side: '🍚', salad: '🥗', juice: '🥤' }
    const LABELS = { soup: 'Sopa', principio: 'Principio', protein: 'Proteína', side: 'Acompañante', salad: 'Ensalada', juice: 'Jugo' }
    const ALWAYS_SERVED = new Set(['side', 'salad', 'juice'])
    for (const cat of ['soup', 'principio', 'protein', 'side', 'salad', 'juice']) {
      const v = sel[cat]
      const icon = ICONS[cat] || '·'
      const label = LABELS[cat] || cat

      // Vacío en categoría "siempre se sirve" (acompañante/ensalada/jugo) →
      // mostrar como SIN [X] resaltado: la cajera tiene que recordar que
      // este cliente NO lleva ese componente.
      if (ALWAYS_SERVED.has(cat) && (v === null || (Array.isArray(v) && v.length === 0))) {
        rows.push({ icon, label, value: `SIN ${label.toUpperCase()}`, isSin: true })
        continue
      }
      // Principio puede ser array (mixto hasta 2)
      if (Array.isArray(v) && v.length > 0) {
        const names = v.map(x => x.name).filter(Boolean)
        if (names.length === 2) {
          rows.push({ icon, label, value: `MIXTO ${names.join(' / ')}`, isMixto: true })
        } else if (names.length === 1) {
          rows.push({ icon, label, value: names[0] })
        }
        continue
      }
      // Valor único
      if (v && v.name) {
        rows.push({ icon, label, value: v.name })
      }
      // Si es no-alwaysServed y está vacío (ej: principio sin elegir),
      // simplemente no se agrega.
    }
  }
  return { rows, note: item.commandaNote || null }
}

function useCashierProducts() {
  const [list, setList] = useState([])
  // Token que cambia para forzar reset del listener (al volver del background
  // o cuando la cajera toca el boton refresh).
  const [resubToken, setResubToken] = useState(0)

  useEffect(() => {
    const unsub = watchCashierProducts(setList)
    return unsub
  }, [resubToken])

  // Cuando la app vuelve a primer plano, reabrir el listener para
  // recuperar productos que pudieron crearse mientras estaba en background.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') {
        setResubToken(t => t + 1)
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [])

  const refresh = () => setResubToken(t => t + 1)
  return [list, refresh]
}

function SearchInput({ value, onChange, placeholder }) {
  const [focused, setFocused] = useState(false)
  return (
    <div style={{
      border: `1.5px solid ${focused ? T.copper[400] : T.neutral[200]}`,
      borderRadius: 14, background: '#fff',
      transition: 'border-color 0.12s',
      display: 'flex', alignItems: 'center',
    }}>
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" style={{ marginLeft: 14 }}>
        <circle cx="9" cy="9" r="6" stroke={T.neutral[400]} strokeWidth="1.6" fill="none"/>
        <path d="M14 14 L17 17" stroke={T.neutral[400]} strokeWidth="1.6" strokeLinecap="round"/>
      </svg>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        autoFocus
        style={{
          flex: 1, padding: '14px 16px 14px 12px', border: 'none', outline: 'none',
          fontFamily: 'inherit', fontSize: 15, color: T.neutral[900],
          background: 'transparent', borderRadius: 14,
        }}
      />
      {value && (
        <button
          onClick={() => onChange('')}
          style={{
            width: 36, height: 36, marginRight: 6, borderRadius: 999,
            background: 'transparent', border: 'none',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 3 L11 11 M11 3 L3 11" stroke={T.neutral[400]} strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        </button>
      )}
    </div>
  )
}

function CartItem({ item, isLast, onMinus, onPlus, onRemove, onEditKitchen, onEditAmount, kitchenLiveStatus, hidePrices }) {
  const subtotal = item.qty * item.unitPrice

  // Items shim de cocina (almuerzos enviados). Tap en remover cancela el
  // kitchenOrder. Tap en el cuerpo (si sigue 'pending') abre el editor
  // para corregir lo que la cajera haya enviado mal.
  if (item.source === 'kitchen') {
    // Preferir el campo nuevo `lunchDestination` (denormalizado en lunchToCartItem)
    // sobre el legacy de leer del nombre. Compatible con tabs viejas.
    const isLlevar = item.lunchDestination
      ? item.lunchDestination === 'llevar'
      : item.name?.includes('Para llevar')
    const labelColor = isLlevar ? T.warn : T.copper[700]

    // Estado en vivo del kitchenOrder. Solo 'pending' es editable.
    const isPending = kitchenLiveStatus === 'pending'
    const isReady = kitchenLiveStatus === 'ready'
    const statusLabel = isPending
      ? '✎ Toca para corregir'
      : isReady
        ? '✓ Listo en cocina'
        : 'En cocina'
    const statusColor = isReady ? T.ok : labelColor

    // Resumen de lo que se envió a cocina (visible POST-envío). Ahora la
    // cajera puede revisar sin tener que ir a buscar el kitchenOrder.
    const summary = buildLunchSummary(item)

    return (
      <div style={{
        padding: '12px 16px',
        display: 'flex', alignItems: 'flex-start', gap: 10,
        borderBottom: isLast ? 'none' : `0.5px solid ${T.neutral[100]}`,
        background: isLlevar ? '#FFFAEC' : '#FBF5F0',
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: 10, flexShrink: 0,
          background: '#fff', border: `1px solid ${labelColor}33`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, marginTop: 1,
        }}>
          {isLlevar ? '📦' : '🍽️'}
        </div>
        <div
          style={{
            flex: 1, minWidth: 0,
            cursor: isPending ? 'pointer' : 'default',
          }}
          role={isPending ? 'button' : undefined}
          tabIndex={isPending ? 0 : undefined}
          onClick={isPending ? onEditKitchen : undefined}
          onKeyDown={isPending ? (e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEditKitchen?.() }
          }) : undefined}
        >
          {/* Header con nombre + subtotal en la misma fila */}
          <div style={{
            display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
            gap: 8,
          }}>
            <div style={{
              fontSize: 14, fontWeight: 700, color: T.neutral[900],
              flex: 1, minWidth: 0,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {item.name}
            </div>
            {!hidePrices && (
              <div style={{
                fontSize: 14, fontWeight: 700, color: T.neutral[900],
                fontVariantNumeric: 'tabular-nums', flexShrink: 0,
              }}>
                {fmtCOP(subtotal)}
              </div>
            )}
          </div>

          {/* Tabla de selecciones — TODO lo que la cliente pidió, sin truncar.
              Cada fila label + valor con wrap libre. La cajera puede revisar
              y confirmar con el cliente. */}
          {summary.rows.length > 0 && (
            <div style={{
              marginTop: 6,
              padding: '8px 10px', borderRadius: 8,
              background: '#fff', border: `0.5px solid ${T.neutral[200]}`,
              display: 'flex', flexDirection: 'column', gap: 4,
            }}>
              {summary.rows.map((row, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'baseline',
                  gap: 8, fontSize: 12, lineHeight: 1.4,
                }}>
                  <span style={{
                    flexShrink: 0,
                    color: T.neutral[500],
                    minWidth: 100,
                    fontWeight: 700, letterSpacing: 0.3,
                    textTransform: 'uppercase',
                    fontSize: 10.5,
                  }}>
                    {row.icon} {row.label}
                  </span>
                  <span style={{
                    flex: 1, minWidth: 0,
                    fontWeight: row.isSin ? 800 : (row.isMixto ? 800 : 700),
                    color: row.isSin ? T.bad : (row.isMixto ? T.copper[700] : T.neutral[900]),
                    // Importante: SIN nowrap — el texto puede envolverse
                    // si el nombre del producto es largo (ej. "Sopa de
                    // Mondongo con Yuca").
                    wordBreak: 'break-word',
                  }}>
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Comentario destacado por separado — más visible que como una
              fila normal del summary. */}
          {summary.note && (
            <div style={{
              marginTop: 6,
              padding: '8px 10px', borderRadius: 8,
              background: '#FFF7E6', border: `1px solid #F4E0BC`,
              fontSize: 12, color: '#7A5C00',
              fontWeight: 600, fontStyle: 'italic',
              lineHeight: 1.4, wordBreak: 'break-word',
            }}>
              📝 {summary.note}
            </div>
          )}

          <div style={{
            fontSize: 10.5, fontWeight: 700, color: statusColor, marginTop: 6,
            letterSpacing: 0.4, textTransform: 'uppercase',
          }}>
            {statusLabel}
          </div>
        </div>
        <button onClick={onRemove} title="Cancelar este almuerzo" style={{
          width: 32, height: 32, borderRadius: 999, marginLeft: 4,
          background: 'transparent', border: 'none',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 3 L11 11 M11 3 L3 11" stroke={T.bad} strokeWidth="1.7" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    )
  }

  // Items de venta libre: sin botones - / +; tap en el monto edita
  if (item.freeAmount) {
    return (
      <div style={{
        padding: '12px 16px',
        display: 'flex', alignItems: 'center', gap: 10,
        borderBottom: isLast ? 'none' : `0.5px solid ${T.neutral[100]}`,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14, fontWeight: 700, color: T.neutral[900],
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {item.name}
          </div>
          <div style={{ fontSize: 11, color: T.copper[700], marginTop: 2, fontWeight: 600, letterSpacing: 0.3 }}>
            {hidePrices ? 'VENTA LIBRE · LA CAJERA PONE EL PRECIO' : 'VENTA LIBRE · TOCA EL MONTO PARA CAMBIAR'}
          </div>
        </div>

        {!hidePrices && (
          <button
            onClick={onEditAmount}
            style={{
              padding: '8px 14px', borderRadius: 12,
              background: T.copper[50], border: `1.5px solid ${T.copper[300]}`,
              cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 16, fontWeight: 800, color: T.copper[700],
              fontVariantNumeric: 'tabular-nums', letterSpacing: -0.3,
            }}
          >
            {fmtCOP(item.unitPrice)}
          </button>
        )}

        <button onClick={onRemove} style={{
          width: 32, height: 32, borderRadius: 999, marginLeft: 4,
          background: 'transparent', border: 'none',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 3 L11 11 M11 3 L3 11" stroke={T.neutral[400]} strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    )
  }

  return (
    <div style={{
      padding: '12px 16px',
      display: 'flex', alignItems: 'center', gap: 10,
      borderBottom: isLast ? 'none' : `0.5px solid ${T.neutral[100]}`,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14, fontWeight: 600, color: T.neutral[900],
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {item.name}
        </div>
        {!hidePrices && (
          <div style={{ fontSize: 11.5, color: T.neutral[500], marginTop: 2 }}>
            {fmtCOP(item.unitPrice)} c/u
          </div>
        )}
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 0,
        background: T.neutral[100], borderRadius: 999, padding: 2,
      }}>
        <button onClick={onMinus} style={qtyBtn()}>
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 6 H10" stroke={T.neutral[700]} strokeWidth="2" strokeLinecap="round"/></svg>
        </button>
        <span style={{
          minWidth: 28, textAlign: 'center', fontSize: 14, fontWeight: 700,
          color: T.neutral[900], fontVariantNumeric: 'tabular-nums',
        }}>
          {item.qty}
        </span>
        <button onClick={onPlus} style={qtyBtn()}>
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 2 V10 M2 6 H10" stroke={T.neutral[700]} strokeWidth="2" strokeLinecap="round"/></svg>
        </button>
      </div>

      {!hidePrices && (
        <div style={{
          minWidth: 70, textAlign: 'right',
          fontSize: 14, fontWeight: 700, color: T.neutral[900], fontVariantNumeric: 'tabular-nums',
        }}>
          {fmtCOP(subtotal)}
        </div>
      )}

      <button onClick={onRemove} style={{
        width: 32, height: 32, borderRadius: 999, marginLeft: 4,
        background: 'transparent', border: 'none',
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M3 3 L11 11 M11 3 L3 11" stroke={T.neutral[400]} strokeWidth="1.6" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  )
}

function qtyBtn() {
  return {
    width: 30, height: 30, borderRadius: 999,
    background: 'transparent', border: 'none',
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
  }
}

// ──────────────────────────────────────────────────────────────
// Botón pequeño junto al título para editar el número de mesa
// ──────────────────────────────────────────────────────────────
function TableNumberEditButton({ currentNumber, openTabs, currentTabId, onChange }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Cambiar número de mesa"
        style={{
          padding: '6px 12px', borderRadius: 999,
          background: T.copper[50], color: T.copper[700],
          border: `1px solid ${T.copper[200]}`,
          cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 12, fontWeight: 700,
          flexShrink: 0,
        }}
      >
        Cambiar #
      </button>
      {open && (
        <ChangeTableNumberModal
          currentNumber={currentNumber}
          openTabs={openTabs}
          currentTabId={currentTabId}
          onCancel={() => setOpen(false)}
          onConfirm={async (n) => {
            const ok = await onChange(n)
            if (ok) setOpen(false)
            return ok
          }}
        />
      )}
    </>
  )
}

function ChangeTableNumberModal({ currentNumber, openTabs, currentTabId, onCancel, onConfirm }) {
  const [str, setStr] = useState(String(currentNumber || ''))
  const [error, setError] = useState(null)
  const num = Number(str)
  const isTaken = num > 0 && isTableNumberTaken(openTabs, num, currentTabId)
  const valid = num > 0 && !isTaken

  async function handleConfirm() {
    if (!valid) {
      if (isTaken) setError(`Ya tienes una Mesa ${num}. Elige otro número.`)
      return
    }
    const ok = await onConfirm(num)
    if (!ok) setError('No se pudo cambiar. Intenta de nuevo.')
  }

  return (
    <ModalOverlay onClose={onCancel}>
      <div onClick={e => e.stopPropagation()} style={modalCard()}>
        <div style={{ fontSize: 18, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3, marginBottom: 4, textAlign: 'center' }}>
          Cambiar número de mesa
        </div>
        <div style={{ fontSize: 12.5, color: T.neutral[500], marginBottom: 18, textAlign: 'center' }}>
          Actualmente es <b>Mesa {currentNumber}</b>.
        </div>

        <TableNumberStepper
          value={str}
          onChange={(v) => { setStr(v); setError(null) }}
          error={isTaken}
        />

        {(error || isTaken) && (
          <ErrorBox text={error || `Ya tienes una Mesa ${num}.`} />
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
          <button onClick={onCancel} style={btnSecondary()}>Cancelar</button>
          <button
            onClick={handleConfirm}
            disabled={!valid}
            style={{
              ...btnPrimary(valid ? T.copper[500] : T.neutral[200]),
              flex: 1.4,
              color: valid ? '#fff' : T.neutral[400],
              cursor: valid ? 'pointer' : 'not-allowed',
              boxShadow: valid ? '0 3px 10px rgba(184,122,86,0.3)' : 'none',
            }}
          >
            Cambiar
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

// ──────────────────────────────────────────────────────────────
// MODAL: Convertir venta nueva en mesa (asignar número)
// ──────────────────────────────────────────────────────────────
function ConvertToTabModal({ openTabs, onCancel, onConfirm, waitress, onConfirmLlevar }) {
  const defaultNum = nextFreeTableNumber(openTabs)
  const [str, setStr] = useState(String(defaultNum))
  // kind solo aplica para la mesera (puede guardar mesa o llevar). La cajera
  // siempre crea mesa desde aquí (los 'llevar' los arma por el flujo de cocina).
  const [kind, setKind] = useState('mesa')
  const [customerName, setCustomerName] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const num = Number(str)
  const isTaken = kind === 'mesa' && num > 0 && isTableNumberTaken(openTabs, num)
  const valid = kind === 'llevar'
    ? customerName.trim().length > 0
    : (num > 0 && !isTaken)

  async function handleConfirm() {
    if (!valid) {
      if (isTaken) setError(`Ya tienes una Mesa ${num}. Elige otro número.`)
      return
    }
    setBusy(true)
    setError(null)
    const errMsg = kind === 'llevar'
      ? await onConfirmLlevar(customerName)
      : await onConfirm(num)
    if (errMsg) {
      setError(errMsg)
      setBusy(false)
    }
    // Si tuvo éxito, el modal se cierra desde fuera (no hace falta resetear busy)
  }

  return (
    <ModalOverlay onClose={onCancel}>
      <div onClick={e => e.stopPropagation()} style={modalCard()}>
        <div style={{ fontSize: 18, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3, marginBottom: 4, textAlign: 'center' }}>
          {waitress ? 'Guardar pedido' : 'Número de mesa'}
        </div>
        <div style={{ fontSize: 12.5, color: T.neutral[500], marginBottom: 18, lineHeight: 1.5, textAlign: 'center' }}>
          {waitress
            ? 'El pedido le llega a la cajera para cobrarlo. Tú puedes seguir agregándole desde la burbuja.'
            : 'La venta queda guardada como mesa. Después la abres desde la burbuja para agregar más o cobrar.'}
        </div>

        {/* Toggle Mesa / Llevar — solo para la mesera */}
        {waitress && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {[
              { id: 'mesa', label: '🍽️ Mesa' },
              { id: 'llevar', label: '📦 Llevar' },
            ].map(opt => {
              const active = kind === opt.id
              return (
                <button
                  key={opt.id}
                  onClick={() => { setKind(opt.id); setError(null) }}
                  style={{
                    flex: 1, padding: '11px', borderRadius: 12,
                    background: active ? T.copper[500] : '#fff',
                    color: active ? '#fff' : T.neutral[700],
                    border: `1.5px solid ${active ? T.copper[500] : T.neutral[200]}`,
                    cursor: 'pointer', fontFamily: 'inherit',
                    fontSize: 14, fontWeight: 800,
                  }}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        )}

        {kind === 'mesa' ? (
          <TableNumberStepper
            value={str}
            onChange={(v) => { setStr(v); setError(null) }}
            error={isTaken}
          />
        ) : (
          <input
            value={customerName}
            onChange={e => { setCustomerName(e.target.value); setError(null) }}
            placeholder="Nombre del cliente"
            autoFocus
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '13px 14px', borderRadius: 12,
              border: `1.5px solid ${T.neutral[200]}`,
              fontFamily: 'inherit', fontSize: 15, fontWeight: 600,
              color: T.neutral[900], outline: 'none',
            }}
          />
        )}

        {(error || isTaken) && (
          <ErrorBox text={error || `Ya tienes una Mesa ${num}.`} />
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button onClick={onCancel} disabled={busy} style={btnSecondary()}>Cancelar</button>
          <button
            onClick={handleConfirm}
            disabled={!valid || busy}
            style={{
              ...btnPrimary(valid && !busy ? T.copper[500] : T.neutral[200]),
              flex: 1.4,
              color: valid && !busy ? '#fff' : T.neutral[400],
              cursor: valid && !busy ? 'pointer' : 'not-allowed',
              boxShadow: valid && !busy ? '0 3px 10px rgba(184,122,86,0.3)' : 'none',
            }}
          >
            {busy ? 'Guardando...' : (waitress ? 'Guardar' : 'Crear mesa')}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

// ──────────────────────────────────────────────────────────────
// MODAL: Crear producto al vuelo
// ──────────────────────────────────────────────────────────────
function CreateProductModal({ initialName, authUser, userDoc, branchId, branchName, onCancel, onCreated }) {
  const [name, setName] = useState(initialName || '')
  const [priceStr, setPriceStr] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const valid = name.trim().length >= 2 && Number(priceStr) > 0

  function handleCreate() {
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    try {
      const cashierName = `${userDoc?.nombre || ''} ${userDoc?.apellido || ''}`.trim()
      // createCashierProduct es fire-and-forget: devuelve el id al instante y
      // encola la escritura. NO usar await — en modo ahorro nunca resolvería.
      const productId = createCashierProduct({
        name: name.trim(),
        salePrice: Number(priceStr) || 0,
        branchId,
        createdByUid: authUser.uid,
        createdByName: cashierName,
      })
      onCreated({ name: name.trim(), salePrice: Number(priceStr) || 0, productId })
    } catch (err) {
      console.error(err)
      setError('No pudimos crear el producto. Intenta de nuevo.')
      setBusy(false)
    }
  }

  return (
    <ModalOverlay onClose={onCancel}>
      <div onClick={e => e.stopPropagation()} style={modalCard()}>
        <div style={{ fontSize: 18, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3, marginBottom: 4 }}>
          Crear producto
        </div>
        <div style={{ fontSize: 12.5, color: T.neutral[500], marginBottom: 16 }}>
          Quedará en el catálogo. El precio que pongas es solo para <b>{branchName || 'esta panadería'}</b>; otra cajera ingresará el suyo en su panadería.
        </div>

        <ModalInput
          label="Nombre"
          value={name}
          onChange={setName}
          placeholder="Ej. Pan croissant"
          disabled={busy}
        />

        <ModalNumberInput
          label={`Precio en ${branchName || 'esta panadería'}`}
          value={priceStr}
          onChange={setPriceStr}
          disabled={busy}
        />

        {error && <ErrorBox text={error} />}

        <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
          <button onClick={onCancel} style={btnSecondary()}>Cancelar</button>
          <button
            onClick={handleCreate}
            disabled={!valid || busy}
            style={{
              ...btnPrimary(valid && !busy ? T.copper[500] : T.neutral[200]),
              flex: 1.4,
              color: valid && !busy ? '#fff' : T.neutral[400],
              cursor: valid && !busy ? 'pointer' : 'not-allowed',
              boxShadow: valid && !busy ? '0 3px 10px rgba(184,122,86,0.3)' : 'none',
            }}
          >
            {busy ? 'Creando...' : 'Crear y agregar'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

// ──────────────────────────────────────────────────────────────
// MODAL: Primera vez vendiendo este producto en esta panadería
// ──────────────────────────────────────────────────────────────
function FirstTimePriceModal({ product, branchName, onCancel, onConfirm }) {
  const [priceStr, setPriceStr] = useState('')

  const valid = Number(priceStr) > 0

  function handleConfirm() {
    if (!valid) return
    onConfirm(Number(priceStr))
  }

  return (
    <ModalOverlay onClose={onCancel}>
      <div onClick={e => e.stopPropagation()} style={modalCard()}>
        <div style={{ fontSize: 18, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3, marginBottom: 4 }}>
          Primera venta de este producto
        </div>
        <div style={{ fontSize: 12.5, color: T.neutral[500], marginBottom: 16, lineHeight: 1.5 }}>
          <b style={{ color: T.neutral[800] }}>{product.name}</b> aún no tiene precio en <b style={{ color: T.neutral[800] }}>{branchName || 'esta panadería'}</b>. Pon el precio una sola vez y queda guardado para próximas ventas.
        </div>

        <ModalNumberInput
          label={`Precio en ${branchName || 'esta panadería'}`}
          value={priceStr}
          onChange={setPriceStr}
        />

        <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
          <button onClick={onCancel} style={btnSecondary()}>Cancelar</button>
          <button
            onClick={handleConfirm}
            disabled={!valid}
            style={{
              ...btnPrimary(valid ? T.copper[500] : T.neutral[200]),
              flex: 1.4,
              color: valid ? '#fff' : T.neutral[400],
              cursor: valid ? 'pointer' : 'not-allowed',
              boxShadow: valid ? '0 3px 10px rgba(184,122,86,0.3)' : 'none',
            }}
          >
            Guardar y agregar
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

// ──────────────────────────────────────────────────────────────
// MODAL: ¿De cuánto? (productos de venta libre, ej: "Pan")
// ──────────────────────────────────────────────────────────────
function FreeAmountModal({ product, isEditing, initialAmount, onCancel, onConfirm }) {
  const MIN = 400
  const [str, setStr] = useState(initialAmount ? String(initialAmount) : '')
  const num = Number(str) || 0
  const valid = num >= MIN

  function sanitize(raw) {
    return raw.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '')
  }

  function handleConfirm() {
    if (!valid) return
    onConfirm(num)
  }

  return (
    <ModalOverlay onClose={onCancel}>
      <div onClick={e => e.stopPropagation()} style={modalCard()}>
        <div style={{ fontSize: 18, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3, marginBottom: 4, textAlign: 'center' }}>
          {isEditing ? `Cambiar monto · ${product.name}` : `${product.name}`}
        </div>
        <div style={{ fontSize: 12.5, color: T.neutral[500], marginBottom: 18, textAlign: 'center' }}>
          ¿De cuánto?
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 14,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center',
            border: `2px solid ${valid ? T.copper[400] : T.neutral[200]}`,
            borderRadius: 16, background: '#fff',
            padding: '8px 16px',
            transition: 'border-color 0.15s',
          }}>
            <span style={{ paddingRight: 6, color: T.neutral[500], fontSize: 24, fontWeight: 700 }}>$</span>
            <input
              type="text"
              inputMode="numeric"
              autoFocus
              value={str}
              onChange={e => setStr(sanitize(e.target.value))}
              placeholder="0"
              style={{
                width: 160, padding: '6px 0', border: 'none', outline: 'none',
                fontFamily: 'inherit', fontSize: 32, fontWeight: 800,
                color: T.neutral[900], background: 'transparent',
                fontVariantNumeric: 'tabular-nums', letterSpacing: -1,
                textAlign: 'center',
              }}
            />
          </div>
        </div>

        {/* Sugerencias rápidas */}
        <div style={{
          display: 'flex', gap: 6, marginBottom: 14, justifyContent: 'center', flexWrap: 'wrap',
        }}>
          {[500, 1000, 2000, 5000, 10000].map(s => (
            <button
              key={s}
              onClick={() => setStr(String(s))}
              style={{
                padding: '6px 12px', borderRadius: 999,
                background: T.neutral[100], color: T.neutral[700],
                border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 12, fontWeight: 700,
              }}
            >
              ${s.toLocaleString('es-CO')}
            </button>
          ))}
        </div>

        {str && num > 0 && num < MIN && (
          <div style={{
            marginBottom: 12, padding: '8px 12px', borderRadius: 10,
            background: '#FBE9E5', border: `1px solid #F0C8BE`, color: T.bad,
            fontSize: 12.5, fontWeight: 600, textAlign: 'center',
          }}>
            Monto mínimo: ${MIN.toLocaleString('es-CO')}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCancel} style={btnSecondary()}>Cancelar</button>
          <button
            onClick={handleConfirm}
            disabled={!valid}
            style={{
              ...btnPrimary(valid ? T.copper[500] : T.neutral[200]),
              flex: 1.4,
              color: valid ? '#fff' : T.neutral[400],
              cursor: valid ? 'pointer' : 'not-allowed',
              boxShadow: valid ? '0 3px 10px rgba(184,122,86,0.3)' : 'none',
            }}
          >
            {isEditing ? 'Cambiar' : 'Agregar'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

// ──────────────────────────────────────────────────────────────
// MODAL: Método de pago
// ──────────────────────────────────────────────────────────────
// Recargo fijo que se suma al total cuando el pago es digital (NEQUI/DAVIPLATA).
// Cubre el costo de la transferencia. No aplica a efectivo puro ni a deuda.
const DIGITAL_SURCHARGE = 500

function PaymentModal({ session, authUser, userDoc, assistMode, cart, total, onCancel, onConfirmed }) {
  // method primario seleccionado por la cajera. Cuando hay split, 'mixto' es
  // un estado derivado — no se elige directamente.
  const [method, setMethod] = useState(null) // 'efectivo' | 'deuda' | 'nequi' | 'daviplata'
  const [cashReceivedStr, setCashReceivedStr] = useState('')
  const [debtorName, setDebtorName] = useState('')
  const [debtors, setDebtors] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // Split de pago: cuando hay mezcla efectivo + digital. Solo se activa si la
  // cajera entra al flujo (sin botón extra arriba): tipea efectivo<total y
  // escoge digital para el resto, o tipea digital y agrega efectivo abajo.
  // shape: { efectivo: number, digitalMethod: 'nequi'|'daviplata', digitalAmount: number }
  const [split, setSplit] = useState(null)
  // Input visible para la "porción efectivo" cuando el método primario es
  // nequi/daviplata. Si tipea algo válido, el split se activa.
  const [splitCashStr, setSplitCashStr] = useState('')

  useEffect(() => {
    const unsub = watchDebtors(setDebtors)
    return unsub
  }, [])

  // Reset del split cuando la cajera cambia de método primario — evitamos
  // estado fantasma de un flujo previo.
  useEffect(() => {
    setSplit(null)
    setSplitCashStr('')
  }, [method])

  const cashReceived = Number(cashReceivedStr) || 0
  // En split desde efectivo: la cajera dice cuánto efectivo recibió y el
  // sistema infiere que el resto va al método digital escogido. No hay vuelto.
  const isSplit = !!split
  const isDigital = method === 'nequi' || method === 'daviplata'
  // El recargo digital aplica al pago 100% digital y a cualquier split (siempre
  // lleva una porción digital). effectiveTotal es el monto real a cobrar.
  const hasDigital = isDigital || isSplit
  const surcharge = hasDigital ? DIGITAL_SURCHARGE : 0
  const effectiveTotal = total + surcharge
  const change = cashReceived - effectiveTotal

  // Sugerencias de deudores existentes (ordenadas por relevancia: prefijo > contiene)
  const debtorSuggestions = useMemo(() => {
    if (!debtorName.trim()) return []
    const q = normalizeName(debtorName)
    return debtors
      .filter(d => !d.mergedInto) // ocultar deudores ya fusionados
      .map(d => ({ d, score: scoreNameMatch(normalizeName(d.name), q) }))
      .filter(x => x.score >= 0)
      .sort((a, b) => a.score - b.score || a.d.name.localeCompare(b.d.name))
      .slice(0, 5)
      .map(x => x.d)
  }, [debtors, debtorName])

  const canConfirm = (() => {
    if (!method) return false
    if (method === 'deuda') return debtorName.trim().length >= 2 && !busy
    // Para efectivo o digital, con o sin split: el modal valida los montos
    // antes de habilitar (en split, ambas porciones deben sumar el total).
    if (method === 'efectivo') {
      if (isSplit) return split.digitalAmount > 0 && split.efectivo > 0 && !busy
      return !busy
    }
    if (isDigital) {
      if (isSplit) return split.digitalAmount > 0 && split.efectivo > 0 && !busy
      return !busy
    }
    return false
  })()

  function selectMethod(m) {
    setMethod(m)
  }

  // Activa el split desde el flujo "efectivo": la cajera ya tipeó cashReceived
  // (< total) y escogió el digital para el resto. Calculamos las dos porciones.
  function activateSplitFromCash(digitalMethod) {
    const efectivo = cashReceived
    // El split lleva una porción digital → el total a cubrir incluye el recargo.
    const digitalAmount = (total + DIGITAL_SURCHARGE) - efectivo
    if (efectivo <= 0 || digitalAmount <= 0) return
    setSplit({ efectivo, digitalMethod, digitalAmount })
  }

  // Activa el split desde el flujo "digital": la cajera tipeó cuánto efectivo
  // recibió del cliente además del pago digital.
  function activateSplitFromDigital(efectivoAmount) {
    const efectivo = Number(efectivoAmount) || 0
    const digitalTotal = total + DIGITAL_SURCHARGE
    const digitalAmount = digitalTotal - efectivo
    if (efectivo <= 0 || efectivo >= digitalTotal) {
      setSplit(null)
      return
    }
    setSplit({ efectivo, digitalMethod: method, digitalAmount })
  }

  function clearSplit() {
    setSplit(null)
    setSplitCashStr('')
  }

  async function handleConfirm() {
    if (!canConfirm || busy) return
    setBusy(true)
    setError(null)
    try {
      const isAssist = !!assistMode
      // Modo asistir: la venta se contabiliza a la cajera dueña del turno.
      // Si no, al usuario actual (que ES la cajera).
      const cashierUid = isAssist ? (session.cashierUid || authUser.uid) : authUser.uid
      const cashierName = isAssist
        ? (session.cashierName || 'Cajera')
        : (`${userDoc?.nombre || ''} ${userDoc?.apellido || ''}`.trim() || authUser.email)
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })

      // Si hay split, la venta se guarda como 'mixto' con paymentSplit. Para
      // los downstream que no conocen split (filtros antiguos, etc.), el
      // helper `addSaleToBreakdown` y `paymentDisplay` los manejan.
      const payload = {
        sessionId: session.id,
        branchId: session.branchId,
        cashierUid,
        cashierName,
        items: cart.map(it => ({
          productId: it.productId,
          source: it.source,
          name: it.name,
          qty: it.qty,
          unitPrice: it.unitPrice,
          subtotal: it.qty * it.unitPrice,
        })),
        total: effectiveTotal,
        paymentMethod: isSplit ? 'mixto' : method,
      }
      if (surcharge > 0) {
        payload.digitalSurcharge = surcharge
      }

      if (isSplit) {
        payload.paymentSplit = {
          efectivo: split.efectivo,
          [split.digitalMethod]: split.digitalAmount,
        }
        // Conservamos cashReceived para auditoría / vuelto = 0 (cliente cubrió exacto).
        payload.cashReceived = split.efectivo
      } else if (method === 'efectivo' && cashReceivedStr) {
        payload.cashReceived = cashReceived
      }

      // Modo asistir: marcar quién registró la venta (admin)
      if (isAssist) {
        payload.recordedByUid = authUser.uid
        payload.recordedByName = assistMode.adminName
        payload.recordedByRole = 'admin'
      }

      if (method === 'deuda') {
        // Crear o actualizar deudor primero (necesitamos saleId después,
        // así que registraremos el deudor sin saleId y luego actualizamos).
        // Para Fase 3 mantenemos simple: registramos deudor con saleId temporal.
        // Mejor: creamos sale primero, luego registramos deuda con saleId.
        // Pero entonces si el registro de deudor falla, queda sale huérfana.
        // Solución: orden inverso — registrar deudor primero con saleId pendiente,
        // crear sale con debtorId, luego actualizar history del debtor.
        // Para Fase 3 simple: guardamos el nombre en la sale y registramos debtor
        // con saleId después de crear la sale.
      }

      // Crear venta
      const saleId = await createSale(payload)

      // Si es deuda, registrar en debtors y guardar debtorId en la sale.
      // addDebtSale ya es fire-and-forget; aquí solo necesitamos su ID local.
      if (method === 'deuda') {
        const debtorId = await addDebtSale(debtors, {
          name: debtorName.trim(),
          amount: total,
          saleId,
          date: today,
        })
        // Backfill: agregar debtorId a la sale para futuras ediciones del admin.
        // SIN await — en modo ahorro el await se cuelga.
        try {
          const { doc, updateDoc } = await import('firebase/firestore')
          const { firestoreDb } = await import('../firebase')
          updateDoc(doc(firestoreDb, 'sales', saleId), { debtorId })
            .catch(err => console.warn('No se pudo backfill debtorId en venta:', err))
        } catch (err) {
          console.warn('No se pudo importar firestore para backfill:', err)
        }
      }

      onConfirmed()
    } catch (err) {
      console.error(err)
      setError('No pudimos guardar la venta. Intenta de nuevo.')
      setBusy(false)
    }
  }

  return (
    <ModalOverlay onClose={busy ? undefined : onCancel}>
      <div onClick={e => e.stopPropagation()} style={modalCard()}>
        <div style={{ fontSize: 18, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3, marginBottom: 4 }}>
          Cobrar
        </div>
        <div style={{
          fontSize: 28, fontWeight: 800, color: T.copper[600],
          fontVariantNumeric: 'tabular-nums', letterSpacing: -0.5, marginBottom: 16,
        }}>
          {fmtCOP(effectiveTotal)}
        </div>

        <div style={{ fontSize: 13, fontWeight: 600, color: T.neutral[600], marginBottom: 10 }}>
          Método de pago
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          <PaymentOption icon="💵" label="Efectivo" selected={method === 'efectivo'} onClick={() => selectMethod('efectivo')} />
          <PaymentOption icon="🤝" label="Deuda" selected={method === 'deuda'} onClick={() => selectMethod('deuda')} />
          <PaymentOption icon="📱" label="NEQUI" selected={method === 'nequi'} onClick={() => selectMethod('nequi')} />
          <PaymentOption icon="📱" label="DAVIPLATA" selected={method === 'daviplata'} onClick={() => selectMethod('daviplata')} />
        </div>

        {/* Aviso de recargo por pago digital. La cajera confirma el total con los $500. */}
        {hasDigital && (
          <div style={{
            padding: '12px 14px', borderRadius: 12, marginBottom: 14,
            background: T.copper[50], border: `1.5px solid ${T.copper[200]}`,
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              fontSize: 12.5, color: T.copper[700], fontWeight: 600, marginBottom: 6,
            }}>
              <span>Subtotal productos</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtCOP(total)}</span>
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              fontSize: 12.5, color: T.copper[700], fontWeight: 600, marginBottom: 8,
            }}>
              <span>Recargo por pago digital</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>+ {fmtCOP(DIGITAL_SURCHARGE)}</span>
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              paddingTop: 8, borderTop: `1px solid ${T.copper[200]}`,
            }}>
              <span style={{ fontSize: 13.5, fontWeight: 800, color: T.neutral[900] }}>Total a cobrar</span>
              <span style={{ fontSize: 17, fontWeight: 900, color: T.copper[700], fontVariantNumeric: 'tabular-nums' }}>
                {fmtCOP(effectiveTotal)}
              </span>
            </div>
          </div>
        )}

        {/* Detalles según método */}
        {method === 'efectivo' && !isSplit && (
          <>
            <ModalNumberInput
              label="¿Cuánto recibió? (opcional)"
              value={cashReceivedStr}
              onChange={setCashReceivedStr}
              disabled={busy}
              hint="Si lo digitas, te calcula el vuelto o te ofrece dividir."
            />
            <QuickCashChips total={total} onPick={setCashReceivedStr} disabled={busy} />
            {cashReceivedStr && cashReceived >= total && (
              <div style={{
                padding: '12px 14px', borderRadius: 12,
                background: '#E8F4E8', border: `1px solid #C2DDC1`,
                marginBottom: 12,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.ok }}>Vuelto</span>
                <span style={{ fontSize: 18, fontWeight: 800, color: T.ok, fontVariantNumeric: 'tabular-nums' }}>
                  {fmtCOP(change)}
                </span>
              </div>
            )}
            {/* En lugar del error rojo "monto menor al total", ofrecemos
                dividir el pago. La cajera escoge con qué método digital
                cubre el faltante y el split queda armado. */}
            {cashReceivedStr && cashReceived > 0 && cashReceived < total && (
              <div style={{
                padding: '12px 14px', borderRadius: 12,
                background: '#FFF7E6', border: `1px solid #F4E0BC`,
                marginBottom: 12,
              }}>
                <div style={{ fontSize: 13, color: '#7A5C00', fontWeight: 600, lineHeight: 1.45, marginBottom: 10 }}>
                  Faltan <b style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtCOP(total - cashReceived)}</b> para el total.
                  <br/>¿El cliente cubre el resto con?
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => activateSplitFromCash('nequi')}
                    disabled={busy}
                    style={splitOptionBtnStyle()}
                  >
                    <span style={{ fontSize: 18 }}>📱</span>
                    <span>NEQUI</span>
                  </button>
                  <button
                    onClick={() => activateSplitFromCash('daviplata')}
                    disabled={busy}
                    style={splitOptionBtnStyle()}
                  >
                    <span style={{ fontSize: 18 }}>📲</span>
                    <span>DAVIPLATA</span>
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Método digital sin split aún — link discreto para combinar con efectivo */}
        {isDigital && !isSplit && (
          <>
            <button
              onClick={() => setSplit({ efectivo: 0, digitalMethod: method, digitalAmount: total + DIGITAL_SURCHARGE })}
              disabled={busy}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 12,
                background: 'transparent', color: T.copper[700],
                border: `1.5px dashed ${T.copper[200]}`,
                cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
                fontSize: 12.5, fontWeight: 700, letterSpacing: 0.2,
                marginBottom: 12,
              }}
            >
              + Combinar con efectivo
            </button>
          </>
        )}

        {/* Modo split activo — card resumen + botón para deshacer */}
        {isSplit && (
          <SplitSummary
            split={split}
            method={method}
            splitCashStr={splitCashStr}
            setSplitCashStr={(v) => {
              setSplitCashStr(v)
              // Si la cajera entró por flujo digital, el input controla la
              // porción efectivo en vivo. Si entró por flujo efectivo, el
              // efectivo ya está fijado en cashReceivedStr.
              if (isDigital) activateSplitFromDigital(v)
            }}
            cameFromCash={method === 'efectivo'}
            onClear={clearSplit}
            disabled={busy}
          />
        )}

        {method === 'deuda' && (
          <>
            <ModalInput
              label="Nombre del deudor"
              value={debtorName}
              onChange={setDebtorName}
              placeholder="Ej. María Pérez"
              disabled={busy}
              autoFocus
            />
            {debtorSuggestions.length > 0 && (
              <div style={{
                marginTop: -6, marginBottom: 12, background: '#fff',
                borderRadius: 10, border: `1px solid ${T.neutral[100]}`, overflow: 'hidden',
              }}>
                {debtorSuggestions.map((d, i) => (
                  <button
                    key={d.id}
                    onClick={() => setDebtorName(d.name)}
                    style={{
                      width: '100%', padding: '8px 12px',
                      background: 'transparent', border: 'none',
                      borderBottom: i < debtorSuggestions.length - 1 ? `0.5px solid ${T.neutral[100]}` : 'none',
                      cursor: 'pointer', fontFamily: 'inherit',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      fontSize: 12.5, color: T.neutral[700], textAlign: 'left',
                    }}
                  >
                    <span>{d.name}</span>
                    <span style={{ color: T.neutral[400], fontSize: 11 }}>
                      debe {fmtCOP(d.totalOwed)}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div style={{
              padding: '10px 12px', borderRadius: 10,
              background: '#FFF7E6', border: `1px solid #F4E0BC`,
              fontSize: 12, color: T.warn, fontWeight: 500, lineHeight: 1.5, marginBottom: 12,
            }}>
              Esta venta queda registrada como deuda. El admin gestiona los pagos.
            </div>
          </>
        )}

        {error && <ErrorBox text={error} />}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCancel} disabled={busy} style={btnSecondary()}>Cancelar</button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm || busy}
            style={{
              ...btnPrimary(canConfirm && !busy ? T.copper[500] : T.neutral[200]),
              flex: 1.4,
              color: canConfirm && !busy ? '#fff' : T.neutral[400],
              cursor: canConfirm && !busy ? 'pointer' : 'not-allowed',
              boxShadow: canConfirm && !busy ? '0 3px 10px rgba(184,122,86,0.3)' : 'none',
            }}
          >
            {busy ? 'Guardando...' : 'Confirmar venta'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

// ──────────────────────────────────────────────────────────────
// Modal "Eliminar mesa": pide confirmación y cancela kitchenOrders
// asociados (si la mesa tenía almuerzos enviados a cocina) antes de
// borrar la tab. Funciona igual en cajera y en modo asistir admin —
// la diferencia la maneja Firestore Rules (cajera dueña o admin).
// ──────────────────────────────────────────────────────────────
function ConfirmDeleteTabModal({ tab, cart, state, setState, actor, onConfirmed }) {
  const kitchenItems = (cart || []).filter(it => it.source === 'kitchen' && it.kitchenOrderId)
  const hasKitchen = kitchenItems.length > 0
  const otherCount = (cart || []).length - kitchenItems.length

  async function handleConfirm() {
    if (state.busy) return
    setState(s => ({ ...s, busy: true, error: null }))
    try {
      // Cancelar kitchenOrders asociados (fire-and-forget, mismo patrón que
      // removeItem en el carrito).
      if (hasKitchen) {
        const m = await import('../kitchenOrders')
        await Promise.all(
          kitchenItems.map(it =>
            m.cancelKitchenOrder(it.kitchenOrderId, {
              reason: 'Mesa eliminada',
              cancelledBy: actor?.uid || null,
              cancelledByName: actor?.name || null,
            })
              .catch(err => console.warn('[NewSale] cancel order on tab delete:', err?.message || err))
          )
        )
      }
      await deleteOpenTab(tab.id)
      onConfirmed()
    } catch (err) {
      console.error('[NewSale] eliminar mesa falló:', err)
      const code = err?.code || ''
      const msg = code === 'permission-denied'
        ? 'No tienes permisos para eliminar esta mesa.'
        : (err?.message || 'No se pudo eliminar.')
      setState(s => ({ ...s, busy: false, error: msg }))
    }
  }

  return (
    <ModalOverlay onClose={state.busy ? undefined : () => setState(null)}>
      <div onClick={e => e.stopPropagation()} style={modalCard()}>
        <div style={{ fontSize: 18, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3 }}>
          Eliminar mesa
        </div>
        <div style={{ fontSize: 13, color: T.neutral[600], marginTop: 6, marginBottom: 14, lineHeight: 1.5 }}>
          Vas a eliminar esta mesa y todo lo que tiene encima. <b>No se cobra</b> y no queda registrada como venta.
        </div>

        {hasKitchen && (
          <div style={{
            padding: '10px 12px', borderRadius: 10, marginBottom: 12,
            background: '#FFF7E6', border: `1px solid #F4E0BC`,
            fontSize: 12.5, color: '#7A5C00', lineHeight: 1.5,
          }}>
            Hay <b>{kitchenItems.length} {kitchenItems.length === 1 ? 'almuerzo' : 'almuerzos'}</b> en
            cocina que se cancelarán automáticamente.
            {otherCount > 0 && (
              <> {otherCount} {otherCount === 1 ? 'producto' : 'productos'} adicionales también se descartan.</>
            )}
          </div>
        )}

        {!hasKitchen && (cart || []).length > 0 && (
          <div style={{
            padding: '10px 12px', borderRadius: 10, marginBottom: 12,
            background: '#FBE9E5', border: `1px solid #F0C8BE`,
            fontSize: 12.5, color: T.bad, lineHeight: 1.5,
          }}>
            La mesa tiene <b>{cart.length} {cart.length === 1 ? 'producto' : 'productos'}</b> que se van a descartar.
          </div>
        )}

        {state.error && (
          <div style={{
            marginBottom: 12, padding: '10px 12px', borderRadius: 10,
            background: '#FBE9E5', border: `1px solid #F0C8BE`, color: T.bad,
            fontSize: 12.5, fontWeight: 600, textAlign: 'center',
          }}>
            ⚠ {state.error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => setState(null)}
            disabled={state.busy}
            style={btnSecondary()}
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={state.busy}
            style={{
              ...btnPrimary(state.busy ? T.neutral[300] : T.bad),
              cursor: state.busy ? 'wait' : 'pointer',
              boxShadow: state.busy ? 'none' : `0 3px 10px ${T.bad}33`,
            }}
          >
            {state.busy ? 'Eliminando...' : 'Sí, eliminar mesa'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

// Chips de "billete rápido" para el campo de efectivo. Muestra los billetes
// reales mayores al total — así se ocultan los montos inútiles (ej. en una
// venta de $47.000 no muestra $5.000).
function QuickCashChips({ total, onPick, disabled }) {
  const BILLS = [5000, 10000, 20000, 50000, 100000]
  const options = BILLS.filter(b => b > total)
  if (options.length === 0) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: -4, marginBottom: 12 }}>
      {options.map(b => (
        <button
          key={b}
          onClick={() => onPick(String(b))}
          disabled={disabled}
          style={{
            flex: '1 1 28%', minWidth: 86, padding: '10px 6px', borderRadius: 10,
            background: '#fff', color: T.neutral[700],
            border: `1.5px solid ${T.neutral[200]}`,
            cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
            fontSize: 12.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
          }}
        >
          {fmtCOP(b)}
        </button>
      ))}
    </div>
  )
}

// Estilo del botón de selección dentro del aviso "Faltan $X · ¿con qué?".
// Pequeño y discreto — no compite visualmente con los botones primarios.
function splitOptionBtnStyle() {
  return {
    flex: 1, padding: '10px 8px', borderRadius: 10,
    background: '#fff', color: '#7A5C00',
    border: `1.5px solid #F0D699`,
    cursor: 'pointer', fontFamily: 'inherit',
    fontSize: 12.5, fontWeight: 800, letterSpacing: 0.3,
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  }
}

// Card resumen del split activo. Aparece cuando hay 2 métodos en la venta.
// Si la cajera entró por flujo digital, expone un input para tipear cuánto
// recibió en efectivo. Si entró por flujo efectivo, las dos porciones ya
// están fijadas y solo se muestran.
function SplitSummary({ split, method, splitCashStr, setSplitCashStr, cameFromCash, onClear, disabled }) {
  const METHOD_LABEL = { nequi: 'NEQUI', daviplata: 'DAVIPLATA' }
  const METHOD_ICON  = { nequi: '📱',    daviplata: '📲' }
  const digitalLabel = METHOD_LABEL[split.digitalMethod] || split.digitalMethod
  const digitalIcon  = METHOD_ICON[split.digitalMethod]  || '📱'

  return (
    <div style={{
      padding: '12px 14px', borderRadius: 14, marginBottom: 12,
      background: T.copper[50], border: `1.5px solid ${T.copper[200]}`,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 10,
      }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: T.copper[700], letterSpacing: 0.5, textTransform: 'uppercase' }}>
          🔀 Pago dividido
        </div>
        <button
          onClick={onClear}
          disabled={disabled}
          style={{
            padding: '4px 10px', borderRadius: 999,
            background: 'transparent', color: T.copper[700],
            border: `1px solid ${T.copper[200]}`,
            cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
            fontSize: 11, fontWeight: 700,
          }}
        >
          Deshacer
        </button>
      </div>

      {/* Si vino del flujo digital, dejamos editar el efectivo en vivo */}
      {!cameFromCash && (
        <ModalNumberInput
          label="¿Cuánto recibió en efectivo?"
          value={splitCashStr}
          onChange={setSplitCashStr}
          disabled={disabled}
          hint="El resto se cobra por el método digital."
        />
      )}

      <div style={{
        padding: '10px 12px', borderRadius: 10, background: '#fff',
        border: `1px solid ${T.copper[100]}`,
      }}>
        <SplitRow icon="💵" label="Efectivo" amount={split.efectivo} />
        <SplitRow icon={digitalIcon} label={digitalLabel} amount={split.digitalAmount} />
        <div style={{
          marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${T.copper[200]}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        }}>
          <span style={{ fontSize: 12, color: T.neutral[600], fontWeight: 600 }}>Total</span>
          <span style={{ fontSize: 16, fontWeight: 800, color: T.neutral[900], fontVariantNumeric: 'tabular-nums' }}>
            {fmtCOP(split.efectivo + split.digitalAmount)}
          </span>
        </div>
      </div>
    </div>
  )
}

function SplitRow({ icon, label, amount }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      padding: '3px 0',
    }}>
      <span style={{ fontSize: 13, color: T.neutral[700], fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 15 }}>{icon}</span>
        {label}
      </span>
      <span style={{ fontSize: 14, fontWeight: 800, color: T.neutral[900], fontVariantNumeric: 'tabular-nums' }}>
        {fmtCOP(amount)}
      </span>
    </div>
  )
}

function PaymentOption({ icon, label, subtitle, selected, onClick, disabled }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        padding: '14px 12px', borderRadius: 14,
        background: selected ? T.copper[50] : '#fff',
        border: `1.5px solid ${selected ? T.copper[400] : T.neutral[200]}`,
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
        opacity: disabled ? 0.45 : 1,
        transition: 'all 0.12s',
      }}
    >
      <div style={{ fontSize: 24 }}>{icon}</div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: selected ? T.copper[700] : T.neutral[800] }}>
        {label}
      </div>
      {subtitle && (
        <div style={{ fontSize: 10, color: T.neutral[400], fontWeight: 500 }}>{subtitle}</div>
      )}
    </button>
  )
}

// ──────────────────────────────────────────────────────────────
// Componentes utilitarios
// ──────────────────────────────────────────────────────────────
function ModalInput({ label, value, onChange, placeholder, disabled, autoFocus }) {
  const [focused, setFocused] = useState(false)
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: T.neutral[600], display: 'block', marginBottom: 6 }}>
        {label}
      </label>
      <div style={{
        border: `1.5px solid ${focused ? T.copper[400] : T.neutral[200]}`,
        borderRadius: 12, background: '#fff', transition: 'border-color 0.12s',
      }}>
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            width: '100%', padding: '12px 14px', border: 'none', outline: 'none',
            fontFamily: 'inherit', fontSize: 14.5, color: T.neutral[900],
            background: 'transparent', borderRadius: 12,
            opacity: disabled ? 0.6 : 1,
          }}
        />
      </div>
    </div>
  )
}

// Stepper para número de mesa: número grande centrado + botones − / +
function TableNumberStepper({ label, value, onChange, min = 1, max = 99, error }) {
  const num = Number(value) || min
  const dec = () => onChange(String(Math.max(min, num - 1)))
  const inc = () => onChange(String(Math.min(max, num + 1)))
  return (
    <div style={{ marginBottom: 12 }}>
      {label && (
        <label style={{
          fontSize: 12, fontWeight: 600, color: T.neutral[600],
          display: 'block', marginBottom: 8, textAlign: 'center',
        }}>
          {label}
        </label>
      )}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14,
      }}>
        <button
          onClick={dec}
          disabled={num <= min}
          style={stepperBtn(num <= min)}
          aria-label="Disminuir"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M5 10 H15" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/>
          </svg>
        </button>
        <div style={{
          minWidth: 100, padding: '14px 20px', borderRadius: 16,
          background: error ? '#FBE9E5' : T.copper[50],
          border: `2px solid ${error ? '#F0C8BE' : T.copper[200]}`,
          textAlign: 'center',
          fontSize: 38, fontWeight: 800, color: error ? T.bad : T.copper[700],
          letterSpacing: -1, fontVariantNumeric: 'tabular-nums', lineHeight: 1,
          transition: 'all 0.15s',
        }}>
          {num}
        </div>
        <button
          onClick={inc}
          disabled={num >= max}
          style={stepperBtn(num >= max)}
          aria-label="Aumentar"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M10 5 V15 M5 10 H15" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    </div>
  )
}

function stepperBtn(disabled) {
  return {
    width: 52, height: 52, borderRadius: 999,
    background: disabled ? T.neutral[100] : T.copper[500],
    color: disabled ? T.neutral[400] : '#fff',
    border: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: 'inherit',
    boxShadow: disabled ? 'none' : '0 3px 10px rgba(184,122,86,0.35)',
    transition: 'all 0.15s',
    flexShrink: 0,
  }
}

function ModalNumberInput({ label, value, onChange, disabled, hint }) {
  const [focused, setFocused] = useState(false)
  function sanitize(raw) {
    return raw.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '')
  }
  const display = value === '0' ? '' : value
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: T.neutral[600], display: 'block', marginBottom: 6 }}>
        {label}
      </label>
      <div style={{
        border: `1.5px solid ${focused ? T.copper[400] : T.neutral[200]}`,
        borderRadius: 12, background: '#fff', transition: 'border-color 0.12s',
        display: 'flex', alignItems: 'center',
      }}>
        <span style={{ paddingLeft: 14, color: T.neutral[500], fontSize: 15, fontWeight: 600 }}>$</span>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={display}
          onChange={e => onChange(sanitize(e.target.value))}
          placeholder="0"
          disabled={disabled}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            width: '100%', padding: '12px 14px 12px 8px', border: 'none', outline: 'none',
            fontFamily: 'inherit', fontSize: 16, color: T.neutral[900],
            background: 'transparent', borderRadius: 12,
            opacity: disabled ? 0.6 : 1,
            fontVariantNumeric: 'tabular-nums', fontWeight: 600,
          }}
        />
      </div>
      {hint && (
        <div style={{ fontSize: 11.5, color: T.neutral[400], marginTop: 4, lineHeight: 1.45 }}>{hint}</div>
      )}
    </div>
  )
}

function ErrorBox({ text }) {
  return (
    <div style={{
      marginBottom: 10, padding: '10px 12px', borderRadius: 10,
      background: '#FBE9E5', border: `1px solid #F0C8BE`, color: T.bad,
      fontSize: 12.5, fontWeight: 500, textAlign: 'center',
    }}>
      {text}
    </div>
  )
}

function ModalOverlay({ onClose, children }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 90,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      {children}
    </div>
  )
}

function modalCard() {
  return {
    width: '100%', maxWidth: 420,
    background: '#fff', borderRadius: 22,
    padding: '24px 22px 22px',
    boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
    animation: 'fadeScaleIn 0.2s ease',
    maxHeight: '92vh', overflowY: 'auto',
  }
}

function btnPrimary(bg) {
  return {
    flex: 1, padding: '12px', borderRadius: 12,
    background: bg, color: '#fff',
    border: 'none', cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
  }
}
function btnSecondary() {
  return {
    flex: 1, padding: '12px', borderRadius: 12,
    background: T.neutral[100], color: T.neutral[700],
    border: 'none', cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
  }
}

// Score de relevancia para búsqueda por nombre (menor = más relevante).
//   0 → match exacto
//   1 → el nombre empieza con la búsqueda  ("Pan" para "pan")
//   2 → alguna palabra interna empieza con la búsqueda  ("Pan blanco" para "blanco")
//   3 → solo contiene la búsqueda  ("Empanada" para "pan")
//  -1 → no matchea (se filtra)
//
// Ambos parámetros deben venir ya normalizados (lowercase + sin tildes).
function scoreNameMatch(name, query) {
  if (!query) return 0
  if (!name) return -1
  if (name === query) return 0
  if (name.startsWith(query)) return 1
  // Palabra interna que empiece con query (separadores: espacio, guión, slash)
  if (name.split(/[\s\-/]+/).some(w => w.startsWith(query))) return 2
  if (name.includes(query)) return 3
  return -1
}

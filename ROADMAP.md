# ROADMAP — Sistema de Cajeras y Caja TodyPan

> **Documento de seguimiento.** Se actualiza al final de cada sesión marcando lo completado.
> Si cambias de chat, abre este archivo primero para retomar el contexto sin perder nada.

---

## 0 · Contexto

La app actual (`todypan-app`) es el **panel de administración**. Vamos a añadir un **sistema de cajeras** sobre la misma app:

- Las cajeras registran ventas, gestionan su caja diaria, registran gastos de caja
- El admin (`todypan777@gmail.com` → **Jhonatan Miranda**) revisa, aprueba y consolida
- Todo en la misma app, mismo deploy, diferenciado por rol

**Stack:** React + Vite + Firebase Firestore + Firebase Auth (Google) + ImageBB para fotos + Vercel.

---

## 1 · Estado actual de la app (lo que ya existe)

- [x] Firebase Auth con Google Sign-In
- [x] Gatekeeper en cliente: solo `todypan777@gmail.com` accede *(provisional, se reemplaza en Fase 1 por chequeo de role en Firestore)*
- [x] Reglas Firestore restringidas a admin email (`todypan777@gmail.com`) publicadas
- [x] Deploy en Vercel automático desde push a `master`
- [x] PWA instalable (Android + iOS)
- [x] Dominio Vercel autorizado en Firebase Auth

**Pestañas existentes (admin):** Dashboard · Registro · Equipo · Más → Movimientos / Reportes / Productos / Recordatorios / Panaderías

---

## 2 · Decisiones cerradas (no se vuelven a discutir)

| # | Decisión |
|---|---|
| **D1** | Auth flow con **cola de aprobación** (B). Empleada se registra con Google, digita nombre+apellido, queda `pending`. Admin recibe popup al entrar a la app y aprueba desde pestaña Usuarios. |
| **D2** | Productos nuevos creados por cajera: se guardan **al instante** en el catálogo con solo precio (sin costo). Quedan flagged `needsCostReview` para que el admin los complete. |
| **D3** | ~~Apertura de caja: el cierre anterior se transfiere automáticamente si el handover fue cajera→cajera. Si fue cajera→admin, la siguiente cajera abre en $0.~~ **OBSOLETA por D25** — el admin abre y cierra todos los turnos. |
| **D4** | Fotos de comprobantes en **ImageBB** (gratis, público pero URL aleatoria). |
| **D5** | **Solo un turno activo por panadería.** Cajera nueva no puede abrir si la anterior no cerró. |
| **D6** | Edición/borrado de venta por cajera: solo deja **nota**. Admin decide qué hacer desde su lado. |
| **D7** | UI **mobile-first** (cajeras casi todo desde celular) + buena versión desktop (admin). |
| **D8** | Foto NEQUI/DAVIPLATA es **obligatoria**, captura nativa de cámara. |
| **D9** | Cambio de panadería = cerrar turno + abrir uno nuevo en la otra panadería. |
| **D10** | Cajeras pueden trabajar en **cualquier panadería** sin restricción. |
| **D11** | Al aprobar cajera → se crea **automáticamente** un Empleado vinculado (admin no debe duplicar registro). |
| **D12** | Pagos/abonos de deudas los registra **solo el admin** desde su pestaña Deudores. La cajera solo crea ventas con método "deuda". |
| **D13** | Notificaciones admin: **banner en Dashboard** + **badges en pestañas**. Excepción: popup al admin cuando hay usuario pendiente de aprobación. |
| **D14** | Gastos de caja entran como **pendientes**. Admin aprueba/rechaza → al aprobar se convierten en `movement` tipo gasto con `origen: "caja"`. Sin opción de editar (rechazar y rehacer). |
| **D15** | Pestaña **"Pendientes"** del admin que agrupa: usuarios pendientes, gastos de caja pendientes, solicitudes de edición/borrado de ventas, productos sin costo. |
| **D16** | Modal de aprobación de cajera pide: nombre completo (editable), teléfono/WhatsApp (obligatorio), salario (opcional). |
| **D17** | ~~Apertura de caja: si la cajera receptora detecta que recibió menos…~~ **OBSOLETA por D25** — el admin abre cada turno con el monto que físicamente deja en caja, no hay disputas. |
| **D18** | **Sobras al cierre** (declarado > esperado): el efectivo físico se entrega completo (modelo mezclado). El excedente se suma a un **fondo virtual `surplusFund`** del negocio que crece con cada cierre con sobra. Sirve como reserva contable para cubrir faltantes futuros u otros gastos. |
| **D19** | **Faltas al cierre** (declarado < esperado): se registra como `closingDiscrepancy.status = 'pending'`. **El admin decide caso por caso** desde Pendientes — sin umbral fijo: o lo asume como pérdida del negocio (se cubre con `surplusFund` si hay saldo), o se descuenta a la cajera. |
| **D20** | Si admin elige "descontar a la cajera", el monto se **integra automáticamente al sistema de nómina existente**: se resta del próximo pago en la pantalla Equipo / pago de nómina. La cajera puede agregar una **nota** explicativa al momento de cerrar el turno. |
| **D21** | **Control anti-fraude:** la cajera **NUNCA** ve el monto esperado en caja, el total acumulado, ni la diferencia. Aplica durante todo el turno y en la lista de ventas. (Con D25 ya tampoco ve el cierre — el admin lo hace solo.) |
| **D25** | **El admin abre y cierra todos los turnos** (cambio de modelo, 2026-05-06). La cajera solo vende y registra gastos: no abre, no cierra, no decide handover, no deja notas. Reemplaza a D3, D6 (parcial), D17. El admin gestiona todo desde el panel central del Dashboard ("Caja · N/M con turno"): un solo modal para `Abrir turno` (elige cajera + monto inicial) y un solo modal para `Cerrar caja` (cuenta físico + decide qué hacer con la plata + resuelve gastos pendientes y discrepancias en una sola operación). El estado `pending_close` ya no se genera; se mantiene solo para sesiones legacy. |

---

## 3 · Modelo de datos (Firestore)

```
users/{uid}
  email, photoURL          (de Google)
  nombre, apellido         (digitados al registrarse)
  role: 'admin' | 'cashier'
  status: 'pending' | 'approved' | 'inactive'
  createdAt, approvedAt, approvedBy
  linkedEmployeeId         (uid del empleado creado al aprobar)

products/{id}              (existente — se añaden 2 campos)
  + createdByCashier: bool
  + needsCostReview: bool

sales/{id}
  date (YYYY-MM-DD), createdAt (serverTimestamp)
  branchId, sessionId
  cashierUid, cashierName
  items: [{ productId, name, qty, unitPrice, subtotal }]
  total
  paymentMethod: 'efectivo' | 'nequi' | 'daviplata' | 'deuda'
  cashReceived?            (solo efectivo, para vuelto)
  photoUrl?                (solo nequi/daviplata, ImageBB)
  debtorId?, debtorName?   (solo deuda)
  status: 'active' | 'edit_requested' | 'delete_requested'
  notes: [{ by, byName, at, message }]

debtors/{id}
  name, normalizedName, totalOwed
  history: [
    { type: 'sale', saleId, amount, date },
    { type: 'payment', amount, method, date, registeredBy }   ← solo admin
  ]

cashSessions/{id}
  branchId, branchName, cashierUid, cashierName
  openedAt, openingFloat
  openingSource: { type: 'empty' | 'handover' | 'handover_disputed', fromSessionId?, fromCashierName? }
  openingDispute?: {                          ← cajera receptora declaró monto distinto
    expected, declared, difference,
    status: 'pending' | 'resolved' | 'rejected',
    note?, reviewedBy?, reviewedAt?, reportedAt
  }
  closedAt?, declaredClosingCash?
  expectedCash?, difference?
  closingNote?                                ← nota opcional de cajera al cerrar
  closingDiscrepancy?: {                      ← cuando declarado != esperado
    type: 'shortage' | 'surplus',             ← falta o sobra
    amount,                                   ← magnitud absoluta
    status: 'pending' | 'absorbed' | 'deducted' | 'fundCovered' | 'fundDeposited',
    resolution?: 'business_loss' | 'cashier_deduction' | 'covered_by_fund',
    deductionId?,                             ← id de la deducción en nómina (si aplica)
    fundMovementId?,                          ← id del movimiento en surplusFund (si aplica)
    reviewedBy?, reviewedAt?, reviewNote?
  }
  handover?: { type: 'admin' | 'cashier', toUid?, toName, amount }
  status: 'open' | 'closed'

cashExpenses/{id}
  sessionId, branchId, cashierUid, cashierName
  description, amount, photoUrl?
  createdAt
  status: 'pending' | 'approved' | 'rejected'
  reviewedBy?, reviewedAt?, reviewNote?
  movementId?              (id del movement creado al aprobar)

todypan/data  (doc principal — se añaden estos campos)
  + surplusFund: {
      balance,                                ← saldo virtual acumulado
      history: [
        { type: 'deposit', amount, sessionId, cashierName, date },     ← cierre con sobra
        { type: 'withdrawal', amount, reason, sessionId?, date },      ← admin saca para cubrir falta o gasto
      ]
    }
  + cashierDeductions: [                      ← descuentos pendientes vs nómina
      {
        id, employeeId, cashierUid, amount,
        reason: 'cash_shortage' | 'other',
        sessionId?, date,
        status: 'pending' | 'applied',
        appliedAt?, appliedToPaymentDate?     ← cuándo se restó al pagar
      }
    ]
```

**Pestaña "Pendientes" del admin** = agregador en UI, no es una colección. Junta:
- `users` con `status === 'pending'`
- `cashSessions` con `openingDispute.status === 'pending'` (disputas de apertura)
- `cashSessions` con `closingDiscrepancy.status === 'pending'` (faltas/sobras de cierre — solo si es shortage requiere acción del admin)
- `sales` con `status` de tipo `_requested`
- `cashExpenses` con `status === 'pending'`
- `products` con `needsCostReview === true`

---

## 4 · Plan por fases

### ✅ Fase 1 — Auth con cola de aprobación
**Objetivo:** Empleadas pueden registrarse, quedan pendientes, admin aprueba y se crea empleada.

- [x] Bootstrap automático del admin al primer login (sin paso manual)
- [x] Reemplazar gatekeeper hardcoded por chequeo de Firestore (`role === 'admin' && status === 'approved'`)
- [x] Pantalla de registro para usuarios nuevos (digita nombre + apellido)
- [x] Pantalla "Tu cuenta está pendiente de aprobación" para users con `status === 'pending'`
- [x] Pantalla "Tu cuenta fue desactivada" para `status === 'inactive'`
- [x] Pantalla "Cashier coming soon" para cajeras aprobadas (placeholder hasta Fase 2+)
- [x] Pestaña **Usuarios** en Más (admin) y Sidebar: tabs Pendientes / Activos / Inactivos
- [x] Modal de aprobación: nombre editable, teléfono obligatorio, salario opcional
- [x] Al aprobar → crear doc en `users` (status approved) + crear `employee` vinculado en colección existente
- [x] Botones Desactivar/Reactivar/Rechazar (sin borrar nunca)
- [x] Popup automático al admin si hay usuarios pendientes al entrar
- [x] Banner persistente "Tienes N cosas por revisar" en Dashboard
- [x] Reglas Firestore actualizadas (cajera puede crear/leer su propio doc; admin gestiona todo)
- [x] Build + deploy a Vercel
- [x] **Probado end-to-end:** registro cajera → aprobación admin → empleada creada → cajera entra como activa

**Commit:** `4b2ef61` — feat(fase-1): sistema de usuarios con cola de aprobacion

---

### ✅ Fase 2 — Apertura/cierre de turno
**Objetivo:** Cajera puede iniciar turno (escogiendo panadería) y cerrar con cuadre + handover + manejo de sobras/faltas. Sin ventas todavía.

**Apertura:**
- [x] Pantalla "Iniciar turno" para cajera al entrar (selector de panadería)
- [x] Cajera NO digita monto inicial (en ningún caso)
- [x] Si hay handover de cajera anterior: muestra monto en grande + botón "Sí, recibí los $X completos" / "No, recibí otra cantidad"
- [x] Si "No": input para declarar lo recibido + nota al admin que el monto es disputado → crea `openingDispute.status = 'pending'`
- [x] Si no hay handover: cartel "Caja vacía · $0" + botón "Iniciar turno"
- [x] Validación: solo una sesión `open` por branchId (panadería bloqueada en selector si está ocupada)
- [x] Pantalla de turno activo: card neutro "Tu turno está activo" (sin mostrar monto — D21 anti-fraude)
- [x] initDB() compartido entre admin y cajera (cajera lee branches reales, no defaults hardcoded)

**Cierre:**
- [x] Botón "Cerrar turno" → modal en 2 pasos
- [x] Paso 1 (Conteo): solo input "¿cuánto tienes en caja?" + textarea de nota opcional. **NO se muestra esperado ni diferencia** (D21)
- [x] Textarea de nota siempre opcional (no condicional a diferencia, para que cajera no infiera)
- [x] Paso 2 (Entrega): selector "¿A quién entregas?" — admin o dropdown de cajeras activas
- [x] Tarjeta resumen "Vas a entregar $X" (= lo declarado, no se pide dos veces)
- [x] Si **sobra** (declared > expected): se calcula internamente y se acumula al fondo virtual `surplusFund` (cajera no se entera)
- [x] Si **falta** (declared < expected): se crea `closingDiscrepancy.status = 'pending'` con type='shortage'. Admin decide en Pendientes (Fase 6).
- [x] Crear doc completo en `cashSessions` con todo el detalle

**Notificación al admin (banner):**
- [x] Disputas de apertura cuentan en banner del admin con detalle
- [x] Discrepancias de cierre tipo `shortage` cuentan en banner del admin con detalle (incluye nota de cajera si la dejó)
- [x] Sobras NO requieren acción (solo se suman al fondo en silencio)
- [x] Bloque verde con saldo del fondo de sobras visible cuando > $0

**Anti-fraude (D21):**
- [x] Cajera nunca ve esperado, total acumulado ni diferencia
- [x] Input de declaración arranca vacío (no pre-llenado con esperado)
- [x] Card "Apertura" en pantalla de turno activo NO muestra monto

**Reglas Firestore:**
- [x] Reglas comprehensivas publicadas que cubren cashSessions, sales, debtors, cashExpenses (no se tocan más hasta Fase 10)

**Resolución completa de disputas/discrepancias por el admin:** vendrá en **Fase 6** con la pestaña Pendientes.
**Aplicación de descuentos al pago de nómina:** vendrá en **Fase 6.5**.

**Commits:**
- `a7a41a7` — feat(fase-2): apertura y cierre de turno con cuadre y handover
- `21875cc` — fix: cajera ve panaderias reales y no digita monto inicial
- `12df9e9` — feat: cajera confirma o disputa el monto recibido en handover
- `c919514` — fix: quitar cero inicial en campos de monto
- `bfb1fce` — fix: no pedir el monto entregado dos veces
- `1270cb9` — feat: sobras al fondo + faltas a Pendientes con nota
- `6dfb13d` — fix: ocultar monto esperado y diferencia (anti-fraude)
- `c6144c8` — docs(roadmap): D21 anti-fraude

---

### ✅ Fase 3 — Flujo de venta básico (efectivo + deuda)
**Objetivo:** Cajera registra ventas con método EFECTIVO o DEUDA. NEQUI/DAVIPLATA viene en Fase 4.

- [x] Pantalla "Nueva venta" (botón cobre grande en home cajera)
- [x] Buscador de productos con autocompletado (admin + cajera unificados)
- [x] Si producto no existe → modal "Crear producto: nombre + precio" (queda en `/products/{id}` con `needsCostReview: true`)
- [x] Carrito con cantidad editable, subtotal por línea, total visible
- [x] Botón "Cobrar $X" sticky abajo → modal de método de pago
- [x] EFECTIVO: campo opcional "recibido" → muestra vuelto en verde
- [x] DEUDA: input de nombre del deudor con autocompletado de existentes
- [x] Al guardar venta: actualiza `debtors` (crea o suma al `totalOwed`)
- [x] Lista de **últimas 15 ventas en home cajera** (sin montos — D21)
- [x] Cajera puede **reportar problema** en una venta (status='flagged' + nota); NO edita ni borra (D6)
- [x] Sección "Pendientes de revisión" en admin Products para gestionar productos creados por cajera (eliminar)
- [x] Reglas Firestore actualizadas (bloque /products/{pid})
- [x] Build + deploy

**Commits:**
- `2f17bd1` — feat(fase-3): flujo de venta basico (efectivo + deuda)
- `bae9026` — fix: alinear header/footer/contenido en mismo maxWidth
- `e5ea33d` — feat(admin): seccion 'Pendientes de revision' en Products
- `46910e7` — feat: lista de ultimas 15 ventas + reportar problema

---

### ✅ Fase 4 — NEQUI/DAVIPLATA + ImageBB
**Objetivo:** Pagos digitales con foto obligatoria del comprobante.

- [x] API key de ImageBB configurada (env var `VITE_IMGBB_API_KEY`)
- [x] `.env.local` para dev + Vercel env var para producción (no se sube al repo)
- [x] Helper `compressImage()` (max 1024px lado mayor, calidad JPEG 0.85)
- [x] Helper `uploadToImageBB()` con manejo de errores (sin red, server error, response inválida)
- [x] Captura de cámara nativa (input file con `capture="environment"`)
- [x] Vista previa de la foto antes de guardar
- [x] Validación: no se puede guardar venta NEQUI/DAVIPLATA sin foto
- [x] 4 estados visuales: inicial · subiendo · error con reintentar · subida con preview + cambiar foto
- [x] `photoUrl` se guarda en `sales[].photoUrl`
- [x] Build + deploy a producción

**Commits:**
- `110d4a7` — feat(fase-4): NEQUI/DAVIPLATA con foto obligatoria via ImageBB
- `94cfe4d` — chore: trigger redeploy para activar env var en produccion

---

### ✅ Fase 5 — Gastos de caja
**Objetivo:** Cajera registra gastos de caja → quedan pendientes para admin.

- [ ] Botón "Gasto de caja" en home cajera
- [ ] Form: descripción, monto, foto opcional
- [ ] Crear doc en `cashExpenses` con `status: 'pending'`
- [ ] El monto afecta inmediatamente el "esperado en caja" del cuadre
- [ ] Vista cajera: lista de sus gastos del turno (pending/approved/rejected)
- [ ] Si rechazado: ve nota del admin
- [ ] Build + deploy

---

### ✅ Fase 6 — Pestaña Pendientes (admin)
**Objetivo:** Admin tiene un solo lugar para revisar todo.

- [ ] Pestaña "Pendientes" en sidebar (con badge de contador)
- [ ] Banner en Dashboard "Tienes N cosas por revisar" (ya existe parcial desde Fase 1+2)
- [ ] Sub-listas: Usuarios · **Disputas de apertura** · **Faltas de cierre** · Gastos de caja · Solicitudes de venta · Productos sin costo

**Disputas de apertura (`openingDispute`):**
- [ ] Mostrar: cajera receptora, esperado, declarado, diferencia, fecha
- [ ] Botones: "Aceptar declaración" (cierra como `resolved`) / "Rechazar" (cierra como `rejected` con nota)
- [ ] Si rechaza: opción de descontar la diferencia a la cajera **entregadora** (la que dijo haber dado más)

**Faltas de cierre (`closingDiscrepancy.type === 'shortage'`):**
- [ ] Mostrar: cajera, panadería, fecha, monto faltante, nota explicativa de la cajera
- [ ] 3 acciones del admin:
  - [ ] **"Asumir como pérdida del negocio"** → `resolution = 'business_loss'`, sin afectar cajera
  - [ ] **"Cubrir con fondo de sobras"** → si `surplusFund.balance >= monto`: descuenta del fondo, `resolution = 'covered_by_fund'`, agrega entry tipo `withdrawal` en `surplusFund.history`
  - [ ] **"Descontar a la cajera"** → crea entry en `cashierDeductions` con `status: 'pending'`, `resolution = 'cashier_deduction'`. Se aplicará al pagar nómina (Fase 7 o mini-update integra al flujo de pagos existente).

**Gastos de caja (`cashExpenses.status === 'pending'`):**
- [ ] Cada gasto: aprobar / rechazar con nota
- [ ] Al aprobar gasto → crear `movement` tipo gasto con `origen: "caja"` + linkear `movementId`

**Build + deploy.**

---

### ✅ Fase 6.5 — Integración descuentos con nómina
**Objetivo:** Cuando admin marca un descuento a cajera (desde Pendientes), se aplica al sistema de pagos existente.

- [x] En la pantalla **Equipo → detalle de empleada**: nueva sección "Descuentos pendientes"
- [x] Lista de `cashierDeductions` con `status: 'pending'` para esa empleada
- [x] Cada descuento muestra: razón, fecha, monto en rojo
- [x] Al pagar nómina: el sistema **resta automáticamente** los descuentos pendientes del total a pagar (`owed = grossOwed − totalDeductions`)
- [x] Modal de confirmación de pago con desglose: días + descuentos − = neto a pagar
- [x] Al confirmar el pago: `payAllPending` + `applyDeductions` (status → applied con fecha)
- [x] Sección colapsable **"Mis descuentos"** para cajera en home: ve histórico completo (pending/applied/cancelled) con montos y fechas — transparencia
- [x] Build + deploy

**Commits:** `[ver siguiente push]`

---

### ✅ Fase 7 — Vista admin de Ventas
**Objetivo:** Admin ve todas las ventas con filtros.

- [x] Pestaña "Ventas" en sidebar y en Más (mobile)
- [x] Vista responsive: tabla compacta en desktop, lista de tarjetas en mobile
- [x] Cada item: fecha, hora, cajera, panadería, método (icono), total, badge de estado
- [x] Filtros: rango de fechas (con shortcuts Hoy / Este mes), cajera, panadería, método (chips), estado (chips)
- [x] Subtítulo dinámico: "N ventas · $total"
- [x] Click en venta → modal con detalle completo:
  - [x] Items con qty, precio unitario, subtotal
  - [x] Total grande
  - [x] Método de pago (icono + capitalize)
  - [x] Si efectivo: monto recibido + vuelto
  - [x] Si deuda: nombre del deudor
  - [x] Si NEQUI/DAVIPLATA: foto del comprobante (clickeable a tamaño completo)
  - [x] Notas / reportes de la cajera con autor y timestamp
- [x] **Resolución de solicitudes:** se hace desde la pestaña Pendientes (Fase 6) — no se duplica aquí. El modal incluye nota.
- [x] Build + deploy

---

### ✅ Fase 8 — Deudores (admin)
**Objetivo:** Admin gestiona pagos y abonos de deudas.

- [x] Pestaña "Deudores" en sidebar y en Más (mobile)
- [x] Card resumen "Total adeudado" en negro con total + cantidad de personas
- [x] Tabs Activos / Pagados con count + buscador por nombre
- [x] Lista ordenada por monto descendente
- [x] Avatar con iniciales (cobre activos, gris pagados)
- [x] Click → modal de detalle con header de color (cobre activo / verde pagado)
- [x] Historial completo con tipo (venta/abono), fecha, método, foto, nota, monto coloreado
- [x] Botón **"Registrar abono o pago"** que abre form inline:
  - [x] Input monto con quick-fill "Pagar todo" / "Mitad"
  - [x] Indicador en vivo: "quedaría debiendo $X" (verde) o "excede la deuda" (rojo)
  - [x] Selector de método (Efectivo / NEQUI / DAVIPLATA)
  - [x] Foto opcional del comprobante (mismo flujo ImgBB)
  - [x] Nota interna opcional
- [x] Helper `registerDebtorPayment` en debtors.js:
  - [x] Resta del totalOwed
  - [x] Agrega entry tipo 'payment' al history
  - [x] Si totalOwed llega a 0 → status='paid' automático
- [x] Build + deploy

---

### ✅ Fase 9.5 — Modo Offline
**Objetivo:** Las cajeras pueden operar sin internet. La app guarda todo localmente y sube cuando vuelve la red. Antes de cerrar turno, todo debe estar sincronizado.

**9.5.1 — Persistencia Firestore + indicadores:**
- [x] `initializeFirestore` con `persistentLocalCache` + `persistentMultipleTabManager` en [firebase.js](src/firebase.js) — lecturas y escrituras encoladas en IndexedDB
- [x] `utils/network.js`: `useOnlineStatus`, `usePendingWrites`, `flushPendingWrites`, `reconnectFirestore`
- [x] `components/ConnectionChip.jsx`: píldora con estados sincronizado / subiendo / sin conexión + modal de detalle
- [x] `createdAtClient` (timestamp de respaldo) en sales, cashExpenses, cashSessions — para ordenar la lista mientras la cola sube
- [x] Chip montado en header cajera y flotante en admin (a la izquierda de la campana)

**9.5.2 — Cola de fotos en IndexedDB:**
- [x] `utils/photoQueue.js` (DB `todypan-offline`, store `photos`): worker con backoff exponencial 2s→1h, máximo 8 reintentos
- [x] `enqueuePhoto`, `usePendingPhotos`, `startPhotoQueueWorker`, `flushQueueNow`
- [x] `sales` y `cashExpenses` aceptan `photoLocalId` + setean `photoStatus: 'pending' | 'uploaded' | 'failed'`
- [x] `NewSale.jsx`: si la cajera está sin red, captura → comprime → guarda preview local → permite confirmar venta. Foto se sube automáticamente al volver la red
- [x] `CashExpenseModal` aplica el mismo flujo
- [x] Worker arranca en `main.jsx` y se despierta con evento `online`
- [x] `ConnectionChip` muestra contador de fotos pendientes con badge numérico
- [x] Vista admin de Ventas (Fase 7): badges ⏳ pendiente / ⚠ failed en lista y detalle

**9.5.3 — Bloqueo de cierre con cola pendiente:**
- [x] `navigator.storage.persist()` solicitado al inicio: blinda IndexedDB ante limpiezas automáticas del SO
- [x] `components/SyncBeforeCloseModal.jsx`: modal con barra de progreso de fotos en vivo
- [x] El botón "Cerrar turno" verifica `getPendingCount()` + estado online; si hay pendientes muestra el modal de sync primero
- [x] Cuando todo llega a 0 → modal pasa a ✅ y abre el modal de cierre normal automáticamente
- [x] Si está offline: modal queda esperando red. Botón "Mantener turno abierto y volver luego" para abortar

**Decisiones cerradas en esta fase:**
- D22: La cola de fotos se reintenta automáticamente con backoff exponencial. Si falla 8 veces, la venta queda con `photoStatus: 'failed'` y el admin la ve marcada — la cajera debe re-tomar la foto manualmente.
- D23: El cierre de turno está diseñado para nunca avanzar sin tener todo subido. La única salida es "Mantener turno abierto" — la cajera puede volver luego cuando haya señal.
- D24: Para celulares con poco almacenamiento, `navigator.storage.persist()` blinda los datos. En PWA instalada se concede sin preguntar.

---

### ✅ Fase 9 — Vista cajera de ventas (días anteriores)
**Objetivo:** Cajera consulta historial sin poder editar. Read-only y respetando D21 (anti-fraude).

- [x] Pantalla [MyHistoricalSales](src/screens/MyHistoricalSales.jsx) para cajera
- [x] Default: ventas del día actual (zona Bogotá)
- [x] Selector de fecha → ventas anteriores (botón "Hoy" para volver rápido)
- [x] Filtros por método (chips: efectivo / NEQUI / DAVIPLATA / deuda)
- [x] Click en venta → modal de detalle read-only
- [x] **Sin botones de "Solicitar edición/borrado"** — D6 manda. La cajera reporta problema con `flagSale` (ya existía en Fase 3) y eso solo deja nota
- [x] Watcher dedicado [watchCashierSalesByDate](src/sales.js) por `cashierUid + date`
- [x] Botón "Mis ventas" en home cajera (junto a "Gasto de caja")
- [x] Modal `ReportSaleModal` reutilizado (exportado desde CashierApp.jsx)
- [x] Build + deploy

**D21 anti-fraude aplicado en TODA esta vista:**
- ❌ NO se muestra `total` por venta
- ❌ NO se muestra `unitPrice` ni `subtotal` por ítem
- ❌ NO se muestra suma agregada del día
- ✅ SÍ se muestra cantidad de ventas (es número, no monto)
- ✅ SÍ se muestran productos (nombre + qty), hora, método, deudor (si aplica), foto del comprobante, notas
- ✅ Badges ⏳/⚠ para fotos pendientes/fallidas (consistencia con vista admin)

---

### ✅ Fase 11 — Sistema de tareas asignadas a cajeras
**Objetivo:** Admin asigna tareas a una cajera; ella las chulea durante su turno; el cierre antiguo deja constancia de hechas y pendientes.

**Modelo:** colección nueva `tasks/{id}` con `assignedToUid`, `title`, `description?`, `branchId?`, `dueDate?`, `status: pending|done|cancelled`, `completedInSessionId?`, `completedNote?`, etc.

**Admin:**
- [x] Pestaña **Tareas** en sidebar (desktop) y en Más (mobile) — icono cuadrado con check
- [x] 3 tabs: Activas · Hechas · Canceladas (píldoras segmentadas con count)
- [x] Botón "Nueva tarea" cobre arriba de la lista
- [x] Modal de creación: título (req), descripción opcional, asignar a (chips de cajeras activas con avatar), panadería opcional (chips), fecha límite opcional
- [x] Modal de detalle: estado pill, info compacta (asignada/panadería/creada/completada), notas, acciones (editar/cancelar/reactivar)
- [x] Estados vacíos por tab con CTA cuando aplica

**Cajera:**
- [x] Card "Tus tareas" en home del turno (entre estado activo y últimas ventas)
- [x] Lista con checkbox cuadrado, animación pop al chulear (`taskTickPop`), tachado + opacidad reducida cuando hecha
- [x] Tap en checkbox → `markTaskDone` con `sessionId` del turno actual
- [x] Re-tap → `unmarkTaskDone` (mientras turno siga abierto)
- [x] Descripción colapsable (1 línea con line-clamp + tap para expandir)
- [x] Badges de fecha: ⏰ Hoy / Mañana / Vencida con color
- [x] Card cambia a fondo verde sutil cuando todas están hechas (✓ Todas hechas)

**Cierre antiguo (admin):**
- [x] Sección "Tareas del turno · X/N completadas" en `ClosureDetailModal` ([Registro.jsx](src/screens/Registro.jsx))
- [x] Lista de tareas hechas (con hora y nota si tiene) y pendientes que aplicaban a ese turno
- [x] Filtro: solo tareas pendientes creadas antes del cierre y que apliquen a la panadería

**Decisiones cerradas:**
- D26: Una tarea, una cajera. Sin "asignar a varias" — si quieres a 3, se crean 3.
- D27: Las tareas no entran al banner global de Pendientes; tienen su propia pestaña con su contador.
- D28: La cajera puede des-chulear mientras el turno siga abierto. Después del cierre, queda fija.
- D29: Sin foto de evidencia por ahora. Si se necesita, se agrega después.

**Pendiente de configuración manual:**
- [ ] Actualizar reglas Firestore: cajera puede `update` en `tasks/{id}` solo si `request.auth.uid == resource.data.assignedToUid` y solo cambia status/completedAt/completedAtClient/completedInSessionId/completedNote. Admin lee/escribe todo.

**Archivos creados/modificados:**
- `src/tasks.js` (nuevo)
- `src/screens/Tasks.jsx` (nuevo)
- `src/App.jsx` (router)
- `src/screens/More.jsx` (entrada mobile)
- `src/components/Nav.jsx` (entrada sidebar)
- `src/screens/CashierApp.jsx` (card "Tus tareas")
- `src/screens/Registro.jsx` (sección en cierre antiguo)

---

### 🔒 Fase 10 — Reglas Firestore con roles
**Objetivo:** Endurecer seguridad. Lo dejamos último para no romper nada en desarrollo.

- [ ] Función `isAdmin()` lee `users/{uid}.role === 'admin' && status === 'approved'`
- [ ] Función `isCashier()` similar para cashier
- [ ] Reglas por colección:
  - `users`: admin lee todos, escribe todos. Cashier lee solo su propio doc.
  - `products`: admin lee/escribe. Cashier lee y crea (no edita ni borra).
  - `sales`: admin lee/escribe todo. Cashier crea, lee solo las suyas, no edita.
  - `debtors`: admin lee/escribe. Cashier solo lee y crea entradas tipo 'sale'.
  - `cashSessions`: admin lee. Cashier crea/cierra solo la suya.
  - `cashExpenses`: admin lee/escribe. Cashier crea solo en su sesión.
  - `movements` y demás: admin lee/escribe. Cashier no toca.
- [ ] Probar exhaustivamente antes de publicar
- [ ] Publicar reglas en Firebase Console
- [ ] Build + deploy

---

## 5 · Pendientes de configuración manual (te aviso cuando toque)

- [ ] **Fase 1:** Crear tu doc admin en Firestore (paso a paso te guío)
- [ ] **Fase 4:** Crear cuenta en imagebb.com + obtener API key
- [ ] **Fase 10:** Publicar reglas Firestore actualizadas

---

## 6 · Notas de implementación importantes

- **Hora de venta:** usar `serverTimestamp()` de Firestore, no `Date.now()` del cliente (los celulares pueden tener fecha mal).
- **`normalizedName` en debtors:** lowercase + sin tildes para matching (`Pedro Pérez` y `pedro perez` son la misma persona).
- **Foto NEQUI/DAVIPLATA:** comprimir antes de subir (max 1024px lado mayor, calidad 0.85). ImageBB acepta hasta 32MB pero igual conviene optimizar.
- **`sessionId` en sales y cashExpenses:** se setea con la sesión `open` actual al momento de crear; permite reconstruir el cuadre con precisión.
- **Reportes existentes:** ya consumen `movements`. Como gastos de caja aprobados se convierten en movements, los reportes mensuales **siguen funcionando sin tocarlos**.
- **Empleados auto-creados:** cuando admin aprueba cajera, se crea doc en `employees` (la colección existente que usa la pestaña Equipo) con `linkedUserId` apuntando al uid de Google. Si la cajera renuncia: admin desactiva en Usuarios → opcionalmente también la marca inactiva en Equipo.

---

## 7 · Glosario rápido

- **Admin:** `todypan777@gmail.com` (Jhonatan Miranda). Rol único por ahora.
- **Cajera:** rol cashier. Aprobada por admin. Vinculada a un empleado.
- **Turno = sesión de caja:** doc en `cashSessions`, abierto al iniciar turno y cerrado al terminar.
- **Handover:** entrega de caja al cerrar turno (a admin o a otra cajera).
- **Cuadre:** comparación entre lo que el sistema espera (apertura + ventas efectivo - gastos efectivo) vs lo que la cajera declara tener físicamente.
- **Pendiente:** cualquier item esperando acción del admin (usuario, gasto, edición de venta, costo de producto, disputa de apertura, falta de cierre).
- **Disputa de apertura (`openingDispute`):** la cajera receptora declara haber recibido un monto distinto al que la entregadora reportó. Admin decide quién tiene razón.
- **Discrepancia de cierre (`closingDiscrepancy`):** al cerrar turno, lo declarado físicamente difiere de lo esperado matemáticamente. Si es **shortage** (falta) requiere acción del admin; si es **surplus** (sobra) se suma al fondo automáticamente.
- **Fondo de sobras (`surplusFund`):** cuenta virtual del negocio donde se acumulan los excedentes de cierre. Sirve como reserva para cubrir faltantes futuros sin afectar a la cajera o como caja chica para gastos del negocio.
- **Descuento de nómina (`cashierDeductions`):** monto que se restará automáticamente del próximo pago de la cajera. Origen típico: falta de cierre que el admin decidió cobrar.

---

**Última actualización:** 2026-05-07 — **Fases 1-9 + 9.5 + 11 (Tareas) completas + D25-D29.** Próxima y última: Fase 10 (lockdown reglas Firestore). Decisiones D1-D29 cerradas (D3, D17 obsoletas por D25).

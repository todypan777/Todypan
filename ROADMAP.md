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
| **D3** | Apertura de caja: el cierre anterior se transfiere automáticamente si el handover fue cajera→cajera. Si fue cajera→admin, la siguiente cajera abre en $0. |
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
| **D17** | Apertura de caja: si la cajera receptora detecta que recibió **menos** de lo que la entregadora reportó, puede **disputar** declarando el monto real. Queda como `openingDispute.status = 'pending'` y se notifica al admin. La caja abre con el monto real declarado por la receptora. |
| **D18** | **Sobras al cierre** (declarado > esperado): el efectivo físico se entrega completo (modelo mezclado). El excedente se suma a un **fondo virtual `surplusFund`** del negocio que crece con cada cierre con sobra. Sirve como reserva contable para cubrir faltantes futuros u otros gastos. |
| **D19** | **Faltas al cierre** (declarado < esperado): se registra como `closingDiscrepancy.status = 'pending'`. **El admin decide caso por caso** desde Pendientes — sin umbral fijo: o lo asume como pérdida del negocio (se cubre con `surplusFund` si hay saldo), o se descuenta a la cajera. |
| **D20** | Si admin elige "descontar a la cajera", el monto se **integra automáticamente al sistema de nómina existente**: se resta del próximo pago en la pantalla Equipo / pago de nómina. La cajera puede agregar una **nota** explicativa al momento de cerrar el turno. |
| **D21** | **Control anti-fraude:** la cajera **NUNCA** ve el monto esperado en caja, el total acumulado, ni la diferencia (sobra/falta) al cerrar. Declara a ciegas el efectivo físico que tiene; el sistema calcula y reporta al admin. Aplica en TODAS las fases: en cierre, durante el turno y mientras hay ventas activas (Fase 3+). La única excepción es el monto del **handover de apertura** (que ella vio físicamente al recibir y debe poder confirmar/disputar). |

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

### 🔄 Fase 8 — Deudores (admin)
**Objetivo:** Admin gestiona pagos y abonos de deudas.

- [ ] Pestaña "Deudores" en sidebar
- [ ] Lista de deudores ordenados por monto adeudado
- [ ] Click → detalle con historial (ventas + abonos)
- [ ] Botón "Registrar abono / pago": monto, método (efectivo/nequi/daviplata), foto opcional
- [ ] Actualiza `totalOwed` y agrega entrada al `history`
- [ ] Si paga total → marcar deudor como "pagado"
- [ ] Total deudas en Dashboard del admin
- [ ] Build + deploy

---

### 📅 Fase 9 — Vista cajera de ventas (días anteriores)
**Objetivo:** Cajera consulta historial sin poder editar.

- [ ] Pantalla "Mis ventas" para cajera
- [ ] Default: ventas del día actual
- [ ] Selector de fecha → ventas anteriores
- [ ] Click en venta → ver detalle (read-only)
- [ ] Botón "Solicitar edición" → form con nota → cambia status a `edit_requested`
- [ ] Botón "Solicitar borrado" → form con razón → status `delete_requested`
- [ ] Build + deploy

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

**Última actualización:** 2026-05-04 — **Fases 1-7 completas y en producción.** Próxima: Fase 8 (Deudores admin). Decisiones D1-D21 cerradas.

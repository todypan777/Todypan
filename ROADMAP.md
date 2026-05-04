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
  branchId, cashierUid, cashierName
  openedAt, openingFloat
  closedAt?, declaredClosingCash?
  expectedCash?, difference?
  handover?: { type: 'admin' | 'cashier', toUid?, toName, amount }
  status: 'open' | 'closed'

cashExpenses/{id}
  sessionId, branchId, cashierUid, cashierName
  description, amount, photoUrl?
  createdAt
  status: 'pending' | 'approved' | 'rejected'
  reviewedBy?, reviewedAt?, reviewNote?
  movementId?              (id del movement creado al aprobar)
```

**Pestaña "Pendientes" del admin** = agregador en UI, no es una colección. Junta:
- `users` con `status === 'pending'`
- `sales` con `status` de tipo `_requested`
- `cashExpenses` con `status === 'pending'`
- `products` con `needsCostReview === true`

---

## 4 · Plan por fases

### 🔄 Fase 1 — Auth con cola de aprobación
**Objetivo:** Empleadas pueden registrarse, quedan pendientes, admin aprueba y se crea empleada.

- [ ] Migrar tu propio usuario admin a Firestore (manual, 1 vez)
  - [ ] Crear doc `users/{tu-uid}` con `role: 'admin'`, `status: 'approved'`, nombre, etc.
  - [ ] Verificar que entras igual antes de borrar el chequeo viejo
- [ ] Reemplazar gatekeeper hardcoded por chequeo de Firestore (`role === 'admin' && status === 'approved'`)
- [ ] Pantalla de registro pendiente para usuarios nuevos (digita nombre + apellido)
- [ ] Pantalla "Tu cuenta está pendiente de aprobación" para users con `status === 'pending'`
- [ ] Pantalla "Tu cuenta fue desactivada" para `status === 'inactive'`
- [ ] Pestaña **Usuarios** en Más (admin): lista pendientes + aprobados + inactivos
- [ ] Modal de aprobación: nombre editable, teléfono obligatorio, salario opcional
- [ ] Al aprobar → crear doc en `users` (status approved) + crear `employee` vinculado
- [ ] Botón "Desactivar usuario" (status → inactive, no se borra nada)
- [ ] Popup automático al admin si hay usuarios pendientes al entrar
- [ ] Build + deploy

**Riesgos:** si la migración del admin se hace mal, te quedas fuera. Hacemos paso a paso con verificación.

---

### 📦 Fase 2 — Apertura/cierre de turno
**Objetivo:** Cajera puede iniciar turno (escogiendo panadería) y cerrar con cuadre + handover. Sin ventas todavía.

- [ ] Pantalla "Iniciar turno" para cajera al entrar (selector de panadería + monto inicial)
- [ ] Lógica: si última sesión cerrada con handover a cajera = monto inicial pre-llenado
- [ ] Validación: solo una sesión `open` por branchId
- [ ] Header con info de turno activo (panadería, hora apertura)
- [ ] Botón "Cerrar turno" → modal de cuadre (declarado vs esperado, diferencia)
- [ ] Modal de handover: a quién entrega (admin o lista de cajeras), monto
- [ ] Crear doc en `cashSessions` con todo el detalle
- [ ] Build + deploy

---

### 🛒 Fase 3 — Flujo de venta básico (efectivo + deuda)
**Objetivo:** Cajera registra ventas con método EFECTIVO o DEUDA. NEQUI/DAVIPLATA viene en Fase 4.

- [ ] Pantalla "Nueva venta" (botón principal en home cajera)
- [ ] Buscador de productos con autocompletado
- [ ] Si producto no existe → modal "Crear producto: nombre + precio"
- [ ] Carrito con cantidad editable, subtotal, total
- [ ] Botón "Cobrar" → modal de método de pago
- [ ] EFECTIVO: campo opcional "recibido" → muestra vuelto
- [ ] DEUDA: input de nombre del deudor con autocompletado (existentes en `debtors`)
- [ ] Al guardar venta: actualiza `debtors` (crea o suma)
- [ ] Build + deploy

---

### 📸 Fase 4 — NEQUI/DAVIPLATA + ImageBB
**Objetivo:** Pagos digitales con foto obligatoria del comprobante.

- [ ] Configurar API key de ImageBB (paso manual del usuario, te guío)
- [ ] Helper `uploadToImageBB(blob)` con compresión previa
- [ ] Captura de cámara nativa (input + capture="environment")
- [ ] Vista previa de la foto antes de guardar
- [ ] Validación: no se puede guardar venta nequi/daviplata sin foto
- [ ] Estado de carga durante upload
- [ ] Manejo de error de red (reintentar)
- [ ] Build + deploy

**Pendiente manual:** crear cuenta en imagebb.com y obtener API key (te paso link e instrucciones cuando lleguemos aquí).

---

### 💸 Fase 5 — Gastos de caja
**Objetivo:** Cajera registra gastos de caja → quedan pendientes para admin.

- [ ] Botón "Gasto de caja" en home cajera
- [ ] Form: descripción, monto, foto opcional
- [ ] Crear doc en `cashExpenses` con `status: 'pending'`
- [ ] El monto afecta inmediatamente el "esperado en caja" del cuadre
- [ ] Vista cajera: lista de sus gastos del turno (pending/approved/rejected)
- [ ] Si rechazado: ve nota del admin
- [ ] Build + deploy

---

### 🔔 Fase 6 — Pestaña Pendientes (admin)
**Objetivo:** Admin tiene un solo lugar para revisar todo.

- [ ] Pestaña "Pendientes" en sidebar (con badge de contador)
- [ ] Banner en Dashboard "Tienes N cosas por revisar"
- [ ] Sub-listas: Usuarios · Gastos de caja · Solicitudes de venta · Productos sin costo
- [ ] Cada gasto: aprobar / rechazar con nota
- [ ] Al aprobar gasto → crear `movement` tipo gasto con `origen: "caja"` + linkear `movementId`
- [ ] Build + deploy

---

### 📊 Fase 7 — Vista admin de Ventas
**Objetivo:** Admin ve todas las ventas con filtros.

- [ ] Pestaña "Ventas" en sidebar
- [ ] Tabla con: fecha, hora, cajera, panadería, total, método, estado
- [ ] Filtros: rango de fechas, cajera, panadería, método de pago, estado
- [ ] Click en venta → modal con detalle (items, foto comprobante si aplica, notas)
- [ ] Bandeja de solicitudes (sales con `status === 'edit_requested'` o `'delete_requested'`)
- [ ] Botones: aprobar edición, rechazar, ver historial
- [ ] Build + deploy

---

### 💳 Fase 8 — Deudores (admin)
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
- **Pendiente:** cualquier item esperando acción del admin (usuario, gasto, edición de venta, costo de producto).

---

**Última actualización:** 2026-05-03 — antes de iniciar Fase 1

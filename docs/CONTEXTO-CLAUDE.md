# TodyPan — contexto para continuar en otra conversación

> Documento de traspaso. Pégalo (o pide que lo lea) al abrir un chat nuevo.
> Última actualización: 2026-09-03 · rama `master` · commit `62c551e`

---

## 1. La situación

TodyPan es una PWA de gestión para panaderías (React 19 + Vite + Firebase/Firestore,
desplegada en Vercel desde `master`).

- La construí para **Jhonatan**, que tenía **dos panaderías**.
- Jhonatan **vendió una panadería — con la app incluida** — a **Andrés**, un desconocido.
- Andrés pidió cambios. Se los cotizamos y **ya aceptó y pagó el 50%**:
  **$500.000 único + $30.000/mes** (actualizaciones gratis como plus de la suscripción).
- **La cotización ya no importa.** El trabajo ahora es arreglar y separar la app.

**La promesa comercial del trabajo:** los datos de Andrés no los puede ver Jhonatan,
ni al revés. Todo lo demás es secundario a eso.

### Quién es quién (CONFIRMADO 2026-09-03)

En producción las sedes se llaman **"Panadería A"** y **"Panadería B"** — no
"Iglesia"/"Esquina" como en `defaultData()` ni como en `T.branch` de `tokens.js`
(ambos están desactualizados; los nombres reales salen de `getData().branches`).

| Sede | id | Dueño |
|---|---|---|
| **Panadería A** | `1` | **Jhonatan** (el original; el histórico es suyo) |
| **Panadería B** | `2` | **Andrés** (arranca de cero, sin histórico) |

Esto valida `LEGACY_MOVEMENT_BRANCH = 1`: los movimientos viejos (`branch: 'both'`)
se atribuyen a la sede 1, o sea a Jhonatan, que es lo correcto. Verificado en
pantalla: los $573.500 de gastos de septiembre caen todos en A, y B queda en $0.

### Decisiones de arquitectura ya tomadas (no re-discutir)

- **Un solo repo, una sola base de datos Firebase.** La cuenta la manejo yo.
- Multi-tenant con **separación de datos por panadería** (`branchId`).
- Las actualizaciones deben servir a **los dos dueños** a la vez.
- Andrés arranca **de cero** (sin datos históricos); lo viejo se atribuye a Jhonatan.
- Sin IVA. Licencia de uso: **el código fuente se queda conmigo**.

### Cómo quiero que se trabaje

> "todo lo que veas que necesita mejorarse o se puede optimizar no lo vamos a saltar,
> me lo dices, para que quede algo de calidad. Necesitamos que sea muy estética,
> muy limpia, fácil de usar y no el caos de ahorita."

> "ir así como vamos, con cuidado, arreglando bugs viejos o apartados que se puedan optimizar."

Y muy importante: **no me des mucha información de golpe.** Explícame en español claro,
por partes, y dime concretamente qué tengo que hacer yo.

---

## 2. Qué ya está hecho y publicado en `master`

Los 7 ítems cotizados están entregados o muy avanzados:

| Ítem | Estado |
|---|---|
| Puesta en marcha | ✅ |
| Separación de datos por panadería | ✅ (queda una fuga, ver §4) |
| Costos por producto | ✅ `src/utils/cost.js` |
| Panel de balance | ✅ `src/screens/Reports.jsx` (ahora "Balance") |
| Exportación a Excel | ✅ `src/utils/export.js` (CSV con BOM y `;` para Excel es-CO) |
| Inventario | ✅ `src/inventory.js` + `src/screens/Inventario.jsx` |
| Limpieza | 🟡 parcial — falta el chequeo de optimización final |

### Archivos nuevos que son el corazón de la separación

- **`src/utils/branchScope.js`** — el núcleo. `userBranchIds`, `visibleBranches`,
  `visibleAccounts`, `movementBranch`, `movementMatchesBranch`, `parseBranchKey`,
  `accountBranch`, `accountsOfBranch`, `LEGACY_MOVEMENT_BRANCH = 1`.
- **`src/movements.js`** — colección `/movements` + `/accountBalances` con `increment()`.
- **`src/accounts.js`** — colección `/accounts`, una cuenta por documento con su `branchId`.
- **`src/inventory.js`** — `/inventoryMoves` (libro, nunca se edita) + `/inventoryStock` (saldos).
- **`src/utils/features.js`** — banderas por panadería (almuerzos, desayunos, cocina, meseras, menuWeb).
- **`src/components/BranchViewSwitcher.jsx`** — el selector "Ver como" + su banner naranja.
- **`firestore.rules`** — reescritas y **ya publicadas** en Firebase.
- **`firestore.indexes.json`** — los índices compuestos, versionados y desplegados (§3).
- **`eslint.config.js`** — `npm run lint` estaba roto (había script pero no config). Ahora 0 errores.
- **`.github/workflows/firestore-rules.yml`** — despliega reglas al hacer push. **Falla en rojo**
  porque falta el secret `FIREBASE_SERVICE_ACCOUNT` (ver §4).

### Modo "Ver como" (para probar)

`sinfiniity@gmail.com` (mi cuenta) es **administradora de todo**. En `src/App.jsx`,
dentro de `AppShell`, se construye un **`effectiveUserDoc`**:

```js
const effectiveUserDoc = (puedeVerComo && viewAsBranch != null)
  ? { ...userDoc, branchIds: [viewAsBranch] }
  : userDoc
```

Ese `effectiveUserDoc` se pasa a Dashboard, Movements, Registro, Reports, Inventario,
Deudores, Cuentas, Products, Transferencias, More y AddMovement. Así veo la app
**exactamente** como la ve Andrés o Jhonatan, sin código especial: si se ve bien en
"Ver como", se ve bien para el dueño real.

⚠️ **Es una VISTA, no un permiso.** Las reglas de Firestore siguen viendo mi correo raíz
y no me restringen nada. Sirve para comprobar que la separación *se ve* bien; que sea
*segura* lo demuestran las reglas, no esta pantalla.

⚠️ **Y "Ver como" NO prueba las consultas de `ApprovedAppLoader`.** Ese componente
(movimientos y cuentas) lee el `userDoc` **real**, no el efectivo. Con "Ver como" esas
consultas siguen trayendo las dos panaderías y el recorte lo hace la pantalla. La única
prueba de verdad es asignar `branchIds` a un usuario real.

---

## 3. Lo último que se hizo (commit `62c551e`, 2026-09-03)

Se probó la separación en la app real y **el arreglo anterior no había llegado a la
pantalla**: `App.jsx` tenía **dos copias** del componente `Movements`, y a la única
alcanzable le faltaba `userDoc`. La navegación real (`handleTabChange` fuerza
`setTab('more')`) siempre caía en la copia rota, y la buena era código muerto. Sin
`userDoc`, la pantalla concluía "sin restricción" y mezclaba las dos panaderías.

Ahora hay **una sola definición** para las dos rutas de navegación.

**Verificado contra producción — la separación cuadra al peso:**

| | Panadería A | Panadería B | Suma | Total real |
|---|---|---|---|---|
| Ingresos | 1.707.600 | 2.621.300 | **4.328.900** | 4.328.900 ✅ |
| Gastos | 573.500 | 0 | **573.500** | 573.500 ✅ |

Que cuadre exacto prueba que no se pierde ninguna venta por el camino.

### Fugas del mismo tipo que seguían abiertas

`watchAllSales` estaba documentado como "arreglado", pero **solo se había arreglado en
Movimientos**. Seguía vivo en tres pantallas. Con `branchIds` asignado, las reglas
rechazan la consulta entera y el `catch` emite una lista vacía: **la pantalla se queda
en blanco sin decir por qué**.

- **Transferencias** — `watchSalesByDate` sin acotar, y la pantalla ni recibía `userDoc`.
- **Inicio** (Dashboard) — pedía la colección **entera** de ventas para usar solo las de
  hoy. Era la peor: es la primera pantalla que abre cualquiera.
- **Productos** — sin acotar.

### Totales que enseñaban dos períodos a la vez

Los movimientos están en memoria y cambian de golpe al navegar; las ventas tardan lo que
tarde Firestore. En ese hueco se sumaban **los gastos del mes nuevo con los ingresos del
viejo**. En pantalla: agosto de una sede apareció en **−$11M** antes de asentarse en
**+$27M**.

Las ventas ahora se guardan **con la etiqueta del período al que pertenecen** y se
descartan si no corresponden (estado derivado, no un `setSales([])` dentro del efecto —
eso costaría un render en cascada y React lo marca). Mientras cargan, la cifra se atenúa
y aparece "· actualizando…". Afectaba a **Movimientos** y a **Balance**.

### Índices de Firestore — hechos

`firestore.indexes.json` versionado y desplegado. Ver §5 para las trampas del despliegue.

| Colección | Campos |
|---|---|
| `sales` | `branchId` ASC + `date` ASC |
| `movements` | `branch` ASC + `date` ASC (ojo: `branch`, no `branchId`) |
| `inventoryMoves` | `branchId` ASC + `createdAt` DESC |
| `kitchenOrders` | `status` ASC + `createdAt` ASC (ya existía, se preservó) |

### Otros arreglos del mismo commit

- `BranchChip` comparaba ids con `===`: un `"1"` contra un `1` numérico no coincide y el
  chip decía **"Ambas"** sobre una fila de una sola panadería.
- Los movimientos históricos se etiquetaban "Ambas" dentro de la vista de UNA sede,
  contradiciendo al total que ya los incluía.
- `changeMonth` usaba `toISOString()` (la trampa de zona horaria del §5). Sustituido por
  aritmética pura, probada en los bordes de año.
- `EditSaleModal` llamaba `Date.now()` en cada render → inicializador perezoso.
  (Y de paso: **`Ventas.jsx` NO está huérfano** — `Movements` y `Deudores` le importan
  `SaleDetailModal`, y de ahí cuelga `EditSaleModal`.)
- Código muerto: `monthBtnStyle`, `isPrevMonth`, `groupLabel`, `onNav`.
- `.gitignore`: basura del CLI de Firebase (`firebase-debug.log`, `.firebase/`).

`npm run lint` 0 errores (87 → 82 warnings; Movimientos y Balance quedan en **0**),
`npm run build` limpio, y **probado en la app contra los datos reales**.

---

## 4. Pendientes (en orden)

1. 🔴 **Asignar `branchIds` a los DOS dueños — sin esto la promesa no se cumple.**
   El plan viejo solo contemplaba a Andrés. Pero un usuario **sin** `branchIds` no tiene
   restricción y **ve todo** (es el default deliberado de `branchScope.js`, para que
   publicar no le cambiara nada a Jhonatan mientras trabajaba). O sea:
   - Andrés con `branchIds: [2]` → no ve lo de Jhonatan ✅
   - Jhonatan **sin** `branchIds` → **ve todo lo de Andrés, en todas las pantallas** ❌

   Hay que ponerle **`branchIds: [1]` a Jhonatan** y `[2]` a Andrés
   (`andresguz2084@gmail.com`). La transición fue buena idea, pero tiene que cerrarse
   antes de entregar. **Coordinar cuándo: afecta a gente trabajando.**
2. **Apagar `almuerzos` y `desayunos` en Panadería A** (la de Jhonatan; Andrés se las
   queda). Es acción en la app: Panaderías → Editar → interruptores.
3. **Migrar las 3 cuentas históricas** (Nequi, Daviplata, Efectivo) fuera de
   `/todypan/data`. Hoy Andrés está protegido, pero **los ajustes manuales de Jhonatan
   siguen legibles en el documento compartido**. Requiere que los dos dueños estén fuera
   de la app.
4. **Poner el secret `FIREBASE_SERVICE_ACCOUNT`** en GitHub para que el workflow de
   reglas deje de fallar en rojo (hoy es inofensivo, pero molesta).
5. `scheduledShifts`: la **lectura** no está acotada por panadería (la escritura sí).
6. Los **costos siguen siendo globales por producto**, no por panadería.
7. `Products.jsx` sigue leyendo **todas** las ventas históricas (ya acotadas por sede)
   solo para adivinar quién puso cada precio. Funciona, pero es caro en lecturas;
   rediseñarlo cambia comportamiento, así que se dejó anotado.
8. Quedan **2 warnings de `Date.now()` en render** en pantallas de cajera y cocina. No se
   tocaron: son flujos que no se han revisado y están en uso constante.
9. Opcional: revivir el buscador de ventas de `src/screens/Ventas.jsx` (hoy solo se usan
   sus modales).
10. **Chequeo de optimización general** al final (lo pedí explícitamente).

---

## 5. Trampas de este código (leer antes de tocar nada)

Cada una de estas ya causó un bug real en este proyecto:

- **Un componente puede estar escrito DOS veces en `App.jsx`.** Pasó con `Movements`: a
  una copia le faltaba `userDoc` y era justo la alcanzable. Antes de dar por bueno un
  arreglo, **comprobar que la pantalla que se navega es la que se tocó**. El `userDoc` se
  pasa a mano en más de diez sitios; ese es el fallo de raíz y volverá a morder.
- **Mezclar datos en memoria con datos asíncronos enseña cifras falsas.** Los movimientos
  cambian de golpe y las ventas tardan. Todo total que combine ambos tiene que saber **a
  qué período pertenece lo que tiene cargado** y descartarlo si no corresponde.
- **Las reglas de Firestore son una UNIÓN permisiva.** Si *cualquier* regla permite, se
  permite. Un `match /{document=**}` con `isAdmin()` **anula en silencio** toda la
  separación. Por eso el catch-all quedó restringido a `isAdminBootstrap()`.
- **Las reglas aplican por documento COMPLETO.** Un documento compartido como
  `/todypan/data` **no se puede separar por partes**. De ahí las colecciones nuevas.
- **Firestore rechaza la consulta ENTERA** (`permission-denied`) si *pudiera* devolver
  documentos ilegibles. El cliente **debe** repetir el mismo `where` que la regla. Y ojo
  con los `catch` que hacen `callback([])`: convierten un error de permisos en una
  pantalla vacía y silenciosa. Es el fallo más difícil de ver, porque no parece un fallo.
- **Firestore compara por tipo.** `where('branchId','in',["2"])` **nunca** coincide con
  `branchId: 2` numérico, y devuelve **cero resultados sin ningún error**. Para eso existe
  `parseBranchKey()`: los efectos de React necesitan una dependencia estable (texto con
  `join(',')`), pero ese texto no sirve para consultar. **Comparar ids siempre con
  `String(a) === String(b)`.**
- **Leer un campo ausente** con `resource.data.x` **lanza** en las reglas → la regla
  deniega. Hay que usar `.get(campo, valorPorDefecto)`.
- **Zona horaria.** Bogotá es UTC−5: `toISOString()` estampa el día siguiente después de
  las 7 p.m. Siempre `toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })`.
  Esto ya corrompió fechas de gastos reales. Para meses, hacer aritmética con números y
  no pasar por `Date`.
- **`db.js` mezcla dos fuentes** (lo viejo dentro de `/todypan/data`, lo nuevo en
  colecciones). **Todo guardado tiene que pasar por `storableData()`**, que devuelve solo
  la parte legacy. Si se serializa `_data` en crudo, al arrancar en frío la caché se
  re-adopta como legacy y **cada movimiento se cuenta dos veces**.
- **`accounts.js` importa `todayStr` de `utils/format`, NO de `db.js`** — `db.js` importa
  `accounts.js` y se formaría un ciclo.
- **Compilar no es suficiente.** Vite compila componentes con variables de otro scope y
  la pantalla revienta en runtime. **Correr siempre `npm run lint` además de `npm run
  build`.** Ya cazó cuatro bugs que habían pasado el build, más un `import` olvidado y un
  `setState` dentro de un efecto que provocaba renders en cascada.

### Trampas del CLI de Firebase

- **`firebase firestore:indexes` NO muestra si el índice está listo.** Devuelve los
  `CREATING` igual que los `READY`. Para ver el estado real:
  `firebase firestore:indexes --project todypan-47059 --account todypan777@gmail.com --debug`
  y buscar `"state"` en el JSON de la respuesta.
- **Desplegar índices puede BORRAR los que no estén en el archivo.** Antes de
  `firebase deploy --only firestore:indexes`, listar los existentes e incorporarlos.
  Así se salvó el de `kitchenOrders`, que usa el historial de cocina del día.
  Nunca usar `--force`.
- **`firestore.indexes.json` no admite comentarios.** Ni claves `"//"`: el CLI valida
  contra un esquema estricto. La documentación va aquí, no en el JSON.

---

## 6. Cuentas y accesos

| Para qué | Cuenta |
|---|---|
| **Proyecto Firebase / GCP** (`todypan-47059`) | **`todypan777@gmail.com`** |
| Admin **dentro de la app** (`isRootEmail`, modo "Ver como") | `sinfiniity@gmail.com` |
| Dueño de Panadería B | `andresguz2084@gmail.com` |

⚠️ **No son la misma.** `sinfiniity@gmail.com` es admin de la app pero **no tiene acceso
al proyecto en Firebase**: da `403 The caller does not have permission`. Para desplegar
reglas o índices hay que pasar `--account todypan777@gmail.com` explícitamente (el CLI
tiene varias cuentas a la vez; mejor eso que cambiar la activa con `login:use`).

**Git:** la identidad está configurada **solo en este repo** (`Todypan
<todypan777@gmail.com>`); la global está vacía a propósito, para no pisar los otros
proyectos de la máquina. El remoto es **HTTPS**, así que en Fedora un push fallaría:
hay que montar SSH con alias por cuenta antes de subir.

---

## 7. Seguridad — pendiente MÍO, no del código

🔴 **Subí a un chat el JSON de una cuenta de servicio de Firebase.**
Clave: `github-rules@todypan-47059.iam.gserviceaccount.com`, proyecto `todypan-47059`.

**Sigue sin revocar.** Hay que borrarla/rotarla en Google Cloud Console → IAM →
Cuentas de servicio → `github-rules` → Claves. Borrar el archivo local o el chat
**NO la revoca**.

También creé sin querer un proyecto GCP suelto llamado **`github-rules`** que hay que cerrar.

---

## 8. Comandos

```bash
npm run lint     # 0 errores obligatorio (los warnings son heredados)
npm run build    # Vite + PWA
npm run dev      # http://localhost:5173 — apunta a la base de datos REAL

# Firebase (ojo con la cuenta)
firebase deploy --only firestore:rules   --project todypan-47059 --account todypan777@gmail.com
firebase deploy --only firestore:indexes --project todypan-47059 --account todypan777@gmail.com

git push origin master   # Vercel despliega desde master — va EN VIVO a los dos dueños
```

⚠️ `npm run dev` **usa la base de datos de producción**. No hay entorno de pruebas: lo que
se borra en local se borra de verdad, en la panadería de un cliente.

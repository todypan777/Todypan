# TodyPan — contexto para continuar en otra conversación

> Documento de traspaso. Pégalo (o pide que lo lea) al abrir un chat nuevo.
> Última actualización: 2026-09-03 · rama `master` · commit `6bfad64`

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
Deudores, Cuentas, More y AddMovement. Así veo la app **exactamente** como la ve Andrés
o Jhonatan, sin código especial: si se ve bien en "Ver como", se ve bien para el dueño real.

⚠️ **Es una VISTA, no un permiso.** Las reglas de Firestore siguen viendo mi correo raíz
y no me restringen nada. Sirve para comprobar que la separación *se ve* bien; que sea
*segura* lo demuestran las reglas, no esta pantalla.

---

## 3. Lo último que se hizo (commit `6bfad64`)

Reporté que "Ver como" no cambiaba nada en **Movimientos**: el balance del mes sumaba
las dos panaderías y salían filas de Panadería A dentro de la vista de B. Se arregló:

1. `Movements.jsx` **fuerza el filtro** a la única sede visible (mismo patrón
   `sedeUnica` / `filtroReal` que ya usaba `Dashboard.jsx`), en la lista, en los totales
   y en el selector (que queda bloqueado).
2. Los movimientos históricos con `branch: 'both'` ya no aparecen en las dos panaderías;
   se atribuyen a la sede antigua vía `movementMatchesBranch`.
3. **Bug grave encontrado ahí:** Movimientos leía la colección **entera** de ventas
   (`watchAllSales`) en cada apertura. Agotaba la cuota de Firestore, y a un usuario
   con `branchIds` asignado **las reglas le rechazan esa consulta completa** → se
   quedaría sin ventas y sin ningún error visible. Ahora usa
   `watchSalesBetween(mes, mes, cb, branchIds)`.
4. `watchSalesBetween` reintenta filtrando en el cliente si falta el índice compuesto,
   para no mostrar la pantalla vacía mientras el índice se construye.

### Lo primero que hay que hacer al retomar

**Probar en la app real:** entrar, *Ver como → Panadería A*, mirar Movimientos y anotar
el balance del mes; luego *Panadería B*. Los dos números tienen que ser **distintos** y
sumar aproximadamente el total que se veía antes. Si siguen iguales, el arreglo no bastó.

---

## 4. Pendientes (en orden)

1. **Índices compuestos en Firestore** — obligatorios. Sin ellos Andrés no verá nada:
   - `sales`: `branchId` + `date`
   - `movements`: `branch` + `date`
   - `inventoryMoves`: `branchId` + `createdAt` (desc)
   Firebase escupe en la consola del navegador un enlace "create index"; se abre y se crea.
2. **Apagar `almuerzos` y `desayunos` en la panadería de Jhonatan** (Andrés se las queda).
   Es acción en la app: Panaderías → Editar → interruptores.
   ⚠️ **Verificar antes cuál sede es de quién.** En producción las panaderías se llaman
   **"Panadería A"** y **"Panadería B"**, no "Iglesia"/"Esquina" como en `defaultData()`.
   Andrés tiene "Panadería Esquina"; falta confirmar a cuál letra corresponde.
3. **Asignar `branchIds: [2]` al usuario de Andrés** (`andresguz2084@gmail.com`) cuando
   entre por primera vez, y solo después de confirmar que los dos dueños siguen trabajando.
4. **Migrar las 3 cuentas históricas** (Nequi, Daviplata, Efectivo) fuera de `/todypan/data`.
   Hoy Andrés está protegido, pero **los ajustes manuales de Jhonatan siguen legibles en
   el documento compartido**: la fuga es en una sola dirección. Requiere que los dos
   dueños estén fuera de la app.
5. **Poner el secret `FIREBASE_SERVICE_ACCOUNT`** en GitHub para que el workflow de reglas
   deje de fallar en rojo (hoy es inofensivo, pero molesta).
6. `scheduledShifts`: la **lectura** no está acotada por panadería (la escritura sí).
7. Los **costos siguen siendo globales por producto**, no por panadería.
8. Opcional: revivir `src/screens/Ventas.jsx` (buscador de ventas, hoy huérfano) —
   arreglando primero su `watchAllSales`.
9. **Chequeo de optimización general** al final (lo pedí explícitamente).

---

## 5. Trampas de este código (leer antes de tocar nada)

Cada una de estas ya causó un bug real en este proyecto:

- **Las reglas de Firestore son una UNIÓN permisiva.** Si *cualquier* regla permite,
  se permite. Un `match /{document=**}` con `isAdmin()` **anula en silencio** toda la
  separación por panadería. Por eso el catch-all quedó restringido a `isAdminBootstrap()`.
- **Las reglas aplican por documento COMPLETO.** Un documento compartido como
  `/todypan/data` **no se puede separar por partes**. De ahí las colecciones nuevas.
- **Firestore rechaza la consulta ENTERA** (`permission-denied`) si *pudiera* devolver
  documentos ilegibles. El cliente **debe** repetir el mismo `where` que la regla.
- **Firestore compara por tipo.** `where('branchId','in',["2"])` **nunca** coincide con
  `branchId: 2` numérico, y devuelve **cero resultados sin ningún error**. Para eso existe
  `parseBranchKey()`: los efectos de React necesitan una dependencia estable (texto con
  `join(',')`), pero ese texto no sirve para consultar.
- **Leer un campo ausente** con `resource.data.x` **lanza** en las reglas → la regla
  deniega. Hay que usar `.get(campo, valorPorDefecto)`.
- **Zona horaria.** Bogotá es UTC−5: `toISOString()` estampa el día siguiente después de
  las 7 p.m. Siempre `toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })`.
  Esto ya corrompió fechas de gastos reales.
- **`db.js` mezcla dos fuentes** (lo viejo dentro de `/todypan/data`, lo nuevo en
  colecciones). **Todo guardado tiene que pasar por `storableData()`**, que devuelve solo
  la parte legacy. Si se serializa `_data` en crudo, al arrancar en frío la caché se
  re-adopta como legacy y **cada movimiento se cuenta dos veces**.
- **`accounts.js` importa `todayStr` de `utils/format`, NO de `db.js`** — `db.js` importa
  `accounts.js` y se formaría un ciclo.
- **Compilar no es suficiente.** Vite compila componentes con variables de otro scope y
  la pantalla revienta en runtime. **Correr siempre `npm run lint` además de `npm run build`.**
  Así se cacharon tres bugs que ya habían pasado el build.

---

## 6. Seguridad — pendiente MÍO, no del código

🔴 **Subí a un chat el JSON de una cuenta de servicio de Firebase.**
Clave: `github-rules@todypan-47059.iam.gserviceaccount.com`, proyecto `todypan-47059`.

**Tengo que borrarla/rotarla en Google Cloud Console** → IAM → Cuentas de servicio →
`github-rules` → Claves. Borrar el archivo local o el chat **NO la revoca**.

También creé sin querer un proyecto GCP suelto llamado **`github-rules`** que hay que cerrar.

---

## 7. Comandos

```bash
npm run lint     # 0 errores obligatorio (los warnings son heredados)
npm run build    # Vite + PWA
git push -u origin master   # Vercel despliega desde master
```

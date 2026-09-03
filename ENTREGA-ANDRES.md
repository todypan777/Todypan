# Entrega — Panadería Esquina (Andrés)

Guía de activación. **Los pasos van en orden.** El dueño anterior está
trabajando en la app todos los días, así que cada paso está pensado para no
interrumpirle la operación.

---

## Antes de empezar: dos avisos

### 1. Riesgo de pérdida de datos con dos administradores (YA EXISTE)

`persist()` en `src/db.js` guarda el documento `/todypan/data` **completo** con
`setDoc`, sin `merge`. Con dos administradores trabajando al tiempo:

> El dueño anterior registra un gasto → se guarda el documento entero.
> Andrés registra otro antes de que le llegue ese cambio → guarda el documento
> entero desde su copia, que no tiene el gasto del otro → **ese gasto se pierde.**

Es más probable a la hora del cierre, que es cuando ambos registran movimientos.
**No lo introdujo este cambio: ya está así.** Se arregla sacando `movements` y
`accounts` a colecciones propias (etapa siguiente), que de paso resuelve el
aislamiento y el límite de 1 MB del documento.

**Mientras tanto:** que no registren movimientos al mismo tiempo.

### 2. Qué NO cubre esta etapa

Andrés queda aislado en **ventas, turnos de caja e inventario**. Todavía puede
ver, por el documento compartido `/todypan/data`:

- Los movimientos (gastos e ingresos) del otro local
- Los saldos de Nequi, Daviplata y Efectivo
- Los costos de productos
- Empleados y asistencia

Además `debtors` (fiados) no tiene `branchId`, y los turnos programados
(`scheduledShifts`) están aislados en escritura pero no en lectura.

**Esto hay que decírselo a Andrés.** No está terminada la separación.

---

## Pasos de activación

### 1. Publicar las reglas de Firestore

Desplegar `firestore.rules`. **Cambio importante:** el comodín final pasó de
`isAdmin()` a `isAdminBootstrap()`.

Era obligatorio: en Firestore, si varias reglas coinciden con una ruta, el
acceso se concede cuando **cualquiera** lo permite. Con `isAdmin()`, ese comodín
le devolvía a Andrés el acceso a las ventas del otro local y anulaba por
completo el alcance por panadería.

Todas las colecciones que usa la app tienen ahora regla propia, así que nada se
queda sin permisos.

### 2. Crear el índice compuesto de ventas

Colección `sales`, campos `branchId` (ascendente) + `date` (ascendente).

Sin él, el panel de Balance le falla a un usuario con panadería asignada.
Firestore devuelve el enlace directo para crearlo en el mensaje de error de la
consola del navegador — es más rápido abrir Balance con la cuenta de Andrés y
seguir el enlace.

### 3. Que Andrés entre por primera vez

Con `andresguz2084@gmail.com`, botón "Continuar con Google". Queda como usuario
`pending`.

### 4. Aprobarlo como administrador

Desde tu cuenta raíz, en Usuarios: aprobarlo y ponerle `role: 'admin'`.

### 5. Asignarle su panadería

En el documento `users/{uid}` de Andrés:

```
branchIds: [2]        // 2 = Panadería Esquina
```

Se puede hacer desde la consola de Firebase o con `setUserBranches(uid, [2])`
de `src/users.js`.

> **Un usuario sin `branchIds` NO queda restringido.** Es a propósito: por eso
> el dueño anterior y su equipo siguen viendo lo mismo de siempre y nada se les
> rompe al publicar. La restricción se activa persona por persona.

### 6. Verificar con la cuenta de Andrés

- [ ] Balance muestra solo Panadería Esquina
- [ ] No aparece el selector de la otra panadería
- [ ] Las descargas a Excel traen solo lo suyo
- [ ] Inventario muestra solo su sede
- [ ] Registrar un movimiento pide panadería (o la elige sola si tiene una)

### 7. Verificar que al dueño anterior no se le rompió nada

Con su cuenta: que entre, abra Balance, registre un movimiento y cierre un
turno. **Debe funcionar exactamente igual que antes.** Si algo falla, revisar
que su usuario NO tenga `branchIds`.

### 8. (Opcional, después de probar) Restringir también al dueño anterior

`branchIds: [1]` en su usuario. Solo cuando el paso 7 esté confirmado.

---

## Etapa siguiente (para cerrar el ítem 2)

1. Sacar `movements` y `accounts` de `/todypan/data` a colecciones por
   panadería — **arregla el aislamiento, la pérdida de datos y el límite de 1 MB
   de una sola vez.**
2. Poner `branchId` a `debtors`.
3. Aislar la lectura de `scheduledShifts` (ajustando `watchShiftsForDate`).
4. Costos de producto por panadería: hoy el costo es global, y cada dueño le
   compra distinto al proveedor.

---

## Notas sobre los datos

- **Movimientos históricos:** se guardaron todos como `branch: 'both'` porque
  `AddMovement` no tenía selector. Se leen como de **Panadería Iglesia**
  (`LEGACY_MOVEMENT_BRANCH` en `src/utils/branchScope.js`). No se reescribió
  ningún documento: tocar el documento compartido con gente trabajando en él
  hace perder datos.
- **Costos:** los productos sin costo cargado cuentan como ganancia total. El
  panel avisa cuántas ventas están así. Andrés tiene que cargar los costos en
  **Productos** para que la ganancia sea real.
- **Inventario:** el descuento por venta es manual, como se acordó. Se registra
  lo que entra y lo que sale.

// ─────────────────────────────────────────────────────────────────────────────
// PEDIDOS A PROVEEDOR — pantalla de la cajera
//
// Dos momentos, y el diseño de los dos sale de lo mismo: el vendedor está
// parado al frente esperando. Cada pantalla extra o cada búsqueda entre
// cientos de productos es un segundo que hace que prefieran el cuaderno.
//
//   1. TOMAR EL PEDIDO — proveedor, el total que dijo el vendedor, cuándo
//      llega, y qué se pidió. La lista de productos del proveedor se arma
//      sola con lo que ya se le pidió antes (`productosDeProveedor`), así que
//      a partir de la segunda vez solo hay que poner cantidades.
//
//   2. RECIBIR — sale lo que se había pedido con las cantidades ya puestas.
//      Casi siempre llega completo, así que lo normal es confirmar sin tocar
//      nada. Si llegó distinto, se corrige encima. El total de la factura se
//      escribe porque la factura ya viene con lo que llegó.
//
// No se calcula ningún total a partir de precios: los productos de esta
// panadería no tienen costo cargado y el precio lo pone el proveedor.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from 'react'
import { T } from '../tokens'
import { fmtCOP } from '../utils/format'
import { getData, getBogotaDateStr } from '../db'
import { watchCashierProducts, mergeProductCatalogs } from '../products'
import {
  createSupplierOrder, updateSupplierOrder, cancelSupplierOrder,
  receiveSupplierOrder, markOrderNotArrived,
  productosDeProveedor, proveedoresUsados, diasDeAtraso, comparar,
} from '../supplierOrders'

const HOY = () => getBogotaDateStr()

/** Suma AAAA-MM-DD + n días, sin liarse con zonas horarias. */
function masDias(fecha, n) {
  const d = new Date(fecha + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function fechaBonita(f) {
  if (!f) return ''
  const hoy = HOY()
  if (f === hoy) return 'hoy'
  if (f === masDias(hoy, 1)) return 'mañana'
  if (f === masDias(hoy, -1)) return 'ayer'
  const d = new Date(f + 'T12:00:00Z')
  return d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' })
}

// ── Piezas sueltas ───────────────────────────────────────────────────────────

function Header({ titulo, subtitulo, onBack }) {
  return (
    <div style={{
      padding: '14px 16px', background: '#fff',
      borderBottom: `1px solid ${T.neutral[100]}`,
      display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
    }}>
      <button onClick={onBack} aria-label="Volver" style={{
        width: 36, height: 36, borderRadius: 999, border: 'none',
        background: T.neutral[100], cursor: 'pointer', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M15 6 L9 12 L15 18" stroke={T.neutral[700]} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3 }}>{titulo}</div>
        {subtitulo && (
          <div style={{ fontSize: 11, color: T.neutral[500], whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {subtitulo}
          </div>
        )}
      </div>
    </div>
  )
}

function Campo({ label, children, ayuda }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: T.neutral[600], marginBottom: 6 }}>{label}</div>
      {children}
      {ayuda && <div style={{ fontSize: 11, color: T.neutral[500], marginTop: 5, lineHeight: 1.4 }}>{ayuda}</div>}
    </div>
  )
}

const inputStyle = {
  width: '100%', padding: '13px 14px', borderRadius: 12,
  border: `1.5px solid ${T.neutral[200]}`, background: '#fff',
  fontSize: 16, fontFamily: 'inherit', color: T.neutral[900],
  outline: 'none', boxSizing: 'border-box',
}

function BotonGrande({ children, onClick, disabled, color = T.copper[500] }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      width: '100%', padding: '17px', borderRadius: 16,
      background: disabled ? T.neutral[200] : color,
      color: '#fff', border: 'none', fontFamily: 'inherit',
      cursor: disabled ? 'default' : 'pointer',
      fontSize: 16, fontWeight: 800, letterSpacing: -0.2,
      boxShadow: disabled ? 'none' : '0 6px 18px rgba(184,122,86,0.35)',
    }}>{children}</button>
  )
}

/**
 * Filas de producto + cantidad. Se usa igual al pedir y al recibir; lo único
 * que cambia es el texto, para no mantener dos listas casi iguales.
 */
function FilasProductos({ filas, setFilas, catalogo, permitirAgregar = true }) {
  const [busca, setBusca] = useState('')

  const sugeridos = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (q.length < 2) return []
    const yaEstan = new Set(filas.map(f => f.productId))
    return catalogo
      .filter(p => !yaEstan.has(p.id) && (p.name || '').toLowerCase().includes(q))
      .slice(0, 6)
  }, [busca, catalogo, filas])

  function cambiarQty(productId, valor) {
    setFilas(prev => prev.map(f => f.productId === productId ? { ...f, qty: valor } : f))
  }
  function quitar(productId) {
    setFilas(prev => prev.filter(f => f.productId !== productId))
  }
  function agregar(p) {
    setFilas(prev => [...prev, { productId: p.id, productName: p.name, qty: '' }])
    setBusca('')
  }

  return (
    <div>
      {filas.length === 0 && (
        <div style={{
          padding: '18px 14px', textAlign: 'center', borderRadius: 12,
          background: T.neutral[50], color: T.neutral[500], fontSize: 13, marginBottom: 10,
        }}>
          Busca abajo lo que pidió y ponle la cantidad.
        </div>
      )}

      {filas.map(f => (
        <div key={f.productId} style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
        }}>
          <div style={{ flex: 1, minWidth: 0, fontSize: 14, color: T.neutral[800], fontWeight: 600 }}>
            {f.productName}
          </div>
          <input
            type="number" inputMode="numeric" min="0"
            value={f.qty}
            onChange={e => cambiarQty(f.productId, e.target.value)}
            placeholder="0"
            style={{ ...inputStyle, width: 82, flexShrink: 0, textAlign: 'center', padding: '11px 8px' }}
          />
          <button onClick={() => quitar(f.productId)} aria-label="Quitar" style={{
            width: 34, height: 34, borderRadius: 999, flexShrink: 0,
            border: `1.5px solid ${T.neutral[200]}`, background: '#fff', cursor: 'pointer',
            color: T.neutral[500], fontSize: 18, lineHeight: 1,
          }}>×</button>
        </div>
      ))}

      {permitirAgregar && (
        <div style={{ marginTop: 10 }}>
          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar producto para agregar..."
            style={inputStyle}
          />
          {sugeridos.length > 0 && (
            <div style={{
              marginTop: 6, background: '#fff', borderRadius: 12,
              border: `1px solid ${T.neutral[100]}`, overflow: 'hidden',
            }}>
              {sugeridos.map(p => (
                <button key={p.id} onClick={() => agregar(p)} style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '12px 14px', border: 'none', background: 'none',
                  cursor: 'pointer', fontFamily: 'inherit', fontSize: 14,
                  color: T.neutral[800], borderBottom: `1px solid ${T.neutral[50]}`,
                }}>{p.name}</button>
              ))}
            </div>
          )}
          {busca.trim().length >= 2 && sugeridos.length === 0 && (
            <div style={{ fontSize: 12, color: T.neutral[500], marginTop: 6 }}>
              No aparece nada con ese nombre. Si el producto no existe todavía, la cajera
              lo crea al venderlo y después ya se puede pedir.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Tomar el pedido ──────────────────────────────────────────────────────────

/**
 * Sirve para tomar un pedido nuevo y para CORREGIR uno que aún no ha llegado.
 * Es el mismo formulario a propósito: la cajera ya sabe usarlo, y dos
 * pantallas casi iguales se desincronizan a la primera de cambio.
 */
function FormularioPedido({ session, catalogo, actor, pedido = null, onListo, onCancel }) {
  const editando = !!pedido
  const [proveedor, setProveedor] = useState(pedido?.supplierName || '')
  const [total, setTotal] = useState(editando ? String(pedido.expectedTotal || '') : '')
  const [fecha, setFecha] = useState(pedido?.expectedDate || masDias(HOY(), 1))
  const [filas, setFilas] = useState(
    (pedido?.items || []).map(i => ({ ...i, qty: String(i.qty) }))
  )
  const [conocidos, setConocidos] = useState([])
  const [cargandoLista, setCargandoLista] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  // Corrigiendo un pedido atrasado, la fecha que ya tiene es anterior a hoy;
  // si el mínimo fuera hoy, el calendario no dejaría ni conservarla.
  const fechaMinima = editando && pedido.expectedDate < HOY() ? pedido.expectedDate : HOY()

  useEffect(() => {
    let vivo = true
    proveedoresUsados(session.branchId)
      .then(l => { if (vivo) setConocidos(l) })
      .catch(() => {})
    return () => { vivo = false }
  }, [session.branchId])

  // Al elegir un proveedor conocido, se precarga lo que se le suele pedir.
  // Eso es lo que hace que a partir de la segunda vez solo haya que teclear
  // cantidades, sin buscar producto por producto con el vendedor esperando.
  async function usarProveedor(nombre) {
    setProveedor(nombre)
    // Corrigiendo un pedido ya guardado, tocar un proveedor sugerido solo
    // cambia el nombre. Si además recargara su lista habitual, borraría las
    // cantidades que la cajera acaba de escribir.
    if (editando) return
    setCargandoLista(true)
    try {
      const previos = await productosDeProveedor(session.branchId, nombre)
      setFilas(previos.map(p => ({ productId: p.productId, productName: p.productName, qty: '' })))
    } catch { /* sin lista previa: se busca a mano */ }
    setCargandoLista(false)
  }

  const conCantidad = filas.filter(f => (Number(f.qty) || 0) > 0)
  const puedeGuardar = proveedor.trim().length >= 2
    && (Number(total) || 0) > 0
    && !!fecha
    && conCantidad.length > 0
    && !guardando

  async function guardar() {
    if (!puedeGuardar) return
    setGuardando(true)
    setError(null)
    const items = conCantidad.map(f => ({
      productId: f.productId, productName: f.productName, qty: Number(f.qty) || 0,
    }))
    try {
      if (editando) {
        await updateSupplierOrder(pedido.id, {
          order: pedido,
          supplierName: proveedor,
          expectedTotal: Number(total) || 0,
          expectedDate: fecha,
          items,
          byUid: actor.uid,
          byName: actor.name,
        })
      } else {
        createSupplierOrder({
          branchId: session.branchId,
          supplierName: proveedor,
          expectedTotal: Number(total) || 0,
          expectedDate: fecha,
          items,
          sessionId: session.id,
          byUid: actor.uid,
          byName: actor.name,
        })
      }
      onListo()
    } catch (err) {
      setError(err?.message || 'No se pudo guardar el pedido.')
      setGuardando(false)
    }
  }

  async function anular() {
    if (!window.confirm(
      `¿Anular el pedido de ${pedido.supplierName}?\n\n`
      + 'Úsalo solo si el pedido quedó mal escrito. Si el proveedor sí lo tomó pero no lo trajo, '
      + 'mejor usa "Este pedido no llegó" al recibirlo.'
    )) return
    setGuardando(true)
    try {
      await cancelSupplierOrder(pedido.id, { byUid: actor.uid, byName: actor.name })
      onListo()
    } catch (err) {
      setError(err?.message || 'No se pudo anular el pedido.')
      setGuardando(false)
    }
  }

  const sugerencias = conocidos.filter(n =>
    proveedor.trim().length >= 1
    && n.toLowerCase().includes(proveedor.toLowerCase())
    && n.toLowerCase() !== proveedor.toLowerCase()
  ).slice(0, 5)

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 70, background: T.neutral[50], display: 'flex', flexDirection: 'column' }}>
      <Header
        titulo={editando ? 'Corregir el pedido' : 'Pedido a proveedor'}
        subtitulo={editando ? 'Cambia lo que esté mal y guarda' : 'Lo que acaba de pedir el vendedor'}
        onBack={onCancel}
      />
      <div style={{ flex: 1, overflowY: 'auto', padding: '18px 16px 120px', maxWidth: 540, margin: '0 auto', width: '100%' }}>

        <Campo label="¿Qué proveedor es?">
          <input
            value={proveedor}
            onChange={e => setProveedor(e.target.value)}
            placeholder="Ej. Postobón"
            autoFocus
            style={inputStyle}
          />
          {sugerencias.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {sugerencias.map(n => (
                <button key={n} onClick={() => usarProveedor(n)} style={{
                  padding: '7px 12px', borderRadius: 999, cursor: 'pointer',
                  border: `1.5px solid ${T.copper[300]}`,
                  background: '#fff', color: T.neutral[700],
                  fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
                }}>{n}</button>
              ))}
            </div>
          )}
        </Campo>

        <Campo
          label="¿Cuánto dijo que valía?"
          ayuda="El total que dio el vendedor. Sirve para saber cuánta plata dejar en caja el día que llegue."
        >
          <input
            type="number" inputMode="numeric" min="0"
            value={total}
            onChange={e => setTotal(e.target.value)}
            placeholder="0"
            style={inputStyle}
          />
        </Campo>

        <Campo label="¿Qué día llega?">
          <input type="date" value={fecha} min={fechaMinima} onChange={e => setFecha(e.target.value)} style={inputStyle} />
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            {[['Hoy', HOY()], ['Mañana', masDias(HOY(), 1)], ['Pasado', masDias(HOY(), 2)]].map(([t, f]) => (
              <button key={t} onClick={() => setFecha(f)} style={{
                padding: '7px 14px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit',
                border: `1.5px solid ${fecha === f ? T.copper[500] : T.neutral[200]}`,
                background: fecha === f ? T.copper[500] : '#fff',
                color: fecha === f ? '#fff' : T.neutral[700],
                fontSize: 13, fontWeight: 700,
              }}>{t}</button>
            ))}
          </div>
        </Campo>

        <Campo label="¿Qué le pidió?">
          {cargandoLista
            ? <div style={{ padding: 16, textAlign: 'center', color: T.neutral[500], fontSize: 13 }}>Buscando lo que le suele pedir...</div>
            : <FilasProductos filas={filas} setFilas={setFilas} catalogo={catalogo} />}
        </Campo>

        {error && (
          <div style={{ padding: 12, borderRadius: 12, background: '#FDF4F3', color: T.bad, fontSize: 13, marginBottom: 12 }}>
            {error}
          </div>
        )}

        {editando && (
          <button onClick={anular} disabled={guardando} style={{
            width: '100%', padding: '13px', borderRadius: 12, marginTop: 4,
            border: `1.5px solid ${T.neutral[200]}`, background: '#fff',
            color: T.bad, fontSize: 13, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>
            Anular este pedido (quedó mal escrito)
          </button>
        )}
      </div>

      <div style={{ padding: '12px 16px 22px', background: '#fff', borderTop: `1px solid ${T.neutral[100]}`, flexShrink: 0 }}>
        <div style={{ maxWidth: 540, margin: '0 auto' }}>
          <BotonGrande onClick={guardar} disabled={!puedeGuardar}>
            {guardando ? 'Guardando...' : (editando ? 'Guardar los cambios' : 'Guardar pedido')}
          </BotonGrande>
        </div>
      </div>
    </div>
  )
}

// ── Recibir el pedido ────────────────────────────────────────────────────────

function FormularioRecibir({ pedido, session, catalogo, actor, onListo, onCancel, onCorregir }) {
  // Arranca con lo que se pidió ya puesto: lo normal es que llegue completo,
  // así que el camino corto es confirmar sin tocar nada.
  const [filas, setFilas] = useState(
    (pedido.items || []).map(i => ({ ...i, qty: String(i.qty) }))
  )
  const [factura, setFactura] = useState(String(pedido.expectedTotal || ''))
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  const recibidas = filas
    .filter(f => (Number(f.qty) || 0) > 0)
    .map(f => ({ productId: f.productId, productName: f.productName, qty: Number(f.qty) || 0 }))
  const diferencias = comparar(pedido.items, recibidas)
  const difPlata = (Number(factura) || 0) - (Number(pedido.expectedTotal) || 0)

  async function confirmar() {
    if (guardando) return
    setGuardando(true)
    setError(null)
    try {
      await receiveSupplierOrder(pedido.id, {
        order: pedido,
        receivedItems: recibidas,
        invoiceTotal: Number(factura) || 0,
        sessionId: session.id,
        branchName: session.branchName,
        cashierUid: session.cashierUid,
        cashierName: session.cashierName,
        byUid: actor.uid,
        byName: actor.name,
      })
      onListo()
    } catch (err) {
      setError(err?.message || 'No se pudo registrar la llegada.')
      setGuardando(false)
    }
  }

  async function noLlego() {
    if (!window.confirm(`¿El pedido de ${pedido.supplierName} no llegó?\n\nSe cierra sin tocar el inventario ni la caja.`)) return
    setGuardando(true)
    try {
      await markOrderNotArrived(pedido.id, { byUid: actor.uid, byName: actor.name })
      onListo()
    } catch (err) {
      setError(err?.message || 'No se pudo cerrar el pedido.')
      setGuardando(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 70, background: T.neutral[50], display: 'flex', flexDirection: 'column' }}>
      <Header titulo={`Llegó ${pedido.supplierName}`} subtitulo={`Se pidió el ${fechaBonita(pedido.orderedDate)}`} onBack={onCancel} />
      <div style={{ flex: 1, overflowY: 'auto', padding: '18px 16px 120px', maxWidth: 540, margin: '0 auto', width: '100%' }}>

        <div style={{
          padding: '12px 14px', borderRadius: 12, background: '#fff',
          border: `1px solid ${T.neutral[100]}`, marginBottom: 16,
        }}>
          <div style={{ fontSize: 12, color: T.neutral[500] }}>El vendedor había dicho</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: T.neutral[900] }}>{fmtCOP(pedido.expectedTotal)}</div>
        </div>

        <Campo
          label="¿Llegó todo lo que se pidió?"
          ayuda="Ya están puestas las cantidades que se pidieron. Si llegó menos, corrige el número; si algo no llegó, déjalo en 0."
        >
          <FilasProductos filas={filas} setFilas={setFilas} catalogo={catalogo} />
        </Campo>

        {diferencias.length > 0 && (
          <div style={{
            padding: '12px 14px', borderRadius: 12, marginBottom: 14,
            background: '#FBF3E8', border: `1px solid ${T.warn}`,
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.warn, marginBottom: 6 }}>
              Llegó distinto a lo que se pidió
            </div>
            {diferencias.map(d => (
              <div key={d.productId} style={{ fontSize: 12, color: T.neutral[700], lineHeight: 1.6 }}>
                {d.productName}: se pidieron {d.pedido}, llegaron {d.llego}
              </div>
            ))}
            <div style={{ fontSize: 11, color: T.neutral[500], marginTop: 6 }}>
              No es un error. Queda anotado para que el dueño lo vea.
            </div>
          </div>
        )}

        <Campo
          label="¿Cuánto dice la factura?"
          ayuda="El valor de la factura que trajo, que ya viene con lo que realmente llegó. Va a salir como gasto de caja."
        >
          <input
            type="number" inputMode="numeric" min="0"
            value={factura}
            onChange={e => setFactura(e.target.value)}
            style={inputStyle}
          />
          {Math.abs(difPlata) > 0 && (
            <div style={{ fontSize: 12, marginTop: 6, color: difPlata > 0 ? T.bad : T.ok, fontWeight: 700 }}>
              {difPlata > 0
                ? `Son ${fmtCOP(difPlata)} más de lo que había dicho.`
                : `Son ${fmtCOP(-difPlata)} menos de lo que había dicho.`}
            </div>
          )}
        </Campo>

        {error && (
          <div style={{ padding: 12, borderRadius: 12, background: '#FDF4F3', color: T.bad, fontSize: 13, marginBottom: 12 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 4 }}>
          <button onClick={onCorregir} disabled={guardando} style={{
            padding: '13px 10px', borderRadius: 12,
            border: `1.5px solid ${T.neutral[200]}`, background: '#fff',
            color: T.neutral[700], fontSize: 13, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>
            Corregir el pedido
          </button>
          <button onClick={noLlego} disabled={guardando} style={{
            padding: '13px 10px', borderRadius: 12,
            border: `1.5px solid ${T.neutral[200]}`, background: '#fff',
            color: T.neutral[600], fontSize: 13, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>
            No llegó
          </button>
        </div>
      </div>

      <div style={{ padding: '12px 16px 22px', background: '#fff', borderTop: `1px solid ${T.neutral[100]}`, flexShrink: 0 }}>
        <div style={{ maxWidth: 540, margin: '0 auto' }}>
          <BotonGrande onClick={confirmar} disabled={guardando || recibidas.length === 0} color={T.ok}>
            {guardando ? 'Guardando...' : 'Confirmar que llegó'}
          </BotonGrande>
        </div>
      </div>
    </div>
  )
}

// ── Pantalla principal ───────────────────────────────────────────────────────

export default function PedidosProveedor({ session, authUser, userDoc, pendientes = [], onCancel }) {
  // null | 'nuevo' | { modo: 'recibir'|'corregir', id }
  const [vista, setVista] = useState(null)
  const [cashierProducts, setCashierProducts] = useState([])

  useEffect(() => watchCashierProducts(setCashierProducts), [])

  const catalogo = useMemo(
    () => mergeProductCatalogs(getData().products || [], cashierProducts).filter(p => !p.freeAmount),
    [cashierProducts]
  )

  const actor = {
    uid: authUser?.uid || null,
    name: `${userDoc?.nombre || ''} ${userDoc?.apellido || ''}`.trim() || authUser?.email || '',
  }

  const mios = pendientes.filter(p => String(p.branchId) === String(session.branchId))
  const paraHoy = mios.filter(p => p.expectedDate <= HOY())
  const despues = mios.filter(p => p.expectedDate > HOY())

  // El pedido se vuelve a buscar en la lista viva en vez de usar el que se
  // guardó al abrir: si alguien lo corrige desde otro dispositivo, la pantalla
  // no puede quedarse mostrando cantidades viejas.
  // Si desapareció —lo recibieron o lo anularon desde otro lado— las dos
  // ramas de abajo no entran y se cae sola a la lista. Sin tocar estado
  // durante el render.
  const abierto = vista?.id ? mios.find(p => p.id === vista.id) : null

  if (vista === 'nuevo') {
    return (
      <FormularioPedido
        session={session} catalogo={catalogo} actor={actor}
        onListo={() => setVista(null)} onCancel={() => setVista(null)}
      />
    )
  }
  if (vista?.modo === 'corregir' && abierto) {
    return (
      <FormularioPedido
        session={session} catalogo={catalogo} actor={actor} pedido={abierto}
        onListo={() => setVista(null)}
        onCancel={() => setVista({ modo: 'recibir', id: abierto.id })}
      />
    )
  }
  if (vista?.modo === 'recibir' && abierto) {
    return (
      <FormularioRecibir
        pedido={abierto} session={session} catalogo={catalogo} actor={actor}
        onListo={() => setVista(null)} onCancel={() => setVista(null)}
        onCorregir={() => setVista({ modo: 'corregir', id: abierto.id })}
      />
    )
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: T.neutral[50], display: 'flex', flexDirection: 'column' }}>
      <Header titulo="Pedidos a proveedor" subtitulo={session.branchName || ''} onBack={onCancel} />

      <div style={{ flex: 1, overflowY: 'auto', padding: '18px 16px 40px', maxWidth: 540, margin: '0 auto', width: '100%' }}>
        <BotonGrande onClick={() => setVista('nuevo')}>+ Llegó un vendedor a pedir</BotonGrande>

        <div style={{ height: 18 }} />

        {paraHoy.length > 0 && (
          <>
            <div style={{ fontSize: 12, fontWeight: 800, color: T.copper[600], letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 8 }}>
              Para recibir
            </div>
            {paraHoy.map(p => <TarjetaPedido key={p.id} pedido={p} onClick={() => setVista({ modo: 'recibir', id: p.id })} />)}
            <div style={{ height: 18 }} />
          </>
        )}

        {despues.length > 0 && (
          <>
            <div style={{ fontSize: 12, fontWeight: 800, color: T.neutral[500], letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 8 }}>
              Más adelante
            </div>
            {despues.map(p => <TarjetaPedido key={p.id} pedido={p} onClick={() => setVista({ modo: 'recibir', id: p.id })} />)}
          </>
        )}

        {mios.length === 0 && (
          <div style={{ padding: '40px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 42, marginBottom: 8 }}>📦</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.neutral[700] }}>No hay pedidos esperando</div>
            <div style={{ fontSize: 12, color: T.neutral[500], marginTop: 4, lineHeight: 1.5 }}>
              Cuando llegue un vendedor a tomar el pedido, tócale el botón de arriba.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function TarjetaPedido({ pedido, onClick }) {
  const atraso = diasDeAtraso(pedido)
  return (
    <button onClick={onClick} style={{
      display: 'block', width: '100%', textAlign: 'left', marginBottom: 8,
      padding: '14px', borderRadius: 14, background: '#fff', cursor: 'pointer',
      border: `1.5px solid ${atraso > 0 ? T.warn : T.neutral[100]}`, fontFamily: 'inherit',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: T.neutral[900], minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {pedido.supplierName}
        </div>
        <div style={{ fontSize: 15, fontWeight: 800, color: T.neutral[800], flexShrink: 0 }}>
          {fmtCOP(pedido.expectedTotal)}
        </div>
      </div>
      <div style={{ fontSize: 12, color: atraso > 0 ? T.warn : T.neutral[500], marginTop: 3, fontWeight: atraso > 0 ? 700 : 400 }}>
        {atraso > 0
          ? `Debía llegar ${fechaBonita(pedido.expectedDate)} — lleva ${atraso} ${atraso === 1 ? 'día' : 'días'}`
          : `Llega ${fechaBonita(pedido.expectedDate)}`}
        {' · '}{(pedido.items || []).length} {(pedido.items || []).length === 1 ? 'producto' : 'productos'}
      </div>
    </button>
  )
}

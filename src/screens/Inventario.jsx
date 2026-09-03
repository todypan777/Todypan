import { useState, useEffect, useMemo } from 'react'
import { T } from '../tokens'
import { fmtCOP } from '../utils/format'
import { Card, SectionHeader, Chip, Modal, InputField, PrimaryButton, EmptyState } from '../components/Atoms'
import { ScreenHeader } from '../components/Nav'
import { getData } from '../db'
import { visibleBranches } from '../utils/branchScope'
import { watchCashierProducts, mergeProductCatalogs } from '../products'
import {
  watchInventoryStock, watchInventoryMoves, addInventoryMove,
  MOVE_TYPES, moveDelta, stockValue,
} from '../inventory'

export default function Inventario({ authUser, userDoc, onBack }) {
  const branches = visibleBranches(userDoc, getData().branches || [])
  const [branchId, setBranchId] = useState(branches[0]?.id ?? null)
  const [stock, setStock] = useState([])
  const [moves, setMoves] = useState([])
  const [cashierProducts, setCashierProducts] = useState([])
  const [search, setSearch] = useState('')
  const [nuevo, setNuevo] = useState(null)   // producto elegido para registrar

  useEffect(() => watchCashierProducts(setCashierProducts), [])
  useEffect(() => watchInventoryStock(branchId, setStock), [branchId])
  useEffect(() => watchInventoryMoves(branchId, setMoves), [branchId])

  const adminProducts = getData().products || []
  const catalog = useMemo(
    () => mergeProductCatalogs(adminProducts, cashierProducts).filter(p => !p.freeAmount),
    [adminProducts, cashierProducts]
  )

  const costOf = useMemo(() => {
    const map = new Map(catalog.map(p => [p.id, p.unitCost || 0]))
    return (id) => map.get(id) || 0
  }, [catalog])

  // El saldo solo existe para productos que ya tuvieron algún movimiento; el
  // resto del catálogo se muestra en cero para poder registrarles la primera
  // entrada sin buscarlos en otra pantalla.
  const filas = useMemo(() => {
    const porProducto = new Map(stock.map(s => [s.productId, s]))
    const q = search.trim().toLowerCase()
    return catalog
      .map(p => {
        const s = porProducto.get(p.id)
        const qty = Number(s?.qty) || 0
        return { id: p.id, name: p.name, qty, valor: qty > 0 ? qty * costOf(p.id) : 0 }
      })
      .filter(r => !q || r.name.toLowerCase().includes(q))
      .sort((a, b) => (b.qty > 0) - (a.qty > 0) || a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
  }, [catalog, stock, search, costOf])

  const valorTotal = stockValue(stock, costOf)
  const conStock = stock.filter(s => Number(s.qty) > 0).length
  const enNegativo = stock.filter(s => Number(s.qty) < 0).length

  const actorName = `${userDoc?.nombre || ''} ${userDoc?.apellido || ''}`.trim() || authUser?.email || ''

  return (
    <div style={{ paddingBottom: 110 }}>
      <ScreenHeader title="Inventario" subtitle="Producto terminado"/>

      {branches.length > 1 && (
        <div style={{ padding: '0 20px 12px', display: 'flex', gap: 8, overflowX: 'auto' }}>
          {branches.map(b => (
            <Chip key={b.id} label={b.name} active={String(branchId) === String(b.id)} onClick={() => setBranchId(b.id)} />
          ))}
        </div>
      )}

      {/* Resumen */}
      <div style={{ padding: '0 16px' }}>
        <Card padding={18}>
          <div style={{ fontSize: 11, color: T.neutral[500], fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase' }}>
            Valor del inventario
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4, color: T.neutral[900], fontVariantNumeric: 'tabular-nums', letterSpacing: -0.8 }}>
            {fmtCOP(valorTotal)}
          </div>
          <div style={{ fontSize: 12.5, color: T.neutral[500], marginTop: 6 }}>
            {conStock} {conStock === 1 ? 'producto' : 'productos'} en existencia
            {enNegativo > 0 && (
              <span style={{ color: T.bad, fontWeight: 600 }}> · {enNegativo} en negativo</span>
            )}
          </div>
          {valorTotal === 0 && conStock > 0 && (
            <div style={{ fontSize: 12, color: T.copper[600], marginTop: 8, lineHeight: 1.4 }}>
              Hay existencias pero sin costo cargado, por eso el valor da cero.
              Carga el costo en <b>Productos</b>.
            </div>
          )}
        </Card>
      </div>

      {/* Buscador */}
      <div style={{ padding: '14px 16px 0' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar producto…"
          style={{
            width: '100%', padding: '12px 14px', borderRadius: 12,
            border: `1px solid ${T.neutral[200]}`, fontSize: 15,
            fontFamily: 'inherit', color: T.neutral[900], outline: 'none',
            background: '#fff',
          }}
        />
      </div>

      {/* Existencias */}
      <SectionHeader title="Existencias"/>
      <div style={{ padding: '0 16px' }}>
        {filas.length === 0 ? (
          <EmptyState
            icon="📦"
            title={search ? 'Sin resultados' : 'Aún no hay productos'}
            subtitle={search ? 'Prueba con otro nombre' : 'Crea productos para llevarles inventario'}
          />
        ) : (
          <Card padding={0}>
            {filas.map((r, i) => (
              <button
                key={r.id}
                onClick={() => setNuevo(r)}
                style={{
                  width: '100%', textAlign: 'left', background: 'none', cursor: 'pointer',
                  padding: '13px 16px', display: 'flex', alignItems: 'center', gap: 12,
                  border: 'none', fontFamily: 'inherit',
                  borderBottom: i < filas.length - 1 ? `0.5px solid ${T.neutral[100]}` : 'none',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: T.neutral[800] }}>{r.name}</div>
                  {r.valor > 0 && (
                    <div style={{ fontSize: 11.5, color: T.neutral[400], marginTop: 2 }}>{fmtCOP(r.valor)}</div>
                  )}
                </div>
                <div style={{
                  fontSize: 16, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                  color: r.qty < 0 ? T.bad : r.qty === 0 ? T.neutral[300] : T.neutral[900],
                }}>
                  {r.qty}
                </div>
              </button>
            ))}
          </Card>
        )}
      </div>

      {/* Últimos movimientos */}
      {moves.length > 0 && (
        <>
          <SectionHeader title="Últimos movimientos"/>
          <div style={{ padding: '0 16px' }}>
            <Card padding={0}>
              {moves.slice(0, 15).map((m, i, arr) => {
                const positivo = (Number(m.delta) || 0) > 0
                return (
                  <div key={m.id} style={{
                    padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12,
                    borderBottom: i < arr.length - 1 ? `0.5px solid ${T.neutral[100]}` : 'none',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: T.neutral[800] }}>{m.productName}</div>
                      <div style={{ fontSize: 11.5, color: T.neutral[400], marginTop: 2 }}>
                        {MOVE_TYPES[m.type]?.label || m.type} · {m.date}
                        {m.createdByName ? ` · ${m.createdByName}` : ''}
                        {m.note ? ` · ${m.note}` : ''}
                      </div>
                    </div>
                    <div style={{
                      fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                      color: positivo ? T.ok : T.bad,
                    }}>
                      {positivo ? '+' : ''}{m.delta}
                    </div>
                  </div>
                )
              })}
            </Card>
          </div>
        </>
      )}

      {nuevo && (
        <MoveModal
          producto={nuevo}
          onClose={() => setNuevo(null)}
          onSave={(datos) => {
            addInventoryMove({
              branchId,
              productId: nuevo.id,
              productName: nuevo.name,
              byUid: authUser?.uid,
              byName: actorName,
              ...datos,
            })
            setNuevo(null)
          }}
        />
      )}
    </div>
  )
}

function MoveModal({ producto, onClose, onSave }) {
  const [type, setType] = useState('entrada')
  const [qty, setQty] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [supplierName, setSupplierName] = useState('')
  const [note, setNote] = useState('')

  const n = Number(qty)
  // En 'ajuste' la cantidad lleva signo (puede ser negativa para corregir de
  // más); en entrada y salida el signo lo pone el tipo, así que solo se pide
  // un número positivo.
  const valido = type === 'ajuste' ? (qty !== '' && !Number.isNaN(n) && n !== 0) : n > 0
  // Se reusa moveDelta (la misma cuenta que graba el movimiento) para que la
  // vista previa no pueda decir una cosa y el saldo terminar en otra.
  const resultado = producto.qty + moveDelta(type, n || 0)

  const proveedores = getData().suppliers || []

  return (
    <Modal onClose={onClose} title={producto.name}>
      <div style={{ fontSize: 13, color: T.neutral[500], marginTop: -8, marginBottom: 16 }}>
        Existencia actual: <b style={{ color: T.neutral[800] }}>{producto.qty}</b>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {Object.entries(MOVE_TYPES).map(([key, meta]) => (
          <button
            key={key}
            onClick={() => setType(key)}
            style={{
              flex: 1, padding: '10px 8px', borderRadius: 10, cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
              border: type === key ? `1.5px solid ${T.copper[500]}` : `1px solid ${T.neutral[200]}`,
              background: type === key ? T.copper[50] : '#fff',
              color: type === key ? T.copper[700] : T.neutral[600],
            }}
          >
            {meta.label}
          </button>
        ))}
      </div>

      <div style={{ fontSize: 12, color: T.neutral[500], marginTop: -8, marginBottom: 14 }}>
        {MOVE_TYPES[type].desc}
        {type === 'ajuste' && ' — usa un número negativo para descontar.'}
      </div>

      <InputField
        label="Cantidad"
        value={qty}
        onChange={setQty}
        type="number"
        placeholder={type === 'ajuste' ? 'Ej: -3' : 'Ej: 20'}
      />

      {type === 'entrada' && (
        <>
          <InputField
            label="Precio de costo por unidad (opcional)"
            value={unitCost}
            onChange={setUnitCost}
            type="number"
            placeholder="Ej: 600"
          />
          <InputField
            label="Proveedor (opcional)"
            value={supplierName}
            onChange={setSupplierName}
            placeholder={proveedores[0]?.name ? `Ej: ${proveedores[0].name}` : 'Nombre del proveedor'}
          />
        </>
      )}

      <InputField
        label="Nota (opcional)"
        value={note}
        onChange={setNote}
        placeholder={type === 'salida' ? 'Ej: se dañaron' : 'Ej: factura 1024'}
      />

      {valido && (
        <div style={{
          padding: '10px 14px', borderRadius: 10, background: T.neutral[50],
          fontSize: 13, color: T.neutral[600], marginBottom: 16,
        }}>
          Queda en <b style={{ color: resultado < 0 ? T.bad : T.neutral[900] }}>{resultado}</b>
          {resultado < 0 && ' — vas a dejar el inventario en negativo.'}
        </div>
      )}

      <PrimaryButton
        label="Guardar"
        disabled={!valido}
        onClick={() => valido && onSave({ type, qty: n, unitCost, supplierName, note })}
      />
    </Modal>
  )
}

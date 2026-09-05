import { useState } from 'react'
import { T } from '../tokens'
import { Card } from './Atoms'
import { todayStr } from '../utils/format'
import { downloadHandoverReport, fechaLarga, horaColombiana } from '../utils/handoverReport'

// ─────────────────────────────────────────────────────────────────────────────
// REPORTE EN PDF DE UNA PANADERIA, DESDE UNA HORA EXACTA
//
// Existe por el traspaso: una sede cambio de dueño un lunes al mediodia y hay
// que poder entregar, en un solo documento, lo que paso en ELLA desde ESA hora.
// De ahi las dos cosas que no trae la descarga a Excel: el corte es por hora
// (no por dia completo) y sale ya interpretado, con graficas, para que lo
// entienda alguien que no usa la app.
// ─────────────────────────────────────────────────────────────────────────────

/** El lunes de esta semana. Si hoy es lunes, hoy. */
function ultimoLunes(hoy) {
  const [y, m, d] = hoy.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  const dow = dt.getUTCDay()              // 0 domingo … 6 sabado
  const atras = dow === 0 ? 6 : dow - 1   // domingo cuenta como fin de esa semana
  dt.setUTCDate(dt.getUTCDate() - atras)
  return dt.toISOString().slice(0, 10)
}

export default function BranchPdfReportCard({
  branches = [], defaultBranchId, products = [], catLabel = (c) => c, generadoPor,
}) {
  const hoy = todayStr()
  const inicial = branches.some(b => String(b.id) === String(defaultBranchId))
    ? defaultBranchId
    : branches[0]?.id
  const [branchId, setBranchId] = useState(inicial)
  const [desde, setDesde] = useState(() => ultimoLunes(hoy))
  const [hora, setHora] = useState('12:00')
  const [estado, setEstado] = useState(null)   // null | 'generando' | 'listo' | 'error'
  const [detalle, setDetalle] = useState('')

  const branch = branches.find(b => String(b.id) === String(branchId))
  const rangoInvalido = !desde || desde > hoy

  async function generar() {
    if (!branch || rangoInvalido) return
    setEstado('generando')
    setDetalle('')
    try {
      const r = await downloadHandoverReport({
        branchId: branch.id,
        branchName: branch.name,
        fromDate: desde,
        fromTime: hora,
        toDate: hoy,
        products,
        catLabel,
        generadoPor,
      })
      setEstado('listo')
      setDetalle(`${r.ventas.length} ventas y ${r.gastos.length + r.ingresos.length} movimientos incluidos.`)
    } catch (e) {
      console.error('[reporte PDF]', e)
      setEstado('error')
      // El caso real es que Firestore pida un indice o niegue el permiso. Se
      // muestra el mensaje tal cual: es lo unico que permite arreglarlo.
      setDetalle(e?.message || 'No se pudo generar el reporte.')
    }
  }

  if (branches.length === 0) return null

  return (
    <div style={{ padding: '12px 16px 0' }}>
      <Card padding={16}>
        <div style={{ fontSize: 13, fontWeight: 700, color: T.neutral[800] }}>
          Reporte en PDF
        </div>
        <div style={{ fontSize: 12, color: T.neutral[500], marginTop: 3, lineHeight: 1.45 }}>
          Todo lo de una panadería desde un día y una hora exactos hasta hoy, con
          gráficas y explicado en palabras sencillas.
        </div>

        {branches.length > 1 && (
          <div style={{ marginTop: 14 }}>
            <FieldLabel>Panadería</FieldLabel>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {branches.map(b => {
                const activo = String(b.id) === String(branchId)
                return (
                  <button
                    key={b.id}
                    onClick={() => setBranchId(b.id)}
                    style={{
                      padding: '7px 13px', borderRadius: 999, cursor: 'pointer',
                      fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600,
                      border: `1px solid ${activo ? T.copper[500] : T.neutral[200]}`,
                      background: activo ? T.copper[500] : '#fff',
                      color: activo ? '#fff' : T.neutral[600],
                    }}
                  >{b.name}</button>
                )
              })}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <div style={{ flex: 1.4 }}>
            <FieldLabel>Desde el día</FieldLabel>
            <input
              type="date" value={desde} max={hoy}
              onChange={e => { setDesde(e.target.value); setEstado(null) }}
              style={inputStyle}
            />
          </div>
          <div style={{ flex: 1 }}>
            <FieldLabel>A las</FieldLabel>
            <input
              type="time" value={hora}
              onChange={e => { setHora(e.target.value); setEstado(null) }}
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ fontSize: 11.5, color: T.neutral[500], marginTop: 10, lineHeight: 1.5 }}>
          {rangoInvalido
            ? 'Elige un día que no sea futuro.'
            : <>Desde el <b>{fechaLarga(desde)}</b>, {horaColombiana(hora)}, hasta hoy {fechaLarga(hoy)}.</>}
        </div>

        <button
          onClick={generar}
          disabled={estado === 'generando' || rangoInvalido || !branch}
          style={{
            width: '100%', marginTop: 12, padding: '12px', borderRadius: 10,
            border: 'none', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700,
            cursor: estado === 'generando' || rangoInvalido ? 'default' : 'pointer',
            background: estado === 'generando' || rangoInvalido ? T.neutral[200] : T.neutral[800],
            color: estado === 'generando' || rangoInvalido ? T.neutral[500] : '#fff',
          }}
        >
          {estado === 'generando'
            ? 'Armando el reporte…'
            : `Descargar PDF${branch ? ' de ' + branch.name : ''}`}
        </button>

        {estado === 'listo' && (
          <div style={{ fontSize: 12, color: T.ok, marginTop: 10, fontWeight: 600 }}>
            Listo, se descargó. {detalle}
          </div>
        )}
        {estado === 'error' && (
          <div style={{ fontSize: 12, color: T.bad, marginTop: 10, lineHeight: 1.45 }}>
            No se pudo generar: {detalle}
          </div>
        )}
      </Card>
    </div>
  )
}

function FieldLabel({ children }) {
  return (
    <div style={{
      fontSize: 10.5, fontWeight: 700, color: T.neutral[500],
      textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6,
    }}>{children}</div>
  )
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10,
  border: `1px solid ${T.neutral[200]}`, background: '#fff',
  fontFamily: 'inherit', fontSize: 13.5, color: T.neutral[800],
}

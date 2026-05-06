import { useEffect, useState } from 'react'
import { T } from '../tokens'
import {
  useOnlineStatus,
  usePendingWrites,
  flushPendingWrites,
  reconnectFirestore,
} from '../utils/network'
import { usePendingPhotos, flushQueueNow } from '../utils/photoQueue'

// ──────────────────────────────────────────────────────────────
// SyncBeforeCloseModal
//
// Antes de cerrar el turno, la cajera debe tener TODA la informacion
// subida a la nube. Este modal aparece si hay:
//   - escrituras de Firestore aun encoladas (ventas, gastos, edits)
//   - fotos de comprobantes en la cola local de IndexedDB
//
// Mientras hay pendientes el modal se mantiene visible. Cuando todo
// llega a 0 dispara onAllSynced() automaticamente para que el flujo
// de cierre normal continue.
//
// Si la cajera esta offline y no hay forma de subir, ofrece "Mantener
// turno abierto" para abortar y volver al home.
// ──────────────────────────────────────────────────────────────

export default function SyncBeforeCloseModal({ initialPhotoCount, onAllSynced, onAbort }) {
  const online = useOnlineStatus()
  const firestorePending = usePendingWrites({ intervalMs: 1000 })
  const { count: photoPending } = usePendingPhotos({ intervalMs: 1500 })
  const [hadPhotos] = useState(initialPhotoCount || 0)
  const [reconnecting, setReconnecting] = useState(false)

  // Disparar reintento al montar y cuando vuelva la red.
  useEffect(() => {
    flushPendingWrites()
    flushQueueNow()
  }, [])
  useEffect(() => {
    if (online) {
      flushPendingWrites()
      flushQueueNow()
    }
  }, [online])

  // Cuando todo llega a 0 → continuar con cierre tras 600ms (para que la
  // cajera vea el "Listo"). El cleanup cancela el timeout si vuelve a haber
  // pendientes antes de disparar.
  const allClear = !firestorePending && photoPending === 0
  useEffect(() => {
    if (!allClear) return
    const t = setTimeout(() => onAllSynced(), 600)
    return () => clearTimeout(t)
  }, [allClear, onAllSynced])

  async function handleReconnect() {
    setReconnecting(true)
    await reconnectFirestore()
    flushQueueNow()
    setTimeout(() => setReconnecting(false), 800)
  }

  // Progreso visual de fotos: cuántas faltan vs cuántas había al abrir.
  const photosDone = Math.max(0, hadPhotos - photoPending)
  const photoProgressPct = hadPhotos > 0 ? Math.round((photosDone / hadPhotos) * 100) : 100

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        style={{
          width: '100%', maxWidth: 420,
          background: T.neutral[0],
          borderRadius: 22,
          padding: '26px 22px 22px',
          boxShadow: '0 24px 64px rgba(0,0,0,0.3)',
        }}
      >
        <div style={{ fontSize: 40, marginBottom: 10, textAlign: 'center' }}>
          {allClear ? '✅' : online ? '⏳' : '📵'}
        </div>
        <div style={{
          fontSize: 19, fontWeight: 800, color: T.neutral[900],
          textAlign: 'center', marginBottom: 6, letterSpacing: -0.3,
        }}>
          {allClear ? 'Todo subido' : online ? 'Subiendo a la nube...' : 'Esperando conexion'}
        </div>
        <div style={{
          fontSize: 13, color: T.neutral[600], lineHeight: 1.5,
          textAlign: 'center', marginBottom: 18,
        }}>
          {allClear
            ? 'Listo para cerrar tu turno.'
            : online
              ? 'Antes de cerrar tu turno, vamos a asegurarnos de que toda la informacion este en la nube.'
              : 'No hay internet ahora mismo. Cuando vuelva la señal, todo se subira automaticamente.'}
        </div>

        {/* Detalle de pendientes */}
        {!allClear && (
          <div style={{
            background: T.neutral[50],
            border: `1px solid ${T.neutral[200]}`,
            borderRadius: 14,
            padding: 14,
            marginBottom: 16,
          }}>
            {firestorePending && (
              <Row
                icon="📊"
                label="Datos (ventas, gastos, edits)"
                state="syncing"
              />
            )}
            {hadPhotos > 0 && (
              <Row
                icon="📷"
                label={`Fotos de comprobantes (${photosDone}/${hadPhotos})`}
                state={photoPending === 0 ? 'done' : 'syncing'}
                progress={photoProgressPct}
              />
            )}
            {!firestorePending && hadPhotos === 0 && photoPending > 0 && (
              <Row
                icon="📷"
                label={`${photoPending} foto${photoPending > 1 ? 's' : ''} pendiente${photoPending > 1 ? 's' : ''}`}
                state="syncing"
              />
            )}
          </div>
        )}

        {/* Botones */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {!allClear && online && (
            <button
              onClick={handleReconnect}
              disabled={reconnecting}
              style={{
                padding: '12px 14px', borderRadius: 12,
                background: T.copper[500], color: '#fff',
                border: 'none', fontSize: 14, fontWeight: 700,
                cursor: reconnecting ? 'wait' : 'pointer',
                opacity: reconnecting ? 0.7 : 1,
                fontFamily: 'inherit',
              }}
            >
              {reconnecting ? 'Reintentando...' : 'Reintentar ahora'}
            </button>
          )}
          {!allClear && (
            <button
              onClick={onAbort}
              style={{
                padding: '12px 14px', borderRadius: 12,
                background: T.neutral[100], color: T.neutral[700],
                border: 'none', fontSize: 14, fontWeight: 700,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Mantener turno abierto y volver luego
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ icon, label, state, progress }) {
  const dotColor = state === 'done' ? T.ok : T.warn
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 0',
    }}>
      <div style={{ fontSize: 18, flexShrink: 0 }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 600, color: T.neutral[800],
          marginBottom: progress != null && state !== 'done' ? 6 : 0,
        }}>
          {label}
        </div>
        {progress != null && state !== 'done' && (
          <div style={{
            height: 5, borderRadius: 999,
            background: T.neutral[200], overflow: 'hidden',
          }}>
            <div style={{
              width: `${progress}%`, height: '100%',
              background: T.copper[500], transition: 'width 0.4s',
            }}/>
          </div>
        )}
      </div>
      <div style={{
        width: 8, height: 8, borderRadius: 999,
        background: dotColor, flexShrink: 0,
        animation: state !== 'done' ? 'pulse 1.4s ease-in-out infinite' : 'none',
      }}/>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.55; transform: scale(1.2); }
        }
      `}</style>
    </div>
  )
}

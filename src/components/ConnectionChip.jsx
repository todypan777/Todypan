import { useState } from 'react'
import { T } from '../tokens'
import {
  useOnlineStatus,
  usePendingWrites,
  reconnectFirestore,
} from '../utils/network'
import { usePendingPhotos, flushQueueNow } from '../utils/photoQueue'

// ──────────────────────────────────────────────────────────────
// ConnectionChip
//
// Pildora siempre visible que muestra el estado de sincronizacion.
// Estados:
//  - 🟢 Sincronizado     (online + 0 pendientes)
//  - 🟡 Subiendo...      (online + pendientes encolados)
//  - 🔴 Sin conexion     (offline)
//  - 🔴 Sin conexion + N (offline + N escrituras pendientes)
//
// Tap → modal con detalle y boton "Reintentar conexion".
// ──────────────────────────────────────────────────────────────

export default function ConnectionChip({ compact = false }) {
  const online = useOnlineStatus()
  const pending = usePendingWrites()
  const { count: pendingPhotos } = usePendingPhotos()
  const [open, setOpen] = useState(false)

  const hasAnyPending = pending || pendingPhotos > 0
  const status = online
    ? (hasAnyPending ? 'syncing' : 'synced')
    : 'offline'

  const cfg = STATUS[status]

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={cfg.label}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: compact ? '4px 8px' : '5px 10px',
          borderRadius: 999,
          background: cfg.bg,
          border: `1px solid ${cfg.border}`,
          color: cfg.fg,
          fontSize: compact ? 11 : 12,
          fontWeight: 700,
          letterSpacing: 0.2,
          cursor: 'pointer',
          flexShrink: 0,
          lineHeight: 1.2,
          position: 'relative',
        }}
      >
        <span style={{
          width: 8, height: 8, borderRadius: 999,
          background: cfg.dot,
          animation: status === 'syncing' ? 'pulse 1.4s ease-in-out infinite' : 'none',
          boxShadow: status === 'syncing' ? `0 0 0 0 ${cfg.dot}` : 'none',
        }}/>
        {!compact && cfg.label}
        {(pendingPhotos > 0 || (status === 'offline' && pending)) && (
          <span style={{
            background: cfg.fg,
            color: '#fff',
            borderRadius: 999,
            padding: '1px 6px',
            fontSize: 10,
            fontWeight: 800,
            minWidth: 16,
            textAlign: 'center',
          }}>
            {pendingPhotos || '!'}
          </span>
        )}
      </button>

      {open && (
        <DetailModal
          status={status}
          pendingPhotos={pendingPhotos}
          firestorePending={pending}
          onClose={() => setOpen(false)}
        />
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.15); }
        }
      `}</style>
    </>
  )
}

const STATUS = {
  synced: {
    label: 'Sincronizado',
    bg: '#E8F0E5',
    border: '#BCD2B6',
    fg: '#3D6F3B',
    dot: T.ok,
  },
  syncing: {
    label: 'Subiendo...',
    bg: '#FFF4DD',
    border: '#F0D699',
    fg: '#8A5E12',
    dot: T.warn,
  },
  offline: {
    label: 'Sin conexion',
    bg: '#FBE4DF',
    border: '#E8B5AB',
    fg: '#8A3625',
    dot: T.bad,
  },
}

function DetailModal({ status, pendingPhotos, firestorePending, onClose }) {
  const [reconnecting, setReconnecting] = useState(false)

  async function handleReconnect() {
    setReconnecting(true)
    await reconnectFirestore()
    flushQueueNow()
    setTimeout(() => setReconnecting(false), 800)
  }

  const copy = COPY[status]

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 380,
          background: T.neutral[0],
          borderRadius: 18,
          padding: 20,
          boxShadow: '0 24px 64px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ fontSize: 36, marginBottom: 8 }}>{copy.emoji}</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: T.neutral[900], marginBottom: 6 }}>
          {copy.title}
        </div>
        <div style={{ fontSize: 13, color: T.neutral[600], lineHeight: 1.5, marginBottom: 14 }}>
          {copy.body}
        </div>

        {(firestorePending || pendingPhotos > 0) && (
          <div style={{
            background: T.neutral[50],
            border: `1px solid ${T.neutral[200]}`,
            borderRadius: 12,
            padding: 12,
            marginBottom: 16,
            fontSize: 12.5,
            color: T.neutral[700],
            lineHeight: 1.6,
          }}>
            <div style={{ fontWeight: 700, marginBottom: 4, color: T.neutral[900] }}>
              Pendiente de subir
            </div>
            {firestorePending && <div>· Cambios en datos (ventas, gastos, etc.)</div>}
            {pendingPhotos > 0 && <div>· {pendingPhotos} foto{pendingPhotos > 1 ? 's' : ''} de comprobante</div>}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          {status !== 'synced' && (
            <button
              onClick={handleReconnect}
              disabled={reconnecting}
              style={{
                flex: 1,
                padding: '11px 14px',
                borderRadius: 12,
                background: T.copper[500],
                color: '#fff',
                border: 'none',
                fontSize: 14, fontWeight: 700,
                cursor: reconnecting ? 'wait' : 'pointer',
                opacity: reconnecting ? 0.7 : 1,
              }}
            >
              {reconnecting ? 'Reintentando...' : 'Reintentar ahora'}
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              flex: status === 'synced' ? 1 : 0,
              padding: '11px 14px',
              borderRadius: 12,
              background: T.neutral[100],
              color: T.neutral[700],
              border: 'none',
              fontSize: 14, fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}

const COPY = {
  synced: {
    emoji: '✅',
    title: 'Todo al dia',
    body: 'Tus ventas y cambios estan guardados en la nube. Puedes seguir trabajando con tranquilidad.',
  },
  syncing: {
    emoji: '⏳',
    title: 'Subiendo cambios',
    body: 'Tienes cambios subiendose en este momento. Espera unos segundos antes de cerrar la app.',
  },
  offline: {
    emoji: '📵',
    title: 'Sin conexion',
    body: 'No hay internet ahora mismo. Puedes seguir registrando ventas: se guardan en el celular y se subiran automaticamente cuando vuelva la señal. Antes de cerrar tu turno la app verificara que todo este subido.',
  },
}

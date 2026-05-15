import { useEffect, useMemo, useState } from 'react'
import { T } from '../tokens'
import { fmtCOP } from '../utils/format'
import { CATEGORIES } from '../menu'
import { useAuth } from '../context/AuthCtx'
import { getData, initDB } from '../db'
import { watchCustomerOrder } from '../customerOrders'
import { watchOpenSessions } from '../cashSessions'

// ──────────────────────────────────────────────────────────────────
// /comanda/:id — pantalla pública (no fuerza login) que muestra un
// pedido hecho desde /menu. Comportamiento según quién la abra:
//
//   - ADMIN logueado → ve la acción "Confirmar y enviar a cocina":
//     ingresa el nombre del cliente y con un tap el sistema crea la
//     openTab (kind:llevar) en la cajera con turno abierto en
//     Panadería B y los kitchenOrders correspondientes.
//
//   - CUALQUIER OTRO (cliente, no logueado, otro rol) → ve el resumen
//     de su pedido en read-only con el mensaje "Pedido enviado a
//     TodyPan. Solo el administrador confirma."
//
//   - Si el pedido YA fue confirmado, todos ven el mismo resumen con
//     "Ya confirmado por X el [hora]" — evita dobles envíos.
// ──────────────────────────────────────────────────────────────────

// La panadería que recibe los pedidos web (por ahora hardcoded en B).
const WEB_ORDER_BRANCH_NAME = 'Panadería B'

export default function OrderConfirm({ orderId }) {
  const { authUser, userDoc, loading: authLoading } = useAuth()
  const [order, setOrder] = useState(null)
  const [loading, setLoading] = useState(true)
  // initDB carga _data (branches, etc.) desde Firestore. La pantalla de
  // confirmación lo necesita para encontrar la panadería destino del pedido
  // web — pero esta ruta no pasa por el ApprovedAppLoader, así que lo
  // llamamos acá. Idempotente: si ya está cargado, retorna inmediato.
  const [dbReady, setDbReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    initDB().then(() => { if (!cancelled) setDbReady(true) })
      .catch(() => { if (!cancelled) setDbReady(true) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!orderId) { setLoading(false); return }
    const unsub = watchCustomerOrder(orderId, o => {
      setOrder(o)
      setLoading(false)
    })
    return unsub
  }, [orderId])

  const isAdmin = userDoc?.role === 'admin' && userDoc?.status === 'approved'

  return (
    <div style={{
      minHeight: '100dvh', background: T.neutral[50],
      display: 'flex', flexDirection: 'column',
      fontFamily: 'inherit',
    }}>
      <Header />

      <div style={{
        flex: 1, maxWidth: 640, margin: '0 auto', width: '100%',
        padding: '20px 18px', boxSizing: 'border-box',
      }}>
        {(loading || authLoading || !dbReady) && <Loading />}

        {!loading && !order && (
          <EmptyState
            title="Pedido no encontrado"
            subtitle="El link puede estar incorrecto o el pedido ya no existe."
          />
        )}

        {!loading && order && order.status === 'confirmed' && (
          <ConfirmedView order={order} />
        )}

        {!loading && order && order.status !== 'confirmed' && !isAdmin && (
          <CustomerView order={order} />
        )}

        {!loading && dbReady && order && order.status !== 'confirmed' && isAdmin && (
          <AdminConfirmView
            order={order}
            orderId={orderId}
          />
        )}
      </div>

      <GlobalStyles />
    </div>
  )
}

// ─── Header ──────────────────────────────────────────────────────

function Header() {
  return (
    <div style={{
      background: '#fff', borderBottom: `1px solid ${T.neutral[100]}`,
      padding: '14px 18px',
    }}>
      <div style={{
        maxWidth: 640, margin: '0 auto',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <img
          src="/Logo.png"
          alt="TodyPan"
          width={40}
          height={40}
          style={{
            borderRadius: 12, objectFit: 'cover', flexShrink: 0,
            boxShadow: '0 2px 8px rgba(184,122,86,0.15)',
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3 }}>
            TodyPan · Pedido
          </div>
          <div style={{ fontSize: 11.5, color: T.neutral[500], marginTop: 2 }}>
            Resumen del pedido
          </div>
        </div>
      </div>
    </div>
  )
}

function Loading() {
  return (
    <div style={{
      padding: '60px 24px', textAlign: 'center', color: T.neutral[500],
      fontSize: 13.5,
    }}>
      Cargando pedido...
    </div>
  )
}

function EmptyState({ title, subtitle }) {
  return (
    <div style={{
      marginTop: 40, padding: '40px 24px 32px', textAlign: 'center',
      background: '#fff', borderRadius: 22,
      border: `1px solid ${T.neutral[100]}`,
    }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>🤷</div>
      <div style={{
        fontSize: 17, fontWeight: 800, color: T.neutral[900],
        letterSpacing: -0.3, marginBottom: 8,
      }}>
        {title}
      </div>
      <div style={{
        fontSize: 13.5, color: T.neutral[500], lineHeight: 1.5,
        maxWidth: 320, margin: '0 auto',
      }}>
        {subtitle}
      </div>
    </div>
  )
}

// ─── Resumen del pedido (compartido por todas las vistas) ────────

function OrderSummary({ order }) {
  return (
    <div style={{
      background: '#fff', borderRadius: 18,
      border: `1px solid ${T.neutral[100]}`,
      padding: '14px 16px', marginBottom: 16,
    }}>
      <div style={{
        fontSize: 11.5, fontWeight: 800, color: T.neutral[500],
        letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 10,
      }}>
        Pedido para llevar · {order.cart?.length || 0} {order.cart?.length === 1 ? 'almuerzo' : 'almuerzos'}
      </div>
      {(order.cart || []).map((item, i) => (
        <OrderItemRow key={i} item={item} index={i} isLast={i === order.cart.length - 1} />
      ))}
      <div style={{
        marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.neutral[100]}`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: T.neutral[600] }}>Total</span>
        <span style={{
          fontSize: 20, fontWeight: 900, color: T.neutral[900],
          fontVariantNumeric: 'tabular-nums', letterSpacing: -0.3,
        }}>
          {fmtCOP(order.total || 0)}
        </span>
      </div>
    </div>
  )
}

function OrderItemRow({ item, index, isLast }) {
  const isEspecial = item.kind === 'especial'
  return (
    <div style={{
      padding: '10px 0',
      borderBottom: isLast ? 'none' : `0.5px dashed ${T.neutral[200]}`,
    }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        gap: 8, marginBottom: 6,
      }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: T.neutral[900] }}>
          {index + 1}. {isEspecial ? 'Almuerzo Especial' : 'Almuerzo Corriente'}
        </div>
        <div style={{
          fontSize: 14, fontWeight: 800, color: T.neutral[900],
          fontVariantNumeric: 'tabular-nums',
        }}>
          {fmtCOP(item.price)}
        </div>
      </div>

      {isEspecial && item.description && (
        <div style={{
          fontSize: 12.5, color: T.neutral[700], lineHeight: 1.4,
          fontWeight: 600,
        }}>
          {item.description}
        </div>
      )}

      {!isEspecial && item.selections && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {CATEGORIES.map(cat => {
            const val = item.selections[cat.id]
            const text = formatSelection(cat, val)
            if (!text) return null
            const isSin = !val && cat.alwaysServed
            return (
              <div key={cat.id} style={{
                display: 'flex', gap: 6, fontSize: 11.5, lineHeight: 1.4,
              }}>
                <span style={{
                  color: T.neutral[500], fontWeight: 700,
                  minWidth: 84, flexShrink: 0,
                }}>
                  {cat.label}
                </span>
                <span style={{
                  flex: 1, color: isSin ? T.bad : T.neutral[800],
                  fontWeight: isSin ? 800 : 600, wordBreak: 'break-word',
                }}>
                  {text}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {item.note && (
        <div style={{
          marginTop: 8, padding: '7px 10px', borderRadius: 8,
          background: '#FFF7E6', border: `1px solid #F4E0BC`,
          fontSize: 12, color: '#7A5C00', fontWeight: 600,
          fontStyle: 'italic', lineHeight: 1.4, wordBreak: 'break-word',
        }}>
          📝 {item.note}
        </div>
      )}
    </div>
  )
}

function formatSelection(cat, val) {
  if (!val) return cat.alwaysServed ? `SIN ${cat.label.toUpperCase()}` : null
  if (Array.isArray(val)) {
    if (val.length === 0) return null
    if (val.length === 1) return val[0]?.name || null
    return 'MIXTO · ' + val.map(v => v.name).join(' / ')
  }
  return val.name || null
}

// ─── Vista: pedido YA confirmado ─────────────────────────────────

function ConfirmedView({ order }) {
  const when = order.confirmedAt?.toDate?.()
    || (order.confirmedAtClient ? new Date(order.confirmedAtClient) : null)
  const timeStr = when
    ? when.toLocaleString('es-CO', {
        hour: '2-digit', minute: '2-digit', hour12: false,
        timeZone: 'America/Bogota',
      })
    : '—'
  return (
    <>
      <div style={{
        marginTop: 8, marginBottom: 16, padding: '16px 18px', borderRadius: 16,
        background: '#E8F4E8', border: `1.5px solid ${T.ok}55`,
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: 999, flexShrink: 0,
          background: T.ok, color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <path d="M5 11 L9 15 L17 7" stroke="#fff" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round" fill="none"/>
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 900, color: T.ok, letterSpacing: -0.2 }}>
            Pedido confirmado
          </div>
          <div style={{ fontSize: 12, color: T.neutral[700], marginTop: 2, lineHeight: 1.4 }}>
            {order.confirmedByName ? `Por ${order.confirmedByName}` : ''} · {timeStr}
            {order.customerName && <> · Cliente: <b>{order.customerName}</b></>}
          </div>
        </div>
      </div>
      <OrderSummary order={order} />
    </>
  )
}

// ─── Vista: cliente / no-admin ───────────────────────────────────

function CustomerView({ order }) {
  return (
    <>
      <div style={{
        marginTop: 8, marginBottom: 16, padding: '16px 18px', borderRadius: 16,
        background: T.copper[50], border: `1.5px solid ${T.copper[200]}`,
      }}>
        <div style={{ fontSize: 14.5, fontWeight: 900, color: T.copper[700], letterSpacing: -0.2, marginBottom: 6 }}>
          Pedido enviado a TodyPan
        </div>
        <div style={{ fontSize: 13, color: T.neutral[700], lineHeight: 1.5 }}>
          Tu pedido ya está en WhatsApp. El administrador lo confirma desde
          este link y empieza a prepararlo. Te avisamos por WhatsApp cuando
          esté listo.
        </div>
      </div>
      <OrderSummary order={order} />
    </>
  )
}

// ─── Vista: admin confirma ────────────────────────────────────────
// El admin NO confirma directo aquí. Tap → entra en MODO ASISTIR de la
// cajera de Panadería B con los almuerzos del cliente pre-cargados en la
// comanda. El admin escribe el nombre del cliente en el modal "Enviar
// comanda" (donde es OBLIGATORIO) y puede agregar bebidas si quiere.
// Al enviar la comanda, el flujo normal crea openTab + kitchenOrders y
// marca el customerOrder como confirmado.
function AdminConfirmView({ order, orderId }) {
  const [openSessions, setOpenSessions] = useState([])

  useEffect(() => watchOpenSessions(setOpenSessions), [])

  const branches = useMemo(() => getData().branches || [], [])
  const targetBranch = useMemo(
    () => branches.find(b => b.name === WEB_ORDER_BRANCH_NAME) || null,
    [branches]
  )
  const targetSession = useMemo(
    () => targetBranch
      ? openSessions.find(s => s.branchId === targetBranch.id)
      : null,
    [openSessions, targetBranch]
  )

  function handleAtender() {
    // Redirige a la app principal con el orderId en query — ActiveTurnsCard
    // lo detecta al montar, abre modo asistir y pre-carga la comanda.
    window.location.href = `/?assistOrder=${encodeURIComponent(orderId)}`
  }

  const canAtender = !!targetSession

  return (
    <>
      <div style={{
        marginTop: 8, marginBottom: 16, padding: '14px 16px', borderRadius: 16,
        background: T.copper[50], border: `1.5px solid ${T.copper[200]}`,
      }}>
        <div style={{ fontSize: 13.5, fontWeight: 900, color: T.copper[700], letterSpacing: -0.2, marginBottom: 4 }}>
          Pedido pendiente · listo para atender
        </div>
        <div style={{ fontSize: 12.5, color: T.neutral[700], lineHeight: 1.5 }}>
          Lo recibimos desde /menu. Al tocar el botón entras en <b>modo asistir</b>
          {' '}con los almuerzos pre-cargados. Pones el nombre del cliente en el
          modal de envío (obligatorio) y, si quiere algo más (bebida, postre),
          lo agregas antes de enviar.
        </div>
      </div>

      <OrderSummary order={order} />

      {!targetBranch && (
        <NoticeBox tone="bad">
          No encontramos la panadería <b>{WEB_ORDER_BRANCH_NAME}</b>. Verifica
          que exista una panadería con ese nombre exacto en Más → Panaderías.
        </NoticeBox>
      )}

      {targetBranch && !targetSession && (
        <NoticeBox tone="warn">
          <b>No hay turno abierto</b> en {WEB_ORDER_BRANCH_NAME}. Abre el
          turno de la cajera primero y vuelve a tocar el link.
        </NoticeBox>
      )}

      {targetSession && (
        <div style={{
          background: '#fff', borderRadius: 16,
          border: `1px solid ${T.neutral[100]}`,
          padding: '14px 16px', marginBottom: 16,
        }}>
          <div style={{
            fontSize: 11, fontWeight: 800, color: T.neutral[500],
            letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6,
          }}>
            Se carga a
          </div>
          <div style={{ fontSize: 14, fontWeight: 800, color: T.neutral[900] }}>
            {targetSession.cashierName || 'Cajera'} · {targetSession.branchName || WEB_ORDER_BRANCH_NAME}
          </div>
        </div>
      )}

      <button
        onClick={handleAtender}
        disabled={!canAtender}
        style={{
          width: '100%', padding: '16px', borderRadius: 16,
          background: canAtender ? T.copper[500] : T.neutral[200],
          color: canAtender ? '#fff' : T.neutral[500],
          border: 'none', cursor: canAtender ? 'pointer' : 'not-allowed',
          fontFamily: 'inherit', fontSize: 15.5, fontWeight: 800, letterSpacing: 0.3,
          boxShadow: canAtender ? '0 4px 14px rgba(184,122,86,0.35)' : 'none',
        }}
      >
        Atender este pedido →
      </button>
    </>
  )
}

function NoticeBox({ tone = 'warn', children }) {
  const palette = tone === 'bad'
    ? { bg: '#FBE9E5', border: '#F0C8BE', color: T.bad }
    : { bg: '#FFF7E6', border: '#F4E0BC', color: '#7A5C00' }
  return (
    <div style={{
      marginBottom: 16, padding: '14px 16px', borderRadius: 14,
      background: palette.bg, border: `1.5px solid ${palette.border}`,
      fontSize: 13, color: palette.color, lineHeight: 1.5,
    }}>
      {children}
    </div>
  )
}

function GlobalStyles() {
  return (
    <style>{`
      @keyframes ocFadeIn { from { opacity: 0 } to { opacity: 1 } }
    `}</style>
  )
}

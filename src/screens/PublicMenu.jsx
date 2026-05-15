import { useEffect, useMemo, useState } from 'react'
import { T } from '../tokens'
import { fmtCOP } from '../utils/format'
import {
  CATEGORIES,
  watchMenuItems, watchDailyMenu, watchCorrienteConfig,
  getCorrienteState, resolveDailyMenu,
} from '../menu'
import { useBogotaDate } from '../utils/useBogotaDate'
import { createCustomerOrder } from '../customerOrders'
import PublicLunchPickerModal from '../components/PublicLunchPickerModal'

// ──────────────────────────────────────────────────────────────────
// Página pública /menu para clientes.
//   - Sin login, sin Firestore writes.
//   - Lee dailyMenu, menuItems, corriente_config en vivo.
//   - Cliente arma su pedido (1+ almuerzos) y se redirige a WhatsApp
//     con el mensaje formateado.
//   - Si la cocinera no ha publicado, muestra estado vacío con botón
//     "Solicitar menú" que también abre WhatsApp.
// ──────────────────────────────────────────────────────────────────

const WHATSAPP_NUMBER = '573115874957'  // Colombia (57) + 311 5874957

export default function PublicMenu() {
  const today = useBogotaDate()
  const [dailyMenu, setDailyMenu] = useState(null)
  const [allItems, setAllItems] = useState([])
  const [corrienteConfig, setCorrienteConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Pedido del cliente: lista de almuerzos.
  // shape: [{ kind: 'corriente' | 'especial', selections?, description?, note, price }]
  const [cart, setCart] = useState([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)

  // Watchers
  useEffect(() => {
    let pending = 3
    const finish = () => { if (--pending === 0) setLoading(false) }
    const onErr = e => { setError(e?.message || 'Error cargando el menú'); finish() }

    const u1 = watchDailyMenu(today, v => { setDailyMenu(v); finish() })
    const u2 = watchMenuItems(v => { setAllItems(v); finish() })
    const u3 = watchCorrienteConfig(v => { setCorrienteConfig(v); finish() })

    // Timeout de seguridad por si los watchers se demoran
    const t = setTimeout(() => setLoading(false), 6000)

    return () => {
      try { u1?.() } catch {}
      try { u2?.() } catch {}
      try { u3?.() } catch {}
      clearTimeout(t)
    }
  }, [today])

  const corriente = useMemo(
    () => getCorrienteState(dailyMenu, allItems, corrienteConfig),
    [dailyMenu, allItems, corrienteConfig]
  )
  const resolvedMenu = useMemo(
    () => resolveDailyMenu(dailyMenu, allItems),
    [dailyMenu, allItems]
  )
  const special = dailyMenu?.special?.active === true ? dailyMenu.special : null
  const hasAnything = corriente.available || !!special

  const total = useMemo(
    () => cart.reduce((s, it) => s + Number(it.price || 0), 0),
    [cart]
  )

  function addCorriente(payload) {
    setCart(prev => [...prev, { kind: 'corriente', ...payload }])
    setPickerOpen(false)
  }
  function addEspecial() {
    if (!special) return
    const priceLlevar = Number(special.priceLlevar || special.priceMesa || 0)
    setCart(prev => [...prev, {
      kind: 'especial',
      description: special.description || 'Almuerzo Especial',
      note: '',
      price: priceLlevar,
    }])
  }
  function removeItem(i) {
    setCart(prev => prev.filter((_, idx) => idx !== i))
  }

  // Estado del envío: 'idle' | 'sending' | 'sent'
  const [sendState, setSendState] = useState('idle')

  async function sendOrder() {
    if (cart.length === 0 || sendState === 'sending') return
    setSendState('sending')
    // 1) Guardar el pedido en Firestore para que el admin pueda confirmarlo
    //    con un solo tap desde el link del WhatsApp. Si falla, igual lo
    //    mandamos por WhatsApp sin link — el admin lo arma a mano.
    let orderId = null
    try {
      orderId = await createCustomerOrder({ cart, total })
    } catch (err) {
      console.warn('[PublicMenu] no se pudo guardar customerOrder:', err?.message || err)
    }
    // 2) Construir el mensaje con (o sin) el link de confirmación al final.
    const confirmUrl = orderId
      ? `${window.location.origin}/comanda/${orderId}`
      : null
    const msg = buildOrderMessage(cart, confirmUrl)
    const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(msg)}`
    window.open(url, '_blank') || (window.location.href = url)
    // 3) Pantalla de "enviado" — limpia el carrito y le confirma al cliente
    //    que el pedido ya está en camino sin que tenga que adivinar.
    setSendState('sent')
    setReviewOpen(false)
    setCart([])
  }
  function requestMenu() {
    const msg = 'Hola, buenos días. Quisiera saber a qué hora estaría disponible el menú de hoy para hacer mi pedido. Muchas gracias.'
    const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(msg)}`
    window.open(url, '_blank') || (window.location.href = url)
  }

  return (
    <div style={{
      minHeight: '100dvh', background: T.neutral[50],
      display: 'flex', flexDirection: 'column',
      fontFamily: 'inherit',
    }}>
      <Header today={today} />

      <div style={{
        flex: 1,
        maxWidth: 640, margin: '0 auto', width: '100%',
        padding: '20px 18px',
        paddingBottom: cart.length > 0 ? 140 : 24,
        boxSizing: 'border-box',
      }}>
        {loading && <SkeletonCards />}

        {!loading && error && (
          <EmptyState
            title="No pudimos cargar el menú"
            subtitle="Revisa tu conexión e intenta de nuevo."
            cta="Reintentar"
            onCta={() => window.location.reload()}
          />
        )}

        {!loading && !error && !hasAnything && (
          <EmptyState
            title="Aún no hemos publicado el menú de hoy"
            subtitle="Te avisaremos por WhatsApp apenas esté listo."
            cta="Solicitar menú"
            onCta={requestMenu}
          />
        )}

        {!loading && !error && hasAnything && sendState === 'sent' && (
          <SentSuccess
            onAnother={() => setSendState('idle')}
          />
        )}

        {!loading && !error && hasAnything && sendState !== 'sent' && (
          <>
            <div style={{
              fontSize: 24, fontWeight: 900, color: T.neutral[900],
              letterSpacing: -0.6, marginBottom: 6,
              animation: 'pmHeroIn 0.4s ease 0.05s backwards',
            }}>
              Pedí acá, te ahorrás escribir
            </div>
            <div style={{
              fontSize: 14, color: T.neutral[600], marginBottom: 14, lineHeight: 1.5,
              animation: 'pmHeroIn 0.4s ease 0.1s backwards',
            }}>
              Personalizá tu almuerzo y te mandamos a WhatsApp con
              <b style={{ color: T.copper[700] }}> todo el pedido listo</b>.
              No tenés que escribir nada.
            </div>

            {/* Mini-indicador de pasos — refuerza que el flujo se completa
                acá y termina en WhatsApp, no al revés. */}
            <div style={{
              display: 'flex', gap: 8, marginBottom: 22,
              animation: 'pmHeroIn 0.4s ease 0.15s backwards',
            }}>
              <StepChip n="1" label="Escogé" />
              <StepChip n="2" label="Personalizá" />
              <StepChip n="3" label="Enviar" />
            </div>

            {corriente.available && (
              <CorrienteCard
                price={corriente.priceLlevar}
                resolvedMenu={resolvedMenu}
                onAdd={() => setPickerOpen(true)}
                animDelay={120}
              />
            )}

            {special && (
              <EspecialCard
                description={special.description || 'Almuerzo Especial'}
                price={Number(special.priceLlevar || special.priceMesa || 0)}
                onAdd={addEspecial}
                animDelay={corriente.available ? 200 : 120}
              />
            )}

            <Footer />
          </>
        )}
      </div>

      {/* Barra flotante de pedido */}
      {cart.length > 0 && (
        <CartBar
          count={cart.length}
          total={total}
          sending={sendState === 'sending'}
          onReview={() => setReviewOpen(true)}
          onSend={sendOrder}
        />
      )}

      {/* Modal personalizador corriente */}
      {pickerOpen && corriente.available && (
        <PublicLunchPickerModal
          resolvedMenu={resolvedMenu}
          price={corriente.priceLlevar}
          onCancel={() => setPickerOpen(false)}
          onAdd={addCorriente}
        />
      )}

      {/* Modal de revisión del pedido */}
      {reviewOpen && (
        <ReviewModal
          cart={cart}
          total={total}
          onRemove={removeItem}
          onClose={() => setReviewOpen(false)}
          onSend={() => { setReviewOpen(false); sendOrder() }}
        />
      )}

      <GlobalStyles />
    </div>
  )
}

// ─── Header ──────────────────────────────────────────────────────

function Header({ today }) {
  const fechaLabel = useMemo(() => formatNiceDate(today), [today])

  return (
    <div style={{
      background: '#fff', borderBottom: `1px solid ${T.neutral[100]}`,
      position: 'sticky', top: 0, zIndex: 20,
    }}>
      <div style={{
        maxWidth: 640, margin: '0 auto',
        padding: '14px 18px',
        display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <img
          src="/Logo.png"
          alt="TodyPan"
          width={44}
          height={44}
          style={{
            borderRadius: 12, objectFit: 'cover',
            flexShrink: 0,
            boxShadow: '0 2px 8px rgba(184,122,86,0.15)',
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 16, fontWeight: 800, color: T.neutral[900],
            letterSpacing: -0.3, lineHeight: 1.1,
          }}>
            TodyPan · Menú del día
          </div>
          <div style={{
            fontSize: 12, color: T.copper[700], fontWeight: 700,
            marginTop: 2, letterSpacing: 0.2, textTransform: 'capitalize',
          }}>
            {fechaLabel}
          </div>
        </div>
      </div>
    </div>
  )
}

function formatNiceDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T12:00:00')
  const days = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado']
  const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
  return `${days[d.getDay()]}, ${d.getDate()} de ${months[d.getMonth()]}`
}

// ─── Cards ───────────────────────────────────────────────────────

function CorrienteCard({ price, resolvedMenu, onAdd, animDelay = 0 }) {
  return (
    <div style={{
      background: '#fff', borderRadius: 20,
      border: `1px solid ${T.copper[100]}`,
      boxShadow: '0 4px 18px rgba(184,122,86,0.08)',
      overflow: 'hidden',
      animation: `pmCardIn 0.5s cubic-bezier(0.2,0.9,0.3,1.05) ${animDelay}ms backwards`,
      marginBottom: 18,
    }}>
      <div style={{
        padding: '18px 20px 8px',
        background: `linear-gradient(180deg, ${T.copper[50]} 0%, #fff 100%)`,
      }}>
        <div style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8,
        }}>
          <div style={{
            fontSize: 11.5, fontWeight: 800, color: T.copper[700],
            letterSpacing: 1.2, textTransform: 'uppercase',
          }}>
            Almuerzo Corriente
          </div>
          <div style={{
            fontSize: 22, fontWeight: 900, color: T.neutral[900],
            fontVariantNumeric: 'tabular-nums', letterSpacing: -0.5,
          }}>
            {fmtCOP(price)}
          </div>
        </div>
        <div style={{
          fontSize: 12.5, color: T.neutral[500], marginTop: 2,
        }}>
          Para llevar · personalízalo a tu gusto
        </div>
      </div>

      <div style={{ padding: '8px 20px 18px' }}>
        {CATEGORIES.map(cat => {
          const opts = resolvedMenu[cat.id] || []
          if (opts.length === 0) return null
          return (
            <div key={cat.id} style={{
              display: 'flex', alignItems: 'baseline', gap: 10,
              padding: '8px 0',
              borderBottom: `0.5px dashed ${T.neutral[100]}`,
            }}>
              <span style={{ fontSize: 14, flexShrink: 0 }}>{cat.emoji}</span>
              <div style={{
                fontSize: 11, fontWeight: 800, color: T.neutral[500],
                letterSpacing: 0.5, textTransform: 'uppercase',
                minWidth: 88, flexShrink: 0,
              }}>
                {cat.label}
              </div>
              <div style={{
                flex: 1, fontSize: 13.5, color: T.neutral[800],
                fontWeight: 600, lineHeight: 1.4,
              }}>
                {opts.map(o => o.name).join(' · ')}
              </div>
            </div>
          )
        })}
      </div>

      <button
        onClick={onAdd}
        style={{
          width: '100%', padding: '16px',
          background: T.copper[500], color: '#fff',
          border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 15, fontWeight: 800, letterSpacing: 0.3,
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.15)',
          transition: 'background 0.18s, transform 0.1s ease',
        }}
        onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.985)')}
        onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
        onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
      >
        Personalizar y agregar →
      </button>
    </div>
  )
}

function EspecialCard({ description, price, onAdd, animDelay = 0 }) {
  return (
    <div style={{
      background: '#fff', borderRadius: 20,
      border: `1px solid #F4E0BC`,
      boxShadow: '0 4px 18px rgba(192,138,62,0.10)',
      overflow: 'hidden',
      animation: `pmCardIn 0.5s cubic-bezier(0.2,0.9,0.3,1.05) ${animDelay}ms backwards`,
      marginBottom: 18,
    }}>
      <div style={{
        padding: '18px 20px',
        background: `linear-gradient(180deg, #FFF7E6 0%, #fff 100%)`,
      }}>
        <div style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8,
        }}>
          <div style={{
            fontSize: 11.5, fontWeight: 800, color: T.warn,
            letterSpacing: 1.2, textTransform: 'uppercase',
          }}>
            Almuerzo Especial de hoy
          </div>
          <div style={{
            fontSize: 22, fontWeight: 900, color: T.neutral[900],
            fontVariantNumeric: 'tabular-nums', letterSpacing: -0.5,
          }}>
            {fmtCOP(price)}
          </div>
        </div>
        <div style={{
          fontSize: 15, color: T.neutral[800], marginTop: 10,
          fontWeight: 700, lineHeight: 1.45,
        }}>
          {description}
        </div>
      </div>

      <button
        onClick={onAdd}
        style={{
          width: '100%', padding: '16px',
          background: T.warn, color: '#fff',
          border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 15, fontWeight: 800, letterSpacing: 0.3,
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.15)',
          transition: 'background 0.18s, transform 0.1s ease',
        }}
        onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.985)')}
        onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
        onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
      >
        Agregar al pedido →
      </button>
    </div>
  )
}

// ─── Empty state / skeleton ──────────────────────────────────────

function EmptyState({ title, subtitle, cta, onCta }) {
  return (
    <div style={{
      marginTop: 40,
      padding: '40px 24px 32px', textAlign: 'center',
      background: '#fff', borderRadius: 22,
      border: `1px solid ${T.neutral[100]}`,
      boxShadow: '0 4px 18px rgba(0,0,0,0.04)',
      animation: 'pmCardIn 0.5s ease backwards',
    }}>
      <div style={{
        width: 72, height: 72, borderRadius: 999, margin: '0 auto 16px',
        background: T.copper[50], display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        animation: 'pmPulseSoft 2.4s ease-in-out infinite',
      }}>
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="14" r="10" stroke={T.copper[500]} strokeWidth="2"/>
          <path d="M11 14 Q16 18 21 14" stroke={T.copper[500]} strokeWidth="2" strokeLinecap="round" fill="none"/>
          <circle cx="12.5" cy="12" r="1.2" fill={T.copper[500]}/>
          <circle cx="19.5" cy="12" r="1.2" fill={T.copper[500]}/>
        </svg>
      </div>
      <div style={{
        fontSize: 17, fontWeight: 800, color: T.neutral[900],
        letterSpacing: -0.3, marginBottom: 8,
      }}>
        {title}
      </div>
      <div style={{
        fontSize: 13.5, color: T.neutral[500], lineHeight: 1.5,
        marginBottom: 22, maxWidth: 320, margin: '0 auto 22px',
      }}>
        {subtitle}
      </div>
      <button
        onClick={onCta}
        style={{
          padding: '13px 26px', borderRadius: 14,
          background: T.copper[500], color: '#fff',
          border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 14.5, fontWeight: 800, letterSpacing: 0.3,
          boxShadow: '0 4px 14px rgba(184,122,86,0.35)',
          transition: 'transform 0.1s ease',
        }}
        onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.97)')}
        onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
        onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
      >
        {cta}
      </button>
    </div>
  )
}

function SkeletonCards() {
  return (
    <>
      <div style={{
        height: 230, background: '#fff', borderRadius: 20,
        border: `1px solid ${T.neutral[100]}`, marginBottom: 16,
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', inset: 0,
          background: `linear-gradient(90deg, transparent 0%, ${T.neutral[100]}99 50%, transparent 100%)`,
          animation: 'pmShimmer 1.4s linear infinite',
        }} />
      </div>
      <div style={{
        height: 120, background: '#fff', borderRadius: 20,
        border: `1px solid ${T.neutral[100]}`,
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', inset: 0,
          background: `linear-gradient(90deg, transparent 0%, ${T.neutral[100]}99 50%, transparent 100%)`,
          animation: 'pmShimmer 1.4s linear infinite',
        }} />
      </div>
    </>
  )
}

// ─── Mini-indicador de 3 pasos (escogé · personalizá · enviar) ───

function StepChip({ n, label }) {
  return (
    <div style={{
      flex: 1, display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 10px', borderRadius: 999,
      background: '#fff', border: `1px solid ${T.copper[100]}`,
    }}>
      <div style={{
        width: 22, height: 22, borderRadius: 999, flexShrink: 0,
        background: T.copper[500], color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 800,
      }}>
        {n}
      </div>
      <div style={{
        fontSize: 11.5, fontWeight: 700, color: T.copper[700],
        letterSpacing: 0.2,
      }}>
        {label}
      </div>
    </div>
  )
}

// ─── Pantalla "Pedido enviado" ───────────────────────────────────
// Aparece tras un envío exitoso. Confirma al cliente que el pedido
// llegó, refuerza que el admin lo confirma y le da la opción de
// hacer otro pedido sin recargar la página.
function SentSuccess({ onAnother }) {
  return (
    <div style={{
      marginTop: 24, padding: '32px 24px', textAlign: 'center',
      background: '#fff', borderRadius: 22,
      border: `1px solid ${T.copper[100]}`,
      boxShadow: '0 4px 18px rgba(184,122,86,0.10)',
      animation: 'pmCardIn 0.5s ease backwards',
    }}>
      <div style={{
        width: 72, height: 72, borderRadius: 999, margin: '0 auto 16px',
        background: '#E8F4E8', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
          <path d="M9 18 L15 24 L27 12" stroke={T.ok} strokeWidth="3.5"
            strokeLinecap="round" strokeLinejoin="round" fill="none"/>
        </svg>
      </div>
      <div style={{
        fontSize: 19, fontWeight: 900, color: T.neutral[900],
        letterSpacing: -0.3, marginBottom: 8,
      }}>
        ¡Pedido enviado!
      </div>
      <div style={{
        fontSize: 14, color: T.neutral[600], lineHeight: 1.55,
        maxWidth: 320, margin: '0 auto 22px',
      }}>
        Tu pedido ya está en WhatsApp.<br/>
        <b style={{ color: T.neutral[800] }}>El administrador lo confirma
        y empieza a prepararlo</b>. Te avisamos por allí cuando esté listo.
      </div>
      <button
        onClick={onAnother}
        style={{
          padding: '12px 22px', borderRadius: 14,
          background: T.copper[500], color: '#fff',
          border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 14, fontWeight: 800, letterSpacing: 0.3,
          boxShadow: '0 4px 14px rgba(184,122,86,0.35)',
        }}
      >
        Hacer otro pedido
      </button>
    </div>
  )
}

// ─── Cart bar (floating) ─────────────────────────────────────────

function CartBar({ count, total, sending = false, onReview, onSend }) {
  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 30,
      background: 'transparent', pointerEvents: 'none',
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      animation: 'pmCartIn 0.4s cubic-bezier(0.2,0.9,0.3,1.05)',
    }}>
      <div style={{
        maxWidth: 640, margin: '0 auto', padding: '12px 14px 14px',
        pointerEvents: 'auto',
      }}>
        <div style={{
          background: '#fff', borderRadius: 18,
          border: `1px solid ${T.copper[100]}`,
          boxShadow: '0 10px 28px rgba(0,0,0,0.12)',
          padding: 8, display: 'flex', alignItems: 'stretch', gap: 8,
        }}>
          <button
            onClick={onReview}
            style={{
              flex: 1, padding: '12px 14px', borderRadius: 12,
              background: T.copper[50], color: T.copper[700],
              border: `1px solid ${T.copper[100]}`,
              cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
              display: 'flex', alignItems: 'center', gap: 12,
              transition: 'background 0.15s',
            }}
          >
            <div style={{
              width: 32, height: 32, borderRadius: 999, flexShrink: 0,
              background: T.copper[500], color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
            }}>
              {count}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.copper[700], letterSpacing: 0.4, textTransform: 'uppercase' }}>
                Tu pedido
              </div>
              <div style={{ fontSize: 15, fontWeight: 800, color: T.neutral[900], fontVariantNumeric: 'tabular-nums', letterSpacing: -0.3 }}>
                {fmtCOP(total)}
              </div>
            </div>
          </button>

          <button
            onClick={sending ? undefined : onSend}
            disabled={sending}
            aria-label="Enviar por WhatsApp"
            style={{
              padding: '12px 18px', borderRadius: 12,
              background: sending ? T.neutral[400] : '#25D366', color: '#fff',
              border: 'none', cursor: sending ? 'wait' : 'pointer', fontFamily: 'inherit',
              fontSize: 14, fontWeight: 800, letterSpacing: 0.3,
              boxShadow: sending ? 'none' : '0 4px 14px rgba(37,211,102,0.35)',
              display: 'flex', alignItems: 'center', gap: 8,
              animation: sending ? 'none' : 'pmPulseSend 2s ease-in-out infinite',
              transition: 'transform 0.1s ease',
            }}
            onMouseDown={e => !sending && (e.currentTarget.style.transform = 'scale(0.97)')}
            onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
            onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
          >
            {sending ? (
              <>
                <span style={{
                  width: 14, height: 14, borderRadius: 999,
                  border: '2px solid rgba(255,255,255,0.4)',
                  borderTopColor: '#fff',
                  animation: 'pmSpin 0.7s linear infinite',
                }}/>
                Enviando...
              </>
            ) : (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff">
                  <path d="M17.5 14.4c-.3-.1-1.7-.8-1.9-.9-.3-.1-.5-.1-.7.2-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.5-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6.1-.1.3-.3.4-.5.1-.2.2-.3.3-.5.1-.2.1-.4 0-.5 0-.1-.6-1.5-.9-2.1-.2-.5-.5-.5-.6-.5h-.6c-.2 0-.5.1-.7.4-.3.3-1 .9-1 2.3 0 1.3 1 2.6 1.1 2.8.1.2 1.9 3 4.7 4.2.7.3 1.2.5 1.6.6.7.2 1.3.2 1.8.1.5-.1 1.7-.7 2-1.4.3-.7.3-1.2.2-1.4 0-.1-.2-.2-.5-.3z"/>
                  <path d="M12 0C5.4 0 0 5.4 0 12c0 2.1.6 4.2 1.6 6L0 24l6.2-1.6c1.7 1 3.7 1.4 5.8 1.4 6.6 0 12-5.4 12-12S18.6 0 12 0zm0 22c-1.9 0-3.7-.5-5.3-1.5l-.4-.2-3.9 1 1-3.8-.2-.4c-1-1.6-1.6-3.5-1.6-5.4 0-5.5 4.5-10 10-10s10 4.5 10 10c0 5.5-4.5 10.3-10 10.3z" />
                </svg>
                Enviar
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Review modal ────────────────────────────────────────────────

function ReviewModal({ cart, total, onRemove, onClose, onSend }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      animation: 'pmFadeBg 0.2s ease',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 540, maxHeight: '88vh',
        background: T.neutral[50], borderRadius: '24px 24px 0 0',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 -8px 32px rgba(0,0,0,0.25)',
        animation: 'pmSlideUp 0.32s cubic-bezier(0.2,0.9,0.3,1.05)',
      }}>
        <div style={{
          padding: '18px 22px', background: '#fff',
          borderBottom: `1px solid ${T.neutral[100]}`,
          borderRadius: '24px 24px 0 0',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            style={{
              width: 38, height: 38, borderRadius: 999,
              background: T.neutral[100], border: 'none',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 3 L11 11 M11 3 L3 11" stroke={T.neutral[700]} strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3 }}>
              Tu pedido
            </div>
            <div style={{ fontSize: 12.5, color: T.neutral[500], marginTop: 2 }}>
              {cart.length} {cart.length === 1 ? 'almuerzo' : 'almuerzos'} · {fmtCOP(total)}
            </div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
          {cart.map((it, i) => (
            <CartItemCard
              key={i}
              index={i}
              item={it}
              onRemove={() => onRemove(i)}
            />
          ))}
        </div>

        <div style={{
          padding: '14px 18px',
          background: '#fff', borderTop: `1px solid ${T.neutral[100]}`,
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 14px)',
        }}>
          <button
            onClick={onSend}
            disabled={cart.length === 0}
            style={{
              width: '100%', padding: '15px', borderRadius: 16,
              background: cart.length === 0 ? T.neutral[200] : '#25D366',
              color: cart.length === 0 ? T.neutral[500] : '#fff',
              border: 'none', cursor: cart.length === 0 ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', fontSize: 15.5, fontWeight: 800, letterSpacing: 0.3,
              boxShadow: cart.length === 0 ? 'none' : '0 4px 14px rgba(37,211,102,0.35)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff">
              <path d="M12 0C5.4 0 0 5.4 0 12c0 2.1.6 4.2 1.6 6L0 24l6.2-1.6c1.7 1 3.7 1.4 5.8 1.4 6.6 0 12-5.4 12-12S18.6 0 12 0zm5.5 14.4c-.3.7-1.5 1.3-2 1.4-.5.1-1.1.1-1.8-.1-.4-.1-.9-.3-1.6-.6-2.8-1.2-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.8 0-1.4.7-2 1-2.3.3-.3.6-.4.7-.4h.6c.1 0 .4 0 .6.5.3.6.9 2 .9 2.1 0 .1 0 .3 0 .5-.1.2-.2.3-.3.5-.1.2-.3.4-.4.5-.1.1-.3.3-.1.6.2.3.7 1.2 1.6 2 1.1.9 2 1.3 2.3 1.4.3.1.4.1.6-.1.2-.2.7-.8.9-1.1.2-.3.4-.3.7-.2.3.1 1.6.8 1.9.9.3.1.5.2.5.3.1.2.1.7-.2 1.4z"/>
            </svg>
            Enviar pedido por WhatsApp
          </button>
        </div>
      </div>
    </div>
  )
}

function CartItemCard({ index, item, onRemove }) {
  const isEspecial = item.kind === 'especial'
  return (
    <div style={{
      background: '#fff', borderRadius: 14,
      border: `1px solid ${T.neutral[100]}`,
      padding: '12px 14px', marginBottom: 10,
      display: 'flex', gap: 12, alignItems: 'flex-start',
      animation: 'pmCardIn 0.35s ease backwards',
    }}>
      <div style={{
        width: 38, height: 38, borderRadius: 12, flexShrink: 0,
        background: isEspecial ? '#FFF7E6' : T.copper[50],
        border: `1px solid ${isEspecial ? '#F4E0BC' : T.copper[100]}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 800,
        color: isEspecial ? T.warn : T.copper[700],
      }}>
        {index + 1}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          gap: 8, marginBottom: 6,
        }}>
          <div style={{
            fontSize: 13.5, fontWeight: 800, color: T.neutral[900],
            letterSpacing: -0.2,
          }}>
            {isEspecial ? 'Almuerzo Especial' : 'Almuerzo Corriente'}
          </div>
          <div style={{
            fontSize: 14, fontWeight: 800, color: T.neutral[900],
            fontVariantNumeric: 'tabular-nums', flexShrink: 0,
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
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 3,
            marginTop: 2,
          }}>
            {CATEGORIES.map(cat => {
              const val = item.selections[cat.id]
              const text = formatSelection(cat, val)
              if (!text) return null
              const isSin = !val && cat.alwaysServed
              return (
                <div key={cat.id} style={{
                  display: 'flex', gap: 6, fontSize: 11.5, lineHeight: 1.35,
                }}>
                  <span style={{
                    color: T.neutral[500], fontWeight: 700, letterSpacing: 0.2,
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
            {item.note}
          </div>
        )}
      </div>

      <button
        onClick={onRemove}
        title="Quitar"
        style={{
          width: 30, height: 30, borderRadius: 999, flexShrink: 0,
          background: 'transparent', color: T.bad,
          border: `1px solid ${T.bad}55`,
          cursor: 'pointer', fontFamily: 'inherit',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M3 3 L9 9 M9 3 L3 9" stroke={T.bad} strokeWidth="1.8" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  )
}

function formatSelection(cat, val) {
  if (!val) {
    return cat.alwaysServed ? `SIN ${cat.label.toUpperCase()}` : null
  }
  if (Array.isArray(val)) {
    if (val.length === 0) return null
    if (val.length === 1) return val[0]?.name || null
    return 'MIXTO · ' + val.map(v => v.name).join(' / ')
  }
  return val.name || null
}

// ─── Footer ──────────────────────────────────────────────────────

function Footer() {
  return (
    <div style={{
      marginTop: 28, padding: '14px 4px',
      textAlign: 'center', color: T.neutral[400],
      fontSize: 11, letterSpacing: 0.3,
    }}>
      TodyPan · Hecho con cariño
    </div>
  )
}

// ─── Mensaje WhatsApp ────────────────────────────────────────────

const CAT_LABEL = {
  soup: 'Sopa',
  principio: 'Principio',
  protein: 'Proteína',
  side: 'Acompañante',
  salad: 'Ensalada',
  juice: 'Jugo',
}

function buildOrderMessage(cart, confirmUrl = null) {
  const lines = []
  lines.push('Hola, quiero hacer un pedido para llevar:')
  lines.push('')
  cart.forEach((item, idx) => {
    const isEspecial = item.kind === 'especial'
    const kindLabel = isEspecial ? 'Especial' : 'Corriente'
    lines.push(`ALMUERZO ${idx + 1} - ${kindLabel} - ${fmtCOP(item.price)}`)
    if (isEspecial) {
      if (item.description) lines.push(`  ${item.description}`)
    } else if (item.selections) {
      for (const cat of CATEGORIES) {
        const val = item.selections[cat.id]
        const text = formatSelection(cat, val)
        if (text) lines.push(`  ${CAT_LABEL[cat.id]}: ${text}`)
      }
    }
    if (item.note) lines.push(`  Nota: ${item.note}`)
    lines.push('')
  })
  const total = cart.reduce((s, it) => s + Number(it.price || 0), 0)
  lines.push(`TOTAL: ${fmtCOP(total)}`)
  // Link de confirmación (solo si guardamos el pedido en Firestore). Al
  // admin le llega como parte del mismo WhatsApp; un tap y el pedido entra
  // a cocina como si lo hubiera tipeado en modo asistir.
  if (confirmUrl) {
    lines.push('')
    lines.push('---')
    lines.push('Para el administrador de TodyPan:')
    lines.push(confirmUrl)
  }
  return lines.join('\n')
}

// ─── Estilos globales del módulo ─────────────────────────────────

function GlobalStyles() {
  return (
    <style>{`
      @keyframes pmHeroIn {
        from { transform: translateY(8px); opacity: 0; }
        to   { transform: translateY(0); opacity: 1; }
      }
      @keyframes pmCardIn {
        from { transform: translateY(14px); opacity: 0; }
        to   { transform: translateY(0); opacity: 1; }
      }
      @keyframes pmCartIn {
        from { transform: translateY(120%); opacity: 0; }
        to   { transform: translateY(0); opacity: 1; }
      }
      @keyframes pmShimmer {
        from { transform: translateX(-100%); }
        to   { transform: translateX(100%); }
      }
      @keyframes pmPulseSoft {
        0%, 100% { transform: scale(1); }
        50%      { transform: scale(1.04); }
      }
      @keyframes pmPulseSend {
        0%, 100% { box-shadow: 0 4px 14px rgba(37,211,102,0.35); }
        50%      { box-shadow: 0 4px 22px rgba(37,211,102,0.65); }
      }
      @keyframes pmFadeBg {
        from { background: rgba(0,0,0,0); }
        to   { background: rgba(0,0,0,0.55); }
      }
      @keyframes pmSlideUp {
        from { transform: translateY(12%); opacity: 0; }
        to   { transform: translateY(0); opacity: 1; }
      }
      @keyframes pmSpin {
        to { transform: rotate(360deg); }
      }
    `}</style>
  )
}

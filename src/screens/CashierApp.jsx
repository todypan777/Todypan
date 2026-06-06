import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { T } from '../tokens'
import { Card, UserAvatar } from '../components/Atoms'
import { fmtCOP } from '../utils/format'
import { signOut } from '../auth'
import { getData } from '../db'
import { confirmOpeningAmount, reportOpeningDispute } from '../cashSessions'
import RoleSwitcher from '../components/RoleSwitcher'
import { watchSessionSales, flagSale } from '../sales'
import { createCashExpense, watchSessionExpenses, updateCashExpense, deleteCashExpense } from '../cashExpenses'
import { createCashIncome, watchSessionIncomes, updateCashIncome, deleteCashIncome } from '../cashIncomes'
import { watchDebtors, normalizeName, computeDebtorOwed } from '../debtors'
import { watchTasksForCashier, markTaskDone, unmarkTaskDone } from '../tasks'
import { watchPendingCallsForCashier, acknowledgeKitchenCall } from '../kitchenCalls'
import { watchLiveOrdersForSession } from '../kitchenOrders'
import { setupAudioUnlock, playKitchenCallSound, playOrderReadySound } from '../utils/notificationSound'
import ErrorBoundary from '../components/ErrorBoundary'
import ContactSupportButton from '../components/ContactSupportButton'
import { compressImage, uploadToImageBB } from '../utils/imagebb'
import { enqueuePhoto, makePhotoLocalId } from '../utils/photoQueue'
import NewSale from './NewSale'
import OpenTabsBubbles from '../components/OpenTabsBubbles'
import MissingPricesPanel from '../components/MissingPricesPanel'
import ProductCatalogPanel from '../components/ProductCatalogPanel'
import ConnectionChip from '../components/ConnectionChip'
import { useOnlineStatus, useDataSaver, isDataSaverEnabled, applyDataSaverOnBoot, ensureNetworkForWaiting } from '../utils/network'
import { requestPersistentStorage, useStorageHealth, onLocalWriteFailure } from '../utils/storage'
import MyHistoricalSales from './MyHistoricalSales'
import { getCustomerOrder } from '../customerOrders'
import { WEB_ORDER_BRANCH_NAME, customerCartToLunchCommanda } from '../utils/customerOrder'
import {
  watchCashierProducts,
  mergeProductCatalogs,
  getProductPrice,
} from '../products'

// ──────────────────────────────────────────────────────────────
// Wrapper top-level (D25): el admin abre y cierra los turnos.
// La sesión activa la decide StaffApp y llega por prop (puede haber 2+ turnos
// en la cuenta; aquí siempre recibimos UNO de tipo caja, ya garantizado open).
// ──────────────────────────────────────────────────────────────
export default function CashierApp({ authUser, userDoc, session, availableSessions, currentSessionId, onSwitchSession }) {
  // Desbloquea el audio al primer tap. Necesario para que el sonido de
  // llamada de cocina suene en iOS (Safari bloquea audio sin gesto previo).
  useEffect(() => { setupAudioUnlock() }, [])

  // Reintenta pedir almacenamiento persistente con la cajera ya dentro (más
  // 'engagement' → Chrome lo concede más fácil que en el primer arranque).
  // Blinda la cola offline de ventas/gastos/mesas contra el borrado del SO.
  useEffect(() => { requestPersistentStorage() }, [])

  // Modo ahorro: con turno de caja activo respetamos la preferencia de la
  // cajera (desconectar la red si está activa). EXCEPCIÓN: mientras la apertura
  // siga 'pending', mantenemos la red conectada — confirmOpeningAmount /
  // reportOpeningDispute usan `await updateDoc`, que se colgaría sin red. Una
  // vez confirmada, ya todo lo que escribe la cajera es fire-and-forget y el
  // ahorro puede desconectar sin colgar nada.
  const openingPending = session.openingConfirmation?.status === 'pending'
  useEffect(() => {
    if (!isDataSaverEnabled()) return
    if (openingPending) ensureNetworkForWaiting().catch(() => {})
    else applyDataSaverOnBoot().catch(() => {})
  }, [openingPending])

  // ── Pedido web (/comanda/{id}) atendido por la PROPIA cajera ──
  // OrderConfirm redirige a /?webOrder={id} cuando la cajera dueña del turno
  // toca "Atender este pedido". Lo capturamos aquí (su pantalla), validamos
  // que el turno actual sea de la panadería destino y precargamos la comanda
  // en su NewSale — mismo resultado que el modo asistir del admin, pero como
  // ella misma. shape: null | { id, lunchCommanda }
  const [webOrder, setWebOrder] = useState(null)
  const webOrderIdRef = useRef(null)

  // 1) Captura: leer el query param al montar y limpiarlo de la URL.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const id = params.get('webOrder')
    if (!id) return
    webOrderIdRef.current = id
    try {
      const url = new URL(window.location.href)
      url.searchParams.delete('webOrder')
      window.history.replaceState({}, '', url.toString())
    } catch {}
  }, [])

  // 2) Procesa: cuando el turno está listo (apertura confirmada) y es de la
  //    sede destino, cargamos el pedido y armamos la comanda.
  useEffect(() => {
    const id = webOrderIdRef.current
    if (!id || webOrder) return
    if (openingPending) return // esperar a que confirme la apertura
    const branches = getData().branches || []
    const targetBranch = branches.find(b => b.name === WEB_ORDER_BRANCH_NAME)
    // Seguridad: solo se atiende si este turno es de la panadería destino.
    if (!targetBranch || session.branchId !== targetBranch.id) {
      webOrderIdRef.current = null
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const order = await getCustomerOrder(id)
        if (cancelled) return
        if (!order || order.status === 'confirmed') {
          webOrderIdRef.current = null
          return
        }
        const lunchCommanda = customerCartToLunchCommanda(order.cart || [])
        webOrderIdRef.current = null
        setWebOrder({ id, lunchCommanda })
      } catch (err) {
        console.warn('[CashierApp] no se pudo cargar el pedido web:', err)
      }
    })()
    return () => { cancelled = true }
  }, [session.id, session.branchId, openingPending, webOrder])

  return (
    <div style={{
      minHeight: '100dvh', background: T.neutral[50],
      fontFamily: '-apple-system, "SF Pro Text", "Inter", system-ui, sans-serif',
      color: T.neutral[800],
    }}>
      <CashierTopBar
        authUser={authUser}
        userDoc={userDoc}
        session={session}
        branches={getData().branches || []}
        availableSessions={availableSessions}
        currentSessionId={currentSessionId}
        onSwitchSession={onSwitchSession}
      />

      <ConnectivityBanner />
      <StorageHealthBanner />

      {session.openingConfirmation?.status === 'pending' ? (
        <ConfirmOpeningScreen session={session} userDoc={userDoc} authUser={authUser} />
      ) : (
        <ActiveSession
          session={session}
          userDoc={userDoc}
          authUser={authUser}
          webOrder={webOrder}
          onConsumedCustomerOrder={() => setWebOrder(null)}
        />
      )}
    </div>
  )
}

// Banner que aparece debajo del top bar cuando la cajera está sin red Y/O
// con "Modo ahorro de datos" activado. Tres estados:
//   - Sin red real (online=false): banner gris/amarillo
//   - Modo ahorro activo (online=true pero el corte es voluntario): banner
//     copper con botón "Sincronizar ahora"
//   - Todo OK (online + sin modo ahorro): no se muestra nada
function ConnectivityBanner() {
  const online = useOnlineStatus()
  const { enabled: dataSaver, syncNow } = useDataSaver()
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState(null) // {ok, error}

  async function handleSyncNow() {
    setSyncing(true); setSyncResult(null)
    const r = await syncNow()
    setSyncResult(r)
    setSyncing(false)
    if (r.ok) {
      setTimeout(() => setSyncResult(null), 3000)
    }
  }

  if (!online && !dataSaver) {
    return (
      <div style={bannerStyle('#FFF4DD', '#F0D699', '#8A5E12')}>
        <div style={{ fontSize: 20, lineHeight: 1, flexShrink: 0 }}>📵</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 2 }}>
            Sin conexión
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.4 }}>
            Puedes seguir vendiendo. Tus ventas se guardarán y se subirán solas cuando vuelva la señal.
          </div>
        </div>
      </div>
    )
  }

  if (dataSaver) {
    return (
      <div style={bannerStyle('#FFEFE2', '#F0C8A8', '#8A4A1A')}>
        <div style={{ fontSize: 20, lineHeight: 1, flexShrink: 0 }}>💾</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 2 }}>
            Modo ahorro activo
          </div>
          <div style={{ fontSize: 11.5, lineHeight: 1.4, marginBottom: 8 }}>
            {syncResult?.ok
              ? '✅ Listo, todo sincronizado.'
              : syncResult?.error
                ? `⚠️ ${syncResult.error}. Reintentar.`
                : 'Sin gastar datos. Toca "Sincronizar" antes de cerrar el turno.'}
          </div>
          <button
            onClick={handleSyncNow}
            disabled={syncing || !online}
            style={{
              padding: '7px 14px', borderRadius: 999,
              background: !online ? T.neutral[200] : T.copper[500],
              color: !online ? T.neutral[500] : '#fff',
              border: 'none', fontFamily: 'inherit',
              fontSize: 12, fontWeight: 700,
              cursor: syncing || !online ? 'wait' : 'pointer',
              opacity: syncing ? 0.7 : 1,
            }}
          >
            {syncing ? 'Sincronizando...' : !online ? 'Necesitas datos para sincronizar' : 'Sincronizar ahora'}
          </button>
        </div>
      </div>
    )
  }

  return null
}

function bannerStyle(bg, border, fg) {
  return {
    background: bg,
    borderBottom: `1px solid ${border}`,
    color: fg,
    padding: '10px 16px',
    display: 'flex', alignItems: 'flex-start', gap: 10,
  }
}

// Aviso cuando el celular está en riesgo de perder datos offline:
//   - Crítico (rojo): una escritura NO quedó guardada (IndexedDB sin espacio).
//     Se gatilla en vivo desde firestoreOffline cuando un doc no entra a caché.
//   - Preventivo (ámbar): persistencia denegada o almacenamiento casi lleno.
//     Más enfático si el modo ahorro está activo (ahí se acumulan ventas sin subir).
function StorageHealthBanner() {
  const health = useStorageHealth()
  const { enabled: dataSaver } = useDataSaver()
  const [writeFailed, setWriteFailed] = useState(false)

  useEffect(() => onLocalWriteFailure(() => setWriteFailed(true)), [])

  if (writeFailed) {
    return (
      <div style={bannerStyle('#FBE9E5', '#F0C8BE', '#B42318')}>
        <div style={{ fontSize: 20, lineHeight: 1, flexShrink: 0 }}>⚠️</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 2 }}>
            El celular no pudo guardar algo
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.4 }}>
            Parece que falta espacio en este celular. Libera espacio y, si tienes
            modo ahorro, toca "Sincronizar ahora". Avísale al administrador para
            revisar que no falte ninguna venta o gasto.
          </div>
        </div>
      </div>
    )
  }

  if (!health || !health.atRisk) return null

  return (
    <div style={bannerStyle('#FFF4DD', '#F0D699', '#8A5E12')}>
      <div style={{ fontSize: 20, lineHeight: 1, flexShrink: 0 }}>📦</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 2 }}>
          Este celular está bajo de espacio
        </div>
        <div style={{ fontSize: 12, lineHeight: 1.4 }}>
          {dataSaver
            ? 'Con poco espacio y modo ahorro activo, tus ventas sin subir podrían perderse. Sincroniza seguido y libera espacio en el celular.'
            : 'Podría borrar lo guardado sin conexión. Libera espacio en el celular para no perder ventas ni gastos.'}
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// PANTALLA: Confirmar monto de apertura
// El admin abre el turno con un monto físico. Antes de poder vender, la cajera
// cuenta el efectivo y confirma. Si no coincide, reporta al admin (queda en
// Pendientes) pero igual puede empezar a vender — no la dejamos parada.
// ──────────────────────────────────────────────────────────────
function ConfirmOpeningScreen({ session, userDoc, authUser }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [mismatchOpen, setMismatchOpen] = useState(false)
  const [countedStr, setCountedStr] = useState('')
  const [note, setNote] = useState('')

  const expected = Number(session.openingAmount) || 0
  const cashierName = `${userDoc?.nombre || ''} ${userDoc?.apellido || ''}`.trim()
    || authUser?.email || 'Cajera'

  async function handleConfirm() {
    if (busy) return
    setBusy(true); setError(null)
    try {
      await confirmOpeningAmount(session.id, { byUid: authUser.uid, byName: cashierName })
      // El watcher recibe el update y cambia solo a la pantalla de turno activo.
    } catch (err) {
      console.error('[opening] confirm error:', err)
      setError('No pudimos guardar la confirmación. Intenta de nuevo.')
      setBusy(false)
    }
  }

  async function handleReport() {
    if (busy) return
    const counted = Number(countedStr)
    if (!countedStr || Number.isNaN(counted) || counted < 0) {
      setError('Escribe cuánto contaste.')
      return
    }
    setBusy(true); setError(null)
    try {
      await reportOpeningDispute(session.id, {
        expected,
        declared: counted,
        byUid: authUser.uid,
        byName: cashierName,
        note: note.trim() || null,
      })
      // El watcher recibe el update y cambia solo a la pantalla de turno activo.
    } catch (err) {
      console.error('[opening] report error:', err)
      setError('No pudimos enviar el reporte. Intenta de nuevo.')
      setBusy(false)
    }
  }

  return (
    <div style={{
      padding: '40px 24px 40px', maxWidth: 460, margin: '0 auto',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
    }}>
      <div style={{
        width: 72, height: 72, borderRadius: 999,
        background: T.copper[50], border: `1px solid ${T.copper[100]}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 16,
      }}>
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="6" width="18" height="12" rx="2" stroke={T.copper[600]} strokeWidth="1.7" fill="none"/>
          <circle cx="12" cy="12" r="2.5" stroke={T.copper[600]} strokeWidth="1.7" fill="none"/>
        </svg>
      </div>

      <div style={{
        fontSize: 21, fontWeight: 800, color: T.neutral[900],
        letterSpacing: -0.4, textAlign: 'center', lineHeight: 1.25, marginBottom: 6,
      }}>
        Confirma el monto de tu caja
      </div>
      <div style={{
        fontSize: 13.5, color: T.neutral[600], textAlign: 'center',
        lineHeight: 1.55, maxWidth: 340, marginBottom: 22,
      }}>
        El administrador abrió tu turno con este monto. Cuenta el efectivo físico
        y confirma que coincide antes de empezar a vender.
      </div>

      {/* Monto en grande */}
      <div style={{
        width: '100%', padding: '22px', borderRadius: 18, marginBottom: 18,
        background: 'linear-gradient(135deg, #FFE4D2 0%, #FFD0B0 100%)',
        border: `1.5px solid ${T.copper[200]}`, textAlign: 'center',
      }}>
        <div style={{
          fontSize: 11.5, fontWeight: 800, color: T.copper[700],
          letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6,
        }}>
          Monto en caja
        </div>
        <div style={{
          fontSize: 38, fontWeight: 900, color: T.neutral[900],
          letterSpacing: -1, fontVariantNumeric: 'tabular-nums',
        }}>
          {fmtCOP(expected)}
        </div>
      </div>

      {error && <ErrorBox text={error} />}

      {!mismatchOpen ? (
        <>
          <button
            onClick={handleConfirm}
            disabled={busy}
            style={{
              width: '100%', padding: '18px', borderRadius: 16,
              background: T.ok, color: '#fff', border: 'none',
              cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
              fontSize: 16, fontWeight: 800, letterSpacing: 0.2,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              boxShadow: `0 8px 20px ${T.ok}55`, opacity: busy ? 0.7 : 1, marginBottom: 10,
            }}
          >
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <path d="M5 11 L9 15 L17 7" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {busy ? 'Confirmando...' : `Sí, confirmo ${fmtCOP(expected)}`}
          </button>

          <button
            onClick={() => { setMismatchOpen(true); setError(null) }}
            disabled={busy}
            style={{
              width: '100%', padding: '13px', borderRadius: 14,
              background: 'transparent', color: T.neutral[600],
              border: `1.5px solid ${T.neutral[200]}`,
              cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 13.5, fontWeight: 700,
            }}
          >
            El monto no coincide
          </button>
        </>
      ) : (
        <div style={{ width: '100%' }}>
          <div style={{
            fontSize: 13, color: T.neutral[700], lineHeight: 1.5, marginBottom: 12,
          }}>
            Escribe cuánto contaste de verdad. Se le avisa al administrador y
            puedes empezar a vender de una vez.
          </div>

          <label style={{ fontSize: 12, fontWeight: 700, color: T.neutral[600], display: 'block', marginBottom: 6 }}>
            ¿Cuánto contaste?
          </label>
          <input
            type="number"
            inputMode="numeric"
            value={countedStr}
            onChange={e => setCountedStr(e.target.value)}
            placeholder="0"
            autoFocus
            disabled={busy}
            style={{
              width: '100%', padding: '14px 16px', borderRadius: 12,
              border: `1.5px solid ${T.neutral[200]}`, outline: 'none',
              fontFamily: 'inherit', fontSize: 18, fontWeight: 700,
              color: T.neutral[900], background: '#fff', marginBottom: 12,
              fontVariantNumeric: 'tabular-nums',
            }}
          />

          <label style={{ fontSize: 12, fontWeight: 700, color: T.neutral[600], display: 'block', marginBottom: 6 }}>
            Nota para el administrador (opcional)
          </label>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Ej: faltaban dos billetes de $20.000"
            rows={3}
            disabled={busy}
            style={{
              width: '100%', padding: '12px', borderRadius: 12,
              border: `1.5px solid ${T.neutral[200]}`, outline: 'none',
              fontFamily: 'inherit', fontSize: 13.5, color: T.neutral[900],
              background: '#fff', resize: 'vertical', minHeight: 60, marginBottom: 14,
            }}
          />

          <button
            onClick={handleReport}
            disabled={busy}
            style={{
              width: '100%', padding: '16px', borderRadius: 14,
              background: T.copper[500], color: '#fff', border: 'none',
              cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
              fontSize: 15, fontWeight: 800,
              boxShadow: `0 6px 16px ${T.copper[500]}55`,
              opacity: busy ? 0.7 : 1, marginBottom: 10,
            }}
          >
            {busy ? 'Enviando...' : 'Reportar y empezar turno'}
          </button>

          <button
            onClick={() => { setMismatchOpen(false); setError(null) }}
            disabled={busy}
            style={{
              width: '100%', padding: '12px', borderRadius: 12,
              background: 'transparent', color: T.neutral[600], border: 'none',
              cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600,
            }}
          >
            Volver
          </button>
        </div>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Top bar (avatar + nombre + cerrar sesión)
// ──────────────────────────────────────────────────────────────
function CashierTopBar({ authUser, userDoc, session, branches, availableSessions, currentSessionId, onSwitchSession }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [dataSaverConfirm, setDataSaverConfirm] = useState(null) // null | 'turn-on' | 'turn-off'

  return (
    <div style={{
      padding: '14px 18px',
      display: 'flex', alignItems: 'center', gap: 10,
      background: '#fff',
      borderBottom: `1px solid ${T.neutral[100]}`,
      position: 'sticky', top: 0, zIndex: 20,
    }}>
      <img
        src="/Logo.png"
        alt="Infinity Eventos"
        style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3 }}>
          TodyPan
        </div>
        <div style={{
          fontSize: 11, color: T.neutral[500],
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {userDoc?.nombre} {userDoc?.apellido}
        </div>
      </div>

      <ConnectionChip compact />

      <button
        onClick={() => setMenuOpen(true)}
        style={{
          width: 36, height: 36, borderRadius: 999,
          background: 'transparent', border: 'none', padding: 0,
          cursor: 'pointer', flexShrink: 0,
        }}
      >
        <UserAvatar user={authUser} size={34} />
      </button>

      {menuOpen && (
        <AvatarMenu
          authUser={authUser}
          userDoc={userDoc}
          onCancel={() => setMenuOpen(false)}
          onOpenCatalog={() => { setMenuOpen(false); setCatalogOpen(true) }}
          onToggleDataSaver={(intent) => { setMenuOpen(false); setDataSaverConfirm(intent) }}
          onSignOut={() => { setMenuOpen(false); setConfirmSignOut(true) }}
          availableSessions={availableSessions}
          currentSessionId={currentSessionId}
          onSwitchSession={onSwitchSession}
        />
      )}

      {confirmSignOut && (
        <SignOutModal
          onCancel={() => setConfirmSignOut(false)}
          onConfirm={async () => { await signOut() }}
        />
      )}

      {dataSaverConfirm && (
        <DataSaverModal
          intent={dataSaverConfirm}
          onClose={() => setDataSaverConfirm(null)}
        />
      )}

      {catalogOpen && session && (
        <ProductCatalogPanel
          branchId={session.branchId}
          branchName={session.branchName}
          branches={branches}
          cashierUid={authUser.uid}
          cashierName={`${userDoc?.nombre || ''} ${userDoc?.apellido || ''}`.trim()}
          onClose={() => setCatalogOpen(false)}
        />
      )}
    </div>
  )
}

function AvatarMenu({ authUser, userDoc, onCancel, onOpenCatalog, onToggleDataSaver, onSignOut, availableSessions, currentSessionId, onSwitchSession }) {
  const { enabled: dataSaverOn } = useDataSaver()
  return (
    <ModalOverlay onClose={onCancel}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 340, background: '#fff', borderRadius: 20,
        padding: '20px 0 12px', boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
      }}>
        {/* Header con avatar y nombre */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '0 22px 16px', borderBottom: `1px solid ${T.neutral[100]}`,
        }}>
          <UserAvatar user={authUser} size={44} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 14.5, fontWeight: 700, color: T.neutral[900],
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {userDoc?.nombre} {userDoc?.apellido}
            </div>
            <div style={{
              fontSize: 11.5, color: T.neutral[500],
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {authUser?.email}
            </div>
          </div>
        </div>

        {/* Cambiar de rol (solo si la cuenta tiene 2+ turnos abiertos) */}
        <RoleSwitcher
          sessions={availableSessions}
          currentId={currentSessionId}
          onSwitch={onSwitchSession}
          onAfterSwitch={onCancel}
        />

        {/* Opciones */}
        <button onClick={onOpenCatalog} style={menuItemStyle()}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <rect x="3" y="3" width="14" height="14" rx="2" stroke={T.neutral[600]} strokeWidth="1.6" fill="none"/>
            <path d="M6 7 H14 M6 10 H14 M6 13 H11" stroke={T.neutral[600]} strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          <span style={{ flex: 1 }}>Ver catálogo</span>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M3 1 L8 6 L3 11" stroke={T.neutral[400]} strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        <button onClick={() => onToggleDataSaver(dataSaverOn ? 'turn-off' : 'turn-on')} style={menuItemStyle()}>
          <span style={{ fontSize: 18, lineHeight: 1, width: 20, textAlign: 'center' }}>💾</span>
          <span style={{ flex: 1 }}>
            <div>Modo ahorro de datos</div>
            <div style={{ fontSize: 11, fontWeight: 500, color: dataSaverOn ? T.copper[600] : T.neutral[500], marginTop: 2 }}>
              {dataSaverOn ? 'Activo · sin gastar datos' : 'Desactivado'}
            </div>
          </span>
          <span style={{
            width: 36, height: 20, borderRadius: 999,
            background: dataSaverOn ? T.copper[500] : T.neutral[300],
            position: 'relative', flexShrink: 0,
            transition: 'background 0.15s',
          }}>
            <span style={{
              position: 'absolute', top: 2, left: dataSaverOn ? 18 : 2,
              width: 16, height: 16, borderRadius: 999, background: '#fff',
              transition: 'left 0.15s',
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            }}/>
          </span>
        </button>

        {/* Contactar al programador (WhatsApp) */}
        <ContactSupportButton
          variant="menu"
          reason="Algo no funciona en la app de cajera"
          userContext={`Cuenta: ${authUser?.email || ''} (${userDoc?.nombre || ''} ${userDoc?.apellido || ''})`}
          onClick={onCancel}
        />

        <button onClick={onSignOut} style={menuItemStyle({ danger: true })}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M8 4 L4 4 L4 16 L8 16" stroke={T.bad} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M11 7 L15 10 L11 13 M15 10 H7" stroke={T.bad} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span style={{ flex: 1 }}>Cerrar sesión</span>
        </button>

        <div style={{ padding: '8px 12px 0' }}>
          <button onClick={onCancel} style={{
            width: '100%', padding: '10px', borderRadius: 12,
            background: T.neutral[100], color: T.neutral[700],
            border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 13.5, fontWeight: 600,
          }}>
            Cancelar
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

function menuItemStyle({ danger = false } = {}) {
  return {
    width: '100%', padding: '14px 22px',
    background: 'transparent', border: 'none',
    cursor: 'pointer', fontFamily: 'inherit',
    fontSize: 14.5, fontWeight: 600,
    color: danger ? T.bad : T.neutral[800],
    display: 'flex', alignItems: 'center', gap: 14,
    textAlign: 'left',
  }
}

// Modal de confirmación para activar/desactivar Modo Ahorro. Cuando intent
// es 'turn-on' explica qué pasa al activar; al desactivar avisa que va a
// sincronizar todo lo encolado (puede tomar unos segundos según volumen).
function DataSaverModal({ intent, onClose }) {
  const { enabled, turnOn, turnOff, syncNow } = useDataSaver()
  const online = useOnlineStatus()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const turningOn = intent === 'turn-on'

  async function handleConfirm() {
    setBusy(true); setError(null)
    try {
      if (turningOn) {
        // Antes de cortar la red, intentar subir lo pendiente para arrancar
        // el modo ahorro con la cola limpia.
        if (online) {
          await syncNow() // ya respeta el ahorro (vuelve a desconectar al final)
        }
        await turnOn()
      } else {
        // Al desactivar: enableNetwork (que es lo que turnOff hace internamente)
        // sube la cola sola. waitForPendingWrites antes de cerrar el modal
        // para mostrar el estado real al usuario.
        await turnOff()
      }
      onClose()
    } catch (e) {
      setError(e?.message || 'No se pudo cambiar el modo. Intenta de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalOverlay onClose={busy ? undefined : onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 360, background: '#fff', borderRadius: 20,
        padding: '24px 22px', boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
      }}>
        <div style={{ fontSize: 36, textAlign: 'center', marginBottom: 8 }}>
          {turningOn ? '💾' : '📡'}
        </div>
        <div style={{ fontSize: 17, fontWeight: 800, color: T.neutral[900], textAlign: 'center', marginBottom: 8 }}>
          {turningOn ? 'Activar modo ahorro' : 'Desactivar modo ahorro'}
        </div>
        <div style={{
          fontSize: 13, color: T.neutral[600], textAlign: 'center',
          lineHeight: 1.55, marginBottom: 18,
        }}>
          {turningOn
            ? 'La app dejará de gastar datos. Puedes seguir vendiendo normal — todo se guarda en el celular. Antes de cerrar el turno, toca "Sincronizar ahora" en el banner para que el admin vea todas tus ventas.'
            : 'La app volverá a usar datos móviles para sincronizar en tiempo real. Tus ventas pendientes se subirán automáticamente.'}
        </div>

        {!online && turningOn && (
          <div style={{
            marginBottom: 14, padding: '10px 12px', borderRadius: 10,
            background: '#FFF4DD', border: `1px solid #F0D699`, color: '#8A5E12',
            fontSize: 12, lineHeight: 1.45,
          }}>
            Estás sin conexión. Se activará el modo ahorro de todas formas — al volver la red podrás sincronizar manualmente.
          </div>
        )}

        {error && (
          <div style={{
            marginBottom: 14, padding: '10px 12px', borderRadius: 10,
            background: '#FBE9E5', border: `1px solid #F0C8BE`, color: T.bad,
            fontSize: 12.5, fontWeight: 500, textAlign: 'center',
          }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} disabled={busy} style={btnSecondary()}>
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={busy}
            style={{
              ...btnPrimary(turningOn ? T.copper[500] : T.ok),
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? (turningOn ? 'Activando...' : 'Activando red...') : (turningOn ? 'Activar ahorro' : 'Reconectar')}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

function SignOutModal({ onCancel, onConfirm }) {
  const [busy, setBusy] = useState(false)
  return (
    <ModalOverlay onClose={busy ? undefined : onCancel}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 340, background: '#fff', borderRadius: 20,
        padding: '24px 22px', boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
      }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: T.neutral[900], textAlign: 'center', marginBottom: 8 }}>
          Cerrar sesión
        </div>
        <div style={{ fontSize: 13.5, color: T.neutral[600], textAlign: 'center', marginBottom: 22, lineHeight: 1.5 }}>
          ¿Seguro que quieres salir?
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCancel} disabled={busy} style={btnSecondary()}>Cancelar</button>
          <button
            onClick={async () => { setBusy(true); await onConfirm() }}
            disabled={busy}
            style={{ ...btnPrimary(T.bad), opacity: busy ? 0.7 : 1 }}
          >
            {busy ? 'Saliendo...' : 'Cerrar sesión'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

function ErrorBox({ text }) {
  return (
    <div style={{
      marginBottom: 10, padding: '10px 12px', borderRadius: 10,
      background: '#FBE9E5', border: `1px solid #F0C8BE`, color: T.bad,
      fontSize: 12.5, fontWeight: 500, textAlign: 'center',
    }}>
      {text}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// PANTALLA: Turno activo (header + cerrar turno)
// ──────────────────────────────────────────────────────────────
export function ActiveSession({
  session, userDoc, authUser,
  // Modo asistir (admin vendiendo por la cajera). Cuando viene poblado, la
  // pantalla es IDÉNTICA a la de la cajera pero: (1) los watchers personales
  // (tareas, descuentos, llamadas de cocina) apuntan a la cajera dueña del
  // turno (session.cashierUid), no al admin; (2) ventas/gastos se graban con
  // traza de admin vía assistMode; (3) se muestra una barra "Salir de asistir".
  // null/undefined = la cajera usa su propia pantalla, sin cambio alguno.
  assistMode = null,
  // Pedido web (/comanda/{id}) que el admin entró a atender: abre NewSale con
  // los almuerzos pre-cargados al montar. Solo aplica en modo asistir.
  initialLunchCommanda = null,
  // Pedido web atendido por la PROPIA cajera (no asistir). Llega asíncrono
  // desde CashierApp (tras cargar el doc), así que se engancha por efecto.
  // shape: null | { id, lunchCommanda }
  webOrder = null,
  onConsumedCustomerOrder,
  onExitAssist,
}) {
  const isAssist = !!assistMode
  // uid al que se atan los datos PERSONALES de la pantalla. Asistiendo = la
  // cajera del turno; normal = el usuario logueado (la cajera misma).
  const scopeUid = isAssist ? (session.cashierUid || authUser.uid) : authUser.uid

  const [newSaleOpen, setNewSaleOpen] = useState(false)
  const [editingTab, setEditingTab] = useState(null)  // tab abierto en NewSale
  const [expenseOpen, setExpenseOpen] = useState(false)
  const [incomeOpen, setIncomeOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false) // pantalla "Mis ventas" (Fase 9)
  const [boredomOpen, setBoredomOpen] = useState(false) // panel "¿estás aburrida?"
  const [cashierProducts, setCashierProducts] = useState([])
  const [sessionSales, setSessionSales] = useState([])
  const [sessionExpenses, setSessionExpenses] = useState([])
  const [sessionIncomes, setSessionIncomes] = useState([])
  const [debtors, setDebtors] = useState([])
  const [reportSale, setReportSale] = useState(null)
  const [myTasks, setMyTasks] = useState([])
  // Pedido web pendiente (solo asistir): se consume al abrir/cerrar el primer
  // NewSale. Después de eso, las ventas nuevas arrancan con carrito vacío.
  const [pendingOrderCommanda, setPendingOrderCommanda] = useState(
    isAssist ? (initialLunchCommanda || null) : null
  )
  const [pendingOrderId, setPendingOrderId] = useState(
    isAssist ? (assistMode?.customerOrderId || null) : null
  )
  const branches = getData().branches || []

  // Asistiendo con un pedido web: abrir NewSale pre-cargado al montar.
  useEffect(() => {
    if (isAssist && initialLunchCommanda && initialLunchCommanda.length > 0) {
      setNewSaleOpen(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Cajera atendiendo su propio pedido web: llega asíncrono desde CashierApp,
  // así que cuando aparezca cargamos la comanda y abrimos NewSale. No aplica
  // en modo asistir (ese va por el efecto de montaje de arriba).
  useEffect(() => {
    if (isAssist) return
    if (webOrder && Array.isArray(webOrder.lunchCommanda) && webOrder.lunchCommanda.length > 0) {
      setPendingOrderCommanda(webOrder.lunchCommanda)
      setPendingOrderId(webOrder.id)
      setNewSaleOpen(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webOrder?.id])

  function clearPendingOrder() {
    if (pendingOrderCommanda || pendingOrderId) {
      setPendingOrderCommanda(null)
      setPendingOrderId(null)
      onConsumedCustomerOrder?.()
    }
  }

  useEffect(() => watchCashierProducts(setCashierProducts), [])

  // Productos del catálogo SIN precio en la panadería actual (excluye venta libre)
  const missingPriceCount = useMemo(() => {
    const adminProducts = getData().products || []
    const catalog = mergeProductCatalogs(adminProducts, cashierProducts)
    return catalog.filter(p => !p.freeAmount && getProductPrice(p, session.branchId) === null).length
  }, [cashierProducts, session.branchId])

  useEffect(() => {
    const unsub = watchSessionSales(session.id, setSessionSales)
    return unsub
  }, [session.id])

  useEffect(() => {
    const unsub = watchSessionExpenses(session.id, setSessionExpenses)
    return unsub
  }, [session.id])

  useEffect(() => {
    const unsub = watchSessionIncomes(session.id, setSessionIncomes)
    return unsub
  }, [session.id])

  // Deudores para enlazar un ingreso que es abono a una deuda.
  useEffect(() => watchDebtors(setDebtors), [])

  useEffect(() => {
    const unsub = watchTasksForCashier(scopeUid, setMyTasks)
    return unsub
  }, [scopeUid])

  // Llamadas pendientes de cocina dirigidas a esta cajera.
  // Si hay alguna, se monta el overlay bloqueante encima de toda la UI.
  const [pendingCalls, setPendingCalls] = useState([])
  useEffect(() => {
    const unsub = watchPendingCallsForCashier(scopeUid, setPendingCalls)
    return unsub
  }, [scopeUid])
  const activeCall = pendingCalls[0] || null

  // Notificación SONORA (sin nada visual) cuando cocina marca un almuerzo
  // de esta sesión como 'ready'. Detectamos transiciones pending→ready
  // contra un baseline tomado en el primer snapshot — así no suena al
  // cargar la app si ya había orders listos de antes.
  const readyBaselineRef = useRef(null) // null = aún sin baseline
  useEffect(() => {
    readyBaselineRef.current = null // reset al cambiar de sesión
    return watchLiveOrdersForSession(session.id, (orders) => {
      const readyNow = new Set(
        orders.filter(o => o.status === 'ready').map(o => o.id)
      )
      if (readyBaselineRef.current === null) {
        readyBaselineRef.current = readyNow
        return
      }
      const newlyReady = [...readyNow].some(id => !readyBaselineRef.current.has(id))
      if (newlyReady) {
        try { playOrderReadySound() } catch {}
      }
      readyBaselineRef.current = readyNow
    })
  }, [session.id])

  // Mostrar últimas 15 ventas (D21: sin totales agregados)
  const recentSales = sessionSales.slice(0, 15)

  // Tareas relevantes para este turno:
  //   - Pendientes que aplican a esta panadería (o sin panadería específica)
  //   - Hechas que se completaron EN este turno (para verlas tachadas)
  const turnTasks = useMemo(() => {
    const branchOk = (t) => !t.branchId || String(t.branchId) === String(session.branchId)
    return myTasks.filter(t => {
      if (t.status === 'pending') return branchOk(t)
      if (t.status === 'done' && t.completedInSessionId === session.id) return true
      return false
    })
  }, [myTasks, session.id, session.branchId])
  const branch = branches.find(b => b.id === session.branchId) || { name: session.branchName, colorKey: 'copper' }
  const colorKey = branch.colorKey || 'copper'
  const palette = T[colorKey] || T.copper

  const openedAt = session.openedAt?.toDate?.() || new Date()
  const openedTime = openedAt.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false })
  const openedDay = openedAt.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' })

  return (
    <>
    {isAssist && (
      <AssistBar
        cashierName={session.cashierName}
        branchName={branch.name}
        onExit={onExitAssist}
      />
    )}
    <div style={{ padding: '24px 18px 40px', maxWidth: 540, margin: '0 auto' }}>
      <div style={{
        fontSize: 13, fontWeight: 700, color: palette[500] || T.copper[500],
        letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 4,
      }}>
        Turno activo
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.6, marginBottom: 4 }}>
        {branch.name}
      </div>
      <div style={{ fontSize: 13, color: T.neutral[500], marginBottom: 18 }}>
        Iniciado {openedDay} a las {openedTime}
      </div>

      {/* Botón principal: Nueva venta (las mesas se crean desde aquí al agregar items) */}
      <button
        onClick={() => setNewSaleOpen(true)}
        style={{
          width: '100%', padding: '20px', borderRadius: 18,
          background: T.copper[500], color: '#fff',
          border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 17, fontWeight: 800, letterSpacing: -0.2,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          boxShadow: '0 6px 18px rgba(184,122,86,0.4)',
          marginBottom: 10,
        }}
      >
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <circle cx="11" cy="11" r="9" stroke="#fff" strokeWidth="2" fill="none"/>
          <path d="M11 7 V15 M7 11 H15" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/>
        </svg>
        Nueva venta
      </button>

      {/* Botones secundarios: Ingreso + Gasto de caja, y Mis ventas */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
        <button
          onClick={() => setIncomeOpen(true)}
          style={{
            padding: '13px 10px', borderRadius: 14,
            background: '#fff', color: T.neutral[700],
            border: `1.5px solid ${T.neutral[200]}`,
            cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 13, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
            <path d="M3 15 L7 11 L11 14 L17 6 M17 6 H12 M17 6 V11" stroke={T.ok} strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Ingreso de caja
        </button>
        <button
          onClick={() => setExpenseOpen(true)}
          style={{
            padding: '13px 10px', borderRadius: 14,
            background: '#fff', color: T.neutral[700],
            border: `1.5px solid ${T.neutral[200]}`,
            cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 13, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
            <path d="M3 5 L7 9 L11 6 L17 14 M17 14 H12 M17 14 V9" stroke={T.bad} strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Gasto de caja
        </button>
      </div>
      <button
        onClick={() => setHistoryOpen(true)}
        style={{
          width: '100%', padding: '13px 10px', borderRadius: 14, marginBottom: 14,
          background: '#fff', color: T.neutral[700],
          border: `1.5px solid ${T.neutral[200]}`,
          cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 13, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="7.5" stroke={T.neutral[600]} strokeWidth="1.7" fill="none"/>
          <path d="M10 5 V10 L13 12" stroke={T.neutral[600]} strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Mis ventas
      </button>

      {/* Banner sorpresa: aparece solo si hay productos sin precio en esta panaderia.
          NO revela de qué se trata — la cajera lo descubre al tocar. */}
      {missingPriceCount > 0 && (
        <button
          onClick={() => setBoredomOpen(true)}
          style={{
            width: '100%', padding: '14px 16px', borderRadius: 16, marginBottom: 14,
            background: 'linear-gradient(135deg, #FFE4D2 0%, #FFD0B0 100%)',
            border: `1.5px solid ${T.copper[200]}`,
            cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', gap: 12,
            textAlign: 'left',
            boxShadow: '0 3px 10px rgba(184,122,86,0.15)',
            transition: 'transform 0.12s',
          }}
          onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.98)' }}
          onMouseUp={e => { e.currentTarget.style.transform = 'scale(1)' }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)' }}
        >
          <div style={{ fontSize: 28, lineHeight: 1, flexShrink: 0 }}>🥱</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 800, color: T.copper[700], letterSpacing: -0.2 }}>
              ¿Estás aburrida?
            </div>
            <div style={{ fontSize: 11.5, color: T.copper[700], opacity: 0.85, marginTop: 2 }}>
              Tap para descubrir algo útil que puedes hacer 👀
            </div>
          </div>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, color: T.copper[700] }}>
            <path d="M3 1 L9 7 L3 13" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      )}

      {/* Tareas del turno */}
      {turnTasks.length > 0 && (
        <CashierTaskList tasks={turnTasks} sessionId={session.id} />
      )}

      {/* Últimas ventas (sin montos — D21) */}
      {recentSales.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{
            fontSize: 12, fontWeight: 700, color: T.neutral[500],
            letterSpacing: 0.5, textTransform: 'uppercase',
            margin: '0 4px 8px',
          }}>
            Últimas ventas
          </div>
          <Card padding={0} style={{ overflow: 'hidden' }}>
            {recentSales.map((s, i) => (
              <SaleRow
                key={s.id}
                sale={s}
                isLast={i === recentSales.length - 1}
                onClick={() => setReportSale(s)}
              />
            ))}
          </Card>
          {sessionSales.length > 15 && (
            <div style={{
              fontSize: 11.5, color: T.neutral[400],
              textAlign: 'center', marginTop: 8,
            }}>
              + {sessionSales.length - 15} ventas anteriores en este turno
            </div>
          )}
        </div>
      )}

      {/* Gastos del turno */}
      {sessionExpenses.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{
            fontSize: 12, fontWeight: 700, color: T.neutral[500],
            letterSpacing: 0.5, textTransform: 'uppercase',
            margin: '0 4px 8px',
          }}>
            Gastos de caja del turno
          </div>
          <Card padding={0} style={{ overflow: 'hidden' }}>
            {sessionExpenses.map((e, i) => (
              <ExpenseRow
                key={e.id}
                expense={e}
                isLast={i === sessionExpenses.length - 1}
              />
            ))}
          </Card>
        </div>
      )}

      {/* Ingresos del turno */}
      {sessionIncomes.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{
            fontSize: 12, fontWeight: 700, color: T.neutral[500],
            letterSpacing: 0.5, textTransform: 'uppercase',
            margin: '0 4px 8px',
          }}>
            Ingresos de caja del turno
          </div>
          <Card padding={0} style={{ overflow: 'hidden' }}>
            {sessionIncomes.map((e, i) => (
              <IncomeRow
                key={e.id}
                income={e}
                isLast={i === sessionIncomes.length - 1}
              />
            ))}
          </Card>
        </div>
      )}

      {newSaleOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 60, background: T.neutral[50],
          animation: 'slideUp 0.25s cubic-bezier(0.2,0.9,0.3,1.05)',
        }}>
          <ErrorBoundary label="la pantalla de nueva venta">
            <NewSale
              session={session}
              authUser={authUser}
              userDoc={userDoc}
              assistMode={isAssist ? {
                adminUid: assistMode.adminUid,
                adminName: assistMode.adminName,
                customerOrderId: pendingOrderId || null,
              } : undefined}
              initialLunchCommanda={pendingOrderCommanda}
              customerOrderId={!isAssist ? (pendingOrderId || null) : null}
              onCancel={() => { setNewSaleOpen(false); clearPendingOrder() }}
              onSaved={() => { setNewSaleOpen(false); clearPendingOrder() }}
            />
          </ErrorBoundary>
        </div>
      )}

      {historyOpen && (
        <MyHistoricalSales
          authUser={authUser}
          userDoc={userDoc}
          cashierUid={isAssist ? scopeUid : undefined}
          onClose={() => setHistoryOpen(false)}
          onReport={(sale) => setReportSale(sale)}
        />
      )}

      {editingTab && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 60, background: T.neutral[50],
          animation: 'slideUp 0.25s cubic-bezier(0.2,0.9,0.3,1.05)',
        }}>
          <ErrorBoundary label="la mesa">
            <NewSale
              session={session}
              authUser={authUser}
              userDoc={userDoc}
              tab={editingTab}
              assistMode={isAssist ? {
                adminUid: assistMode.adminUid,
                adminName: assistMode.adminName,
              } : undefined}
              onCancel={() => setEditingTab(null)}
              onSaved={() => setEditingTab(null)}
            />
          </ErrorBoundary>
        </div>
      )}

      {/* Burbujas de mesas abiertas — siempre visibles mientras haya turno */}
      <OpenTabsBubbles
        sessionId={session.id}
        onSelect={tab => setEditingTab(tab)}
      />

      {/* Panel "¿estás aburrida?" — productos sin precio en esta panadería */}
      {boredomOpen && (
        <MissingPricesPanel
          branchId={session.branchId}
          branchName={session.branchName}
          branches={branches}
          cashierName={session.cashierName}
          onClose={() => setBoredomOpen(false)}
        />
      )}

      {reportSale && (
        <ReportSaleModal
          sale={reportSale}
          authUser={authUser}
          userDoc={userDoc}
          onCancel={() => setReportSale(null)}
          onDone={() => setReportSale(null)}
        />
      )}

      {expenseOpen && (
        <CashExpenseScreen
          session={session}
          authUser={authUser}
          userDoc={userDoc}
          assistMode={assistMode}
          expenses={sessionExpenses}
          onCancel={() => setExpenseOpen(false)}
        />
      )}

      {incomeOpen && (
        <CashIncomeScreen
          session={session}
          authUser={authUser}
          userDoc={userDoc}
          assistMode={assistMode}
          incomes={sessionIncomes}
          debtors={debtors}
          onCancel={() => setIncomeOpen(false)}
        />
      )}

      {/* Overlay bloqueante: la cocinera está llamando a esta cajera.
          No se puede cerrar de otra forma, solo tocando "Voy en camino". */}
      {activeCall && (
        <KitchenCallOverlay
          call={activeCall}
          authUser={authUser}
          userDoc={userDoc}
        />
      )}
    </div>
    </>
  )
}

// ──────────────────────────────────────────────────────────────
// Barra superior del modo asistir. Solo se ve cuando el admin está
// asistiendo. Es la ÚNICA salida del modo (D: salida directa, sin
// confirmación). Queda sticky arriba; los overlays de venta (NewSale,
// burbujas) se montan encima cuando aplica.
// ──────────────────────────────────────────────────────────────
function AssistBar({ cashierName, branchName, onExit }) {
  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 30,
      background: T.copper[700], color: '#fff',
      padding: '10px 16px',
      display: 'flex', alignItems: 'center', gap: 10,
      boxShadow: '0 2px 10px rgba(0,0,0,0.22)',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', opacity: 0.85 }}>
          Estás asistiendo
        </div>
        <div style={{
          fontSize: 14.5, fontWeight: 800, letterSpacing: -0.2,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {cashierName || 'Cajera'}{branchName ? ` · ${branchName}` : ''}
        </div>
      </div>
      <button
        onClick={onExit}
        style={{
          padding: '9px 16px', borderRadius: 999,
          background: '#fff', color: T.copper[700],
          border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 13, fontWeight: 800, flexShrink: 0,
          boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
        }}
      >
        Salir de asistir
      </button>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Overlay bloqueante cuando la cocinera llama a la cajera.
// La cajera no puede interactuar con la app hasta confirmar.
// Vibra al aparecer y reintenta la vibración cada pocos segundos.
// ──────────────────────────────────────────────────────────────
function KitchenCallOverlay({ call, authUser, userDoc }) {
  const [busy, setBusy] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  // Vibración + sonido inmediato y ráfaga de recordatorios mientras
  // la cajera no atienda. Ambos van juntos para máxima atención.
  useEffect(() => {
    function pulse() {
      try { navigator.vibrate?.([300, 120, 300, 120, 500]) } catch {}
      try { playKitchenCallSound() } catch {}
    }
    pulse()
    const id = setInterval(pulse, 4500)
    return () => clearInterval(id)
  }, [call.id])

  async function handleConfirm() {
    if (busy) return
    setBusy(true)
    try {
      try { navigator.vibrate?.(0) } catch {}
      const cashierName = `${userDoc?.nombre || ''} ${userDoc?.apellido || ''}`.trim()
        || authUser?.email || 'Cajera'
      await acknowledgeKitchenCall(call.id, {
        byUid: authUser.uid,
        byName: cashierName,
      })
      setConfirmed(true)
      // El overlay desaparecerá solo cuando el watcher reciba el update.
      // Mientras tanto mostramos el flash de "Listo, vas en camino".
    } catch (err) {
      console.error('[kitchenCalls] acknowledge error:', err)
      setBusy(false)
      setConfirmed(false)
    }
  }

  const fromName = call.createdByName || 'Cocina'

  return createPortal((
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(20, 16, 12, 0.78)',
      backdropFilter: 'blur(4px)',
      WebkitBackdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 18,
      animation: 'kcOverlayIn 0.22s ease-out',
    }}>
      <div style={{
        width: '100%', maxWidth: 420,
        background: '#fff', borderRadius: 26,
        boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
        overflow: 'hidden',
        animation: 'kcCardIn 0.32s cubic-bezier(0.2,0.9,0.3,1.05)',
        position: 'relative',
      }}>
        <div style={{
          padding: '28px 24px 22px',
          background: 'linear-gradient(135deg, #FFE4D2 0%, #F0BFA0 100%)',
          textAlign: 'center',
          borderBottom: `1.5px solid ${T.copper[200]}`,
          position: 'relative',
          overflow: 'hidden',
        }}>
          {/* Halo pulsante detrás del icono */}
          <div style={{
            position: 'absolute',
            top: '50%', left: '50%',
            width: 180, height: 180,
            borderRadius: 999,
            background: 'rgba(255,255,255,0.5)',
            transform: 'translate(-50%, -55%)',
            animation: 'kcHalo 1.6s ease-out infinite',
            pointerEvents: 'none',
          }}/>
          <div style={{
            position: 'relative',
            width: 96, height: 96, borderRadius: 999,
            background: '#fff',
            margin: '0 auto 14px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: `0 10px 28px ${T.copper[500]}55`,
            animation: 'kcBell 0.9s ease-in-out infinite',
          }}>
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 3 C8.7 3 6 5.7 6 9 V13 L4 16 H20 L18 13 V9 C18 5.7 15.3 3 12 3 Z"
                stroke={T.copper[700]} strokeWidth="1.9" fill="none" strokeLinejoin="round"
              />
              <path
                d="M10 19 C10 20.1 10.9 21 12 21 C13.1 21 14 20.1 14 19"
                stroke={T.copper[700]} strokeWidth="1.9" fill="none" strokeLinecap="round"
              />
            </svg>
          </div>
          <div style={{
            position: 'relative',
            fontSize: 12, fontWeight: 900,
            color: T.copper[700], letterSpacing: 1.2,
            textTransform: 'uppercase',
          }}>
            Te llaman de cocina
          </div>
          <div style={{
            position: 'relative',
            fontSize: 26, fontWeight: 900,
            color: T.neutral[900], letterSpacing: -0.5,
            lineHeight: 1.15, marginTop: 6,
          }}>
            Por favor sube a cocina
          </div>
          <div style={{
            position: 'relative',
            fontSize: 13, color: T.copper[700], opacity: 0.85,
            marginTop: 8, fontWeight: 700,
          }}>
            {fromName} te necesita
          </div>
        </div>

        <div style={{ padding: '22px 22px 18px', textAlign: 'center' }}>
          <div style={{
            fontSize: 13.5, color: T.neutral[600], lineHeight: 1.55,
            marginBottom: 18,
          }}>
            La app está bloqueada hasta que confirmes. Toca el botón cuando vayas
            a subir para que la cocinera sepa que la viste.
          </div>

          <button
            onClick={handleConfirm}
            disabled={busy || confirmed}
            style={{
              width: '100%', padding: '18px',
              borderRadius: 16,
              background: confirmed ? T.ok : T.copper[500],
              color: '#fff',
              border: 'none',
              cursor: busy ? 'wait' : 'pointer',
              fontFamily: 'inherit',
              fontSize: 17, fontWeight: 900, letterSpacing: 0.3,
              boxShadow: confirmed
                ? `0 8px 20px ${T.ok}66`
                : `0 8px 22px ${T.copper[500]}66`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 10,
              transition: 'background 0.2s, box-shadow 0.2s',
            }}
          >
            {confirmed ? (
              <>
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                  <path d="M5 11 L9 15 L17 7" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Listo, ya vas en camino
              </>
            ) : busy ? (
              'Enviando...'
            ) : (
              <>
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                  <path d="M5 11 L9 15 L17 7" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Voy en camino
              </>
            )}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes kcOverlayIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes kcCardIn {
          from { opacity: 0; transform: scale(0.92) translateY(14px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes kcBell {
          0%, 100% { transform: rotate(0deg); }
          15%      { transform: rotate(-12deg); }
          30%      { transform: rotate(10deg); }
          45%      { transform: rotate(-8deg); }
          60%      { transform: rotate(6deg); }
          75%      { transform: rotate(-3deg); }
        }
        @keyframes kcHalo {
          0%   { transform: translate(-50%, -55%) scale(0.6); opacity: 0.7; }
          100% { transform: translate(-50%, -55%) scale(1.4); opacity: 0; }
        }
      `}</style>
    </div>
  ), document.body)
}

// ──────────────────────────────────────────────────────────────
// Fila de gasto en lista (la cajera SI ve montos: ella misma los digitó)
// ──────────────────────────────────────────────────────────────
function ExpenseRow({ expense, isLast }) {
  const time = expense.createdAt?.toDate?.()
  const timeStr = time
    ? time.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false })
    : '—'

  const statusColor = {
    pending: T.warn,
    approved: T.ok,
    rejected: T.bad,
  }[expense.status] || T.neutral[500]

  const statusLabel = {
    pending: 'Pendiente',
    approved: 'Aprobado',
    rejected: 'Rechazado',
  }[expense.status] || expense.status

  return (
    <div style={{
      padding: '12px 14px',
      borderBottom: isLast ? 'none' : `0.5px solid ${T.neutral[100]}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <div style={{
          fontSize: 12, fontWeight: 700, color: T.neutral[500],
          fontVariantNumeric: 'tabular-nums', minWidth: 42, flexShrink: 0,
        }}>
          {timeStr}
        </div>
        <div style={{
          flex: 1, minWidth: 0,
          fontSize: 13.5, fontWeight: 600, color: T.neutral[900],
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {expense.description}
        </div>
        <div style={{
          fontSize: 13.5, fontWeight: 700, color: T.neutral[800],
          fontVariantNumeric: 'tabular-nums', flexShrink: 0,
        }}>
          {fmtCOP(expense.amount)}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 52 }}>
        <span style={{
          fontSize: 10.5, fontWeight: 700, color: statusColor,
          background: statusColor + '15',
          padding: '2px 8px', borderRadius: 999,
          letterSpacing: 0.4, textTransform: 'uppercase',
        }}>
          {statusLabel}
        </span>
        {expense.recordedByRole === 'admin' && (
          <span style={{
            fontSize: 10, fontWeight: 700, color: '#7A5C00',
            background: '#FFF7E6', border: '1px solid #F4E0BC',
            padding: '2px 7px', borderRadius: 999,
            letterSpacing: 0.3, textTransform: 'uppercase',
          }}>
            👤 admin{expense.recordedByName ? ` · ${expense.recordedByName}` : ''}
          </span>
        )}
        {expense.status === 'rejected' && expense.reviewNote && (
          <span style={{
            fontSize: 11.5, color: T.bad, fontStyle: 'italic',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {expense.reviewNote}
          </span>
        )}
        {expense.photoUrl && (
          <a
            href={expense.photoUrl}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 11, color: T.copper[600], textDecoration: 'none', fontWeight: 600 }}
          >
            📎 Ver foto
          </a>
        )}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// PANTALLA: Gastos de caja del turno (estilo "Mis ventas")
// Pantalla completa: botón grande "Registrar nuevo gasto" + lista de los gastos
// del turno (la MISMA query por sessionId que ve el admin al cerrar). La cajera
// puede editar/eliminar los 'pending' y ve cuáles aún no han subido al servidor.
// El formulario de alta/edición es una hoja que se desliza desde abajo.
// ──────────────────────────────────────────────────────────────
function CashExpenseScreen({ session, authUser, userDoc, assistMode, expenses = [], onCancel }) {
  // null = solo lista | { editing: null } = nuevo | { editing: exp } = editar
  const [form, setForm] = useState(null)
  const [deletingId, setDeletingId] = useState(null)

  const unsyncedCount = expenses.filter(e => e._pendingWrite).length

  function handleDelete(id) {
    deleteCashExpense(id)
    setDeletingId(null)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 60,
      background: T.neutral[50],
      display: 'flex', flexDirection: 'column',
      animation: 'slideUp 0.25s cubic-bezier(0.2,0.9,0.3,1.05)',
    }}>
      {/* Header sticky con botón atrás */}
      <div style={{
        padding: '14px 16px', background: '#fff',
        borderBottom: `1px solid ${T.neutral[100]}`,
        display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
      }}>
        <button onClick={onCancel} aria-label="Volver" style={{
          width: 36, height: 36, borderRadius: 999, border: 'none',
          background: T.neutral[100], cursor: 'pointer', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M15 6 L9 12 L15 18" stroke={T.neutral[700]} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3 }}>
            Gastos de caja
          </div>
          <div style={{
            fontSize: 11, color: T.neutral[500],
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {session.branchName || `${userDoc?.nombre || ''} ${userDoc?.apellido || ''}`.trim()}
          </div>
        </div>
      </div>

      {/* Contenido scrollable */}
      <div style={{
        flex: 1, overflowY: 'auto', width: '100%',
        padding: '18px 16px 40px', maxWidth: 540, margin: '0 auto',
      }}>
        {/* Botón grande: registrar nuevo gasto */}
        <button
          onClick={() => setForm({ editing: null })}
          style={{
            width: '100%', padding: '18px', borderRadius: 18,
            background: T.copper[500], color: '#fff', border: 'none',
            cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 16, fontWeight: 800, letterSpacing: -0.2,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            boxShadow: '0 6px 18px rgba(184,122,86,0.4)', marginBottom: 16,
          }}
        >
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <circle cx="11" cy="11" r="9" stroke="#fff" strokeWidth="2" fill="none"/>
            <path d="M11 7 V15 M7 11 H15" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/>
          </svg>
          Registrar nuevo gasto
        </button>

        {/* Aviso clave: gastos que aún NO han subido al servidor. */}
        {unsyncedCount > 0 && (
          <div style={{
            padding: '11px 14px', borderRadius: 12, marginBottom: 16,
            background: '#FFF4DD', border: `1px solid #F0D699`,
            fontSize: 12.5, color: '#8A5E12', fontWeight: 500, lineHeight: 1.5,
          }}>
            ⏳ Tienes {unsyncedCount} gasto(s) sin subir. Conéctate y usa
            "Sincronizar ahora" antes de cerrar el turno para que el administrador
            los vea en el cierre.
          </div>
        )}

        {/* Lista de gastos del turno */}
        <div style={{
          fontSize: 12, fontWeight: 700, color: T.neutral[500],
          letterSpacing: 0.5, textTransform: 'uppercase', margin: '0 2px 8px',
        }}>
          Gastos de este turno ({expenses.length})
        </div>

        {expenses.length === 0 ? (
          <div style={{
            padding: '40px 20px', textAlign: 'center',
            color: T.neutral[400], fontSize: 13, lineHeight: 1.6,
            background: '#fff', borderRadius: 14, border: `1px solid ${T.neutral[100]}`,
          }}>
            Aún no hay gastos en este turno.<br/>
            Toca "Registrar nuevo gasto" para empezar.
          </div>
        ) : (
          <Card padding={0} style={{ overflow: 'hidden' }}>
            {expenses.map((exp, i) => (
              <ExpenseManageRow
                key={exp.id}
                expense={exp}
                isLast={i === expenses.length - 1}
                isEditing={false}
                confirmingDelete={deletingId === exp.id}
                onEdit={() => setForm({ editing: exp })}
                onAskDelete={() => setDeletingId(exp.id)}
                onCancelDelete={() => setDeletingId(null)}
                onConfirmDelete={() => handleDelete(exp.id)}
              />
            ))}
          </Card>
        )}
      </div>

      {/* Hoja deslizante: formulario de alta/edición */}
      {form && (
        <ExpenseFormSheet
          session={session}
          authUser={authUser}
          userDoc={userDoc}
          assistMode={assistMode}
          editing={form.editing}
          onClose={() => setForm(null)}
        />
      )}

      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); opacity: 0.9; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Hoja deslizante (bottom sheet) con el formulario de gasto.
//  - Alta: descripción + monto + foto opcional.
//  - Edición: solo descripción + monto (la foto se cambia borrando y recreando).
// Al guardar cierra la hoja; la lista del padre se refresca sola por el watcher.
// ──────────────────────────────────────────────────────────────
function ExpenseFormSheet({ session, authUser, userDoc, assistMode, editing, onClose }) {
  const isAssist = !!assistMode
  const isEdit = !!editing
  const [description, setDescription] = useState(editing?.description || '')
  const [amountStr, setAmountStr] = useState(editing?.amount != null ? String(editing.amount) : '')
  const [photoUrl, setPhotoUrl] = useState(null)
  const [photoBlob, setPhotoBlob] = useState(null)
  const [photoLocalPreview, setPhotoLocalPreview] = useState(null)
  const [photoOfflineQueued, setPhotoOfflineQueued] = useState(false)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoError, setPhotoError] = useState(null)
  const fileInputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    return () => {
      if (photoLocalPreview) URL.revokeObjectURL(photoLocalPreview)
    }
  }, [photoLocalPreview])

  const amount = Number(amountStr) || 0
  const valid = description.trim().length >= 3 && amount > 0 && !photoUploading

  async function handleFileSelected(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setPhotoError(null)
    setPhotoUploading(true)
    setPhotoOfflineQueued(false)
    if (photoLocalPreview) URL.revokeObjectURL(photoLocalPreview)
    setPhotoLocalPreview(null)
    setPhotoBlob(null)
    setPhotoUrl(null)

    let compressed = null
    try {
      compressed = await compressImage(file)
    } catch (err) {
      console.error(err)
      setPhotoError(err.message || 'No pudimos procesar la foto.')
      setPhotoUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    setPhotoBlob(compressed)
    setPhotoLocalPreview(URL.createObjectURL(compressed))

    const online = typeof navigator !== 'undefined' ? navigator.onLine : true
    if (!online) {
      setPhotoOfflineQueued(true)
      setPhotoUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    try {
      const result = await uploadToImageBB(compressed)
      setPhotoUrl(result.url)
      setPhotoOfflineQueued(false)
    } catch (err) {
      console.warn('[CashExpense] upload falló, queda en cola offline:', err?.message)
      setPhotoOfflineQueued(true)
    } finally {
      setPhotoUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleSave() {
    if (!valid || busy) return

    // EDICIÓN de un gasto pendiente: solo descripción + monto.
    if (isEdit) {
      setBusy(true); setError(null)
      try {
        updateCashExpense(editing.id, { description, amount })
        onClose()
      } catch (err) {
        console.error(err)
        setError('No pudimos guardar los cambios. Intenta de nuevo.')
        setBusy(false)
      }
      return
    }

    setBusy(true); setError(null)
    try {
      // Asistiendo: el gasto pertenece al turno de la CAJERA (su caja es la que
      // se reduce), por eso cashierUid/Name = la cajera dueña del turno. La
      // traza de que lo hizo el admin va aparte (recordedBy*). Sin asistir, es
      // la cajera misma.
      const cashierUid = isAssist ? (session.cashierUid || authUser.uid) : authUser.uid
      const cashierName = isAssist
        ? (session.cashierName || 'Cajera')
        : (`${userDoc?.nombre || ''} ${userDoc?.apellido || ''}`.trim() || authUser.email)

      // Caso B (foto offline): pre-generar localId para que el doc nazca con
      // photoLocalId + photoStatus='pending' desde la creacion. Cuando vuelva
      // la red el worker hara updateDoc para grabar photoUrl + photoStatus.
      let photoLocalId = null
      if (!photoUrl && photoBlob) {
        photoLocalId = makePhotoLocalId()
      }

      const expenseId = await createCashExpense({
        sessionId: session.id,
        branchId: session.branchId,
        branchName: session.branchName,
        cashierUid,
        cashierName,
        description,
        amount,
        photoUrl: photoUrl || undefined,
        photoLocalId: photoLocalId || undefined,
        ...(isAssist ? {
          recordedByUid: authUser.uid,
          recordedByName: assistMode.adminName,
          recordedByRole: 'admin',
        } : {}),
      })

      if (photoLocalId && photoBlob && expenseId) {
        try {
          await enqueuePhoto(
            photoBlob,
            { collection: 'cashExpenses', docId: expenseId },
            photoLocalId,
          )
        } catch (queueErr) {
          console.warn('[CashExpense] no se pudo encolar la foto offline:', queueErr)
        }
      }
      // Listo: el gasto aparece de una vez en la lista del padre (watcher live).
      onClose()
    } catch (err) {
      console.error(err)
      setError('No pudimos guardar el gasto. Intenta de nuevo.')
      setBusy(false)
    }
  }

  return (
    <div
      onClick={busy ? undefined : onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 80,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 480, background: '#fff',
        borderTopLeftRadius: 22, borderTopRightRadius: 22,
        maxHeight: '92vh', overflowY: 'auto',
        padding: '22px 20px 24px',
        animation: 'slideUp 0.25s cubic-bezier(0.2,0.9,0.3,1.05)',
      }}>
        <div style={{ fontSize: 19, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3, marginBottom: 4 }}>
          {isEdit ? 'Editar gasto' : 'Registrar nuevo gasto'}
        </div>
        <div style={{ fontSize: 12.5, color: T.neutral[500], marginBottom: 16 }}>
          {isEdit
            ? 'Corrige la descripción o el monto. Sigue pendiente de aprobación.'
            : 'Quedará pendiente de aprobación del administrador.'}
        </div>

        <ExpenseTextField
          label="¿Para qué fue?"
          value={description}
          onChange={setDescription}
          placeholder="Ej: Compra de empaques al proveedor"
          autoFocus
          disabled={busy}
        />

        <ExpenseNumberField
          label="Monto"
          value={amountStr}
          onChange={setAmountStr}
          disabled={busy}
        />

        {/* Foto opcional — solo al agregar. En edición no se cambia la foto
            (si la quiere cambiar, elimina el gasto y lo vuelve a crear). */}
        {!isEdit && (
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: T.neutral[600], display: 'block', marginBottom: 6 }}>
            Foto del recibo (opcional)
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileSelected}
            style={{ display: 'none' }}
          />
          {!photoUrl && !photoLocalPreview && !photoUploading && !photoError && (
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                width: '100%', padding: '14px', borderRadius: 12,
                background: '#fff', color: T.neutral[600],
                border: `1.5px dashed ${T.neutral[300]}`,
                cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 13, fontWeight: 600,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              📸 Adjuntar foto
            </button>
          )}
          {photoUploading && (
            <div style={{
              padding: '14px', borderRadius: 12, textAlign: 'center',
              background: T.neutral[50], border: `1.5px solid ${T.neutral[200]}`,
              fontSize: 13, color: T.neutral[600], fontWeight: 600,
            }}>
              Subiendo foto...
            </div>
          )}
          {photoError && !photoUploading && (
            <div style={{
              padding: '11px 14px', borderRadius: 12,
              background: '#FBE9E5', border: `1px solid #F0C8BE`,
              fontSize: 12.5, color: T.bad, fontWeight: 500,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            }}>
              <span style={{ flex: 1 }}>{photoError}</span>
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{
                  padding: '6px 12px', borderRadius: 8,
                  background: T.bad, color: '#fff', border: 'none',
                  fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Reintentar
              </button>
            </div>
          )}
          {(photoUrl || photoLocalPreview) && !photoUploading && (
            <div style={{
              borderRadius: 12, overflow: 'hidden',
              border: `1.5px solid ${(photoUrl ? T.ok : T.warn) + '66'}`,
              background: '#fff',
            }}>
              <div style={{ position: 'relative' }}>
                <img
                  src={photoUrl || photoLocalPreview}
                  alt="Recibo"
                  style={{
                    display: 'block', width: '100%', maxHeight: 180,
                    objectFit: 'contain', background: T.neutral[900],
                  }}
                />
                {!photoUrl && (
                  <div style={{
                    position: 'absolute', top: 6, right: 6,
                    background: T.warn, color: '#fff',
                    padding: '3px 9px', borderRadius: 999,
                    fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3,
                  }}>
                    ⏳ Pendiente
                  </div>
                )}
              </div>
              {!photoUrl && photoOfflineQueued && (
                <div style={{
                  padding: '7px 12px',
                  background: '#FFF7E6',
                  borderTop: `1px solid #F4E0BC`,
                  fontSize: 11.5, color: T.warn, fontWeight: 600,
                }}>
                  Sin conexion · subira al volver la red.
                </div>
              )}
              <button
                onClick={() => {
                  setPhotoUrl(null)
                  setPhotoBlob(null)
                  setPhotoOfflineQueued(false)
                  if (photoLocalPreview) URL.revokeObjectURL(photoLocalPreview)
                  setPhotoLocalPreview(null)
                }}
                style={{
                  width: '100%', padding: '8px',
                  background: 'transparent', border: 'none',
                  borderTop: `1px solid ${T.neutral[100]}`,
                  cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 12, fontWeight: 600, color: T.neutral[600],
                }}
              >
                Quitar foto
              </button>
            </div>
          )}
        </div>
        )}

        <div style={{
          padding: '11px 14px', borderRadius: 12,
          background: '#FFF7E6', border: `1px solid #F4E0BC`,
          fontSize: 12.5, color: T.warn, fontWeight: 500, lineHeight: 1.5,
          marginBottom: 14,
        }}>
          ⚠ Este monto reduce tu caja del turno. El administrador lo aprueba al cerrar.
        </div>

        {error && <ErrorBox text={error} />}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} disabled={busy} style={btnSecondary()}>Cancelar</button>
          <button
            onClick={handleSave}
            disabled={!valid || busy}
            style={{
              ...btnPrimary(valid && !busy ? T.copper[500] : T.neutral[200]),
              flex: 1.4,
              color: valid && !busy ? '#fff' : T.neutral[400],
              cursor: valid && !busy ? 'pointer' : 'not-allowed',
              boxShadow: valid && !busy ? '0 3px 10px rgba(184,122,86,0.3)' : 'none',
            }}
          >
            {busy ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Registrar gasto'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Fila de gasto dentro del modal de gestión. Muestra estado, indicador de
// sincronización (subido / sin subir) y, si sigue 'pending', botones de
// editar y eliminar (con confirmación inline).
function ExpenseManageRow({
  expense, isLast, isEditing, confirmingDelete,
  onEdit, onAskDelete, onCancelDelete, onConfirmDelete,
}) {
  const time = expense.createdAt?.toDate?.()
  const timeStr = time
    ? time.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false })
    : '—'

  const statusColor = { pending: T.warn, approved: T.ok, rejected: T.bad }[expense.status] || T.neutral[500]
  const statusLabel = { pending: 'Pendiente', approved: 'Aprobado', rejected: 'Rechazado' }[expense.status] || expense.status
  const canManage = expense.status === 'pending'

  return (
    <div style={{
      padding: '12px 14px',
      borderBottom: isLast ? 'none' : `0.5px solid ${T.neutral[100]}`,
      background: isEditing ? T.copper[50] : 'transparent',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <div style={{
          fontSize: 12, fontWeight: 700, color: T.neutral[500],
          fontVariantNumeric: 'tabular-nums', minWidth: 42, flexShrink: 0,
        }}>
          {timeStr}
        </div>
        <div style={{
          flex: 1, minWidth: 0,
          fontSize: 13.5, fontWeight: 600, color: T.neutral[900],
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {expense.description}
        </div>
        <div style={{
          fontSize: 13.5, fontWeight: 700, color: T.neutral[800],
          fontVariantNumeric: 'tabular-nums', flexShrink: 0,
        }}>
          {fmtCOP(expense.amount)}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 52, flexWrap: 'wrap' }}>
        <span style={{
          fontSize: 10.5, fontWeight: 700, color: statusColor,
          background: statusColor + '15',
          padding: '2px 8px', borderRadius: 999,
          letterSpacing: 0.4, textTransform: 'uppercase',
        }}>
          {statusLabel}
        </span>
        {/* Indicador de sincronización: la señal clave para que NADA se pierda. */}
        {expense._pendingWrite ? (
          <span style={{
            fontSize: 10.5, fontWeight: 700, color: '#8A5E12',
            background: '#FFF4DD', border: '1px solid #F0D699',
            padding: '2px 8px', borderRadius: 999,
          }}>
            ⏳ Sin subir
          </span>
        ) : (
          <span style={{
            fontSize: 10.5, fontWeight: 700, color: T.ok,
            background: T.ok + '15',
            padding: '2px 8px', borderRadius: 999,
          }}>
            ✓ Subido
          </span>
        )}
        {expense.recordedByRole === 'admin' && (
          <span style={{
            fontSize: 10, fontWeight: 700, color: '#7A5C00',
            background: '#FFF7E6', border: '1px solid #F4E0BC',
            padding: '2px 7px', borderRadius: 999,
            letterSpacing: 0.3, textTransform: 'uppercase',
          }}>
            👤 admin{expense.recordedByName ? ` · ${expense.recordedByName}` : ''}
          </span>
        )}
        {expense.photoUrl && (
          <a href={expense.photoUrl} target="_blank" rel="noreferrer"
            style={{ fontSize: 11, color: T.copper[600], textDecoration: 'none', fontWeight: 600 }}>
            📎 Ver foto
          </a>
        )}
      </div>

      {canManage && (
        <div style={{ marginLeft: 52, marginTop: 8 }}>
          {confirmingDelete ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: T.bad, fontWeight: 600 }}>¿Eliminar este gasto?</span>
              <button onClick={onConfirmDelete} style={{
                padding: '5px 12px', borderRadius: 8, background: T.bad, color: '#fff',
                border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
              }}>Sí, eliminar</button>
              <button onClick={onCancelDelete} style={{
                padding: '5px 12px', borderRadius: 8, background: T.neutral[100], color: T.neutral[700],
                border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
              }}>No</button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={onEdit} style={{
                padding: '5px 12px', borderRadius: 8, background: '#fff', color: T.copper[600],
                border: `1.5px solid ${T.copper[200]}`, cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 12, fontWeight: 700,
              }}>✏️ Editar</button>
              <button onClick={onAskDelete} style={{
                padding: '5px 12px', borderRadius: 8, background: '#fff', color: T.bad,
                border: `1.5px solid #F0C8BE`, cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 12, fontWeight: 700,
              }}>🗑 Eliminar</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ExpenseTextField({ label, value, onChange, placeholder, autoFocus, disabled }) {
  const [focused, setFocused] = useState(false)
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: T.neutral[600], display: 'block', marginBottom: 6 }}>
        {label}
      </label>
      <div style={{
        border: `1.5px solid ${focused ? T.copper[400] : T.neutral[200]}`,
        borderRadius: 12, background: '#fff', transition: 'border-color 0.12s',
      }}>
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            width: '100%', padding: '12px 14px', border: 'none', outline: 'none',
            fontFamily: 'inherit', fontSize: 14.5, color: T.neutral[900],
            background: 'transparent', borderRadius: 12,
            opacity: disabled ? 0.6 : 1,
          }}
        />
      </div>
    </div>
  )
}

function ExpenseNumberField({ label, value, onChange, disabled }) {
  const [focused, setFocused] = useState(false)
  function sanitize(raw) {
    return raw.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '')
  }
  const display = value === '0' ? '' : value
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: T.neutral[600], display: 'block', marginBottom: 6 }}>
        {label}
      </label>
      <div style={{
        border: `1.5px solid ${focused ? T.copper[400] : T.neutral[200]}`,
        borderRadius: 12, background: '#fff', transition: 'border-color 0.12s',
        display: 'flex', alignItems: 'center',
      }}>
        <span style={{ paddingLeft: 14, color: T.neutral[500], fontSize: 15, fontWeight: 600 }}>$</span>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={display}
          onChange={e => onChange(sanitize(e.target.value))}
          placeholder="0"
          disabled={disabled}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            width: '100%', padding: '12px 14px 12px 8px', border: 'none', outline: 'none',
            fontFamily: 'inherit', fontSize: 16, color: T.neutral[900],
            background: 'transparent', borderRadius: 12,
            opacity: disabled ? 0.6 : 1,
            fontVariantNumeric: 'tabular-nums', fontWeight: 600,
          }}
        />
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
// INGRESOS DE CAJA (espejo de los gastos)
// Plata que ENTRA a la caja fuera de las ventas: abono a una deuda, préstamo,
// devolución, etc. Mismo flujo que los gastos (pending → admin aprueba al
// cerrar), misma cola offline. Diferencias: SUMA al cuadre y puede enlazarse a
// un deudor para que el admin abone esa deuda al aprobar.
// ══════════════════════════════════════════════════════════════
function CashIncomeScreen({ session, authUser, userDoc, assistMode, incomes = [], debtors = [], onCancel }) {
  const [form, setForm] = useState(null) // null | { editing: null } | { editing: inc }
  const [deletingId, setDeletingId] = useState(null)

  const unsyncedCount = incomes.filter(e => e._pendingWrite).length

  function handleDelete(id) {
    deleteCashIncome(id)
    setDeletingId(null)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 60,
      background: T.neutral[50],
      display: 'flex', flexDirection: 'column',
      animation: 'slideUp 0.25s cubic-bezier(0.2,0.9,0.3,1.05)',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 16px', background: '#fff',
        borderBottom: `1px solid ${T.neutral[100]}`,
        display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
      }}>
        <button onClick={onCancel} aria-label="Volver" style={{
          width: 36, height: 36, borderRadius: 999, border: 'none',
          background: T.neutral[100], cursor: 'pointer', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M15 6 L9 12 L15 18" stroke={T.neutral[700]} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3 }}>
            Ingresos de caja
          </div>
          <div style={{
            fontSize: 11, color: T.neutral[500],
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {session.branchName || `${userDoc?.nombre || ''} ${userDoc?.apellido || ''}`.trim()}
          </div>
        </div>
      </div>

      {/* Contenido */}
      <div style={{
        flex: 1, overflowY: 'auto', width: '100%',
        padding: '18px 16px 40px', maxWidth: 540, margin: '0 auto',
      }}>
        <button
          onClick={() => setForm({ editing: null })}
          style={{
            width: '100%', padding: '18px', borderRadius: 18,
            background: T.ok, color: '#fff', border: 'none',
            cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 16, fontWeight: 800, letterSpacing: -0.2,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            boxShadow: '0 6px 18px rgba(74,143,94,0.35)', marginBottom: 16,
          }}
        >
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <circle cx="11" cy="11" r="9" stroke="#fff" strokeWidth="2" fill="none"/>
            <path d="M11 7 V15 M7 11 H15" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/>
          </svg>
          Registrar nuevo ingreso
        </button>

        {unsyncedCount > 0 && (
          <div style={{
            padding: '11px 14px', borderRadius: 12, marginBottom: 16,
            background: '#FFF4DD', border: `1px solid #F0D699`,
            fontSize: 12.5, color: '#8A5E12', fontWeight: 500, lineHeight: 1.5,
          }}>
            ⏳ Tienes {unsyncedCount} ingreso(s) sin subir. Conéctate y usa
            "Sincronizar ahora" antes de cerrar el turno para que el administrador
            los vea en el cierre.
          </div>
        )}

        <div style={{
          fontSize: 12, fontWeight: 700, color: T.neutral[500],
          letterSpacing: 0.5, textTransform: 'uppercase', margin: '0 2px 8px',
        }}>
          Ingresos de este turno ({incomes.length})
        </div>

        {incomes.length === 0 ? (
          <div style={{
            padding: '40px 20px', textAlign: 'center',
            color: T.neutral[400], fontSize: 13, lineHeight: 1.6,
            background: '#fff', borderRadius: 14, border: `1px solid ${T.neutral[100]}`,
          }}>
            Aún no hay ingresos en este turno.<br/>
            Toca "Registrar nuevo ingreso" para empezar.
          </div>
        ) : (
          <Card padding={0} style={{ overflow: 'hidden' }}>
            {incomes.map((inc, i) => (
              <IncomeManageRow
                key={inc.id}
                income={inc}
                isLast={i === incomes.length - 1}
                confirmingDelete={deletingId === inc.id}
                onEdit={() => setForm({ editing: inc })}
                onAskDelete={() => setDeletingId(inc.id)}
                onCancelDelete={() => setDeletingId(null)}
                onConfirmDelete={() => handleDelete(inc.id)}
              />
            ))}
          </Card>
        )}
      </div>

      {form && (
        <IncomeFormSheet
          session={session}
          authUser={authUser}
          userDoc={userDoc}
          assistMode={assistMode}
          editing={form.editing}
          debtors={debtors}
          onClose={() => setForm(null)}
        />
      )}

      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); opacity: 0.9; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

function IncomeFormSheet({ session, authUser, userDoc, assistMode, editing, debtors = [], onClose }) {
  const isAssist = !!assistMode
  const isEdit = !!editing
  const [description, setDescription] = useState(editing?.description || '')
  const [amountStr, setAmountStr] = useState(editing?.amount != null ? String(editing.amount) : '')
  const [debtor, setDebtor] = useState(
    editing?.debtorId ? { id: editing.debtorId, name: editing.debtorName } : null
  )
  const [photoUrl, setPhotoUrl] = useState(null)
  const [photoBlob, setPhotoBlob] = useState(null)
  const [photoLocalPreview, setPhotoLocalPreview] = useState(null)
  const [photoOfflineQueued, setPhotoOfflineQueued] = useState(false)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoError, setPhotoError] = useState(null)
  const fileInputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    return () => { if (photoLocalPreview) URL.revokeObjectURL(photoLocalPreview) }
  }, [photoLocalPreview])

  const amount = Number(amountStr) || 0
  const valid = description.trim().length >= 3 && amount > 0 && !photoUploading

  async function handleFileSelected(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setPhotoError(null)
    setPhotoUploading(true)
    setPhotoOfflineQueued(false)
    if (photoLocalPreview) URL.revokeObjectURL(photoLocalPreview)
    setPhotoLocalPreview(null)
    setPhotoBlob(null)
    setPhotoUrl(null)

    let compressed = null
    try {
      compressed = await compressImage(file)
    } catch (err) {
      console.error(err)
      setPhotoError(err.message || 'No pudimos procesar la foto.')
      setPhotoUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    setPhotoBlob(compressed)
    setPhotoLocalPreview(URL.createObjectURL(compressed))

    const online = typeof navigator !== 'undefined' ? navigator.onLine : true
    if (!online) {
      setPhotoOfflineQueued(true)
      setPhotoUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    try {
      const result = await uploadToImageBB(compressed)
      setPhotoUrl(result.url)
      setPhotoOfflineQueued(false)
    } catch (err) {
      console.warn('[CashIncome] upload falló, queda en cola offline:', err?.message)
      setPhotoOfflineQueued(true)
    } finally {
      setPhotoUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleSave() {
    if (!valid || busy) return

    if (isEdit) {
      setBusy(true); setError(null)
      try {
        updateCashIncome(editing.id, { description, amount })
        onClose()
      } catch (err) {
        console.error(err)
        setError('No pudimos guardar los cambios. Intenta de nuevo.')
        setBusy(false)
      }
      return
    }

    setBusy(true); setError(null)
    try {
      const cashierUid = isAssist ? (session.cashierUid || authUser.uid) : authUser.uid
      const cashierName = isAssist
        ? (session.cashierName || 'Cajera')
        : (`${userDoc?.nombre || ''} ${userDoc?.apellido || ''}`.trim() || authUser.email)

      let photoLocalId = null
      if (!photoUrl && photoBlob) photoLocalId = makePhotoLocalId()

      const incomeId = await createCashIncome({
        sessionId: session.id,
        branchId: session.branchId,
        branchName: session.branchName,
        cashierUid,
        cashierName,
        description,
        amount,
        debtorId: debtor?.id || undefined,
        debtorName: debtor?.name || undefined,
        photoUrl: photoUrl || undefined,
        photoLocalId: photoLocalId || undefined,
        ...(isAssist ? {
          recordedByUid: authUser.uid,
          recordedByName: assistMode.adminName,
          recordedByRole: 'admin',
        } : {}),
      })

      if (photoLocalId && photoBlob && incomeId) {
        try {
          await enqueuePhoto(photoBlob, { collection: 'cashIncomes', docId: incomeId }, photoLocalId)
        } catch (queueErr) {
          console.warn('[CashIncome] no se pudo encolar la foto offline:', queueErr)
        }
      }
      onClose()
    } catch (err) {
      console.error(err)
      setError('No pudimos guardar el ingreso. Intenta de nuevo.')
      setBusy(false)
    }
  }

  return (
    <div
      onClick={busy ? undefined : onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 80,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 480, background: '#fff',
        borderTopLeftRadius: 22, borderTopRightRadius: 22,
        maxHeight: '92vh', overflowY: 'auto',
        padding: '22px 20px 24px',
        animation: 'slideUp 0.25s cubic-bezier(0.2,0.9,0.3,1.05)',
      }}>
        <div style={{ fontSize: 19, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3, marginBottom: 4 }}>
          {isEdit ? 'Editar ingreso' : 'Registrar nuevo ingreso'}
        </div>
        <div style={{ fontSize: 12.5, color: T.neutral[500], marginBottom: 16 }}>
          {isEdit
            ? 'Corrige la descripción o el monto. Sigue pendiente de aprobación.'
            : 'Quedará pendiente de aprobación del administrador.'}
        </div>

        <ExpenseTextField
          label="¿De qué fue el ingreso?"
          value={description}
          onChange={setDescription}
          placeholder="Ej: Abono de Pedro a su deuda"
          autoFocus
          disabled={busy}
        />

        <ExpenseNumberField
          label="Monto"
          value={amountStr}
          onChange={setAmountStr}
          disabled={busy}
        />

        {/* Enlace opcional a un deudor (abono a deuda). Solo al crear. */}
        {!isEdit && (
          <DebtorPicker
            debtors={debtors}
            selected={debtor}
            onSelect={setDebtor}
            disabled={busy}
          />
        )}
        {isEdit && editing?.debtorName && (
          <div style={{
            marginBottom: 12, padding: '10px 12px', borderRadius: 12,
            background: T.ok + '12', border: `1px solid ${T.ok}40`,
            fontSize: 12.5, color: T.neutral[700],
          }}>
            Abono a la deuda de <b>{editing.debtorName}</b>
          </div>
        )}

        {/* Foto opcional — solo al crear */}
        {!isEdit && (
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: T.neutral[600], display: 'block', marginBottom: 6 }}>
            Foto del comprobante (opcional)
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileSelected}
            style={{ display: 'none' }}
          />
          {!photoUrl && !photoLocalPreview && !photoUploading && !photoError && (
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                width: '100%', padding: '14px', borderRadius: 12,
                background: '#fff', color: T.neutral[600],
                border: `1.5px dashed ${T.neutral[300]}`,
                cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 13, fontWeight: 600,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              📸 Adjuntar foto
            </button>
          )}
          {photoUploading && (
            <div style={{
              padding: '14px', borderRadius: 12, textAlign: 'center',
              background: T.neutral[50], border: `1.5px solid ${T.neutral[200]}`,
              fontSize: 13, color: T.neutral[600], fontWeight: 600,
            }}>
              Subiendo foto...
            </div>
          )}
          {photoError && !photoUploading && (
            <div style={{
              padding: '11px 14px', borderRadius: 12,
              background: '#FBE9E5', border: `1px solid #F0C8BE`,
              fontSize: 12.5, color: T.bad, fontWeight: 500,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            }}>
              <span style={{ flex: 1 }}>{photoError}</span>
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{
                  padding: '6px 12px', borderRadius: 8,
                  background: T.bad, color: '#fff', border: 'none',
                  fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Reintentar
              </button>
            </div>
          )}
          {(photoUrl || photoLocalPreview) && !photoUploading && (
            <div style={{
              borderRadius: 12, overflow: 'hidden',
              border: `1.5px solid ${(photoUrl ? T.ok : T.warn) + '66'}`,
              background: '#fff',
            }}>
              <div style={{ position: 'relative' }}>
                <img
                  src={photoUrl || photoLocalPreview}
                  alt="Comprobante"
                  style={{
                    display: 'block', width: '100%', maxHeight: 180,
                    objectFit: 'contain', background: T.neutral[900],
                  }}
                />
                {!photoUrl && (
                  <div style={{
                    position: 'absolute', top: 6, right: 6,
                    background: T.warn, color: '#fff',
                    padding: '3px 9px', borderRadius: 999,
                    fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3,
                  }}>
                    ⏳ Pendiente
                  </div>
                )}
              </div>
              {!photoUrl && photoOfflineQueued && (
                <div style={{
                  padding: '7px 12px',
                  background: '#FFF7E6',
                  borderTop: `1px solid #F4E0BC`,
                  fontSize: 11.5, color: T.warn, fontWeight: 600,
                }}>
                  Sin conexion · subira al volver la red.
                </div>
              )}
              <button
                onClick={() => {
                  setPhotoUrl(null)
                  setPhotoBlob(null)
                  setPhotoOfflineQueued(false)
                  if (photoLocalPreview) URL.revokeObjectURL(photoLocalPreview)
                  setPhotoLocalPreview(null)
                }}
                style={{
                  width: '100%', padding: '8px',
                  background: 'transparent', border: 'none',
                  borderTop: `1px solid ${T.neutral[100]}`,
                  cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 12, fontWeight: 600, color: T.neutral[600],
                }}
              >
                Quitar foto
              </button>
            </div>
          )}
        </div>
        )}

        <div style={{
          padding: '11px 14px', borderRadius: 12,
          background: T.ok + '12', border: `1px solid ${T.ok}40`,
          fontSize: 12.5, color: '#2E6B43', fontWeight: 500, lineHeight: 1.5,
          marginBottom: 14,
        }}>
          ✓ Este monto suma a tu caja del turno. El administrador lo aprueba al cerrar
          {debtor ? `, y abonará la deuda de ${debtor.name}.` : '.'}
        </div>

        {error && <ErrorBox text={error} />}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} disabled={busy} style={btnSecondary()}>Cancelar</button>
          <button
            onClick={handleSave}
            disabled={!valid || busy}
            style={{
              ...btnPrimary(valid && !busy ? T.ok : T.neutral[200]),
              flex: 1.4,
              color: valid && !busy ? '#fff' : T.neutral[400],
              cursor: valid && !busy ? 'pointer' : 'not-allowed',
              boxShadow: valid && !busy ? '0 3px 10px rgba(74,143,94,0.3)' : 'none',
            }}
          >
            {busy ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Registrar ingreso'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Selector de deudor para enlazar un abono. Autocompleta sobre deudores
// existentes; si la persona no está, simplemente no se enlaza (el ingreso se
// registra igual con su descripción). El abono a la deuda lo aplica el admin
// al aprobar el ingreso en el cierre.
function DebtorPicker({ debtors, selected, onSelect, disabled }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const list = useMemo(() => {
    const active = (debtors || []).filter(d => !d.mergedInto)
    const q = normalizeName(query)
    if (!q) return active.slice(0, 6)
    return active.filter(d => normalizeName(d.name).includes(q)).slice(0, 8)
  }, [debtors, query])

  if (selected) {
    return (
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: T.neutral[600], display: 'block', marginBottom: 6 }}>
          Abono a la deuda de
        </label>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '11px 14px', borderRadius: 12,
          background: T.ok + '12', border: `1.5px solid ${T.ok}55`,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.neutral[900] }}>{selected.name}</div>
            {selected.totalOwed != null && (
              <div style={{ fontSize: 11.5, color: T.neutral[500], marginTop: 1 }}>
                Debe {fmtCOP(selected.totalOwed)}
              </div>
            )}
          </div>
          <button onClick={() => { onSelect(null); setQuery('') }} disabled={disabled} style={{
            padding: '6px 12px', borderRadius: 8, background: '#fff', color: T.neutral[600],
            border: `1px solid ${T.neutral[200]}`, cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 12, fontWeight: 700,
          }}>
            Quitar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: T.neutral[600], display: 'block', marginBottom: 6 }}>
        ¿Es abono a una deuda? (opcional)
      </label>
      <div style={{
        border: `1.5px solid ${open ? T.ok : T.neutral[200]}`,
        borderRadius: 12, background: '#fff',
      }}>
        <input
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder="Busca el deudor (déjalo vacío si no aplica)"
          disabled={disabled}
          style={{
            width: '100%', padding: '12px 14px', border: 'none', outline: 'none',
            fontFamily: 'inherit', fontSize: 14, color: T.neutral[900],
            background: 'transparent', borderRadius: 12,
          }}
        />
      </div>
      {open && list.length > 0 && (
        <div style={{
          marginTop: 6, border: `1px solid ${T.neutral[200]}`, borderRadius: 12,
          background: '#fff', overflow: 'hidden', maxHeight: 200, overflowY: 'auto',
        }}>
          {list.map((d, i) => (
            <button
              key={d.id}
              onClick={() => { onSelect({ id: d.id, name: d.name, totalOwed: computeDebtorOwed(d) }); setOpen(false) }}
              style={{
                width: '100%', padding: '10px 14px', textAlign: 'left',
                background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                borderBottom: i < list.length - 1 ? `0.5px solid ${T.neutral[100]}` : 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
              }}
            >
              <span style={{ fontSize: 13.5, fontWeight: 600, color: T.neutral[900] }}>{d.name}</span>
              <span style={{ fontSize: 11.5, color: T.neutral[500], fontVariantNumeric: 'tabular-nums' }}>
                debe {fmtCOP(computeDebtorOwed(d))}
              </span>
            </button>
          ))}
        </div>
      )}
      {open && query.trim() && list.length === 0 && (
        <div style={{ marginTop: 6, fontSize: 11.5, color: T.neutral[500], padding: '0 4px' }}>
          No está en la lista de deudores. El ingreso se registra igual con la descripción.
        </div>
      )}
    </div>
  )
}

function IncomeManageRow({ income, isLast, confirmingDelete, onEdit, onAskDelete, onCancelDelete, onConfirmDelete }) {
  const time = income.createdAt?.toDate?.()
  const timeStr = time
    ? time.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false })
    : '—'
  const statusColor = { pending: T.warn, approved: T.ok, rejected: T.bad }[income.status] || T.neutral[500]
  const statusLabel = { pending: 'Pendiente', approved: 'Aprobado', rejected: 'Rechazado' }[income.status] || income.status
  const canManage = income.status === 'pending'

  return (
    <div style={{
      padding: '12px 14px',
      borderBottom: isLast ? 'none' : `0.5px solid ${T.neutral[100]}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <div style={{
          fontSize: 12, fontWeight: 700, color: T.neutral[500],
          fontVariantNumeric: 'tabular-nums', minWidth: 42, flexShrink: 0,
        }}>
          {timeStr}
        </div>
        <div style={{
          flex: 1, minWidth: 0,
          fontSize: 13.5, fontWeight: 600, color: T.neutral[900],
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {income.description}
        </div>
        <div style={{
          fontSize: 13.5, fontWeight: 700, color: T.ok,
          fontVariantNumeric: 'tabular-nums', flexShrink: 0,
        }}>
          +{fmtCOP(income.amount)}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 52, flexWrap: 'wrap' }}>
        <span style={{
          fontSize: 10.5, fontWeight: 700, color: statusColor,
          background: statusColor + '15',
          padding: '2px 8px', borderRadius: 999,
          letterSpacing: 0.4, textTransform: 'uppercase',
        }}>
          {statusLabel}
        </span>
        {income.debtorName && (
          <span style={{
            fontSize: 10.5, fontWeight: 700, color: '#2E6B43',
            background: T.ok + '15', padding: '2px 8px', borderRadius: 999,
          }}>
            🤝 {income.debtorName}
          </span>
        )}
        {income._pendingWrite ? (
          <span style={{
            fontSize: 10.5, fontWeight: 700, color: '#8A5E12',
            background: '#FFF4DD', border: '1px solid #F0D699',
            padding: '2px 8px', borderRadius: 999,
          }}>
            ⏳ Sin subir
          </span>
        ) : (
          <span style={{
            fontSize: 10.5, fontWeight: 700, color: T.ok,
            background: T.ok + '15', padding: '2px 8px', borderRadius: 999,
          }}>
            ✓ Subido
          </span>
        )}
        {income.recordedByRole === 'admin' && (
          <span style={{
            fontSize: 10, fontWeight: 700, color: '#7A5C00',
            background: '#FFF7E6', border: '1px solid #F4E0BC',
            padding: '2px 7px', borderRadius: 999,
            letterSpacing: 0.3, textTransform: 'uppercase',
          }}>
            👤 admin{income.recordedByName ? ` · ${income.recordedByName}` : ''}
          </span>
        )}
        {income.photoUrl && (
          <a href={income.photoUrl} target="_blank" rel="noreferrer"
            style={{ fontSize: 11, color: T.copper[600], textDecoration: 'none', fontWeight: 600 }}>
            📎 Ver foto
          </a>
        )}
      </div>

      {canManage && (
        <div style={{ marginLeft: 52, marginTop: 8 }}>
          {confirmingDelete ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: T.bad, fontWeight: 600 }}>¿Eliminar este ingreso?</span>
              <button onClick={onConfirmDelete} style={{
                padding: '5px 12px', borderRadius: 8, background: T.bad, color: '#fff',
                border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
              }}>Sí, eliminar</button>
              <button onClick={onCancelDelete} style={{
                padding: '5px 12px', borderRadius: 8, background: T.neutral[100], color: T.neutral[700],
                border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
              }}>No</button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={onEdit} style={{
                padding: '5px 12px', borderRadius: 8, background: '#fff', color: T.copper[600],
                border: `1.5px solid ${T.copper[200]}`, cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 12, fontWeight: 700,
              }}>✏️ Editar</button>
              <button onClick={onAskDelete} style={{
                padding: '5px 12px', borderRadius: 8, background: '#fff', color: T.bad,
                border: `1.5px solid #F0C8BE`, cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 12, fontWeight: 700,
              }}>🗑 Eliminar</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Fila compacta de ingreso (home del turno).
function IncomeRow({ income, isLast }) {
  const time = income.createdAt?.toDate?.()
  const timeStr = time
    ? time.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false })
    : '—'
  const statusColor = { pending: T.warn, approved: T.ok, rejected: T.bad }[income.status] || T.neutral[500]
  const statusLabel = { pending: 'Pendiente', approved: 'Aprobado', rejected: 'Rechazado' }[income.status] || income.status

  return (
    <div style={{
      padding: '12px 14px',
      borderBottom: isLast ? 'none' : `0.5px solid ${T.neutral[100]}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <div style={{
          fontSize: 12, fontWeight: 700, color: T.neutral[500],
          fontVariantNumeric: 'tabular-nums', minWidth: 42, flexShrink: 0,
        }}>
          {timeStr}
        </div>
        <div style={{
          flex: 1, minWidth: 0,
          fontSize: 13.5, fontWeight: 600, color: T.neutral[900],
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {income.description}
        </div>
        <div style={{
          fontSize: 13.5, fontWeight: 700, color: T.ok,
          fontVariantNumeric: 'tabular-nums', flexShrink: 0,
        }}>
          +{fmtCOP(income.amount)}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 52, flexWrap: 'wrap' }}>
        <span style={{
          fontSize: 10.5, fontWeight: 700, color: statusColor,
          background: statusColor + '15',
          padding: '2px 8px', borderRadius: 999,
          letterSpacing: 0.4, textTransform: 'uppercase',
        }}>
          {statusLabel}
        </span>
        {income.debtorName && (
          <span style={{
            fontSize: 10.5, fontWeight: 700, color: '#2E6B43',
            background: T.ok + '15', padding: '2px 8px', borderRadius: 999,
          }}>
            🤝 {income.debtorName}
          </span>
        )}
        {income.status === 'rejected' && income.reviewNote && (
          <span style={{
            fontSize: 11.5, color: T.bad, fontStyle: 'italic',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {income.reviewNote}
          </span>
        )}
        {income.photoUrl && (
          <a href={income.photoUrl} target="_blank" rel="noreferrer"
            style={{ fontSize: 11, color: T.copper[600], textDecoration: 'none', fontWeight: 600 }}>
            📎 Ver foto
          </a>
        )}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Fila de venta en lista (sin monto — D21)
// ──────────────────────────────────────────────────────────────
function SaleRow({ sale, isLast, onClick }) {
  const time = sale.createdAt?.toDate?.()
  const timeStr = time
    ? time.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false })
    : '—'

  const itemsCount = sale.items?.length || 0
  const firstName = sale.items?.[0]?.name || ''
  const summary = itemsCount === 1
    ? firstName
    : itemsCount > 1
      ? `${firstName} + ${itemsCount - 1} más`
      : 'Sin productos'

  const methodIcons = {
    efectivo: '💵',
    nequi: '📱',
    daviplata: '📱',
    deuda: '🤝',
    mixto: '🔀',
  }
  const methodIcon = methodIcons[sale.paymentMethod] || ''

  const isFlagged = sale.status === 'flagged'

  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', padding: '12px 14px',
        background: isFlagged ? '#FFF7E6' : 'transparent',
        border: 'none', cursor: 'pointer', fontFamily: 'inherit',
        borderBottom: isLast ? 'none' : `0.5px solid ${T.neutral[100]}`,
        display: 'flex', alignItems: 'center', gap: 10,
        textAlign: 'left',
      }}
    >
      <div style={{
        fontSize: 12, fontWeight: 700, color: T.neutral[500],
        fontVariantNumeric: 'tabular-nums', minWidth: 42, flexShrink: 0,
      }}>
        {timeStr}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13.5, fontWeight: 600, color: T.neutral[900],
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {summary}
        </div>
        {isFlagged && (
          <div style={{ fontSize: 11, color: T.warn, fontWeight: 600, marginTop: 2 }}>
            ⚠ Reportado al admin
          </div>
        )}
        {sale.recordedByUid && sale.recordedByRole === 'admin' && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            marginTop: 4, padding: '2px 8px', borderRadius: 999,
            background: '#FFF7E6', border: `1px solid #F4E0BC`,
            fontSize: 10.5, fontWeight: 700, color: '#7A5C00',
            letterSpacing: 0.3, textTransform: 'uppercase',
          }}>
            👤 Hecha por admin{sale.recordedByName ? ` · ${sale.recordedByName}` : ''}
          </div>
        )}
        {sale.paymentMethod === 'deuda' && sale.debtorName && !isFlagged && (
          <div style={{
            fontSize: 11, color: T.neutral[500], marginTop: 2,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            deudor: {sale.debtorName}
          </div>
        )}
      </div>
      <div style={{ fontSize: 16, flexShrink: 0 }} title={sale.paymentMethod}>
        {methodIcon}
      </div>
    </button>
  )
}

// ──────────────────────────────────────────────────────────────
// Modal: Reportar problema con una venta
// ──────────────────────────────────────────────────────────────
function ReportSaleModal({ sale, authUser, userDoc, onCancel, onDone }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const isAlreadyFlagged = sale.status === 'flagged'
  const valid = note.trim().length >= 10

  function handleReport() {
    if (!valid || busy) return
    setBusy(true); setError(null)
    try {
      const cashierName = `${userDoc?.nombre || ''} ${userDoc?.apellido || ''}`.trim() || authUser.email
      // flagSale es fire-and-forget: encola el reporte y no se cuelga en modo
      // ahorro. No usar await.
      flagSale(sale.id, {
        note,
        byUid: authUser.uid,
        byName: cashierName,
      })
      onDone()
    } catch (err) {
      console.error(err)
      setError('No pudimos enviar el reporte. Intenta de nuevo.')
      setBusy(false)
    }
  }

  const time = sale.createdAt?.toDate?.()
  const timeStr = time
    ? time.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false })
    : '—'

  return (
    <ModalOverlay onClose={onCancel}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 420, background: '#fff', borderRadius: 22,
        padding: '24px 22px 22px', boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
        animation: 'fadeScaleIn 0.2s ease',
        maxHeight: '92vh', overflowY: 'auto',
      }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: T.neutral[900], letterSpacing: -0.3, marginBottom: 4 }}>
          Reportar problema
        </div>
        <div style={{ fontSize: 12.5, color: T.neutral[500], marginBottom: 16 }}>
          Venta de las {timeStr} · {sale.items?.length || 0} producto(s)
        </div>

        {/* Lista de items para que la cajera identifique cuál es */}
        <div style={{
          padding: '10px 12px', borderRadius: 12,
          background: T.neutral[50], marginBottom: 14,
          maxHeight: 140, overflowY: 'auto',
        }}>
          {sale.items?.map((it, i) => (
            <div key={i} style={{
              fontSize: 12.5, color: T.neutral[700],
              padding: '3px 0',
              display: 'flex', justifyContent: 'space-between', gap: 8,
            }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {it.qty}× {it.name}
              </span>
            </div>
          ))}
        </div>

        {isAlreadyFlagged ? (
          <>
            <div style={{
              padding: '12px 14px', borderRadius: 12,
              background: '#FFF7E6', border: `1px solid #F4E0BC`,
              fontSize: 13, color: T.warn, lineHeight: 1.5, marginBottom: 14,
            }}>
              Esta venta ya está reportada al admin. Estas son las notas dejadas:
            </div>
            <div style={{
              padding: '10px 12px', borderRadius: 10,
              background: '#fff', border: `1px solid ${T.neutral[100]}`,
              maxHeight: 200, overflowY: 'auto', marginBottom: 14,
            }}>
              {(sale.notes || []).map((n, i) => (
                <div key={i} style={{
                  padding: '6px 0',
                  borderBottom: i < (sale.notes.length - 1) ? `0.5px solid ${T.neutral[100]}` : 'none',
                  fontSize: 12.5, color: T.neutral[700], lineHeight: 1.5,
                }}>
                  <div style={{ fontWeight: 600, color: T.neutral[800], marginBottom: 2 }}>
                    {n.byName || 'Cajera'}
                  </div>
                  <div>{n.message}</div>
                </div>
              ))}
            </div>
            <button onClick={onCancel} style={btnSecondary()}>Cerrar</button>
          </>
        ) : (
          <>
            <NoteField
              label="¿Qué pasó? (mínimo 10 caracteres)"
              value={note}
              onChange={setNote}
              placeholder="Ej: La cantidad de panes está mal, eran 3 no 5..."
              disabled={busy}
            />

            <div style={{
              padding: '11px 14px', borderRadius: 12,
              background: '#FFF7E6', border: `1px solid #F4E0BC`,
              fontSize: 12.5, color: T.warn, fontWeight: 500, lineHeight: 1.5,
              marginTop: 4, marginBottom: 14,
            }}>
              ⚠ La venta no se modifica ni se elimina. El admin verá tu reporte y decidirá qué hacer.
            </div>

            {error && <ErrorBox text={error} />}

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={onCancel} style={btnSecondary()}>Cancelar</button>
              <button
                onClick={handleReport}
                disabled={!valid || busy}
                style={{
                  ...btnPrimary(valid && !busy ? T.warn : T.neutral[200]),
                  flex: 1.4,
                  color: valid && !busy ? '#fff' : T.neutral[400],
                  cursor: valid && !busy ? 'pointer' : 'not-allowed',
                }}
              >
                {busy ? 'Reportando...' : 'Reportar al admin'}
              </button>
            </div>
          </>
        )}
      </div>
    </ModalOverlay>
  )
}

// ──────────────────────────────────────────────────────────────
// Componentes utilitarios
// ──────────────────────────────────────────────────────────────
function NoteField({ label, value, onChange, placeholder, disabled }) {
  const [focused, setFocused] = useState(false)
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: T.neutral[600], display: 'block', marginBottom: 6 }}>
        {label}
      </label>
      <div style={{
        border: `1.5px solid ${focused ? T.copper[400] : T.neutral[200]}`,
        borderRadius: 12, background: '#fff',
        transition: 'border-color 0.12s',
      }}>
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          rows={3}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            width: '100%', padding: '12px 14px', border: 'none', outline: 'none',
            fontFamily: 'inherit', fontSize: 14, color: T.neutral[900],
            background: 'transparent', borderRadius: 12, resize: 'vertical',
            opacity: disabled ? 0.6 : 1,
            minHeight: 64,
          }}
        />
      </div>
    </div>
  )
}


function ModalOverlay({ onClose, children }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 90,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      {children}
    </div>
  )
}

function btnPrimary(bg) {
  return {
    flex: 1, padding: '12px', borderRadius: 12,
    background: bg, color: '#fff',
    border: 'none', cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
  }
}
function btnSecondary() {
  return {
    flex: 1, padding: '12px', borderRadius: 12,
    background: T.neutral[100], color: T.neutral[700],
    border: 'none', cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
  }
}

// ──────────────────────────────────────────────────────────────
// Card "Tareas del turno" (vista cajera)
// Lista compacta con checkbox tipo radio. Tap → chulea (con micro-animación).
// Re-tap → des-chulea (mientras el turno siga abierto).
// ──────────────────────────────────────────────────────────────
export function CashierTaskList({ tasks, sessionId }) {
  // Las pendientes arriba, las completadas (en este turno) abajo tachadas
  const sorted = useMemo(() => {
    const pending = tasks.filter(t => t.status === 'pending')
    const done = tasks.filter(t => t.status === 'done')
    return [...pending, ...done]
  }, [tasks])

  const pendingCount = tasks.filter(t => t.status === 'pending').length
  const doneCount = tasks.filter(t => t.status === 'done').length
  const allDone = pendingCount === 0 && doneCount > 0

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        margin: '0 4px 8px', gap: 8,
      }}>
        <div style={{
          fontSize: 12, fontWeight: 700, color: T.neutral[500],
          letterSpacing: 0.5, textTransform: 'uppercase',
        }}>
          Tus tareas
        </div>
        <div style={{
          fontSize: 11, fontWeight: 700,
          color: allDone ? T.ok : T.copper[700],
        }}>
          {allDone
            ? '✓ Todas hechas'
            : `${doneCount}/${pendingCount + doneCount} hechas`}
        </div>
      </div>

      <Card padding={0} style={{
        overflow: 'hidden',
        background: allDone ? '#F5FBF5' : '#fff',
        border: allDone ? `1px solid ${T.ok}40` : `1px solid ${T.neutral[100]}`,
        transition: 'background 0.3s, border-color 0.3s',
      }}>
        {sorted.map((task, i) => (
          <CashierTaskRow
            key={task.id}
            task={task}
            sessionId={sessionId}
            isLast={i === sorted.length - 1}
          />
        ))}
      </Card>

      <style>{`
        @keyframes taskTickPop {
          0%   { transform: scale(0.5); opacity: 0; }
          60%  { transform: scale(1.15); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes taskRowSlide {
          from { background: #FFF8E0; }
          to   { background: transparent; }
        }
      `}</style>
    </div>
  )
}

function CashierTaskRow({ task, sessionId, isLast }) {
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const isDone = task.status === 'done'

  async function handleToggle() {
    if (busy) return
    setBusy(true)
    try {
      if (isDone) {
        await unmarkTaskDone(task.id)
      } else {
        await markTaskDone(task.id, { sessionId })
      }
    } catch (err) {
      console.error('[tasks] toggle failed:', err)
    } finally {
      setBusy(false)
    }
  }

  // Días restantes/vencido (solo si pending)
  const dueInfo = useMemo(() => {
    if (!task.dueDate || isDone) return null
    const today = new Date().toISOString().slice(0, 10)
    const diff = Math.ceil((new Date(task.dueDate + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000)
    if (diff < 0) return { text: `Vencida hace ${-diff}d`, color: T.bad }
    if (diff === 0) return { text: 'Hoy', color: T.warn }
    if (diff === 1) return { text: 'Mañana', color: T.warn }
    return null
  }, [task.dueDate, isDone])

  return (
    <div
      style={{
        padding: '14px 14px 14px 12px',
        borderBottom: isLast ? 'none' : `0.5px solid ${T.neutral[100]}`,
        display: 'flex', alignItems: 'flex-start', gap: 12,
        background: isDone ? 'transparent' : '#fff',
        transition: 'opacity 0.25s',
        opacity: isDone ? 0.6 : 1,
        cursor: task.description ? 'pointer' : 'default',
      }}
    >
      {/* Checkbox */}
      <button
        onClick={(e) => { e.stopPropagation(); handleToggle() }}
        disabled={busy}
        aria-label={isDone ? 'Desmarcar tarea' : 'Marcar tarea como hecha'}
        style={{
          flexShrink: 0,
          width: 26, height: 26, borderRadius: 8,
          background: isDone ? T.ok : '#fff',
          border: `2px solid ${isDone ? T.ok : T.neutral[300]}`,
          cursor: busy ? 'wait' : 'pointer',
          padding: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background 0.18s, border-color 0.18s, transform 0.12s',
          marginTop: 1,
        }}
        onMouseDown={e => { if (!busy) e.currentTarget.style.transform = 'scale(0.92)' }}
        onMouseUp={e => { e.currentTarget.style.transform = 'scale(1)' }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)' }}
      >
        {isDone && (
          <svg
            width="14" height="14" viewBox="0 0 14 14" fill="none"
            style={{ animation: 'taskTickPop 0.32s cubic-bezier(0.2,0.9,0.3,1.4)' }}
          >
            <path d="M2.5 7.5 L5.5 10 L11 4" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </button>

      {/* Contenido */}
      <div
        onClick={() => task.description && setExpanded(v => !v)}
        style={{ flex: 1, minWidth: 0 }}
      >
        <div style={{
          fontSize: 14.5, fontWeight: 700,
          color: isDone ? T.neutral[500] : T.neutral[900],
          textDecoration: isDone ? 'line-through' : 'none',
          letterSpacing: -0.2,
          lineHeight: 1.35,
          transition: 'color 0.18s',
        }}>
          {task.title}
        </div>

        {/* Descripción colapsable */}
        {task.description && (
          <div style={{
            fontSize: 12.5, color: T.neutral[600], marginTop: 4,
            lineHeight: 1.45,
            display: expanded ? 'block' : '-webkit-box',
            WebkitLineClamp: expanded ? 'unset' : 1,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            whiteSpace: 'pre-wrap',
          }}>
            {task.description}
          </div>
        )}

        {/* Meta */}
        {(dueInfo || task.branchName || task.createdByName) && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginTop: 6,
            flexWrap: 'wrap',
          }}>
            {dueInfo && (
              <span style={{
                fontSize: 11, fontWeight: 700, color: dueInfo.color,
                background: `${dueInfo.color}15`,
                padding: '2px 8px', borderRadius: 999,
              }}>
                ⏰ {dueInfo.text}
              </span>
            )}
            {task.branchName && (
              <span style={{
                fontSize: 11, fontWeight: 600, color: T.neutral[500],
              }}>
                {task.branchName}
              </span>
            )}
            {task.createdByName && !isDone && (
              <span style={{ fontSize: 11, color: T.neutral[400] }}>
                · {task.createdByName}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

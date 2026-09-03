// ─────────────────────────────────────────────────────────────────────────────
// MOVIMIENTOS (ingresos y gastos del administrador)
//
// Hasta ahora vivian dentro de /todypan/data, un unico documento que se
// reescribe COMPLETO en cada cambio. Eso traia tres problemas de fondo:
//
//   1. Perdida de datos. Dos administradores registrando a la vez: el segundo
//      guarda el documento entero desde su copia, que no trae lo del primero,
//      y lo borra. Pasa a la hora del cierre, que es cuando ambos registran.
//   2. Imposible separar las panaderias. Las reglas de Firestore aplican por
//      DOCUMENTO completo: no hay forma de darle a un dueño "su parte" de un
//      documento compartido. O lo lee entero o no lo lee.
//   3. Limite de 1 MB por documento. Los movimientos crecen sin techo.
//
// En una coleccion propia los tres desaparecen: cada movimiento es su propio
// documento, con su panaderia, y las reglas pueden filtrarlo.
//
// ── Sobre el saldo de las cuentas ────────────────────────────────────────────
//
// El saldo de Nequi/Daviplata/Efectivo se calculaba sumando TODO el historico.
// Traer el historico entero en cada arranque para sumarlo es justo el error que
// ya agoto la cuota de Firestore en los reportes. Por eso:
//
//   /movements/{id}          el libro completo (la verdad)
//   /accountBalances/{id}    la suma corriente por cuenta, con increment()
//
// increment() es atomico del lado del servidor, asi que dos movimientos
// simultaneos sobre la misma cuenta no se pisan. La app lee un solo documento
// para saber el saldo, en vez de miles.
//
// ── Convivencia con lo viejo ─────────────────────────────────────────────────
//
// No se migra nada. Los movimientos historicos se quedan en /todypan/data y
// db.js presenta las dos fuentes como una sola lista. Migrar exigiria reescribir
// el documento compartido mientras hay gente trabajando dentro, que es
// exactamente como se pierden datos.
// ─────────────────────────────────────────────────────────────────────────────

import { firestoreDb } from './firebase'
import {
  doc, collection, setDoc, deleteDoc, increment, serverTimestamp,
  query, where, onSnapshot,
} from 'firebase/firestore'
import { addDocOffline } from './utils/firestoreOffline'
import { getClientTimestamp } from './utils/network'

const movementsCol = () => collection(firestoreDb, 'movements')
const balanceRef = (accountId) => doc(firestoreDb, 'accountBalances', String(accountId))

/** Cuanto suma (+) o resta (−) un movimiento al saldo de su cuenta. */
export function movementEffect(m) {
  const amt = Number(m?.amount) || 0
  return m?.type === 'income' ? amt : -amt
}

/**
 * Registra un movimiento y ajusta el saldo de su cuenta.
 *
 * Fire-and-forget: en modo ahorro de datos `await` se cuelga indefinidamente y
 * dejaria el boton atrapado en "Guardando...". Firestore encola las escrituras
 * y las resuelve cuando vuelva la red.
 */
export function createMovement(mov, { byUid, byName } = {}) {
  const data = {
    date: mov.date,
    type: mov.type,
    amount: Number(mov.amount) || 0,
    cat: mov.cat || '',
    branch: mov.branch ?? null,
    createdAt: serverTimestamp(),
    createdAtClient: getClientTimestamp(),
    createdByUid: byUid || null,
    createdByName: byName || null,
  }
  if (mov.group) data.group = mov.group
  if (mov.accountId) data.accountId = mov.accountId
  if (mov.note) data.note = mov.note

  const ref = addDocOffline(movementsCol(), data)

  if (data.accountId) {
    bumpAccountBalance(data.accountId, movementEffect(data))
  }
  return ref.id
}

/** Elimina un movimiento de la colección y revierte su efecto en el saldo. */
export function removeMovement(mov) {
  if (!mov?.id) return
  deleteDoc(doc(firestoreDb, 'movements', mov.id))
    .catch(e => console.warn('[movements] borrado diferido:', e?.message || e))
  if (mov.accountId) {
    bumpAccountBalance(mov.accountId, -movementEffect(mov))
  }
}

/** Ajusta la suma corriente de una cuenta. merge:true la crea si no existe. */
function bumpAccountBalance(accountId, delta) {
  if (!delta) return
  setDoc(balanceRef(accountId), {
    accountId: String(accountId),
    sum: increment(delta),
    updatedAt: serverTimestamp(),
  }, { merge: true }).catch(e => console.warn('[movements] saldo diferido:', e?.message || e))
}

/**
 * Suscripción a los movimientos DESDE una fecha.
 *
 * Va acotada a proposito: el libro crece sin techo y traerlo completo en cada
 * arranque es el error que ya costo la cuota de Firestore. `date` es un string
 * ISO, asi que comparar en orden alfabetico es comparar en orden cronologico,
 * y al ser un filtro de campo unico Firestore lo indexa solo.
 *
 * `branchIds` acota ademas por panaderia cuando el usuario esta restringido:
 * las reglas rechazan la consulta ENTERA si pudiera devolver algo que no puede
 * leer, asi que sin ese filtro recibiria permission-denied en vez de una lista
 * recortada.
 */
export function watchMovementsSince(sinceDate, callback, branchIds = null) {
  if (!sinceDate) { callback([]); return () => {} }
  const parts = [where('date', '>=', sinceDate)]
  if (Array.isArray(branchIds) && branchIds.length > 0) {
    parts.push(where('branch', 'in', branchIds))
  }
  return onSnapshot(
    query(movementsCol(), ...parts),
    snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => {
      console.error('[movements] watchMovementsSince error:', err)
      callback([])
    }
  )
}

/** Suscripción a los saldos corrientes de todas las cuentas. */
export function watchAccountBalances(callback) {
  return onSnapshot(
    collection(firestoreDb, 'accountBalances'),
    snap => {
      const out = {}
      snap.docs.forEach(d => { out[d.id] = Number(d.data()?.sum) || 0 })
      callback(out)
    },
    err => {
      console.error('[movements] watchAccountBalances error:', err)
      callback({})
    }
  )
}

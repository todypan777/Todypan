// ─────────────────────────────────────────────────────────────────────────────
// CUENTAS (Nequi / Daviplata / Efectivo)
//
// El Nequi de un dueño y el Nequi del otro NO son la misma cuenta: son personas
// distintas con numeros distintos. Hasta ahora vivian todas juntas dentro de
// /todypan/data, un unico documento que ambos leen, asi que era imposible
// separarlas — las reglas de Firestore aplican por documento COMPLETO.
//
// Las cuentas nuevas viven aqui, cada una en su propio documento y con su
// panaderia, de modo que las reglas si pueden filtrarlas.
//
// ── Que queda por fuera ──────────────────────────────────────────────────────
//
// Las cuentas HISTORICAS siguen dentro de /todypan/data. No se migran: mover
// las tres que ya existen exige reescribir el documento compartido mientras hay
// gente trabajando dentro, y ahi se pierden datos. Se leen como de Panaderia
// Iglesia, igual que los movimientos y los fiados viejos.
//
// Consecuencia, dicha sin adornos: el dueño NUEVO queda protegido —sus cuentas
// y sus ajustes viven aqui y el otro no puede leerlos—, pero el dueño ANTERIOR
// no: sus ajustes manuales siguen en el documento compartido. La fuga es en una
// sola direccion y se cierra migrando esas tres cuentas cuando se pueda hacer
// con calma.
//
// ── Donde vive el saldo ──────────────────────────────────────────────────────
//
// El saldo NO se guarda: se deriva de dos cosas.
//   1. `adjustments[]` — los ajustes manuales del dueño ("el saldo real es X").
//   2. Los movimientos asignados a la cuenta, que ya viven en /movements.
// Guardar ademas un saldo fijo obligaria a mantener tres numeros de acuerdo, y
// el primero que se desincronice miente sin avisar.
// ─────────────────────────────────────────────────────────────────────────────

import { firestoreDb } from './firebase'
import {
  doc, collection, setDoc, updateDoc, deleteDoc, arrayUnion,
  serverTimestamp, query, where, onSnapshot, getDoc,
} from 'firebase/firestore'
// Se toma la fecha de utils/format y NO de db.js a proposito: db.js importa
// este modulo, y importarlo de vuelta crearia un ciclo. `todayStr` da la misma
// fecha de Bogota que `getBogotaDateStr`.
import { todayStr } from './utils/format'

const accountsCol = () => collection(firestoreDb, 'accounts')
const accountRef = (id) => doc(firestoreDb, 'accounts', id)

/** Crea una cuenta para una panadería. Devuelve su id. */
export function createAccount({ name, emoji = '💳', colorKey = 'copper', branchId, balance = 0 }) {
  const clean = String(name || '').trim()
  if (!clean || branchId == null) return null

  const id = 'acc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)
  const initial = Number(balance) || 0
  const data = {
    name: clean,
    emoji: emoji || '💳',
    colorKey: colorKey || 'copper',
    branchId,
    adjustments: initial !== 0
      ? [{
          id: 'mv_' + Date.now(), type: 'set', amount: initial,
          note: 'Saldo inicial', date: todayStr(), createdAt: Date.now(),
        }]
      : [],
    createdAt: serverTimestamp(),
  }
  setDoc(accountRef(id), data)
    .catch(e => console.warn('[accounts] creacion diferida:', e?.message || e))
  return id
}

/** Cambia la identidad de la cuenta (nombre, emoji, color). El saldo no. */
export function patchAccount(id, updates) {
  const clean = {}
  if (updates.name != null) clean.name = String(updates.name).trim()
  if (updates.emoji != null) clean.emoji = updates.emoji
  if (updates.colorKey != null) clean.colorKey = updates.colorKey
  if (Object.keys(clean).length === 0) return
  updateDoc(accountRef(id), clean)
    .catch(e => console.warn('[accounts] actualizacion diferida:', e?.message || e))
}

export function removeAccount(id) {
  deleteDoc(accountRef(id))
    .catch(e => console.warn('[accounts] borrado diferido:', e?.message || e))
}

/**
 * Agrega un ajuste manual. Se usa arrayUnion para que el anexado ocurra en el
 * servidor: si dos personas ajustan la misma cuenta a la vez, no se pisan.
 */
export function pushAdjustment(id, adjustment) {
  updateDoc(accountRef(id), { adjustments: arrayUnion(adjustment) })
    .catch(e => console.warn('[accounts] ajuste diferido:', e?.message || e))
}

/**
 * Quita un ajuste por id.
 *
 * Va con lectura previa en vez de arrayRemove: este ultimo exige que el objeto
 * coincida EXACTAMENTE, y basta un campo de mas o de menos en la copia local
 * para que el borrado falle en silencio. Se lee el documento, se filtra por id
 * y se guarda — sobre un documento pequeño y de una sola cuenta, el riesgo de
 * pisarse es minimo.
 */
export async function pullAdjustment(id, adjustmentId) {
  try {
    const snap = await getDoc(accountRef(id))
    if (!snap.exists()) return
    const list = (snap.data()?.adjustments || []).filter(m => m.id !== adjustmentId)
    await updateDoc(accountRef(id), { adjustments: list })
  } catch (e) {
    console.warn('[accounts] no se pudo quitar el ajuste:', e?.message || e)
  }
}

/**
 * Suscripción a las cuentas, acotada a las panaderías del usuario cuando esta
 * restringido: las reglas rechazan la consulta ENTERA si pudiera devolver algo
 * que no puede leer, así que sin el filtro daría permission-denied.
 */
export function watchAccounts(callback, branchIds = null) {
  const q = Array.isArray(branchIds) && branchIds.length > 0
    ? query(accountsCol(), where('branchId', 'in', branchIds))
    : query(accountsCol())
  return onSnapshot(
    q,
    snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => {
      console.error('[accounts] watchAccounts error:', err)
      callback([])
    }
  )
}

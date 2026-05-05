import { firestoreDb } from './firebase'
import {
  doc,
  collection,
  addDoc,
  updateDoc,
  serverTimestamp,
  query,
  onSnapshot,
  arrayUnion,
  getDoc,
} from 'firebase/firestore'

const debtorsCol = () => collection(firestoreDb, 'debtors')
const debtorRef = (id) => doc(firestoreDb, 'debtors', id)

/** Normaliza nombre para matching (lowercase + sin tildes). */
export function normalizeName(name) {
  return (name || '').toString()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quitar tildes
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

/** Suscripción a todos los deudores. */
export function watchDebtors(callback) {
  const q = query(debtorsCol())
  return onSnapshot(
    q,
    snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => {
      console.error('[debtors] watchDebtors error:', err)
      callback([])
    }
  )
}

/**
 * Registra una venta de tipo deuda:
 * - Si el deudor existe (matchea por normalizedName), actualiza totalOwed y agrega
 *   entry al history.
 * - Si no existe, crea uno nuevo.
 *
 * Devuelve el id del deudor (existente o creado).
 */
export async function addDebtSale(existingDebtors, { name, amount, saleId, date }) {
  const normalized = normalizeName(name)
  const existing = existingDebtors.find(d => normalizeName(d.name) === normalized)

  if (existing) {
    const newTotal = (Number(existing.totalOwed) || 0) + (Number(amount) || 0)
    await updateDoc(debtorRef(existing.id), {
      totalOwed: newTotal,
      lastUpdate: serverTimestamp(),
      history: arrayUnion({
        type: 'sale',
        saleId,
        amount: Number(amount) || 0,
        date,
        createdAt: Date.now(),  // Date.now en lugar de serverTimestamp porque no funciona dentro de arrayUnion
      }),
    })
    return existing.id
  } else {
    const ref = await addDoc(debtorsCol(), {
      name: name.trim(),
      normalizedName: normalized,
      totalOwed: Number(amount) || 0,
      status: 'active',
      lastUpdate: serverTimestamp(),
      createdAt: serverTimestamp(),
      history: [{
        type: 'sale',
        saleId,
        amount: Number(amount) || 0,
        date,
        createdAt: Date.now(),
      }],
    })
    return ref.id
  }
}

/**
 * Solo admin: registra un abono o pago de un deudor.
 *
 * payload:
 *   - amount (positivo, lo que paga el deudor)
 *   - method: 'efectivo' | 'nequi' | 'daviplata'
 *   - photoUrl?: foto del comprobante (opcional)
 *   - note?: nota interna
 *   - registeredBy: uid del admin
 */
export async function registerDebtorPayment(debtorId, payload) {
  const ref = debtorRef(debtorId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('Deudor no encontrado')

  const debtor = snap.data()
  const amount = Number(payload.amount) || 0
  if (amount <= 0) throw new Error('El monto debe ser mayor a 0')

  const currentOwed = Number(debtor.totalOwed) || 0
  const newOwed = Math.max(0, currentOwed - amount)

  const paymentEntry = {
    type: 'payment',
    amount,
    method: payload.method || 'efectivo',
    date: payload.date || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }),
    registeredBy: payload.registeredBy || null,
    createdAt: Date.now(),
  }
  if (payload.photoUrl) paymentEntry.photoUrl = payload.photoUrl
  if (payload.note) paymentEntry.note = payload.note

  await updateDoc(ref, {
    totalOwed: newOwed,
    lastUpdate: serverTimestamp(),
    history: arrayUnion(paymentEntry),
    status: newOwed === 0 ? 'paid' : 'active',
  })

  return { newOwed, fullyPaid: newOwed === 0 }
}

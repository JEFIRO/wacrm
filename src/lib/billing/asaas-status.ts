// ============================================================
// Asaas payments → subscription status — docs/saas/b2-asaas.md. Pure.
//
// The source of truth is the list of the subscription's payments as
// Asaas reports it (re-read on every webhook / sync), not the webhook
// body: a forged notification can't activate an account.
// ============================================================
import type { AsaasPayment } from './asaas'

const PAID = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'])

export interface SyncedStatus {
  /** null = nothing paid or due yet: keep the current status (trial). */
  status: 'active' | 'past_due' | 'canceled' | null
  currentPeriodEnd: string | null
  /** Invoice of the next charge to pay, if any. */
  invoiceUrl: string | null
}

// Asaas dates are calendar days; noon UTC keeps the same day in
// Brazilian time zones when shown.
const noonUtc = (isoDate: string) => `${isoDate}T12:00:00.000Z`

const addMonth = (isoDate: string): string => {
  const d = new Date(noonUtc(isoDate))
  d.setUTCMonth(d.getUTCMonth() + 1)
  return d.toISOString()
}

export function statusFromPayments(
  payments: AsaasPayment[],
  subscriptionActive: boolean,
): SyncedStatus {
  const sorted = [...payments].sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  const lastPaid = [...sorted].reverse().find((p) => PAID.has(p.status)) ?? null
  // The oldest overdue charge after the last paid one starts the grace.
  const overdue = sorted.find((p) => p.status === 'OVERDUE' && (!lastPaid || p.dueDate > lastPaid.dueDate)) ?? null
  const unpaid = sorted.find((p) => p.status === 'PENDING' || p.status === 'OVERDUE') ?? null
  const invoiceUrl = unpaid?.invoiceUrl ?? null

  if (!subscriptionActive) {
    return { status: 'canceled', currentPeriodEnd: lastPaid ? addMonth(lastPaid.dueDate) : null, invoiceUrl: null }
  }
  if (overdue) {
    return { status: 'past_due', currentPeriodEnd: noonUtc(overdue.dueDate), invoiceUrl }
  }
  if (lastPaid) {
    return { status: 'active', currentPeriodEnd: addMonth(lastPaid.dueDate), invoiceUrl }
  }
  return { status: null, currentPeriodEnd: null, invoiceUrl }
}

/** CPF (11) or CNPJ (14) digits with valid check digits. */
export function isValidCpfCnpj(value: string): boolean {
  const d = value.replace(/\D/g, '')
  if (d.length === 11) {
    if (/^(\d)\1+$/.test(d)) return false
    const check = (len: number) => {
      let sum = 0
      for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i)
      const r = (sum * 10) % 11
      return (r === 10 ? 0 : r) === Number(d[len])
    }
    return check(9) && check(10)
  }
  if (d.length === 14) {
    if (/^(\d)\1+$/.test(d)) return false
    const check = (len: number) => {
      const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      const sum = weights.reduce((acc, w, i) => acc + Number(d[i]) * w, 0)
      const r = sum % 11
      return (r < 2 ? 0 : 11 - r) === Number(d[len])
    }
    return check(12) && check(13)
  }
  return false
}

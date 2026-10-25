// Shared secret of the Evolution webhook — docs/saas/w2-evolution.md.
// The instance's webhook config (W3) sends it in this header; the
// route compares it with EVOLUTION_WEBHOOK_SECRET in constant time.
import { timingSafeEqual } from 'node:crypto'

export const EVOLUTION_SECRET_HEADER = 'x-wacrm-webhook-secret'

export function evolutionSecretMatches(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

// ============================================================
// Text campaigns (QR-code accounts) — docs/saas/w5-fila.md. Pure:
// placeholders and the random pause between sends.
// ============================================================

/** Placeholders a campaign text may use, e.g. "Oi {{primeiro_nome}}!". */
export const CAMPAIGN_VARIABLES = ['nome', 'primeiro_nome', 'telefone', 'email', 'empresa'] as const
export type CampaignVariable = (typeof CAMPAIGN_VARIABLES)[number]

export interface CampaignContact {
  name?: string | null
  phone?: string | null
  email?: string | null
  company?: string | null
}

const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/gi

function valueOf(variable: string, contact: CampaignContact): string | null {
  const name = contact.name?.trim() ?? ''
  switch (variable.toLowerCase()) {
    case 'nome':
      return name
    case 'primeiro_nome':
      return name.split(/\s+/)[0] ?? ''
    case 'telefone':
      return contact.phone ?? ''
    case 'email':
      return contact.email ?? ''
    case 'empresa':
      return contact.company ?? ''
    default:
      return null
  }
}

/**
 * The text this contact receives. Known placeholders are filled (empty
 * when the contact lacks the field); leftover spaces before punctuation
 * are tidied ("Oi , tudo bem" → "Oi, tudo bem").
 */
export function renderCampaignText(text: string, contact: CampaignContact): string {
  return text
    .replace(PLACEHOLDER, (match, variable: string) => valueOf(variable, contact) ?? match)
    .replace(/[ \t]+([,.!?;:])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/** Placeholders the text uses that the campaign can't fill. */
export function unknownCampaignVariables(text: string): string[] {
  const unknown = new Set<string>()
  for (const [, variable] of text.matchAll(PLACEHOLDER)) {
    if (!(CAMPAIGN_VARIABLES as readonly string[]).includes(variable.toLowerCase())) unknown.add(variable)
  }
  return [...unknown]
}

/** Random pause before the next send, in ms, within [min, max] seconds. */
export function nextIntervalMs(minSeconds: number, maxSeconds: number, random: () => number = Math.random): number {
  const lo = Math.max(0, Math.min(minSeconds, maxSeconds))
  const hi = Math.max(minSeconds, maxSeconds)
  return Math.round((lo + random() * (hi - lo)) * 1000)
}

/** Rough campaign length, for the confirmation screen. */
export function estimatedDurationMs(recipients: number, minSeconds: number, maxSeconds: number): number {
  return Math.max(0, recipients - 1) * ((minSeconds + maxSeconds) / 2) * 1000
}

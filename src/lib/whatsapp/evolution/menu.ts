// ============================================================
// Buttons and lists as a numbered text menu — docs/saas/w4-regras.md.
//
// WhatsApp doesn't show interactive buttons/lists sent through a linked
// device (Evolution): they arrive empty or not at all. QR-code numbers
// send a numbered menu instead, and the customer's "1", "2" or option
// text is mapped back to the option id, so flows and automations work
// the same on both kinds of number. Pure.
// ============================================================

export interface MenuOption {
  id: string
  title: string
  description?: string
}

export interface MenuText {
  header?: string
  body: string
  footer?: string
  options: MenuOption[]
  /** Last line, e.g. "Responda com o número da opção." */
  hint: string
}

/** WhatsApp-formatted menu: *header*, body, "1. option", _footer_, hint. */
export function renderMenu({ header, body, footer, options, hint }: MenuText): string {
  const lines: string[] = []
  if (header?.trim()) lines.push(`*${header.trim()}*`)
  lines.push(body.trim(), '')
  options.forEach((o, i) => {
    lines.push(`${i + 1}. ${o.title}${o.description ? ` — ${o.description}` : ''}`)
  })
  lines.push('')
  if (footer?.trim()) lines.push(`_${footer.trim()}_`)
  lines.push(hint)
  return lines.join('\n')
}

/** Lower-case, no accents, collapsed spaces — for comparing titles. */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The option a reply picks: its number ("2", "2.", "2)", "opção 2") or
 * its exact title, ignoring case and accents. Null for anything else —
 * a free-text message stays a normal message.
 */
export function matchMenuReply(reply: string, options: MenuOption[]): MenuOption | null {
  const text = fold(reply)
  const number = /^(?:opcao\s*)?(\d{1,2})\s*[.)-]?$/.exec(text)
  if (number) return options[Number(number[1]) - 1] ?? null
  return options.find((o) => fold(o.title) === text) ?? null
}

// ============================================================
// Asaas API client — docs/saas/b2-asaas.md. Server only.
// Base URL and key from ASAAS_API_URL / ASAAS_API_KEY (sandbox keys
// start with $aact_hmlg_; escape the $ in .env files).
// ============================================================

export interface AsaasConfig {
  baseUrl: string
  apiKey: string
}

export function asaasConfig(): AsaasConfig | null {
  const apiKey = process.env.ASAAS_API_KEY
  const baseUrl = process.env.ASAAS_API_URL || 'https://api-sandbox.asaas.com/v3'
  if (!apiKey) return null
  return { baseUrl: baseUrl.replace(/\/+$/, ''), apiKey }
}

export interface AsaasPayment {
  id: string
  subscription?: string | null
  status: string
  dueDate: string
  value: number
  invoiceUrl?: string | null
}

export interface AsaasSubscription {
  id: string
  status: string
  deleted?: boolean
}

export class AsaasError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function asaas<T>(cfg: AsaasConfig, method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${cfg.baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      access_token: cfg.apiKey,
      // Required for accounts created after 2024-06-13.
      'User-Agent': 'wacrm',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) {
    const detail = data?.errors?.map((e: { description?: string }) => e.description).join('; ') || text
    throw new AsaasError(`Asaas API error: ${response.status} ${detail}`, response.status)
  }
  return data as T
}

export function createCustomer(
  cfg: AsaasConfig,
  input: { name: string; cpfCnpj: string; email?: string | null; externalReference: string },
): Promise<{ id: string }> {
  return asaas(cfg, 'POST', '/customers', {
    name: input.name,
    cpfCnpj: input.cpfCnpj,
    email: input.email ?? undefined,
    externalReference: input.externalReference,
    notificationDisabled: false,
  })
}

export interface SubscriptionInput {
  value: number
  nextDueDate: string
  description: string
  externalReference: string
  /** 12 for the annual plan (12 monthly instalments). */
  maxPayments?: number
}

/** Monthly subscription; the payer picks Pix, boleto or card on the invoice. */
export function createSubscription(
  cfg: AsaasConfig,
  customer: string,
  input: SubscriptionInput,
): Promise<AsaasSubscription> {
  return asaas(cfg, 'POST', '/subscriptions', {
    customer,
    billingType: 'UNDEFINED',
    cycle: 'MONTHLY',
    ...input,
  })
}

/** Change plan: new value for the pending and future charges. */
export function updateSubscription(
  cfg: AsaasConfig,
  id: string,
  input: Pick<SubscriptionInput, 'value' | 'description'>,
): Promise<AsaasSubscription> {
  return asaas(cfg, 'POST', `/subscriptions/${encodeURIComponent(id)}`, {
    ...input,
    updatePendingPayments: true,
  })
}

export function getSubscription(cfg: AsaasConfig, id: string): Promise<AsaasSubscription> {
  return asaas(cfg, 'GET', `/subscriptions/${encodeURIComponent(id)}`)
}

export async function listSubscriptionPayments(cfg: AsaasConfig, id: string): Promise<AsaasPayment[]> {
  const data = await asaas<{ data?: AsaasPayment[] }>(
    cfg,
    'GET',
    `/subscriptions/${encodeURIComponent(id)}/payments?limit=100`,
  )
  return data?.data ?? []
}

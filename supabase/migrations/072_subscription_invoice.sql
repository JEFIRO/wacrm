-- ============================================================
-- 072_subscription_invoice.sql
--
-- Asaas billing (B2, docs/saas/b2-asaas.md): the invoice link of the
-- next charge to pay, so the plan screen can offer "pay now", and when
-- the subscription was last synced with Asaas.
-- ============================================================

ALTER TABLE account_subscriptions
  ADD COLUMN IF NOT EXISTS pending_invoice_url TEXT,
  ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_account_subscriptions_external
  ON account_subscriptions (external_subscription_id)
  WHERE external_subscription_id IS NOT NULL;

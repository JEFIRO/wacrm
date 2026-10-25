-- ============================================================
-- 071_annual_plan_no_setup_fee.sql
--
-- Decisions of the user (2026-10-25, docs/saas/b1-planos.md):
--   * no setup fee — the column goes away;
--   * an annual "complete" plan: 12 monthly instalments of a value still
--     to be decided (price NULL = "a definir"), Business limits.
-- ============================================================

ALTER TABLE plans DROP COLUMN IF EXISTS setup_fee_cents;

-- How the plan is billed: monthly, or a 12-month commitment paid in
-- instalments of monthly_price_cents.
ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS billing_cycle TEXT NOT NULL DEFAULT 'monthly'
    CHECK (billing_cycle IN ('monthly', 'yearly'));

-- A plan may be listed before its price is decided.
ALTER TABLE plans ALTER COLUMN monthly_price_cents DROP NOT NULL;

INSERT INTO plans (id, name, monthly_price_cents, included_users, max_numbers, billing_cycle, sort_order)
VALUES ('anual', 'Anual Completo', NULL, 15, 7, 'yearly', 4)
ON CONFLICT (id) DO NOTHING;

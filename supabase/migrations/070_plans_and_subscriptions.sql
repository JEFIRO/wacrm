-- ============================================================
-- 070_plans_and_subscriptions.sql
--
-- Plans and each account's subscription — docs/saas/b1-planos.md.
-- Model decided by the user (2026-10-25): plans with users included,
-- extra users paid on top, and a 30-day free trial for new accounts.
-- Payment (Asaas) is B2; this only stores the state and the limits.
--
--   plans                  catalogue, editable without a deploy
--   account_subscriptions  one row per account (created by trigger)
--   number limit           a number beyond the plan's max is refused
-- ============================================================

-- ---- plans -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  monthly_price_cents INTEGER NOT NULL CHECK (monthly_price_cents >= 0),
  setup_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (setup_fee_cents >= 0),
  included_users INTEGER NOT NULL CHECK (included_users >= 1),
  max_numbers INTEGER NOT NULL CHECK (max_numbers >= 1),
  -- NULL until the price of an extra user is decided.
  extra_user_price_cents INTEGER CHECK (extra_user_price_cents >= 0),
  -- NULL = no monthly API quota (P3 will enforce it).
  api_monthly_quota INTEGER CHECK (api_monthly_quota >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS plans_select ON plans;
CREATE POLICY plans_select ON plans FOR SELECT TO authenticated USING (true);

-- Values proposed in docs/CLAUDE_HANDOFF.md; change them here or in the
-- table — the app reads the table.
INSERT INTO plans (id, name, monthly_price_cents, setup_fee_cents, included_users, max_numbers, sort_order)
VALUES
  ('essencial', 'Essencial', 14900, 30000, 2, 2, 1),
  ('profissional', 'Profissional', 34900, 60000, 5, 5, 2),
  ('business', 'Business', 79900, 150000, 15, 7, 3)
ON CONFLICT (id) DO NOTHING;

-- ---- subscriptions -------------------------------------------------------
CREATE TABLE IF NOT EXISTS account_subscriptions (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  status TEXT NOT NULL DEFAULT 'trialing'
    CHECK (status IN ('trialing', 'active', 'past_due', 'suspended', 'canceled')),
  trial_ends_at TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  extra_users INTEGER NOT NULL DEFAULT 0 CHECK (extra_users >= 0),
  -- Filled by the payment provider integration (B2).
  billing_provider TEXT,
  external_customer_id TEXT,
  external_subscription_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Members read their account's subscription; nobody writes from the
-- client — plan changes and payment state come from the server (B2).
ALTER TABLE account_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS account_subscriptions_select ON account_subscriptions;
CREATE POLICY account_subscriptions_select ON account_subscriptions
  FOR SELECT USING (is_account_member(account_id));

-- The plan a trial gets: limits of the middle plan while the customer
-- evaluates (decision to confirm — docs/saas/b1-planos.md).
CREATE OR REPLACE FUNCTION public.accounts_start_trial()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO account_subscriptions (account_id, plan_id, status, trial_ends_at)
  VALUES (NEW.id, 'profissional', 'trialing', NOW() + INTERVAL '30 days')
  ON CONFLICT (account_id) DO NOTHING;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.accounts_start_trial() OWNER TO postgres;

DROP TRIGGER IF EXISTS accounts_start_trial ON accounts;
CREATE TRIGGER accounts_start_trial
  AFTER INSERT ON accounts
  FOR EACH ROW EXECUTE FUNCTION public.accounts_start_trial();

-- Accounts that already exist start their trial now.
INSERT INTO account_subscriptions (account_id, plan_id, status, trial_ends_at)
SELECT id, 'profissional', 'trialing', NOW() + INTERVAL '30 days' FROM accounts
ON CONFLICT (account_id) DO NOTHING;

-- ---- number limit (B4) -----------------------------------------------------
-- A new WhatsApp number beyond the plan's max_numbers is refused.
-- Accounts without a subscription row (shouldn't happen) are not limited.
CREATE OR REPLACE FUNCTION public.whatsapp_config_plan_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('whatsapp_numbers:' || NEW.account_id::text));
  SELECT p.max_numbers INTO v_max
  FROM account_subscriptions s JOIN plans p ON p.id = s.plan_id
  WHERE s.account_id = NEW.account_id;
  IF v_max IS NOT NULL AND (
    SELECT count(*) FROM whatsapp_config WHERE account_id = NEW.account_id
  ) >= v_max THEN
    RAISE EXCEPTION 'plan_number_limit' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.whatsapp_config_plan_limit() OWNER TO postgres;

DROP TRIGGER IF EXISTS whatsapp_config_plan_limit ON whatsapp_config;
CREATE TRIGGER whatsapp_config_plan_limit
  BEFORE INSERT ON whatsapp_config
  FOR EACH ROW EXECUTE FUNCTION public.whatsapp_config_plan_limit();

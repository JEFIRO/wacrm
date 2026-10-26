-- ============================================================
-- 075_platform_admin.sql
--
-- B6 — the SaaS owner's panel (docs/saas/b6-painel.md). Who is a
-- platform admin is decided on the server (PLATFORM_ADMIN_EMAILS), never
-- by a table a client could write. This migration only adds:
--
--   platform_accounts_overview()  one row per customer account with the
--                                 numbers the panel shows (service role)
--   platform_audit                every action taken from the panel
-- ============================================================

CREATE TABLE IF NOT EXISTS platform_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_email TEXT NOT NULL,
  account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_audit_account ON platform_audit (account_id, created_at DESC);

-- No client policy at all: only the service role (the panel's API) reads
-- and writes it.
ALTER TABLE platform_audit ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.platform_accounts_overview()
RETURNS TABLE (
  account_id UUID,
  account_name TEXT,
  created_at TIMESTAMPTZ,
  owner_email TEXT,
  plan_id TEXT,
  plan_name TEXT,
  status TEXT,
  trial_ends_at TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  extra_users INTEGER,
  monthly_price_cents INTEGER,
  extra_user_price_cents INTEGER,
  external_customer_id TEXT,
  seats_used BIGINT,
  seats_limit INTEGER,
  numbers BIGINT,
  provider TEXT,
  messages_30d BIGINT,
  last_message_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.id,
    a.name,
    a.created_at,
    (SELECT p.email FROM profiles p WHERE p.user_id = a.owner_user_id),
    s.plan_id,
    pl.name,
    s.status,
    s.trial_ends_at,
    s.current_period_end,
    s.extra_users,
    pl.monthly_price_cents,
    pl.extra_user_price_cents,
    s.external_customer_id,
    (SELECT count(*) FROM profiles p WHERE p.account_id = a.id AND p.account_role::text <> 'viewer'),
    pl.included_users + COALESCE(s.extra_users, 0),
    (SELECT count(*) FROM whatsapp_config w WHERE w.account_id = a.id),
    (SELECT w.provider FROM whatsapp_config w WHERE w.account_id = a.id ORDER BY w.is_default DESC LIMIT 1),
    (SELECT count(*) FROM messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE c.account_id = a.id AND m.created_at > NOW() - INTERVAL '30 days'),
    (SELECT max(c.last_message_at) FROM conversations c WHERE c.account_id = a.id)
  FROM accounts a
  LEFT JOIN account_subscriptions s ON s.account_id = a.id
  LEFT JOIN plans pl ON pl.id = s.plan_id
  ORDER BY a.created_at DESC;
$$;

ALTER FUNCTION public.platform_accounts_overview() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.platform_accounts_overview() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_accounts_overview() TO service_role;

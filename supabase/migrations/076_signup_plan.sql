-- ============================================================
-- 076_signup_plan.sql
--
-- B5 — sign up straight into a plan (docs/saas/b5-cadastro.md).
--
--   * active plans are readable without signing in: the signup page
--     lists them (prices are public anyway);
--   * the 30-day trial starts on the plan the person picked when signing
--     up (auth user metadata "plan", e.g. from /signup?plano=essencial);
--     an unknown or inactive id falls back to the recommended plan.
-- ============================================================

DROP POLICY IF EXISTS plans_select_public ON plans;
CREATE POLICY plans_select_public ON plans FOR SELECT TO anon USING (active);

CREATE OR REPLACE FUNCTION public.accounts_start_trial()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan TEXT;
BEGIN
  SELECT p.id INTO v_plan
  FROM auth.users u
  JOIN plans p ON p.id = u.raw_user_meta_data ->> 'plan' AND p.active
  WHERE u.id = NEW.owner_user_id;

  INSERT INTO account_subscriptions (account_id, plan_id, status, trial_ends_at)
  VALUES (NEW.id, COALESCE(v_plan, 'impulso'), 'trialing', NOW() + INTERVAL '30 days')
  ON CONFLICT (account_id) DO NOTHING;
  RETURN NEW;
END;
$$;

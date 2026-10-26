-- ============================================================
-- 073_plan_seat_limit.sql
--
-- B3 (docs/saas/b3-assentos.md): an account has as many seats as its
-- plan's included users plus the extra users it bought. Every member but
-- a read-only viewer takes a seat. A profile joining the account (the
-- invitation being redeemed) or a viewer being promoted is refused when
-- no seat is left — 'plan_seat_limit'. Members already in place are never
-- removed (e.g. after a downgrade); only new seats are checked.
-- Accounts without a subscription row are not limited.
-- ============================================================

CREATE OR REPLACE FUNCTION public.profiles_plan_seat_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INTEGER;
  v_used INTEGER;
BEGIN
  IF NEW.account_id IS NULL OR NEW.account_role::text = 'viewer' THEN
    RETURN NEW;
  END IF;
  -- Already holding a seat in this account (e.g. admin -> agent): no change.
  IF TG_OP = 'UPDATE'
     AND OLD.account_id IS NOT DISTINCT FROM NEW.account_id
     AND OLD.account_role::text <> 'viewer' THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('account_seats:' || NEW.account_id::text));
  SELECT p.included_users + s.extra_users INTO v_limit
  FROM account_subscriptions s JOIN plans p ON p.id = s.plan_id
  WHERE s.account_id = NEW.account_id;
  IF v_limit IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_used
  FROM profiles
  WHERE account_id = NEW.account_id
    AND account_role::text <> 'viewer'
    AND user_id <> NEW.user_id;
  IF v_used + 1 > v_limit THEN
    RAISE EXCEPTION 'plan_seat_limit' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.profiles_plan_seat_limit() OWNER TO postgres;

DROP TRIGGER IF EXISTS profiles_plan_seat_limit ON profiles;
CREATE TRIGGER profiles_plan_seat_limit
  BEFORE INSERT OR UPDATE OF account_id, account_role ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_plan_seat_limit();

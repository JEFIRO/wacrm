-- ============================================================
-- 064_sector_rules.sql
--
-- Two invariants asked for by the product (docs/saas/setores-e-distribuicao.md):
--
--   1. a sector always has at least one member — it is created together
--      with its members (create_sector) and its last member cannot leave;
--   2. a member of a sector always has a weekly schedule — nobody joins a
--      sector without one, and a sector member's schedule cannot be
--      emptied (replace_agent_schedule swaps it atomically).
--
-- Both are checked at COMMIT (deferred constraint triggers), so a single
-- transaction may pass through an intermediate state — e.g. delete and
-- re-insert a schedule, or create a sector and then add its members.
--
-- Someone leaving the account (remove_account_member moves their profile
-- to a new account) loses their sectors, schedule and settings in the old
-- one; if they were a sector's only member, the removal is refused.
--
-- Errors use SQLSTATE 23514 and a stable message the app maps to text:
--   sector_needs_member   sector_member_needs_schedule
-- ============================================================

-- ---- 1) a sector has at least one member --------------------------
CREATE OR REPLACE FUNCTION public.sector_has_member_check()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sector UUID;
BEGIN
  -- Field access is resolved per row type, so branch instead of CASE.
  IF TG_TABLE_NAME = 'sectors' THEN
    v_sector := NEW.id;
  ELSE
    v_sector := OLD.sector_id;
  END IF;
  IF EXISTS (SELECT 1 FROM sectors WHERE id = v_sector)
     AND NOT EXISTS (SELECT 1 FROM sector_members WHERE sector_id = v_sector) THEN
    RAISE EXCEPTION 'sector_needs_member' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

ALTER FUNCTION public.sector_has_member_check() OWNER TO postgres;

DROP TRIGGER IF EXISTS sectors_need_member ON sectors;
CREATE CONSTRAINT TRIGGER sectors_need_member
  AFTER INSERT ON sectors
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.sector_has_member_check();

DROP TRIGGER IF EXISTS sector_members_keep_one ON sector_members;
CREATE CONSTRAINT TRIGGER sector_members_keep_one
  AFTER DELETE OR UPDATE ON sector_members
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.sector_has_member_check();

-- ---- 2) a sector member has a schedule ------------------------------
CREATE OR REPLACE FUNCTION public.sector_member_schedule_check()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID;
  v_account UUID;
BEGIN
  IF TG_TABLE_NAME = 'sector_members' THEN
    v_user := NEW.user_id;
    v_account := NEW.account_id;
  ELSE
    v_user := OLD.user_id;
    v_account := OLD.account_id;
  END IF;
  IF EXISTS (SELECT 1 FROM sector_members WHERE user_id = v_user AND account_id = v_account)
     AND NOT EXISTS (
       SELECT 1 FROM agent_schedules WHERE user_id = v_user AND account_id = v_account
     ) THEN
    RAISE EXCEPTION 'sector_member_needs_schedule' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

ALTER FUNCTION public.sector_member_schedule_check() OWNER TO postgres;

DROP TRIGGER IF EXISTS sector_members_need_schedule ON sector_members;
CREATE CONSTRAINT TRIGGER sector_members_need_schedule
  AFTER INSERT OR UPDATE ON sector_members
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.sector_member_schedule_check();

DROP TRIGGER IF EXISTS agent_schedules_keep_one ON agent_schedules;
CREATE CONSTRAINT TRIGGER agent_schedules_keep_one
  AFTER DELETE OR UPDATE ON agent_schedules
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.sector_member_schedule_check();

-- ---- 3) leaving the account clears the old account's agent rows ------
CREATE OR REPLACE FUNCTION public.profiles_leave_account_cleanup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM sector_members WHERE user_id = OLD.user_id AND account_id = OLD.account_id;
  DELETE FROM agent_schedules WHERE user_id = OLD.user_id AND account_id = OLD.account_id;
  DELETE FROM agent_settings WHERE user_id = OLD.user_id AND account_id = OLD.account_id;
  RETURN NULL;
END;
$$;

ALTER FUNCTION public.profiles_leave_account_cleanup() OWNER TO postgres;

DROP TRIGGER IF EXISTS profiles_leave_account_cleanup ON profiles;
CREATE TRIGGER profiles_leave_account_cleanup
  AFTER UPDATE OF account_id ON profiles
  FOR EACH ROW
  WHEN (OLD.account_id IS DISTINCT FROM NEW.account_id)
  EXECUTE FUNCTION public.profiles_leave_account_cleanup();

-- ---- 4) create a sector with its members in one transaction ----------
-- SECURITY INVOKER: the sectors / sector_members policies (admin only)
-- and the membership guard of 061 still apply.
CREATE OR REPLACE FUNCTION public.create_sector(
  p_account_id UUID,
  p_name TEXT,
  p_member_ids UUID[]
) RETURNS UUID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF coalesce(cardinality(p_member_ids), 0) = 0 THEN
    RAISE EXCEPTION 'sector_needs_member' USING ERRCODE = '23514';
  END IF;

  INSERT INTO sectors (account_id, name)
  VALUES (p_account_id, btrim(p_name))
  RETURNING id INTO v_id;

  INSERT INTO sector_members (sector_id, user_id, account_id)
  SELECT v_id, m, p_account_id FROM unnest(p_member_ids) AS m
  ON CONFLICT DO NOTHING;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_sector(UUID, TEXT, UUID[]) TO authenticated, service_role;

-- ---- 5) replace an agent's schedule atomically -----------------------
-- Delete + insert in one transaction, so a sector member's schedule is
-- never seen empty in between. Server-only: /api/agents/schedule checks
-- the caller (admin) and validates the ranges.
CREATE OR REPLACE FUNCTION public.replace_agent_schedule(
  p_account_id UUID,
  p_user_id UUID,
  p_ranges JSONB
) RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  DELETE FROM agent_schedules WHERE user_id = p_user_id AND account_id = p_account_id;

  INSERT INTO agent_schedules (user_id, account_id, weekday, start_time, end_time)
  SELECT p_user_id, p_account_id, (r->>'weekday')::SMALLINT, (r->>'start')::TIME, (r->>'end')::TIME
  FROM jsonb_array_elements(coalesce(p_ranges, '[]'::jsonb)) AS r;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_agent_schedule(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_agent_schedule(UUID, UUID, JSONB) TO service_role;

-- ============================================================
-- 063_lead_distribution.sql
--
-- Automatic lead distribution inside a sector — spec in
-- docs/saas/setores-e-distribuicao.md. The decision (who gets the lead)
-- lives in src/lib/distribution; the database keeps the state and makes
-- the final assignment atomic (claim_lead).
-- ============================================================

-- ---- account timezone --------------------------------------------
-- Agent schedules are wall-clock times in the account's zone.
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo';

-- ---- per-agent settings ------------------------------------------
-- is_online: manual "I'm working now" switch (not the automatic
-- presence of member_presence). max_active_leads: simultaneous cap.
CREATE TABLE IF NOT EXISTS agent_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  is_online BOOLEAN NOT NULL DEFAULT FALSE,
  max_active_leads INTEGER NOT NULL DEFAULT 3 CHECK (max_active_leads BETWEEN 1 AND 100),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_settings_account ON agent_settings (account_id);

-- Weekly schedule: several ranges per day allowed. weekday 0 = Sunday.
-- An agent with no rows has no time restriction.
CREATE TABLE IF NOT EXISTS agent_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_agent_schedules_user ON agent_schedules (user_id);

-- account_id comes from the agent's profile: a client cannot write rows
-- for someone outside its account.
CREATE OR REPLACE FUNCTION public.agent_rows_account_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SELECT account_id INTO NEW.account_id FROM profiles WHERE user_id = NEW.user_id;
  IF NEW.account_id IS NULL THEN
    RAISE EXCEPTION 'user is not a member of an account' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.agent_rows_account_guard() OWNER TO postgres;

DROP TRIGGER IF EXISTS agent_settings_account_guard ON agent_settings;
CREATE TRIGGER agent_settings_account_guard
  BEFORE INSERT OR UPDATE ON agent_settings
  FOR EACH ROW EXECUTE FUNCTION public.agent_rows_account_guard();

DROP TRIGGER IF EXISTS agent_schedules_account_guard ON agent_schedules;
CREATE TRIGGER agent_schedules_account_guard
  BEFORE INSERT OR UPDATE ON agent_schedules
  FOR EACH ROW EXECUTE FUNCTION public.agent_rows_account_guard();

-- Members read; the agent edits their own row; admins edit anyone's.
-- The app writes through /api/agents/* (which also re-runs distribution);
-- these policies are the backstop.
ALTER TABLE agent_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_settings_select ON agent_settings;
DROP POLICY IF EXISTS agent_settings_write ON agent_settings;
CREATE POLICY agent_settings_select ON agent_settings
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY agent_settings_write ON agent_settings FOR ALL
  USING (user_id = auth.uid() OR is_account_member(account_id, 'admin'))
  WITH CHECK (user_id = auth.uid() OR is_account_member(account_id, 'admin'));

ALTER TABLE agent_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_schedules_select ON agent_schedules;
DROP POLICY IF EXISTS agent_schedules_write ON agent_schedules;
CREATE POLICY agent_schedules_select ON agent_schedules
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY agent_schedules_write ON agent_schedules FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- ---- lead state on the conversation --------------------------------
--   assigned_at          when the current owner got it
--   started_at           first agent message since then ("lead iniciado")
--   queued_at            waiting in the sector queue (no one eligible)
--   queue_notice_sent_at the "no agent available" message went out (once)
--   reassign_count       rebalancing moves, capped by the distributor
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS queued_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS queue_notice_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reassign_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_conversations_queue
  ON conversations (account_id, sector_id, queued_at)
  WHERE queued_at IS NOT NULL AND assigned_agent_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_agent_load
  ON conversations (assigned_agent_id)
  WHERE assigned_agent_id IS NOT NULL AND status <> 'closed';

-- A new owner restarts the clock: not started yet.
CREATE OR REPLACE FUNCTION public.conversations_assignment_stamp()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.assigned_agent_id IS DISTINCT FROM OLD.assigned_agent_id THEN
    NEW.assigned_at := CASE WHEN NEW.assigned_agent_id IS NULL THEN NULL ELSE NOW() END;
    NEW.started_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS conversations_assignment_stamp ON conversations;
CREATE TRIGGER conversations_assignment_stamp
  BEFORE INSERT OR UPDATE OF assigned_agent_id ON conversations
  FOR EACH ROW EXECUTE FUNCTION public.conversations_assignment_stamp();

-- First agent message after assignment = lead started. SECURITY DEFINER:
-- the stamp must land even when the sender's RLS could not update it.
CREATE OR REPLACE FUNCTION public.messages_mark_lead_started()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.sender_type = 'agent' THEN
    UPDATE conversations
    SET started_at = NOW()
    WHERE id = NEW.conversation_id
      AND assigned_agent_id IS NOT NULL
      AND started_at IS NULL;
  END IF;
  RETURN NULL;
END;
$$;

ALTER FUNCTION public.messages_mark_lead_started() OWNER TO postgres;

DROP TRIGGER IF EXISTS messages_mark_lead_started ON messages;
CREATE TRIGGER messages_mark_lead_started
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION public.messages_mark_lead_started();

-- ---- atomic assignment ------------------------------------------------
-- Gives `p_conversation_id` to `p_agent_id` only if the agent still has
-- room. The agent's settings row is locked FOR UPDATE, so two leads
-- distributed at the same time are serialized per agent and cannot both
-- take the last slot.
--
-- p_expected_owner: NULL to take a queued (unassigned) lead; the current
-- owner's id to rebalance — then the lead must still be unstarted and
-- owned by them, and reassign_count goes up.
CREATE OR REPLACE FUNCTION public.claim_lead(
  p_conversation_id UUID,
  p_agent_id UUID,
  p_expected_owner UUID DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
  v_max INTEGER;
  v_load INTEGER;
  v_rows INTEGER;
BEGIN
  SELECT account_id INTO v_account FROM conversations WHERE id = p_conversation_id;
  IF v_account IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT max_active_leads INTO v_max
  FROM agent_settings
  WHERE user_id = p_agent_id AND account_id = v_account AND is_online
  FOR UPDATE;
  IF v_max IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT count(*) INTO v_load
  FROM conversations
  WHERE account_id = v_account
    AND assigned_agent_id = p_agent_id
    AND status <> 'closed';
  IF v_load >= v_max THEN
    RETURN FALSE;
  END IF;

  UPDATE conversations
  SET assigned_agent_id = p_agent_id,
      queued_at = NULL,
      reassign_count = reassign_count + CASE WHEN p_expected_owner IS NULL THEN 0 ELSE 1 END,
      updated_at = NOW()
  WHERE id = p_conversation_id
    AND status <> 'closed'
    AND assigned_agent_id IS NOT DISTINCT FROM p_expected_owner
    AND (p_expected_owner IS NULL OR started_at IS NULL);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;

ALTER FUNCTION public.claim_lead(UUID, UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_lead(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_lead(UUID, UUID, UUID) TO service_role;

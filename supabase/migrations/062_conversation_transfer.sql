-- ============================================================
-- 062_conversation_transfer.sql
--
-- Hand a conversation to another sector — spec in
-- docs/saas/setores-e-distribuicao.md (C3).
--
-- Transferring changes conversations.sector_id (who handles the thread),
-- never whatsapp_config_id (the number replies go out from): switching
-- numbers would leave Meta's 24h window of that number.
-- ============================================================

-- ---- guard ------------------------------------------------------
--  * the sector must belong to the conversation's account;
--  * a client (auth.uid() set) may not repoint the sending number —
--    only fill it in on an orphaned conversation (C1 adoption). Service
--    role paths (webhook) have no auth.uid() and are not restricted.
CREATE OR REPLACE FUNCTION public.conversations_channel_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.sector_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sectors WHERE id = NEW.sector_id AND account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'sector must belong to the same account'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE'
     AND auth.uid() IS NOT NULL
     AND OLD.whatsapp_config_id IS NOT NULL
     AND NEW.whatsapp_config_id IS DISTINCT FROM OLD.whatsapp_config_id THEN
    RAISE EXCEPTION 'the sending number of a conversation cannot be changed'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS conversations_channel_guard ON conversations;
CREATE TRIGGER conversations_channel_guard
  BEFORE INSERT OR UPDATE OF sector_id, whatsapp_config_id ON conversations
  FOR EACH ROW EXECUTE FUNCTION public.conversations_channel_guard();

-- ---- transfer ---------------------------------------------------
-- An UPDATE cannot do this from the client: under RLS the row an UPDATE
-- produces must stay visible to its author, and handing a thread to a
-- sector you are not in makes it invisible. So: the caller must be an
-- agent who sees the conversation now; the guard validates the target.
-- Clears the assignment — the previous agent may not be in the new
-- sector — and returns whether the caller still sees the thread, so the
-- UI knows to drop it.
CREATE OR REPLACE FUNCTION public.transfer_conversation(
  p_conversation_id UUID,
  p_sector_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
  v_sector UUID;
BEGIN
  SELECT account_id, sector_id INTO v_account, v_sector
  FROM conversations WHERE id = p_conversation_id;

  IF v_account IS NULL
     OR NOT is_account_member(v_account, 'agent')
     OR NOT can_access_sector(v_account, v_sector) THEN
    RAISE EXCEPTION 'conversation not found' USING ERRCODE = '42501';
  END IF;

  UPDATE conversations
  SET sector_id = p_sector_id,
      assigned_agent_id = NULL,
      updated_at = NOW()
  WHERE id = p_conversation_id;

  RETURN can_access_sector(v_account, p_sector_id);
END;
$$;

ALTER FUNCTION public.transfer_conversation(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.transfer_conversation(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_conversation(UUID, UUID) TO authenticated, service_role;

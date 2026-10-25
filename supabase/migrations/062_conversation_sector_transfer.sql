-- ============================================================
-- 062_conversation_sector_transfer.sql
--
-- Hand a conversation to another sector's team — roadmap item C3, spec
-- in docs/saas/c3-transferencia.md.
--
-- The conversation keeps its WhatsApp number (whatsapp_config_id, the
-- number replies go out from); `sector_channel_id` says which number's
-- team handles it. Effective sector = COALESCE(sector, number), and the
-- C2 access check (061) now runs on that.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS sector_channel_id UUID
    REFERENCES whatsapp_config(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_sector_channel
  ON conversations (sector_channel_id)
  WHERE sector_channel_id IS NOT NULL;

-- ---- guard ------------------------------------------------------
--  * the sector must be a number of the same account;
--  * transferring back to the conversation's own number stores NULL;
--  * a client (auth.uid() set) may not repoint the sending number —
--    only fill it in on an orphaned conversation (C1 adoption). Service
--    role paths (webhook) have no auth.uid() and are not restricted.
CREATE OR REPLACE FUNCTION public.conversations_channel_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.sector_channel_id IS NOT NULL THEN
    IF NEW.sector_channel_id = NEW.whatsapp_config_id THEN
      NEW.sector_channel_id := NULL;
    ELSIF NOT EXISTS (
      SELECT 1 FROM whatsapp_config
      WHERE id = NEW.sector_channel_id AND account_id = NEW.account_id
    ) THEN
      RAISE EXCEPTION 'sector must be a WhatsApp number of the same account'
        USING ERRCODE = '42501';
    END IF;
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
  BEFORE INSERT OR UPDATE OF sector_channel_id, whatsapp_config_id ON conversations
  FOR EACH ROW EXECUTE FUNCTION public.conversations_channel_guard();

-- ---- policies: effective sector ---------------------------------
DROP POLICY IF EXISTS conversations_select ON conversations;
DROP POLICY IF EXISTS conversations_insert ON conversations;
DROP POLICY IF EXISTS conversations_update ON conversations;
DROP POLICY IF EXISTS conversations_delete ON conversations;
CREATE POLICY conversations_select ON conversations FOR SELECT
  USING (is_account_member(account_id)
         AND can_access_channel(account_id, COALESCE(sector_channel_id, whatsapp_config_id)));
CREATE POLICY conversations_insert ON conversations FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent')
              AND can_access_channel(account_id, COALESCE(sector_channel_id, whatsapp_config_id)));
-- Handing a thread to a sector the caller is not in cannot go through
-- this policy: an UPDATE that reads the row must leave it visible to the
-- caller (SELECT policies apply to the new row). transfer_conversation()
-- below does it instead.
CREATE POLICY conversations_update ON conversations FOR UPDATE
  USING (is_account_member(account_id, 'agent')
         AND can_access_channel(account_id, COALESCE(sector_channel_id, whatsapp_config_id)));
CREATE POLICY conversations_delete ON conversations FOR DELETE
  USING (is_account_member(account_id, 'agent')
         AND can_access_channel(account_id, COALESCE(sector_channel_id, whatsapp_config_id)));

DROP POLICY IF EXISTS messages_select ON messages;
DROP POLICY IF EXISTS messages_modify ON messages;
CREATE POLICY messages_select ON messages FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND is_account_member(c.account_id)
      AND can_access_channel(c.account_id, COALESCE(c.sector_channel_id, c.whatsapp_config_id))
  )
);
CREATE POLICY messages_modify ON messages FOR ALL USING (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND is_account_member(c.account_id, 'agent')
      AND can_access_channel(c.account_id, COALESCE(c.sector_channel_id, c.whatsapp_config_id))
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND is_account_member(c.account_id, 'agent')
      AND can_access_channel(c.account_id, COALESCE(c.sector_channel_id, c.whatsapp_config_id))
  )
);

DROP POLICY IF EXISTS message_reactions_select ON message_reactions;
DROP POLICY IF EXISTS message_reactions_modify ON message_reactions;
CREATE POLICY message_reactions_select ON message_reactions FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.id = message_reactions.message_id
      AND is_account_member(c.account_id)
      AND can_access_channel(c.account_id, COALESCE(c.sector_channel_id, c.whatsapp_config_id))
  )
);
CREATE POLICY message_reactions_modify ON message_reactions FOR ALL USING (
  EXISTS (
    SELECT 1 FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.id = message_reactions.message_id
      AND is_account_member(c.account_id, 'agent')
      AND can_access_channel(c.account_id, COALESCE(c.sector_channel_id, c.whatsapp_config_id))
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.id = message_reactions.message_id
      AND is_account_member(c.account_id, 'agent')
      AND can_access_channel(c.account_id, COALESCE(c.sector_channel_id, c.whatsapp_config_id))
  )
);

-- ---- transfer ---------------------------------------------------
-- The caller must be an agent who can see the conversation now; the
-- target must be a number of the same account (NULL = back to the
-- conversation's own number). Clears the assignment: the previous agent
-- may not belong to the new sector. Returns whether the caller can still
-- see the conversation afterwards, so the UI knows to drop it.
CREATE OR REPLACE FUNCTION public.transfer_conversation(
  p_conversation_id UUID,
  p_sector_channel_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
  v_effective UUID;
BEGIN
  SELECT account_id, COALESCE(sector_channel_id, whatsapp_config_id)
    INTO v_account, v_effective
  FROM conversations WHERE id = p_conversation_id;

  IF v_account IS NULL
     OR NOT is_account_member(v_account, 'agent')
     OR NOT can_access_channel(v_account, v_effective) THEN
    RAISE EXCEPTION 'conversation not found' USING ERRCODE = '42501';
  END IF;

  -- The guard trigger validates the target account and normalizes a
  -- transfer back to the conversation's own number to NULL.
  UPDATE conversations
  SET sector_channel_id = p_sector_channel_id,
      assigned_agent_id = NULL,
      updated_at = NOW()
  WHERE id = p_conversation_id;

  SELECT COALESCE(sector_channel_id, whatsapp_config_id) INTO v_effective
  FROM conversations WHERE id = p_conversation_id;
  RETURN can_access_channel(v_account, v_effective);
END;
$$;

ALTER FUNCTION public.transfer_conversation(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.transfer_conversation(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_conversation(UUID, UUID) TO authenticated, service_role;

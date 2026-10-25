-- ============================================================
-- 061_channel_access.sql
--
-- Sector access per WhatsApp number — roadmap item C2, spec in
-- docs/saas/c2-acesso-por-setor.md.
--
--   1. whatsapp_config_members: which users handle which number;
--   2. can_access_channel(): owners/admins see everything; a number with
--      no members is open to the whole account; a number with members is
--      visible only to them; orphaned conversations stay open;
--   3. conversations / messages / message_reactions policies add that
--      check on top of account membership;
--   4. dashboard_overview runs as the caller so the same RLS filters it.
-- ============================================================

-- ---- 1) who handles which number --------------------------------
CREATE TABLE IF NOT EXISTS whatsapp_config_members (
  whatsapp_config_id UUID NOT NULL REFERENCES whatsapp_config(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (whatsapp_config_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_config_members_user
  ON whatsapp_config_members (user_id);

-- account_id always comes from the number, and the user must belong to
-- that account — a client cannot attach a stranger or cross tenants.
CREATE OR REPLACE FUNCTION public.whatsapp_config_members_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SELECT account_id INTO NEW.account_id
  FROM whatsapp_config WHERE id = NEW.whatsapp_config_id;

  IF NEW.account_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE user_id = NEW.user_id AND account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'user is not a member of the number''s account'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.whatsapp_config_members_guard() OWNER TO postgres;

DROP TRIGGER IF EXISTS whatsapp_config_members_guard ON whatsapp_config_members;
CREATE TRIGGER whatsapp_config_members_guard
  BEFORE INSERT OR UPDATE ON whatsapp_config_members
  FOR EACH ROW EXECUTE FUNCTION public.whatsapp_config_members_guard();

ALTER TABLE whatsapp_config_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_config_members_select ON whatsapp_config_members;
DROP POLICY IF EXISTS whatsapp_config_members_insert ON whatsapp_config_members;
DROP POLICY IF EXISTS whatsapp_config_members_delete ON whatsapp_config_members;
CREATE POLICY whatsapp_config_members_select ON whatsapp_config_members
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY whatsapp_config_members_insert ON whatsapp_config_members
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY whatsapp_config_members_delete ON whatsapp_config_members
  FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ---- 2) access rule ---------------------------------------------
-- SECURITY DEFINER so policy bodies can read the membership table
-- without recursive RLS. Account membership itself is still checked by
-- is_account_member() in each policy; this only narrows within the
-- account.
CREATE OR REPLACE FUNCTION public.can_access_channel(
  target_account_id UUID,
  target_channel_id UUID
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT target_channel_id IS NULL
    OR is_account_member(target_account_id, 'admin')
    OR NOT EXISTS (
      SELECT 1 FROM whatsapp_config_members m
      WHERE m.whatsapp_config_id = target_channel_id
    )
    OR EXISTS (
      SELECT 1 FROM whatsapp_config_members m
      WHERE m.whatsapp_config_id = target_channel_id
        AND m.user_id = auth.uid()
    );
$$;

ALTER FUNCTION public.can_access_channel(UUID, UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.can_access_channel(UUID, UUID) TO authenticated, service_role;

-- ---- 3) policies ------------------------------------------------
DROP POLICY IF EXISTS conversations_select ON conversations;
DROP POLICY IF EXISTS conversations_insert ON conversations;
DROP POLICY IF EXISTS conversations_update ON conversations;
DROP POLICY IF EXISTS conversations_delete ON conversations;
CREATE POLICY conversations_select ON conversations FOR SELECT
  USING (is_account_member(account_id) AND can_access_channel(account_id, whatsapp_config_id));
CREATE POLICY conversations_insert ON conversations FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent') AND can_access_channel(account_id, whatsapp_config_id));
CREATE POLICY conversations_update ON conversations FOR UPDATE
  USING (is_account_member(account_id, 'agent') AND can_access_channel(account_id, whatsapp_config_id));
CREATE POLICY conversations_delete ON conversations FOR DELETE
  USING (is_account_member(account_id, 'agent') AND can_access_channel(account_id, whatsapp_config_id));

DROP POLICY IF EXISTS messages_select ON messages;
DROP POLICY IF EXISTS messages_modify ON messages;
CREATE POLICY messages_select ON messages FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND is_account_member(c.account_id)
      AND can_access_channel(c.account_id, c.whatsapp_config_id)
  )
);
CREATE POLICY messages_modify ON messages FOR ALL USING (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND is_account_member(c.account_id, 'agent')
      AND can_access_channel(c.account_id, c.whatsapp_config_id)
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND is_account_member(c.account_id, 'agent')
      AND can_access_channel(c.account_id, c.whatsapp_config_id)
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
      AND can_access_channel(c.account_id, c.whatsapp_config_id)
  )
);
CREATE POLICY message_reactions_modify ON message_reactions FOR ALL USING (
  EXISTS (
    SELECT 1 FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.id = message_reactions.message_id
      AND is_account_member(c.account_id, 'agent')
      AND can_access_channel(c.account_id, c.whatsapp_config_id)
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.id = message_reactions.message_id
      AND is_account_member(c.account_id, 'agent')
      AND can_access_channel(c.account_id, c.whatsapp_config_id)
  )
);

-- ---- 4) dashboard follows the caller's RLS -----------------------
-- It was SECURITY DEFINER, which returned previews (contact name, last
-- message) of every conversation in the account. As INVOKER the
-- policies above filter it; every table it reads is member-readable.
ALTER FUNCTION public.dashboard_overview(INTEGER, TEXT) SECURITY INVOKER;

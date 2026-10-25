-- ============================================================
-- 061_sectors.sql
--
-- Sectors of an account and sector-based access — spec in
-- docs/saas/setores-e-distribuicao.md (supersedes the per-number teams
-- of the first C2 draft).
--
--   1. sectors + sector_members: a sector belongs to the account, not to
--      a WhatsApp number; an agent can be in several sectors;
--   2. each number has a default sector, inherited by new conversations;
--      conversations.sector_id says which team handles the thread;
--   3. can_access_sector(): owners/admins see everything; a sector with
--      no members is open to the whole account; a conversation without a
--      sector is open;
--   4. conversations / messages / message_reactions policies add that
--      check on top of account membership;
--   5. dashboard_overview runs as the caller so the same RLS filters it.
-- ============================================================

-- ---- 1) sectors -------------------------------------------------
CREATE TABLE IF NOT EXISTS sectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sectors_account_name
  ON sectors (account_id, lower(btrim(name)));

ALTER TABLE sectors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sectors_select ON sectors;
DROP POLICY IF EXISTS sectors_insert ON sectors;
DROP POLICY IF EXISTS sectors_update ON sectors;
DROP POLICY IF EXISTS sectors_delete ON sectors;
CREATE POLICY sectors_select ON sectors FOR SELECT USING (is_account_member(account_id));
CREATE POLICY sectors_insert ON sectors FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY sectors_update ON sectors FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY sectors_delete ON sectors FOR DELETE USING (is_account_member(account_id, 'admin'));

CREATE TABLE IF NOT EXISTS sector_members (
  sector_id UUID NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (sector_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_sector_members_user ON sector_members (user_id);

-- account_id always comes from the sector, and the user must belong to
-- that account — a client cannot attach a stranger or cross tenants.
CREATE OR REPLACE FUNCTION public.sector_members_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SELECT account_id INTO NEW.account_id FROM sectors WHERE id = NEW.sector_id;

  IF NEW.account_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE user_id = NEW.user_id AND account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'user is not a member of the sector''s account'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.sector_members_guard() OWNER TO postgres;

DROP TRIGGER IF EXISTS sector_members_guard ON sector_members;
CREATE TRIGGER sector_members_guard
  BEFORE INSERT OR UPDATE ON sector_members
  FOR EACH ROW EXECUTE FUNCTION public.sector_members_guard();

ALTER TABLE sector_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sector_members_select ON sector_members;
DROP POLICY IF EXISTS sector_members_insert ON sector_members;
DROP POLICY IF EXISTS sector_members_delete ON sector_members;
CREATE POLICY sector_members_select ON sector_members
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY sector_members_insert ON sector_members
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY sector_members_delete ON sector_members
  FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ---- 2) default sector per number, sector per conversation ----------
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS default_sector_id UUID REFERENCES sectors(id) ON DELETE SET NULL;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS sector_id UUID REFERENCES sectors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_sector
  ON conversations (sector_id) WHERE sector_id IS NOT NULL;

-- A number's default sector must be a sector of the same account.
CREATE OR REPLACE FUNCTION public.whatsapp_config_sector_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.default_sector_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sectors
    WHERE id = NEW.default_sector_id AND account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'default sector must belong to the same account'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS whatsapp_config_sector_guard ON whatsapp_config;
CREATE TRIGGER whatsapp_config_sector_guard
  BEFORE INSERT OR UPDATE OF default_sector_id ON whatsapp_config
  FOR EACH ROW EXECUTE FUNCTION public.whatsapp_config_sector_guard();

-- A new conversation starts in its number's default sector. SECURITY
-- DEFINER: the inserting client may not be allowed to read the number.
CREATE OR REPLACE FUNCTION public.conversations_default_sector()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.sector_id IS NULL AND NEW.whatsapp_config_id IS NOT NULL THEN
    SELECT default_sector_id INTO NEW.sector_id
    FROM whatsapp_config WHERE id = NEW.whatsapp_config_id;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.conversations_default_sector() OWNER TO postgres;

DROP TRIGGER IF EXISTS conversations_default_sector ON conversations;
CREATE TRIGGER conversations_default_sector
  BEFORE INSERT ON conversations
  FOR EACH ROW EXECUTE FUNCTION public.conversations_default_sector();

-- ---- 3) access rule ---------------------------------------------
-- SECURITY DEFINER so policy bodies can read sector_members without
-- recursive RLS. Account membership itself is still checked by
-- is_account_member() in each policy; this only narrows within it.
CREATE OR REPLACE FUNCTION public.can_access_sector(
  target_account_id UUID,
  target_sector_id UUID
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT target_sector_id IS NULL
    OR is_account_member(target_account_id, 'admin')
    OR NOT EXISTS (
      SELECT 1 FROM sector_members m WHERE m.sector_id = target_sector_id
    )
    OR EXISTS (
      SELECT 1 FROM sector_members m
      WHERE m.sector_id = target_sector_id AND m.user_id = auth.uid()
    );
$$;

ALTER FUNCTION public.can_access_sector(UUID, UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.can_access_sector(UUID, UUID) TO authenticated, service_role;

-- ---- 4) policies ------------------------------------------------
DROP POLICY IF EXISTS conversations_select ON conversations;
DROP POLICY IF EXISTS conversations_insert ON conversations;
DROP POLICY IF EXISTS conversations_update ON conversations;
DROP POLICY IF EXISTS conversations_delete ON conversations;
CREATE POLICY conversations_select ON conversations FOR SELECT
  USING (is_account_member(account_id) AND can_access_sector(account_id, sector_id));
CREATE POLICY conversations_insert ON conversations FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent') AND can_access_sector(account_id, sector_id));
CREATE POLICY conversations_update ON conversations FOR UPDATE
  USING (is_account_member(account_id, 'agent') AND can_access_sector(account_id, sector_id));
CREATE POLICY conversations_delete ON conversations FOR DELETE
  USING (is_account_member(account_id, 'agent') AND can_access_sector(account_id, sector_id));

DROP POLICY IF EXISTS messages_select ON messages;
DROP POLICY IF EXISTS messages_modify ON messages;
CREATE POLICY messages_select ON messages FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND is_account_member(c.account_id)
      AND can_access_sector(c.account_id, c.sector_id)
  )
);
CREATE POLICY messages_modify ON messages FOR ALL USING (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND is_account_member(c.account_id, 'agent')
      AND can_access_sector(c.account_id, c.sector_id)
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND is_account_member(c.account_id, 'agent')
      AND can_access_sector(c.account_id, c.sector_id)
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
      AND can_access_sector(c.account_id, c.sector_id)
  )
);
CREATE POLICY message_reactions_modify ON message_reactions FOR ALL USING (
  EXISTS (
    SELECT 1 FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.id = message_reactions.message_id
      AND is_account_member(c.account_id, 'agent')
      AND can_access_sector(c.account_id, c.sector_id)
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.id = message_reactions.message_id
      AND is_account_member(c.account_id, 'agent')
      AND can_access_sector(c.account_id, c.sector_id)
  )
);

-- ---- 5) dashboard follows the caller's RLS -----------------------
-- It was SECURITY DEFINER, which returned previews (contact name, last
-- message) of every conversation in the account. As INVOKER the
-- policies above filter it; every table it reads is member-readable.
ALTER FUNCTION public.dashboard_overview(INTEGER, TEXT) SECURITY INVOKER;

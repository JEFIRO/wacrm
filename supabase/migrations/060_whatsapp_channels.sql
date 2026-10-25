-- ============================================================
-- 060_whatsapp_channels.sql
--
-- Several WhatsApp numbers ("channels") per account — roadmap item C1,
-- spec in docs/saas/c1-canais.md.
--
-- A channel is a whatsapp_config row. This migration:
--   1. adds `label` (sector name shown in the UI) and `is_default`
--      (the channel used when an action has no conversation: broadcasts,
--      public API, templates);
--   2. swaps UNIQUE(account_id) for "at most one default per account",
--      kept true by triggers on insert/delete;
--   3. ties each conversation to the channel it belongs to and moves the
--      conversation uniqueness from (account, contact) to
--      (account, contact, channel) — one contact, one thread per number.
--
-- Existing data: every current config becomes its account's default
-- channel and every existing conversation is linked to it.
-- ============================================================

-- ---- 1) channel columns -------------------------------------
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS label TEXT,
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;

-- One row per account exists today (UNIQUE(account_id)), so each one
-- becomes that account's default.
UPDATE whatsapp_config SET is_default = TRUE WHERE is_default = FALSE;

-- ---- 2) many channels, one default --------------------------
ALTER TABLE whatsapp_config DROP CONSTRAINT IF EXISTS whatsapp_config_account_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_config_account_default
  ON whatsapp_config (account_id)
  WHERE is_default;

-- The first channel of an account is its default, whoever inserts it.
CREATE OR REPLACE FUNCTION public.whatsapp_config_default_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM whatsapp_config
    WHERE account_id = NEW.account_id AND is_default
  ) THEN
    NEW.is_default := TRUE;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS whatsapp_config_default_on_insert ON whatsapp_config;
CREATE TRIGGER whatsapp_config_default_on_insert
  BEFORE INSERT ON whatsapp_config
  FOR EACH ROW EXECUTE FUNCTION public.whatsapp_config_default_on_insert();

-- Deleting the default promotes the oldest remaining channel, so an
-- account with numbers never ends up without a default.
CREATE OR REPLACE FUNCTION public.whatsapp_config_default_on_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.is_default THEN
    UPDATE whatsapp_config
    SET is_default = TRUE
    WHERE id = (
      SELECT id FROM whatsapp_config
      WHERE account_id = OLD.account_id
      ORDER BY created_at ASC, id ASC
      LIMIT 1
    );
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS whatsapp_config_default_on_delete ON whatsapp_config;
CREATE TRIGGER whatsapp_config_default_on_delete
  AFTER DELETE ON whatsapp_config
  FOR EACH ROW EXECUTE FUNCTION public.whatsapp_config_default_on_delete();

-- ---- 3) conversation → channel ------------------------------
-- SET NULL on delete: disconnecting a number keeps its history. The
-- inbound webhook adopts an orphaned (NULL) conversation of the contact
-- before creating a new one, so reconnecting does not split the thread.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS whatsapp_config_id UUID
    REFERENCES whatsapp_config(id) ON DELETE SET NULL;

UPDATE conversations c
SET whatsapp_config_id = w.id
FROM whatsapp_config w
WHERE w.account_id = c.account_id
  AND w.is_default
  AND c.whatsapp_config_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_whatsapp_config
  ON conversations (whatsapp_config_id);

-- One thread per (account, contact, channel). NULLs stay distinct on
-- purpose: an orphaned conversation must never block a delete.
DROP INDEX IF EXISTS idx_conversations_account_contact;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_contact_channel
  ON conversations (account_id, contact_id, whatsapp_config_id);

-- ============================================================
-- 069_channel_guard_allows_removal.sql
--
-- Bug of 062: removing a WhatsApp number that has conversations failed
-- with "the sending number of a conversation cannot be changed". The
-- FK (060) sets conversations.whatsapp_config_id to NULL when the number
-- is deleted — keeping the history — and the guard took that for a
-- client repointing the thread. Both the Meta and the QR-code "remove
-- number" paths hit it.
--
-- Now the guard lets the number go to NULL when the old number no
-- longer exists (that is the FK cascade); repointing a thread to a
-- different number, or orphaning it while the number still exists,
-- stays forbidden for clients.
-- ============================================================

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
     AND NEW.whatsapp_config_id IS DISTINCT FROM OLD.whatsapp_config_id
     -- The number itself is being removed: ON DELETE SET NULL.
     AND NOT (
       NEW.whatsapp_config_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM whatsapp_config WHERE id = OLD.whatsapp_config_id)
     ) THEN
    RAISE EXCEPTION 'the sending number of a conversation cannot be changed'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

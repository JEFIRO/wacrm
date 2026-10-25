-- ============================================================
-- 067_account_single_provider.sql
--
-- An account talks through ONE kind of WhatsApp connection: the
-- official Meta API or QR-code numbers (Evolution), never both —
-- product decision of 2026-10-25 (docs/saas/w3-instancia.md). To switch,
-- the account removes every number of the current kind first.
--
-- Checked on insert and on a provider change; rows that already mix
-- kinds (none in production) are left as they are.
-- Error: SQLSTATE 23514, message 'account_provider_mismatch'.
-- ============================================================

CREATE OR REPLACE FUNCTION public.whatsapp_config_single_provider()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Serialize concurrent first numbers of the same account.
  PERFORM pg_advisory_xact_lock(hashtext('whatsapp_provider:' || NEW.account_id::text));
  IF EXISTS (
    SELECT 1 FROM whatsapp_config
    WHERE account_id = NEW.account_id
      AND id <> NEW.id
      AND provider <> NEW.provider
  ) THEN
    RAISE EXCEPTION 'account_provider_mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.whatsapp_config_single_provider() OWNER TO postgres;

DROP TRIGGER IF EXISTS whatsapp_config_single_provider ON whatsapp_config;
CREATE TRIGGER whatsapp_config_single_provider
  BEFORE INSERT OR UPDATE OF provider, account_id ON whatsapp_config
  FOR EACH ROW EXECUTE FUNCTION public.whatsapp_config_single_provider();

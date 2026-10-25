-- ============================================================
-- 066_whatsapp_provider.sql
--
-- Which provider a WhatsApp number talks through — docs/saas/w1-provedor.md.
-- 'meta' (Cloud API, every existing row) or 'evolution' (W2). The app
-- picks the implementation in src/lib/whatsapp/provider/.
-- ============================================================

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'meta'
    CHECK (provider IN ('meta', 'evolution'));

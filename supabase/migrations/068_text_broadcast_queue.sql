-- ============================================================
-- 068_text_broadcast_queue.sql
--
-- Text campaigns for QR-code (Evolution) accounts, sent from a queue
-- with a random pause between messages — docs/saas/w5-fila.md.
--
-- A 'text' broadcast has no template: `message_text` (with {{nome}}-style
-- placeholders) goes out one recipient at a time. The cron worker takes
-- a broadcast's turn by moving `next_send_at` forward (conditional
-- update — one worker per turn), sends to the oldest pending recipient
-- and schedules the next send `min..max_interval_seconds` later.
-- Template broadcasts are unchanged.
-- ============================================================

ALTER TABLE broadcasts
  ALTER COLUMN template_name DROP NOT NULL,
  ALTER COLUMN template_language DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'template'
    CHECK (kind IN ('template', 'text')),
  ADD COLUMN IF NOT EXISTS message_text TEXT,
  ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES whatsapp_config(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS min_interval_seconds INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS max_interval_seconds INTEGER NOT NULL DEFAULT 45,
  ADD COLUMN IF NOT EXISTS next_send_at TIMESTAMPTZ;

ALTER TABLE broadcasts DROP CONSTRAINT IF EXISTS broadcasts_kind_fields;
ALTER TABLE broadcasts ADD CONSTRAINT broadcasts_kind_fields CHECK (
  (kind = 'template' AND template_name IS NOT NULL)
  OR (kind = 'text' AND message_text IS NOT NULL AND length(btrim(message_text)) BETWEEN 1 AND 4096)
);

ALTER TABLE broadcasts DROP CONSTRAINT IF EXISTS broadcasts_interval_range;
ALTER TABLE broadcasts ADD CONSTRAINT broadcasts_interval_range CHECK (
  min_interval_seconds BETWEEN 5 AND 3600
  AND max_interval_seconds BETWEEN min_interval_seconds AND 3600
);

CREATE INDEX IF NOT EXISTS idx_broadcasts_text_queue
  ON broadcasts (next_send_at)
  WHERE kind = 'text' AND status = 'sending';

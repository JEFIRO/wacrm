-- ============================================================
-- 065_queue_notice_retry.sql
--
-- The "no agent available" notice of a queued lead is retried when the
-- send fails, instead of being lost — docs/saas/setores-e-distribuicao.md.
--
--   queue_notice_text        the rendered notice waiting to go out
--   queue_notice_user_id     author for the message row (the flow's owner)
--   queue_notice_attempts    sends tried so far
--   queue_notice_retry_at    next try (the cron picks it up); NULL = none due
--   queue_notice_failed_at   gave up after the last try — shown to admins
--
-- Server-only columns: written through the service role by
-- src/lib/distribution/distribute.ts, read by the settings screen.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS queue_notice_text TEXT,
  ADD COLUMN IF NOT EXISTS queue_notice_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS queue_notice_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS queue_notice_retry_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS queue_notice_failed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_conversations_queue_notice_retry
  ON conversations (queue_notice_retry_at)
  WHERE queue_notice_retry_at IS NOT NULL;

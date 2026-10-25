-- Post-migration assertions for the CI job in
-- `.github/workflows/migrations.yml`.
--
-- `supabase db reset` already fails on any statement Postgres rejects,
-- so this is not about syntax. It's about the quieter failure: a
-- migration that applies cleanly and does nothing. Every DDL statement
-- in this repo is guarded with IF NOT EXISTS / ON CONFLICT so the files
-- can be re-run safely, and that same guard turns a typo'd object name
-- into a silent no-op with a green checkmark.
--
-- Keep this thin. It is a smoke test for "did the migrations actually
-- build the schema", not a spec of it — asserting every column here
-- would just be the migrations restated in a second place, drifting.
DO $$
BEGIN
  -- The core tables, from 001.
  IF to_regclass('public.messages') IS NULL THEN
    RAISE EXCEPTION 'public.messages is missing — migrations did not apply';
  END IF;
  IF to_regclass('public.whatsapp_config') IS NULL THEN
    RAISE EXCEPTION 'public.whatsapp_config is missing — migrations did not apply';
  END IF;

  -- Supabase provides the storage schema; migrations 016/020/023 write
  -- to it. If it is absent the bucket migrations silently accomplish
  -- nothing, which is precisely the case a plain "no errors" run hides.
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE EXCEPTION
      'storage.buckets is missing — the storage schema was not available when the bucket migrations ran';
  END IF;

  -- Buckets are UPSERTed, so their absence means the INSERT never ran.
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'chat-media') THEN
    RAISE EXCEPTION 'the chat-media bucket row was not created (migration 023)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'flow-media') THEN
    RAISE EXCEPTION 'the flow-media bucket row was not created (migration 016)';
  END IF;

  -- Account scoping (017) is load-bearing for every RLS policy.
  IF to_regclass('public.accounts') IS NULL THEN
    RAISE EXCEPTION 'public.accounts is missing — migration 017 did not apply';
  END IF;

  -- The BSUID index (040) is the only thing stopping a username-only
  -- WhatsApp sender from forking a new contact per inbound message. A
  -- typo in its name would apply cleanly and guarantee nothing.
  IF to_regclass('public.idx_contacts_account_wa_user_id') IS NULL THEN
    RAISE EXCEPTION
      'idx_contacts_account_wa_user_id is missing — migration 040 did not apply';
  END IF;

  -- 041 repairs create_broadcast_with_recipients, which 037/038 shipped
  -- with an ambiguous bare `RETURNING id, contact_id` (SQLSTATE 42702 on
  -- first call — plpgsql resolves names at execution, not CREATE, so a
  -- plain replay can't catch it). Assert the qualified form is what's
  -- actually installed.
  IF pg_get_functiondef(
       'public.create_broadcast_with_recipients(uuid,uuid,text,text,text,integer,uuid[],jsonb)'::regprocedure
     ) NOT LIKE '%RETURNING id, broadcast_recipients.contact_id%' THEN
    RAISE EXCEPTION
      'create_broadcast_with_recipients still has the ambiguous RETURNING — migration 041 did not apply';
  END IF;

  IF to_regprocedure(
       'public.create_broadcast_with_recipients(uuid,uuid,text,text,text,integer,uuid[],jsonb[])'
     ) IS NOT NULL THEN
    RAISE EXCEPTION
      'the JSONB[] overload of create_broadcast_with_recipients still exists — migration 049 did not apply';
  END IF;

  -- The failure-reason columns (042) are only ever written by the
  -- status webhook, which uses an untyped update — a missing column
  -- there is a runtime PostgREST error on every failed send, not a
  -- compile error.
  IF (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'messages'
      AND column_name IN ('error_code', 'error_title', 'error_details')
  ) <> 3 THEN
    RAISE EXCEPTION
      'messages.error_code/error_title/error_details are missing — migration 042 did not apply';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND cmd IN ('SELECT', 'ALL')
      AND (roles && ARRAY['public', 'anon']::name[])
      AND (qual LIKE '%avatars%' OR qual LIKE '%flow-media%' OR qual LIKE '%chat-media%')
  ) THEN
    RAISE EXCEPTION
      'a storage SELECT policy on avatars/flow-media/chat-media still applies to anon — migration 043 did not apply';
  END IF;
  IF (
    SELECT COUNT(*) FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND cmd = 'SELECT'
      AND roles = ARRAY['authenticated']::name[]
      AND policyname IN (
        'Users can read their own avatar',
        'Members can read flow media',
        'Members can read chat media'
      )
  ) <> 3 THEN
    RAISE EXCEPTION
      'the scoped storage SELECT policies are missing — migration 043 did not apply';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'public._bcast_bump(uuid,text,integer)',
      'public.recompute_broadcast_counts(uuid)',
      'public.claim_ai_reply_slot(uuid,integer)',
      'public.record_webhook_failure(uuid,integer)',
      'public.merge_duplicate_contacts()',
      'public.merge_duplicate_conversations()'
    ]::regprocedure[]) AS f(fn)
    WHERE has_function_privilege('anon', f.fn, 'EXECUTE')
       OR has_function_privilege('authenticated', f.fn, 'EXECUTE')
       OR NOT has_function_privilege('service_role', f.fn, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION
      'an internal SECURITY DEFINER function is still executable by anon/authenticated — migration 044 did not apply';
  END IF;

  -- 045 widens the automation_pending_executions status CHECK. It is a
  -- DROP + ADD by name, so a wrong constraint name would leave the old
  -- CHECK in place and every "wait for reply" park would be rejected at
  -- runtime, not at migration time.
  IF pg_get_constraintdef(
       (SELECT oid FROM pg_constraint
        WHERE conname = 'automation_pending_executions_status_check')
     ) NOT LIKE '%awaiting_reply%' THEN
    RAISE EXCEPTION
      'automation_pending_executions_status_check does not allow awaiting_reply — migration 045 did not apply';
  END IF;
  IF to_regclass('public.idx_automation_pending_awaiting_reply') IS NULL THEN
    RAISE EXCEPTION
      'idx_automation_pending_awaiting_reply is missing — migration 045 did not apply';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_default LIKE '%uuid_generate_v%'
  ) THEN
    RAISE EXCEPTION
      'a public column default still calls uuid-ossp; use gen_random_uuid() so a fresh hosted db push does not hit 42883';
  END IF;

  IF to_regprocedure('public.dashboard_overview(integer,text)') IS NULL THEN
    RAISE EXCEPTION 'public.dashboard_overview(integer, text) is missing — migration 059 did not apply';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'messages_track_conversation_times') THEN
    RAISE EXCEPTION 'messages_track_conversation_times trigger is missing — migration 059 did not apply';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'conversations_stamp_closed_at')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'deals_stamp_closed_at') THEN
    RAISE EXCEPTION 'closed_at triggers are missing — migration 059 did not apply';
  END IF;
  IF has_function_privilege('anon', 'public.dashboard_overview(integer,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute dashboard_overview — migration 059 grants are wrong';
  END IF;

  -- 060: several numbers per account. The old UNIQUE(account_id) must be
  -- gone, or saving a second number fails.
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_config_account_id_key')
     OR to_regclass('public.idx_whatsapp_config_account_default') IS NULL
     OR to_regclass('public.idx_conversations_account_contact_channel') IS NULL THEN
    RAISE EXCEPTION 'multi-number schema is incomplete — migration 060 did not apply';
  END IF;

  -- 061: sectors. dashboard_overview must run as the caller, or it
  -- returns previews of conversations the caller's RLS hides.
  IF to_regprocedure('public.can_access_sector(uuid,uuid)') IS NULL
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sectors'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sector_members'::regclass) THEN
    RAISE EXCEPTION 'sector access is incomplete — migration 061 did not apply';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.dashboard_overview(integer,text)'::regprocedure) THEN
    RAISE EXCEPTION 'dashboard_overview is SECURITY DEFINER and bypasses sector access — migration 061 did not apply';
  END IF;

  -- 062: transfer between sectors. Without the guard trigger an agent
  -- could repoint the number a conversation replies from.
  IF to_regprocedure('public.transfer_conversation(uuid,uuid)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'conversations_channel_guard')
     OR has_function_privilege('anon', 'public.transfer_conversation(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'sector transfer is incomplete or exposed to anon — migration 062 did not apply';
  END IF;

  -- 063: lead distribution. claim_lead skips RLS and must stay
  -- server-only, or a client could assign leads around the cap.
  IF to_regprocedure('public.claim_lead(uuid,uuid,uuid)') IS NULL
     OR has_function_privilege('authenticated', 'public.claim_lead(uuid,uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.claim_lead(uuid,uuid,uuid)', 'EXECUTE')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'messages_mark_lead_started') THEN
    RAISE EXCEPTION 'lead distribution is incomplete or claim_lead is client-callable — migration 063 did not apply';
  END IF;

  -- 064: sector rules. replace_agent_schedule skips RLS (server-only).
  IF to_regprocedure('public.create_sector(uuid,text,uuid[])') IS NULL
     OR to_regprocedure('public.replace_agent_schedule(uuid,uuid,jsonb)') IS NULL
     OR has_function_privilege('authenticated', 'public.replace_agent_schedule(uuid,uuid,jsonb)', 'EXECUTE')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'sector_members_keep_one')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'sector_members_need_schedule') THEN
    RAISE EXCEPTION 'sector rules are incomplete or replace_agent_schedule is client-callable — migration 064 did not apply';
  END IF;

  -- 065: failed queue notices are retried by the cron.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'conversations'
      AND column_name = 'queue_notice_retry_at'
  ) THEN
    RAISE EXCEPTION 'queue notice retry is incomplete — migration 065 did not apply';
  END IF;

  -- 066: each number says which provider it talks through.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'whatsapp_config'
      AND column_name = 'provider'
  ) THEN
    RAISE EXCEPTION 'whatsapp provider is missing — migration 066 did not apply';
  END IF;

  -- 067: one kind of WhatsApp connection per account.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'whatsapp_config_single_provider') THEN
    RAISE EXCEPTION 'single-provider rule is missing — migration 067 did not apply';
  END IF;

  RAISE NOTICE 'schema verification passed';
END
$$;

-- Two things this file has already been burned by, both verified in CI
-- rather than assumed:
--
-- 1. It must contain EXACTLY ONE statement. `supabase db query --file`
--    sends the whole file as a prepared statement, and a second
--    top-level statement fails with the distinctly unhelpful "cannot
--    insert multiple commands into a prepared statement" (commit
--    f91a6c8). Add assertions INSIDE the DO block above; do not append
--    a second one.
--
-- 2. A RAISE in here really does fail the job. A deliberately false
--    assertion (commit 42c7db0, run 31579334056) surfaced as
--    `failed to execute query: error: ...` and exited 1. This is not a
--    decorative green tick.

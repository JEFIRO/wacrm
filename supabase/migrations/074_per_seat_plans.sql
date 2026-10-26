-- ============================================================
-- 074_per_seat_plans.sql
--
-- New price list decided by the user (2026-10-25, docs/saas/b1-planos.md):
--
--   Essencial  R$ 99,90 per attendant/month, at least 2 attendants, 2 numbers
--   Impulso    R$ 149,90 per attendant/month, at least 3 attendants, 3 numbers
--              (recommended; the trial uses it)
--   Anual      R$ 180,00/month for the account, 12 instalments, 3 attendants
--              included, up to 5 numbers; more attendants paid on top
--              (price to be decided)
--
-- Per-attendant plans fit the existing columns: included_users is the
-- minimum, extra_user_price_cents the price per attendant and
-- monthly_price_cents = minimum × that price. The old plans are only
-- deactivated — existing subscriptions may still point at them.
-- ============================================================

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS pricing TEXT NOT NULL DEFAULT 'flat'
    CHECK (pricing IN ('flat', 'per_seat')),
  ADD COLUMN IF NOT EXISTS tagline TEXT,
  ADD COLUMN IF NOT EXISTS highlight BOOLEAN NOT NULL DEFAULT FALSE,
  -- Marketing list shown on the plan cards (not enforced).
  ADD COLUMN IF NOT EXISTS features JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE plans SET active = FALSE WHERE id IN ('profissional', 'business');

INSERT INTO plans (id, name, pricing, monthly_price_cents, included_users, extra_user_price_cents,
                   max_numbers, billing_cycle, sort_order, highlight, tagline, features)
VALUES
  ('essencial', 'Essencial', 'per_seat', 19980, 2, 9990, 2, 'monthly', 1, FALSE,
   'Para organizar atendimento, CRM e IA em uma única operação.',
   '["2 números de WhatsApp", "Caixa de entrada compartilhada", "CRM com pipeline visual",
     "Chatbot visual", "Agentes de IA", "Base de conhecimento para IA",
     "Webchat para site ou app", "Relatórios essenciais"]'::jsonb),
  ('impulso', 'Impulso', 'per_seat', 44970, 3, 14990, 3, 'monthly', 2, TRUE,
   'Para equipes que querem automatizar vendas e atendimento.',
   '["Tudo do Essencial", "Até 3 números de WhatsApp", "Até 5 pipelines de CRM",
     "Chatbot avançado", "Agendamento de mensagens", "Campanhas no WhatsApp",
     "Distribuição automática de leads", "Agentes de IA com processos de trabalho",
     "Skills para agentes de IA", "API e webhooks", "Relatórios completos", "Até 3 equipes"]'::jsonb)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, pricing = EXCLUDED.pricing,
  monthly_price_cents = EXCLUDED.monthly_price_cents, included_users = EXCLUDED.included_users,
  extra_user_price_cents = EXCLUDED.extra_user_price_cents, max_numbers = EXCLUDED.max_numbers,
  billing_cycle = EXCLUDED.billing_cycle, sort_order = EXCLUDED.sort_order,
  highlight = EXCLUDED.highlight, tagline = EXCLUDED.tagline, features = EXCLUDED.features,
  active = TRUE;

UPDATE plans SET
  name = 'Anual Completo', pricing = 'flat', monthly_price_cents = 18000, included_users = 3,
  extra_user_price_cents = NULL, max_numbers = 5, billing_cycle = 'yearly', sort_order = 3,
  highlight = FALSE, active = TRUE,
  tagline = 'Tudo incluído, com compromisso de 12 meses.',
  features = '["Tudo do Impulso", "Até 5 números de WhatsApp", "Pipelines ilimitados",
               "Equipes ilimitadas", "Distribuição e roteamento avançados",
               "Permissões avançadas", "Logs e auditoria",
               "Integrações avançadas para agentes de IA", "Multiunidade e multimarca",
               "Webchat avançado", "Atendimento prioritário"]'::jsonb
WHERE id = 'anual';

-- The trial now uses the recommended plan.
CREATE OR REPLACE FUNCTION public.accounts_start_trial()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO account_subscriptions (account_id, plan_id, status, trial_ends_at)
  VALUES (NEW.id, 'impulso', 'trialing', NOW() + INTERVAL '30 days')
  ON CONFLICT (account_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Trials not yet tied to a payment move to the recommended plan.
UPDATE account_subscriptions SET plan_id = 'impulso', updated_at = NOW()
WHERE status = 'trialing' AND external_subscription_id IS NULL AND plan_id = 'profissional';

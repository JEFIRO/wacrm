# B1 — Planos, assinatura e limites (+ B4 limite de números)

Status: **na `main`** · Itens do roteiro: B1, B4

## Decisões do usuário (2026-10-25)

- **Sem taxa de implantação** (coluna removida na 071).
- **Plano anual completo** ("Anual Completo"): limites do Business, 12 parcelas de um valor ainda
  a definir (`billing_cycle = 'yearly'`, preço nulo = "Valor a definir").
- **Fim do teste / pagamento atrasado**: modo **limitado** até o próximo vencimento (30 dias),
  depois **bloqueio total**.

- **Planos com usuários inclusos** (Essencial / Profissional / Business) e **usuário adicional
  pago à parte**. Substitui a ideia inicial de "1 funcionário grátis + taxa por assento".
- **Teste grátis de 30 dias** para toda conta nova.

## Desenho

- **Migration 070**
  - `plans`: preço mensal, implantação, usuários inclusos, máximo de números, preço do usuário
    extra (nulo = a definir), cota de API (nulo = sem cota; P3). Valores da proposta do handoff:
    Essencial R$ 149 (2 usuários, 2 números, implantação R$ 300), Profissional R$ 349 (5, 5,
    R$ 600), Business R$ 799 (15, 7, R$ 1.500). O app lê da tabela — mudar preço não precisa
    de deploy.
  - `account_subscriptions` (uma por conta): plano, status (`trialing`, `active`, `past_due`,
    `suspended`, `canceled`), fim do teste, fim do período, usuários extras, campos do
    provedor de pagamento (B2). Leitura para membros; escrita só pelo servidor.
  - Gatilho em `accounts`: toda conta nova (cadastro, remoção de membro…) nasce em teste de
    30 dias. Contas existentes começaram o teste ao aplicar a migration.
  - **B4**: gatilho em `whatsapp_config` recusa número além de `max_numbers`
    (`plan_number_limit`). As rotas de cadastro (Meta e QR) devolvem 403 com mensagem clara; a
    do QR checa antes de criar a instância na Evolution.
- `src/lib/billing/plan.ts` (puro): fase da assinatura (inclui "teste encerrado"), dias de
  teste, assentos (leitores não ocupam), preço em reais. `src/lib/billing/limits.ts`: checagem
  de números no servidor.
- **Configurações → Plano e uso**: plano atual, selo do teste ("Teste grátis — N dias
  restantes"), uso de usuários e números com barra, e os planos lado a lado. Botões de
  assinatura desabilitados até o pagamento (B2).

## Decisão tomada sem o usuário (confirmar)

- O teste usa os limites do plano **Profissional** (5 usuários, 5 números).

## Fim do teste e atraso: modo limitado → bloqueio (migration 071, `billingAccess`)

`billingAccess(sub, agora)` (`src/lib/billing/plan.ts`, testado) devolve `full`, `limited` ou
`blocked`; o servidor aplica com `loadBillingAccess` e a tela com `useBillingAccess`.

- **Em dia**: teste dentro do prazo ou assinatura `active`.
- **Limitado** (teste vencido, ou `past_due`, por `GRACE_DAYS` = 30 dias a partir do vencimento):
  aviso fixo em todas as páginas com a data do bloqueio; envio manual espera 5 s por mensagem;
  sem campanhas (rota do disparo por template → 402; fila de texto adia 1 h e reconfere), sem IA
  respondendo sozinha, sem número novo nem convite novo (402). Fluxos e automações continuam.
- **Bloqueado** (prazo acabou, `suspended`, `canceled`): o app vira a tela "Conta bloqueada"
  (Configurações continua acessível para ver o plano e assinar); nada é enviado — núcleo da
  inbox/API (402), fluxos, automações, IA e campanhas. **Mensagens recebidas continuam sendo
  guardadas.**

## Fora do escopo (próximos itens)

- Pagamento (B2, Asaas): é ele que muda o status para `active`/`past_due`/`suspended`.
- Bloquear convite além dos usuários do plano (B3) e preço do usuário extra (a definir).
- Cota mensal da API (P3).

# B2 — Cobrança pelo Asaas

Status: **na `main`** · Item do roteiro: B2

## Fluxo

1. **Assinar** (Configurações → Plano e uso, **só o dono**): escolhe o plano e informa o
   CPF/CNPJ de quem paga (validado com dígitos verificadores). `POST /api/billing/subscribe`
   cria — ou reaproveita — o cliente no Asaas (`externalReference` = conta) e a assinatura
   **mensal** com `billingType: UNDEFINED` (o pagador escolhe Pix, boleto ou cartão na fatura).
   Plano anual = 12 parcelas (`maxPayments: 12`). Durante o teste, a 1ª cobrança vence no fim
   do teste; fora dele, hoje. Já assinado → troca de plano só muda o valor
   (`updatePendingPayments`). A fatura abre numa nova aba.
2. **Status**: `syncAccountSubscription` relê a assinatura e as cobranças **no Asaas** e aplica
   `statusFromPayments` (puro, testado): pago (`RECEIVED`/`CONFIRMED`/`RECEIVED_IN_CASH`) →
   `active` até 1 mês após o vencimento pago; cobrança `OVERDUE` depois do último pagamento →
   `past_due` (dispara o modo limitado → bloqueio, `docs/saas/b1-planos.md`); assinatura
   removida → `canceled`; nada pago ainda → mantém o teste. Guarda o link da fatura pendente.
3. **Webhook** `POST /api/billing/asaas/webhook`: cabeçalho `asaas-access-token` =
   `ASAAS_WEBHOOK_TOKEN`; o corpo só indica **qual** assinatura mudou e a conta é relida do
   Asaas — evento forjado não ativa nada. Responde 200 rápido e sincroniza em `after()`.
4. Tela: "Abrir fatura a pagar" e "Atualizar status" (`POST /api/billing/sync`, mesmo caminho).

## Configuração

`.env`: `ASAAS_API_URL` (sandbox `https://api-sandbox.asaas.com/v3`), `ASAAS_API_KEY`
(**escapar o `$` inicial como `\$`** — o Next expande variáveis), `ASAAS_WEBHOOK_TOKEN`.
Em produção: cadastrar no painel do Asaas (Integrações → Webhooks) a URL
`https://<app>/api/billing/asaas/webhook`, o token e os eventos de cobrança.

## Verificado (2026-10-25, sandbox)

O usuário assinou o Business pela tela e pagou a fatura com cartão de teste; o Asaas mostrou a
assinatura (R$ 799, mensal, `externalReference` = conta) e a 1ª cobrança `CONFIRMED` com
vencimento no fim do teste. "Atualizar status" → **Ativo**, período até 24/12/2026, limites do
Business. Webhook: 401 sem/errado token; com token e a assinatura real disparou a releitura.
Regra de status e CPF/CNPJ com testes. Gate verde (1603).

## Pendências

- Webhook do Asaas não alcança `localhost`: cadastrar no painel quando houver URL pública (O1).
- Trocar entre mensal e anual numa assinatura existente só muda o valor (não o nº de parcelas).
- Usuário adicional ainda não entra no valor (B3). Nota fiscal (O3). Cancelar pela tela.

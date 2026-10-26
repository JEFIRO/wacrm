# B6 — Painel do dono do SaaS

Status: **na `main`** · Item do roteiro: B6

## Quem acessa

`PLATFORM_ADMIN_EMAILS` (e-mails separados por vírgula, só no servidor). Ninguém vira
administrador da plataforma pela tela ou pelo banco. Quem não está na lista não vê o link
"Painel SaaS" na barra lateral, vê "só para administradores" em `/admin` e recebe 403 nas rotas.

## O que mostra (`/admin`)

- Resumo clicável (filtra a tabela): contas, em teste, ativas, em atraso/limitadas, bloqueadas,
  e **receita mensal** (assinaturas ativas: plano + atendentes adicionais).
- Tabela: conta (dono, desde quando), plano (e id do cliente no Asaas), situação (`billingAccess`),
  validade (fim do teste ou pago até), atendentes usados/limite, números (Meta ou QR), mensagens
  dos últimos 30 dias e a última, receita/mês. Busca por conta ou e-mail do dono.
- Dados de `platform_accounts_overview()` (075), função só para o service role.

## Ações (`POST /api/platform/accounts/:id`)

- **Suspender** → `suspended` (conta bloqueada; recebidas continuam guardadas).
- **Reativar** (só de `suspended`) → volta ao teste; com assinatura no Asaas, relê os pagamentos.
- **+7 / +30 dias de teste** (1–90) a partir do fim do teste ou de hoje; conta paga mantém o status.
- Tudo grava em `platform_audit` (quem, conta, ação, antes/depois). Tabela sem acesso de cliente.

## Verificado (2026-10-25)

Painel com as 4 contas locais (3 em teste, 1 ativa, receita R$ 799); +7 dias, suspender e
reativar com registro de auditoria; reativar o que não está suspenso e estender 500 dias → 400;
conta `qr@` (não admin) → página bloqueada, sem link, 403 nas rotas. Corrigido no teste: datas
do Asaas gravadas ao meio-dia UTC (antes "pago até 23/12" em vez de 24/12).

## Pendências

- Em produção: `PLATFORM_ADMIN_EMAILS` com o e-mail do dono do SaaS.
- Sem trocar plano de um cliente pelo painel nem link direto para o cliente no Asaas.

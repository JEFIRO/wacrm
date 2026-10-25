# C2 — Acesso por setor

Status: **substituída** — ver `docs/saas/setores-e-distribuicao.md`

> ⚠️ Este desenho (setor = equipe de um número, `whatsapp_config_members`) foi substituído antes do merge por setores próprios da conta (`sectors`, `sector_members`, `can_access_sector`). Mantido só como histórico da decisão.

## Problema

Com vários números (C1), todo atendente ainda vê todas as conversas da conta. Na
Deslanxia, Jefferson (Vendas) não deve ver o Atendimento, e Jennifer (Atendimento) não deve
ver Vendas.

## Decisões

- **Quem atende cada número:** tabela `whatsapp_config_members` (número × usuário).
- **Regra de acesso** (`can_access_channel`), avaliada no banco:
  - dono e admin veem tudo;
  - número **sem ninguém marcado** fica aberto a todos os atendentes da conta — conta com um
    número só, ou que nunca configurou setores, continua como antes;
  - número **com membros marcados** só é visto por eles (e por dono/admin);
  - conversa órfã (número desconectado) fica aberta a todos.
- **Aplicada no RLS** de `conversations`, `messages` e `message_reactions` (ler e alterar).
  Inbox, tempo real (`postgres_changes` respeita RLS) e rotas que usam o client do usuário
  passam a filtrar sem mudança de código.
- `dashboard_overview` deixa de ser `SECURITY DEFINER` e passa a `SECURITY INVOKER`: assim
  o RLS também filtra as prévias e contagens do painel. Uma linha, sem copiar a função.
- Contatos, negócios (funil) e campanhas continuam visíveis para a conta inteira.
- Interface: em Configurações → WhatsApp, cada número ganha "Quem atende este número",
  com os atendentes e leitores da conta (dono/admin não aparecem: já veem tudo).

## Fora do escopo

- Rotas que usam o client service role com ID de conversa vindo do usuário (ex.: disparo
  manual de automação) checam só a conta, não o setor. Anotar como pendência.
- Transferir conversa entre setores → **C3**. Distribuição automática → **P1**.
- API v1 (chave de API) continua vendo a conta inteira.

## Pronto quando

1. Atendente marcado só em "Vendas" vê só conversas de Vendas na inbox e no painel; abrir
   por ID uma conversa de outro setor não retorna nada.
2. Admin/dono continuam vendo tudo.
3. Número sem ninguém marcado continua visível a todos os atendentes.
4. Gate verde e checagem de esquema do CI passando.

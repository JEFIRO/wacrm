# W5 — Fila de disparos de texto (contas QR code)

Status: **commitado** · Item do roteiro: W5 · Branch: `feat/w5-fila`

## Problema

O disparo do upstream roda **no navegador** (lotes para `/api/whatsapp/broadcast`, template a
template, sem pausa). Contas QR não têm templates, e mandar muitas mensagens seguidas por um
número não oficial é o caminho mais curto para bloqueio.

## Decisão: fila no banco + cron (sem Redis por enquanto)

Ainda não há Redis na infraestrutura (O1) e o cron de 1 minuto já existe. A fila vive na tabela
`broadcasts`; o Redis fica para quando houver várias instâncias do app (P5).

## Desenho

- **Migration 068**: `broadcasts.kind` (`template` | `text`), `message_text`, `channel_id`,
  `min_interval_seconds`/`max_interval_seconds` (padrão 20–45, limites 5–3600), `next_send_at`.
  `template_name`/`template_language` passam a aceitar nulo (só para `text`; CHECK garante).
- **Criação** (`useBroadcastSending().queueTextBroadcast`, navegador, RLS): resolve o público
  com o mesmo seletor dos disparos (todos, tags, campo personalizado, CSV), cria o disparo como
  `draft`, insere os destinatários `pending` e **só então** muda para `sending` com
  `next_send_at = agora` — senão o worker poderia fechar uma campanha pela metade.
- **Worker** (`src/lib/broadcasts/text-queue.ts`, `GET /api/broadcasts/cron` a cada minuto,
  ~50 s por execução, mesmo segredo `AUTOMATION_CRON_SECRET`): pega a vez de uma campanha
  movendo `next_send_at` com UPDATE condicional (uma vez por turno, mesmo com crons
  sobrepostos), envia ao destinatário pendente mais antigo pelo **núcleo de envio da inbox**
  (mensagem aparece na conversa do cliente e pausa fluxo ativo) e agenda o próximo envio num
  intervalo aleatório. Sem pendentes → `sent` (ou `failed` se ninguém recebeu).
- **Texto**: variáveis `{{nome}}`, `{{primeiro_nome}}`, `{{telefone}}`, `{{email}}`,
  `{{empresa}}` (`src/lib/broadcasts/text-campaign.ts`); variável desconhecida bloqueia o
  assistente.
- **Status**: o webhook da Evolution também atualiza `broadcast_recipients` (entregue/lido);
  resposta do cliente marca "respondida" pelo caminho já existente.
- **Tela** (conta QR): Disparos mostra o aviso da fila e a lista; "Novo disparo" abre o
  assistente de texto (mensagem + prévia + intervalo → público → confirmação com duração
  estimada e alerta de bloqueio). No detalhe, campanha de texto mostra "Na fila: N restantes,
  próxima por volta de HH:MM" e atualiza a cada 5 s; "Retomar envio" não aparece e a rota de
  retomar recusa campanhas de texto.

## Cron em produção

Além de `/api/automations/cron` e `/api/flows/cron`, chamar a cada minuto:
`GET /api/broadcasts/cron` com o cabeçalho `x-cron-secret`.

## Verificado (2026-10-25)

Testes de variáveis/intervalo; assistente na conta `qr@wacrm.test` (prévia, público, confirmação,
tela de detalhe) com envio falhando de propósito (instância inexistente) → campanha `failed`;
campanha real pelo número conectado do usuário para o número autorizado (2 destinatários):
2 envios com **21 s** de intervalo, mensagens nas conversas com variáveis preenchidas, campanha
`sent`, sem duplicatas; status "entregue" chegou pelo webhook e subiu o contador da campanha.
Gate verde (1590).

## Fora do escopo / pendências

Limite diário por número, horário comercial, pausar/cancelar campanha pela tela, campanha de
texto em conta Meta (só dentro da janela de 24h — não oferecida).

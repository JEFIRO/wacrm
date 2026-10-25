# W4 — Regras por provedor (contas QR code)

Status: **na `main`** · Item do roteiro: W4 · Branch: `feat/w4-regras`

## Problema

Números por QR code (Evolution) não seguem as regras da API oficial: não há janela de 24h nem
templates aprovados, e botões/listas não aparecem no celular (testado na Evolution 2.3.7:
botões aceitos mas invisíveis; lista falha no servidor com `this.isZero is not a function`).

## Desenho

- **Menu numerado** (`src/lib/whatsapp/evolution/menu.ts`, puro): o provedor Evolution manda
  `sendButtons`/`sendList` como texto — `*cabeçalho*`, corpo, `1. opção`, `_rodapé_`,
  "Responda com o número da opção." (`WhatsAppMenu.hint`). Vale para inbox, fluxos e automações.
- **Resposta → toque**: no webhook da Evolution (`processInboundMessage(..., { menuReplies:
  true })`), se a última mensagem nossa na conversa é interativa e o cliente responde o número
  ("1", "1.", "1)", "opção 1") ou o título da opção (sem acento/maiúscula), a mensagem vira
  `button_reply`/`list_reply` com o id da opção. Qualquer outra resposta segue como texto.
  A Meta não usa isso (botões de verdade funcionam lá).
- **Tela** (`useAccountProvider`, um tipo por conta — migration 067): em conta QR a conversa não
  mostra o selo "24h restantes" nem trava o composer, o botão de template some, e
  Configurações → Modelos e Disparos mostram `QrAccountNotice` (disparo QR = W5).
- Templates continuam recusados no provedor Evolution (`EvolutionUnsupportedError`): nó de
  template num fluxo de conta QR falha.

## Verificado (2026-10-25)

Testes do menu e do provedor; com WhatsApp real: menu chegou formatado, resposta "1" gravada
como `interactive` "Sim, quero" com `interactive_reply_id = btn_sim`; conta QR sem selo de 24h,
sem botão de template e com os avisos em Disparos. Gate verde (1582).

## Mensagens enviadas pelo celular / WhatsApp Web (eco)

`processOutboundEcho` (`inbound.ts`): mensagem `fromMe` que o app não enviou (checado pelo id
depois de 5 s, para a mensagem do próprio app ser gravada antes) entra na conversa como
mensagem nossa, sem abrir não lida nem disparar fluxo/automação/IA, e pausa fluxo ativo como uma
resposta de atendente. O nome do contato nunca vem do `pushName` dessas mensagens (é o nosso).
A checagem do id é **por número** (canal): o WhatsApp dá à mensagem o mesmo id no remetente e no
destinatário, então a cópia recebida por outro número do app não pode valer como "enviada pelo
app" (bug achado no teste com dois números conectados). Verificado com WhatsApp real: mensagem
do app não duplica; mensagem enviada pelo celular entre dois números conectados aparece como eco
(nossa) num e como recebida no outro, com o mesmo id.


# W2 — Evolution API v2: webhook de entrada e envio

Status: **commitado** · Item do roteiro: W2 · Branch: `feat/w1-provedor`

## Problema

O app só falava com a Meta. Números não oficiais (Evolution, sobre Baileys) precisam receber
e enviar pelo mesmo caminho: mesma inbox, fluxos, automações, IA e webhooks de saída.

## Desenho

- **Um número Evolution = uma instância.** Linha em `whatsapp_config` com `provider =
  'evolution'`, nome da instância em `phone_number_id` (único, como o id da Meta) e a chave da
  instância cifrada em `access_token`. Sem migration nova. O servidor é o do SaaS:
  `EVOLUTION_API_URL`. Criar a instância e o QR code é o W3.
- **Envio** (`src/lib/whatsapp/provider/evolution.ts`): `sendText`, `sendMedia` (áudio vai como
  nota de voz), `sendReaction` (precisa saber se a mensagem reagida é nossa: `targetFromMe`),
  `getMedia`/`downloadMedia` (base64 de `getBase64FromMediaMessage`), `health`
  (`connectionState` = `open`). Template, botões e lista lançam `EvolutionUnsupportedError` —
  o W4 decide o comportamento. "Digitando…" não faz nada (a Evolution pede o chat, não a mensagem).
- **Entrada** (`POST /api/whatsapp/evolution/webhook`): autenticada pelo cabeçalho
  `x-wacrm-webhook-secret` = `EVOLUTION_WEBHOOK_SECRET` (a configuração de webhook da instância
  manda cabeçalhos próprios). A instância escolhe o número. Responde 200 na hora e processa em
  `after()`.
  - `messages.upsert` → `src/lib/whatsapp/evolution/translate.ts` (puro) traduz para o formato
    da Meta e chama `processInboundMessage` — o mesmo pipeline do webhook da Meta, extraído da
    rota para `src/lib/whatsapp/inbound.ts` sem mudar o comportamento (só a mídia passa pelo
    provedor). Ignora grupos, `status@broadcast`, newsletters e `fromMe`. Chat endereçado por
    LID usa `remoteJidAlt`.
  - `messages.update` → `SERVER_ACK`/`DELIVERY_ACK`/`READ`/`PLAYED` viram sent/delivered/read
    via `applyMessageStatus`.
  - Outros eventos (ex.: `connection.update`) são ignorados até o W3.
- Formatos conferidos no código-fonte da Evolution (DTOs de envio, `renderStatus`,
  `prepareMessage`) e na documentação espelhada de webhooks, em 2026-10-25.

## Desenvolvimento local

- `node scripts/dev/fake-evolution.mts` sobe um servidor que imita a Evolution (porta 18080) e
  imprime cada chamada.
- O seed cria o número "Evolution" (instância `wacrm-dev-evolution`).
- `node --env-file=.env.local scripts/dev/simulate-evolution.mts wacrm-dev-evolution text "oi"`
  (ou `image "<legenda>"`, ou `status <id> READ`) manda eventos ao webhook local.

## Pronto quando

1. Testes da tradução, do provedor e da escolha do provedor; suíte do webhook da Meta verde
   sem mudança depois da extração.
2. Local, com o servidor falso: texto e imagem chegam na inbox (imagem espelhada no storage),
   resposta citando sai pela instância, reação endereçada, status chega a "lido", segredo
   errado = 401.
3. Gate verde.

# W1 — Camada de provedor de WhatsApp

Status: **na `main`** · Item do roteiro: W1 · Branch: `feat/w1-provedor`

## Problema

Cada ponto que envia mensagem carrega o número (`loadChannel`), decifra o token e chama
`meta-api.ts` passando `phoneNumberId` + `accessToken`. Para o Evolution (W2) entrar, todos
esses pontos teriam que saber qual provedor o número usa.

## Desenho

- `whatsapp_config.provider` (`'meta'` | `'evolution'`, padrão `'meta'`, migration 066) diz por
  onde o número fala. Nesta etapa só existe a implementação Meta; um número `evolution` falha
  com erro claro até o W2.
- `src/lib/whatsapp/provider/`:
  - `types.ts` — interface `WhatsAppProvider`: `sendText`, `sendMedia`, `sendTemplate`,
    `sendButtons`, `sendList`, `sendReaction`, `sendTyping`, `getMedia`, `downloadMedia`,
    `health`. Os argumentos são os de `meta-api.ts` **sem** as credenciais.
  - `meta.ts` — `createMetaProvider({ phoneNumberId, accessToken })`: amarra as credenciais e
    repassa para `meta-api.ts` (que continua sendo o cliente da Graph API e os testes que o
    mocam continuam valendo).
  - `index.ts` — `providerForChannel(row)` (decifra o token e escolhe a implementação) e
    `loadChannelProvider(db, accountId, channelId)` (= `loadChannel` + `providerForChannel`).
- Pontos migrados para o provedor: composer da inbox (`send-message.ts`), envios de fluxo
  (`flows/meta-send.ts`), envios de automação (`automations/meta-send.ts`), reação
  (`api/whatsapp/react`), "digitando" da IA (`ai/auto-reply.ts`), proxy de mídia
  (`api/whatsapp/media/[mediaId]`) e saúde do número (`api/whatsapp/health`).

## Fica de fora (de propósito)

- **Webhook da Meta** (`api/whatsapp/webhook`): é a entrada da Meta; o Evolution terá rota
  própria no W2.
- **Gestão de templates, registro do número, inscrição da WABA, disparo de campanha**: só
  existem na Meta. Campanha com Evolution é o W5 (fila).
- Regras por provedor (janela de 24h, esconder templates/botões): W4.
- O retry por variantes de telefone (`isRecipientNotAllowedError`) segue nos chamadores: é
  comportamento da Meta, e o erro só existe nela.

## Pronto quando

1. Nenhum dos pontos migrados importa função de envio de `meta-api.ts` nem decifra token.
2. Testes do provedor (amarração das credenciais, provedor desconhecido/evolution) e a
   suíte inteira verdes, sem mudar o comportamento dos testes existentes.
3. Envio real local continua chegando até a chamada da Meta (falha esperada pelo token falso),
   com o mesmo log de antes.
4. Gate verde e schema check.

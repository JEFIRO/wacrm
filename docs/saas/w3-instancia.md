# W3 — Número por QR code (instância Evolution automática)

Status: **commitado** · Item do roteiro: W3 · Branch: `feat/w3-instancia`

## Problema

Para usar um número não oficial, o admin precisava criar a instância na Evolution à mão e
cadastrar nome e chave. O pedido: "Adicionar número" → QR code → ler com o celular → pronto.

## Desenho

- **Configurações → WhatsApp → Adicionar número** pergunta como conectar: "QR code (WhatsApp
  do celular)" ou "API oficial da Meta" (a opção QR só aparece com a Evolution configurada).
  Num número QR, o formulário da Meta dá lugar a `EvolutionConnect`: QR, passo a passo, estado,
  "Conectado como +55…" e "Desconectar e remover número".
- `src/lib/whatsapp/evolution/admin.ts` (servidor, chave GLOBAL): `createInstance` (Baileys,
  ignora grupos, webhook do app com o cabeçalho de segredo, eventos `MESSAGES_UPSERT`,
  `MESSAGES_UPDATE`, `CONNECTION_UPDATE`), `instanceState`/`instanceQr` (chave da instância),
  `instanceOwner` (número pareado), `deleteInstance` (logout + delete).
- Rotas (admin): `GET/POST /api/whatsapp/evolution/instances` (disponível? / criar instância +
  linha `whatsapp_config` com `status = disconnected`), `GET/DELETE
  /api/whatsapp/evolution/instances/:id` (estado + QR, sincroniza `status` / remove a instância
  e o número). Se gravar o número falhar, a instância recém-criada é apagada.
- Nome da instância: `wacrm-<8 primeiros do account_id>-<8 hex>`.
- Webhook (`connection.update`): `open` → `connected` (+ `connected_at`), `close` →
  `disconnected`.
- **Nono dígito (Brasil)**: o WhatsApp identifica muitos celulares sem o 9
  (`551187654321`) e as pessoas escrevem com ele (`5511987654321`). `phoneVariants`/`phonesMatch`
  (`phone-utils.ts`) passam a considerar as duas grafias, então contato cadastrado com o 9 não
  duplica ao receber mensagem (vale para Meta e Evolution).
- Envelope de álbum (`albumMessage`) e tráfego de protocolo são ignorados na entrada.
- **Um tipo de conexão por conta** (decisão do usuário, 2026-10-25; migration 067): a conta usa
  a API oficial da Meta **ou** números por QR code, nunca os dois. Gatilho no banco
  (`account_provider_mismatch`), 409 nas rotas de cadastro (Meta e QR), e na tela a escolha só
  aparece enquanto a conta não tem número — inclusive no primeiro número. Para trocar, remova
  todos os números do tipo atual. Contas que já misturavam (só dados locais) ficam como estão.
- Botões e lista pela Evolution 2.3.7 **não funcionam**: botões são aceitos mas não aparecem no
  celular; lista falha no servidor (`this.isZero is not a function`). Plano do W4: menu
  numerado em texto, com a resposta traduzida para o id do botão.

## Variáveis de ambiente

`EVOLUTION_API_URL`, `EVOLUTION_GLOBAL_API_KEY` (só servidor, cria/apaga instâncias),
`EVOLUTION_WEBHOOK_SECRET`, `EVOLUTION_WEBHOOK_BASE_URL` (opcional; padrão
`NEXT_PUBLIC_SITE_URL` — local é o IP do host visto pelo Docker).

## Ambiente local (2026-10-25)

- A Evolution API v2.3.7 do usuário roda na stack "n8n" do Easypanel (Docker Swarm, rede
  `easypanel`), sem porta publicada. O container `wacrm-evo-proxy` (alpine/socat) publica
  `127.0.0.1:18081` → `n8n_evolution-api:8080`. Remover: `docker rm -f wacrm-evo-proxy`.
- A Evolution chama o app por `http://172.21.0.1:3000` (gateway do `docker_gwbridge`).
- A instância `n8n` do usuário existe nesse servidor e **não deve ser tocada**; as do app têm
  prefixo `wacrm-`.

## Verificado com WhatsApp real

QR lido com o celular → número "conectado" sozinho; envio de texto pela inbox (status voltou
"entregue"); recebidos texto, foto, vídeo e áudio (mídias espelhadas no storage); reação
enviada. Achados corrigidos: contato duplicado pelo nono dígito e `albumMessage` virando
"mensagem não suportada".
Resposta citando (customer → mensagem nossa) também validada: chega com `reply_to_message_id`.

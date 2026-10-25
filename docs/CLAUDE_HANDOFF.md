# Handoff — wacrm SaaS

Estado real do projeto para retomar o trabalho entre sessões. Atualize ao terminar
cada implementação (data + o que mudou). Última atualização: **2026-10-25**.

## Estado atual

- Clone do fork `JEFIRO/wacrm` em `/home/jefiro/Documentos/projetos/wacrm` (último commit
  upstream `34bce1a`).
- `main` **local** (sem push): C1–C3 + P1 (merge `752ffab`) e W1–W5 + correção da remoção de
  número (merge `a4a022e`), tela de números (`6f71c55`) e B1/B4 planos (migrations até 070).
  Todas as branches `feat/*` e `fix/*` já estão contidas na `main`.
- **Evolution local:** a do usuário (v2.3.7, stack "n8n" do Easypanel) via container
  `wacrm-evo-proxy` em `127.0.0.1:18081`; detalhes em `docs/saas/w3-instancia.md`. A instância
  `n8n` é do usuário — não tocar.
- Status de cada item do roadmap: `docs/saas/roteiro.md`. Pendências abertas: seção
  "Pendências e riscos" abaixo.
- Ambiente local funcionando (verificado em 2026-10-25): cadastro, login e dashboard
  carregando dados do Supabase local sem erros no console.

## Como rodar localmente

```bash
cd /home/jefiro/Documentos/projetos/wacrm
npx supabase start -x studio,logflare,vector,edge-runtime,imgproxy,supavisor,postgres-meta
npm run dev            # http://localhost:3000
npx supabase stop      # ao terminar (dados ficam em volumes Docker)
```

- Supabase local enxuto (sem Studio/logs/edge) porque o disco da máquina é apertado:
  em 2026-10-24 a partição `/` chegou a 100% durante o primeiro `supabase start`.
  Confira `df -h /` antes de baixar imagens.
- `.env.local` (ignorado pelo git) já tem as chaves do Supabase local, `ENCRYPTION_KEY`
  gerada, `NEXT_PUBLIC_APP_LOCALE=pt`, `WHATSAPP_TEMPLATES_DRY_RUN=true` e
  `META_APP_SECRET` **provisório** (webhooks da Meta não validam com ele).
- **Dados de teste** (banco local refeito em 2026-10-25): `node --env-file=.env.local
  --no-warnings scripts/dev/seed-local.mts` recria dono `teste@wacrm.test`
  (`TEST_USER_PASSWORD`), atendentes `jefferson@`/`jennifer@wacrm.test` (`TEST_AGENT_PASSWORD`),
  números falsos "Vendas" …0001 / "Suporte" …0002 e setores Vendas (Jefferson) / Suporte
  (Jennifer). Idempotente; recusa rodar fora do Supabase local. Tokens falsos: toda chamada
  real à Meta falha (esperado).
- Simular mensagem recebida (assinada como a Meta, com `META_APP_SECRET`), app rodando:
  `node --env-file=.env.local scripts/dev/simulate-inbound.mts <phone_number_id> "texto"`.
- Supabase local confirma e-mail automaticamente; o app ainda mostra "Verifique seu e-mail"
  após o cadastro — basta ir ao login. E-mails locais: mailpit em http://127.0.0.1:54324.
- Migrations: a última é a `071` (064–066 aplicadas com `migration up`; o reset do zero foi verificado até a 063); `supabase db reset --local` aplica todas do zero (verificado
  em 2026-10-25) e apaga os dados — depois rode o seed. Se o banco subir "from backup" sem
  migrations, rode `npx supabase migration up --local`.

## Linha de base de validação (2026-10-25, código igual ao upstream)

- `npm run typecheck`: sem erros.
- `npm test`: 1506 passaram, **3 falharam** em `src/lib/currency.test.ts`. A causa é o
  idioma da máquina (`LANG=pt_BR.UTF-8` formata `1.234` em vez de `1,234`), não bug do app:
  com `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx vitest run src/lib/currency.test.ts`
  os 10 testes passam. Rode a suíte com `LC_ALL=en_US.UTF-8` para comparar com o CI.
- `npm run lint`: 0 erros e 40 avisos, todos do upstream — compare a contagem, não espere zero.
- Última rodada completa (2026-10-25, com setores + distribuição): 1541 testes, typecheck,
  lint e build verdes; `supabase/ci/verify-schema.sql` ok.

## O que o wacrm já tem (relevante para o SaaS)

- Multi-tenant por `accounts` + RLS em todas as tabelas (migration 017).
- Equipe: convite por link com validade, papéis owner/admin/agent/viewer
  (`src/lib/auth/roles.ts`), atribuição de conversa (`conversations.assigned_agent_id`), presença.
  Um login pertence a uma única conta.
- Inbox compartilhada, contatos, funis (Kanban), campanhas com template, automações e flows
  com editor visual, assistente de IA com chave do cliente (BYOK) e base de conhecimento,
  API pública `/api/v1` com chaves por escopo, webhooks de saída, servidor MCP.

## Limitações conhecidas (verificadas no código)

- **Sem cobrança/planos/limites** de nenhum tipo.
- Campanhas, templates e API v1 saem sempre pelo **número padrão** da conta (C1 não
  deixa escolher o número de saída).
- **Só Meta Cloud API.** Sem Evolution/Baileys, sem Embedded Signup, sem coexistência
  (nenhum tratamento de `smb_message_echoes`). Configuração da Meta é manual (IDs + token).
- Campanhas rodam dentro da requisição (`maxDuration` 60–300 s), sem fila.
- Rate limit em memória (`src/lib/rate-limit.ts`) — válido só com uma instância.
- Automações/flows dependem de cron externo chamando `/api/automations/cron` e
  `/api/flows/cron` com `AUTOMATION_CRON_SECRET`.
- Permissão `delete-account` existe em `use-can.ts`, mas nenhuma tela a usa (LGPD).
- Avisos do Next 16 no `npm run dev`: `middleware` → `proxy` e Edge Runtime depreciados.

## Decisões de produto (tomadas com o usuário)

- **Modelo:** SaaS central; o cliente cria a conta e paga, sem deploy próprio.
- **Planos com usuários inclusos + usuário extra pago; teste grátis de 30 dias** (decidido em
  2026-10-25; implementado no B1 — `docs/saas/b1-planos.md`). Valores (editáveis na tabela `plans`):

  | | Essencial | Profissional | Business |
  |---|---|---|---|
  | Mensalidade | R$ 149 | R$ 349 | R$ 799 |
  | Usuários incluídos | 2 | 5 | 15 |
  | Números de WhatsApp | 2 | 5 | 7 |
  | Implantação | R$ 300 | R$ 600 | R$ 1.500 |

  Usuário adicional cobrado à parte (valor a definir). Sugestões em aberto: API com
  ~10.000 req/mês, implantação opcional no Essencial, "custo da Meta à parte" explícito,
  limite de armazenamento por plano, papel "viewer" sem custo.
- **Vários números por conta, um por setor** (ex.: conta Deslanxia → Vendas/Jefferson,
  Atendimento/Jennifer), com atendente vendo só o próprio setor e transferência entre setores.
- **WhatsApp oficial por coexistência** (app WhatsApp Business + Cloud API no mesmo número,
  via Embedded Signup). Exige empresa verificada + Tech Provider na Meta — processo de semanas.
- **Evolution API** para números não oficiais, instância criada automaticamente. **Revisado em
  2026-10-25: cada conta usa UM tipo — Meta OU Evolution, nunca os dois** (migration 067).
- **Cobrança:** preferência por Asaas (Pix/boleto/cartão recorrente + NFS-e).

## Roadmap sugerido

Roteiro detalhado, com grafo de dependências, IDs, estimativas e status: `docs/saas/roteiro.md`.

1. **Já:** iniciar verificação da empresa e pedido de Tech Provider na Meta.
2. **Fase 1:** cobrança (Asaas) + planos/limites/assentos; vários números por conta com
   acesso por setor; Evolution com instância automática e QR code.
3. **Fase 2:** coexistência Meta (Embedded Signup, echoes, sincronização de histórico).
4. **Fase 3:** fila de campanhas (Redis/BullMQ, intervalo anti-ban), relatórios por atendente,
   IA incluída no plano, exclusão de conta (LGPD). (Distribuição de leads foi adiantada e
   está implementada — ver Estado atual.)
5. **Produção:** VPS com monitoramento e backup, Supabase na nuvem, SMTP próprio,
   cron externo, termos de uso/privacidade, nota fiscal.

## Pendências e riscos

Lista única de pendências abertas. Ao resolver uma, apague a linha (e registre no Histórico).

### Setores e distribuição
- [ ] Botão Online/Offline do topo (`availability-toggle.tsx`) não foi visto na tela logado
      como atendente; a rota `/api/agents/settings` foi testada pela tela de Setores.
- [ ] Só o nó do fluxo coloca lead na distribuição; conversa nova que não passa por fluxo
      não é distribuída (decisão a confirmar com o usuário).
- [ ] Passo "Atribuir conversa" das automações segue no round-robin do upstream (devolve o
      primeiro membro) — não usa a distribuição.
- [ ] Decisão tomada sem o usuário, a confirmar: início de escala pego pelo
      cron de 1 min. Detalhes na spec.

### Inbox e acesso
- [ ] Conversa **nova** chega pelo tempo real como "Nenhuma mensagem ainda" até recarregar —
      corrida na hidratação de `src/app/(dashboard)/inbox/page.tsx` (código do upstream).
- [ ] Rotas com client service role e ID de conversa vindo do usuário (ex.: disparo manual de
      automação, `/api/automations/engine`) checam a conta, mas não o setor.

### WhatsApp / provedores
- [ ] Tela de números: salvar um número de setor de ponta a ponta
      (conectar + receber o setor) não foi testado — Meta local tem token falso; com QR exigiria
      setor com membro com escala na conta Loja QR.
- [ ] W5 sem limite diário por número, horário comercial nem pausar/cancelar pela tela.
- [ ] Evolution validado com WhatsApp real (texto, foto, vídeo, áudio, citação, reação,
      status) **exceto** chat endereçado por LID e envio citando (`quoted` só com `key.id`).
- [ ] O número "Evolution" do seed (`wacrm-dev-evolution`) só existe no servidor falso; com a
      Evolution real, a tela dele mostra erro 502 (instância inexistente). Esperado.
- [ ] Eventos da Evolution que chegam entre criar a instância e gravar o número caem no log
      "matched 0 numbers" (só o estado "conectando"; inofensivo).
- [ ] Contas de teste locais: `qr@wacrm.test` (conta só QR, número do servidor falso) e
      `novo@wacrm.test` (sem número), senha `TEST_USER_PASSWORD`.
- [ ] Evolution: template lança `EvolutionUnsupportedError` (nó de template num fluxo de conta QR
      falha). Botões/lista viraram menu numerado (W4).
- [ ] Evolution: "digitando…" não faz nada; mensagens enviadas pelo próprio celular (`fromMe`)
      aparecem pelo eco (testado com WhatsApp real); `connection.update` tratado no W3.
- [ ] Campanhas, templates, registro e webhook seguem falando direto com `meta-api.ts`
      (só existem na Meta); campanha via Evolution é o W5.

### Produto e plataforma
- [ ] B1: teste usa os limites do Profissional (decisão sem o usuário); preço do usuário extra
      e do plano anual a definir.
- [ ] Modo limitado/bloqueio só muda de estado pela data do teste até existir o B2 (Asaas).
- Itens da tabela de planos que o sistema não faz: limite de números por plano, cota mensal
  de API, recursos por plano, relatórios por atendente/exportação.
- Coexistência: requisitos e limites da Meta mudam com frequência — confirmar na
  documentação oficial antes de prometer a clientes.
- Evolution: risco de banimento em campanhas; deixar claro nos termos de uso.
- Merges do upstream ficam mais caros conforme o fork diverge.
- `graphify-out/` (grafo parcial, só AST do código) ficou na pasta do projeto; geração do
  grafo completo foi interrompida a pedido do usuário.

## Histórico

- **2026-10-24** — clone, `npm ci`, Supabase local, migrations, `.env.local`, app no ar.
- **2026-10-25** — avaliação técnica do SaaS e decisões de produto acima; criados
  `CLAUDE.md` e este handoff. `CLAUDE.md` revisado com o guia
  `skils/claude-md-que-funciona-v2` (mapa curto, gate, armadilhas, teto de 120 linhas).
  Branch `feat/c1-canais` criada para o item C1.
- **2026-10-25** — C1 implementado na branch (migration 060, `channels.ts`, ~25 pontos de
  leitura de config, API de config multi-número, barra de números e etiqueta na inbox).
  Verificado: suíte 1517 testes, schema check do CI, webhook simulado (1 contato → 2
  conversas, uma por número) e tela de configuração no navegador. (`db reset` do zero feito
  depois, junto com a distribuição.)
- **2026-10-25** — C2 implementado na branch (migration 061: `whatsapp_config_members`,
  `can_access_channel`, RLS de conversas/mensagens/reações, `dashboard_overview` como
  INVOKER; "Quem atende este número" nas configurações). Verificado: matriz de acesso como
  cada usuário com RLS, 6 tentativas de burla bloqueadas, painel do dono inalterado, login
  como atendente mostrando só o setor, tempo real sem vazamento, gate verde.
- **2026-10-25** — C3 implementado na branch (migration 062: `sector_channel_id`,
  `transfer_conversation()`, gatilho que impede trocar o número de envio; menu Atribuir →
  "Transferir para o setor"; etiqueta "Suporte → Vendas" na inbox, inclusive em tempo real).
  Pendência vista no teste: conversa **nova** chega pelo tempo real como "Nenhuma mensagem
  ainda" até recarregar — corrida na hidratação de `inbox/page.tsx` (código do upstream, não
  ligado a setores; não corrigido).
- **2026-10-25** — Setores próprios + distribuição de leads (spec
  `docs/saas/setores-e-distribuicao.md`): 061/062 **reescritas** antes do merge (setor deixou de
  ser "equipe do número"), 063 nova (escala, online/offline, limite, fila, `claim_lead` com
  trava). Banco local refeito com `supabase db reset` (todas as 63 migrations do zero, OK) e
  `scripts/dev/seed-local.mts`. Verificado: 22 testes de regras + 2 de catálogo, fluxo real
  (3 leads ao Jefferson, 4º na fila com "segunda-feira às 12:00"), rebalanceamento ao abrir
  vaga, offline devolvendo não iniciados, online puxando a fila, `started_at` por gatilho,
  corrida de duas atribuições com trava (só uma ganha), gate verde. **Sem commit** (pedido).
  Pendências abertas → seção "Pendências e riscos".
- **2026-10-25** — Regras de cadastro pedidas pelo usuário (migration **064**):
  setor só existe com pelo menos 1 funcionário (`create_sector`, último membro não sai) e
  funcionário só entra em setor com escala (`replace_agent_schedule` atômico; sem escala =
  nunca elegível). Remover da equipe a única pessoa de um setor é recusado. Tela de Setores
  trava as caixas e pede membros ao criar. Verificado: 13 casos SQL (inclusive COMMIT real
  e remoção de membro), API recusando escala vazia, criação de setor pela tela, gate verde
  (1541 testes, typecheck, lint 0 erros, build) e schema check. Seed cria escala 24h × 7.
- **2026-10-25** — Aviso de fila com nova tentativa (migration **065**): envio que falha fica
  guardado e o cron tenta de novo (1/5/15/60 min, 5 envios); lead que saiu da fila descarta o
  aviso; ao desistir, alerta em Configurações → Setores. Verificado ao vivo (fluxo real →
  falha → cron reagenda → 5ª falha → alerta na tela) e em testes com banco simulado (sucesso,
  falha, lead fora da fila, autor ausente). Caminho de envio com sucesso só nos testes (token
  local é falso). Gate verde (1546 testes). Commit de C2/C3 com setores, P1, 064 e 065.
- **2026-10-25** — Merge local de `feat/c1-canais` na `main` (`752ffab`, sem push).
- **2026-10-25** — W1 camada de provedor (branch `feat/w1-provedor`, sem commit): migration
  066 (`whatsapp_config.provider`), interface `WhatsAppProvider` + implementação Meta +
  `loadChannelProvider`; composer, fluxos, automações, reação, "digitando" da IA, proxy de
  mídia e saúde do número passaram a usar o provedor. Verificado: 6 testes do provedor,
  suíte inteira (1552) sem mudar testes antigos além do mock da IA, envio real local chegando
  à Meta (token inválido, esperado), número `evolution` recusado com erro claro no log, gate
  verde e schema check.
- **2026-10-25** — Commit do W1 (`7e2570e`). W2 Evolution (sem commit): pipeline de entrada
  extraído do webhook da Meta para `src/lib/whatsapp/inbound.ts` (testes do webhook verdes sem
  mudança), provedor Evolution, tradução pura do payload e `POST /api/whatsapp/evolution/webhook`
  com segredo em cabeçalho. Ferramentas: `scripts/dev/fake-evolution.mts`,
  `scripts/dev/simulate-evolution.mts`, número "Evolution" no seed. Verificado local com o
  servidor falso: texto e imagem na inbox (imagem espelhada), resposta citando, reação,
  status até "lido", 401 com segredo errado; 24 testes novos; gate verde (1570).
- **2026-10-25** — Commit do W2 (`d134241`). W3 número por QR code: `evolution/admin.ts`,
  rotas `/api/whatsapp/evolution/instances[/:id]`, tela `EvolutionConnect`, `connection.update`
  no webhook. Proxy local `wacrm-evo-proxy` para a Evolution do usuário. Teste com WhatsApp
  real (número pessoal do usuário, envio só para o número que ele autorizou): QR → conectado,
  envio + status entregue, recebidos texto/foto/vídeo/áudio (espelhados), resposta citando,
  reação. Corrigidos na hora: nono dígito (contato duplicado — `phone-utils.ts`, vale p/ Meta)
  e envelope `albumMessage`.
- **2026-10-25** — Commit do W3 (`26c9d78`). Botões/lista testados na Evolution real: não
  aparecem (botões) / erro do servidor (lista) → W4 com menu numerado. **Um tipo de conexão por
  conta** (migration 067 + 409 nas rotas + escolha só na conta sem número). Seed: número
  Evolution movido para a conta `qr@wacrm.test`. Verificado: regra no banco (3 casos), 409 na
  API, aviso na conta Meta, escolha na conta nova; gate verde (1577) e schema check.
- **2026-10-25** — Commit da regra um-tipo-por-conta (`9cae7f6`). W4 (sem commit): menu numerado
  no lugar de botões/lista no provedor Evolution, resposta "1"/título → toque com o id da opção,
  conta QR sem janela de 24h / sem template / avisos em Modelos e Disparos. Testado com WhatsApp
  real (menu + resposta "1" → `btn_sim`) e na conta `qr@wacrm.test`. Gate verde (1582).
- **2026-10-25** — Commit do W4 (`697c9a3`). Eco de mensagens `fromMe` (celular/Web) na inbox,
  sem duplicar as do app (verificado). W5: fila de campanhas de texto no banco + cron
  (`/api/broadcasts/cron`), intervalo aleatório, assistente na conta QR, detalhe com estado da
  fila. Campanha real: 2 envios ao número autorizado com 21 s de intervalo. Corrigidos no teste:
  cursor ao inserir variável, `{{…}}` no texto de exemplo (ICU), aviso "Retomar" em campanha de
  texto, erro da Evolution prefixado como "Meta API error". Gate verde (1590).
- **2026-10-25** — Eco testado com dois números reais conectados (um em cada conta): mesma
  mensagem gravada como eco num e recebida no outro. Corrigido: checagem do eco escopada por
  número (o id da mensagem é igual nos dois lados). Tela de número QR mostra "Conexão não
  encontrada" quando a instância foi apagada no servidor (antes: erro repetido a cada 3 s).
- **2026-10-25** — Commit do W5 + eco (`4a347da`). **Bug de remoção de número** (vinha da 062, já
  na `main`): remover número com conversas falhava com "the sending number of a conversation
  cannot be changed" — o FK zera o número das conversas e a trava achava que era troca. Migration
  069 libera só esse caso (número de fato removido); trocar ou forçar órfã segue bloqueado
  (testado no banco). Afetava Meta e QR. Branch `fix/remover-numero`. Os dois números reais do
  usuário foram removidos pela tela (instâncias `wacrm-` apagadas; `n8n` intocada; histórico
  local mantido).
- **2026-10-25** — Commit da correção (`202738b`) e merge de W1–W5 na `main` (`a4a022e`, sem push).
  Dados dos números reais do usuário apagados do banco local (3 contatos com conversas e
  mensagens, 2 campanhas de teste, 3 mídias espelhadas).
- **2026-10-25** — Tela de números reorganizada (pedido do usuário; na `main`): "Número principal da empresa" (o padrão — recebe tudo, sem setor fixo; o fluxo
  encaminha) separado de "Números dos setores (opcional)". Adicionar número de setor pede o
  setor antes de conectar (o formulário só aparece depois) e grava o setor no número salvo;
  "Tornar número principal" troca o principal. Decisões do usuário: principal roteia pelo
  fluxo/menu; números de setor opcionais.
- **2026-10-25** — Merge da tela de números (`6f71c55`). B1 + B4 (na `main`): `plans` + `account_subscriptions` (migration 070), teste de 30 dias por gatilho em
  `accounts`, limite de números no banco e nas rotas, Configurações → Plano e uso. Verificado:
  limite no banco (Essencial recusa o 3º número, Profissional aceita), tela com dados reais.
- **2026-10-25** — Merge do B1 (`b3d51b1`). Fim do teste (na `main`): sem
  implantação, plano Anual Completo (preço a definir), fim do teste/atraso → modo limitado por
  30 dias → bloqueio (decisões do usuário). Aplicado no envio da inbox/API, disparos, IA,
  números, convites, fluxos e automações (só no bloqueio), aviso e tela de bloqueio. Testado
  na tela e nas rotas (limitado: aviso + envio 5 s + 402 em disparo/convite; bloqueado: tela +
  402). Chave do Asaas **sandbox** no `.env.local` (escapar o `$` como `\$` — o Next expande
  variáveis); testada (200).


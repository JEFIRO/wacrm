# Handoff — wacrm SaaS

Estado real do projeto para retomar o trabalho entre sessões. Atualize ao terminar
cada implementação (data + o que mudou). Última atualização: **2026-10-25**.

## Estado atual

- Clone do fork `JEFIRO/wacrm` em `/home/jefiro/Documentos/projetos/wacrm`, branch `main`,
  sem alterações de código em relação ao upstream (último commit upstream `34bce1a`).
- Branch `feat/c1-canais` (sem commit): **C1 implementado** — vários números por conta,
  ver `docs/saas/c1-canais.md`. Demais itens do roadmap ainda são plano.
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
- Conta de teste local: `teste@wacrm.test`; a senha está comentada no fim do `.env.local`.
  Tem dois números falsos ("Vendas" …0001 e "Suporte" …0002) com token cifrado inválido:
  servem para testar roteamento, mas toda chamada real à Meta falha (esperado).
- Simular mensagem recebida (assinada como a Meta, com `META_APP_SECRET`), app rodando:
  `node --env-file=.env.local scripts/dev/simulate-inbound.mts <phone_number_id> "texto"`.
- Supabase local confirma e-mail automaticamente; o app ainda mostra "Verifique seu e-mail"
  após o cadastro — basta ir ao login. E-mails locais: mailpit em http://127.0.0.1:54324.
- Migrations: 54 aplicadas (001–059 com buracos). Se o banco subir "from backup" sem
  migrations, rode `npx supabase migration up --local`.

## Linha de base de validação (2026-10-25, código igual ao upstream)

- `npm run typecheck`: sem erros.
- `npm test`: 1506 passaram, **3 falharam** em `src/lib/currency.test.ts`. A causa é o
  idioma da máquina (`LANG=pt_BR.UTF-8` formata `1.234` em vez de `1,234`), não bug do app:
  com `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx vitest run src/lib/currency.test.ts`
  os 10 testes passam. Rode a suíte com `LC_ALL=en_US.UTF-8` para comparar com o CI.
- `npm run lint` e `npm run build` ainda não foram rodados localmente.

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
- Todo atendente vê todas as conversas da conta (sem permissão por setor/número).
- Campanhas rodam dentro da requisição (`maxDuration` 60–300 s), sem fila.
- Rate limit em memória (`src/lib/rate-limit.ts`) — válido só com uma instância.
- Automações/flows dependem de cron externo chamando `/api/automations/cron` e
  `/api/flows/cron` com `AUTOMATION_CRON_SECRET`.
- Permissão `delete-account` existe em `use-can.ts`, mas nenhuma tela a usa (LGPD).
- Avisos do Next 16 no `npm run dev`: `middleware` → `proxy` e Edge Runtime depreciados.

## Decisões de produto (tomadas com o usuário)

- **Modelo:** SaaS central; o cliente cria a conta e paga, sem deploy próprio.
- **Planos propostos** (ainda não fechados):

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
- **Evolution API em conjunto** para números não oficiais, instância criada automaticamente.
- **Cobrança:** preferência por Asaas (Pix/boleto/cartão recorrente + NFS-e).

## Roadmap sugerido

Roteiro detalhado, com grafo de dependências, IDs, estimativas e status: `docs/saas/roteiro.md`.

1. **Já:** iniciar verificação da empresa e pedido de Tech Provider na Meta.
2. **Fase 1:** cobrança (Asaas) + planos/limites/assentos; vários números por conta com
   acesso por setor; Evolution com instância automática e QR code.
3. **Fase 2:** coexistência Meta (Embedded Signup, echoes, sincronização de histórico).
4. **Fase 3:** fila de campanhas (Redis/BullMQ, intervalo anti-ban), distribuição automática
   de leads, relatórios por atendente, IA incluída no plano, exclusão de conta (LGPD).
5. **Produção:** VPS com monitoramento e backup, Supabase na nuvem, SMTP próprio,
   cron externo, termos de uso/privacidade, nota fiscal.

## Pendências e riscos

- Itens da tabela de planos que o sistema não faz: limite de números por plano, distribuição de leads,
  cota mensal de API, recursos por plano, relatórios por atendente/exportação.
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
  conversas, uma por número) e tela de configuração no navegador. Pendente: `supabase db
  reset` do zero (apaga o banco local — pedir antes), revisão e merge.

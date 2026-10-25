# CLAUDE.md — wacrm (fork JEFIRO)

@AGENTS.md

> **Mapa, não manual.** Este arquivo aponta para a fonte da verdade; não duplica.
> **Fonte da verdade é o código.** Onde um documento divergir dele, vale o código —
> avise a divergência e corrija o documento na mesma mudança. Teto: 120 linhas.

Fork do template [ArnasDon/wacrm](https://github.com/ArnasDon/wacrm) (Next.js 16 +
Supabase), em transformação para **SaaS multi-cliente**: um deploy central onde o cliente
cria a conta e paga. Ainda não está em produção; o trabalho segue `docs/saas/roteiro.md`.
Responda e documente em **pt-BR**; código, identificadores e commits em inglês, como o upstream.

## Comandos

```bash
npx supabase start -x studio,logflare,vector,edge-runtime,imgproxy,supavisor,postgres-meta
npx supabase migration up --local   # SEMPRE após criar migration ou se o banco subir "from backup"
npm run dev                         # app em http://localhost:3000 (precisa do Supabase de pé)
npm run lint && npm run typecheck && LC_ALL=en_US.UTF-8 npm test && npm run build   # gate
```

O gate acima é o mesmo do CI e define verde. Vermelho não se entrega como pronto.
Mudança visível no app: confira no navegador, não só nos testes.

## Mapa

```
src/lib/whatsapp/   única porta para o WhatsApp; meta-api.ts é o cliente da Meta
src/app/api/v1/     API pública com chave por escopo — contrato com integrações de clientes
supabase/migrations/ fonte da verdade do schema e das políticas RLS
docs/saas/          documentação do SaaS (nossa); demais docs/ e README são do upstream
skils/              material de referência de skills, não é código do app
```

- Envio de WhatsApp passa por `src/lib/whatsapp/`; não chame a Graph API direto de rota,
  automação ou componente — estenda a camada.
- Código novo do SaaS vai em arquivos/módulos próprios; nos arquivos do upstream, mude o
  mínimo. Cada linha alterada ali vira conflito no próximo merge do upstream.

## Como trabalhar aqui

**1. Pense antes de codar.** Não assuma; exponha tradeoffs. Se o alvo estiver ambíguo,
pergunte antes de planejar. Antes de presumir que um recurso existe (Evolution, cobrança,
acesso por setor), confira o status em `docs/saas/roteiro.md` e no código.

**2. Simplicidade primeiro.** Código mínimo que resolve o pedido. Sem abstração para uso
único, sem flexibilidade não pedida.

**3. Mudanças cirúrgicas.** Toque só no que o pedido exige; case com o estilo existente.
Não migre `middleware.ts` → `proxy` nem outros avisos de depreciação do Next 16 sem pedido.
Aponte código morto pré-existente; não apague.

**4. Reuse antes de criar.** Antes de criar função, hook, componente ou rota, busque em
`src/lib/`, `src/hooks/`, `src/components/` algo com o mesmo propósito (nomes diferentes
contam). Reutilize ou estenda; só crie se nada servir, e diga em uma linha o que achou.
Auditoria sob demanda, sem refatorar em massa:
`npx jscpd --reporters ai --summary src --ignore "**/*.test.*,**/messages/**"`.

**5. Execução orientada a objetivo.** Defina o critério de sucesso e verifique. Relate o
resultado real (comando, contagem, falhas); sem evidência não está concluído.

## Convenções

- Toda tabela nova tem `account_id` + RLS via `is_account_member(account_id[, papel])`,
  no padrão da migration 017. Rota resolve a conta pela sessão ou chave de API, nunca por
  ID vindo do cliente.
- Migration nova = próximo número livre (`ls supabase/migrations | tail -1`). Nunca edite
  uma já aplicada; crie outra. Antes de trazer o upstream, confira colisão de número.
- Token/chave de terceiro é salvo cifrado (`src/lib/whatsapp/encryption.ts`), nunca em claro.
- Texto de interface vai em `messages/*.json` via `next-intl`; adicione a chave nos 4 catálogos
  (`en`, `pt`, `es`, `ko`) — `src/i18n/messages.test.ts` falha se faltar em algum.

## Não faça / cuidado

- ⚠️ Rotas de webhook, cron e engines usam o client **service role**, que ignora RLS. Ali,
  todo `select`/`update` precisa de filtro explícito por `account_id` — sem ele, uma conta
  lê ou altera dados de outra, sem erro nem teste vermelho.
- ⚠️ Uma conta tem vários números (migration 060). Nunca leia `whatsapp_config` com
  `.eq('account_id').single()`/`.maybeSingle()` — quebra com o 2º número. Use `loadChannel`
  e `findOrCreateChannelConversation` (`src/lib/whatsapp/channels.ts`).
- ⚠️ `supabase start` pode subir o banco "from backup" **sem migrations**: o app abre, mas
  tudo que toca o banco falha. Rode `migration up --local` e confira.
- ⚠️ A máquina está em pt-BR: sem `LC_ALL=en_US.UTF-8`, testes de formatação de moeda falham
  por causa do idioma, não do código.
- ⚠️ Disco local apertado: confira `df -h /` antes de baixar imagens Docker; não suba o
  Supabase completo (Studio, logs) sem necessidade.
- Peça confirmação humana antes de: commit/push, migration destrutiva (DROP, mudança de
  constraint com dados), envio real de mensagens em massa, cobrança real, apagar dados.
  Para testar envio, use `WHATSAPP_TEMPLATES_DRY_RUN=true` e a conta de teste local.
- Nunca use `git checkout -- .`, `reset --hard`, `clean` ou `stash` sem pedido; confira
  `git status` ao começar e preserve alterações locais.
- Nunca versione secrets: `.env*` é ignorado, só `.env.local.example` entra.

## Fontes da verdade

- `docs/CLAUDE_HANDOFF.md` — leia no início de cada sessão: estado real, ambiente local,
  limitações conhecidas, decisões de produto e pendências.
- `docs/saas/roteiro.md` — grafo de dependências, IDs, estimativas e status de cada item.
- `docs/multi-waba.md`, `docs/public-api.md` (upstream) — como a Meta e a API v1 funcionam hoje.

## Grafo do código (Graphify)

- Se `graphify-out/graph.json` existir, consulte-o com `/graphify query "<pergunta>"` antes
  de varrer arquivos. Se não existir, gere com `/graphify .` ou siga com busca normal.
- Após mudança grande de estrutura: `graphify update .` e
  `graphify export obsidian --dir docs/grafo`. `docs/grafo/` é gerado: não leia nem edite.

## Ao terminar uma implementação

Atualize o status em `docs/saas/roteiro.md` e o estado em `docs/CLAUDE_HANDOFF.md`. Se
mudou arquitetura, banco, autenticação, cobrança ou camada WhatsApp, crie ou atualize o
documento da área em `docs/saas/`. Erro que custou caro vira uma linha em "Não faça".

---

**Estas regras funcionam se:** os diffs ficam restritos ao pedido, nenhuma consulta
service role sai sem `account_id`, e cada sessão começa sabendo o estado pelo handoff
em vez de perguntar.

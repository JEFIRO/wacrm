# C1 — Vários números (canais) por conta

Status: **aceita** · Item do roteiro: C1 · Branch: `feat/c1-canais`

## Problema

Uma conta só pode ter um número de WhatsApp (`whatsapp_config` tem `UNIQUE(account_id)`) e
um contato só pode ter uma conversa por conta. A Deslanxia precisa de "Vendas" e
"Atendimento", cada um com seu número, na mesma conta.

## Decisões

- **Canal = uma linha de `whatsapp_config`.** Não criamos tabela nova: a tabela já tem
  token cifrado, RLS por conta e é lida em ~25 pontos. Ganha duas colunas:
  - `label` — nome do setor mostrado na interface ("Vendas").
  - `is_default` — canal usado quando a ação não tem conversa (campanha, API, automação
    sem conversa, templates). Exatamente um por conta (índice único parcial).
- **Conversa pertence a um canal:** `conversations.whatsapp_config_id` (FK, `ON DELETE SET
  NULL`). Unicidade passa de `(account_id, contact_id)` para
  `(account_id, contact_id, whatsapp_config_id)`: o mesmo cliente tem uma conversa por
  número, e continua **um contato só** no CRM.
- **Resposta sai pelo número da conversa.** Toda escolha de canal passa pelo helper
  `src/lib/whatsapp/channels.ts` (`loadChannel`): canal pedido → senão o padrão.
- **Conversa órfã é adotada.** Ao desconectar um número, as conversas ficam com canal
  `NULL` (histórico preservado). Quando chega mensagem para aquele contato num canal, uma
  conversa órfã dele é adotada antes de criar outra — reconectar o número não parte o histórico.
- Migration existente: todo número atual vira o canal padrão da conta, e toda conversa
  existente é ligada a ele.

## Como ficou implementado

- Migration `060_whatsapp_channels.sql`: colunas, gatilhos do padrão (o primeiro número
  da conta vira padrão; apagar o padrão promove o mais antigo), `conversations.whatsapp_config_id`
  e o novo índice único.
- `src/lib/whatsapp/channels.ts`: `loadChannel` (canal pedido → padrão) e
  `findOrCreateChannelConversation` (usado pelo webhook, pela API v1 e pelo envio a partir de
  um contato). Nenhum ponto lê mais a `whatsapp_config` com `.eq('account_id').single()`.
- Envio pelo número da conversa: inbox, reação, automações, flows e "digitando" da IA
  (`assertConversationInAccount` agora devolve o canal da conversa).
- Mídia: o webhook grava a URL do proxy com `?channel=<id>`; a rota de mídia usa o token
  daquele número (URLs antigas sem o parâmetro caem no padrão).
- `/api/whatsapp/config`: `GET`/`DELETE`/`verify-registration` aceitam `?channel=`; `POST`
  aceita `channel_id` (editar), `is_new` + `label` (adicionar); `PATCH` novo para renomear e
  trocar o padrão sem revalidar na Meta.
- Interface: `whatsapp-channels.tsx` (barra de números acima do formulário existente) e
  etiqueta do setor em cada conversa da inbox.
- ⚠️ **Mudança aditiva na API pública:** `/api/v1/conversations` passa a trazer
  `channel: { id, label, phone_number_id }`. Nenhum campo saiu.

## Fora do escopo do C1

- Acesso por setor (atendente só vê o próprio canal) → **C2**.
- Transferência entre setores → **C3**.
- Escolher o número de saída em campanha, API v1 e automações: usam o canal padrão.
- Templates de WABAs diferentes por canal: templates seguem o WABA do canal padrão.
- Limite de números por plano → **B4**.
- Evolution → **W1/W2**.

## Pronto quando

1. Uma conta salva dois números com rótulos e escolhe o padrão em Configurações.
2. Mensagem recebida no número B cria/usa a conversa do canal B; o mesmo contato tem
   conversas separadas nos números A e B, e a inbox mostra de qual número é cada uma.
3. Responder pela inbox sai pelo número da conversa (reação, mídia e digitando também).
4. Conta com um número só continua funcionando como antes.
5. Gate verde (`lint`, `typecheck`, testes com `LC_ALL=en_US.UTF-8`, `build`) e migration
   aplicando do zero (`supabase db reset`).

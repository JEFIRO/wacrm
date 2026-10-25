# C3 — Transferir conversa entre setores

Status: **aceita** · Item do roteiro: C3 · Depende de: C2 · Branch: `feat/c1-canais`

## Problema

O cliente escreve no número do Atendimento, mas quer comprar. A conversa precisa passar
para a equipe de Vendas.

## Decisões

- **A conversa continua no mesmo número.** Transferir troca **quem atende**, não o número
  de envio: mudar o número faria o cliente receber mensagens de um número desconhecido e,
  na Meta, cairia fora da janela de 24h daquele número (só template).
- Nova coluna `conversations.sector_channel_id`: equipe (setor de um número) responsável
  pela conversa. `NULL` = a equipe do próprio número. Transferir de volta para o próprio
  número grava `NULL`.
- O acesso do C2 passa a usar o **setor efetivo** = `COALESCE(sector_channel_id,
  whatsapp_config_id)`.
- Quem pode transferir: qualquer atendente que vê a conversa, pela função
  `transfer_conversation()` (SECURITY DEFINER). Um `UPDATE` direto não serve: no Postgres,
  a linha resultante de um UPDATE precisa continuar visível a quem atualiza (as políticas de
  SELECT valem para a linha nova), e quem transfere para outro setor deixa de vê-la.
- Interface: seção "Transferir para o setor" dentro do menu **Atribuir** da conversa (um
  botão próprio no cabeçalho empurrava o contador de 24h para cima dos outros controles).
- Transferir **limpa a atribuição** (o atendente antigo pode não ser do setor novo).
- Proteções no banco (gatilho): o setor tem de ser um número da mesma conta, e o número de
  envio (`whatsapp_config_id`) não pode ser trocado pelo cliente — só preenchido quando a
  conversa estava órfã (adoção do C1).
- A inbox mostra o setor efetivo na etiqueta ("Vendas", ou "Suporte → Vendas" quando
  transferida).

## Fora do escopo

- Aviso/notificação para a equipe que recebeu (a notificação de atribuição já existe:
  atribuir a alguém do setor novo notifica a pessoa).
- Histórico de transferências.

## Pronto quando

1. Atendente do Suporte transfere uma conversa para Vendas pelo menu Atribuir; ela
   some da inbox dele e aparece para Vendas, ainda respondendo pelo número do Suporte.
2. Dono vê a etiqueta "Suporte → Vendas".
3. Atendente não consegue trocar o número de envio nem transferir para número de outra conta.
4. Gate verde.

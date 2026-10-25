# Setores e distribuição de leads

Status: **aceita** · Itens do roteiro: refaz C2/C3 + P1 · Branch: `feat/c1-canais`

## Problema

O C2/C3 amarrou "setor" a "número de WhatsApp". Um número só (o caso comum) não conseguia
ter Suporte e Vendas, e o nó "Transferir para agente" do fluxo só marcava a conversa como
pendente e atribuía um agente fixo. O pedido: o fluxo encaminha o lead a um **setor** e o
sistema **distribui** entre os atendentes desse setor.

## Modelo

- **Setor** (`sectors`) é da conta, independente do número. Atendente pertence a um ou mais
  setores (`sector_members`). Cada número tem um **setor padrão** (`whatsapp_config.default_sector_id`);
  conversa nova herda o setor padrão do número em que chegou.
- **Conversa** guarda `sector_id`. Transferir (C3) = trocar o setor; o número de envio não muda.
- **Acesso** (C2) passa a ser por setor (`can_access_sector`): dono/admin veem tudo; conversa
  sem setor é aberta. (A regra "setor sem membros = aberto" continua no banco só como
  rede de segurança: pela migration 064 um setor não fica sem membros.)
- **Regras de cadastro** (decisão do usuário, 2026-10-25; migration 064, checadas no banco
  no COMMIT):
  - setor **sempre tem pelo menos 1 funcionário**: é criado junto com os membros
    (`create_sector`) e o último não pode sair (troque antes ou exclua o setor);
  - funcionário **só entra em setor se tiver escala**, e a escala de quem está em setor não
    pode ficar vazia (`replace_agent_schedule` troca tudo de uma vez);
  - remover da equipe a única pessoa de um setor é recusado; ao sair da conta, os setores,
    a escala e o status da pessoa naquela conta são apagados.
- **Atendente** (`agent_settings`): online/offline manual (o próprio ou dono/admin) e limite
  de leads simultâneos (padrão 3). **Escala** (`agent_schedules`): dia da semana + início e
  fim, várias faixas por dia, no fuso da conta (`accounts.timezone`, padrão
  `America/Sao_Paulo`). **Sem nenhuma faixa = nunca elegível** (não pode estar em setor).
- **Lead ativo** de um atendente = conversa atribuída a ele e não encerrada.
  **Lead iniciado** = o atendente enviou mensagem depois de recebê-lo (`started_at`, gravado
  por gatilho; zera quando a conversa muda de dono).

## Regras de distribuição (`src/lib/distribution/`, puro e testado)

- **Elegível** = membro do setor + online + dentro da escala agora + abaixo do limite.
- **Escolha**: menor número de leads ativos; empate → sorteio (gerador injetável).
- **Ninguém elegível** → lead vai para a **fila do setor** (`queued_at`) e o cliente recebe,
  **uma vez por lead** (`queue_notice_sent_at`), a mensagem configurada no nó, com
  `{proximo_horario}` = próximo início de faixa futura entre os atendentes do setor, no fuso
  da conta. Sem faixa futura → a variável sai vazia e a frase é enviada sem data.
- **Aviso que falhou** (migration 065): o texto fica guardado na conversa e o cron tenta de
  novo após 1, 5, 15 e 60 min (5 envios ao todo). Se o lead sair da fila antes, o aviso é
  descartado. Esgotadas as tentativas, `queue_notice_failed_at` marca o lead e Configurações →
  Setores mostra o alerta para o admin responder manualmente.
- **Atribuição atômica**: `claim_lead()` no banco trava o registro do atendente
  (`FOR UPDATE`), reconta a carga e só atribui se ainda couber.
- **Rebalanceamento** (só quando abre vaga): lead atribuído e **não iniciado** muda para outro
  elegível do mesmo setor se a diferença de carga for **≥ 2**, no máximo **2 trocas por lead**.
  Lead iniciado nunca é movido.
- **Atendente fica offline**: leads não iniciados voltam para a fila e são redistribuídos;
  iniciados ficam com ele e aparecem como aviso para o admin em Configurações → Setores.

## Quando a distribuição roda ("abriu vaga")

- Lead encerrado, reaberto ou transferido; atendente fica online; limite aumentado → a tela
  chama `POST /api/distribution/run` logo após a ação (resposta imediata).
- Escala começa → o cron que já existe (`/api/automations/cron`, a cada minuto) também roda
  a distribuição. Ele não move nada por tempo parado: só age se a elegibilidade mudou.
- Lead entra pelo nó do fluxo → distribuído na hora.

## Fora do escopo

- Passo "Atribuir conversa" das automações continua como está (modo round-robin do upstream).
- Notificação ao cliente quando sai da fila (ele só recebe a mensagem de fila uma vez).

## Pronto quando

1. Testes Vitest: menos leads, empate aleatório, fora da escala, offline, limite cheio,
   fila com mensagem e próximo horário (virada de semana e fuso), caso A=3 / B 2→1.
2. Fluxo com nó por setor distribui ao vivo entre atendentes; sem ninguém → fila + mensagem.
3. Online/offline e limite em Configurações; offline devolve não iniciados à fila.
4. Gate verde (lint, typecheck, testes com `LC_ALL=en_US.UTF-8`, build) e schema check.

## Tela de números (2026-10-25)

Configurações → WhatsApp separa o **número principal da empresa** (o número padrão: todas as
conversas chegam por ele, sem setor fixo — o fluxo/menu encaminha ao setor) dos **números dos
setores** (opcionais: cada um com o setor que atende, para o cliente falar direto com o setor).


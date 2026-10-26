# B5 — Cadastro já no plano (teste grátis ou assinar agora)

Status: **na `main`** · Item do roteiro: B5

## Fluxo

1. **Cadastro** (`/signup`): a pessoa escolhe o plano do teste (Essencial, Impulso — marcado por
   padrão — ou Anual). Link do site já escolhe: `/signup?plano=essencial` | `impulso` | `anual`.
   O plano vai nos metadados do usuário (`plan`) e o gatilho do teste (076) cria a conta em
   **teste de 30 dias nesse plano** (id desconhecido/inativo → Impulso). Convites não mostram
   planos (a pessoa entra numa conta que já existe).
2. **"Quero assinar agora"** (opcional no cadastro): depois de confirmar o e-mail a pessoa cai em
   `/settings?tab=plan&assinar=<plano>`, que abre direto o formulário de assinatura (CPF/CNPJ →
   fatura).
3. **Durante o teste**: "Testar este plano" troca o plano do teste sem pagar
   (`POST /api/billing/trial-plan`, dono, só enquanto em teste e antes de assinar). Nos **últimos
   7 dias** do teste aparece o aviso "Seu teste grátis termina em N dias" com "Ver planos e
   assinar".
4. Planos ativos são legíveis sem login (076) — a tela de cadastro lista os preços.

## Verificado (2026-10-26)

Cadastro pela tela com `?plano=essencial` → conta em teste no Essencial até 25/11; contas
criadas com plano inexistente → Impulso; sem login só aparecem os 3 planos ativos; "Testar este
plano" → teste no Impulso; `?assinar=impulso` abriu o formulário; aviso com o teste terminando em
3 dias. Gate verde.

## Pendências

- O site de vendas deve apontar os botões "Começar teste grátis" para `/signup?plano=<id>`.

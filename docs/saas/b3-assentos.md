# B3 — Usuários do plano (assentos) e usuário adicional pago

Status: **na `main`** · Item do roteiro: B3

## Regra

Vagas = usuários inclusos no plano + usuários adicionais comprados. Todo membro ocupa vaga,
menos o **Leitor** (somente visualização).

- **Banco (073)**: gatilho em `profiles` recusa (`plan_seat_limit`) quem não é leitor entrar na
  conta (aceite do convite) ou um leitor ser promovido sem vaga. Quem já ocupa vaga não conta de
  novo (ex.: atendente → admin). Membros existentes nunca são removidos (ex.: plano menor).
- **Convite** (`POST /api/account/invitations`): convite que não é de leitor é recusado (403)
  quando membros + convites pendentes já ocupam as vagas; mensagem sugere comprar adicional,
  convidar como Leitor ou trocar de plano. **Aceite** sem vaga → 403 com mensagem própria.
- **Comprar adicionais** (`POST /api/billing/seats`, dono): define `extra_users` e atualiza o
  valor da assinatura no Asaas (preço do plano + adicionais × preço do adicional, a partir da
  próxima cobrança); não deixa ficar abaixo das vagas em uso. A assinatura nova já soma os
  adicionais. Tela: "Usuários adicionais: − N +", com o novo total antes de salvar.
- Enquanto `plans.extra_user_price_cents` for nulo, a compra não aparece ("valor do usuário
  adicional ainda a definir").

## Verificado (2026-10-25)

Banco: promoção e entrada por convite recusadas sem vaga, liberadas com adicional, troca de
papel de quem já tem vaga não conta. Rotas: convite de atendente 403 com plano cheio, de leitor
201. Compra (preço provisório R$ 49,90 só no banco local): 2 adicionais → Asaas sandbox foi
para R$ 898,80 com a descrição atualizada; voltou para 0 → R$ 799. Preço provisório removido.

## Pendências

- Nos planos por atendente (Essencial, Impulso) o atendente adicional custa o preço por
  atendente. No Anual, o valor do atendente extra ainda é a definir.

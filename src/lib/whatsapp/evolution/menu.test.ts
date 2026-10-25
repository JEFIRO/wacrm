import { describe, expect, it } from 'vitest';
import { matchMenuReply, renderMenu } from './menu';

const options = [
  { id: 'btn_sim', title: 'Sim, quero' },
  { id: 'btn_nao', title: 'Agora não' },
];

describe('numbered menu', () => {
  it('renders header, body, numbered options, footer and hint', () => {
    expect(
      renderMenu({
        header: 'Planos',
        body: 'Qual plano?',
        footer: 'Equipe X',
        options: [
          { id: 'a', title: 'Essencial', description: 'R$ 149' },
          { id: 'b', title: 'Pro' },
        ],
        hint: 'Responda com o número da opção.',
      }),
    ).toBe('*Planos*\nQual plano?\n\n1. Essencial — R$ 149\n2. Pro\n\n_Equipe X_\nResponda com o número da opção.');
  });

  it('works without header and footer', () => {
    expect(renderMenu({ body: 'Oi', options, hint: 'h' })).toBe('Oi\n\n1. Sim, quero\n2. Agora não\n\nh');
  });

  it('maps a number or the option text to the option', () => {
    for (const reply of ['1', ' 1 ', '1.', '1)', 'opção 1', 'Opcao 1']) {
      expect(matchMenuReply(reply, options)?.id).toBe('btn_sim');
    }
    expect(matchMenuReply('agora nao', options)?.id).toBe('btn_nao');
    expect(matchMenuReply('AGORA NÃO', options)?.id).toBe('btn_nao');
  });

  it('leaves anything else as a normal message', () => {
    for (const reply of ['3', '0', '12', 'sim', 'quero o 1 por favor', '']) {
      expect(matchMenuReply(reply, options)).toBeNull();
    }
  });
});

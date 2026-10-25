import { describe, expect, it } from 'vitest';
import {
  estimatedDurationMs,
  nextIntervalMs,
  renderCampaignText,
  unknownCampaignVariables,
} from './text-campaign';

const maria = { name: 'Maria Souza', phone: '5511988887777', email: 'm@x.com', company: 'Loja M' };

describe('text campaign', () => {
  it('fills the known placeholders', () => {
    expect(renderCampaignText('Oi {{primeiro_nome}}! Aqui é da {{ empresa }}. ({{NOME}}, {{telefone}})', maria)).toBe(
      'Oi Maria! Aqui é da Loja M. (Maria Souza, 5511988887777)',
    );
  });

  it('tidies the gap a missing field leaves', () => {
    expect(renderCampaignText('Oi {{primeiro_nome}}, tudo bem?', { name: '' })).toBe('Oi, tudo bem?');
  });

  it('keeps unknown placeholders and reports them', () => {
    expect(renderCampaignText('Oi {{apelido}}', maria)).toBe('Oi {{apelido}}');
    expect(unknownCampaignVariables('Oi {{apelido}} {{nome}} {{ cidade }}')).toEqual(['apelido', 'cidade']);
  });

  it('draws the pause within the range', () => {
    expect(nextIntervalMs(20, 45, () => 0)).toBe(20_000);
    expect(nextIntervalMs(20, 45, () => 1)).toBe(45_000);
    expect(nextIntervalMs(20, 45, () => 0.5)).toBe(32_500);
  });

  it('estimates the campaign length', () => {
    expect(estimatedDurationMs(1, 20, 40)).toBe(0);
    expect(estimatedDurationMs(11, 20, 40)).toBe(300_000);
  });
});

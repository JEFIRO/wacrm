import { describe, expect, it } from 'vitest';
import { isValidCpfCnpj, statusFromPayments } from './asaas-status';

const pay = (dueDate: string, status: string, invoiceUrl = `https://inv/${dueDate}`) => ({
  id: `pay_${dueDate}`,
  status,
  dueDate,
  value: 349,
  invoiceUrl,
});

describe('Asaas payments → status', () => {
  it('keeps the trial while nothing is paid or overdue', () => {
    expect(statusFromPayments([pay('2026-11-24', 'PENDING')], true)).toEqual({
      status: null,
      currentPeriodEnd: null,
      invoiceUrl: 'https://inv/2026-11-24',
    });
  });

  it('is active for a month after the last paid charge', () => {
    const s = statusFromPayments([pay('2026-11-24', 'RECEIVED'), pay('2026-12-24', 'PENDING')], true);
    expect(s.status).toBe('active');
    expect(s.currentPeriodEnd).toBe('2026-12-24T00:00:00.000Z');
    expect(s.invoiceUrl).toBe('https://inv/2026-12-24');
    expect(statusFromPayments([pay('2026-11-24', 'CONFIRMED')], true).status).toBe('active');
  });

  it('is past due from the first overdue charge after the last paid one', () => {
    const s = statusFromPayments(
      [pay('2026-11-24', 'RECEIVED'), pay('2026-12-24', 'OVERDUE'), pay('2027-01-24', 'PENDING')],
      true,
    );
    expect(s).toMatchObject({ status: 'past_due', currentPeriodEnd: '2026-12-24T00:00:00.000Z' });
  });

  it('is canceled when the subscription was removed', () => {
    expect(statusFromPayments([pay('2026-11-24', 'RECEIVED')], false).status).toBe('canceled');
  });

  it('validates CPF and CNPJ check digits', () => {
    expect(isValidCpfCnpj('529.982.247-25')).toBe(true);
    expect(isValidCpfCnpj('529.982.247-24')).toBe(false);
    expect(isValidCpfCnpj('111.111.111-11')).toBe(false);
    expect(isValidCpfCnpj('11.222.333/0001-81')).toBe(true);
    expect(isValidCpfCnpj('11.222.333/0001-80')).toBe(false);
  });
});

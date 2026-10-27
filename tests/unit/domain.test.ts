import { describe, it, expect } from 'vitest';
import { normaliseLines, parseAmount, planTransition, toFunctional, Decimal, DomainError } from '@pep/accounting-domain';

const opts = { txnCurrency: 'GHS', functionalCurrency: 'GHS', fxRate: 1 };
const err = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as DomainError).code; } return 'NO_ERROR'; };

describe('money', () => {
  it('parses strings with thousands separators exactly', () => expect(parseAmount('1,234,567.89', 'GHS').toFixed(2)).toBe('1234567.89'));
  it('rejects scientific notation and junk', () => {
    expect(err(() => parseAmount('1e5', 'GHS'))).toBe('INVALID_AMOUNT');
    expect(err(() => parseAmount('abc', 'GHS'))).toBe('INVALID_AMOUNT');
  });
  it('rejects unknown currencies rather than guessing precision', () => expect(err(() => parseAmount('1', 'XYZ'))).toBe('UNSUPPORTED_CURRENCY'));
  it('translates with banker\'s rounding', () => {
    expect(toFunctional(new Decimal('1.00'), new Decimal('0.125'), 'GHS').toFixed(2)).toBe('0.12');
    expect(toFunctional(new Decimal('1.00'), new Decimal('0.135'), 'GHS').toFixed(2)).toBe('0.14');
  });
  it('sums 10,000 × 0.01 to exactly 100.00', () => {
    const lines = Array.from({ length: 10000 }, () => ({ accountId: 'a', debit: '0.01' }));
    const { totals } = normaliseLines([...lines, { accountId: 'b', credit: '100.00' }], opts);
    expect(totals.debit.toFixed(2)).toBe('100.00');
  });
});

describe('workflow', () => {
  const actor = (id: string, p: string[]) => ({ id, permissions: new Set(p) });
  it('blocks self-approval only when segregation is enabled', () => {
    const j = { status: 'submitted' as const, preparedBy: 'u1' };
    expect(err(() => planTransition('approve', j, actor('u1', ['journal.approve']), { segregationEnabled: true }))).toBe('SEGREGATION_OF_DUTIES');
    expect(planTransition('approve', j, actor('u1', ['journal.approve']), { segregationEnabled: false })).toBe('approved');
  });
  it('enforces the state machine', () => {
    expect(err(() => planTransition('post', { status: 'submitted', preparedBy: 'x' }, actor('u', ['journal.post']), { segregationEnabled: true })))
      .toBe('INVALID_STATUS_TRANSITION');
  });
});

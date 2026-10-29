/** Display formatting rules (blueprint § Number and date rules). */
import { describe, it, expect } from 'vitest';
import { changeLabel, dateLabel, kpiMoney, monthLong, plural, wholeMoney } from '../../apps/web/src/lib/format';

describe('format', () => {
  it('whole money rounds half up on the string and brackets negatives', () => {
    expect(wholeMoney('1156500.49')).toBe('1,156,500');
    expect(wholeMoney('1156500.50')).toBe('1,156,501');
    expect(wholeMoney('-34500.00')).toBe('(34,500)');
    expect(wholeMoney('0.40')).toBe('0');
  });
  it('KPI figures switch to millions/billions only when they would not fit', () => {
    expect(kpiMoney('973160.00')).toBe('973,160');
    expect(kpiMoney('123456789.00')).toBe('123,456,789');
    expect(kpiMoney('9879211940.00')).toBe('9.88bn');
    expect(kpiMoney('-2500000000.00')).toBe('(2.50bn)');
  });
  it('very large swings read as a multiple', () => {
    expect(changeLabel(25)).toBe('25.0%');
    expect(changeLabel(-12.34)).toBe('12.3%');
    expect(changeLabel(1829383.7)).toBe('18,295× higher');
  });
  it('dates and plurals', () => {
    expect(dateLabel('2026-10-31')).toBe('31 Oct 2026');
    expect(monthLong('2026-02')).toBe('February 2026');
    expect(plural(1, 'journal', 'journals')).toBe('1 journal');
    expect(plural(5, 'journal', 'journals')).toBe('5 journals');
  });
});

import { describe, it, expect } from 'vitest';
import { formatTZS, money, sum } from '../lib/money';

describe('money helpers', () => {
  it('sums many values without precision loss', () => {
    const values = Array.from({ length: 1000 }, () => '0.10');
    const total = sum(values);
    expect(total.toString()).toBe('100');
  });

  it('formats TZS without decimals', () => {
    const formatted = formatTZS(15000);
    expect(formatted).toMatch(/15,?000/);
    expect(formatted).toMatch(/TSh|TZS/i);
  });

  it('money() handles null-ish input', () => {

    expect(money(0).toString()).toBe('0');
  });
});

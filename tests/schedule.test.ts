import { describe, it, expect } from 'vitest';
import { generateSchedule, loanDueDate } from '../lib/schedule';

describe('generateSchedule', () => {
  it('produces 3 cycles at +30/+60/+90 days', () => {
    const disbursed = new Date('2026-01-01T00:00:00Z');
    const s = generateSchedule({ principal: 100000, disbursedAt: disbursed });
    expect(s).toHaveLength(3);
    expect(s[0].dueDate.toISOString().slice(0, 10)).toBe('2026-01-31');
    expect(s[1].dueDate.toISOString().slice(0, 10)).toBe('2026-03-02');
    expect(s[2].dueDate.toISOString().slice(0, 10)).toBe('2026-04-01');
  });

  it('charges 15% of principal per cycle as interest', () => {
    const s = generateSchedule({ principal: 100000, disbursedAt: new Date('2026-01-01T00:00:00Z') });
    s.forEach((row) => expect(row.expectedInterest.toString()).toBe('15000'));
  });

  it('respects custom rate', () => {
    const s = generateSchedule({
      principal: 200000,
      interestRatePct: 10,
      disbursedAt: new Date('2026-01-01T00:00:00Z'),
    });
    s.forEach((row) => expect(row.expectedInterest.toString()).toBe('20000'));
  });

  it('flags final cycle as mandatory settlement', () => {
    const s = generateSchedule({ principal: 1, disbursedAt: new Date('2026-01-01T00:00:00Z') });
    expect(s[0].mandatorySettlement).toBe(false);
    expect(s[1].mandatorySettlement).toBe(false);
    expect(s[2].mandatorySettlement).toBe(true);
  });

  it('loanDueDate returns disbursed + 90 days', () => {
    const d = loanDueDate({ principal: 100, disbursedAt: new Date('2026-01-01T00:00:00Z') });
    expect(d.toISOString().slice(0, 10)).toBe('2026-04-01');
  });
});

import fc from 'fast-check';

import type { GameTime } from '../model/core.js';

import {
  INSUFFICIENT,
  LedgerSchema,
  balance,
  createLedger,
  credit,
  debit,
  payLedgerEffect,
  type Ledger,
  type LedgerReason,
} from './ledger.js';

const T0: GameTime = { day: 0, phase: 0 };
const T1: GameTime = { day: 1, phase: 2 };

/** A finite, non-negative money amount for debits and credits. */
const amount = (): fc.Arbitrary<number> =>
  fc.integer({ min: 0, max: 1_000_000 });

const reason = (): fc.Arbitrary<LedgerReason> =>
  fc.constantFrom(
    'pay',
    'pitch',
    'retainer',
    'bribe',
    'rental',
    'task',
    'funds-grant',
    'starting',
  );

const gameTime = (): fc.Arbitrary<GameTime> =>
  fc.record({
    day: fc.integer({ min: 0, max: 60 }),
    phase: fc.constantFrom<0 | 1 | 2 | 3>(0, 1, 2, 3),
  });

/** A single credit or debit step applied to a ledger. */
type Step = { kind: 'credit' | 'debit'; amount: number; reason: LedgerReason };

const step = (): fc.Arbitrary<Step> =>
  fc.record({
    kind: fc.constantFrom<'credit' | 'debit'>('credit', 'debit'),
    amount: amount(),
    reason: reason(),
  });

describe('createLedger', () => {
  it('opens with the starting balance and no entries', () => {
    const l = createLedger(500);
    expect(l.start).toBe(500);
    expect(l.entries).toEqual([]);
    expect(balance(l)).toBe(500);
  });
});

describe('balance', () => {
  it('is start plus the sum of entry amounts', () => {
    let l = createLedger(100);
    l = credit(l, 50, 'funds-grant', T0); // +50 -> 150
    l = debit(l, 30, 'pay', T1) as Ledger; // -30 -> 120
    expect(balance(l)).toBe(120);
  });

  it('equals start for an empty ledger', () => {
    expect(balance(createLedger(0))).toBe(0);
    expect(balance(createLedger(42))).toBe(42);
  });

  // Property: balance = start + Σ amounts, over any run of credits and debits.
  // Validates: Requirements 28.1
  it('always equals start + Σ amounts (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.array(step(), { maxLength: 40 }),
        (start, steps) => {
          let l = createLedger(start);
          for (const s of steps) {
            if (s.kind === 'credit') {
              l = credit(l, s.amount, s.reason, T0);
            } else {
              const next = debit(l, s.amount, s.reason, T0);
              // Only apply affordable debits; rejected ones leave l unchanged.
              if (next !== INSUFFICIENT) l = next;
            }
          }
          const sum = l.entries.reduce((acc, e) => acc + e.amount, 0);
          expect(balance(l)).toBe(start + sum);
        },
      ),
    );
  });
});

describe('credit', () => {
  it('appends a positive-amount entry and increases the balance', () => {
    const l0 = createLedger(100);
    const l1 = credit(l0, 250, 'funds-grant', T1, 'cable:7');
    expect(balance(l1)).toBe(350);
    expect(l1.entries).toHaveLength(1);
    expect(l1.entries[0]).toEqual({
      at: T1,
      amount: 250,
      reason: 'funds-grant',
      ref: 'cable:7',
    });
  });

  it('rejects a negative amount', () => {
    expect(() => credit(createLedger(0), -1, 'funds-grant', T0)).toThrow(
      RangeError,
    );
  });

  // Property: a non-zero credit strictly increases the balance by the amount.
  // Validates: Requirements 28.1
  it('increases the balance by exactly the amount (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        reason(),
        (start, amt, r) => {
          const l0 = createLedger(start);
          const l1 = credit(l0, amt, r, T0);
          expect(balance(l1)).toBe(balance(l0) + amt);
          expect(balance(l1)).toBeGreaterThan(balance(l0));
        },
      ),
    );
  });
});

describe('debit', () => {
  it('appends a negative-amount entry and lowers the balance', () => {
    const l0 = createLedger(100);
    const l1 = debit(l0, 40, 'pay', T0, 'npc:asset-1') as Ledger;
    expect(l1).not.toBe(INSUFFICIENT);
    expect(balance(l1)).toBe(60);
    expect(l1.entries[0]).toEqual({
      at: T0,
      amount: -40,
      reason: 'pay',
      ref: 'npc:asset-1',
    });
  });

  it('allows a debit that spends the balance to exactly zero', () => {
    const l0 = createLedger(100);
    const l1 = debit(l0, 100, 'task', T0);
    expect(l1).not.toBe(INSUFFICIENT);
    expect(balance(l1 as Ledger)).toBe(0);
  });

  it('rejects a debit that exceeds the balance and leaves state unchanged', () => {
    const l0 = createLedger(100);
    const result = debit(l0, 101, 'task', T0);
    expect(result).toBe(INSUFFICIENT);
    // Req 28.3: state unchanged.
    expect(l0.entries).toEqual([]);
    expect(balance(l0)).toBe(100);
  });

  it('rejects a negative amount', () => {
    expect(() => debit(createLedger(100), -1, 'pay', T0)).toThrow(RangeError);
  });

  // Property: a debit never drives the balance below zero. Either it posts and
  // leaves a non-negative balance, or it is rejected and the ledger is intact.
  // Validates: Requirements 28.2, 28.3
  it('never allows the balance to go negative (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        amount(),
        reason(),
        gameTime(),
        (start, amt, r, at) => {
          const l0 = createLedger(start);
          const before = balance(l0);
          const result = debit(l0, amt, r, at);
          if (result === INSUFFICIENT) {
            // Rejected: ledger untouched.
            expect(amt).toBeGreaterThan(before);
            expect(l0.entries).toEqual([]);
            expect(balance(l0)).toBe(before);
          } else {
            expect(balance(result)).toBe(before - amt);
            expect(balance(result)).toBeGreaterThanOrEqual(0);
          }
        },
      ),
    );
  });

  // Property: a debit is rejected exactly when the amount exceeds the balance.
  // Validates: Requirements 28.3
  it('is rejected iff the amount exceeds the balance (property)', () => {
    fc.assert(
      fc.property(
        fc.array(step(), { maxLength: 30 }),
        amount(),
        (steps, amt) => {
          // Build an arbitrary affordable ledger first.
          let l = createLedger(100_000);
          for (const s of steps) {
            if (s.kind === 'credit') l = credit(l, s.amount, s.reason, T0);
            else {
              const next = debit(l, s.amount, s.reason, T0);
              if (next !== INSUFFICIENT) l = next;
            }
          }
          const bal = balance(l);
          const result = debit(l, amt, 'pay', T0);
          if (amt > bal) {
            expect(result).toBe(INSUFFICIENT);
          } else {
            expect(result).not.toBe(INSUFFICIENT);
          }
        },
      ),
    );
  });
});

describe('purity', () => {
  it('debit does not mutate its input ledger', () => {
    const l0 = createLedger(100);
    const snapshot = JSON.stringify(l0);
    const l1 = debit(l0, 40, 'pay', T0) as Ledger;
    expect(JSON.stringify(l0)).toBe(snapshot);
    expect(l1).not.toBe(l0);
    expect(l1.entries).not.toBe(l0.entries);
  });

  it('credit does not mutate its input ledger', () => {
    const l0 = createLedger(100);
    const snapshot = JSON.stringify(l0);
    const l1 = credit(l0, 40, 'funds-grant', T0);
    expect(JSON.stringify(l0)).toBe(snapshot);
    expect(l1).not.toBe(l0);
  });

  // Property: no operation ever mutates the input, whatever the sequence.
  // Validates: Requirements 28.1, 28.3
  it('never mutates inputs across any sequence of operations (property)', () => {
    fc.assert(
      fc.property(fc.array(step(), { maxLength: 40 }), (steps) => {
        let l: Ledger = createLedger(10_000);
        for (const s of steps) {
          const before = JSON.stringify(l);
          const prev = l;
          if (s.kind === 'credit') {
            l = credit(l, s.amount, s.reason, T0);
          } else {
            const next = debit(l, s.amount, s.reason, T0);
            if (next !== INSUFFICIENT) l = next;
          }
          // The prior ledger value is never mutated by the operation.
          expect(JSON.stringify(prev)).toBe(before);
        }
      }),
    );
  });
});

describe('payLedgerEffect', () => {
  it('debits the Budget tagged "pay" with the payee as ref', () => {
    const l0 = createLedger(500);
    const l1 = payLedgerEffect(l0, 120, T1, 'npc:asset-9') as Ledger;
    expect(l1).not.toBe(INSUFFICIENT);
    expect(balance(l1)).toBe(380);
    expect(l1.entries[0]).toEqual({
      at: T1,
      amount: -120,
      reason: 'pay',
      ref: 'npc:asset-9',
    });
  });

  it('is rejected when the Budget cannot cover the payment', () => {
    const l0 = createLedger(50);
    expect(payLedgerEffect(l0, 51, T0, 'npc:asset-9')).toBe(INSUFFICIENT);
    expect(balance(l0)).toBe(50);
  });
});

describe('LedgerSchema', () => {
  it('round-trips a ledger through JSON', () => {
    let l = createLedger(300);
    l = credit(l, 100, 'funds-grant', T0, 'cable:1');
    l = debit(l, 75, 'pay', T1, 'npc:asset-1') as Ledger;
    const parsed = LedgerSchema.parse(JSON.parse(JSON.stringify(l)));
    expect(parsed).toEqual(l);
    expect(balance(parsed)).toBe(325);
  });

  it('rejects an unknown reason', () => {
    const bad = {
      start: 0,
      entries: [{ at: T0, amount: -1, reason: 'embezzle' }],
    };
    expect(LedgerSchema.safeParse(bad).success).toBe(false);
  });
});

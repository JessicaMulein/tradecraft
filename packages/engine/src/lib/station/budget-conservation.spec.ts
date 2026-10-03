/**
 * Property 20: Budget conservation.
 *
 * From the design's Correctness Properties:
 *
 * > For any start balance and sequence of credit and debit requests, the
 * > balance always equals the start plus applied credits minus applied debits.
 * > It never goes negative, and every rejected debit leaves the ledger
 * > unchanged.
 *
 * Validates: Requirements 28.1, 28.2, 28.3
 *
 * This is the formal, end-to-end conservation property for the Budget ledger.
 * It drives the public ledger API ({@link createLedger}, {@link credit},
 * {@link debit}) through an arbitrary sequence of credit and debit *requests*
 * and checks the whole conservation statement at once, rather than any single
 * facet. It complements — rather than duplicates — the per-operation properties
 * in `ledger.spec.ts` (balance = start + Σ amounts, debit never negative,
 * rejected iff over balance, purity): here we track the applied credits and
 * debits ourselves and assert the ledger agrees, so a bug that let money appear
 * or vanish outside a recorded entry would be caught.
 */

import fc from 'fast-check';

import type { GameTime } from '../model/core.js';

import {
  INSUFFICIENT,
  balance,
  createLedger,
  credit,
  debit,
  type Ledger,
  type LedgerReason,
} from './ledger.js';

/** A finite, non-negative money amount for a credit or debit request. */
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

/**
 * A single Budget *request*: ask to credit or debit `amount`. A debit request
 * may be rejected (when it would overdraw); a credit request is always applied.
 * The generator mixes amounts freely so debit requests straddle the balance,
 * exercising both the applied and rejected branches without the test steering
 * towards either.
 */
interface Request {
  readonly kind: 'credit' | 'debit';
  readonly amount: number;
  readonly reason: LedgerReason;
  readonly at: GameTime;
}

const request = (): fc.Arbitrary<Request> =>
  fc.record({
    kind: fc.constantFrom<'credit' | 'debit'>('credit', 'debit'),
    amount: amount(),
    reason: reason(),
    at: gameTime(),
  });

describe('Property 20: Budget conservation', () => {
  it('conserves the Budget across any sequence of credit and debit requests', () => {
    fc.assert(
      fc.property(
        amount(),
        fc.array(request(), { maxLength: 50 }),
        (start, requests) => {
          let ledger: Ledger = createLedger(start);

          // Independently accumulate the money we *actually* applied, so the
          // check does not lean on the ledger's own entries.
          let appliedCredits = 0;
          let appliedDebits = 0;
          let appliedEntryCount = 0;

          for (const req of requests) {
            if (req.kind === 'credit') {
              const next = credit(ledger, req.amount, req.reason, req.at);
              appliedCredits += req.amount;
              appliedEntryCount += 1;
              ledger = next;
            } else {
              const balanceBefore = balance(ledger);
              const entriesBefore = ledger.entries;
              const next = debit(ledger, req.amount, req.reason, req.at);

              if (next === INSUFFICIENT) {
                // A rejected debit leaves the ledger unchanged (Req 28.3):
                // same object identity for entries, same balance, and it is
                // rejected exactly because it would overdraw.
                expect(req.amount).toBeGreaterThan(balanceBefore);
                expect(ledger.entries).toBe(entriesBefore);
                expect(balance(ledger)).toBe(balanceBefore);
              } else {
                appliedDebits += req.amount;
                appliedEntryCount += 1;
                ledger = next;
              }
            }

            // Invariant after every request: balance = start + applied credits
            // − applied debits. No money is created or destroyed except through
            // the credits and debits we recorded as applied.
            expect(balance(ledger)).toBe(
              start + appliedCredits - appliedDebits,
            );

            // The balance never goes negative (Req 28.2, 28.3).
            expect(balance(ledger)).toBeGreaterThanOrEqual(0);
          }

          // Every applied request produced exactly one recorded entry, and no
          // entry exists that was not applied — the ledger is fully accounted
          // for (Req 28.1).
          expect(ledger.entries).toHaveLength(appliedEntryCount);

          // Conservation stated directly over the entries: the derived balance
          // equals the start plus the signed sum of every recorded movement,
          // with nothing unaccounted for.
          const signedSum = ledger.entries.reduce((s, e) => s + e.amount, 0);
          expect(balance(ledger)).toBe(start + signedSum);
          expect(signedSum).toBe(appliedCredits - appliedDebits);

          // Each credit is a positive entry, each debit a negative one, so the
          // positive and negative parts reconstruct the applied totals exactly.
          const credited = ledger.entries
            .filter((e) => e.amount > 0)
            .reduce((s, e) => s + e.amount, 0);
          const debited = ledger.entries
            .filter((e) => e.amount < 0)
            .reduce((s, e) => s - e.amount, 0);
          expect(credited).toBe(appliedCredits);
          expect(debited).toBe(appliedDebits);
        },
      ),
    );
  });
});

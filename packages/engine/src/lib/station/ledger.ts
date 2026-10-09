/**
 * The pure Budget ledger (Requirement 28).
 *
 * The player's operational funds are kept as a ledger: a starting balance plus
 * an append-only list of signed entries (Requirement 28.1). A debit records a
 * negative-amount entry; a credit records a positive one. Nothing in this
 * module mutates — {@link debit} and {@link credit} each return a *new* ledger,
 * leaving the input untouched — so the Action Resolver can quote a cost against
 * a draft and only commit the new ledger when the turn succeeds.
 *
 * The balance is derived, never stored: {@link balance} is `start + Σ amounts`.
 * Keeping the running total out of the state means it can never drift from the
 * entries, and a save file carries only the entries it needs to replay the run.
 *
 * Three requirements anchor the module:
 *
 * - Requirement 28.1: the Budget is a ledger of credits and debits in a single
 *   currency. {@link Ledger} is that ledger, and {@link LedgerReason} enumerates
 *   why each entry was posted (a money pitch, a retainer, a Station funds grant,
 *   and so on).
 * - Requirement 28.2: the Sim debits the Budget for money pitches, payments to
 *   Assets, bribes, safehouse rental and task expenses, at the amount shown to
 *   the player before confirmation. {@link debit} posts exactly that amount, and
 *   {@link payLedgerEffect} is the pay action's debit helper.
 * - Requirement 28.3: if a debit exceeds the balance the Sim rejects the action
 *   and leaves state unchanged. {@link debit} returns the string
 *   `'insufficient'` and never a mutated or new ledger when the resulting
 *   balance would go negative.
 */

import { z } from 'zod';

import { GameTimeSchema, type GameTime } from '../model/core.js';

/**
 * Why a ledger entry was posted. The design keeps the Budget in a single
 * currency, so every movement is tagged with its reason rather than split
 * across accounts. The debit reasons cover every spend the design names in
 * Requirement 28.2 (money pitches, Asset payments, bribes, safehouse rental and
 * task expenses); the credit reasons cover the two ways money comes in — the
 * starting Budget and a Station funds grant.
 *
 * - `pay`        — a payment to an Asset (the pay action; satisfies retainers).
 * - `pitch`      — a money pitch made while recruiting.
 * - `retainer`   — a recurring retainer paid to a money-motivated Asset.
 * - `bribe`      — a one-off bribe.
 * - `rental`     — safehouse (or other) rental.
 * - `task`       — a task expense.
 * - `fare`       — an intercity Departure.
 * - `fare-refund`— a cancelled Departure's fare returned.
 * - `funds-grant`— a Station funds grant arriving by Cable (a credit).
 * - `starting`   — the opening Budget credit from the Starting Brief.
 */
export const LEDGER_REASONS = [
  'pay',
  'pitch',
  'retainer',
  'bribe',
  'rental',
  'task',
  'fare',
  'fare-refund',
  'funds-grant',
  'starting',
] as const;

/** A reason a ledger entry was posted. */
export type LedgerReason = (typeof LEDGER_REASONS)[number];

export const LedgerReasonSchema: z.ZodType<LedgerReason> = z
  .enum(LEDGER_REASONS)
  .meta({ id: 'LedgerReason', description: 'Why a Budget entry was posted.' });

/**
 * A single signed movement on the Budget ledger. A debit carries a negative
 * `amount`, a credit a positive one; `at` is when it was posted, and the
 * optional `ref` ties it to the thing it paid for (an Asset id, a task id, a
 * Cable id) for the debrief and the Journal.
 */
export interface LedgerEntry {
  readonly at: GameTime;
  readonly amount: number;
  readonly reason: LedgerReason;
  readonly ref?: string;
}

export const LedgerEntrySchema: z.ZodType<LedgerEntry> = z
  .strictObject({
    at: GameTimeSchema,
    amount: z.number(),
    reason: LedgerReasonSchema,
    ref: z.string().optional(),
  })
  .meta({ id: 'LedgerEntry', description: 'A signed Budget movement.' });

/**
 * The Budget ledger (Requirement 28.1): a starting balance and an append-only
 * list of signed entries. Matches the design's
 * `interface Ledger { start: number; entries: { at; amount; reason; ref? }[] }`.
 * The running balance is derived with {@link balance}, never stored, so it can
 * never disagree with the entries.
 */
export interface Ledger {
  readonly start: number;
  readonly entries: readonly LedgerEntry[];
}

export const LedgerSchema: z.ZodType<Ledger> = z
  .strictObject({
    start: z.number(),
    entries: z.array(LedgerEntrySchema).readonly(),
  })
  .meta({
    id: 'Ledger',
    description: 'The Budget: a starting balance plus signed entries.',
  });

/** The outcome of a rejected debit (Requirement 28.3). */
export const INSUFFICIENT = 'insufficient' as const;

/** The string {@link debit} returns when a debit would overdraw the Budget. */
export type Insufficient = typeof INSUFFICIENT;

/**
 * Create an opening ledger with a starting balance and no entries. The starting
 * Budget from the Starting Brief seeds `start`; later funds grants are credited
 * as entries so the debrief can tell the opening float from in-game income.
 */
export function createLedger(start: number): Ledger {
  return { start, entries: [] };
}

/**
 * The current balance (Requirement 28.1): `start + Σ amounts`. Debits are
 * negative amounts, so they lower the balance; credits raise it. Derived on
 * demand, so it is always consistent with {@link Ledger.entries}.
 */
export function balance(l: Ledger): number {
  return l.entries.reduce((sum, e) => sum + e.amount, l.start);
}

/**
 * Append a debit of `amount` (Requirements 28.2, 28.3).
 *
 * `amount` is the positive sum shown to the player before confirmation; the
 * entry stores it as `-amount`. If the debit would drive the balance below
 * zero, the ledger is left unchanged and the string {@link INSUFFICIENT} is
 * returned, so the Action Resolver can reject the action with state untouched
 * (Requirement 28.3). Otherwise a *new* ledger is returned with the debit
 * appended; the input is never mutated.
 *
 * `amount` must be a finite, non-negative number. A negative `amount` would be
 * a credit wearing a debit's clothes, which would corrupt the single-currency
 * invariant, so it is rejected with a thrown error rather than silently posted.
 */
export function debit(
  l: Ledger,
  amount: number,
  reason: LedgerReason,
  at: GameTime,
  ref?: string,
): Ledger | Insufficient {
  assertNonNegativeAmount(amount, 'debit');
  if (amount > balance(l)) {
    return INSUFFICIENT;
  }
  return appendEntry(l, { at, amount: -amount, reason, ref });
}

/**
 * Append a credit of `amount` (Requirement 28.1). Used for a Station funds grant
 * and any other income. Returns a *new* ledger with the positive-amount entry
 * appended; the input is never mutated.
 *
 * `amount` must be a finite, non-negative number, for the same reason
 * {@link debit} requires it: a negative credit would be a disguised debit that
 * skips the balance check.
 */
export function credit(
  l: Ledger,
  amount: number,
  reason: LedgerReason,
  at: GameTime,
  ref?: string,
): Ledger {
  assertNonNegativeAmount(amount, 'credit');
  return appendEntry(l, { at, amount, reason, ref });
}

/**
 * The pay action's ledger effect (Requirements 28.2, 11): a pay is a Budget
 * debit tagged `pay`, with the paid Asset as the entry's `ref`. The full pay
 * resolver (satisfying retainers and adding trust for money-motivated NPCs)
 * lands in task 11; this helper owns only the ledger side, so the resolver and
 * its tests share one definition of what a pay does to the Budget.
 *
 * Returns the new ledger, or {@link INSUFFICIENT} when the Budget cannot cover
 * the payment, in which case the resolver rejects the pay and leaves state
 * unchanged (Requirement 28.3).
 */
export function payLedgerEffect(
  l: Ledger,
  amount: number,
  at: GameTime,
  payee?: string,
): Ledger | Insufficient {
  return debit(l, amount, 'pay', at, payee);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Append one entry, returning a new ledger and leaving the input untouched. */
function appendEntry(l: Ledger, entry: LedgerEntry): Ledger {
  return { start: l.start, entries: [...l.entries, entry] };
}

/**
 * Guard the amount of a debit or credit. Both post a signed entry derived from
 * a caller-supplied magnitude, so the magnitude must be a finite, non-negative
 * number; anything else is a programming error, not a game outcome.
 */
function assertNonNegativeAmount(amount: number, op: 'debit' | 'credit'): void {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new RangeError(
      `${op} amount must be a finite, non-negative number, got ${amount}`,
    );
  }
}

/**
 * Retainer accrual, pay effects and trust decay for money-motivated Assets
 * (design, "Recruitment and Relationships": `Relationship.retainer`; design,
 * "Station, Directives and Budget": "Retainers are due weekly per Asset. Each
 * phase overdue past the 2-day grace period reduces trust for NPCs whose
 * dominant MICE lever is money."; Requirements 28.2, 28.4).
 *
 * This is a dependency-light **leaf** beside `pitch.ts`/`pressure.ts`/`asset.ts`:
 * it imports only the core model (time helpers and the Truth brand, to read the
 * hidden MICE profile), the NPC and {@link Relationship} shapes, and nothing
 * from the Action Resolver — so it forms no import cycle. It owns the *pure*
 * retainer maths the pay action and the Turn Pipeline both read:
 *
 * - {@link isMoneyMotivated} — whether an NPC's dominant MICE lever is money
 *   (the only Assets a retainer and its decay apply to, Req 28.4).
 * - {@link payEffect} — the pay action's effect on a {@link Relationship}: a
 *   paid money-motivated Asset has its retainer advanced to the next due date
 *   and gains trust (Req 28.2). The ledger side is `payLedgerEffect` in
 *   `../station/ledger.ts`; this is the Relationship side the pay resolver
 *   applies once the debit succeeds.
 * - {@link retainerDecay} — the Turn Pipeline's per-boundary sweep: an unpaid
 *   money-motivated Asset whose retainer is overdue past the grace period loses
 *   trust each phase overdue and raises a `retainer-due` expectation (Req 28.4).
 *
 * Everything here is pure and deterministic — no randomness, no clock — so the
 * same inputs always yield the same next Relationship and the same set of
 * retainer-due intents. The functions return *new* values and never mutate their
 * arguments, so the resolver can quote against a draft and only commit on
 * success.
 */

import {
  revealTruth,
  timeToPhases,
  PHASES_PER_DAY,
  type GameTime,
  type NpcId,
} from '../model/core.js';
import type { Npc } from '../city/npc.js';
import type { Relationship, Retainer } from './asset.js';

// ---------------------------------------------------------------------------
// Constants (design, "Station, Directives and Budget")
// ---------------------------------------------------------------------------

/** The retainer period: due weekly per Asset (design: "due weekly"). */
export const RETAINER_PERIOD_DAYS = 7;

/** The retainer period in phases (seven days of four phases). */
export const RETAINER_PERIOD_PHASES = RETAINER_PERIOD_DAYS * PHASES_PER_DAY;

/**
 * The grace period before an unpaid retainer bites: two days past the due date
 * (design: "overdue past the 2-day grace period"). An Asset overdue by this much
 * or less loses no trust; past it, each further phase overdue decays trust.
 */
export const RETAINER_GRACE_DAYS = 2;

/** The grace period in phases. */
export const RETAINER_GRACE_PHASES = RETAINER_GRACE_DAYS * PHASES_PER_DAY;

/**
 * How much trust a payment restores to a money-motivated Asset (Req 28.2 — pay
 * "adds trust for money-motivated NPCs"). A self-contained balance constant (the
 * design names no scenario weight for it), clamped into `[0, 1]` by
 * {@link addTrust}.
 */
export const PAY_TRUST_GAIN = 0.1;

/**
 * How much trust an overdue money-motivated Asset loses *per phase* past the
 * grace period (design: "Each phase overdue past the 2-day grace period reduces
 * trust"). A self-contained balance constant; the total decay a sweep applies is
 * this times the number of overdue phases.
 */
export const RETAINER_DECAY_PER_PHASE = 0.02;

// ---------------------------------------------------------------------------
// Money motivation (Req 28.4)
// ---------------------------------------------------------------------------

/**
 * Whether an NPC's dominant MICE lever is money (design: "NPCs whose dominant
 * MICE lever is money"). True when the hidden `mice.money` strength is at least
 * as strong as every other lever — money is the (possibly tied) maximum. Only
 * these Assets accrue a retainer and suffer its decay (Req 28.4); every other
 * motivation ignores the retainer machinery.
 *
 * Reads the NPC's hidden MICE profile (`Truth`-branded); the branded read is
 * deliberate, as in `pitch.ts`/`pressure.ts` — this is a Sim decision whose only
 * surfaced consequence is a trust move and a retainer-due expectation.
 */
export function isMoneyMotivated(npc: Npc): boolean {
  const mice = revealTruth(npc.mice);
  return (
    mice.money >= mice.ideology &&
    mice.money >= mice.coercion &&
    mice.money >= mice.ego
  );
}

// ---------------------------------------------------------------------------
// Trust helpers
// ---------------------------------------------------------------------------

/** Clamp a value into `[0, 1]` — trust lives in that range. */
function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** A Relationship with its trust moved by `delta`, clamped into `[0, 1]`. */
export function addTrust(rel: Relationship, delta: number): Relationship {
  return { ...rel, trust: clamp01(rel.trust + delta) };
}

// ---------------------------------------------------------------------------
// Retainer schedule
// ---------------------------------------------------------------------------

/**
 * The next due date after a retainer is paid at `at`: one retainer period
 * ({@link RETAINER_PERIOD_PHASES}) later. Pure in the time arithmetic, so the
 * schedule never drifts: paying always advances `paidThrough` by exactly a week.
 */
export function nextDue(at: GameTime): GameTime {
  const total = timeToPhases(at) + RETAINER_PERIOD_PHASES;
  return {
    day: Math.floor(total / PHASES_PER_DAY),
    phase: (total % PHASES_PER_DAY) as GameTime['phase'],
  };
}

/**
 * How many phases a retainer is overdue at time `now`, past its grace period
 * (design: "Each phase overdue past the 2-day grace period"). `0` when the
 * retainer is paid up or still within grace; otherwise the number of phases
 * beyond `paidThrough + grace`. Pure in the two times.
 */
export function overduePhases(retainer: Retainer, now: GameTime): number {
  const dueline = timeToPhases(retainer.paidThrough) + RETAINER_GRACE_PHASES;
  const overdue = timeToPhases(now) - dueline;
  return overdue > 0 ? overdue : 0;
}

// ---------------------------------------------------------------------------
// Pay effect (Req 28.2)
// ---------------------------------------------------------------------------

/**
 * The pay action's effect on a {@link Relationship} once the Budget debit has
 * succeeded (Req 28.2 — a pay "satisfies retainers and adds trust for
 * money-motivated NPCs"). The ledger side is `payLedgerEffect`
 * (`../station/ledger.ts`); this is the Relationship side the pay resolver
 * applies on top of it.
 *
 * For a **money-motivated** Asset the payment:
 *
 * - satisfies/advances the retainer — `paidThrough` moves to {@link nextDue} of
 *   `at` (minting a retainer at `amount` if the Asset had none yet), so the
 *   clock resets a full week from the payment; and
 * - adds {@link PAY_TRUST_GAIN} trust, clamped into `[0, 1]` (Req 28.2).
 *
 * For a **non-money-motivated** NPC the payment leaves trust and the retainer
 * untouched — the retainer machinery applies only to money-motivated Assets
 * (Req 28.4) — so the Relationship is returned unchanged. The caller still
 * debits the Budget for the payment (the money moved); only the retainer/trust
 * *consequences* are gated on money motivation.
 */
export function payEffect(
  npc: Npc,
  rel: Relationship,
  amount: number,
  at: GameTime,
): Relationship {
  if (!isMoneyMotivated(npc)) {
    return rel;
  }
  const retainer: Retainer = {
    amount: rel.retainer?.amount ?? amount,
    paidThrough: nextDue(at),
  };
  return addTrust({ ...rel, retainer }, PAY_TRUST_GAIN);
}

// ---------------------------------------------------------------------------
// Retainer decay (Req 28.4)
// ---------------------------------------------------------------------------

/**
 * A retainer-due expectation the {@link retainerDecay} sweep raises for an
 * overdue Asset (design: the `retainer-due` SimEvent). It carries the NPC and
 * the retainer amount owed; the Turn Pipeline mints the full `retainer-due`
 * {@link import('../model/state.js').SimEvent} (assigning its id and visibility)
 * from this intent, so this leaf never touches event-id minting.
 */
export interface RetainerDueIntent {
  readonly npc: NpcId;
  readonly amount: number;
}

/** The next Relationship map plus the retainer-due intents a sweep produced. */
export interface RetainerDecayResult {
  readonly relationships: Record<NpcId, Relationship>;
  readonly due: readonly RetainerDueIntent[];
}

/**
 * Whether a Relationship is a running money-motivated Asset carrying a retainer
 * — the only relationships the decay sweep touches. A relationship with no
 * retainer, or one for an NPC whose dominant lever is not money, is left alone.
 */
export function subjectToRetainerDecay(
  rel: Relationship,
  npcs: Record<NpcId, Npc>,
): boolean {
  if (!rel.recruited || rel.asset === undefined || rel.retainer === undefined) {
    return false;
  }
  const npc = npcs[rel.npc];
  return npc !== undefined && isMoneyMotivated(npc);
}

/**
 * The per-boundary retainer sweep (design: "Each phase overdue past the 2-day
 * grace period reduces trust for NPCs whose dominant MICE lever is money."; Req
 * 28.4). Pure in `now`, so the Turn Pipeline can run it at a phase or day
 * boundary and get the same result for the same clock.
 *
 * For every running money-motivated Asset carrying a retainer
 * ({@link subjectToRetainerDecay}) that is overdue past the grace period
 * ({@link overduePhases} `> 0`), it:
 *
 * - reduces the Asset's trust by {@link RETAINER_DECAY_PER_PHASE} times the
 *   number of overdue phases, clamped into `[0, 1]`; and
 * - raises a {@link RetainerDueIntent} the pipeline turns into a `retainer-due`
 *   expectation (a player-visible Notification, Req 39.3).
 *
 * Assets that are paid up, still within grace, not money-motivated, or carry no
 * retainer are returned unchanged and raise no intent, so a non-money Asset is
 * never affected (Req 28.4). The input map is not mutated; a *new* map is
 * returned with only the decayed relationships replaced. The intents come out in
 * NPC-id order so the sweep is deterministic.
 */
export function retainerDecay(
  relationships: Record<NpcId, Relationship>,
  npcs: Record<NpcId, Npc>,
  now: GameTime,
): RetainerDecayResult {
  const next: Record<NpcId, Relationship> = { ...relationships };
  const due: RetainerDueIntent[] = [];

  const ids = Object.keys(relationships).sort() as NpcId[];
  for (const id of ids) {
    const rel = relationships[id];
    if (!subjectToRetainerDecay(rel, npcs)) {
      continue;
    }
    // `subjectToRetainerDecay` has confirmed the retainer is present.
    const retainer = rel.retainer as Retainer;
    const overdue = overduePhases(retainer, now);
    if (overdue <= 0) {
      continue;
    }
    next[id] = addTrust(rel, -RETAINER_DECAY_PER_PHASE * overdue);
    due.push({ npc: id, amount: retainer.amount });
  }

  return { relationships: next, due };
}

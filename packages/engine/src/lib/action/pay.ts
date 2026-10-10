/**
 * The pay action (design, "Action Resolver" → **Pay**: "A Budget debit. It
 * satisfies retainers and adds trust for money-motivated NPCs."; Requirements
 * 28.2, 28.3, 28.4).
 *
 * `{ kind:'pay'; npc: NpcId; amount: number }` — the player pays a running Asset
 * a sum from the Budget. It is a Budget debit (Req 28.2) that, for a
 * money-motivated Asset, satisfies/advances their retainer and lifts their trust
 * (the pure Relationship side is {@link payEffect} in `../recruit/retainer.ts`;
 * the ledger side is {@link payLedgerEffect} in `../station/ledger.ts`).
 *
 * ## Quote (pure, no draws)
 *
 * The pay is allowed when:
 *
 * - the target resolves to a real NPC who is a **running Asset** (recruited with
 *   a profile — the design pays "Assets", {@link isAsset}); and
 * - the `amount` is a positive, finite number.
 *
 * The cost is {@link PAY_PHASE_COST} phases and `amount` money. The shared Budget
 * gate in `./action.ts` rejects an unaffordable pay (Req 28.3), so the resolver
 * only ever runs when the debit will succeed; the resolver re-checks the ledger
 * defensively and leaves state unchanged on an insufficient balance.
 *
 * ## Resolve (draws nothing)
 *
 * The resolver debits the Budget by `amount` tagged `pay` with the Asset as the
 * entry `ref` ({@link payLedgerEffect}); on {@link INSUFFICIENT} it rejects and
 * returns the state unchanged (Req 28.3). Otherwise it applies {@link payEffect}
 * to the Asset's {@link Relationship} — advancing the retainer and adding trust
 * for a money-motivated Asset, a no-op for any other motivation (Req 28.2, 28.4)
 * — and emits a plain pay Fact Line. It adds no Case File Claims.
 *
 * Pay draws no randomness, so it is deterministic in the state and the amount.
 * Fact Line rendering is left to the caller's `render` callback, so this module
 * never imports `./action.ts` and no import cycle forms.
 */

import type { LocId, NpcId } from '../model/core.js';
import type { WorldState } from '../model/state.js';
import { scheduledLocation } from '../city/npc.js';
import { scheduleWeekdayIndex } from '../city/calendar.js';
import { INSUFFICIENT, payLedgerEffect } from '../station/ledger.js';
import { isAsset, newRelationship } from '../recruit/asset.js';
import { payEffect } from '../recruit/retainer.js';
import type { ActionQuote, ActionResult, Observation } from './result.js';
import type { PayAction } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The phase cost of a pay: handing over money costs the current phase. */
export const PAY_PHASE_COST = 1;

/** The Fact Line a successful pay plays. */
export const PAY_LINE = 'You settle up. The money changes hands.';

// ---------------------------------------------------------------------------
// Local helpers (kept local to avoid an action.ts import cycle)
// ---------------------------------------------------------------------------

/**
 * The NPCs scheduled at a Location at the current time, by id in deterministic
 * order. A local copy of `./action.ts`'s `visibleNpcsAt` so this module does not
 * import `./action.ts` (which imports *this* module to route the action) and
 * form a cycle — the same local-helper pattern `./talk.ts`/`./confront.ts` use.
 */
function npcsScheduledAt(state: WorldState, locId: LocId): NpcId[] {
  const weekday = scheduleWeekdayIndex(state.time.day, state.meta.setting.startDate);
  const out: NpcId[] = [];
  for (const npc of Object.values(state.npcs)) {
    if (scheduledLocation(npc.schedule, weekday, state.time.phase) === locId) {
      out.push(npc.id);
    }
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The scene descriptor for a Location, built locally to avoid an action.ts cycle. */
function sceneDescriptorAt(state: WorldState, loc: LocId): ActionResult['scene'] {
  const place = state.city.locations[loc];
  if (place === undefined) {
    return { loc, description: '', atmosphere: [], risk: 0, visible: [] };
  }
  return {
    loc,
    description: place.description,
    atmosphere: [...place.atmosphere],
    risk: place.risk,
    visible: npcsScheduledAt(state, loc),
  };
}

// ---------------------------------------------------------------------------
// Quote (Req 28.2, 28.3)
// ---------------------------------------------------------------------------

/**
 * Quote a {@link PayAction} (pure, no draws). The target must resolve to a real
 * NPC who is a running Asset ({@link isAsset}), and the `amount` must be a
 * positive, finite number. The cost is {@link PAY_PHASE_COST} phases and
 * `amount` money; the shared Budget gate in `./action.ts` rejects an
 * unaffordable pay (Req 28.3). A pay is not performed at the player's
 * Location, so it has no `actionLocation` and the shared Location gate does
 * not apply.
 */
export function quotePay(state: WorldState, a: PayAction): ActionQuote {
  const npc = state.npcs[a.npc];
  if (npc === undefined) {
    return { allowed: false, reason: `no such person ${a.npc}`, phases: 0, money: 0 };
  }
  const rel = state.relationships[a.npc];
  if (rel === undefined || !isAsset(rel)) {
    return {
      allowed: false,
      reason: 'you can only pay a running Asset',
      phases: 0,
      money: 0,
    };
  }
  if (!Number.isFinite(a.amount) || a.amount <= 0) {
    return {
      allowed: false,
      reason: 'a payment must be a positive amount',
      phases: 0,
      money: 0,
    };
  }
  return { allowed: true, phases: PAY_PHASE_COST, money: a.amount };
}

// ---------------------------------------------------------------------------
// Resolve (Req 28.2, 28.3, 28.4)
// ---------------------------------------------------------------------------

/**
 * Resolve a {@link PayAction} (design `resolve`; draws nothing). The caller
 * (`resolve`) has confirmed the action is allowed, so the NPC is a running Asset
 * and the amount is positive. It debits the Budget by `amount` tagged `pay`
 * ({@link payLedgerEffect}); on an insufficient balance it rejects and returns
 * the state unchanged (Req 28.3). Otherwise it applies {@link payEffect} to the
 * Asset's {@link Relationship} — advancing the retainer and adding trust for a
 * money-motivated Asset, leaving a non-money Asset's trust and retainer untouched
 * (Req 28.2, 28.4) — and emits a plain pay Fact Line. It adds no Case File
 * Claims. Fact Line rendering is left to the caller's `render`.
 */
export function resolvePay(
  state: WorldState,
  a: PayAction,
  render: (state: WorldState, observations: readonly Observation[]) => string[],
): { next: WorldState; result: ActionResult } {
  const npc = state.npcs[a.npc];
  const ledger = payLedgerEffect(
    state.station.ledger,
    a.amount,
    state.time,
    a.npc,
  );
  // Defensive: the Budget gate should have caught this, but if the ledger cannot
  // cover the pay, reject and leave state unchanged (Req 28.3).
  if (npc === undefined || ledger === INSUFFICIENT) {
    return {
      next: state,
      result: {
        observations: [],
        factLines: [],
        scene: sceneDescriptorAt(state, state.player.loc),
        events: [],
        claimsAdded: [],
      },
    };
  }

  const rel = state.relationships[a.npc] ?? newRelationship(a.npc);
  const paidRel = payEffect(npc, rel, a.amount, state.time);

  const next: WorldState = {
    ...state,
    station: { ...state.station, ledger },
    relationships: { ...state.relationships, [a.npc]: paidRel },
  };

  const observations: Observation[] = [{ kind: 'message', line: PAY_LINE }];
  return {
    next,
    result: {
      observations,
      factLines: render(next, observations),
      scene: sceneDescriptorAt(next, next.player.loc),
      events: [],
      claimsAdded: [],
    },
  };
}

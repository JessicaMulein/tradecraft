/**
 * The Hostile Service's Dangle and Walk-in management (design, "Hostile Service
 * AI": `dailyTick` step 4; Requirements 11.1, 11.2, 22.7).
 *
 * A **Dangle** is a hostile agent the service dangles in front of the player as
 * bait: it approaches as a Walk-in, offers access, and — once the player bites
 * — reports a mix of verifiable Chickenfeed and deception back to its handler
 * (Req 11.2, which `./doubling.ts` and the feed path own). A genuine Walk-in is
 * a real volunteer. The two look identical to the player: the same `walk-in`
 * Notification carries no truth either way (design, "Hidden events and their
 * visible consequences"), and only the hidden `walk-in-approach` event carries
 * the ground-truth genuineness.
 *
 * The Walk-in *roll* already lives on the schedules day-boundary hook
 * (`../clock/schedules.ts`'s `rollWalkIn`, task 7.3): it emits the hidden
 * `walk-in-approach` (`{ npc, genuine: Truth<boolean> }`) and the player-visible
 * `walk-in`. This module does NOT re-roll Walk-ins — it would double-count the
 * daily stream. Instead it is the service's *reading* of a day's walk-in events:
 * given the `walk-in-approach` events the schedules hook produced, it classifies
 * each as genuine or a Dangle and tells the daily tick which approaching NPCs
 * the service is now running as Dangles.
 *
 * ## What this leaf owns
 *
 * - {@link classifyWalkIn} — the pure classification of one `walk-in-approach`
 *   event into {@link WalkInClassification} (`genuine` | `dangle`), read from
 *   the event's ground-truth `genuine` flag. A non-genuine Walk-in is a Dangle
 *   the service is running (Req 11.1, 22.7).
 * - {@link readWalkIns} — fold a day's events, pulling out the hidden
 *   `walk-in-approach` events and classifying each. Returns the Dangles the
 *   service should take up (the NPCs it now runs as bait) in a deterministic,
 *   id-stable order.
 *
 * ## Determinism / purity
 *
 * No draws: the genuineness was decided by the schedules roll on the daily
 * stream; this module only *reads* it, so classification is a pure function of
 * the event. Same events ⇒ same classification and same Dangle list
 * (Requirement 1.2). The leaf imports only the core model and the state event
 * type, staying Relationship-free and Action-Resolver-free.
 */

import { revealTruth, type NpcId } from '../model/core.js';
import type { SimEvent } from '../model/state.js';

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/** How the service reads a Walk-in: a genuine volunteer, or a Dangle it runs. */
export type WalkInClassification = 'genuine' | 'dangle';

/**
 * The `walk-in-approach` event shape {@link classifyWalkIn} reads: the NPC who
 * approached and the ground-truth genuineness the schedules roll decided. A
 * structural subset of the `walk-in-approach` {@link SimEvent} variant, so the
 * event threads in directly.
 */
export interface WalkInApproach {
  readonly npc: NpcId;
  readonly genuine: import('../model/core.js').Truth<boolean>;
}

/**
 * Classify a Walk-in from its hidden `walk-in-approach` event (Req 11.1, 22.7).
 * Pure, no draws. A genuine approach is a real volunteer; a non-genuine one is
 * a Dangle the Hostile Service is running against the player. The service knows
 * which is which because it is the service — this reads the ground-truth
 * `genuine` flag the schedules roll stamped, not a guess.
 */
export function classifyWalkIn(approach: WalkInApproach): WalkInClassification {
  return revealTruth(approach.genuine) ? 'genuine' : 'dangle';
}

// ---------------------------------------------------------------------------
// Reading a day's Walk-ins
// ---------------------------------------------------------------------------

/** The service's reading of a day's Walk-ins: the Dangles it should run. */
export interface WalkInReading {
  /**
   * The NPCs who approached as Dangles this day (the service runs them as bait),
   * id-sorted for a deterministic order. Empty when the day's Walk-ins were all
   * genuine, or when there was no Walk-in.
   */
  readonly dangles: readonly NpcId[];
  /**
   * The NPCs who approached as genuine volunteers this day, id-sorted. Carried
   * so the daily tick / later analysis can treat a genuine Walk-in differently
   * from a Dangle without re-reading the events.
   */
  readonly genuine: readonly NpcId[];
}

/**
 * Read a day's events for the service's Walk-in management (design, step 4).
 * Pure, no draws. It pulls out every hidden `walk-in-approach` event the
 * schedules roll produced and classifies each with {@link classifyWalkIn},
 * partitioning the approaching NPCs into the Dangles the service runs and the
 * genuine volunteers. Both lists are id-sorted and deduped so the reading is a
 * stable function of the day's events (Requirement 1.2).
 *
 * This module never re-rolls a Walk-in — the daily stream already decided
 * whether one occurred and whether it was genuine. It only reads what the
 * schedules hook emitted, so threading it after the schedules hook on a day
 * boundary cannot shift the stream.
 */
export function readWalkIns(events: readonly SimEvent[]): WalkInReading {
  const dangles = new Set<NpcId>();
  const genuine = new Set<NpcId>();
  for (const event of events) {
    if (event.kind !== 'walk-in-approach') {
      continue;
    }
    const classification = classifyWalkIn(event);
    if (classification === 'dangle') {
      dangles.add(event.npc);
    } else {
      genuine.add(event.npc);
    }
  }
  return {
    dangles: [...dangles].sort(),
    genuine: [...genuine].sort(),
  };
}

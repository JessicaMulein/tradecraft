/**
 * The live Disruption Context: the predicates Plot execution reads to decide
 * whether a stage is disrupted, built from the Draft's current state
 * (slice-integration design, "Engine: Live Disruption Context"; Requirements
 * 4.1, 4.2, 4.3, 4.4).
 *
 * `executePlotDay` (`./plot-execution.ts`) takes a {@link DisruptionContext} and
 * defaults it to `NO_DISRUPTION`, so Plot execution can be tested without a
 * world. {@link liveDisruption} supplies the real predicates. The Plot hook
 * builds it from the Draft each time it runs (Req 4.1), so an arrest, a seizure
 * or a compromised Channel applied earlier in the same turn is seen by that
 * day's Plot step.
 *
 * ## What each predicate reads
 *
 * `isArrested(npc)` (Req 4.2) holds when any of these standing records takes
 * the NPC out of play:
 *
 * 1. **Status.** `npcs[npc].status` is `arrested` or `fled`. An absent status
 *    reads as `active`.
 * 2. **Custody.** The NPC's Relationship records a hold that is still running:
 *    Station Custody not yet handed over ({@link inStationCustody}), or a
 *    Hostile Service hold (`custody.by === 'hostile'`) with no `until` or
 *    before its `until`. The Hostile hold counts because a participant the
 *    Hostile Service has arrested cannot carry out a stage either.
 * 3. **The Station's arrest record.** `player.arrests` names the NPC, by NPC id
 *    or by the player's `unk:` id for them (`player.unkIds`), because an arrest
 *    may target an Unidentified Subject. The record outlives the custody hold,
 *    so a Station arrest keeps the NPC out of play after hand-over, and after a
 *    turned agent is released. This is the same record `detectEnd` reads for
 *    the leader (`leaderArrestedByStation` in `../endings/end-conditions.ts`).
 *
 * `isChannelCompromised(chan)` (Req 4.3) holds when `chan` is in
 * `hostile.beliefs.compromisedChannels`.
 *
 * `isMaterielSeized()` (Req 4.4) is `plot.materielSeized`. The arrest and
 * `service-drop` resolvers set it when the Station takes the materiel from a
 * hostile Dead Drop or from an arrested carrier.
 *
 * ## Purity
 *
 * {@link liveDisruption} reads only its argument and draws nothing. The World
 * State is immutable, so the predicates answer for the state as it was when the
 * context was built. A caller rebuilds the context to see later changes.
 */

import {
  timeToPhases,
  type EntityId,
  type GameTime,
  type NpcId,
} from '../model/core.js';
import type { WorldState } from '../model/state.js';
import { inStationCustody, type Relationship } from '../recruit/asset.js';
import type { DisruptionContext } from './plot-execution.js';

/**
 * Build the live {@link DisruptionContext} from `draft` (Req 4.1–4.4). See the
 * module documentation for the records each predicate reads.
 */
export function liveDisruption(draft: WorldState): DisruptionContext {
  const arrestRecord: ReadonlySet<EntityId> = new Set(draft.player.arrests);
  const compromised: ReadonlySet<string> = new Set(
    draft.hostile.beliefs.compromisedChannels,
  );
  const materielSeized = draft.plot.materielSeized === true;

  return {
    isArrested: (npc) =>
      outOfPlayByStatus(draft, npc) ||
      heldAt(draft.relationships[npc], draft.time) ||
      inArrestRecord(draft, arrestRecord, npc),
    isChannelCompromised: (channel) => compromised.has(channel),
    isMaterielSeized: () => materielSeized,
  };
}

/** Whether the NPC's status is `arrested` or `fled`. */
function outOfPlayByStatus(draft: WorldState, npc: NpcId): boolean {
  const status = draft.npcs[npc]?.status;
  return status === 'arrested' || status === 'fled';
}

/**
 * Whether the Relationship records a hold still running at `now`: Station
 * Custody not yet handed over, or a Hostile Service hold.
 */
function heldAt(rel: Relationship | undefined, now: GameTime): boolean {
  if (rel === undefined) {
    return false;
  }
  return inStationCustody(rel, now) || inHostileHold(rel, now);
}

/**
 * Whether the Hostile Service holds the NPC at `now`: a `hostile` custody record
 * with no `until`, or one whose `until` has not yet come. This mirrors
 * {@link inStationCustody} for the other holder.
 */
function inHostileHold(rel: Relationship, now: GameTime): boolean {
  const custody = rel.custody;
  if (custody === undefined || custody.by !== 'hostile') {
    return false;
  }
  if (custody.until === undefined) {
    return true;
  }
  return timeToPhases(now) < timeToPhases(custody.until);
}

/**
 * Whether the Station's arrest record names the NPC, by NPC id or by the `unk:`
 * id the player knows them by.
 */
function inArrestRecord(
  draft: WorldState,
  record: ReadonlySet<EntityId>,
  npc: NpcId,
): boolean {
  if (record.has(npc)) {
    return true;
  }
  const alias = draft.player.unkIds[npc];
  return alias !== undefined && record.has(alias);
}

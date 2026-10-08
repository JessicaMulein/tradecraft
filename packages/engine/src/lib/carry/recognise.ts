/**
 * Recogniser checks and the "seen before" Fact Line (campaign-career design,
 * "Recogniser hook"; Requirements 12.6, 13.3, 13.4).
 *
 * A present recogniser runs the slice detection check with security 1. A hit
 * adds `recogniserSuspicion` to Cover Suspicion and records a hidden
 * `officer-recognised` event. The only player-facing line is the ordinary
 * "made" line, and only when the preset reveal coin says so. The first
 * sighting of a pre-allocated unidentified subject appends where that face
 * was seen before. A person with no pre-allocation gets neither the line nor
 * a reused id from this module. With no carry state, nothing is drawn.
 */

import { asTruth, revealTruth, type GameTime, type LocId, type NpcId } from '../model/core.js';
import type { SimEvent, WorldState } from '../model/state.js';
import type { Prng } from '../prng/prng.js';
import { scheduledLocation } from '../city/npc.js';
import { CONTENT_WEEKDAYS, weekdayForDay } from '../city/time-mapping.js';
import type { CarryState } from './types.js';

export interface RecogniserPass {
  readonly next: WorldState;
  readonly events: readonly SimEvent[];
  /** True when the reveal coin says to show the ordinary "made" line. */
  readonly made: boolean;
  readonly seenBefore: readonly string[];
}

/** The Fact Line for a face the player has already seen unidentified. */
export function seenBeforeFactLine(
  sightings: readonly { readonly city: string; readonly year: number }[],
): string {
  const text = [...sightings]
    .sort((left, right) => left.year - right.year || left.city.localeCompare(right.city))
    .map((row) => `${row.city}, ${row.year}`)
    .join('; ');
  return `You have seen this face before: ${text}.`;
}

/** NPCs scheduled at `loc` at `at`, in id order. */
export function npcsAt(state: WorldState, loc: LocId, at: GameTime): NpcId[] {
  const weekday = CONTENT_WEEKDAYS.indexOf(weekdayForDay(at.day));
  const ids: NpcId[] = [];
  for (const npc of Object.values(state.npcs)) {
    if (scheduledLocation(npc.schedule, weekday, at.phase) === loc) {
      ids.push(npc.id);
    }
  }
  return ids.sort((left, right) => left.localeCompare(right));
}

/**
 * Run one security-1 check per present recogniser, then the first-sighting
 * lines for `sighted`. Draws nothing when the world has no carry state, and
 * draws no recogniser coin when none of `present` is a recogniser.
 */
export function applyRecogniserPass(
  state: WorldState,
  rng: Prng,
  base: number,
  present: readonly NpcId[],
  sighted: readonly NpcId[],
  at: GameTime,
  loc: LocId,
): RecogniserPass {
  if (state.carry === undefined) {
    return { next: state, events: [], made: false, seenBefore: [] };
  }
  const carry = revealTruth(state.carry);
  const recognisers = present
    .filter((id) => carry.recognisers.includes(id))
    .sort((left, right) => left.localeCompare(right));
  let suspicion = revealTruth(state.player.coverSuspicion);
  const before = suspicion;
  const events: SimEvent[] = [];
  let made = false;
  const probability = clamp01(base);
  for (const npc of recognisers) {
    const detected = rng.next() < probability;
    if (!detected) {
      continue;
    }
    suspicion = clamp01(suspicion + carry.recogniserSuspicion);
    events.push({
      kind: 'officer-recognised',
      id: `evt:officer-recognised:${npc}:${at.day}:${at.phase}`,
      at,
      visibility: 'hidden',
      npc,
      loc,
    });
    if (rng.next() < state.meta.preset.madeRevealProbability) {
      made = true;
    }
  }
  const seen = new Set(carry.seen);
  const lines: string[] = [];
  for (const npc of sighted) {
    if (seen.has(npc)) {
      continue;
    }
    const entry = Object.values(carry.unk).find((row) => row.npc === npc);
    if (entry === undefined || entry.sightings.length === 0) {
      continue;
    }
    lines.push(seenBeforeFactLine(entry.sightings));
    seen.add(npc);
  }
  const changed = suspicion !== before || lines.length > 0;
  if (!changed) {
    return { next: state, events, made, seenBefore: lines };
  }
  const nextCarry: CarryState = {
    ...carry,
    seen: lines.length > 0 ? [...seen] : carry.seen,
  };
  return {
    next: {
      ...state,
      player: { ...state.player, coverSuspicion: asTruth(suspicion) },
      carry: asTruth(nextCarry),
    },
    events,
    made,
    seenBefore: lines,
  };
}

/** Keep Fact Lines a clock step produced until the action that advanced it. */
export function queueCarryLines(state: WorldState, lines: readonly string[]): WorldState {
  if (lines.length === 0 || state.carry === undefined) {
    return state;
  }
  const carry = revealTruth(state.carry);
  return {
    ...state,
    carry: asTruth({ ...carry, pendingLines: [...carry.pendingLines, ...lines] }),
  };
}

/** Take queued Fact Lines off the world. An empty queue returns the same state. */
export function takeCarryLines(state: WorldState): { readonly state: WorldState; readonly lines: readonly string[] } {
  if (state.carry === undefined) {
    return { state, lines: [] };
  }
  const carry = revealTruth(state.carry);
  if (carry.pendingLines.length === 0) {
    return { state, lines: [] };
  }
  return {
    state: { ...state, carry: asTruth({ ...carry, pendingLines: [] }) },
    lines: carry.pendingLines,
  };
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

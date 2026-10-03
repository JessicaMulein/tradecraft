/**
 * The Hostile Service's belief model and per-Asset Exposure tracking (design,
 * "Hostile Service AI": `HostileBeliefs`; Requirement 12.2).
 *
 * The design sketches the belief state the service carries from day to day:
 *
 * ```ts
 * interface HostileBeliefs {
 *   credibility: Record<NpcId, number>;   // per agent, from pre-turn trust
 *   agentSuspicion: Record<NpcId, number>;
 *   adopted: Proposition[]; compromisedChannels: ChannelId[]; // + existing fields
 * }
 * ```
 *
 * This module owns the real {@link HostileBeliefs} shape and the pure
 * transitions over it that task 19.1 is responsible for:
 *
 * - **Exposure tracking (Req 12.1/12.2).** `exposure[npc]` is the service's
 *   running read of how visible each Asset's relationship with the player is.
 *   The design increases it from *contact frequency, meeting-location risk and
 *   tasking risk*; the Action Resolver already accrues the player-side
 *   `Relationship.exposure` from those same terms (meetings, drops, tasking),
 *   so {@link accrueExposure} folds a day's player-side Exposure reading into
 *   the service's own mirror. Detection reads this mirror, never the player
 *   view.
 * - **Agent suspicion (Req 12.2).** `agentSuspicion[npc]` rises from a refuted
 *   feed (task 19.6) and a custody release (task 18.5) and feeds the daily
 *   detection check, so a suspicious agent is detected sooner.
 * - **Belief adoption (Req 12.2).** `adopted` is the set of Propositions the
 *   service has come to believe (from a mole report, a feed or its own
 *   observation). {@link adoptBelief} adds a Proposition once per belief key —
 *   the adaptation rules (task 19.6) and the Abort Pressure hook
 *   (`../clock/plot-abort.ts`'s `applyBeliefPressure`) consume newly adopted
 *   beliefs, so adoption is deduped here to keep "once per belief key"
 *   (design) a property of the state rather than of every consumer.
 * - **Credibility (design, feed ingestion).** `credibility[npc]` starts at the
 *   agent's pre-turn trust and moves on confirm/refute; it is read by the feed
 *   ingestion (task 19.6). This task defines the field and its initial value
 *   seam so 19.6 fills in the maths.
 *
 * Everything here is pure: each transition returns a new {@link HostileBeliefs}
 * and never mutates its input, and no function draws randomness (the detection
 * check in `./detection.ts` is where the day's draws live). The belief *keys*
 * are stable strings so a consumer can dedupe and so the Abort Pressure tally
 * counts a belief once (`../clock/plot-abort.ts`, Property 27).
 */

import type { ChannelId, NpcId, Proposition } from '../model/core.js';

// ---------------------------------------------------------------------------
// HostileBeliefs
// ---------------------------------------------------------------------------

/**
 * The Hostile Service's running belief model (design, `HostileBeliefs`). Every
 * record is keyed by NPC id; the lists are the service's adopted Propositions
 * and the player Channels it has learned are compromised. The whole structure
 * is ground truth the player must infer, never read — it lives inside the
 * engine's `HostileServiceState` and never crosses into the Player View.
 */
export interface HostileBeliefs {
  /**
   * Per-Asset credibility, starting at the agent's pre-turn trust (0.5–0.8) and
   * moved by feed confirm/refute (task 19.6). Absent until the agent is turned
   * and first fed.
   */
  readonly credibility: Readonly<Record<NpcId, number>>;
  /**
   * Per-Asset suspicion the service holds, in `[0, 1]`. Rises from a refuted
   * feed and a custody release; feeds the daily detection check (design).
   */
  readonly agentSuspicion: Readonly<Record<NpcId, number>>;
  /**
   * The service's running read of each Asset's Exposure, in `[0, 1]`. Mirrors
   * the player-side `Relationship.exposure` the Action Resolver accrues from
   * contact frequency, meeting-location risk and tasking risk (Req 12.1); the
   * daily detection check reads this.
   */
  readonly exposure: Readonly<Record<NpcId, number>>;
  /** The Propositions the service has adopted (deduped by belief key). */
  readonly adopted: readonly Proposition[];
  /** The dedupe keys of {@link adopted}, parallel to the adaptation hook. */
  readonly adoptedKeys: readonly string[];
  /** The player Channels the service has learned are compromised. */
  readonly compromisedChannels: readonly ChannelId[];
  /**
   * The player's Assets the service has detected (and not yet arrested). An
   * Asset here is a known target of a response; detection skips it so the same
   * Asset is not re-detected every day.
   */
  readonly suspectedAssets: readonly NpcId[];
}

/** A fresh, empty belief model — the state the service starts a game with. */
export function emptyHostileBeliefs(): HostileBeliefs {
  return {
    credibility: {},
    agentSuspicion: {},
    exposure: {},
    adopted: [],
    adoptedKeys: [],
    compromisedChannels: [],
    suspectedAssets: [],
  };
}

// ---------------------------------------------------------------------------
// Exposure tracking (Req 12.1, 12.2)
// ---------------------------------------------------------------------------

/** Clamp a value to `[0, 1]`. */
function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Fold a reading of an Asset's current Exposure into the service's mirror
 * (Req 12.1). The service's read of an Asset's Exposure only ever rises toward
 * the player-side reading — the opposition does not *forget* visibility within
 * a game — so the stored value is the max of the old mirror and the new
 * reading, clamped to `[0, 1]`. Pure: returns a new {@link HostileBeliefs}.
 *
 * The `reading` is the player-side `Relationship.exposure` the Action Resolver
 * already accrued from contact frequency, meeting-location risk and tasking
 * risk, so this module does not re-derive those terms — it mirrors the one
 * place they are computed.
 */
export function accrueExposure(
  beliefs: HostileBeliefs,
  npc: NpcId,
  reading: number,
): HostileBeliefs {
  const next = clamp01(Math.max(beliefs.exposure[npc] ?? 0, reading));
  if (next === (beliefs.exposure[npc] ?? 0)) {
    return beliefs;
  }
  return { ...beliefs, exposure: { ...beliefs.exposure, [npc]: next } };
}

/**
 * Raise the service's suspicion of an agent by `delta`, clamped to `[0, 1]`
 * (design: a refuted feed adds +0.2; a custody release adds `0.1 × phases`).
 * Pure. A non-positive `delta` that would not move the value returns the input
 * unchanged.
 */
export function raiseAgentSuspicion(
  beliefs: HostileBeliefs,
  npc: NpcId,
  delta: number,
): HostileBeliefs {
  const next = clamp01((beliefs.agentSuspicion[npc] ?? 0) + delta);
  if (next === (beliefs.agentSuspicion[npc] ?? 0)) {
    return beliefs;
  }
  return {
    ...beliefs,
    agentSuspicion: { ...beliefs.agentSuspicion, [npc]: next },
  };
}

/**
 * The service's effective suspicion of an Asset for the detection check: the
 * larger of its Exposure mirror and its agent suspicion. Both feed detection
 * (design: Exposure drives counter-intelligence detection, and agent suspicion
 * "feeds the daily detection check"); taking the max keeps a highly-exposed but
 * un-suspected Asset and a low-exposure but refuted-feed Asset both detectable.
 */
export function effectiveExposure(beliefs: HostileBeliefs, npc: NpcId): number {
  return Math.max(beliefs.exposure[npc] ?? 0, beliefs.agentSuspicion[npc] ?? 0);
}

// ---------------------------------------------------------------------------
// Belief adoption (Req 12.2)
// ---------------------------------------------------------------------------

/**
 * The stable dedupe key for an adopted belief: predicate, subject, object,
 * place and window flattened into one string. Two Propositions with the same
 * key are the "same belief" for the once-per-belief-key rule the adaptation and
 * Abort-Pressure consumers rely on (design; Property 27). Exposed so a consumer
 * (task 19.6) can form the same key for its own tally.
 */
export function beliefKey(prop: Proposition): string {
  const object = typeof prop.object === 'string' ? prop.object : JSON.stringify(prop.object);
  const place = prop.place ?? '';
  const window = prop.window === undefined ? '' : JSON.stringify(prop.window);
  return `${prop.predicate}|${prop.subject}|${object}|${place}|${window}`;
}

/** The result of adopting a belief: the new state, and whether it was new. */
export interface AdoptResult {
  /** The belief model after adoption (unchanged when the belief was already held). */
  readonly beliefs: HostileBeliefs;
  /** True when this call added a belief the service did not already hold. */
  readonly adopted: boolean;
}

/**
 * Adopt a Proposition into the service's belief model, once per belief key
 * (Req 12.2). Pure. When the belief is already held (its {@link beliefKey} is
 * in `adoptedKeys`) the state is returned unchanged and `adopted` is `false`;
 * otherwise the Proposition and its key are appended and `adopted` is `true`.
 *
 * The `adopted` flag is what the adaptation rules (task 19.6) and the Abort
 * Pressure hook key off: a belief adopted *this* tick (a true `adopted`) is a
 * newly-adopted belief the design's step-5 rules act on and `applyBeliefPressure`
 * counts once; an already-held belief acts on nothing.
 */
export function adoptBelief(beliefs: HostileBeliefs, prop: Proposition): AdoptResult {
  const key = beliefKey(prop);
  if (beliefs.adoptedKeys.includes(key)) {
    return { beliefs, adopted: false };
  }
  return {
    beliefs: {
      ...beliefs,
      adopted: [...beliefs.adopted, prop],
      adoptedKeys: [...beliefs.adoptedKeys, key],
    },
    adopted: true,
  };
}

/** Mark an Asset detected so the daily check does not re-detect it. Pure. */
export function markSuspected(beliefs: HostileBeliefs, npc: NpcId): HostileBeliefs {
  if (beliefs.suspectedAssets.includes(npc)) {
    return beliefs;
  }
  return { ...beliefs, suspectedAssets: [...beliefs.suspectedAssets, npc] };
}

/** Record a player Channel the service has learned is compromised. Pure. */
export function markChannelCompromised(
  beliefs: HostileBeliefs,
  channel: ChannelId,
): HostileBeliefs {
  if (beliefs.compromisedChannels.includes(channel)) {
    return beliefs;
  }
  return {
    ...beliefs,
    compromisedChannels: [...beliefs.compromisedChannels, channel],
  };
}

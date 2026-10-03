/**
 * The Hostile Service's feed ingestion (design, "Hostile Service AI": "Feed
 * ingestion (Req 37)"; Requirements 37.3, 37.4, 37.5, 11.4).
 *
 * When a turned agent next contacts its handler, the feed the player composed
 * (task 18.6, `../action/feed.ts`) is delivered as a hidden `feed-delivered`
 * event carrying the agent and the fed Propositions. On delivery the Hostile
 * Service ingests the feed: it classifies each Proposition, moves the agent's
 * credibility by what it can confirm or refute, and adopts the ones it comes to
 * believe. This module owns that pure ingestion step; the adopted beliefs flow
 * on into the step-5 adaptation (`./adaptation.ts`) and the Abort Pressure hook,
 * so a credible feed is how the player steers the Cell's operation.
 *
 * ## The design's rule, per Proposition `p`
 *
 * - **Classification** — `chickenfeed` if `p` holds in the Truth Store at
 *   delivery, else `deception`. The classification is ground truth: it is used
 *   only in the debrief and is never shown in the Player View (Req 37.6). It
 *   does *not* drive the credibility move — the service does not know ground
 *   truth, it only knows what it can confirm or refute (below).
 * - **Confirm** — `p` is in the Hostile Service's own Knowledge Slice:
 *   credibility `+{@link CONFIRM_CREDIBILITY}` (+0.1).
 * - **Refute** — the service knows a Proposition with the same subject and
 *   predicate that contradicts `p` (a different object, place, or a
 *   non-overlapping window): credibility `-{@link REFUTE_CREDIBILITY}` (−0.3)
 *   and agent suspicion `+{@link REFUTE_SUSPICION}` (+0.2). Agent suspicion
 *   feeds the daily detection check (`./detection.ts`), so a refuted feed can
 *   blow the agent (Req 37.4) — above {@link import('./detection.js').BLOWN_AGENT_SUSPICION}
 *   a detected double is arrested, not re-run.
 * - **Unverifiable** — neither confirmed nor refuted: adopted as a belief when
 *   the agent's credibility (after this day's moves) is at or above the doctrine
 *   adoption threshold `0.4 + 0.4 × securityConsciousness` (Req 37.4; a more
 *   security-conscious service demands a more credible source before believing
 *   it). An adopted Proposition about a Plot Channel (`KNOWS(station, chan)`)
 *   additionally marks that Channel compromised, which the daily tick turns into
 *   a Plot disruption / Abort Pressure (Req 38.3, step 5).
 *
 * ## This leaf is projection-driven (19.1's pattern) and Truth-Store-free
 *
 * The design's `ingestFeed` takes a `TruthStore`, but — exactly as the
 * detection, doubling, adaptation and mole-report leaves do — this leaf stays
 * Truth-Store-free, Relationship-free and Station-slice-free. The caller (the
 * Turn Pipeline, on delivering a `feed-delivered` event) projects in, per fed
 * Proposition, the three facts the leaf cannot derive without ground truth:
 *
 * - `holdsInTruth` — whether the Proposition holds in the Truth Store at
 *   delivery (the chickenfeed/deception classification);
 * - `confirmed` — whether it is in the service's own Knowledge Slice;
 * - `refuted` — whether the service knows a contradicting Proposition.
 *
 * These projections are the only ground-truth reads; everything the leaf does
 * with them (the credibility arithmetic, the adoption threshold, the adopted
 * list) is pure state over {@link HostileBeliefs}.
 *
 * ## Credibility seeding (design: "starts at the agent's pre-turn trust")
 *
 * `credibility[agent]` starts at the agent's pre-turn trust (0.5–0.8) the first
 * time the agent is fed. The caller projects that seed in ({@link FeedDelivery.priorTrust});
 * when the agent already has a credibility reading the seed is ignored and the
 * running value is moved.
 *
 * ## Determinism / purity
 *
 * No draws. The Propositions are ingested in the delivered order (the player's
 * feed order, which `../action/feed.ts` fixed), the credibility and suspicion
 * moves are plain arithmetic clamped to `[0, 1]`, and the adoption decision is a
 * threshold test — so the same delivery and beliefs always yield the same
 * result (Requirement 1.2; Property 30). The leaf imports only the core model,
 * the state event type, the doctrine shape and the belief transitions it folds
 * through.
 */

import type { ChannelId, GameTime, NpcId, Proposition } from '../model/core.js';
import type { EventId, SimEvent } from '../model/state.js';
import type { Doctrine } from './doctrine.js';
import {
  adoptBelief,
  markChannelCompromised,
  type HostileBeliefs,
} from './beliefs.js';

// ---------------------------------------------------------------------------
// Constants (design: the feed credibility/suspicion moves and adoption threshold)
// ---------------------------------------------------------------------------

/** Credibility gained per confirmed Proposition (design: +0.1). */
export const CONFIRM_CREDIBILITY = 0.1;

/** Credibility lost per refuted Proposition (design: −0.3). */
export const REFUTE_CREDIBILITY = 0.3;

/** Agent suspicion gained per refuted Proposition (design: +0.2). */
export const REFUTE_SUSPICION = 0.2;

/**
 * The doctrine adoption threshold for an unverifiable Proposition
 * (design: `0.4 + 0.4 × securityConsciousness`). A more security-conscious
 * service demands a more credible source before adopting its claims.
 */
export function adoptionThreshold(doctrine: Doctrine): number {
  return 0.4 + 0.4 * doctrine.securityConsciousness;
}

// ---------------------------------------------------------------------------
// The feed delivery (the projection)
// ---------------------------------------------------------------------------

/**
 * How the service can check one fed Proposition against what it knows, projected
 * in by the caller (the leaf does not read the Truth Store or the service's
 * Knowledge Slice). The three flags are independent reads of ground truth; the
 * leaf turns them into the credibility move and the adoption decision.
 */
export interface FedProposition {
  /** The fed Proposition, exactly as delivered (its `unk:` ids already resolved). */
  readonly prop: Proposition;
  /**
   * Whether `prop` holds in the Truth Store at delivery — the chickenfeed (true)
   * vs deception (false) classification (design). Debrief-only ground truth; it
   * does not move credibility.
   */
  readonly holdsInTruth: boolean;
  /**
   * Whether `prop` is in the service's own Knowledge Slice (the service can
   * **confirm** it). A confirmed Proposition raises credibility.
   */
  readonly confirmed: boolean;
  /**
   * Whether the service knows a Proposition with the same subject and predicate
   * that contradicts `prop` (the service can **refute** it). A refuted
   * Proposition lowers credibility and raises agent suspicion. Mutually
   * exclusive with {@link FedProposition.confirmed} by construction (a caller
   * never both confirms and refutes the same Proposition); if both are set the
   * leaf applies confirm then refute in a fixed order so the result is still
   * deterministic.
   */
  readonly refuted: boolean;
  /**
   * The Plot Channel this Proposition is about, when it is a
   * `KNOWS(station, chan)` belief naming a Channel (Req 38.3). Projected in by
   * the caller (which Channels belong to the Plot is ground truth the leaf does
   * not derive); when the Proposition is adopted the Channel is marked
   * compromised and returned for the daily tick to turn into a Plot disruption.
   * Omitted ⇒ the Proposition names no Plot Channel.
   */
  readonly channel?: ChannelId;
}

/**
 * A delivered feed, projected in by the caller on a `feed-delivered` event. The
 * `agent` is the turned Asset whose handler just received the feed; `items` are
 * the fed Propositions with the service's confirm/refute/holds reads;
 * `priorTrust` seeds the agent's credibility the first time it is fed.
 */
export interface FeedDelivery {
  /** The turned agent whose handler received the feed. */
  readonly agent: NpcId;
  /** The fed Propositions, in delivery order, with the service's checks. */
  readonly items: readonly FedProposition[];
  /**
   * The agent's pre-turn trust (0.5–0.8), used to seed `credibility[agent]` the
   * first time the agent is fed (design). Ignored when the agent already has a
   * credibility reading.
   */
  readonly priorTrust: number;
}

/** The chickenfeed/deception classification of a fed Proposition (debrief-only). */
export type FeedClass = 'chickenfeed' | 'deception';

// ---------------------------------------------------------------------------
// The result
// ---------------------------------------------------------------------------

/** The result of ingesting a delivered feed. */
export interface IngestFeedResult {
  /**
   * The belief model after the day's credibility/suspicion moves, belief
   * adoption and any compromised-Channel marks.
   */
  readonly beliefs: HostileBeliefs;
  /**
   * The chickenfeed/deception classification of each fed Proposition, in the
   * delivered order (design: "stored only in the Truth Store and shown in the
   * debrief"). Carried for the debrief; never shown in the Player View (Req 37.6).
   */
  readonly classes: readonly FeedClass[];
  /**
   * The Propositions newly adopted this ingestion (not already held). The daily
   * tick feeds these to the step-5 belief-driven adaptation, so the Cell adapts
   * to a credible feed (Req 37.5, 11.4). Empty when nothing new was believed.
   */
  readonly adopted: readonly Proposition[];
  /**
   * The Plot Channels this feed newly marked compromised (an adopted
   * `KNOWS(station, chan)` belief; Req 38.3). The daily tick raises Abort
   * Pressure for each via the plot-abort pressure hook. Empty when no adopted
   * belief named a Plot Channel.
   */
  readonly compromisedChannels: readonly ChannelId[];
  /**
   * The hidden events: a `belief-adopted` event per newly-adopted belief, in
   * adoption order. (The feed delivery itself is already surfaced by the
   * `feed-delivered` event the Turn Pipeline delivered; the credibility move is
   * belief-model state the Player View never sees, so it emits no event.)
   */
  readonly events: readonly SimEvent[];
}

/** Clamp a value to `[0, 1]`. */
function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Deterministically mint a belief-adopted event id for an ingested feed belief. */
function feedEventId(at: GameTime, seq: number): EventId {
  return `hostile-evt:feed-adopt:${at.day}:${at.phase}:${seq}`;
}

// ---------------------------------------------------------------------------
// ingestFeed (Req 37.3, 37.4, 37.5)
// ---------------------------------------------------------------------------

/**
 * Ingest a delivered feed into the service's belief model (design, "Feed
 * ingestion"; Req 37.3, 37.4, 37.5). Pure, no draws.
 *
 * For the delivery's agent it seeds `credibility[agent]` from `priorTrust` the
 * first time the agent is fed, then walks the fed Propositions in delivery order:
 *
 * 1. **classify** each as `chickenfeed` (it holds in Truth at delivery) or
 *    `deception` (it does not) from the projected `holdsInTruth` — debrief-only
 *    ground truth that does not move credibility;
 * 2. **confirm** (`+{@link CONFIRM_CREDIBILITY}`) and/or **refute**
 *    (`-{@link REFUTE_CREDIBILITY}` credibility, `+{@link REFUTE_SUSPICION}`
 *    agent suspicion) from the projected `confirmed` / `refuted` reads, clamped
 *    to `[0, 1]`;
 * 3. **adopt** a Proposition that is neither confirmed nor refuted
 *    (unverifiable) when the agent's running credibility is at or above
 *    {@link adoptionThreshold}. Adoption is deduped once per belief key by
 *    {@link adoptBelief}; a newly-adopted belief about a Plot Channel also marks
 *    that Channel compromised.
 *
 * The credibility threshold is tested against the credibility *after* this day's
 * confirm/refute moves, so a confirming Proposition can lift the agent over the
 * bar for the Propositions that follow it in the same feed (the service grows to
 * trust an agent that has just told it something it could check, then believes
 * the rest). It returns the updated beliefs, the per-item classification (for the
 * debrief), the newly-adopted Propositions and compromised Channels (for the
 * step-5 adaptation and Abort Pressure), and a `belief-adopted` event per new
 * belief.
 */
export function ingestFeed(
  beliefs: HostileBeliefs,
  delivery: FeedDelivery,
  doctrine: Doctrine,
  at: GameTime,
): IngestFeedResult {
  const { agent } = delivery;

  // Seed credibility from the agent's pre-turn trust the first time it is fed;
  // otherwise keep the running value.
  let credibility =
    beliefs.credibility[agent] ?? clamp01(delivery.priorTrust);
  let next: HostileBeliefs = {
    ...beliefs,
    credibility: { ...beliefs.credibility, [agent]: credibility },
  };

  const threshold = adoptionThreshold(doctrine);
  const classes: FeedClass[] = [];
  const adopted: Proposition[] = [];
  const compromisedChannels: ChannelId[] = [];
  const events: SimEvent[] = [];
  let suspicion = next.agentSuspicion[agent] ?? 0;
  let seq = 0;

  for (const item of delivery.items) {
    classes.push(item.holdsInTruth ? 'chickenfeed' : 'deception');

    // Confirm / refute move the credibility (and refute the suspicion), applied
    // in a fixed order (confirm then refute) so the result is deterministic even
    // in the degenerate case a caller sets both.
    if (item.confirmed) {
      credibility = clamp01(credibility + CONFIRM_CREDIBILITY);
    }
    if (item.refuted) {
      credibility = clamp01(credibility - REFUTE_CREDIBILITY);
      suspicion = clamp01(suspicion + REFUTE_SUSPICION);
    }

    // Unverifiable (neither confirmed nor refuted): adopt when the running
    // credibility meets the doctrine threshold.
    if (!item.confirmed && !item.refuted && credibility >= threshold) {
      const result = adoptBelief(next, item.prop);
      next = result.beliefs;
      if (result.adopted) {
        adopted.push(item.prop);
        if (item.channel !== undefined) {
          next = markChannelCompromised(next, item.channel);
          if (!compromisedChannels.includes(item.channel)) {
            compromisedChannels.push(item.channel);
          }
        }
        events.push({
          id: feedEventId(at, seq),
          at,
          visibility: 'hidden',
          kind: 'belief-adopted',
          prop: item.prop,
        });
        seq += 1;
      }
    }
  }

  // Commit the day's credibility and suspicion for the agent.
  next = {
    ...next,
    credibility: { ...next.credibility, [agent]: credibility },
    agentSuspicion: { ...next.agentSuspicion, [agent]: suspicion },
  };

  return { beliefs: next, classes, adopted, compromisedChannels, events };
}

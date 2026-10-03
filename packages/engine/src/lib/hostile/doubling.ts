/**
 * Doubling the player's Assets and the Chickenfeed a doubled Asset feeds back
 * (design, "Hostile Service AI"; Requirements 11.3, 11.4, 11.5).
 *
 * When the daily detection check (`./detection.ts`, task 19.1) answers a hit
 * with the `double` response, the service quietly flips one of the player's
 * Assets: the Asset's ground-truth `Relationship.hostileControlled` becomes
 * true (design, `AssetProfile.hostileControlled: Truth<boolean>`). From then on
 * the Asset still *appears* to report to the player, but its reports are
 * replaced by the service's feed selection — a mix of verifiable **Chickenfeed**
 * (low-value true information, to keep the player's trust) and deception (design,
 * "Asset reporting": "If `hostileControlled`, the results are replaced by the
 * Hostile Service's feed selection (Chickenfeed and deception per doctrine)").
 *
 * ## The leaf is Relationship-free (19.1's pattern)
 *
 * The `Relationship` / `AssetProfile` model is owned by the Turn Pipeline, and
 * task 19.1 deliberately kept this leaf out of it: the daily tick emits a hidden
 * `asset-doubled` event and marks the Asset suspected, and the ground-truth
 * `hostileControlled` flip "is applied by the Turn Pipeline / task 19.5 from
 * this decision". So this module does NOT reach into the Relationship. It
 * returns the decision as data:
 *
 * - {@link DoublingDecision} — the Asset to flip (`npc`), carrying the
 *   `hostileControlled := true` intent the pipeline applies, and the
 *   {@link Chickenfeed} the newly-doubled Asset should feed back on its next
 *   report. The pipeline (19.5 / recruitment) applies the flip and queues the
 *   feed; the leaf stays pure and testable.
 *
 * ## Chickenfeed selection (Req 11.4, 11.5)
 *
 * Chickenfeed is low-value *true* information: a Proposition that holds in the
 * Truth Store at delivery (design, "Feed ingestion": classification is
 * `chickenfeed` when `truth.holds(p, deliveryTime)`). This leaf does not own the
 * Truth Store, so the caller projects the Asset's reportable true Propositions
 * (its access slice) in as {@link ChickenfeedCandidate}s; {@link selectChickenfeed}
 * picks a doctrine-sized, deterministic subset to pass back. A service with a
 * higher `deceptionAppetite` is willing to spend more genuine Chickenfeed to buy
 * the player's trust, so the count scales with it (capped at the design's
 * three-item feed limit and the candidate pool).
 *
 * ## Determinism / purity
 *
 * No draws: candidates arrive id-sorted (or are sorted here) and the selection
 * is a prefix of a stable order, so the same doctrine and candidate pool always
 * yield the same Chickenfeed. {@link decideDoubling} is a pure function of its
 * inputs (Requirement 1.2). The leaf imports only the core model and the
 * doctrine type, staying Relationship-free and Action-Resolver-free.
 */

import type { NpcId, Proposition } from '../model/core.js';
import type { Doctrine } from './doctrine.js';

// ---------------------------------------------------------------------------
// Chickenfeed selection (Req 11.4, 11.5)
// ---------------------------------------------------------------------------

/**
 * One reportable true Proposition the caller projects as a Chickenfeed
 * candidate: a fact within the doubled Asset's access that holds in the Truth
 * Store at delivery, so passing it back is genuine low-value information. The
 * caller (Turn Pipeline / recruitment) derives these from the Asset's access
 * slice; this leaf only picks among them.
 */
export interface ChickenfeedCandidate {
  /** A true Proposition the doubled Asset could genuinely report. */
  readonly prop: Proposition;
}

/** The Chickenfeed a doubled Asset feeds back: a doctrine-sized true subset. */
export interface Chickenfeed {
  /** The true Propositions selected to pass back, id-stable order, 0–3 items. */
  readonly props: readonly Proposition[];
}

/** The design's hard cap on items a single feed carries (Req 37, feed limit). */
export const MAX_CHICKENFEED_ITEMS = 3;

/**
 * The number of Chickenfeed items a service is willing to spend given its
 * doctrine: `1 + round(deceptionAppetite × (MAX − 1))`, so a low-deception
 * service passes a single token true fact and a high-deception service passes up
 * to {@link MAX_CHICKENFEED_ITEMS}. Pure. The result is clamped to the
 * candidate-pool size by {@link selectChickenfeed}.
 */
export function chickenfeedCount(doctrine: Doctrine): number {
  const scaled = 1 + Math.round(doctrine.deceptionAppetite * (MAX_CHICKENFEED_ITEMS - 1));
  return Math.min(MAX_CHICKENFEED_ITEMS, Math.max(1, scaled));
}

/**
 * The id-stable sort key for a candidate: its Proposition id, so the selection
 * is a deterministic prefix regardless of the caller's candidate order.
 */
function candidateKey(candidate: ChickenfeedCandidate): string {
  return candidate.prop.id;
}

/**
 * Select the Chickenfeed a newly-doubled Asset feeds back (Req 11.4, 11.5).
 * Pure, no draws. The candidates are sorted by Proposition id and the first
 * {@link chickenfeedCount} are taken — low-value true information the service
 * spends to keep the player's trust. With fewer candidates than the doctrine
 * count, all candidates are returned; with none, the feed is empty.
 *
 * Chickenfeed is only the *true* half of a doubled Asset's reporting; the
 * deception half (false Propositions composed to mislead) is the feed path's
 * (task 19.6 `ingestFeed` / recruitment's feed selection). This leaf picks the
 * genuine Chickenfeed; the pipeline composes the rest per doctrine.
 */
export function selectChickenfeed(
  doctrine: Doctrine,
  candidates: readonly ChickenfeedCandidate[],
): Chickenfeed {
  const count = chickenfeedCount(doctrine);
  const sorted = [...candidates].sort((a, b) =>
    candidateKey(a) < candidateKey(b) ? -1 : candidateKey(a) > candidateKey(b) ? 1 : 0,
  );
  const props = sorted.slice(0, count).map((c) => c.prop);
  return { props };
}

// ---------------------------------------------------------------------------
// The doubling decision
// ---------------------------------------------------------------------------

/**
 * The decision to double one of the player's Assets, returned as data for the
 * Turn Pipeline to apply (the leaf is Relationship-free; Req 11.3). It names the
 * Asset to flip and carries the Chickenfeed the newly-doubled Asset should feed
 * back on its next report. The pipeline sets the Asset's
 * `Relationship.hostileControlled := true` and queues the feed; `hostileControlled`
 * is always `true` here (a {@link DoublingDecision} *is* the flip).
 */
export interface DoublingDecision {
  /** The player's Asset the service doubles. */
  readonly npc: NpcId;
  /** The ground-truth flip the pipeline applies: `hostileControlled := true`. */
  readonly hostileControlled: true;
  /** The Chickenfeed the newly-doubled Asset feeds back on its next report. */
  readonly chickenfeed: Chickenfeed;
}

/**
 * Decide the doubling of a detected Asset (Req 11.3, 11.4, 11.5). Pure, no
 * draws. Given the Asset the detection check chose to `double`, the service's
 * doctrine and the Asset's reportable true Propositions (projected in by the
 * caller), it returns the {@link DoublingDecision}: the `hostileControlled`
 * flip intent and the {@link selectChickenfeed} the doubled Asset passes back.
 *
 * The caller runs this once per `double` detection (the daily tick, task 19.2
 * seam), appends the decision for the Turn Pipeline to apply, and emits the
 * hidden `asset-doubled` event (which task 19.1 already does). The doubling
 * itself is free of any direct player signal (design, Req 39.4: "keep doubling
 * free of any direct signal") — the decision carries no player-visible event.
 */
export function decideDoubling(
  npc: NpcId,
  doctrine: Doctrine,
  candidates: readonly ChickenfeedCandidate[],
): DoublingDecision {
  return {
    npc,
    hostileControlled: true,
    chickenfeed: selectChickenfeed(doctrine, candidates),
  };
}

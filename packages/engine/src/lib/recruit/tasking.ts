/**
 * Asset tasking: the four tasks a running Asset can be given, and the pure
 * `runAssetTask` that resolves one (design, "Recruitment"; Requirements 10.3,
 * 10.4, 10.6, 22.6).
 *
 * Once a pitch succeeds the NPC becomes an Asset (Req 10.3) the player can task
 * to **collect** on a target, **introduce** another NPC, **service** a dead drop,
 * or **plant** information. This module owns the {@link AssetTask} union — the
 * real shape the Action union's `task` payload uses — and `runAssetTask`, which
 * dispatches a task against ground truth and returns an {@link AssetTaskResult}
 * filtered through the Asset's access and reliability (Req 10.4).
 *
 * Each task is a thin, pure resolver:
 *
 * - **collect(target).** Reports candidate ground-truth facts through the
 *   Asset's {@link AssetProfile} using {@link reportFacts} (design, "Asset
 *   reporting"; Req 10.4, 10.6). The candidates — "truth facts since the last
 *   report" — are supplied by the caller (the `task` action draws them from the
 *   Truth Store); the `target` narrows the Journal label, not the access filter,
 *   which the design keys on the profile's reach.
 * - **introduce(target).** Creates a Contact Channel to the target and seeds the
 *   target's starting trust from the introducer's trust (design: "Contact
 *   Channel plus inherited trust"; Req 22.6). The inherited trust is a fraction
 *   ({@link INTRODUCTION_TRUST_SHARE}) of the introducer's trust with the Asset,
 *   so a warmer Asset makes a warmer introduction.
 * - **service(drop, items?).** Hands the Asset a dead drop to service on the
 *   player's behalf: it reports the items it collected from the drop (filtered
 *   like a collect) and carries the player's left items into it. The Asset task
 *   returns the *intent* (what was lifted, what to leave); the `task` action
 *   (`../action/task.ts`) applies it to the drop, so a courier Asset keeps the
 *   player off the drop.
 * - **plant(prop).** Injects a Proposition into the world through the Asset — a
 *   false lead left where the opposition will find it. The task returns the
 *   planted Proposition and whether the Asset actually placed it (reliability:
 *   an unreliable Asset may muff the plant); the `task` action schedules a
 *   placed plant for the Hostile Service to adopt. A plant is never written to
 *   the Truth Store: planting a lead does not make it true.
 *
 * Every task, whatever its kind or outcome, adds {@link TASKING_EXPOSURE} to the
 * tasked Asset's Exposure (slice-integration Req 10.7); the `task` action
 * applies it.
 *
 * Everything is pure and deterministic: the only randomness is drawn from the
 * passed {@link Prng}, in a fixed per-task order, so a seed fully determines a
 * task's result. The module imports only the model core, the PRNG and the
 * sibling `asset.ts` — never the Action Resolver — so it stays a leaf.
 */

import {
  revealTruth,
  type DeadDropId,
  type LocId,
  type NpcId,
  type Proposition,
  type Truth,
  type UnkId,
} from '../model/core.js';
import type { Prng } from '../prng/prng.js';
import {
  reportFacts,
  type AssetProfile,
  type OrgMembershipLookup,
  type Relationship,
} from './asset.js';

// ---------------------------------------------------------------------------
// The AssetTask union (design: AssetTask; Req 10.3)
// ---------------------------------------------------------------------------

/**
 * Gather intelligence on a target (reports through access + reliability). The
 * target is a named NPC or an Unidentified Subject the player has sighted (an
 * `unk:` id): an Asset asked "who is this?" reports on them like anyone else,
 * and naming them in the report identifies them.
 */
export interface CollectTask {
  readonly kind: 'collect';
  readonly target: NpcId | UnkId;
}

/** Introduce another NPC: mint a Contact Channel and inherit trust (Req 22.6). */
export interface IntroduceTask {
  readonly kind: 'introduce';
  readonly target: NpcId;
}

/** Service a dead drop on the player's behalf: lift its contents, leave items. */
export interface ServiceTask {
  readonly kind: 'service';
  readonly drop: DeadDropId;
  /** Items the Asset is to leave in the drop (ids, resolved by the caller). */
  readonly leave?: readonly string[];
}

/** Plant a Proposition in the world through the Asset (a false lead). */
export interface PlantTask {
  readonly kind: 'plant';
  readonly prop: Proposition;
  /** Where the plant is placed, when it needs a Location (optional). */
  readonly at?: LocId;
}

/**
 * A task handed to an Asset (design: `AssetTask`; Req 10.3). The four kinds the
 * design names: collect on a target, introduce another NPC, service a dead drop,
 * or plant information.
 */
export type AssetTask = CollectTask | IntroduceTask | ServiceTask | PlantTask;

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

/**
 * The fraction of the introducer's trust the introduced NPC starts with (design:
 * "a starting trust derived from the introducer's trust"; Req 22.6). A warm
 * Asset (trust 1) introduces at `INTRODUCTION_TRUST_SHARE`; a cold one at near
 * zero. Below 1 so an introduction never hands over the introducer's full
 * rapport.
 */
export const INTRODUCTION_TRUST_SHARE = 0.5;

/**
 * The tasking risk: the Exposure every Asset task adds to the tasked Asset's
 * `Relationship.exposure` (slice-integration Req 10.7; the "tasking risk" the
 * Hostile Service's Exposure mirror grows from, slice Req 12.1). An engine
 * constant rather than a Difficulty Preset field, so tasking needs no content
 * schema change.
 *
 * It is half the Exposure a meeting at a risk-0.5 Location adds under the
 * default `exposure` weights. A meeting adds
 * `k1·loc.risk + k2·crowdPenalty + k3·recentContacts`
 * (`meetingExposure` in `../action/arrange-meeting.ts`), where the crowd
 * penalty is proxied by the Location's risk (`crowdPenaltyProxy`) and a
 * reference meeting has no recent contacts. The default weights are the ones
 * the shipped `config/scenario.yaml` sets (k1 = 0.6, k2 = 0.4, k3 = 0.3), so:
 *
 * ```
 * meeting          = 0.6 × 0.5 + 0.4 × 0.5 + 0.3 × 0 = 0.5
 * TASKING_EXPOSURE = 0.5 × meeting                    = 0.25
 * ```
 *
 * `tasking.spec.ts` pins this value against the shipped weights and the
 * meeting formula, so a change to either fails a test rather than drifting.
 */
export const TASKING_EXPOSURE = 0.25;

// ---------------------------------------------------------------------------
// Per-task result shapes
// ---------------------------------------------------------------------------

/** A `collect` result: the Propositions the Asset reported (Req 10.4). */
export interface CollectResult {
  readonly kind: 'collect';
  readonly target: NpcId | UnkId;
  readonly reported: readonly Proposition[];
}

/** An `introduce` result: the new Contact Channel and the target's start trust. */
export interface IntroduceResult {
  readonly kind: 'introduce';
  readonly target: NpcId;
  /** The Contact Channel to mint (the target becomes reachable). */
  readonly channel: true;
  /** The starting trust the target gets, inherited from the introducer. */
  readonly inheritedTrust: number;
}

/** A `service` result: what the courier lifted and what it is to leave. */
export interface ServiceResult {
  readonly kind: 'service';
  readonly drop: DeadDropId;
  /** Propositions the Asset reported from the drop's contents (filtered). */
  readonly collected: readonly Proposition[];
  /** The item ids the Asset carries into the drop. */
  readonly left: readonly string[];
}

/** A `plant` result: the planted Proposition and whether it was placed. */
export interface PlantResult {
  readonly kind: 'plant';
  readonly prop: Proposition;
  readonly at?: LocId;
  /** `false` when an unreliable Asset failed to place the plant. */
  readonly placed: boolean;
}

/** The result of resolving one {@link AssetTask} (design, "Recruitment"). */
export type AssetTaskResult =
  | CollectResult
  | IntroduceResult
  | ServiceResult
  | PlantResult;

// ---------------------------------------------------------------------------
// The inputs a task reads
// ---------------------------------------------------------------------------

/**
 * The context a tasked Asset resolves against. `rel` is the player↔Asset
 * relationship (its `asset` profile must be present — the caller gates on
 * {@link isAsset}); `candidates` are the ground-truth facts the Turn Pipeline
 * offers for a `collect`/`service` report (facts since the last report, as the
 * design describes); `dropContents` are the facts asserted by the drop's current
 * contents for a `service`; `isMemberOfOrg` is the membership seam
 * {@link reportFacts} uses for the `access.orgs` branch.
 */
export interface AssetTaskContext {
  readonly rel: Relationship;
  readonly candidates?: readonly Truth<Proposition>[];
  readonly dropContents?: readonly Truth<Proposition>[];
  readonly isMemberOfOrg?: OrgMembershipLookup;
  /**
   * Affinity of an ambient tie between the asset and an introduce target.
   * Omitted means no tie, so the inherited trust is the slice share alone.
   */
  readonly tieAffinity?: number;
}

const NO_MEMBERSHIP: OrgMembershipLookup = () => false;

// ---------------------------------------------------------------------------
// runAssetTask (design: the `task` action; Req 10.3, 10.4, 22.6)
// ---------------------------------------------------------------------------

/**
 * Resolve one Asset task against ground truth (design, "Recruitment": the
 * tasking primitive; Req 10.3, 10.4, 10.6, 22.6). Pure and deterministic against
 * the passed {@link Prng}; the result is the *intent* the Turn Pipeline applies
 * (mint a channel, write a report as Claims, service the drop, plant the lead),
 * never a mutated world.
 *
 * The Asset's {@link AssetProfile} comes from `ctx.rel.asset`; the caller must
 * have gated on the relationship being a running Asset, so a missing profile is
 * a programming error and throws.
 */
export function runAssetTask(
  task: AssetTask,
  ctx: AssetTaskContext,
  rng: Prng,
): AssetTaskResult {
  const profile = ctx.rel.asset;
  if (profile === undefined) {
    throw new Error('runAssetTask: relationship is not a running Asset');
  }
  const isMemberOfOrg = ctx.isMemberOfOrg ?? NO_MEMBERSHIP;

  switch (task.kind) {
    case 'collect':
      return resolveCollect(task, ctx.candidates ?? [], profile, isMemberOfOrg, rng);
    case 'introduce':
      return resolveIntroduce(task, ctx.rel, ctx.tieAffinity);
    case 'service':
      return resolveService(task, ctx.dropContents ?? [], profile, isMemberOfOrg, rng);
    case 'plant':
      return resolvePlant(task, profile, rng);
  }
}

/**
 * `collect`: report the candidate facts through the Asset's access and
 * reliability ({@link reportFacts}; Req 10.4, 10.6). The `target` labels the
 * report; the access filter is the profile's reach, as the design keys it.
 */
function resolveCollect(
  task: CollectTask,
  candidates: readonly Truth<Proposition>[],
  profile: AssetProfile,
  isMemberOfOrg: OrgMembershipLookup,
  rng: Prng,
): CollectResult {
  const reported = reportFacts(candidates, profile, isMemberOfOrg, rng);
  return { kind: 'collect', target: task.target, reported };
}

/**
 * `introduce`: mint a Contact Channel to the target and derive its starting
 * trust from the introducer's trust (design: "Contact Channel plus inherited
 * trust"; Req 22.6). The inherited trust is {@link INTRODUCTION_TRUST_SHARE} of
 * the introducer's current trust, clamped to `[0, 1]`.
 */
function resolveIntroduce(task: IntroduceTask, rel: Relationship, tieAffinity?: number): IntroduceResult {
  const bonus = tieAffinity === undefined ? 0 : Math.min(0.2, Math.max(0, tieAffinity) * 0.2);
  const inheritedTrust = clamp01(rel.trust * INTRODUCTION_TRUST_SHARE + bonus);
  return { kind: 'introduce', target: task.target, channel: true, inheritedTrust };
}

/**
 * `service`: report what the Asset lifted from the drop (filtered like a
 * collect) and carry the player's left items in (design, "Service dead drop" —
 * delivered through a courier Asset rather than the player's own visit). The
 * physical drop mutation lives in the `service-drop` action; this returns the
 * intent.
 */
function resolveService(
  task: ServiceTask,
  dropContents: readonly Truth<Proposition>[],
  profile: AssetProfile,
  isMemberOfOrg: OrgMembershipLookup,
  rng: Prng,
): ServiceResult {
  const collected = reportFacts(dropContents, profile, isMemberOfOrg, rng);
  return {
    kind: 'service',
    drop: task.drop,
    collected,
    left: task.leave ?? [],
  };
}

/**
 * `plant`: place a Proposition in the world through the Asset. Placement
 * succeeds with probability `reliability` (an unreliable Asset may muff the
 * plant); the single draw keeps the task deterministic.
 */
function resolvePlant(task: PlantTask, profile: AssetProfile, rng: Prng): PlantResult {
  const reliability = clamp01(revealTruth(profile.reliability));
  const placed = rng.next() < reliability;
  return { kind: 'plant', prop: task.prop, at: task.at, placed };
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function clamp01(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

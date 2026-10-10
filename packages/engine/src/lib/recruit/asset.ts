/**
 * The player↔NPC Relationship, the Asset status model, and Asset reporting
 * (design, "Recruitment and Relationships": `Relationship`, `AssetProfile`;
 * design, "Asset reporting"; Requirements 10.3, 10.4, 10.6).
 *
 * This module owns the real {@link Relationship} and {@link AssetProfile} shapes
 * — the ones the design's Recruitment section writes — that replace the
 * `Skeleton<'Relationship'>` placeholder in `../model/state.ts`, together with
 * the pure {@link reportFacts} that turns ground truth into an Asset's filtered,
 * reliability-distorted report (Req 10.6) and the small status helpers the
 * People view's "Asset status" reads.
 *
 * A `Relationship` tracks what the player has built with one NPC: trust,
 * suspicion and Exposure (the three terms `resolvePitch` reads), whether the NPC
 * is recruited (an Asset), the contact tally and last-contact time, whether a
 * Contact Channel exists, the cover state, an optional retainer and — once
 * recruited — an {@link AssetProfile}. The truth-bearing fields of the profile
 * (its `access`, `reliability` and `hostileControlled`) are branded `Truth` so
 * the type system refuses to leak them into the Player View (Req 2.1); `turned`
 * is view-safe because the player always knows whether *they* turned an agent.
 *
 * ## Asset reporting (design, "Asset reporting"; Req 10.4, 10.6)
 *
 * A `collect` task gathers candidate ground-truth facts and reports a filtered,
 * lossy subset of them (Req 10.4 — results come from ground truth, filtered
 * through the Asset's access and reliability). {@link reportFacts} is the pure
 * core of that:
 *
 * 1. **Access filter (Req 10.6).** A candidate is in access when its subject or
 *    object is in `access.npcs`, its `place` is in `access.locs`, or its subject
 *    is a member of an org in `access.orgs`. Membership is not something a leaf
 *    can read from a `Proposition` alone, so the caller injects an
 *    `isMemberOfOrg(subject, org)` predicate (the Turn Pipeline fills it from
 *    the Truth Store); with no org access the predicate is never consulted.
 * 2. **Reliability (Req 10.6).** Each in-access candidate is *reported* with
 *    probability `reliability` (omissions grow as reliability falls). A reported
 *    candidate is *distorted* with probability `(1 − reliability) × 0.5` using a
 *    Rumour-style distortion operator (a swapped subject), so a low-reliability
 *    Asset both omits and garbles.
 * 3. **Cap.** At most {@link MAX_REPORTED_PROPS} (3) Propositions are returned.
 *
 * The report is a list of plain {@link Proposition}s (the Truth brand dropped —
 * the Sim has decided these may surface). The caller turns them into Case File
 * Claims with source `npc` (that model is a later task). The hostile-controlled
 * feed replacement the design notes for a doubled Asset is left to the Hostile
 * Service task; {@link reportFacts} reports honestly from the given access, and
 * exposes `hostileControlled` on the profile so that caller can intercept.
 *
 * Everything here is pure and deterministic: the only randomness is drawn from
 * the passed {@link Prng}, in a fixed order, so a seed fully determines a report.
 */

import { asTruth, revealTruth, timeToPhases, type EntityId, type LocId, type NpcId, type OrgId, type Proposition, type Truth } from '../model/core.js';
import type { GameTime } from '../model/core.js';
import type { Prng } from '../prng/prng.js';
import type { Npc } from '../city/npc.js';

// ---------------------------------------------------------------------------
// MICE lever (Req 10.1)
// ---------------------------------------------------------------------------

/**
 * A MICE recruitment lever: the axis a pitch presses on (Glossary, MICE). The
 * same four levers the hidden {@link import('../city/npc.js').MiceProfile}
 * carries. Owned here (the recruitment leaf) and re-exported for the Action
 * union's `pitch`/`turn-agent` payloads.
 */
export type MiceLever = 'money' | 'ideology' | 'coercion' | 'ego';

/** The four MICE levers, in profile order. */
export const MICE_LEVERS: readonly MiceLever[] = [
  'money',
  'ideology',
  'coercion',
  'ego',
];

// ---------------------------------------------------------------------------
// Cover state (shared with pressureCheck, task 18.3)
// ---------------------------------------------------------------------------

/**
 * The player's cover state with respect to one NPC (design: `coverState`). It
 * degrades `intact → strained → cracking → blown` as pressure mounts; the
 * transitions themselves are task 18.3's `pressureCheck`. Declared here because
 * it is a field of the {@link Relationship}.
 */
export const COVER_STATES = ['intact', 'strained', 'cracking', 'blown'] as const;

/** One cover state. */
export type CoverState = (typeof COVER_STATES)[number];

// ---------------------------------------------------------------------------
// AssetProfile (design: AssetProfile; Req 10.6)
// ---------------------------------------------------------------------------

/**
 * The set of entities an Asset can report on (design: `AssetProfile.access`).
 * Drawn from the NPC's workplace, schedule and acquaintances. A candidate fact
 * is in access when its subject or object is one of `npcs`, its place is one of
 * `locs`, or its subject is a member of one of `orgs`.
 */
export interface AssetAccess {
  readonly locs: readonly LocId[];
  readonly orgs: readonly OrgId[];
  readonly npcs: readonly NpcId[];
}

/**
 * An Asset's profile (design: `AssetProfile`; Req 10.6). `access` is the entity
 * reach above; `reliability` in `[0, 1]` sets the report/distortion rates;
 * `turned` says the player turned a hostile agent (view-safe — the player knows
 * it); `hostileControlled` says the Hostile Service has quietly doubled this
 * Asset (ground truth the player must discover). A turned agent's `access.orgs`
 * includes its hostile org (set by the turn, task 18.6).
 */
export interface AssetProfile {
  /** Ground truth: the Locations, orgs and persons the Asset can report on. */
  readonly access: Truth<AssetAccess>;
  /** Ground truth: report reliability in `[0, 1]`. */
  readonly reliability: Truth<number>;
  /** View-safe: the player turned this (formerly hostile) agent. */
  readonly turned: boolean;
  /** Ground truth: quietly doubled by the Hostile Service. */
  readonly hostileControlled: Truth<boolean>;
}

// ---------------------------------------------------------------------------
// Relationship (design: Relationship; Req 10.3)
// ---------------------------------------------------------------------------

/**
 * A retainer owed to a money-motivated Asset (design: `Relationship.retainer`).
 * `amount` is the weekly figure; `paidThrough` is the time it is paid up to. The
 * retainer accrual/decay is task 18.2; this is the shape it reads.
 */
export interface Retainer {
  readonly amount: number;
  readonly paidThrough: GameTime;
}

/**
 * A spell in Custody (design: `Npc.custody`): the Station (or the Hostile
 * Service) is holding the NPC. `by` says who holds them, `since` is when the
 * hold began, and `until` is when Station Custody ends — after `custodyPhases`
 * the NPC is handed over and can no longer be turned (design, "Turning";
 * Req 36.1, 36.7). The design hangs this off the NPC; the engine tracks it on
 * the player↔NPC {@link Relationship} (the recruitment leaf's own state), where
 * the turn-agent eligibility and the custody-release penalty read it, so no
 * cross-cutting change to the shared `Npc` shape is needed. A relationship with
 * no `custody` means the NPC is at liberty.
 */
export interface Custody {
  readonly by: 'station' | 'hostile';
  readonly since: GameTime;
  readonly until?: GameTime;
}

/**
 * The player's relationship with one NPC (design: `Relationship`). `trust`,
 * `suspicion` and `exposure` are the state the recruitment, meeting and
 * detection maths read and move; `recruited` flips true when a pitch succeeds
 * (the NPC becomes an Asset, Req 10.3) and `asset` is then present; `channel`
 * is whether a Contact Channel exists; `coverState` is the player's cover with
 * this NPC. All non-truth fields are view-adjacent (the player sees a rapport
 * band from trust and an Asset status, never the raw numbers or suspicion).
 */
export interface Relationship {
  readonly npc: NpcId;
  readonly trust: number;
  readonly suspicion: number;
  readonly exposure: number;
  readonly recruited: boolean;
  readonly contacts: number;
  readonly lastContact?: GameTime;
  /**
   * When the Asset last reported through a `collect` task. A `collect` reports
   * the facts since this time and then sets it to the task's time
   * (slice-integration Req 10.3). Absent until the Asset's first report.
   */
  readonly lastReport?: GameTime;
  /**
   * Set once `asset-silent` has been raised for the Asset's current silence, so
   * the Phase Step raises it once per silence rather than every phase
   * (slice-integration Req 1.8). Absent while no silence has been reported.
   */
  readonly silenceNotified?: boolean;
  readonly channel: boolean;
  readonly coverState: CoverState;
  readonly retainer?: Retainer;
  readonly asset?: AssetProfile;
  /**
   * The NPC's current Station/Hostile Custody, if any (design: `Npc.custody`).
   * Present while the NPC is held; the turn-agent action reads it for the
   * `custody` leverage and the custody-release suspicion penalty (Req 36.1,
   * 36.7). Absent means the NPC is at liberty.
   */
  readonly custody?: Custody;
  /** Set when an exfiltration resettles the Asset. Detection no longer tracks them. */
  readonly resettled?: boolean;
  /**
   * The visitor is at `loc` for this day only, waiting to be seen. Set when
   * someone walks into the Station. The next day they go back to their own
   * schedule.
   */
  readonly callingAt?: { readonly loc: LocId; readonly day: number };
  /**
   * How many different days the player has spent developing this person.
   * A pitch is not heard until this reaches {@link MEETINGS_BEFORE_PITCH}.
   */
  readonly meetings?: number;
  /** The day of the latest development meeting. Further talk that day does not add another. */
  readonly lastMeetingDay?: number;
  /**
   * Headquarters has answered a trace and approved a pitch. Set only after
   * enough development meetings. The hidden motive profile is never copied here.
   */
  readonly pitchApproved?: boolean;
  /**
   * The standing time the player agreed with a recruited agent. View-safe:
   * a weekday, a phase, and a place the player already knows.
   */
  readonly standing?: {
    readonly weekday: string;
    readonly phase: 0 | 1 | 2 | 3;
    readonly at: LocId;
  };
}

/** Meetings on different days before headquarters will hear a pitch. */
export const MEETINGS_BEFORE_PITCH = 3;

/**
 * What the player can be told about a recruitment in progress. Absent when
 * there is nothing to say. It never includes the hidden motive profile.
 */
export function recruitmentProgress(rel: Relationship | undefined): string | undefined {
  if (rel === undefined || rel.recruited) {
    return undefined;
  }
  if (rel.pitchApproved === true) {
    return 'Headquarters has approved a pitch.';
  }
  const meetings = rel.meetings ?? 0;
  if (meetings <= 0) {
    return undefined;
  }
  if (meetings < MEETINGS_BEFORE_PITCH) {
    return `Met on ${meetings} of ${MEETINGS_BEFORE_PITCH} days. A pitch waits on more meetings and a trace.`;
  }
  return 'Met often enough. Cable headquarters for a trace before a pitch.';
}

/** Where a visitor is waiting today, if they walked in on this day. */
export function callingPlace(rel: Relationship | undefined, day: number): LocId | undefined {
  if (rel?.callingAt !== undefined && rel.callingAt.day === day) {
    return rel.callingAt.loc;
  }
  return undefined;
}

/**
 * A fresh, unrecruited relationship with an NPC at neutral trust and no
 * contact, suspicion or Exposure. The starting point before any pitch; the
 * caller sets `channel`/`trust` for a Starting-Brief contact.
 */
export function newRelationship(npc: NpcId): Relationship {
  return {
    npc,
    trust: 0,
    suspicion: 0,
    exposure: 0,
    recruited: false,
    contacts: 0,
    channel: false,
    coverState: 'intact',
  };
}

// ---------------------------------------------------------------------------
// Minting an Asset profile (Req 10.3, 10.6)
// ---------------------------------------------------------------------------

/**
 * Mint the {@link AssetProfile} of an NPC a pitch has just recruited (design,
 * "Recruitment and Relationships": access comes "from workplace, schedule and
 * acquaintances" and reliability "from archetype and persona"; Req 10.3, 10.6).
 * The dialogue turn calls it when a pitch lands (slice-integration Req 15.6).
 * Pure and drawless.
 *
 * The access is read from the NPC records in the World State:
 *
 * - `locs`: every Location in the NPC's schedule (the workplace included): an
 *   Asset can report what is known to happen at the places they frequent.
 * - `orgs`: the organisation the NPC truly serves, so an insider (a turned
 *   Cell member, a Station staffer) reports on their own side's business.
 * - `npcs`: the NPC themself. An Asset does not know the private plans of the
 *   people they merely share a café with; what they see of those people comes
 *   from the events they witness on their routine (`witnessedFacts`).
 *
 * Each list is sorted, so the profile depends only on the NPC records.
 * `reliability` is the NPC's own sampled reliability. A pitched Asset is not
 * `turned` (only the turn-agent action turns an agent) and starts honest:
 * `hostileControlled` becomes true only when the Hostile Service doubles the
 * Asset.
 *
 * @param npc the NPC who accepted the pitch.
 * @param population every NPC in the world (`WorldState.npcs`); unused since
 *   acquaintances no longer widen access, kept so callers need not change.
 */
export function assetProfileFor(
  npc: Npc,
  population: Readonly<Record<NpcId, Npc>>,
): AssetProfile {
  void population;
  const locs = new Set<LocId>(npc.schedule.entries.map((entry) => entry.loc));
  return {
    access: asTruth({
      locs: [...locs].sort(),
      orgs: [revealTruth(npc.trueAllegiance).org],
      npcs: [npc.id],
    }),
    reliability: npc.reliability,
    turned: false,
    hostileControlled: asTruth(false),
  };
}


// ---------------------------------------------------------------------------
// Asset status (People view's "Asset status")
// ---------------------------------------------------------------------------

/**
 * The Asset status the People view shows for an NPC (design, "People view":
 * "Asset status"). A relationship is `none` until recruited; a recruited NPC is
 * a `turned` double, a `recruited` plain Asset, otherwise. `hostileControlled`
 * is *not* surfaced — the player must discover a doubled Asset — so it never
 * changes this status.
 */
export type AssetStatus = 'none' | 'recruited' | 'turned';

/** The {@link AssetStatus} the People view shows for a relationship. */
export function assetStatus(rel: Relationship): AssetStatus {
  if (!rel.recruited || rel.asset === undefined) {
    return 'none';
  }
  return rel.asset.turned ? 'turned' : 'recruited';
}

/** Whether an NPC is a running Asset (recruited with a profile). */
export function isAsset(rel: Relationship): boolean {
  return rel.recruited && rel.asset !== undefined;
}

/**
 * Whether the NPC is currently in **Station** Custody as of `now` (design,
 * "Turning"; Req 36.1). True when a Station custody hold is recorded and `now`
 * is before its `until` hand-over time (or no `until` is set yet — the hold is
 * open). A Hostile hold, or a Station hold whose `until` has passed (the NPC has
 * been handed over and can no longer be turned), is not Station Custody. Pure in
 * the relationship and the time, so a quote can read it without a draw.
 */
export function inStationCustody(rel: Relationship, now: GameTime): boolean {
  const custody = rel.custody;
  if (custody === undefined || custody.by !== 'station') {
    return false;
  }
  if (custody.until === undefined) {
    return true;
  }
  return timeToPhases(now) < timeToPhases(custody.until);
}

// ---------------------------------------------------------------------------
// Asset reporting (design: "Asset reporting"; Req 10.4, 10.6)
// ---------------------------------------------------------------------------

/** The most Propositions one Asset report returns (design: "At most 3"). */
export const MAX_REPORTED_PROPS = 3;

/** The distortion-rate factor: distort with `(1 − reliability) × DISTORT_FACTOR`. */
export const DISTORT_FACTOR = 0.5;

/**
 * The membership seam {@link reportFacts} uses for the `access.orgs` branch: is
 * `subject` a member of `org`? The Turn Pipeline fills this from the Truth Store
 * (which answers `MEMBER_OF`/`REPORTS_TO` transitively); keeping it an injected
 * predicate lets this module stay a dependency-light leaf. When an Asset has no
 * org access the predicate is never called, so a caller with no membership
 * source can pass a `() => false` stub.
 */
export type OrgMembershipLookup = (subject: EntityId, org: OrgId) => boolean;

/**
 * Whether a candidate fact falls within an Asset's access (design, "Asset
 * reporting"; Req 10.6). True when the fact's subject or object is in
 * `access.npcs`, its `place` is in `access.locs`, or its subject is a member of
 * an org in `access.orgs` (via the injected {@link OrgMembershipLookup}).
 */
export function factInAccess(
  fact: Proposition,
  access: AssetAccess,
  isMemberOfOrg: OrgMembershipLookup,
): boolean {
  const npcs = new Set<EntityId>(access.npcs);
  if (npcs.has(fact.subject)) {
    return true;
  }
  if (typeof fact.object === 'string' && npcs.has(fact.object)) {
    return true;
  }
  if (fact.place !== undefined && access.locs.includes(fact.place)) {
    return true;
  }
  for (const org of access.orgs) {
    if (isMemberOfOrg(fact.subject, org)) {
      return true;
    }
  }
  return false;
}

/**
 * Distort a reported Proposition with a Rumour-style operator (design: "distorted
 * … using a Rumour distortion operator"). The operator swaps the subject for
 * another NPC in the Asset's own access reach (the people it could plausibly
 * confuse), picked from the passed pool with the PRNG. A new id is minted so the
 * distorted report does not collide with the true fact. When no distinct
 * replacement is available the fact is returned unchanged (the distortion simply
 * could not be applied, as the Rumour generator also degrades gracefully).
 */
export function distortProposition(
  fact: Proposition,
  access: AssetAccess,
  rng: Prng,
): Proposition {
  const candidates = access.npcs.filter(
    (id) => id !== fact.subject && id !== fact.object,
  );
  if (candidates.length === 0) {
    return fact;
  }
  const replacement = rng.pick(candidates);
  return {
    ...fact,
    id: `${fact.id}~distort`,
    subject: replacement,
  };
}

/**
 * Turn candidate ground-truth facts into an Asset's report (design, "Asset
 * reporting"; Req 10.4, 10.6). Pure and deterministic against the passed
 * {@link Prng}.
 *
 * Each candidate within the Asset's `access` ({@link factInAccess}) is reported
 * with probability `reliability`; a reported candidate is then distorted with
 * probability `(1 − reliability) × DISTORT_FACTOR` ({@link distortProposition}).
 * At most {@link MAX_REPORTED_PROPS} Propositions are returned. The draws run in
 * candidate order — one report coin, then (on a report) one distortion coin —
 * so the sequence is fully determined by the seed. Out-of-access candidates draw
 * nothing, so an Asset's reach never shifts the stream for facts it cannot see.
 *
 * `reliability` is read with {@link revealTruth} (a Sim decision to surface);
 * the returned Propositions carry no Truth brand because the Sim has decided
 * these may become Claims.
 */
export function reportFacts(
  candidates: readonly Truth<Proposition>[],
  profile: AssetProfile,
  isMemberOfOrg: OrgMembershipLookup,
  rng: Prng,
): Proposition[] {
  const access = revealTruth(profile.access);
  const reliability = clamp01(revealTruth(profile.reliability));
  const distortRate = (1 - reliability) * DISTORT_FACTOR;
  const reported: Proposition[] = [];

  for (const branded of candidates) {
    if (reported.length >= MAX_REPORTED_PROPS) {
      break;
    }
    const fact = revealTruth(branded);
    if (!factInAccess(fact, access, isMemberOfOrg)) {
      continue;
    }
    if (rng.next() >= reliability) {
      continue; // omitted
    }
    const distorted = rng.next() < distortRate;
    reported.push(distorted ? distortProposition(fact, access, rng) : fact);
  }
  return reported;
}

/** Clamp a value to `[0, 1]`. */
function clamp01(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

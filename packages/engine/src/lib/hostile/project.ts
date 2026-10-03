/**
 * The Hostile Full Tick's projection and application (slice-integration
 * design, "Engine: Hostile Full Tick projection and application"; Requirement
 * 3).
 *
 * `dailyTickFull` (`./hostile.ts`) runs the Hostile Service's whole daily
 * pass without touching the World State: every input arrives as a projection
 * ({@link FullTickInputs}) and every effect leaves as data
 * ({@link FullTickResult}). This module is the seam between that pass and the
 * Draft. The `hostileTick` Day-Boundary Hook composes the three steps:
 *
 * ```ts
 * const p = projectFullTick(draft, ctx.time.day, ctx.scratch, ctx.deps);
 * const result = dailyTickFull(p.state, p.candidates, ctx.time, ctx.rng, p.base, p.inputs);
 * return applyFullTick(draft, result, ctx.scratch, ctx);
 * ```
 *
 * ## The projection ({@link projectFullTick})
 *
 * It reads the Draft and the Truth Store and builds every input of the tick:
 *
 * - **`candidates`** — every recruited Relationship whose NPC is in play (not
 *   arrested, fled or held in custody), sorted by NPC id. The Asset's Exposure
 *   reaches detection through the service's Exposure mirror: the projected
 *   state folds each candidate's `Relationship.exposure` into
 *   `beliefs.exposure` with {@link accrueExposure}. The Asset's activity since
 *   the last tick (meetings, drops, tasking) is already in that Exposure,
 *   because the resolvers accrue it per contact, so no separate count is
 *   projected; {@link DetectionCandidate} has no field for one.
 * - **`base`** — `meta.preset.detectionBase`.
 * - **`dayEvents`** — `scratch.dayEvents`, the schedules hook's events.
 * - **`chickenfeed`** — for each candidate with an Asset profile, the Truth
 *   Store facts its next report would draw on (facts since its last report,
 *   {@link factsSinceLastReport}) that fall in its access ({@link factInAccess}),
 *   without the reliability draw.
 * - **`plot`, `adaptation`** — `draft.plot`, with the Station org, the Cell
 *   members (the Plot leader, every bound role holder and every NPC of the
 *   Cell org) and the Plot target.
 * - **`feeds`** — every scheduled hidden `feed-delivered` event due by this
 *   Day Boundary, as a {@link FeedDelivery}. Each fed Proposition is
 *   classified against the Truth Store at its delivery time and checked
 *   against the service's own knowledge: its adopted beliefs and the true
 *   facts about its own people (see {@link fedProposition}).
 * - **`newlyAdopted`** — the Propositions of every scheduled hidden
 *   `belief-plant` event due by this Day Boundary. The projected state adopts
 *   them with {@link adoptBelief}, and the newly held ones feed the tick's
 *   belief-driven adaptation. The `task` action's `plant` schedules these.
 * - **`moleReport`** — when `station.mole` is set and the mole is at liberty,
 *   the mole and `station.reportable` (the Station Knowledge Slice plus what
 *   the Case File summary and sent Cables name, which player-view projects at
 *   each commit).
 * - **`commitments`** — each candidate's `accepted` meetings and the player's
 *   own drops whose `expectedLoader` is the Asset.
 * - **`arrestArticleContext`** — each candidate's last known Location, as the
 *   name of its District.
 * - **`tailing`, `tailingThresholds`** — `player.coverSuspicion` and
 *   `player.tailed`, and {@link tailingThresholds} over the doctrine and
 *   `preset.coverSuspicionBurnThreshold`.
 * - **`plantCandidates`** — one false sighting per Station-known NPC (see
 *   {@link plantCandidatesOf}).
 * - **`commsChannels`** — the Hostile Service's interceptable Channels that
 *   fire on the day, with their firing phases. The service puts no real
 *   payload on them, so each firing carries the decoy Proposition
 *   `produceCommsTraffic` mints.
 *
 * The projection draws nothing and writes nothing. The due `feed-delivered`
 * and `belief-plant` events it delivers are removed from `scheduled` by
 * {@link applyFullTick}, which writes the Draft, using the same test
 * ({@link isDueBy}), so each is ingested exactly once.
 *
 * ## The application ({@link applyFullTick})
 *
 * It writes every field of the {@link FullTickResult} to the Draft:
 *
 * - **`next`** → `hostile` (beliefs, credibility, agent suspicion, adoptions
 *   and compromised Channels), keeping the Draft's own `hostile` fields.
 * - **`asset-arrested` events** → `npcs[npc].status = 'arrested'` and
 *   `relationships[npc].custody = { by: 'hostile', since: at }` with no
 *   `until`.
 * - **`doublings`** → `relationships[npc].asset.hostileControlled = true`, and
 *   the doubling's Chickenfeed into `hostile.chickenfeed[npc]`, the pool the
 *   doubled Asset feeds back from.
 * - **`plot`** → `plot` (adaptation and Abort Pressure).
 * - **`compromisedChannels`** → already in `next.beliefs.compromisedChannels`.
 *   The live Disruption Context reads them there, so the Plot hook disrupts
 *   every stage that runs on them and answers through its existing
 *   delay/reroute/abort path.
 * - **`arrestConsequences`** → the voided meetings become `status: 'void'`.
 *   The voided drops keep `expectedLoader` naming the arrested Asset (see the
 *   deviations below).
 * - **`arrestArticles`, `newspaperPlants`** → appended to the scratch, for the
 *   same day's newspaper hook.
 * - **`tailing`** → `player.tailed` and `player.coverSuspicion`. When the
 *   tick burns the player, or Cover Suspicion is at or above the burn
 *   threshold after it, `player.burned = true`; `detectEnd` then reports the
 *   burned End Condition.
 * - **`commsTraffic`** → each source enciphered with
 *   {@link generateIntercepts} on the runtime stream and appended to
 *   `transmissions` as a {@link Transmission}, which carries its Intercept.
 * - **`feedClasses`** → one {@link FeedLogEntry} per fed agent on
 *   `hostile.feedLog` (debrief only).
 * - **`events`** → the hook's events. Every kind the tick emits is hidden, so
 *   only the consequences above ever reach the player.
 *
 * ## Additions to the design's signatures, and why
 *
 * - The projection reads the Truth Store through `deps.truth`, the turn's
 *   staged Truth Store ({@link AdvanceWorldDeps.truth}), for the Chickenfeed
 *   pools and the feed checks. It reads nothing else from the dependencies,
 *   so its parameter is {@link FullTickProjectionDeps}; a full
 *   {@link AdvanceWorldDeps} satisfies it.
 * - {@link applyFullTick} takes a fourth argument, {@link FullTickApplyContext}:
 *   the tick time (for the delivered events, the custody and the feed log),
 *   the runtime Prng (for the cipher draws of the minted Intercepts) and the
 *   field codes and cipher keys those Intercepts are enciphered with. A
 *   `WorldHookContext` satisfies it, so the hook passes its own context.
 *
 * ## Deviations from the design text, and why
 *
 * - **Comms traffic goes to `transmissions` only.** The design writes it to
 *   `transmissions` and `intercepts`. `WorldState.intercepts` holds what the
 *   player has collected: the intercept action skips any transmission whose
 *   Intercept is already there, and `decrypt` is allowed on anything there.
 *   Writing the Intercept there would hand the player the traffic without an
 *   intercept action, and the intercept action, which Requirement 3.9 says
 *   must collect it, never could. A {@link Transmission} carries its
 *   Intercept, so both are in the Draft.
 * - **Feeds and plants due by the Day Boundary.** The design delivers the
 *   events with `at.day === day`. A feed scheduled for later on the day it was
 *   sent (the turned agent meets the handler that evening) would then never be
 *   delivered, because that day's Day Boundary has already passed. Delivering
 *   every event with `at.day <= day` delivers it at the next Day Boundary and
 *   is identical for every event scheduled on a future day.
 * - **Voided drops keep their `expectedLoader`.** The design clears it. The
 *   Phase Step (`../clock/phase-step.ts`) raises `drop-unserviced` when the
 *   player is at one of their own drops whose `expectedLoader` is out of play,
 *   and clears the field then, so the missed load is reported once. The
 *   arrest written here puts the loader out of play. Clearing the field as
 *   well would leave the Phase Step nothing to report, and the consequence
 *   Requirement 3.10 asks for would never reach the player.
 * - **Candidates in play.** An Asset the Station or the Hostile Service holds,
 *   or who has been arrested or fled, is left out: the service cannot run its
 *   response on them, and an arrest would overwrite a Station hold. An Asset
 *   it has already detected draws no detection coin either way. The Station's
 *   arrest record alone does not take an Asset out of play, so a turned agent
 *   released from Station Custody can still be blown by a refuted feed.
 *
 * ## Purity (Requirement 5.6)
 *
 * Both functions read only their arguments, read no clock, file, environment
 * or model, and never mutate the Draft. {@link applyFullTick} writes the
 * scratch's fields, which is how the scratch hands values on, and draws from
 * the passed Prng only to encipher the comms traffic, after the tick's own
 * draws.
 */

import {
  asTruth,
  revealTruth,
  timeToPhases,
  type ChannelId,
  type EntityId,
  type GameTime,
  type LocId,
  type NpcId,
  type OrgId,
  type Phase,
  type Proposition,
  type TimeWindow,
} from '../model/core.js';
import type {
  FeedLogEntry,
  Meeting,
  SimEvent,
  WorldState,
} from '../model/state.js';
import type { Prng } from '../prng/prng.js';
import type { NpcStatus } from '../city/npc.js';
import {
  isInterceptableKind,
  transmissionTimes,
  type DeadDrop,
} from '../city/comms.js';
import {
  factInAccess,
  inStationCustody,
  newRelationship,
  type OrgMembershipLookup,
  type Relationship,
} from '../recruit/asset.js';
import { factsSinceLastReport } from '../action/task.js';
import { hostileOrgId, npcLoyalty } from '../action/turn-agent.js';
import { isOwnDrop } from '../action/service-drop.js';
import { scheduledLocationAt } from '../clock/schedules.js';
import { liveDisruption } from '../clock/disruption.js';
import type {
  AdvanceWorldDeps,
  DayScratch,
  HookOutput,
} from '../clock/world-types.js';
import {
  buildTransmissions,
  generateIntercepts,
  type InterceptSource,
  type Transmission,
} from '../cipher/intercept.js';
import { padPoolIds, publicTextIdsOf } from '../cipher/world-intercepts.js';
import type { TruthReader } from '../truth/truth.js';
import {
  accrueExposure,
  adoptBelief,
  beliefKey,
  type HostileBeliefs,
} from './beliefs.js';
import type { DetectionBase, DetectionCandidate } from './detection.js';
import type { ChickenfeedCandidate } from './doubling.js';
import type { AdaptationContext } from './adaptation.js';
import type {
  ArrestArticleContext,
  AssetCommitments,
  VoidedMeeting,
  VoidedDrop,
} from './consequences.js';
import type { FedProposition, FeedDelivery } from './ingest-feed.js';
import type { MoleReport } from './mole-report.js';
import { tailingThresholds } from './tailing.js';
import type { PlantCandidate, PlantProjection } from './newspaper-plants.js';
import type {
  HostileChannel,
  HostileChannelProjection,
} from './comms-traffic.js';
import type {
  FullTickInputs,
  FullTickResult,
  HostileServiceState,
} from './hostile.js';

// ---------------------------------------------------------------------------
// Signatures
// ---------------------------------------------------------------------------

/**
 * The dependencies {@link projectFullTick} reads: the turn's Truth Store. A
 * full {@link AdvanceWorldDeps} satisfies it.
 */
export type FullTickProjectionDeps = Pick<AdvanceWorldDeps, 'truth'>;

/**
 * What {@link projectFullTick} returns: the arguments of `dailyTickFull`
 * other than the tick time and the Prng.
 */
export interface FullTickProjection {
  /** The service state the tick starts from: the Draft's, with the day's readings folded in. */
  readonly state: HostileServiceState;
  /** The player's Assets to run detection on, sorted by NPC id. */
  readonly candidates: readonly DetectionCandidate[];
  /** The preset's per-day detection base. */
  readonly base: DetectionBase;
  /** Every other input of the full tick. */
  readonly inputs: FullTickInputs;
}

/**
 * What {@link applyFullTick} reads beyond the Draft, the tick result and the
 * scratch. A `WorldHookContext` satisfies it.
 */
export interface FullTickApplyContext {
  /** The tick time: phase 0 of the day entered. */
  readonly time: GameTime;
  /** The runtime stream, which enciphers the comms traffic after the tick's own draws. */
  readonly rng: Prng;
  /** The field codes (`content.predicates`) and cipher keys the Intercepts are enciphered with. */
  readonly deps: Pick<AdvanceWorldDeps, 'content' | 'cipherKeys'>;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Ascending string order, for id-sorting. */
function byId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The predicate id after its pack prefix (`core/KNOWS` → `KNOWS`). */
function predicateTail(predicate: string): string {
  const slash = predicate.lastIndexOf('/');
  return slash === -1 ? predicate : predicate.slice(slash + 1);
}

/** The id of the org of the given kind, if the world has one. */
function orgOfKind(
  draft: WorldState,
  kind: 'cell' | 'hostile',
): OrgId | undefined {
  if (kind === 'hostile') {
    return hostileOrgId(draft);
  }
  for (const org of Object.values(draft.orgs)) {
    if (org.kind === kind) {
      return org.id;
    }
  }
  return undefined;
}

/** A scheduled `feed-delivered` event. */
type FeedDeliveredEvent = Extract<
  SimEvent,
  { readonly kind: 'feed-delivered' }
>;

/** A scheduled `belief-plant` event. */
type BeliefPlantEvent = Extract<SimEvent, { readonly kind: 'belief-plant' }>;

/** Whether a scheduled event is a delivery the Hostile tick ingests. */
function isDelivery(
  event: SimEvent,
): event is FeedDeliveredEvent | BeliefPlantEvent {
  return event.kind === 'feed-delivered' || event.kind === 'belief-plant';
}

/**
 * Whether a scheduled event is due by the Day Boundary of `day`: scheduled for
 * that day or earlier. The projection delivers exactly these events and the
 * application removes exactly these from `scheduled`.
 */
function isDueBy(event: SimEvent, day: number): boolean {
  return event.at.day <= day;
}

/** The scheduled `feed-delivered` events due by the Day Boundary of `day`, in queue order. */
function dueFeeds(draft: WorldState, day: number): FeedDeliveredEvent[] {
  return draft.scheduled.filter(
    (event): event is FeedDeliveredEvent =>
      event.kind === 'feed-delivered' && isDueBy(event, day),
  );
}

/** The scheduled `belief-plant` events due by the Day Boundary of `day`, in queue order. */
function duePlants(draft: WorldState, day: number): BeliefPlantEvent[] {
  return draft.scheduled.filter(
    (event): event is BeliefPlantEvent =>
      event.kind === 'belief-plant' && isDueBy(event, day),
  );
}

/**
 * Whether the Relationship records a Hostile Service hold still running at
 * `at` (no `until`, or `at` before it), mirroring {@link inStationCustody}.
 */
function inHostileHold(rel: Relationship, at: GameTime): boolean {
  const custody = rel.custody;
  if (custody === undefined || custody.by !== 'hostile') {
    return false;
  }
  return (
    custody.until === undefined ||
    timeToPhases(at) < timeToPhases(custody.until)
  );
}

/**
 * Whether an Asset is in play at `at`, so the Hostile Service can run its
 * response on them: not arrested or fled, and not held by the Station or the
 * Hostile Service. The Station's arrest record alone does not take an Asset
 * out of play: a turned agent released from Station Custody stays in it and is
 * back at work, where a refuted feed can still blow them (slice Req 37.4).
 */
function inPlayAt(draft: WorldState, at: GameTime): (npc: NpcId) => boolean {
  return (npc) => {
    const status = draft.npcs[npc]?.status;
    if (status === 'arrested' || status === 'fled') {
      return false;
    }
    const rel = draft.relationships[npc];
    return (
      rel === undefined ||
      (!inStationCustody(rel, at) && !inHostileHold(rel, at))
    );
  };
}

/**
 * Whether the mole is at liberty at `at`: in play (see {@link inPlayAt}) and
 * not in the Station's arrest record. The live Disruption Context reads exactly
 * these records.
 */
function moleAtLiberty(draft: WorldState, mole: NpcId, at: GameTime): boolean {
  return !liveDisruption({ ...draft, time: at }).isArrested(mole);
}

/**
 * The org-membership seam for the access filter: does the Truth Store hold
 * that `subject` is a `MEMBER_OF` `org` at `at`? With no Truth Store nobody is
 * a member. The same probe the `task` action's collect asks.
 */
function membershipLookup(
  truth: TruthReader | undefined,
  at: GameTime,
): OrgMembershipLookup {
  if (truth === undefined) {
    return () => false;
  }
  return (subject: EntityId, org: OrgId) =>
    truth.holds(
      {
        id: 'prop:hostile-project/membership-probe',
        subject,
        predicate: 'MEMBER_OF',
        object: org,
      },
      at,
    );
}

// ---------------------------------------------------------------------------
// The Cell, the service's own people and the Plot Channels
// ---------------------------------------------------------------------------

/**
 * The Cell members the adaptation rules key on: the Plot leader, every bound
 * role holder and every NPC whose org is the Cell, sorted and without repeats.
 */
function cellMembersOf(draft: WorldState): NpcId[] {
  const members = new Set<NpcId>([revealTruth(draft.plot.leader)]);
  for (const role of draft.plot.roles) {
    if (role.npc !== undefined) {
      members.add(role.npc);
    }
  }
  const cellOrg = orgOfKind(draft, 'cell');
  if (cellOrg !== undefined) {
    for (const npc of Object.values(draft.npcs)) {
      if (npc.org === cellOrg) {
        members.add(npc.id);
      }
    }
  }
  return [...members].sort(byId);
}

/**
 * The people the Hostile Service runs: the Cell members and every NPC whose
 * true allegiance is the Hostile Service or the Cell (its officers and the
 * mole). The service knows the truth about them.
 */
function ownPeopleOf(
  draft: WorldState,
  cellMembers: readonly NpcId[],
): ReadonlySet<EntityId> {
  const own = new Set<EntityId>(cellMembers);
  const orgs = new Set<OrgId>();
  const hostile = orgOfKind(draft, 'hostile');
  const cell = orgOfKind(draft, 'cell');
  if (hostile !== undefined) {
    orgs.add(hostile);
  }
  if (cell !== undefined) {
    orgs.add(cell);
  }
  for (const npc of Object.values(draft.npcs)) {
    if (orgs.has(revealTruth(npc.trueAllegiance).org)) {
      own.add(npc.id);
    }
  }
  return own;
}

/** The Plot's Channels: those the Cell org or a Cell member owns. */
function plotChannelsOf(
  draft: WorldState,
  cellMembers: readonly NpcId[],
): ReadonlySet<ChannelId> {
  const owners = new Set<string>(cellMembers);
  const cellOrg = orgOfKind(draft, 'cell');
  if (cellOrg !== undefined) {
    owners.add(cellOrg);
  }
  const out = new Set<ChannelId>();
  for (const channel of Object.values(draft.channels)) {
    if (owners.has(channel.owner)) {
      out.add(channel.id);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Feeds (Req 3.5)
// ---------------------------------------------------------------------------

/** A comparable form of a Proposition's object (an entity id or a literal). */
function objectKey(prop: Proposition): string {
  return typeof prop.object === 'string'
    ? prop.object
    : JSON.stringify(prop.object);
}

/** A window's start and end on the flat phase line; an open end runs on forever. */
function span(window: TimeWindow): readonly [number, number] {
  const from = timeToPhases(window.from);
  const to =
    window.to === undefined
      ? Number.POSITIVE_INFINITY
      : timeToPhases(window.to);
  return [from, to];
}

/** Whether two windows overlap. A Proposition with no window holds at every time. */
function windowsOverlap(
  a: TimeWindow | undefined,
  b: TimeWindow | undefined,
): boolean {
  if (a === undefined || b === undefined) {
    return true;
  }
  const [aFrom, aTo] = span(a);
  const [bFrom, bTo] = span(b);
  return aFrom <= bTo && bFrom <= aTo;
}

/**
 * Whether `known` contradicts `fed` (design, "Feed ingestion": refute): the
 * same subject and predicate with a different object, a different place or a
 * window that does not overlap.
 */
function contradicts(known: Proposition, fed: Proposition): boolean {
  if (
    known.subject !== fed.subject ||
    predicateTail(known.predicate) !== predicateTail(fed.predicate)
  ) {
    return false;
  }
  return (
    objectKey(known) !== objectKey(fed) ||
    (known.place ?? '') !== (fed.place ?? '') ||
    !windowsOverlap(known.window, fed.window)
  );
}

/**
 * What the projection checks a fed Proposition against: the service's adopted
 * beliefs (keys and Propositions), the people it runs, and the true facts
 * about them.
 */
interface ServiceKnowledge {
  readonly adoptedKeys: ReadonlySet<string>;
  readonly adopted: readonly Proposition[];
  readonly ownPeople: ReadonlySet<EntityId>;
  readonly ownFacts: readonly Proposition[];
  readonly stationOrg: OrgId;
  readonly plotChannels: ReadonlySet<ChannelId>;
}

/** Build the {@link ServiceKnowledge} the feed checks read. */
function serviceKnowledge(
  draft: WorldState,
  beliefs: HostileBeliefs,
  cellMembers: readonly NpcId[],
  truth: TruthReader | undefined,
): ServiceKnowledge {
  const ownPeople = ownPeopleOf(draft, cellMembers);
  const ownFacts =
    truth === undefined
      ? []
      : truth
          .facts()
          .map((fact) => revealTruth(fact))
          .filter((fact) => ownPeople.has(fact.subject));
  return {
    adoptedKeys: new Set(beliefs.adoptedKeys),
    adopted: beliefs.adopted,
    ownPeople,
    ownFacts,
    stationOrg: draft.station.org,
    plotChannels: plotChannelsOf(draft, cellMembers),
  };
}

/**
 * Project one fed Proposition for `ingestFeed`:
 *
 * - `holdsInTruth` — it holds in the Truth Store at the delivery time (the
 *   chickenfeed/deception classification);
 * - `confirmed` — the service already holds it as a belief, or it is a true
 *   statement about one of the people the service runs (the service knows the
 *   truth about its own people);
 * - `refuted` — otherwise, the service holds a contradicting belief, or it is a
 *   false statement about one of its own people and a true fact about that
 *   person with the same predicate contradicts it;
 * - `channel` — the Plot Channel it names, when it is a `KNOWS`/`SUSPECTS` with
 *   the Station as subject and a Plot Channel as object.
 */
function fedProposition(
  prop: Proposition,
  deliveredAt: GameTime,
  knowledge: ServiceKnowledge,
  truth: TruthReader | undefined,
): FedProposition {
  const holds = truth?.holds(prop, deliveredAt) ?? false;
  const own = knowledge.ownPeople.has(prop.subject);
  const confirmed =
    knowledge.adoptedKeys.has(beliefKey(prop)) || (own && holds);
  const refuted =
    !confirmed &&
    (knowledge.adopted.some((belief) => contradicts(belief, prop)) ||
      (own &&
        !holds &&
        knowledge.ownFacts.some((fact) => contradicts(fact, prop))));
  const channel = namedPlotChannel(prop, knowledge);
  return {
    prop,
    holdsInTruth: holds,
    confirmed,
    refuted,
    ...(channel === undefined ? {} : { channel }),
  };
}

/** The Plot Channel a `KNOWS`/`SUSPECTS(station, chan)` Proposition names, if any. */
function namedPlotChannel(
  prop: Proposition,
  knowledge: ServiceKnowledge,
): ChannelId | undefined {
  const tail = predicateTail(prop.predicate);
  if (
    (tail !== 'KNOWS' && tail !== 'SUSPECTS') ||
    prop.subject !== knowledge.stationOrg
  ) {
    return undefined;
  }
  if (typeof prop.object !== 'string') {
    return undefined;
  }
  const channel = prop.object as ChannelId;
  return knowledge.plotChannels.has(channel) ? channel : undefined;
}

/** The bottom of the design's pre-turn trust band an agent's credibility starts in. */
export const PRIOR_TRUST_FLOOR = 0.5;
/** The top of the design's pre-turn trust band an agent's credibility starts in. */
export const PRIOR_TRUST_CEILING = 0.8;

/**
 * The agent's credibility seed (`FeedDelivery.priorTrust`): the design's
 * pre-turn trust band, {@link PRIOR_TRUST_FLOOR} to
 * {@link PRIOR_TRUST_CEILING}, scaled by the agent's loyalty to the service
 * (`npcLoyalty`, `0.5` when the NPC records none). The engine records no trust
 * between an agent and its handler, and the agent's loyalty is what the
 * service's trust in it rests on.
 */
function priorTrustOf(draft: WorldState, agent: NpcId): number {
  return (
    PRIOR_TRUST_FLOOR +
    (PRIOR_TRUST_CEILING - PRIOR_TRUST_FLOOR) * npcLoyalty(draft, agent)
  );
}

// ---------------------------------------------------------------------------
// Commitments and arrest articles (Req 3.10)
// ---------------------------------------------------------------------------

/** The Asset's `accepted` meetings, sorted by id. */
function pendingMeetingsOf(draft: WorldState, npc: NpcId): VoidedMeeting[] {
  return (Object.values(draft.meetings) as Meeting[])
    .filter((meeting) => meeting.npc === npc && meeting.status === 'accepted')
    .sort((a, b) => byId(a.id, b.id))
    .map((meeting) => ({ meeting: meeting.id, slot: meeting.slot }));
}

/** The player's own drops expecting the Asset to load them, sorted by id. */
function pendingDropsOf(draft: WorldState, npc: NpcId): VoidedDrop[] {
  return (Object.values(draft.deadDrops) as DeadDrop[])
    .filter((drop) => drop.expectedLoader === npc && isOwnDrop(draft, drop))
    .sort((a, b) => byId(a.id, b.id))
    .map((drop) => ({ drop: drop.id }));
}

/**
 * Where the NPC was last seen: its whereabouts, or its scheduled Location at
 * `at` when it is absent from every Location.
 */
function lastKnownLocation(
  draft: WorldState,
  npc: NpcId,
  at: GameTime,
): LocId | undefined {
  const where = draft.whereabouts[npc];
  if (where !== undefined && where !== 'absent') {
    return where;
  }
  const record = draft.npcs[npc];
  return record === undefined ? undefined : scheduledLocationAt(record, at);
}

/**
 * The public place an arrest article names: the District of the Asset's last
 * known Location. The article's fixed text withholds the person's details
 * ("details were not released"), so it asserts nothing about the Asset.
 */
function arrestArticleContextOf(
  draft: WorldState,
  npc: NpcId,
  at: GameTime,
): ArrestArticleContext | undefined {
  const loc = lastKnownLocation(draft, npc, at);
  const location = loc === undefined ? undefined : draft.city.locations[loc];
  const district =
    location === undefined
      ? undefined
      : draft.city.districts[location.district];
  return district === undefined
    ? undefined
    : { place: district.name, asserts: [] };
}

// ---------------------------------------------------------------------------
// Newspaper plants (Req 3.8)
// ---------------------------------------------------------------------------

/** The headline a planted sighting prints under. */
export const PLANT_HEADLINE = 'Talk of the town';

/** The article text of a planted sighting at a named place. */
export function plantSummary(place: string): string {
  return `They say a well-known face was seen at ${place} today.`;
}

/**
 * The NPCs the Hostile Service believes the Station knows: every NPC its
 * adopted beliefs name as subject or object, other than the Station's own
 * chief and staff. Its beliefs are what the mole relayed of the Station's
 * knowledge and what turned agents told it, so these are the people it
 * expects the Station to be watching. Sorted.
 */
function stationKnownNpcs(draft: WorldState, beliefs: HostileBeliefs): NpcId[] {
  const staff = new Set<EntityId>([
    draft.station.chief,
    ...draft.station.staff,
  ]);
  const out = new Set<NpcId>();
  for (const belief of beliefs.adopted) {
    for (const entity of [
      belief.subject,
      typeof belief.object === 'string' ? belief.object : undefined,
    ]) {
      if (
        entity !== undefined &&
        !staff.has(entity) &&
        draft.npcs[entity as NpcId] !== undefined
      ) {
        out.add(entity as NpcId);
      }
    }
  }
  return [...out].sort(byId);
}

/**
 * A false sighting of `npc` for the day: `LOCATED_AT(npc, npc)` at a public
 * Location the NPC is not scheduled at during the day, over the whole day.
 * The public Locations are tried in id order, starting at an offset that
 * rotates with the day, and the first that the NPC is not scheduled at, and
 * that does not hold in the Truth Store, is used. `undefined` when there is
 * none.
 */
function falseSighting(
  draft: WorldState,
  npc: NpcId,
  publicLocations: readonly LocId[],
  day: number,
  truth: TruthReader | undefined,
): Proposition | undefined {
  const record = draft.npcs[npc];
  if (record === undefined || publicLocations.length === 0) {
    return undefined;
  }
  const scheduled = new Set<LocId>();
  for (let phase = 0; phase < 4; phase += 1) {
    const loc = scheduledLocationAt(record, { day, phase: phase as Phase });
    if (loc !== undefined) {
      scheduled.add(loc);
    }
  }
  const from: GameTime = { day, phase: 0 };
  for (let i = 0; i < publicLocations.length; i += 1) {
    const loc = publicLocations[(day + i) % publicLocations.length];
    if (scheduled.has(loc)) {
      continue;
    }
    const prop: Proposition = {
      id: `prop:hostile-plant/${npc}@${day}`,
      subject: npc,
      predicate: 'LOCATED_AT',
      object: npc,
      place: loc,
      window: { from, to: { day, phase: 3 } },
    };
    if (truth?.holds(prop, from) === true) {
      continue;
    }
    return prop;
  }
  return undefined;
}

/**
 * The day's candidate plants (`FullTickInputs.plantCandidates`): one false
 * sighting ({@link falseSighting}) of each NPC the service believes the
 * Station knows ({@link stationKnownNpcs}), keyed `plant:<npc>`. The tick picks
 * a doctrine-sized prefix of them by key and gates each on
 * `deceptionAppetite`.
 */
function plantCandidatesOf(
  draft: WorldState,
  beliefs: HostileBeliefs,
  day: number,
  truth: TruthReader | undefined,
): PlantProjection {
  const publicLocations = Object.values(draft.city.locations)
    .filter((location) => location.public)
    .map((location) => location.id)
    .sort(byId);
  const out: Record<string, PlantCandidate> = {};
  for (const npc of stationKnownNpcs(draft, beliefs)) {
    const proposition = falseSighting(draft, npc, publicLocations, day, truth);
    if (proposition === undefined || proposition.place === undefined) {
      continue;
    }
    const place =
      draft.city.locations[proposition.place]?.name ?? 'a public place';
    out[`plant:${npc}`] = {
      proposition,
      headline: PLANT_HEADLINE,
      summary: plantSummary(place),
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Comms traffic (Req 3.9)
// ---------------------------------------------------------------------------

/**
 * The Hostile Service's interceptable Channels that fire on `day`
 * (`FullTickInputs.commsChannels`): radio and numbers Channels owned by the
 * Hostile Service org or one of its NPCs, each with the day's firing phases.
 */
function hostileChannelsOn(
  draft: WorldState,
  day: number,
): HostileChannelProjection {
  const hostileOrg = orgOfKind(draft, 'hostile');
  if (hostileOrg === undefined) {
    return {};
  }
  const out: Record<ChannelId, HostileChannel> = {};
  for (const id of (Object.keys(draft.channels) as ChannelId[]).sort(byId)) {
    const channel = draft.channels[id];
    if (!isInterceptableKind(channel.kind)) {
      continue;
    }
    const owner = channel.owner;
    const hostileOwned =
      owner === hostileOrg || draft.npcs[owner as NpcId]?.org === hostileOrg;
    if (!hostileOwned) {
      continue;
    }
    const firings = transmissionTimes(channel.schedule, day)
      .filter((t) => t.day === day)
      .map((t) => t.phase);
    if (firings.length === 0) {
      continue;
    }
    out[id] = { channel: id, owner, ownerKind: 'hostile', firings };
  }
  return out;
}

// ---------------------------------------------------------------------------
// projectFullTick
// ---------------------------------------------------------------------------

/**
 * Project the Draft into the inputs of the Hostile Full Tick (design input
 * table; Requirements 3.1, 3.5, 3.6). Pure: no draws, no writes. See the
 * module documentation for what each input is read from.
 *
 * `day` is the day whose Day Boundary the tick runs at; the tick time is phase
 * 0 of it. The returned `state` is the Draft's Hostile Service state with the
 * candidates' Exposure folded into its mirror and the due belief plants
 * adopted.
 */
export function projectFullTick(
  draft: WorldState,
  day: number,
  scratch: DayScratch,
  deps: FullTickProjectionDeps,
): FullTickProjection {
  const at: GameTime = { day, phase: 0 };
  const truth = deps.truth;
  const inPlay = inPlayAt(draft, at);

  // Candidates: every recruited Relationship in play, sorted by NPC id. The
  // Exposure each carries is folded into the service's mirror, which is what
  // detection reads.
  const assets: Relationship[] = (Object.keys(draft.relationships) as NpcId[])
    .sort(byId)
    .map((npc) => draft.relationships[npc])
    .filter((rel) => rel.recruited && inPlay(rel.npc));
  let beliefs: HostileBeliefs = draft.hostile.beliefs;
  const candidates: DetectionCandidate[] = [];
  for (const rel of assets) {
    beliefs = accrueExposure(beliefs, rel.npc, rel.exposure);
    candidates.push({
      npc: rel.npc,
      turnedByPlayer: rel.asset?.turned === true,
    });
  }

  // Belief plants due today: adopted now, and the newly held ones adapt the Plot.
  const newlyAdopted: Proposition[] = [];
  for (const plant of duePlants(draft, day)) {
    const result = adoptBelief(beliefs, plant.prop);
    beliefs = result.beliefs;
    if (result.adopted) {
      newlyAdopted.push(plant.prop);
    }
  }

  // Chickenfeed: each Asset's reportable facts, in access, with no reliability draw.
  const isMemberOfOrg = membershipLookup(truth, at);
  const chickenfeed: Record<NpcId, readonly ChickenfeedCandidate[]> = {};
  for (const rel of assets) {
    if (rel.asset === undefined) {
      continue;
    }
    const access = revealTruth(rel.asset.access);
    const pool = factsSinceLastReport(truth, rel.lastReport, at)
      .map((fact) => revealTruth(fact))
      .filter((fact) => factInAccess(fact, access, isMemberOfOrg))
      .map((prop) => ({ prop }));
    if (pool.length > 0) {
      chickenfeed[rel.npc] = pool;
    }
  }

  // The Cell / target projection for the belief-driven adaptation.
  const cellMembers = cellMembersOf(draft);
  const adaptation: AdaptationContext = {
    stationOrg: draft.station.org,
    cellMembers,
    target: revealTruth(draft.plot.target),
  };

  // Feeds due today, each Proposition checked against the service's knowledge.
  const feedEvents = dueFeeds(draft, day);
  let feeds: FeedDelivery[] = [];
  if (feedEvents.length > 0) {
    const knowledge = serviceKnowledge(draft, beliefs, cellMembers, truth);
    feeds = feedEvents.map((event) => ({
      agent: event.agent,
      priorTrust: priorTrustOf(draft, event.agent),
      items: event.props.map((prop) =>
        fedProposition(prop, event.at, knowledge, truth),
      ),
    }));
  }

  // The mole's report, while the mole is at liberty.
  const mole =
    draft.station.mole === undefined
      ? undefined
      : revealTruth(draft.station.mole);
  const moleReport: MoleReport | undefined =
    mole !== undefined && moleAtLiberty(draft, mole, at)
      ? { mole, propositions: draft.station.reportable }
      : undefined;

  // Each Asset's commitments and arrest-article context.
  const commitments: Record<NpcId, AssetCommitments> = {};
  const arrestArticleContext: Record<NpcId, ArrestArticleContext> = {};
  for (const rel of assets) {
    const pendingMeetings = pendingMeetingsOf(draft, rel.npc);
    const pendingDrops = pendingDropsOf(draft, rel.npc);
    if (pendingMeetings.length > 0 || pendingDrops.length > 0) {
      commitments[rel.npc] = { npc: rel.npc, pendingMeetings, pendingDrops };
    }
    const context = arrestArticleContextOf(draft, rel.npc, at);
    if (context !== undefined) {
      arrestArticleContext[rel.npc] = context;
    }
  }

  const inputs: FullTickInputs = {
    dayEvents: scratch.dayEvents,
    chickenfeed,
    plot: draft.plot,
    adaptation,
    newlyAdopted,
    feeds,
    commitments,
    arrestArticleContext,
    ...(moleReport === undefined ? {} : { moleReport }),
    tailing: {
      coverSuspicion: revealTruth(draft.player.coverSuspicion),
      tailed: revealTruth(draft.player.tailed),
    },
    tailingThresholds: tailingThresholds(
      draft.hostile.doctrine,
      draft.meta.preset.coverSuspicionBurnThreshold,
    ),
    plantCandidates: plantCandidatesOf(draft, beliefs, day, truth),
    commsChannels: hostileChannelsOn(draft, day),
  };

  return {
    state: { doctrine: draft.hostile.doctrine, beliefs },
    candidates,
    base: draft.meta.preset.detectionBase,
    inputs,
  };
}

// ---------------------------------------------------------------------------
// applyFullTick
// ---------------------------------------------------------------------------

/**
 * Write a Hostile Full Tick's result to the Draft (design output table;
 * Requirements 3.2–3.11). Returns the next Draft and the tick's events; the
 * Draft itself is not mutated. Appends the day's arrest articles and newspaper
 * plants to `scratch` for the newspaper hook. See the module documentation for
 * what each result field is written to.
 *
 * `ctx` is the hook's own context (see {@link FullTickApplyContext}): the tick
 * time, the runtime Prng that enciphers the comms traffic, and the field codes
 * and cipher keys of the Intercepts.
 */
export function applyFullTick(
  draft: WorldState,
  result: FullTickResult,
  scratch: DayScratch,
  ctx: FullTickApplyContext,
): HookOutput {
  const at = ctx.time;

  // The Hostile Service state, its feed log and the doubled Assets' Chickenfeed.
  const feedLog: FeedLogEntry[] = [...draft.hostile.feedLog];
  for (const agent of Object.keys(result.feedClasses) as NpcId[]) {
    feedLog.push({ at, agent, classes: result.feedClasses[agent] });
  }
  let chickenfeed = draft.hostile.chickenfeed;
  for (const doubling of result.doublings) {
    chickenfeed = {
      ...chickenfeed,
      [doubling.npc]: doubling.chickenfeed.props,
    };
  }
  const hostile: WorldState['hostile'] = {
    ...draft.hostile,
    ...result.next,
    feedLog,
    ...(chickenfeed === undefined ? {} : { chickenfeed }),
  };

  // Arrests (NPC status and Hostile custody) and doublings (the hidden flip).
  const npcs = { ...draft.npcs };
  const relationships = { ...draft.relationships };
  for (const event of result.events) {
    if (event.kind !== 'asset-arrested') {
      continue;
    }
    const npc = npcs[event.npc];
    if (npc !== undefined) {
      npcs[event.npc] = { ...npc, status: asTruth<NpcStatus>('arrested') };
    }
    const rel = relationships[event.npc] ?? newRelationship(event.npc);
    relationships[event.npc] = {
      ...rel,
      custody: { by: 'hostile', since: event.at },
    };
  }
  for (const doubling of result.doublings) {
    const rel = relationships[doubling.npc];
    if (rel?.asset !== undefined) {
      relationships[doubling.npc] = {
        ...rel,
        asset: {
          ...rel.asset,
          hostileControlled: asTruth(doubling.hostileControlled),
        },
      };
    }
  }

  // The arrested Assets' voided meetings and drops.
  const meetings = { ...draft.meetings };
  for (const voided of result.arrestConsequences.voidedMeetings) {
    const meeting = meetings[voided.meeting];
    if (meeting !== undefined) {
      meetings[voided.meeting] = { ...meeting, status: 'void' };
    }
  }
  // The voided drops (`arrestConsequences.voidedDrops`) keep their
  // `expectedLoader`: with the loader now arrested, the Phase Step reads it as
  // the load that will never come, raises `drop-unserviced` when the player is
  // at the drop, and clears it then. Clearing it here would leave the Phase
  // Step nothing to report.

  // The day's arrest articles and plants, for the newspaper hook.
  scratch.arrestArticles = [
    ...scratch.arrestArticles,
    ...result.arrestArticles,
  ];
  scratch.newspaperPlants = [
    ...scratch.newspaperPlants,
    ...result.newspaperPlants,
  ];

  // Tailing, Cover Suspicion and the burn.
  let player = draft.player;
  if (result.tailing !== undefined) {
    const burn = tailingThresholds(
      draft.hostile.doctrine,
      draft.meta.preset.coverSuspicionBurnThreshold,
    ).burn;
    const coverSuspicion = result.tailing.coverSuspicion;
    player = {
      ...player,
      tailed: asTruth(result.tailing.tailed),
      coverSuspicion: asTruth(coverSuspicion),
      burned: player.burned || result.tailing.burned || coverSuspicion >= burn,
    };
  }

  // Comms traffic, enciphered on the runtime stream, for the intercept action.
  const transmissions = mintTransmissions(draft, result.commsTraffic, ctx);

  // The delivered feeds and plants leave the queue.
  const scheduled = draft.scheduled.filter(
    (event) => !(isDelivery(event) && isDueBy(event, at.day)),
  );

  return {
    state: {
      ...draft,
      hostile,
      npcs,
      relationships,
      meetings,
      player,
      transmissions,
      scheduled,
      plot: result.plot ?? draft.plot,
    },
    events: result.events,
  };
}

/**
 * Encipher the day's comms traffic and append it to `transmissions`
 * (Requirement 3.9). Each source goes through the Cipher Engine
 * ({@link generateIntercepts}) on the runtime stream, under the preset's
 * ciphers and tradecraft-error rate, the world's public texts and pads, and
 * the passed cipher keys, then is paired with its Intercept as a
 * {@link Transmission}. A source whose transmission is already in the world is
 * skipped, so the same firing is never minted twice.
 */
function mintTransmissions(
  draft: WorldState,
  traffic: readonly InterceptSource[],
  ctx: FullTickApplyContext,
): readonly Transmission[] {
  const existing = new Set(draft.transmissions.map((tx) => tx.id));
  const sources = traffic.filter((source) => !existing.has(source.id));
  if (sources.length === 0) {
    return draft.transmissions;
  }
  const generated = generateIntercepts(ctx.rng, sources, {
    channels: draft.channels,
    fieldCodes: ctx.deps.content.predicates.fieldCodes,
    allowedCiphers: draft.meta.preset.allowedCiphers,
    tradecraftErrorProbability: draft.meta.preset.tradecraftErrorProbability,
    publicTextIds: publicTextIdsOf(draft.documents),
    padIds: padPoolIds(),
    keyLookup: ctx.deps.cipherKeys,
  });
  return [
    ...draft.transmissions,
    ...buildTransmissions(sources, generated, draft.channels),
  ];
}

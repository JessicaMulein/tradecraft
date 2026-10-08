/**
 * The arrange-meeting action (design, "Action Resolver" → **Arrange meeting**;
 * Requirement 24.1, 24.2, 24.3, 24.4).
 *
 * `{ kind:'arrange-meeting'; npc: NpcId; at: LocId; slot: GameTime }` — the
 * player proposes a meeting with an NPC they can reach (a Contact Channel) at a
 * Location and a slot in the next three days. The design's shape:
 *
 * - **Precondition (Req 24.1).** Requires a Contact Channel ({@link
 *   hasContactChannel}, reused from `./talk.ts`) and a slot *in the next three
 *   days* — strictly after now and no more than three days out. The shared
 *   Location gate in `./action.ts` handles the slot Location's allowed actions
 *   and the opening hours.
 * - **Acceptance (Req 24.2).** The NPC accepts with probability
 *   `σ(trust − riskAversion·loc.risk − scheduleConflict + agendaInterest)`
 *   ({@link meetingAcceptanceProbability}), using the scenario's `meeting`
 *   weights (`{trust, riskAversion, scheduleConflict, agendaInterest}` on
 *   `meta.scenario.recruitment.meeting`) and the per-NPC inputs. Drawn once on
 *   the passed {@link Prng}.
 * - **Reply (Req 24.3).** On accept a {@link Meeting} is recorded in
 *   `WorldState.meetings` (status `accepted`) and a player-visible
 *   `meeting-reply` `{accepted:true}` event is minted; on decline the Meeting is
 *   recorded (status `declined`) with a `meeting-reply` `{accepted:false}`. The
 *   design says the reply "arrives as an event in the next phase, or immediately
 *   for Assets" — the arrival timing is the Turn Pipeline's job, so this
 *   resolver mints the reply event as *data* (the pipeline delivers it next
 *   phase / immediately per the design) rather than wiring a clock here.
 * - **The slot (Req 24.3, 24.4).** {@link resolveMeetingAtSlot} is the pure
 *   function the clock calls when the slot arrives: if both parties are present
 *   it opens a talk scene (a `meeting-due` event + an `openScene`); if the
 *   player is absent the NPC's trust drops (reported as a Relationship trust
 *   delta) and a `meeting-missed-by-player` event is minted; if the NPC is
 *   absent a `meeting-no-show` event is minted. Wiring this into the clock is
 *   the Turn Pipeline's job; this module only provides the pure seam.
 * - **Exposure (Req 24.4).** Arranging adds Exposure `k1·loc.risk +
 *   k2·crowdPenalty + k3·recentContacts` ({@link meetingExposure}) using the
 *   scenario's `exposure` weights (`{k1,k2,k3}`).
 *
 * ## Modelling seams (documented)
 *
 * Several of the design's inputs live in state that other tasks own; this module
 * reads them minimally and documents the seam rather than widening those shapes:
 *
 * - **trust** is a {@link Relationship} field, and `Relationship` is a skeleton
 *   owned by task 18. So this module reads a trust value through
 *   {@link relationshipTrust}, which defaults to {@link NEUTRAL_TRUST} when the
 *   skeleton carries none, and reports the "trust drops" penalty as a *delta*
 *   ({@link MISSED_MEETING_TRUST_DROP}) the Turn Pipeline / task 18 persists —
 *   it does not write a trust field itself. {@link applyTrustDrop} is offered as
 *   a convenience that lowers a numeric `trust` field *if the Relationship has
 *   one*, leaving the skeleton untouched otherwise.
 * - **Exposure** has no dedicated accumulator on `WorldState`; the player's
 *   hidden `coverSuspicion` is the suspicion accumulator surveil/approach raise,
 *   so arranging adds its Exposure there (clamped into `[0, 1]`), consistent
 *   with how those actions add suspicion. {@link EXPOSURE_SUSPICION_SCALE}
 *   documents the mapping from the raw Exposure term to the `[0, 1]` suspicion
 *   accumulator.
 * - **crowdPenalty** needs the day's weather and {@link CrowdModel} to resolve a
 *   crowd band (`crowdLevel`/`crowdAt`), which `resolve` does not hold. So a
 *   documented *proxy* is used: the Location's `risk` as a stand-in crowd
 *   pressure, exposed as {@link crowdPenaltyProxy}; a caller that *does* hold the
 *   weather may pass a real `crowdPenalty` through {@link ArrangeMeetingInputs}.
 * - **recentContacts** is a count the Turn Pipeline tracks; it is accepted as an
 *   input on {@link ArrangeMeetingInputs} and defaults to `0`.
 *
 * ## Purity and the Truth boundary
 *
 * `quoteArrangeMeeting` is pure and draws nothing. `resolveArrangeMeeting` draws
 * exactly one coin — the acceptance σ — from the passed {@link Prng}, so the
 * same inputs always yield the same Meeting and reply. `resolveMeetingAtSlot` is
 * pure and draws nothing. Fact Line rendering is left to the caller (a `render`
 * callback), so this module never imports `./action.ts` and no import cycle
 * forms — the same pattern `./talk.ts` and `./surveil.ts` use.
 */

import {
  asTruth,
  compareTime,
  revealTruth,
  type GameTime,
  type LocId,
  type NpcId,
} from '../model/core.js';
import type {
  EventId,
  MeetingId,
  Relationship,
  SimEvent,
  WorldState,
} from '../model/state.js';
import type { Prng } from '../prng/prng.js';
import { scheduledLocation } from '../city/npc.js';
import { CONTENT_WEEKDAYS, weekdayForDay } from '../city/time-mapping.js';
import { sigmoid } from '../recruit/first-contact.js';
import { regardDelta } from '../ambient/memory.js';
import { hasContactChannel } from './talk.js';
import type { ActionQuote, ActionResult, Observation } from './result.js';
import type { ArrangeMeetingAction, Meeting, MeetingStatus } from './types.js';

// ---------------------------------------------------------------------------
// The Meeting record (design, "Data Models"; owned by this task)
// ---------------------------------------------------------------------------

/**
 * The {@link Meeting} record and its {@link MeetingStatus} — the design's
 * `Meeting` data model this task owns. The record *shape* is declared in the
 * dependency-light `./types.ts` (beside the {@link Action} union) so this
 * behaviour module, which must import `WorldState` from `../model/state.ts`,
 * does not form an import cycle with it; `../model/state.ts` re-exports `Meeting`
 * from `./types.ts` under the name `WorldState.meetings` uses. They are
 * re-exported here so a caller of the arrange-meeting API reads the record type
 * from the same module as the resolvers.
 */
export type { Meeting, MeetingStatus };

// ---------------------------------------------------------------------------
// Constants (documented defaults)
// ---------------------------------------------------------------------------

/** The phase cost of *arranging* a meeting. The design does not cost the arrange
 * act heavily — the time is spent at the slot, which the Turn Pipeline charges;
 * arranging a meeting is a quick message over a Contact Channel, so it costs one
 * phase. Documented so a preset field can drive it later. */
export const ARRANGE_PHASE_COST = 1;

/** The widest a slot may be from now, in days (design: "a slot in the next 3
 * days"; Req 24.1). A slot must be strictly after now and no more than this many
 * days out. */
export const MAX_SLOT_DAYS = 3;

/** The neutral baseline trust used when a {@link Relationship} carries no trust
 * value (the `Relationship` skeleton is owned by task 18). Reading-and-defaulting
 * keeps this module from widening that shape. */
export const NEUTRAL_TRUST = 0.5;

/** How much the NPC's trust drops when the player misses an accepted meeting
 * (design: "If the player is absent, trust drops"; Req 24.4). Reported as a
 * delta the Turn Pipeline / task 18 persists. */
export const MISSED_MEETING_TRUST_DROP = 0.2;

/**
 * The default `agendaInterest` for an NPC with no stored Agenda interest. The
 * design says "Dangles and handlers seeking access have high `agendaInterest`";
 * since the per-NPC Agenda is owned by task 5.5 and not on the view-safe `Npc`
 * shape, {@link agendaInterestOf} derives a documented default from the NPC's
 * role — a handler (hostile officer) seeking access gets {@link
 * AGENDA_INTEREST_HANDLER}, everyone else {@link AGENDA_INTEREST_BASE}.
 */
export const AGENDA_INTEREST_BASE = 0;

/** The `agendaInterest` of a handler / dangle seeking access (design: "high"). */
export const AGENDA_INTEREST_HANDLER = 1;

/**
 * The scale mapping the raw Exposure term (`k1·loc.risk + k2·crowdPenalty +
 * k3·recentContacts`) into the player's `coverSuspicion` accumulator, which
 * lives in `[0, 1]`. The weights and inputs are small, so a modest scale keeps a
 * single arranged meeting from saturating suspicion; documented so a preset can
 * tune it. Exposure is added to `coverSuspicion` because `WorldState` has no
 * dedicated Exposure accumulator (see the module seam notes).
 */
export const EXPOSURE_SUSPICION_SCALE = 0.1;

// ---------------------------------------------------------------------------
// Acceptance σ primitive (Req 24.2)
// ---------------------------------------------------------------------------

/**
 * The `meeting` acceptance weights (design: the scenario config's
 * `recruitment.meeting` weights). `trust` scales the player's trust with the
 * NPC, `riskAversion` scales the Location risk penalty, `scheduleConflict`
 * scales the slot-vs-schedule conflict penalty, `agendaInterest` scales the
 * NPC's interest in meeting.
 */
export interface MeetingWeights {
  readonly trust: number;
  readonly riskAversion: number;
  readonly scheduleConflict: number;
  readonly agendaInterest: number;
  /** Ambient regard weight. Absent means the regard term is zero. */
  readonly regard?: number;
}

/** The per-meeting inputs the acceptance σ reads. All in natural units; the
 * weights scale them. */
export interface MeetingAcceptanceInputs {
  /** The player's trust with the NPC, `[0, 1]` (defaulted to {@link NEUTRAL_TRUST}). */
  readonly trust: number;
  /** The slot Location's risk rating. */
  readonly locRisk: number;
  /** How badly the slot conflicts with the NPC's schedule, `[0, 1]`. */
  readonly scheduleConflict: number;
  /** The NPC's interest in meeting (dangles/handlers high). */
  readonly agendaInterest: number;
  /** Warmth minus wariness. Omitted means no ambient regard. */
  readonly regard?: number;
}

/**
 * The meeting-acceptance probability (design: `σ(trust − riskAversion·loc.risk −
 * scheduleConflict + agendaInterest)`; Req 24.2). Pure and drawless, so a quote
 * or a test can read the probability without committing a coin. Monotonic as the
 * design intends: it rises with trust and agendaInterest and falls with the
 * Location risk and the schedule conflict (for positive weights).
 */
export function meetingAcceptanceProbability(
  inputs: MeetingAcceptanceInputs,
  weights: MeetingWeights,
): number {
  const x =
    weights.trust * inputs.trust -
    weights.riskAversion * inputs.locRisk -
    weights.scheduleConflict * inputs.scheduleConflict +
    weights.agendaInterest * inputs.agendaInterest +
    (weights.regard ?? 0) * (inputs.regard ?? 0);
  return sigmoid(x);
}

/** The scenario's `meeting` acceptance weights, read from the resolved scenario
 * config on `WorldState.meta.scenario` (Req 24.2). The scenario schema validates
 * the bag, so the read is total. */
export function meetingWeightsOf(state: WorldState): MeetingWeights {
  return state.meta.scenario.recruitment.meeting;
}

// ---------------------------------------------------------------------------
// Exposure (Req 24.4)
// ---------------------------------------------------------------------------

/** The scenario's `exposure` weights (`{k1,k2,k3}`), read from the resolved
 * scenario config (Req 24.4). */
export interface ExposureWeights {
  readonly k1: number;
  readonly k2: number;
  readonly k3: number;
}

/** The scenario's `exposure` weights, read from `meta.scenario.recruitment`. */
export function exposureWeightsOf(state: WorldState): ExposureWeights {
  return state.meta.scenario.recruitment.exposure;
}

/**
 * The crowd-penalty proxy used when the day's weather and crowd model are not in
 * hand (design: `crowdPenalty`; `resolve` does not hold the weather needed for
 * `crowdLevel`/`crowdAt`). The Location's `risk` stands in for crowd pressure —
 * a documented proxy — so Exposure can be computed purely from the WorldState. A
 * caller that holds the weather may pass a real `crowdPenalty` instead
 * (see {@link ArrangeMeetingInputs}).
 */
export function crowdPenaltyProxy(locRisk: number): number {
  return locRisk;
}

/**
 * The Exposure a meeting adds (design: `k1·loc.risk + k2·crowdPenalty +
 * k3·recentContacts`; Req 24.4). Pure. `recentContacts` defaults to `0` when the
 * Turn Pipeline does not supply it; `crowdPenalty` defaults to the risk proxy.
 */
export function meetingExposure(
  weights: ExposureWeights,
  locRisk: number,
  crowdPenalty: number,
  recentContacts: number,
): number {
  return weights.k1 * locRisk + weights.k2 * crowdPenalty + weights.k3 * recentContacts;
}

// ---------------------------------------------------------------------------
// Relationship trust seam (owned by task 18)
// ---------------------------------------------------------------------------

/**
 * Read a trust value from a {@link Relationship}, defaulting to {@link
 * NEUTRAL_TRUST} when the skeleton carries none. `Relationship` is a skeleton
 * owned by task 18, so this reads a `trust` field *if one is present* (a later
 * task may add it) and otherwise returns the neutral baseline — it never widens
 * the shape. The lookup is by the NPC's own `relationships` entry.
 */
export function relationshipTrust(state: WorldState, npc: NpcId): number {
  const rel = state.relationships[npc] as (Relationship & { trust?: number }) | undefined;
  const t = rel?.trust;
  return typeof t === 'number' ? t : NEUTRAL_TRUST;
}

/**
 * Lower an NPC's trust by {@link MISSED_MEETING_TRUST_DROP} *if the Relationship
 * carries a numeric `trust` field* (Req 24.4). Because `Relationship` is a task-
 * 18 skeleton, this does not add a trust field when none exists: it reports the
 * delta through {@link resolveMeetingAtSlot} and leaves persistence to task 18.
 * When a `trust` field *is* present (a later task added it), this returns a
 * state with it lowered, clamped into `[0, 1]`; otherwise it returns the state
 * unchanged. Either way the delta is reported, so the seam is honoured.
 */
export function applyTrustDrop(state: WorldState, npc: NpcId): WorldState {
  const rel = state.relationships[npc] as (Relationship & { trust?: number }) | undefined;
  if (rel === undefined || typeof rel.trust !== 'number') {
    return state;
  }
  const next = Math.max(0, Math.min(1, rel.trust - MISSED_MEETING_TRUST_DROP));
  return {
    ...state,
    relationships: {
      ...state.relationships,
      [npc]: { ...rel, trust: next },
    },
  };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Clamp a value into `[0, 1]` (the suspicion/Exposure accumulator range). */
function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** The NPCs scheduled at a Location at a given time, by id (local copy, so this
 * module does not import `./action.ts` and form a cycle). */
function scheduledAt(state: WorldState, locId: LocId, t: GameTime): NpcId[] {
  const weekday = CONTENT_WEEKDAYS.indexOf(weekdayForDay(t.day));
  const out: NpcId[] = [];
  for (const npc of Object.values(state.npcs)) {
    if (scheduledLocation(npc.schedule, weekday, t.phase) === locId) {
      out.push(npc.id);
    }
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The scene descriptor for a Location at a time, built locally (no action.ts). */
function sceneDescriptorAt(
  state: WorldState,
  loc: LocId,
  t: GameTime,
): ActionResult['scene'] {
  const place = state.city.locations[loc];
  if (place === undefined) {
    return { loc, description: '', atmosphere: [], risk: 0, visible: [] };
  }
  return {
    loc,
    description: place.description,
    atmosphere: [...place.atmosphere],
    risk: place.risk,
    visible: scheduledAt(state, loc, t),
  };
}

/**
 * The NPC's `agendaInterest` default (design: "Dangles and handlers seeking
 * access have high `agendaInterest`"). The per-NPC Agenda is owned by task 5.5
 * and not on the view-safe `Npc` shape, so this derives a documented default
 * from the NPC's role: a handler (a hostile officer) gets {@link
 * AGENDA_INTEREST_HANDLER}, everyone else {@link AGENDA_INTEREST_BASE}. A caller
 * that holds a richer Agenda may override via {@link ArrangeMeetingInputs}.
 */
export function agendaInterestOf(role: string): number {
  return role === 'hostile-officer' ? AGENDA_INTEREST_HANDLER : AGENDA_INTEREST_BASE;
}

/**
 * How badly a slot conflicts with the NPC's schedule, `[0, 1]` (design: the
 * acceptance reads "the NPC's schedule"; Req 24.1). A documented, pure default:
 * `0` when the NPC is already scheduled at the slot's Location at the slot (no
 * conflict — they are there anyway), `1` when the NPC is scheduled *elsewhere*
 * at the slot (a conflict), and `0` when the NPC has nothing scheduled then
 * (free to come).
 */
export function scheduleConflictAt(
  state: WorldState,
  npc: NpcId,
  at: LocId,
  slot: GameTime,
): number {
  const weekday = CONTENT_WEEKDAYS.indexOf(weekdayForDay(slot.day));
  const where = scheduledLocation(state.npcs[npc]?.schedule ?? { entries: [] }, weekday, slot.phase);
  if (where === undefined || where === at) {
    return 0;
  }
  return 1;
}

/** A stable Meeting id from the NPC, Location and slot, so the same arrange is
 * idempotent in the meetings map and deterministic across runs. */
function meetingIdFor(npc: NpcId, at: LocId, slot: GameTime): MeetingId {
  return `meeting:${npc}@${at}#${slot.day}.${slot.phase}` as MeetingId;
}

/** A deterministic event id for a minted {@link SimEvent}, derived from the
 * Meeting and a tag so two events of a meeting do not collide. */
function eventIdFor(meeting: MeetingId, tag: string): EventId {
  return `event:${meeting}:${tag}`;
}

// ---------------------------------------------------------------------------
// quote (Req 24.1)
// ---------------------------------------------------------------------------

/**
 * Quote an {@link ArrangeMeetingAction} (pure, no draws; Req 24.1). Allowed when
 * the player has a Contact Channel to the NPC ({@link hasContactChannel}) AND
 * the slot is strictly after now and no more than {@link MAX_SLOT_DAYS} days out
 * AND the slot Location exists. The shared Location gate in `./action.ts`
 * handles the slot Location's allowed actions and opening hours. The cost is
 * {@link ARRANGE_PHASE_COST} and no money.
 */
export function quoteArrangeMeeting(
  state: WorldState,
  a: ArrangeMeetingAction,
): ActionQuote {
  if (state.npcs[a.npc] === undefined) {
    return { allowed: false, reason: `no such person ${a.npc}`, phases: 0, money: 0 };
  }
  if (!hasContactChannel(state, a.npc)) {
    return {
      allowed: false,
      reason: 'you have no contact channel to arrange a meeting with them',
      phases: 0,
      money: 0,
    };
  }
  if (state.city.locations[a.at] === undefined) {
    return { allowed: false, reason: `no such Location ${a.at}`, phases: 0, money: 0 };
  }
  // The slot must be strictly after now and within the next three days.
  if (compareTime(a.slot, state.time) <= 0) {
    return {
      allowed: false,
      reason: 'the meeting slot must be in the future',
      phases: 0,
      money: 0,
    };
  }
  if (a.slot.day - state.time.day > MAX_SLOT_DAYS) {
    return {
      allowed: false,
      reason: `the meeting slot must be within the next ${MAX_SLOT_DAYS} days`,
      phases: 0,
      money: 0,
    };
  }
  return { allowed: true, phases: ARRANGE_PHASE_COST, money: 0 };
}

// ---------------------------------------------------------------------------
// resolve (Req 24.2, 24.3, 24.4)
// ---------------------------------------------------------------------------

/**
 * Optional per-arrange inputs the Turn Pipeline may supply, each with a
 * documented default so a plain caller (and the top-level `resolve`) need not
 * pass them:
 *
 * - `recentContacts` — the NPC's recent contact count feeding Exposure; the Turn
 *   Pipeline tracks it (default `0`).
 * - `crowdPenalty` — a real crowd penalty when the caller holds the weather;
 *   defaults to {@link crowdPenaltyProxy} of the Location risk.
 * - `agendaInterest` — a richer Agenda interest when the caller has it; defaults
 *   to {@link agendaInterestOf} the NPC's role.
 */
export interface ArrangeMeetingInputs {
  readonly recentContacts?: number;
  readonly crowdPenalty?: number;
  readonly agendaInterest?: number;
}

/** The Fact Line a reply (accepted/declined) plays. */
export function replyLine(accepted: boolean): string {
  return accepted
    ? 'Word comes back: they will be there.'
    : 'Word comes back: they decline the meeting.';
}

/**
 * Resolve an {@link ArrangeMeetingAction} (design `resolve`; draws exactly the
 * acceptance coin; Req 24.2, 24.3, 24.4). The caller (`resolve`) has confirmed
 * the action is allowed, so the NPC, the Contact Channel and the slot are valid.
 *
 * It draws the acceptance σ ({@link meetingAcceptanceProbability}) on the passed
 * {@link Prng}:
 *
 * - **Accept** (draw under σ): records a {@link Meeting} (status `accepted`) in
 *   `WorldState.meetings` and mints a player-visible `meeting-reply`
 *   `{accepted:true}` event (Req 24.3). The Turn Pipeline delivers that reply
 *   next phase (immediately for Assets); the scene at the slot is opened later
 *   by {@link resolveMeetingAtSlot}.
 * - **Decline** (draw over σ): records a {@link Meeting} (status `declined`) and
 *   mints a `meeting-reply` `{accepted:false}` event.
 *
 * Either way it adds Exposure ({@link meetingExposure}) to the player's
 * `coverSuspicion` accumulator (scaled by {@link EXPOSURE_SUSPICION_SCALE},
 * clamped into `[0, 1]`; Req 24.4). The outcome depends only on the inputs and
 * the PRNG state, so it is deterministic. Fact Line rendering is left to the
 * caller's `render`.
 */
export function resolveArrangeMeeting(
  state: WorldState,
  a: ArrangeMeetingAction,
  rng: Prng,
  render: (state: WorldState, observations: readonly Observation[]) => string[],
  inputs: ArrangeMeetingInputs = {},
): { next: WorldState; result: ActionResult } {
  const loc = state.city.locations[a.at];
  const npc = state.npcs[a.npc];
  const weights = meetingWeightsOf(state);
  const agendaInterest = inputs.agendaInterest ?? agendaInterestOf(npc.role);
  const acceptance = meetingAcceptanceProbability(
    {
      trust: relationshipTrust(state, a.npc),
      locRisk: loc.risk,
      scheduleConflict: scheduleConflictAt(state, a.npc, a.at, a.slot),
      agendaInterest,
      regard: regardDelta(state, a.npc),
    },
    weights,
  );
  const accepted = rng.next() < acceptance;

  const id = meetingIdFor(a.npc, a.at, a.slot);
  const meeting: Meeting = {
    id,
    npc: a.npc,
    at: a.at,
    slot: a.slot,
    status: accepted ? 'accepted' : 'declined',
    acceptance,
  };

  // Exposure added by arranging (Req 24.4): fold into the suspicion accumulator.
  const exposureWeights = exposureWeightsOf(state);
  const crowdPenalty = inputs.crowdPenalty ?? crowdPenaltyProxy(loc.risk);
  const recentContacts = inputs.recentContacts ?? 0;
  const exposure = meetingExposure(
    exposureWeights,
    loc.risk,
    crowdPenalty,
    recentContacts,
  );
  const coverSuspicion = clamp01(
    revealTruth(state.player.coverSuspicion) + EXPOSURE_SUSPICION_SCALE * exposure,
  );

  const reply: SimEvent = {
    kind: 'meeting-reply',
    id: eventIdFor(id, 'reply'),
    at: state.time,
    visibility: 'player',
    meeting: id,
    accepted,
  };

  const next: WorldState = {
    ...state,
    meetings: { ...state.meetings, [id]: meeting },
    player: { ...state.player, coverSuspicion: asTruth(coverSuspicion) },
  };

  const observations: Observation[] = [{ kind: 'message', line: replyLine(accepted) }];
  const result: ActionResult = {
    observations,
    factLines: render(next, observations),
    scene: sceneDescriptorAt(next, state.player.loc, state.time),
    events: [reply],
    claimsAdded: [],
  };
  return { next, result };
}

// ---------------------------------------------------------------------------
// The slot: resolveMeetingAtSlot (Req 24.2, 24.4)
// ---------------------------------------------------------------------------

/** What {@link resolveMeetingAtSlot} reports to the clock. `trustDelta` is the
 * trust change the Turn Pipeline / task 18 persists (negative when the player
 * missed the meeting; `0` otherwise). */
export interface MeetingSlotResult {
  readonly next: WorldState;
  readonly result: ActionResult;
  /** The signed trust change the Turn Pipeline persists (Req 24.4). */
  readonly trustDelta: number;
}

/**
 * Resolve an accepted {@link Meeting} when its slot arrives (design: the slot
 * mechanics; Req 24.2, 24.4). This is the pure seam the clock / Turn Pipeline
 * calls at the slot — it does not wire itself into the clock. It reads whether
 * each party is present at the Meeting Location at the slot (the player by
 * `player.loc`, the NPC by their schedule) and:
 *
 * - **both present** → opens a talk scene (`openScene: { npc }`) with a
 *   `meeting-due` event, and marks the Meeting `kept` (Req 24.2). `trustDelta`
 *   is `0`.
 * - **player absent** → the NPC's trust drops by {@link
 *   MISSED_MEETING_TRUST_DROP} (reported as a negative `trustDelta`; applied via
 *   {@link applyTrustDrop} when the Relationship carries a numeric trust field),
 *   marks the Meeting `missed`, and mints a `meeting-missed-by-player` event
 *   (Req 24.4).
 * - **NPC absent (player present)** → marks the Meeting `no-show` and mints a
 *   `meeting-no-show` event (Req 24.4). `trustDelta` is `0` (the no-show is the
 *   NPC's, not the player's miss).
 *
 * It only acts on an `accepted` Meeting; any other status returns the state
 * unchanged with a `0` delta (nothing to resolve). Fact Line rendering is left
 * to the caller's `render`.
 */
export function resolveMeetingAtSlot(
  state: WorldState,
  meeting: Meeting,
  render: (state: WorldState, observations: readonly Observation[]) => string[],
): MeetingSlotResult {
  if (meeting.status !== 'accepted') {
    return {
      next: state,
      result: {
        observations: [],
        factLines: [],
        scene: sceneDescriptorAt(state, meeting.at, meeting.slot),
        events: [],
        claimsAdded: [],
      },
      trustDelta: 0,
    };
  }

  const npcPresent = scheduledAt(state, meeting.at, meeting.slot).includes(meeting.npc);
  const playerPresent = state.player.loc === meeting.at;

  // Both present: a talk scene opens (Req 24.2).
  if (npcPresent && playerPresent) {
    const kept: Meeting = { ...meeting, status: 'kept' };
    const due: SimEvent = {
      kind: 'meeting-due',
      id: eventIdFor(meeting.id, 'due'),
      at: meeting.slot,
      visibility: 'player',
      meeting: meeting.id,
    };
    const next = withMeeting(state, kept);
    const observations: Observation[] = [
      { kind: 'message', line: 'You meet as arranged.' },
    ];
    return {
      next,
      result: {
        observations,
        factLines: render(next, observations),
        scene: sceneDescriptorAt(next, meeting.at, meeting.slot),
        openScene: { npc: meeting.npc },
        events: [due],
        claimsAdded: [],
      },
      trustDelta: 0,
    };
  }

  // Player absent: trust drops (Req 24.4).
  if (!playerPresent) {
    const missed: Meeting = { ...meeting, status: 'missed' };
    const withDrop = applyTrustDrop(withMeeting(state, missed), meeting.npc);
    const event: SimEvent = {
      kind: 'meeting-missed-by-player',
      id: eventIdFor(meeting.id, 'missed'),
      at: meeting.slot,
      visibility: 'player',
      meeting: meeting.id,
    };
    const observations: Observation[] = [
      { kind: 'message', line: 'You failed to appear for the arranged meeting.' },
    ];
    return {
      next: withDrop,
      result: {
        observations,
        factLines: render(withDrop, observations),
        scene: sceneDescriptorAt(withDrop, meeting.at, meeting.slot),
        events: [event],
        claimsAdded: [],
      },
      trustDelta: -MISSED_MEETING_TRUST_DROP,
    };
  }

  // NPC absent (player present): a no-show by the other party (Req 24.4).
  const noShow: Meeting = { ...meeting, status: 'no-show' };
  const next = withMeeting(state, noShow);
  const event: SimEvent = {
    kind: 'meeting-no-show',
    id: eventIdFor(meeting.id, 'no-show'),
    at: meeting.slot,
    visibility: 'player',
    meeting: meeting.id,
  };
  const observations: Observation[] = [
    { kind: 'message', line: 'They never arrive.' },
  ];
  return {
    next,
    result: {
      observations,
      factLines: render(next, observations),
      scene: sceneDescriptorAt(next, meeting.at, meeting.slot),
      events: [event],
      claimsAdded: [],
    },
    trustDelta: 0,
  };
}

/** Write a Meeting back into the meetings map. */
function withMeeting(state: WorldState, meeting: Meeting): WorldState {
  return {
    ...state,
    meetings: { ...state.meetings, [meeting.id]: meeting },
  };
}

/**
 * The Phase Step: the per-phase work the Turn Pipeline runs on the Draft for
 * every phase a turn's clock advance enters (slice-integration design, "Engine:
 * Phase Step"; Requirements 1.2–1.9 and 6.4; completing slice Req 3.5, 24.2,
 * 24.3, 27.3–27.5, 28.4, 39.3 and 39.5).
 *
 * `advanceWorld` calls {@link phaseStep} once for each phase it enters, after
 * that day's Day-Boundary Hooks when the phase is phase 0. The step runs seven
 * sub-steps in a fixed order. Each one reads the state the one before it left,
 * and their events are appended to one list in the same order, so the turn
 * delivers them as Notifications in event-time order (Req 1.9):
 *
 * 1. **Schedules** (Req 1.2). Every NPC who is not out of play moves to the
 *    Location its schedule names for `to` (`'absent'` when it names none), and
 *    `whereabouts` records it. `advanceSchedules` decides the hidden
 *    `npc-moved` events. See "Pinned NPCs" for who does not move.
 * 2. **Meetings** (Req 1.3, 1.4). Each `accepted` meeting whose slot falls in
 *    the step is resolved with `resolveMeetingAtSlot`, and its trust change,
 *    status and events are applied. The first one that opens a talk scene is
 *    returned as `openScene`. A `void` meeting the player attends raises
 *    `meeting-no-show` (Req 1.8).
 * 3. **Cables** (Req 1.5). `processDueCables` delivers every due reply. The
 *    pending list, ledger, Standing and last funds grant are written, and each
 *    reply becomes a Cable Document with its own `cable` event. A trace reply
 *    also carries a Dossier on the subject from the Station Knowledge Slice.
 * 4. **Directives** (Req 1.6, 6.4). `checkDirectives` runs with
 *    `deps.objectives(draft)`. The Directives and Standing are written, and
 *    each settled Directive's `directive` event is followed by the Cable
 *    Document HQ sends about it, with its own `cable` event.
 * 5. **Retainers** (Req 1.7, 1.8). A money-motivated Asset loses trust for each
 *    phase its retainer is overdue past the grace period, and `retainer-due` is
 *    raised once, in the phase the retainer falls due.
 * 6. **Consequences** (Req 1.8). `asset-silent` is raised once per silence, and
 *    `drop-unserviced` when the player is at one of their own drops that an
 *    Asset now out of play was expected to load.
 * 7. **Custody** (design step 7). Station Custody whose `until` has come is
 *    released with `custody-released`, adding the slice's custody-release
 *    suspicion to the Relationship.
 *
 * The returned state's `time` is `to`. Every event is stamped at `to` (a
 * meeting event at its slot, which is `to` when the step is one phase), so the
 * list is in non-decreasing event-time order.
 *
 * ## Pinned NPCs
 *
 * An NPC out of play does not follow its schedule. {@link pinnedWhereabouts}
 * decides where they are held:
 *
 * - **Station Custody** still running (`inStationCustody`): at the Station, the
 *   city's `station-hq` Location (the lowest id if there are several), or
 *   `'absent'` in a city with no Station.
 * - `npcs[npc].status` is `arrested` or `fled`: `'absent'`.
 * - A Hostile Service hold (`custody.by === 'hostile'`) with no `until`, or
 *   before its `until`: `'absent'`.
 *
 * The Station's permanent arrest record (`player.arrests`) does not pin anyone.
 * The live Disruption Context reads it, but once Station Custody ends the NPC is
 * released and follows their schedule again, and a turned agent goes back to
 * work. A meeting with an NPC who is out of play cannot take place: at the slot
 * it is voided, exactly as the Hostile tick voids an arrested Asset's meetings,
 * so it never opens a scene with someone who is not free to come.
 *
 * ## Contact and silence
 *
 * Nothing in the slice writes `Relationship.lastContact`, and a `collect` task
 * writes `lastReport`. So an Asset's silence is measured from the later of the
 * two. A kept meeting is the one contact this step resolves itself, and it sets
 * `lastContact` to the slot on the NPC's Relationship. An Asset with neither
 * time recorded has no silence to measure and raises nothing. `asset-silent`
 * fires once `scenario.silenceDays` whole days (counted in phases) have passed,
 * sets `silenceNotified`, and is not raised again until a contact or report
 * ends the silence. The step clears a stale `silenceNotified` itself whenever
 * the Asset is no longer silent, so any writer of either time starts a new
 * silence.
 *
 * ## Expected drop loads
 *
 * `DeadDrop.expectedLoader` names the Asset expected to load one of the
 * player's drops. A drop raises `drop-unserviced` when it is one of the
 * player's own drops (`player.known.drops`), its `expectedLoader` is out of
 * play (any pin above), and the player is at the drop's Location, the only
 * place it can be serviced. The step then clears `expectedLoader`, so the
 * missing load is reported once. The Hostile Full Tick's arrest consequence
 * leaves `expectedLoader` naming the arrested Asset for this reason
 * (`../hostile/project.ts`).
 *
 * ## Cable Document ids
 *
 * `processDueCables` names each reply `doc:cable/reply-<kind>-<day>-<phase>`,
 * so two replies of one kind due in the same phase would share an id. This step
 * gives every Cable it composes a fresh reference instead:
 * `HQ-<day>.<phase>-R<n>` for a reply and `HQ-<day>.<phase>-D<n>` for a
 * Directive result, with the lowest `n` from 1 whose Cable id (and, for a reply,
 * trace Dossier id) is not already a Document. The Cable's id is
 * `doc:cable/<slug of the reference>`, a trace Dossier's is
 * `doc:dossier/trace-<slug>`, and each `cable` event names its own Cable.
 *
 * ## Funds
 *
 * The Difficulty Preset has no funds base or cap field, so every funds reply
 * reads {@link DEFAULT_FUNDS_POLICY}, the documented defaults in
 * `../station/cables.ts`.
 *
 * ## Retainer decay per phase
 *
 * `retainerDecay(…, now)` charges the whole span overdue at `now` in one sweep,
 * so calling it every phase would charge each earlier phase again. This step
 * applies the same rule per step instead: the Asset loses
 * `RETAINER_DECAY_PER_PHASE` for each phase that became overdue between `from`
 * and `to`, using the same eligibility test (`subjectToRetainerDecay`) and the
 * same overdue count (`overduePhases`). Summed over the steps since the
 * retainer was last paid, the decay equals what one `retainerDecay` sweep
 * reports, before clamping.
 *
 * ## Purity
 *
 * {@link phaseStep} reads only its arguments and returns new values (Req 5.6).
 * The meeting recogniser check draws from `rng` when a recogniser is present
 * at a kept meeting. Every other sub-step draws nothing, so a world with no
 * carry state leaves the runtime stream where it was (Req 5.1).
 */

import type { ContentSet, DocumentTemplate } from '@tradecraft/content';

import { NEUTRAL_TRUST, resolveMeetingAtSlot } from '../action/arrange-meeting.js';
import { STATION_LOCATION_TYPE } from '../action/intercept.js';
import type { TalkSceneRequest } from '../action/result.js';
import { hasContactChannel } from '../action/talk.js';
import type { Meeting } from '../action/types.js';
import type { DeadDrop } from '../city/comms.js';
import type { Npc } from '../city/npc.js';
import { composeCable, type CableFields } from '../docs/cable.js';
import { composeDossier } from '../docs/dossier.js';
import { docId, type ComposedDocument, type Document } from '../docs/document.js';
import type { NamerContext } from '../docs/namer.js';
import {
  compareTime,
  PHASES_PER_DAY,
  revealTruth,
  timeToPhases,
  type DeadDropId,
  type DocId,
  type GameTime,
  type LocId,
  type NpcId,
  type PropId,
  type Proposition,
} from '../model/core.js';
import type { SimEvent, WorldState } from '../model/state.js';
import { applyRecogniserPass, npcsAt, queueCarryLines } from '../carry/recognise.js';
import { MADE_FACT_LINE } from '../action/surveil.js';
import { ambientPhase } from '../ambient/tick.js';
import type { Prng } from '../prng/prng.js';
import {
  inStationCustody,
  isAsset,
  newRelationship,
  type Relationship,
  type Retainer,
} from '../recruit/asset.js';
import {
  addTrust,
  overduePhases,
  RETAINER_DECAY_PER_PHASE,
  subjectToRetainerDecay,
} from '../recruit/retainer.js';
import { custodyReleaseSuspicion } from '../recruit/turn.js';
import {
  DEFAULT_FUNDS_BASE,
  DEFAULT_FUNDS_CAP,
  processDueCables,
  type CableReply,
  type FundsPolicy,
} from '../station/cables.js';
import type { Directive } from '../station/directive-types.js';
import { checkDirectives, type ObjectiveEvaluator } from '../station/directives.js';
import { advanceSchedules, scheduledLocationAt } from './schedules.js';

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

/**
 * What the Phase Step needs beyond the Draft. The field names and types are the
 * design's `AdvanceWorldDeps` ones, so `advanceWorld` can pass its full deps.
 */
export interface PhaseStepDeps {
  /** The loaded Content Set, for the Cable and Dossier templates. */
  readonly content: ContentSet;
  /**
   * Builds the Objective Evaluator `checkDirectives` calls, over the Draft. The
   * Turn Pipeline supplies it from player-view.
   */
  readonly objectives: (draft: WorldState) => ObjectiveEvaluator;
}

/** What one Phase Step produces (design: `{ state, events, openScene? }`). */
export interface PhaseStepResult {
  /** The Draft after the step, with `time` set to `to`. */
  readonly state: WorldState;
  /** The step's events, in sub-step order. */
  readonly events: SimEvent[];
  /** The talk scene the first kept meeting opened, if one did (Req 1.4). */
  readonly openScene?: TalkSceneRequest;
}

/**
 * The funds knobs every funds reply reads. The Difficulty Preset carries no
 * funds base or cap, so these are the documented defaults.
 */
export const DEFAULT_FUNDS_POLICY: FundsPolicy = {
  base: DEFAULT_FUNDS_BASE,
  cap: DEFAULT_FUNDS_CAP,
};

// ---------------------------------------------------------------------------
// The step
// ---------------------------------------------------------------------------

/** One sub-step's output: the state it left and the events it raised. */
interface SubStep {
  readonly state: WorldState;
  readonly events: readonly SimEvent[];
}

/**
 * Run the Phase Step for the phase `to`, entered from `from` (design, "Engine:
 * Phase Step"). See the module documentation for the seven sub-steps and their
 * order. `to` must be after `from`.
 */
export function phaseStep(
  draft: WorldState,
  from: GameTime,
  to: GameTime,
  rng: Prng,
  deps: PhaseStepDeps,
): PhaseStepResult {
  if (compareTime(to, from) <= 0) {
    throw new RangeError(
      `phaseStep(): the entered phase must be after the previous one, received ${formatTime(from)} -> ${formatTime(to)}`,
    );
  }

  let state: WorldState = { ...draft, time: to };
  const events: SimEvent[] = [];
  const apply = (step: SubStep): void => {
    state = step.state;
    events.push(...step.events);
  };

  apply(stepSchedules(state, from, to));
  const meetings = stepMeetings(state, from, to, rng);
  apply(meetings);
  apply(stepCables(state, to, deps));
  apply(stepDirectives(state, to, deps));
  apply(stepRetainers(state, from, to));
  apply(stepConsequences(state, to));
  apply(stepCustody(state, to));
  apply(ambientPhase(state));

  return meetings.openScene === undefined
    ? { state, events }
    : { state, events, openScene: meetings.openScene };
}

// ---------------------------------------------------------------------------
// Pinned NPCs
// ---------------------------------------------------------------------------

/**
 * Where an NPC out of play is held at `at`, or `undefined` when the NPC is free
 * and follows its schedule. Station Custody holds them at the Station's
 * Location (`'absent'` in a city with no Station). An `arrested` or `fled`
 * status, or a running Hostile Service hold, makes them `'absent'`. The
 * Station's arrest record alone does not pin anyone.
 */
export function pinnedWhereabouts(
  draft: WorldState,
  npc: NpcId,
  at: GameTime,
): LocId | 'absent' | undefined {
  return pinnedPlace(draft, npc, at, stationLocationOf(draft));
}

/** {@link pinnedWhereabouts} with the Station's Location already looked up. */
function pinnedPlace(
  state: WorldState,
  npc: NpcId,
  at: GameTime,
  station: LocId | undefined,
): LocId | 'absent' | undefined {
  const rel = state.relationships[npc];
  if (rel !== undefined && inStationCustody(rel, at)) {
    return station ?? 'absent';
  }
  const status = state.npcs[npc]?.status;
  if (status !== undefined) {
    const value = revealTruth(status);
    if (value === 'arrested' || value === 'fled') {
      return 'absent';
    }
  }
  if (rel !== undefined && inHostileHold(rel, at)) {
    return 'absent';
  }
  return undefined;
}

/**
 * Whether the Hostile Service holds the NPC at `at`: a `hostile` custody record
 * with no `until`, or one whose `until` has not yet come (the same reading the
 * live Disruption Context uses).
 */
function inHostileHold(rel: Relationship, at: GameTime): boolean {
  const custody = rel.custody;
  if (custody === undefined || custody.by !== 'hostile') {
    return false;
  }
  return custody.until === undefined || compareTime(at, custody.until) < 0;
}

/** The Station's Location: the lowest-id `station-hq` Location, if any. */
function stationLocationOf(state: WorldState): LocId | undefined {
  let found: LocId | undefined;
  for (const loc of Object.values(state.city.locations)) {
    const isStation =
      loc.type === STATION_LOCATION_TYPE ||
      loc.type.endsWith(`/${STATION_LOCATION_TYPE}`);
    if (isStation && (found === undefined || loc.id < found)) {
      found = loc.id;
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// 1. Schedules (Req 1.2)
// ---------------------------------------------------------------------------

/**
 * Move every free NPC to its scheduled Location at `to`, hold the pinned ones,
 * and write the changed `whereabouts`. `advanceSchedules` over the free NPCs
 * decides the `npc-moved` events. A move is kept only when the NPC was recorded
 * where its schedule had it at `from`: at a Day Boundary the schedules hook has
 * already made and recorded the boundary moves, and an NPC just let go from a
 * pin did not leave the place its schedule names.
 */
function stepSchedules(state: WorldState, from: GameTime, to: GameTime): SubStep {
  const station = stationLocationOf(state);
  const free: Record<NpcId, Npc> = {};
  let whereabouts: Record<NpcId, LocId | 'absent'> | undefined;

  for (const id of sortedIds(state.npcs)) {
    const npc = state.npcs[id];
    const pin = pinnedPlace(state, id, to, station);
    if (pin === undefined) {
      free[id] = npc;
    }
    const place = pin ?? scheduledLocationAt(npc, to) ?? 'absent';
    if (state.whereabouts[id] !== place) {
      whereabouts ??= { ...state.whereabouts };
      whereabouts[id] = place;
    }
  }

  const recordedAtFrom = (id: NpcId): LocId | 'absent' =>
    state.whereabouts[id] ?? scheduledLocationAt(state.npcs[id], from) ?? 'absent';
  const events = advanceSchedules(free, from, to).filter(
    (event) => event.kind !== 'npc-moved' || recordedAtFrom(event.npc) === event.from,
  );

  return {
    state: whereabouts === undefined ? state : { ...state, whereabouts },
    events,
  };
}

// ---------------------------------------------------------------------------
// 2. Meetings (Req 1.3, 1.4, 1.8)
// ---------------------------------------------------------------------------

/** The meetings sub-step also reports the first scene a kept meeting opened. */
interface MeetingsStep extends SubStep {
  readonly openScene?: TalkSceneRequest;
}

/** `resolveMeetingAtSlot`'s Fact Lines are not part of the Phase Step's output. */
const NO_FACT_LINES = (): string[] => [];

/**
 * Resolve every `accepted` or `void` meeting whose slot falls in the step
 * (`from` < slot ≤ `to`), by slot and then id.
 *
 * - An accepted meeting with an NPC who is free goes through
 *   `resolveMeetingAtSlot`, and its state, events and trust change are kept. A
 *   kept meeting records `lastContact` and may open the step's scene.
 * - An accepted meeting with an NPC who is out of play is voided at its slot.
 * - A void meeting raises `meeting-no-show` when the player is at its Location.
 */
function stepMeetings(state: WorldState, from: GameTime, to: GameTime, rng: Prng): MeetingsStep {
  const due = Object.values(state.meetings)
    .filter(
      (m) =>
        (m.status === 'accepted' || m.status === 'void') &&
        compareTime(m.slot, from) > 0 &&
        compareTime(m.slot, to) <= 0,
    )
    .sort((a, b) => compareTime(a.slot, b.slot) || compareIds(a.id, b.id));
  if (due.length === 0) {
    return { state, events: [] };
  }

  const station = stationLocationOf(state);
  let next = state;
  const events: SimEvent[] = [];
  let openScene: TalkSceneRequest | undefined;

  for (const meeting of due) {
    const outOfPlay = pinnedPlace(next, meeting.npc, meeting.slot, station) !== undefined;
    if (meeting.status === 'void' || outOfPlay) {
      const voided = voidAtSlot(next, meeting);
      next = voided.state;
      events.push(...voided.events);
      continue;
    }

    const slot = resolveMeetingAtSlot(next, meeting, NO_FACT_LINES);
    let after = withMeetingTrust(next, slot.next, meeting.npc, slot.trustDelta);
    if (slot.result.openScene !== undefined) {
      after = withContact(after, meeting.npc, meeting.slot);
      openScene ??= slot.result.openScene;
      const present = npcsAt(after, meeting.at, meeting.slot);
      const recognised = applyRecogniserPass(
        after,
        rng,
        after.meta.preset.detectionBase.surveil,
        present,
        present,
        meeting.slot,
        meeting.at,
      );
      const lines = [...recognised.seenBefore, ...(recognised.made ? [MADE_FACT_LINE] : [])];
      after = queueCarryLines(recognised.next, lines);
      events.push(...recognised.events);
    }
    next = after;
    events.push(...slot.result.events);
  }

  return openScene === undefined
    ? { state: next, events }
    : { state: next, events, openScene };
}

/**
 * A meeting that cannot take place: recorded `void`, with a `meeting-no-show`
 * when the player is at its Location at the slot.
 */
function voidAtSlot(state: WorldState, meeting: Meeting): SubStep {
  const next: WorldState =
    meeting.status === 'void'
      ? state
      : {
          ...state,
          meetings: { ...state.meetings, [meeting.id]: { ...meeting, status: 'void' } },
        };
  if (state.player.loc !== meeting.at) {
    return { state: next, events: [] };
  }
  return {
    state: next,
    events: [
      {
        id: `event:${meeting.id}:no-show`,
        at: meeting.slot,
        visibility: 'player',
        kind: 'meeting-no-show',
        meeting: meeting.id,
      },
    ],
  };
}

/**
 * Make sure a missed meeting's trust drop lands. `resolveMeetingAtSlot` lowers
 * the trust on the NPC's Relationship when there is one. An NPC with none yet (a
 * Starting-Brief contact) is given one, at the neutral trust the meeting maths
 * reads for them (`NEUTRAL_TRUST`) moved by the drop.
 */
function withMeetingTrust(
  before: WorldState,
  after: WorldState,
  npc: NpcId,
  trustDelta: number,
): WorldState {
  if (trustDelta === 0 || before.relationships[npc] !== undefined) {
    return after;
  }
  const rel: Relationship = {
    ...newRelationship(npc),
    channel: hasContactChannel(before, npc),
    trust: clamp01(NEUTRAL_TRUST + trustDelta),
  };
  return { ...after, relationships: { ...after.relationships, [npc]: rel } };
}

/** Record a contact at `at` on the NPC's Relationship, when there is one. */
function withContact(state: WorldState, npc: NpcId, at: GameTime): WorldState {
  const rel = state.relationships[npc];
  if (rel === undefined) {
    return state;
  }
  return {
    ...state,
    relationships: { ...state.relationships, [npc]: { ...rel, lastContact: at } },
  };
}

// ---------------------------------------------------------------------------
// 3. Cables (Req 1.5)
// ---------------------------------------------------------------------------

/** The core pack's HQ Cable template, for replies and Directive results. */
const CABLE_TEMPLATE_ID = 'cable-hq-directive';

/** The core pack's person-Dossier template, for trace replies. */
const DOSSIER_TEMPLATE_ID = 'dossier-hq-person';

/**
 * Deliver every Cable reply due at `to`. The Station's pending list, Standing,
 * ledger and last funds grant are written, and each reply becomes a Cable
 * Document (with a Dossier for a trace on a person) and one `cable` event.
 */
function stepCables(state: WorldState, to: GameTime, deps: PhaseStepDeps): SubStep {
  if (state.station.pendingCables.length === 0) {
    return { state, events: [] };
  }
  const processed = processDueCables(state.station, to, DEFAULT_FUNDS_POLICY);
  if (processed.replies.length === 0) {
    return { state, events: [] };
  }

  const sink = openSink(state);
  const namer = namerContextOf(state);
  const events: SimEvent[] = [];
  for (const reply of processed.replies) {
    const ref = freshCableRef(sink, to, 'R');
    const dossier = traceDossier(state, reply, ref, to, deps.content, namer);
    if (dossier !== undefined) {
      addComposed(sink, dossier);
    }
    const cable = composeCable(
      templateFor(deps.content, CABLE_TEMPLATE_ID),
      replyFields(reply, ref, dossier !== undefined),
      { ...namer, date: to },
    );
    addComposed(sink, cable);
    events.push(cableEvent(cable.document.id, to));
  }

  const station: WorldState['station'] = {
    ...state.station,
    pendingCables: processed.pendingCables,
    standing: processed.standing,
    ledger: processed.ledger,
    ...(processed.lastFundsGrant === undefined
      ? {}
      : { lastFundsGrant: processed.lastFundsGrant }),
  };
  return {
    state: {
      ...state,
      station,
      documents: sink.documents,
      documentPropositions: sink.documentPropositions,
    },
    events,
  };
}

/**
 * The Dossier a trace reply carries: HQ's file on the subject from the Station
 * Knowledge Slice (`composeDossier`), dated `at` and filed under
 * {@link traceDossierId}. Only a trace on a person in the world has one; any
 * other target (an organisation, a place, an id with no NPC behind it) is
 * answered by the Cable alone.
 */
function traceDossier(
  state: WorldState,
  reply: CableReply,
  ref: string,
  at: GameTime,
  content: ContentSet,
  namer: NamerContext,
): ComposedDocument | undefined {
  const target = reply.traceTarget;
  if (reply.pending.reply.kind !== 'trace' || target === undefined || !target.startsWith('npc:')) {
    return undefined;
  }
  const subject = state.npcs[target as NpcId];
  if (subject === undefined) {
    return undefined;
  }
  const composed = composeDossier(templateFor(content, DOSSIER_TEMPLATE_ID), subject, {
    ...namer,
    stationSlice: state.station.knowledge,
  });
  return {
    document: { ...composed.document, id: traceDossierId(ref), date: at },
    propositions: composed.propositions,
  };
}

/** The telegraphic fields of a reply Cable, by request kind. */
function replyFields(reply: CableReply, ref: string, withDossier: boolean): CableFields {
  switch (reply.pending.reply.kind) {
    case 'trace':
      return {
        cableRef: ref,
        // The subject is the traced entity's id, so the namer prints its name.
        subject: reply.traceTarget ?? 'TRACE REQUEST',
        instruction: withDossier
          ? 'TRACE COMPLETED STOP HQ FILE ON SUBJECT FOLLOWS AS DOSSIER STOP TREAT AS LEADS ONLY'
          : 'TRACE COMPLETED STOP HQ HOLDS NO PERSONAL FILE ON SUBJECT',
      };
    case 'funds':
      return reply.didGrantFunds
        ? {
            cableRef: ref,
            subject: 'FUNDS REQUEST',
            instruction: 'FUNDS APPROVED',
            budgetLine: `${reply.fundsGranted} CREDITED TO STATION ACCOUNT`,
          }
        : {
            cableRef: ref,
            subject: 'FUNDS REQUEST',
            instruction:
              'NO FUNDS RELEASED AT THIS TIME STOP RESUBMIT AFTER THE CURRENT PERIOD',
          };
    case 'report':
      return {
        cableRef: ref,
        subject: 'FIELD REPORT',
        instruction: 'YOUR REPORT IS RECEIVED STOP CONTINUE AS INSTRUCTED',
      };
  }
}

// ---------------------------------------------------------------------------
// 4. Directives (Req 1.6, 6.4)
// ---------------------------------------------------------------------------

/**
 * Check the open Directives at `to` with `deps.objectives(state)`. The
 * Directives and Standing are written, and each settled Directive's `directive`
 * event is followed by the Cable HQ sends about it and that Cable's `cable`
 * event. With no open Directive the evaluator is not built.
 */
function stepDirectives(state: WorldState, to: GameTime, deps: PhaseStepDeps): SubStep {
  if (!state.station.directives.some((d) => d.status === 'open')) {
    return { state, events: [] };
  }
  const checked = checkDirectives(state.station, to, deps.objectives(state));
  if (checked.events.length === 0) {
    return { state, events: [] };
  }

  const byId = new Map<string, Directive>(checked.directives.map((d) => [d.id, d]));
  const sink = openSink(state);
  const namer = namerContextOf(state);
  const events: SimEvent[] = [];
  for (const event of checked.events) {
    events.push(event);
    if (event.kind !== 'directive' || event.status === 'issued') {
      continue;
    }
    const ref = freshCableRef(sink, to, 'D');
    const cable = composeCable(
      templateFor(deps.content, CABLE_TEMPLATE_ID),
      directiveFields(byId.get(event.directive), event.status, ref),
      { ...namer, date: to },
    );
    addComposed(sink, cable);
    events.push(cableEvent(cable.document.id, to));
  }

  return {
    state: {
      ...state,
      station: {
        ...state.station,
        directives: checked.directives,
        standing: checked.standing,
      },
      documents: sink.documents,
      documentPropositions: sink.documentPropositions,
    },
    events,
  };
}

/** The telegraphic fields of the Cable HQ sends when a Directive settles. */
function directiveFields(
  directive: Directive | undefined,
  status: 'met' | 'failed',
  ref: string,
): CableFields {
  return {
    cableRef: ref,
    priority: 'PRIORITY',
    subject: directive === undefined ? 'DIRECTIVE' : `DIRECTIVE ${directive.text.toUpperCase()}`,
    instruction:
      status === 'met'
        ? 'OBJECTIVE ACHIEVED STOP STANDING WITH HQ RAISED'
        : 'DEADLINE PASSED WITHOUT RESULT STOP STANDING WITH HQ REDUCED',
  };
}

// ---------------------------------------------------------------------------
// 5. Retainers (Req 1.7, 1.8)
// ---------------------------------------------------------------------------

/**
 * For each money-motivated Asset carrying a retainer: raise `retainer-due` in
 * the step the retainer falls due (`from` < `paidThrough` ≤ `to`), and take
 * `RETAINER_DECAY_PER_PHASE` trust for each phase that became overdue past the
 * grace period in the step. Assets are visited in id order.
 */
function stepRetainers(state: WorldState, from: GameTime, to: GameTime): SubStep {
  const events: SimEvent[] = [];
  let relationships: Record<NpcId, Relationship> | undefined;

  for (const id of sortedIds(state.relationships)) {
    const rel = state.relationships[id];
    const retainer = rel.retainer;
    if (retainer === undefined || !subjectToRetainerDecay(rel, state.npcs)) {
      continue;
    }
    if (fallsDueIn(retainer, from, to)) {
      events.push({
        id: `retainer-due:${id}:${to.day}:${to.phase}`,
        at: to,
        visibility: 'player',
        kind: 'retainer-due',
        npc: id,
        amount: retainer.amount,
      });
    }
    const newlyOverdue = overduePhases(retainer, to) - overduePhases(retainer, from);
    if (newlyOverdue > 0) {
      relationships ??= { ...state.relationships };
      relationships[id] = addTrust(rel, -RETAINER_DECAY_PER_PHASE * newlyOverdue);
    }
  }

  return {
    state: relationships === undefined ? state : { ...state, relationships },
    events,
  };
}

/** Whether the retainer's due date falls in the step (`from` < due ≤ `to`). */
function fallsDueIn(retainer: Retainer, from: GameTime, to: GameTime): boolean {
  return compareTime(from, retainer.paidThrough) < 0 && compareTime(retainer.paidThrough, to) <= 0;
}

// ---------------------------------------------------------------------------
// 6. Consequences (Req 1.8)
// ---------------------------------------------------------------------------

/** `asset-silent` once per silence, then `drop-unserviced`. */
function stepConsequences(state: WorldState, to: GameTime): SubStep {
  const silences = stepSilences(state, to);
  const drops = stepUnservicedDrops(silences.state, to);
  return { state: drops.state, events: [...silences.events, ...drops.events] };
}

/**
 * Raise `asset-silent` for each Asset whose last contact or report is at least
 * `scenario.silenceDays` days (in phases) before `to`, once per silence, and
 * clear `silenceNotified` on an Asset that is no longer silent.
 */
function stepSilences(state: WorldState, to: GameTime): SubStep {
  const silencePhases = state.meta.scenario.silenceDays * PHASES_PER_DAY;
  const events: SimEvent[] = [];
  let relationships: Record<NpcId, Relationship> | undefined;

  for (const id of sortedIds(state.relationships)) {
    const rel = state.relationships[id];
    if (!isAsset(rel)) {
      continue;
    }
    const last = lastHeardFrom(rel);
    if (last === undefined) {
      continue;
    }
    const quiet = timeToPhases(to) - timeToPhases(last);
    if (quiet >= silencePhases) {
      if (rel.silenceNotified === true) {
        continue;
      }
      events.push({
        id: `asset-silent:${id}:${to.day}:${to.phase}`,
        at: to,
        visibility: 'player',
        kind: 'asset-silent',
        npc: id,
        days: Math.floor(quiet / PHASES_PER_DAY),
      });
      relationships ??= { ...state.relationships };
      relationships[id] = { ...rel, silenceNotified: true };
    } else if (rel.silenceNotified === true) {
      relationships ??= { ...state.relationships };
      relationships[id] = withoutSilenceNotified(rel);
    }
  }

  return {
    state: relationships === undefined ? state : { ...state, relationships },
    events,
  };
}

/** The later of the Asset's last contact and last report, if either is set. */
function lastHeardFrom(rel: Relationship): GameTime | undefined {
  const { lastContact, lastReport } = rel;
  if (lastContact === undefined) {
    return lastReport;
  }
  if (lastReport === undefined) {
    return lastContact;
  }
  return compareTime(lastContact, lastReport) >= 0 ? lastContact : lastReport;
}

/**
 * Raise `drop-unserviced` for each of the player's own drops whose expected
 * loader is out of play while the player is at the drop's Location, and clear
 * that drop's `expectedLoader` so the missing load is reported once.
 */
function stepUnservicedDrops(state: WorldState, to: GameTime): SubStep {
  const station = stationLocationOf(state);
  const events: SimEvent[] = [];
  let deadDrops: Record<DeadDropId, DeadDrop> | undefined;

  for (const id of [...state.player.known.drops].sort(compareIds)) {
    const drop: DeadDrop | undefined = state.deadDrops[id];
    const loader = drop?.expectedLoader;
    if (drop === undefined || loader === undefined || state.player.loc !== drop.loc) {
      continue;
    }
    if (pinnedPlace(state, loader, to, station) === undefined) {
      continue;
    }
    events.push({
      id: `drop-unserviced:${id}:${to.day}:${to.phase}`,
      at: to,
      visibility: 'player',
      kind: 'drop-unserviced',
      drop: id,
    });
    deadDrops ??= { ...state.deadDrops };
    deadDrops[id] = withoutExpectedLoader(drop);
  }

  return {
    state: deadDrops === undefined ? state : { ...state, deadDrops },
    events,
  };
}

// ---------------------------------------------------------------------------
// 7. Custody (design step 7)
// ---------------------------------------------------------------------------

/**
 * Release each Station Custody hold whose `until` has come (`until` ≤ `to`):
 * the hold is cleared, the slice's custody-release suspicion for the time held
 * (`custodyReleaseSuspicion` at `until`) is added to the Relationship's
 * suspicion, and `custody-released` is raised. An open hold (no `until`) and a
 * Hostile Service hold are left alone.
 */
function stepCustody(state: WorldState, to: GameTime): SubStep {
  const events: SimEvent[] = [];
  let relationships: Record<NpcId, Relationship> | undefined;

  for (const id of sortedIds(state.relationships)) {
    const rel = state.relationships[id];
    const custody = rel.custody;
    if (
      custody === undefined ||
      custody.by !== 'station' ||
      custody.until === undefined ||
      compareTime(custody.until, to) > 0
    ) {
      continue;
    }
    relationships ??= { ...state.relationships };
    relationships[id] = withoutCustody(
      rel,
      rel.suspicion + custodyReleaseSuspicion(custody, custody.until),
    );
    events.push({
      id: `custody-released:${id}:${to.day}:${to.phase}`,
      at: to,
      visibility: 'player',
      kind: 'custody-released',
      npc: id,
    });
  }

  return {
    state: relationships === undefined ? state : { ...state, relationships },
    events,
  };
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/** A working copy of the Draft's Documents for one sub-step to add to. */
interface DocumentSink {
  readonly documents: Record<DocId, Document>;
  readonly documentPropositions: Record<PropId, Proposition>;
}

/** Copy the Draft's Documents and their Propositions into a fresh sink. */
function openSink(state: WorldState): DocumentSink {
  return {
    documents: { ...state.documents },
    documentPropositions: { ...state.documentPropositions },
  };
}

/** Add a composed Document and the Propositions it asserts to the sink. */
function addComposed(sink: DocumentSink, composed: ComposedDocument): void {
  sink.documents[composed.document.id] = composed.document;
  for (const prop of composed.propositions) {
    sink.documentPropositions[prop.id] = prop;
  }
}

/**
 * A Cable reference no Document uses yet: `HQ-<day>.<phase>-<tag><n>` with the
 * lowest `n` from 1 whose Cable id and trace Dossier id are both free.
 */
function freshCableRef(sink: DocumentSink, at: GameTime, tag: 'R' | 'D'): string {
  const refFor = (n: number): string => `HQ-${at.day}.${at.phase}-${tag}${n}`;
  const taken = (ref: string): boolean =>
    sink.documents[docId('cable', ref)] !== undefined ||
    sink.documents[traceDossierId(ref)] !== undefined;
  let n = 1;
  while (taken(refFor(n))) {
    n += 1;
  }
  return refFor(n);
}

/** The id a trace reply's Dossier is filed under, from its Cable reference. */
function traceDossierId(ref: string): DocId {
  return docId('dossier', `trace ${ref}`);
}

/** The player-visible `cable` event delivering one Cable Document. */
function cableEvent(doc: DocId, at: GameTime): SimEvent {
  return { id: `cable-evt:${doc}`, at, visibility: 'player', kind: 'cable', doc };
}

/** The namer context the Document composers render through. */
function namerContextOf(state: WorldState): NamerContext {
  return { city: state.city, npcs: state.npcs, orgs: state.orgs };
}

/**
 * A Document template by its local id (bare or namespaced). Generation requires
 * the same templates, so a missing one is a content-pack gap.
 */
function templateFor(content: ContentSet, local: string): DocumentTemplate {
  for (const [key, value] of content.documentTemplates) {
    if (key === local || key.endsWith(`/${local}`)) {
      return value;
    }
  }
  throw new Error(`phaseStep(): the content set has no Document template "${local}"`);
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** A record's NPC-id keys in sorted order. */
function sortedIds<T>(record: Readonly<Record<NpcId, T>>): NpcId[] {
  return (Object.keys(record) as NpcId[]).sort(compareIds);
}

/** Order two ids by code unit, the order every sweep here uses. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Clamp a value into `[0, 1]` (trust lives in that range). */
function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** A copy of the Relationship without `silenceNotified`. */
function withoutSilenceNotified(rel: Relationship): Relationship {
  const copy: { -readonly [K in keyof Relationship]: Relationship[K] } = { ...rel };
  delete copy.silenceNotified;
  return copy;
}

/** A copy of the Relationship with its custody cleared and `suspicion` set. */
function withoutCustody(rel: Relationship, suspicion: number): Relationship {
  const copy: { -readonly [K in keyof Relationship]: Relationship[K] } = {
    ...rel,
    suspicion,
  };
  delete copy.custody;
  return copy;
}

/** A copy of the drop without `expectedLoader`. */
function withoutExpectedLoader(drop: DeadDrop): DeadDrop {
  const copy: { -readonly [K in keyof DeadDrop]: DeadDrop[K] } = { ...drop };
  delete copy.expectedLoader;
  return copy;
}

/** `day N phase P`, for error messages. */
function formatTime(t: GameTime): string {
  return `day ${t.day} phase ${t.phase}`;
}

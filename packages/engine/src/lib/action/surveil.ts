/**
 * The surveil and follow actions (design, "Action Resolver" → **Surveil** /
 * **Follow**; Requirements 12.5, 23.1, 23.2, 23.3, 23.6, 23.7).
 *
 * Both actions let the player *see things for themselves*: a static watch of a
 * Location, or a tail that steps a target's schedule. Each turns the people and
 * contacts it observes into surveillance Observations → Fact Lines → Case File
 * Claims sourced `{ kind:'surveillance', loc }`, and each runs a detection check
 * that can leave the player "made".
 *
 * ## Surveil (Req 23.1, 23.2, 23.6, 23.7)
 *
 * `{ kind:'surveil'; at: LocId; phases: 1 | 2 }` — the player watches a Location
 * for one or two phases. Surveillance *observes the Sim events* that happen at
 * the Location in the window (design, "Surveil": "For each event at the Location
 * in the window, the observation check passes with `p = base × crowdFactor ×
 * weatherFactor × (1 − participant.tradecraft)`"). The Sim events are the real
 * meetings, dead-drop loads/empties and movements plot-execution emits bound to
 * concrete participants and places (task 26.1/26.2); each event that passes the
 * check becomes an Observation that *matches an actual Sim event* — a `meeting`
 * event becomes a `MEETS_AT` contact between its participants (and a
 * `LOCATED_AT` sighting of each), a drop or a move becomes a `LOCATED_AT`
 * sighting of the acting NPC. **Co-presence is a sighting, never a meeting**: an
 * NPC merely scheduled at the Location with no meeting event there produces only
 * a `LOCATED_AT` sighting — two people standing in the same square are not, by
 * that fact alone, meeting (Req 23.1). This is what makes the surveillance
 * fidelity property hold (task 11.9): every `MEETS_AT` Observation corresponds
 * to a real meeting event at that Location and time.
 *
 * Observations of NPCs the player has not identified surface as their `unk:N` id
 * through the Unidentified-Subject machinery (`./identify.ts`), so a watched
 * stranger appears as a descriptor and a stable `unk:` id that later
 * identification can resolve. A detection check fires per watched phase against
 * the preset's base surveil rate scaled by each present NPC's security
 * consciousness; on a hit, suspicion and Cover Suspicion rise and — with the
 * preset reveal probability — a "you may have been made" Fact Line shows. Static
 * surveillance carries a *lower* detection risk than following.
 *
 * ## Follow (Req 23.3, 23.6, 23.7)
 *
 * `{ kind:'follow'; target: NpcId | UnkId }` — the player tails a target through
 * the *current* phase. It steps the target's schedule within the phase: it
 * observes the target's Location (`LOCATED_AT` sighting) and the Sim events at
 * that Location this phase (a `meeting` the target takes part in becomes a
 * `MEETS_AT` contact; a drop or move becomes a sighting), running a per-step
 * detection check at a *higher* rate than static surveillance. As with surveil,
 * co-presence is reported as a sighting, never as a meeting — a `MEETS_AT` only
 * ever comes from an observed meeting event. The follow ends when the target
 * enters a non-public Location (one the player cannot enter), the phase ends, or
 * detection fires.
 *
 * Because the slice's clock is a single phase per step and an NPC's schedule is
 * keyed by `(weekday, phase)`, "stepping the schedule within the current phase"
 * resolves to the target's one scheduled Location this phase; the follow
 * observes it and the contacts there, then ends (phase boundary) unless the
 * target's Location is non-public (ends immediately with nothing observed) or
 * detection fires first. The per-step structure is kept explicit so a later
 * finer clock can step more than once without reshaping the resolver.
 *
 * ## Purity and the Truth boundary
 *
 * `quoteSurveil` / `quoteFollow` are pure and draw nothing. `resolveSurveil` /
 * `resolveFollow` draw only the detection coins from the passed {@link Prng}, in
 * a fixed order, so the same inputs always yield the same result. Observing an
 * unidentified NPC allocates a stable `unk:` id and records the `identityOf`
 * mapping in the Truth Store (through `visiblePersons`/`allocateUnk`), so both
 * resolvers take a {@link TruthAccess}; the allocation itself is deterministic.
 *
 * Fact Line rendering is left to the caller (a `render` callback), exactly as
 * `./read.ts` does, so this module never imports `./action.ts` and no import
 * cycle forms.
 */

import {
  asTruth,
  revealTruth,
  timeToPhases,
  type GameTime,
  type LocId,
  type NpcId,
  type Proposition,
  type UnkId,
} from '../model/core.js';
import type { SimEvent, WorldState } from '../model/state.js';
import type { Prng } from '../prng/prng.js';
import { scheduledLocation } from '../city/npc.js';
import { CONTENT_WEEKDAYS, weekdayForDay } from '../city/time-mapping.js';
import type { TruthAccess, TruthReader } from '../truth/truth.js';
import { visiblePersons } from './identify.js';
import type { ActionQuote, ActionResult, Observation } from './result.js';
import type { FollowAction, ObservationSource, SurveilAction } from './types.js';

// ---------------------------------------------------------------------------
// Detection and suspicion constants (Req 23.6, 23.7)
// ---------------------------------------------------------------------------
//
// The design's detection formula is `p = presetBase × security × (1 −
// crowdCover) × (1 + 0.5·repeatCount)`. This task implements the preset-base ×
// security core — the crowd-cover and repeat-count factors need the loaded
// weather and a repeat-surveillance tally the Turn Pipeline owns, so they are
// left as documented 1.0 factors here and threaded in later. The two bases come
// from the Difficulty Preset: static surveillance uses `detectionBase.surveil`
// directly; following multiplies it by FOLLOW_DETECTION_FACTOR so a tail is
// strictly riskier than a static watch (design: "Detection risk per step is
// higher than for static surveillance"). The "made" Fact Line shows with the
// preset's `madeRevealProbability`.

/**
 * The factor following multiplies the static-surveillance detection base by, so
 * a tail is strictly riskier than a static watch (design, "Follow": higher
 * detection risk per step). `> 1`, so for any positive base surveil rate the
 * follow rate exceeds it.
 */
export const FOLLOW_DETECTION_FACTOR = 2;

/**
 * How much a detection ("being made") raises the player's suspicion / Cover
 * Suspicion (`WorldState.player.coverSuspicion`). A documented default until a
 * preset field drives it; one detection moves Cover Suspicion by this much,
 * clamped into `[0, 1]`.
 */
export const DETECTION_SUSPICION_DELTA = 0.1;

/** The phase cost of following: it consumes the current phase. */
export const FOLLOW_PHASE_COST = 1;

/** The "you may have been made" Fact Line a detection may surface (Req 23.7). */
export const MADE_FACT_LINE = 'You sense you may have been made.';

// ---------------------------------------------------------------------------
// Shared helpers (scheduling and preset reads)
// ---------------------------------------------------------------------------

/**
 * The NPCs scheduled at a Location at a given time, by id in deterministic
 * order. A local copy of `./action.ts`'s `visibleNpcsAt` so this module does
 * not import `./action.ts` (which imports *this* module to route the actions)
 * and form a cycle — the same local-helper pattern `./travel.ts` and
 * `./read.ts` use for their scene descriptors.
 *
 * Exported so the wait action (`./intercept.ts`, task 11.7) can reuse the exact
 * same scheduling read when it makes its passive observations, keeping the two
 * observation paths DRY against a single source of "who is here now".
 */
export function npcsScheduledAt(state: WorldState, locId: LocId): NpcId[] {
  const weekday = CONTENT_WEEKDAYS.indexOf(weekdayForDay(state.time.day));
  const out: NpcId[] = [];
  for (const npc of Object.values(state.npcs)) {
    if (scheduledLocation(npc.schedule, weekday, state.time.phase) === locId) {
      out.push(npc.id);
    }
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The base per-check detection probability for static surveillance (preset). */
export function surveilDetectionBase(state: WorldState): number {
  return state.meta.preset.detectionBase.surveil;
}

/** The base per-step detection probability for following (preset × factor). */
export function followDetectionBase(state: WorldState): number {
  return surveilDetectionBase(state) * FOLLOW_DETECTION_FACTOR;
}

/** The preset probability a detection surfaces the "made" Fact Line (Req 23.7). */
export function madeRevealProbability(state: WorldState): number {
  return state.meta.preset.madeRevealProbability;
}

/** Clamp a value into `[0, 1]` (Cover Suspicion lives in that range). */
function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** The scene descriptor for a Location, built locally to avoid an action.ts cycle. */
function sceneDescriptorAt(state: WorldState, loc: LocId): ActionResult['scene'] {
  const place = state.city.locations[loc];
  if (place === undefined) {
    return { loc, description: '', atmosphere: [], risk: 0, visible: [] };
  }
  return {
    loc,
    description: place.description,
    atmosphere: [...place.atmosphere],
    risk: place.risk,
    visible: npcsScheduledAt(state, loc),
  };
}

// ---------------------------------------------------------------------------
// Observation building (surveillance Propositions)
// ---------------------------------------------------------------------------

/** A stable PropId for a surveillance sighting of a subject at a Location. */
function locatedPropId(subject: string, loc: LocId, at: GameTime): string {
  return `surveil:located:${subject}@${loc}:${at.day}.${at.phase}`;
}

/** A stable PropId for a surveillance contact between two subjects at a Location. */
function meetsPropId(a: string, b: string, loc: LocId, at: GameTime): string {
  return `surveil:meets:${a}+${b}@${loc}:${at.day}.${at.phase}`;
}

/**
 * Build the surveillance **sighting** Observations for a set of persons seen at
 * a Location at a time: a `LOCATED_AT` sighting for each person. The persons are
 * passed as the player sees them (`npc:` for identified, `unk:` for not), so the
 * resulting Propositions reference `unk:` ids where appropriate (Req 23.4) and
 * the Case File relates them to a named NPC only after a held `IS_ALIAS_OF`
 * Claim.
 *
 * This produces **only** sightings — co-presence is a sighting, never a meeting
 * (Req 23.1). A `MEETS_AT` contact comes from an observed `meeting` Sim event
 * (see {@link observationsForEvent}), not from two people merely being scheduled
 * at the same square; that is what keeps every surveillance `MEETS_AT` Claim
 * corresponding to a real meeting event (surveillance fidelity, task 11.9).
 *
 * `LOCATED_AT`'s object slot is required to be an entity by the predicate, yet
 * its third-person template renders only `{place}`/`{when}` — so the subject is
 * reused as the object (a self-reference that renders to the sighting line),
 * keeping the Proposition well-formed without inventing a second person.
 *
 * Exported so the wait action (`./intercept.ts`, task 11.7) builds its passive
 * sighting Observations through exactly the same constructor — the only
 * difference is that wait feeds it a *reduced* set of present persons (×0.4 the
 * surveil yield) and runs no detection check.
 *
 * Every Observation is sourced `{ kind:'surveillance', loc }`: the player saw
 * it at the watched Location, which is also each sighting's `place`.
 */
export function observationsFor(
  persons: readonly string[],
  loc: LocId,
  at: GameTime,
): Observation[] {
  const window = { from: at };
  const source = surveillanceSource(loc);
  const out: Observation[] = [];
  for (const person of persons) {
    const prop: Proposition = {
      id: locatedPropId(person, loc, at),
      subject: person as Proposition['subject'],
      predicate: 'LOCATED_AT',
      object: person as Proposition['object'],
      place: loc,
      window,
    };
    out.push({ kind: 'proposition', prop, at, source });
  }
  return out;
}

/**
 * The {@link ObservationSource} of a surveillance Observation made at `loc`:
 * `{ kind:'surveillance', loc }`. Surveil, follow and wait all observe through
 * {@link observationsFor} and {@link observeEvents}, so they share this source.
 */
function surveillanceSource(loc: LocId): ObservationSource {
  return { kind: 'surveillance', loc };
}

// ---------------------------------------------------------------------------
// Observing Sim events (design, "Surveil": observe each event in the window)
// ---------------------------------------------------------------------------

/**
 * The base per-event surveillance observation probability (design, "Surveil":
 * the `base` of `p = base × crowdFactor × weatherFactor × (1 − participant
 * .tradecraft)`). An active watch of a Location sees an event that happens in
 * plain view with near-certainty absent any evasion, so the base is `1`; the
 * real driver that lets an event slip the watch is the participants' tradecraft
 * (`1 − participant.tradecraft`). The crowd and weather factors are documented
 * `1.0` here — resolving a crowd band needs the loaded weather and `CityData`
 * the resolver does not hold (the same `crowdPenaltyProxy` boundary
 * `./arrange-meeting.ts` documents) — and are threaded in when the Turn Pipeline
 * supplies the day's weather, exactly as the detection formula's crowd-cover and
 * repeat-count factors are.
 */
export const SURVEIL_OBSERVATION_BASE = 1;

/** A documented crowd factor for the observation check, `1.0` until weather is threaded in. */
const CROWD_FACTOR = 1;

/** A documented weather factor for the observation check, `1.0` until weather is threaded in. */
const WEATHER_FACTOR = 1;

/**
 * The observation-check probability for one event, driven by the participants'
 * tradecraft (design, "Surveil"): `base × crowdFactor × weatherFactor × (1 −
 * participant.tradecraft)`. With multiple participants the hardest to observe
 * governs — the most careful participant's tradecraft is used (`(1 − max
 * tradecraft)`), so a skilled operative shields the event. An event with no
 * resolvable participant uses tradecraft `0` (nothing to evade the watch).
 */
function observationProbability(
  state: WorldState,
  base: number,
  participants: readonly NpcId[],
): number {
  let maxTradecraft = 0;
  for (const id of participants) {
    const npc = state.npcs[id];
    if (npc === undefined) {
      continue;
    }
    const tradecraft = revealTruth(npc.tradecraft);
    if (tradecraft > maxTradecraft) {
      maxTradecraft = tradecraft;
    }
  }
  // Tradecraft is how good the participants are; the Hostile Service's
  // security consciousness is how hard its doctrine makes them use it. A
  // skilled operative under a lax service still gets careless.
  const security = clamp01(state.hostile.doctrine.securityConsciousness);
  return clamp01(base * CROWD_FACTOR * WEATHER_FACTOR * (1 - maxTradecraft * security));
}

/**
 * The Location a Sim event happens *at*, or `undefined` when the event is not
 * sited at a Location (a `transmission` runs on a Channel; most player-visible
 * kinds carry no place). Surveillance of a Location observes only the events
 * sited there: a `meeting` at its `loc`, a `drop-loaded`/`drop-emptied` at its
 * drop's `loc`, an `npc-moved` at its destination `to`.
 */
function eventLocation(state: WorldState, event: SimEvent): LocId | undefined {
  switch (event.kind) {
    case 'meeting':
      return event.loc;
    case 'npc-moved':
      return event.to;
    case 'drop-loaded':
    case 'drop-emptied': {
      const drop = state.deadDrops[event.drop];
      return drop === undefined ? undefined : drop.loc;
    }
    default:
      return undefined;
  }
}

/** The NPCs taking part in an observable event (its participants / acting NPC). */
function eventParticipants(event: SimEvent): readonly NpcId[] {
  switch (event.kind) {
    case 'meeting':
      return event.participants;
    case 'npc-moved':
      return [event.npc];
    case 'drop-loaded':
    case 'drop-emptied':
      return [event.by];
    default:
      return [];
  }
}

/**
 * The Sim events this surveillance observes: the events in {@link events} sited
 * at {@link loc} whose time falls in the half-open window `[from, from +
 * phases)` (the span the watch covers). Returned in time order (stable: the
 * input is already time-ordered, and the filter preserves it). The window is
 * measured in phases from the watch's start so a 2-phase watch sees an event one
 * phase later than its start, a 1-phase watch does not.
 */
export function eventsInWindow(
  state: WorldState,
  events: readonly SimEvent[],
  loc: LocId,
  from: GameTime,
  phases: number,
): SimEvent[] {
  const start = timeToPhases(from);
  const end = start + Math.max(1, phases);
  const out: SimEvent[] = [];
  for (const event of events) {
    if (eventLocation(state, event) !== loc) {
      continue;
    }
    const t = timeToPhases(event.at);
    if (t < start || t >= end) {
      continue;
    }
    out.push(event);
  }
  return out;
}

/**
 * Build the Observations for one observed Sim event (design, "Surveil"): a
 * `meeting` yields a `LOCATED_AT` sighting of each participant *and* a `MEETS_AT`
 * contact for each unordered pair of participants (the participants are *in fact*
 * meeting — this is a real meeting event, not inferred co-presence); a drop or a
 * move yields a `LOCATED_AT` sighting of the acting NPC. The acting NPCs are
 * passed as the player sees them (`npc:` or `unk:`), already resolved to the
 * event's participants in {@link eventParticipants} order, so the Propositions
 * reference `unk:` ids where appropriate (Req 23.4).
 *
 * The observation time is the event's own time, so every resulting Claim is true
 * at its observed time (Req 23.3) — the event is what the Sim actually did at the
 * Location then. Every Observation is sourced `{ kind:'surveillance', loc }`.
 */
function observationsForEvent(
  event: SimEvent,
  seenParticipants: readonly string[],
  loc: LocId,
): Observation[] {
  const at = event.at;
  const window = { from: at };
  const source = surveillanceSource(loc);
  const out: Observation[] = [];
  // Every observed participant is sighted at the Location at the event's time.
  for (const person of seenParticipants) {
    const prop: Proposition = {
      id: locatedPropId(person, loc, at),
      subject: person as Proposition['subject'],
      predicate: 'LOCATED_AT',
      object: person as Proposition['object'],
      place: loc,
      window,
    };
    out.push({ kind: 'proposition', prop, at, source });
  }
  // A meeting event — and only a meeting event — yields MEETS_AT contacts.
  if (event.kind === 'meeting') {
    for (let i = 0; i < seenParticipants.length; i += 1) {
      for (let j = i + 1; j < seenParticipants.length; j += 1) {
        const prop: Proposition = {
          id: meetsPropId(seenParticipants[i], seenParticipants[j], loc, at),
          subject: seenParticipants[i] as Proposition['subject'],
          predicate: 'MEETS_AT',
          object: seenParticipants[j] as Proposition['object'],
          place: loc,
          window,
        };
        out.push({ kind: 'proposition', prop, at, source });
      }
    }
  }
  return out;
}

/**
 * The result of observing the events at a Location in a window: the next state
 * (carrying any newly-allocated `unk:` ids), the Observations, and their
 * `claimsAdded` ids. Pure beyond the `unk:` allocation; draws nothing.
 *
 * Each event in {@link eventsInWindow} runs the observation check
 * ({@link observationProbability}) against the passed {@link Prng}, in the
 * events' time order, so the draw sequence is deterministic. An event whose coin
 * passes becomes its Observations ({@link observationsForEvent}); an event whose
 * coin fails is not observed (the participants' tradecraft slipped the watch). A
 * `coin` that always returns a value `< p` observes everything; one that returns
 * `≥ p` observes nothing — the tests use fixed coins to pin this down.
 */
export function observeEvents(
  state: WorldState,
  events: readonly SimEvent[],
  loc: LocId,
  from: GameTime,
  phases: number,
  rng: Prng,
  truth: TruthAccess,
  base: number,
): { next: WorldState; observations: Observation[]; claimsAdded: string[] } {
  let next = state;
  const observations: Observation[] = [];
  const claimsAdded: string[] = [];
  const inWindow = eventsInWindow(state, events, loc, from, phases);
  for (const event of inWindow) {
    const participants = eventParticipants(event);
    const p = observationProbability(next, base, participants);
    if (rng.next() >= p) {
      // The event slipped the watch (participant tradecraft); not observed.
      continue;
    }
    const seen = visiblePersons(next, truth, participants);
    next = seen.next;
    for (const obs of observationsForEvent(event, seen.visible, loc)) {
      observations.push(obs);
      if (obs.kind === 'proposition') {
        claimsAdded.push(obs.prop.id);
      }
    }
  }
  return { next, observations, claimsAdded };
}

/**
 * The Sim events an observing action reads for its window: the caller-supplied
 * {@link events} when present (the Turn Pipeline runs the clock over the watched
 * span and passes what it produced), else `WorldState.scheduled` — the
 * future-events queue the clock fills as it advances. Threading the pipeline's
 * freshly-computed events keeps the observation current; the `scheduled`
 * fallback keeps every observation path sourced when no caller supplies events.
 */
export function windowEvents(
  state: WorldState,
  events: readonly SimEvent[] | undefined,
): readonly SimEvent[] {
  return events ?? state.scheduled;
}

// ---------------------------------------------------------------------------
// Detection (Req 23.6, 23.7)
// ---------------------------------------------------------------------------

/**
 * The combined detection probability for a watch of a set of present NPCs: the
 * base rate scaled by the highest security consciousness among them (the most
 * watchful participant drives the risk). An empty set — nobody to notice the
 * watcher — cannot detect, so the probability is 0. The security read is a
 * Truth-Store-adjacent ground-truth field on the NPC, used only to size the
 * coin, never surfaced.
 */
function detectionProbability(
  state: WorldState,
  base: number,
  present: readonly NpcId[],
): number {
  let maxSecurity = 0;
  for (const id of present) {
    const npc = state.npcs[id];
    if (npc === undefined) {
      continue;
    }
    const security = revealTruth(npc.securityConsciousness);
    if (security > maxSecurity) {
      maxSecurity = security;
    }
  }
  if (present.length === 0) {
    return 0;
  }
  return clamp01(base * maxSecurity);
}

/** The outcome of a detection draw: whether the player was made, and the "made" line. */
interface DetectionOutcome {
  readonly detected: boolean;
  /** A `message` Observation for the "made" Fact Line, when it shows. */
  readonly madeObservation?: Observation;
}

/**
 * Run one detection check against the present NPCs (Req 23.6). Draws the
 * detection coin, then — only on a hit — the reveal coin, in that fixed order,
 * so the draw sequence is deterministic. A hit means the player was made; the
 * "made" Fact Line is surfaced only when the reveal coin falls under the
 * preset's `madeRevealProbability` (Req 23.7), so a detection can raise
 * suspicion silently.
 */
function runDetection(
  state: WorldState,
  rng: Prng,
  base: number,
  present: readonly NpcId[],
): DetectionOutcome {
  const p = detectionProbability(state, base, present);
  const detected = rng.next() < p;
  if (!detected) {
    return { detected: false };
  }
  const reveal = rng.next() < madeRevealProbability(state);
  return {
    detected: true,
    madeObservation: reveal ? { kind: 'message', line: MADE_FACT_LINE } : undefined,
  };
}

/** Raise the player's suspicion / Cover Suspicion by the detection delta. */
function raiseCoverSuspicion(state: WorldState): WorldState {
  const next = clamp01(revealTruth(state.player.coverSuspicion) + DETECTION_SUSPICION_DELTA);
  return {
    ...state,
    player: { ...state.player, coverSuspicion: asTruth(next) },
  };
}

// ---------------------------------------------------------------------------
// Surveil
// ---------------------------------------------------------------------------

/**
 * Quote a {@link SurveilAction} (pure, no draws). The watched Location must
 * exist; the shared Location gate in `./action.ts` already enforces the
 * allowed-action set (a Location Type must list `surveil`) and the opening hours
 * for `surveil`'s `at`. The cost is `phases` (1 or 2) and no money. A `phases`
 * outside `{1, 2}` is rejected defensively (the type forbids it, but a parsed
 * action could carry anything).
 */
export function quoteSurveil(state: WorldState, a: SurveilAction): ActionQuote {
  if (state.city.locations[a.at] === undefined) {
    return { allowed: false, reason: `no such Location ${a.at}`, phases: 0, money: 0 };
  }
  if (a.phases !== 1 && a.phases !== 2) {
    return {
      allowed: false,
      reason: 'surveil runs for 1 or 2 phases',
      phases: 0,
      money: 0,
    };
  }
  return { allowed: true, phases: a.phases, money: 0 };
}

/**
 * Resolve a {@link SurveilAction} (design `resolve`; draws only the detection
 * coins). The caller (`resolve`) has confirmed the action is allowed. For each
 * watched phase it lists the NPCs scheduled at the Location (as the player sees
 * them — `unk:` for the unidentified, allocating their stable id), emits the
 * `LOCATED_AT`/`MEETS_AT` Observations, and runs one detection check. On a
 * detection it raises Cover Suspicion and — at the reveal probability — adds the
 * "made" Fact Line.
 *
 * The next {@link WorldState} carries any newly-allocated `unk:` ids and the
 * raised Cover Suspicion. `claimsAdded` names the surveillance Propositions by
 * id (the player-view layer records one `surveillance`-sourced Claim per
 * Proposition); the `message` "made" Observation is not a Proposition and so is
 * not a Claim. `factLines` is left to the caller's `render`.
 */
export function resolveSurveil(
  state: WorldState,
  a: SurveilAction,
  rng: Prng,
  truth: TruthAccess,
  render: (state: WorldState, observations: readonly Observation[]) => string[],
  events?: readonly SimEvent[],
): { next: WorldState; result: ActionResult } {
  let next = state;
  const observations: Observation[] = [];
  const claimsAdded: string[] = [];

  // The slice's clock is one phase per step, so the window's phases are the
  // current phase repeated; each watched phase sights the same scheduled NPCs
  // and runs its own detection check (so a 2-phase watch is riskier than a
  // 1-phase one). The observation time is the watch's start time.
  const at = state.time;
  const present = npcsScheduledAt(state, a.at);

  // First, the Sim events at the Location in the window, run through the
  // observation check (design, "Surveil"). The event coins are drawn before the
  // per-phase detection coins, in a fixed order, so the draw sequence is
  // deterministic. A `meeting` yields MEETS_AT contacts; co-presence (handled
  // below) never does — a meeting Claim always matches a real meeting event.
  const observed = observeEvents(
    next,
    windowEvents(state, events),
    a.at,
    at,
    a.phases,
    rng,
    truth,
    SURVEIL_OBSERVATION_BASE,
  );
  next = observed.next;
  for (const obs of observed.observations) {
    observations.push(obs);
  }
  for (const id of observed.claimsAdded) {
    claimsAdded.push(id);
  }

  for (let phase = 0; phase < a.phases; phase += 1) {
    // Co-presence: a LOCATED_AT sighting of each NPC scheduled here, never a
    // MEETS_AT (two people in the same square are not thereby meeting; Req 23.1).
    const seen = visiblePersons(next, truth, present);
    next = seen.next;
    const phaseObs = observationsFor(seen.visible, a.at, at);
    for (const obs of phaseObs) {
      observations.push(obs);
      if (obs.kind === 'proposition') {
        claimsAdded.push(obs.prop.id);
      }
    }
    const detection = runDetection(next, rng, surveilDetectionBase(next), present);
    if (detection.detected) {
      next = raiseCoverSuspicion(next);
      if (detection.madeObservation !== undefined) {
        observations.push(detection.madeObservation);
      }
    }
  }

  const result: ActionResult = {
    observations,
    factLines: render(next, observations),
    scene: sceneDescriptorAt(next, a.at),
    events: [],
    claimsAdded,
  };
  return { next, result };
}

// ---------------------------------------------------------------------------
// Follow
// ---------------------------------------------------------------------------

/** The NPC a follow target denotes: a `npc:` id directly, or a mapped `unk:` id. */
function resolveTarget(
  state: WorldState,
  truth: TruthReader,
  target: NpcId | UnkId,
): NpcId | undefined {
  if (!target.startsWith('unk:')) {
    return state.npcs[target as NpcId] === undefined ? undefined : (target as NpcId);
  }
  const npc = truth.identityOf(target as UnkId);
  if (npc === undefined) {
    // Fall back to the player's own allocation table (view-safe reverse lookup).
    for (const [id, unk] of Object.entries(state.player.unkIds)) {
      if (unk === target) {
        return id as NpcId;
      }
    }
    return undefined;
  }
  return revealTruth(npc);
}

/**
 * Quote a {@link FollowAction} (pure, no draws). The target must resolve to a
 * real NPC (a `npc:` id, or a `unk:` id the player has observed) and that NPC
 * must be present at the player's current Location this phase — a follow starts
 * from where the player can see the target. Cost is {@link FOLLOW_PHASE_COST}
 * (the current phase) and no money. The shared Location gate in `./action.ts`
 * handles the player's Location being open and allowing `follow`.
 */
export function quoteFollow(
  state: WorldState,
  a: FollowAction,
  truth: TruthReader | undefined,
): ActionQuote {
  if (truth === undefined) {
    return {
      allowed: false,
      reason: 'follow needs the Truth Store to resolve the target',
      phases: 0,
      money: 0,
    };
  }
  const npc = resolveTarget(state, truth, a.target);
  if (npc === undefined) {
    return { allowed: false, reason: `no such target ${a.target}`, phases: 0, money: 0 };
  }
  const here = npcsScheduledAt(state, state.player.loc);
  if (!here.includes(npc)) {
    return {
      allowed: false,
      reason: 'the target is not present to follow',
      phases: 0,
      money: 0,
    };
  }
  return { allowed: true, phases: FOLLOW_PHASE_COST, money: 0 };
}

/**
 * Resolve a {@link FollowAction} (design `resolve`; draws only the event
 * observation coins and the detection coin). The caller (`resolve`) has
 * confirmed the action is allowed. It steps the target's schedule within the
 * current phase: it reads the target's scheduled Location, and — when that
 * Location is public and the player can enter it — sights the NPCs there
 * (`LOCATED_AT`) and observes the Sim events at that Location this phase, each
 * through the observation check. A `meeting` the Sim ran there yields a
 * `MEETS_AT` contact between its participants; co-presence yields only sightings
 * (a meeting Claim always matches a real meeting event, Req 23.1). The follow
 * ends with nothing observed when the target's Location is non-public (the
 * player cannot follow them in); detection, when it fires, ends the follow and
 * surfaces the "made" line at the reveal probability.
 *
 * Following carries a *higher* per-step detection risk than static surveillance
 * ({@link followDetectionBase}). The target's own security consciousness drives
 * the detection coin. The next state carries any newly-allocated `unk:` ids and
 * the raised Cover Suspicion; `claimsAdded` names the surveillance Propositions.
 */
export function resolveFollow(
  state: WorldState,
  a: FollowAction,
  rng: Prng,
  truth: TruthAccess,
  render: (state: WorldState, observations: readonly Observation[]) => string[],
  events?: readonly SimEvent[],
): { next: WorldState; result: ActionResult } {
  let next = state;
  const observations: Observation[] = [];
  const claimsAdded: string[] = [];
  const at = state.time;

  const npc = resolveTarget(state, truth, a.target);
  const weekday = CONTENT_WEEKDAYS.indexOf(weekdayForDay(state.time.day));
  const targetLoc =
    npc === undefined
      ? undefined
      : scheduledLocation(state.npcs[npc].schedule, weekday, state.time.phase);
  const place = targetLoc === undefined ? undefined : state.city.locations[targetLoc];

  // The follow ends immediately (nothing observed) when the target has no
  // scheduled Location this phase or enters a non-public one the player cannot
  // enter (design, "Follow": ends when the target enters a Location the player
  // cannot enter).
  if (npc !== undefined && targetLoc !== undefined && place !== undefined && place.public) {
    // The Sim events at the target's Location this phase, run through the
    // observation check (same event-based rule as surveil). The event coins are
    // drawn before the detection coin, in a fixed order.
    const observed = observeEvents(
      next,
      windowEvents(state, events),
      targetLoc,
      at,
      FOLLOW_PHASE_COST,
      rng,
      truth,
      SURVEIL_OBSERVATION_BASE,
    );
    next = observed.next;
    for (const obs of observed.observations) {
      observations.push(obs);
    }
    for (const id of observed.claimsAdded) {
      claimsAdded.push(id);
    }

    // Co-presence sightings of the NPCs present at the target's Location — a
    // LOCATED_AT each, never a MEETS_AT.
    const present = npcsScheduledAt(state, targetLoc);
    const seen = visiblePersons(next, truth, present);
    next = seen.next;
    const stepObs = observationsFor(seen.visible, targetLoc, at);
    for (const obs of stepObs) {
      observations.push(obs);
      if (obs.kind === 'proposition') {
        claimsAdded.push(obs.prop.id);
      }
    }
    const detection = runDetection(
      next,
      rng,
      followDetectionBase(next),
      npc === undefined ? [] : [npc],
    );
    if (detection.detected) {
      next = raiseCoverSuspicion(next);
      if (detection.madeObservation !== undefined) {
        observations.push(detection.madeObservation);
      }
    }
  }

  const result: ActionResult = {
    observations,
    factLines: render(next, observations),
    scene: sceneDescriptorAt(next, next.player.loc),
    events: [],
    claimsAdded,
  };
  return { next, result };
}

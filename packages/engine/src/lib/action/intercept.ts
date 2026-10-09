/**
 * The intercept action and the wait action's passive observation (design,
 * "Action Resolver" → **Intercept** / **Wait**; Requirements 25.2, 25.3, 25.4,
 * 25.5, 25.6).
 *
 * ## Intercept (Req 25.2, 25.3, 25.4)
 *
 * `{ kind:'intercept'; channel?: ChannelId }` has two modes, chosen by *where*
 * the player stands:
 *
 * - **Station collection** (the player is at the Station — a Location whose
 *   Location Type is `station-hq`). This collects every *uncollected*
 *   transmission on the player's known radio and numbers Channels whose
 *   scheduled time falls inside the Station's retention window ending now, mints
 *   an Intercept for each (carrying its traffic metadata — time, Channel,
 *   length, header — Req 25.3), and adds them to `WorldState.intercepts`. An
 *   optional `channel?` narrows the sweep to one Channel. No detection check
 *   fires at the Station — collecting off the home antenna is not an exposed act
 *   (Req 25.2).
 *
 * - **Courier interception** (the player is at a `courier` Channel's `route`
 *   Location during that Channel's window — a firing of its schedule lands on
 *   the current time). This produces that courier Channel's Intercept and runs a
 *   detection check, drawn on the passed {@link Prng} exactly as surveil does
 *   (Req 25.4): being on the courier's route when the hand-off happens is an
 *   exposed act.
 *
 * ### Collecting the real transmissions from the World State
 *
 * The Cipher Engine seeds `WorldState.transmissions` at world assembly (task
 * 26.3) with the real ciphertext {@link Intercept}s for every interceptable
 * firing — Plot Stage transmission traces, Side Thread transmission traces and
 * Noise Traffic Channels. A {@link import('../cipher/intercept.js').Transmission}
 * is *traffic that happened* (held from generation); `WorldState.intercepts` is
 * *what the player has captured* (empty at generation). The intercept action is
 * the seam that moves one across: it sweeps `WorldState.transmissions` for the
 * firings on the player's known radio/numbers Channels inside the retention
 * window and **delivers** each one's Intercept into `WorldState.intercepts`.
 *
 * "Uncollected" means the transmission's Intercept id is not already a key of
 * `WorldState.intercepts`; delivering the same window twice copies nothing new
 * (Property 18 — delivered at most once; delivered if an intercept action occurs
 * within the retention window, task 11.10). Delivery copies the seeded Intercept
 * across unchanged, so the traffic metadata the player reads before any
 * decryption — the Channel, time, length, call sign and any `fixed-header` crib
 * — is exactly what the Cipher Engine minted (Req 25.3).
 *
 * ## Wait (Req 25.5, 25.6)
 *
 * Task 11.1 gave `wait` a minimal resolve (an empty result the Turn Pipeline
 * turns into a clock advance) and the phase cost in `quoteWait`. This task
 * **upgrades** the wait resolve to produce the design's passive observation: at
 * a *public, open* Location the player — just waiting, not actively watching —
 * makes surveillance Observations at {@link WAIT_OBSERVATION_FACTOR} (×0.4) the
 * normal surveil yield, with **no** active detection check and so no detection
 * risk. {@link waitObservations} is the pure helper `./action.ts` calls; the
 * time advance and event delivery stay the Turn Pipeline's job, so "waiting
 * delivers events" is modelled as the pipeline firing the scheduled events over
 * the waited span while this helper contributes the passive observations.
 *
 * It **stops at closing** (Req 25.6): the waited span is walked phase by phase
 * from the current one, and the walk ends at the first phase in which the
 * Location is closed. A Location that closes mid-span yields observations only
 * for the open phases before it closed, and a "the Location closed" Fact Line is
 * surfaced. The reduced per-phase yield is applied to the persons present at
 * each open phase.
 *
 * ## Purity and the Truth boundary
 *
 * {@link quoteIntercept} is pure and draws nothing. {@link resolveIntercept}
 * draws only the courier detection coin (Station collection is deterministic).
 * {@link waitObservations} observes NPCs the player may not have identified,
 * which allocates stable `unk:` ids through the Unidentified-Subject machinery
 * (`./identify.ts`), so it takes a {@link TruthAccess}; it draws nothing. Fact
 * Line rendering is left to a `render` callback, exactly as `./surveil.ts` does,
 * so this module never imports `./action.ts` and no import cycle forms.
 */

import {
  asTruth,
  revealTruth,
  type ChannelId,
  type GameTime,
  type InterceptId,
  type LocId,
  compareTime,
} from '../model/core.js';
import type { WorldState } from '../model/state.js';
import type { Prng } from '../prng/prng.js';
import {
  isInterceptableKind,
  type Channel,
} from '../city/comms.js';
import type { Intercept, Transmission } from '../cipher/intercept.js';
import type { TruthAccess } from '../truth/truth.js';
import { visiblePersons } from './identify.js';
import {
  npcsScheduledAt,
  observationsFor,
  observeEvents,
  eventsInWindow,
  windowEvents,
  surveilDetectionBase,
  madeRevealProbability,
  SURVEIL_OBSERVATION_BASE,
} from './surveil.js';
import type { SimEvent } from '../model/state.js';
import type { ActionQuote, ActionResult, Observation } from './result.js';
import type { InterceptAction, WaitAction } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The Location Type id of the player's home Station (the core pack's HQ type). */
export const STATION_LOCATION_TYPE = 'station-hq';

/** The phase cost of an intercept (collecting at the Station / intercepting a courier). */
export const INTERCEPT_PHASE_COST = 1;

/**
 * The retention-window fallback in days, used when the scenario config does not
 * carry an `interceptRetentionDays` (the schema defaults it to 2, so this is a
 * belt-and-braces default matching the requirement's "default two days",
 * Req 25.3).
 */
export const DEFAULT_RETENTION_DAYS = 2;

/**
 * The fraction of the normal surveil observation yield a *wait* produces at a
 * public, open Location (design, "Wait": passive observation at a reduced rate;
 * Req 25.5). `0.4`, so waiting while present picks up noticeably less than an
 * active watch — the player is passing time, not working the scene.
 */
export const WAIT_OBSERVATION_FACTOR = 0.4;

/** The Fact Line a wait surfaces when the Location closes mid-span (Req 25.6). */
export const WAIT_CLOSED_FACT_LINE = 'The Location closes; you stop waiting.';

// ---------------------------------------------------------------------------
// Retention window and Station recognition
// ---------------------------------------------------------------------------

/**
 * The intercept retention window in days (Req 25.3, "default two days"). Read
 * from the scenario config's `interceptRetentionDays`; falls back to
 * {@link DEFAULT_RETENTION_DAYS} when the value is absent or not a positive
 * finite number.
 */
export function retentionDays(state: WorldState): number {
  const raw = state.meta.scenario.interceptRetentionDays;
  return Number.isFinite(raw) && raw >= 1 ? raw : DEFAULT_RETENTION_DAYS;
}

/**
 * True when the player's current Location is the Station (its Location Type is
 * {@link STATION_LOCATION_TYPE}). The engine stores the bare Location Type id on
 * `Location.type`; the Station HQ is stamped from the `station-hq` type, so a
 * match is by that id (directly, or as the bare suffix of a namespaced id).
 */
export function isAtStation(state: WorldState): boolean {
  const loc = state.city.locations[state.player.loc];
  if (loc === undefined) {
    return false;
  }
  return isStationType(loc.type);
}

/** True when a Location Type id denotes the Station HQ (bare or namespaced). */
function isStationType(type: string): boolean {
  return type === STATION_LOCATION_TYPE || type.endsWith(`/${STATION_LOCATION_TYPE}`);
}

// ---------------------------------------------------------------------------
// Known interceptable Channels
// ---------------------------------------------------------------------------

/**
 * The player's known radio and numbers Channels (the ones Station collection
 * sweeps, Req 25.3), in id-sorted order. "Known" is `player.known.channels`;
 * "radio and numbers" is {@link isInterceptableKind}. A `narrowTo` id restricts
 * the result to that one Channel (the `channel?` argument), yielding an empty
 * list when the narrowed Channel is unknown or not interceptable.
 */
export function knownInterceptableChannels(
  state: WorldState,
  narrowTo?: ChannelId,
): Channel[] {
  const out: Channel[] = [];
  for (const id of state.player.known.channels) {
    if (narrowTo !== undefined && id !== narrowTo) {
      continue;
    }
    const channel = state.channels[id];
    if (channel === undefined || !isInterceptableKind(channel.kind)) {
      continue;
    }
    out.push(channel);
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The broadcast Channels the Station's monitoring hears: every radio and numbers
 * Channel in the world, in id-sorted order, optionally narrowed to one id.
 *
 * A radio or numbers broadcast is on the air for anyone listening, so the
 * Station's antenna picks up traffic on a Channel before the player knows whose
 * it is. Hearing it is what *reveals* the Channel: collection adds it to
 * `player.known.channels` (see {@link resolveStationCollection}). This is the
 * runtime half of the discovery verifier's "an observed transmission reveals
 * its Channel" rule, so a signal route the verifier counts is one the player
 * can actually collect.
 */
export function audibleChannels(
  state: WorldState,
  narrowTo?: ChannelId,
): Channel[] {
  return (Object.values(state.channels) as Channel[])
    .filter((c) => isInterceptableKind(c.kind))
    .filter((c) => narrowTo === undefined || c.id === narrowTo)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The courier Channel the player can intercept at their current Location *now*:
 * a `courier` Channel whose `route` is the player's Location and whose schedule
 * fires at the current time. An optional `narrowTo` restricts to that Channel.
 * Returns `undefined` when no such Channel is here-and-now. All Channels are
 * considered (not just known ones): a courier interception is a chance encounter
 * on a route, not a sweep of known traffic.
 */
/** A radio Channel is heard only in its reception set. Numbers are heard in every city. */
function heardInCity(channel: Channel, city: string | undefined): boolean {
  if (city === undefined || channel.kind === 'numbers') {
    return true;
  }
  if (channel.reception === undefined || channel.reception.length === 0) {
    return true;
  }
  return channel.reception.includes(city);
}

/** The player is aboard a carriage when their placement is a transit. */
function playerInCarriage(state: WorldState): boolean {
  const placed = state.locationOf?.player;
  return placed !== undefined && 'transit' in placed;
}

export function courierHereNow(
  state: WorldState,
  narrowTo?: ChannelId,
): Channel | undefined {
  const here = state.player.loc;
  const inCarriage = playerInCarriage(state);
  const candidates = (Object.values(state.channels) as Channel[])
    .filter((c) => c.kind === 'courier' && (c.route === here || inCarriage))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const channel of candidates) {
    if (narrowTo !== undefined && channel.id !== narrowTo) {
      continue;
    }
    if (firesAt(channel, state.time)) {
      return channel;
    }
  }
  return undefined;
}

/** True when a Channel's schedule fires exactly at the given time. */
function firesAt(channel: Channel, at: GameTime): boolean {
  if (at.phase !== channel.schedule.phase) {
    return false;
  }
  const day = at.day;
  const start = channel.schedule.start.day;
  if (day < start) {
    return false;
  }
  return (day - start) % channel.schedule.period === 0;
}

// ---------------------------------------------------------------------------
// Station collection (Req 25.2, 25.3)
// ---------------------------------------------------------------------------

/**
 * The uncollected transmissions due at the Station now: every
 * {@link Transmission} in `WorldState.transmissions` on a known interceptable
 * Channel (optionally narrowed by `narrowTo`) whose firing time lies in the
 * retention window `[now − retentionDays, now]` and whose Intercept id is not
 * already a key of `WorldState.intercepts` (uncollected). Deterministic: the
 * transmissions are returned in id-sorted order so a sweep collects them in a
 * stable sequence.
 */
export function stationCollection(
  state: WorldState,
  narrowTo?: ChannelId,
): Transmission[] {
  const now = state.time;
  const windowStartDay = now.day - retentionDays(state);
  const known = new Set<ChannelId>(
    audibleChannels(state, narrowTo).map((c) => c.id),
  );
  const out: Transmission[] = [];
  for (const tx of state.transmissions) {
    if (!known.has(tx.channel)) {
      continue;
    }
    if (tx.at.day < windowStartDay) {
      continue;
    }
    if (compareTime(tx.at, now) > 0) {
      continue;
    }
    if (state.intercepts[tx.intercept.id] !== undefined) {
      continue;
    }
    const channel = state.channels[tx.channel];
    if (channel !== undefined && !heardInCity(channel, state.player.city ?? undefined)) {
      continue;
    }
    out.push(tx);
  }
  return out.sort((a, b) =>
    a.intercept.id < b.intercept.id ? -1 : a.intercept.id > b.intercept.id ? 1 : 0,
  );
}

/**
 * The uncollected courier transmissions on `channel` firing exactly at `now`:
 * every {@link Transmission} on the Channel whose time is the current time and
 * whose Intercept is not already collected. A courier interception collects what
 * is on the wire at that hand-off (Req 25.4); the Cipher Engine seeds a courier
 * Channel's transmissions, so this reads them off the World State like the
 * Station sweep rather than minting a placeholder.
 */
function courierTransmissionsNow(
  state: WorldState,
  channel: ChannelId,
): Transmission[] {
  const now = state.time;
  const out: Transmission[] = [];
  for (const tx of state.transmissions) {
    if (tx.channel !== channel) {
      continue;
    }
    if (compareTime(tx.at, now) !== 0) {
      continue;
    }
    if (state.intercepts[tx.intercept.id] !== undefined) {
      continue;
    }
    out.push(tx);
  }
  return out.sort((a, b) =>
    a.intercept.id < b.intercept.id ? -1 : a.intercept.id > b.intercept.id ? 1 : 0,
  );
}

// ---------------------------------------------------------------------------
// quote / resolve: intercept
// ---------------------------------------------------------------------------

/**
 * Quote an {@link InterceptAction} (pure, no draws). Allowed when the player is
 * at the Station (collection mode) or at a courier Channel's route Location
 * during that Channel's window (courier mode); otherwise not allowed, with a
 * reason. The shared Location gate in `./action.ts` has already enforced the
 * allowed-action set and opening hours for the player's current Location. Cost
 * is {@link INTERCEPT_PHASE_COST} phases and no money.
 */
export function quoteIntercept(state: WorldState, a: InterceptAction): ActionQuote {
  if (isAtStation(state)) {
    return { allowed: true, phases: INTERCEPT_PHASE_COST, money: 0 };
  }
  if (courierHereNow(state, a.channel) !== undefined) {
    return { allowed: true, phases: INTERCEPT_PHASE_COST, money: 0 };
  }
  return {
    allowed: false,
    reason:
      'intercept is allowed only at the Station or on a courier Channel’s route during its window',
    phases: 0,
    money: 0,
  };
}

/**
 * Resolve an {@link InterceptAction} (design `resolve`; draws only the courier
 * detection coin). The caller (`resolve`) has confirmed the action is allowed.
 *
 * - **Station mode** (Req 25.2, 25.3): deliver every uncollected in-window
 *   transmission on any audible (radio/numbers) Channel (narrowed by
 *   `a.channel`) — copying each one's seeded Intercept into
 *   `WorldState.intercepts` — and report each as a `message` Observation naming
 *   its traffic metadata. No detection.
 * - **Courier mode** (Req 25.4): deliver the courier Channel's seeded Intercepts
 *   firing now and run a detection check (`rng`), raising Cover Suspicion on a
 *   hit and surfacing the "made" line at the reveal probability — the same
 *   detection shape surveil uses, with the courier as the watcher.
 *
 * Station mode is preferred when the player is at the Station (the home antenna
 * sweep); courier mode applies otherwise. `claimsAdded` is empty: a captured
 * ciphertext is not yet a Case File Claim (the player must decrypt it first,
 * task 8.4), so collection reports metadata Observations, not Claims. Fact Line
 * rendering is left to the caller's `render`.
 */
export function resolveIntercept(
  state: WorldState,
  a: InterceptAction,
  rng: Prng,
  render: (state: WorldState, observations: readonly Observation[]) => string[],
): { next: WorldState; result: ActionResult } {
  if (isAtStation(state)) {
    return resolveStationCollection(state, a, render);
  }
  return resolveCourierInterception(state, a, rng, render);
}

/** Station collection: deterministic sweep, no detection (Req 25.2, 25.3). */
function resolveStationCollection(
  state: WorldState,
  a: InterceptAction,
  render: (state: WorldState, observations: readonly Observation[]) => string[],
): { next: WorldState; result: ActionResult } {
  const due = stationCollection(state, a.channel);
  const intercepts: Record<InterceptId, Intercept> = { ...state.intercepts };
  const observations: Observation[] = [];
  for (const tx of due) {
    const intercept = tx.intercept;
    intercepts[intercept.id] = intercept;
    observations.push({ kind: 'message', line: interceptLine(intercept) });
  }
  // Hearing traffic on a Channel reveals it: add every Channel collected from
  // to the player's known set, so it can be named, narrowed and fed.
  const learned = [...state.player.known.channels];
  for (const tx of due) {
    if (!learned.includes(tx.channel)) {
      learned.push(tx.channel);
    }
  }
  const next: WorldState =
    learned.length === state.player.known.channels.length
      ? { ...state, intercepts }
      : {
          ...state,
          intercepts,
          player: {
            ...state.player,
            known: { ...state.player.known, channels: learned },
          },
        };
  const result: ActionResult = {
    observations,
    factLines: render(next, observations),
    scene: sceneDescriptorAt(next, next.player.loc),
    events: [],
    claimsAdded: [],
  };
  return { next, result };
}

/** Courier interception: one Intercept + a detection check (Req 25.4). */
function resolveCourierInterception(
  state: WorldState,
  a: InterceptAction,
  rng: Prng,
  render: (state: WorldState, observations: readonly Observation[]) => string[],
): { next: WorldState; result: ActionResult } {
  const channel = courierHereNow(state, a.channel);
  if (channel === undefined) {
    // Should not happen (quote gated it); return an unchanged, empty result.
    return {
      next: state,
      result: {
        observations: [],
        factLines: [],
        scene: sceneDescriptorAt(state, state.player.loc),
        events: [],
        claimsAdded: [],
      },
    };
  }

  // Collect the courier's seeded transmissions firing now (Req 25.4). A courier
  // Channel the Cipher Engine seeded carries real Intercepts; an uncollected one
  // is delivered into the Case File like a Station sweep.
  const due = courierTransmissionsNow(state, channel.id);
  const collected: Record<InterceptId, Intercept> = { ...state.intercepts };
  const observations: Observation[] = [];
  for (const tx of due) {
    collected[tx.intercept.id] = tx.intercept;
    observations.push({ kind: 'message', line: interceptLine(tx.intercept) });
  }

  let next: WorldState = { ...state, intercepts: collected };

  // Detection: the courier is the watcher. Draw the detection coin, then — on a
  // hit — the reveal coin, in that fixed order, matching surveil's draw order.
  const base = surveilDetectionBase(next);
  const detected = rng.next() < base;
  if (detected) {
    next = raiseCoverSuspicion(next);
    const reveal = rng.next() < madeRevealProbability(next);
    if (reveal) {
      observations.push({
        kind: 'message',
        line: 'You sense you may have been made.',
      });
    }
  }

  const result: ActionResult = {
    observations,
    factLines: render(next, observations),
    scene: sceneDescriptorAt(next, next.player.loc),
    events: [],
    claimsAdded: [],
  };
  return { next, result };
}

/** A player-facing metadata line for a captured Intercept (Req 25.3). */
function interceptLine(intercept: Intercept): string {
  const sign = intercept.meta.callsign ?? '????';
  return `Intercept ${sign} on ${intercept.channel} at ${intercept.at.day}.${intercept.at.phase}.`;
}

// ---------------------------------------------------------------------------
// Wait passive observation (Req 25.5, 25.6)
// ---------------------------------------------------------------------------

/**
 * The result of {@link waitObservations}: the next state (with any newly
 * allocated `unk:` ids), the passive Observations, the `claimsAdded` ids, and
 * how many phases the wait actually ran before the Location closed (Req 25.6).
 */
export interface WaitObservationResult {
  readonly next: WorldState;
  readonly observations: readonly Observation[];
  readonly claimsAdded: readonly string[];
  /** The phases actually waited (≤ `a.phases`); fewer when the Location closed. */
  readonly phasesWaited: number;
  /** True when the Location closed mid-span and the wait stopped early. */
  readonly stoppedAtClosing: boolean;
}

/**
 * Produce a wait's passive surveillance Observations (design, "Wait"; Req 25.5,
 * 25.6). At a *public, open* Location the player makes `LOCATED_AT`/`MEETS_AT`
 * Observations at {@link WAIT_OBSERVATION_FACTOR} the normal surveil yield, with
 * no detection check. The waited span is walked phase by phase from the current
 * one; the walk ends at the first phase in which the Location is closed, so a
 * Location that closes mid-span yields observations only for the open phases
 * before it closed (and `stoppedAtClosing` is set). A non-public Location yields
 * nothing (the player cannot observe a scene they are passing time inside).
 *
 * Pure; draws nothing. Allocating `unk:` ids for unidentified persons uses the
 * passed {@link TruthAccess}. The slice's clock is one phase per step, so each
 * waited phase sees the same scheduled persons; the reduced yield takes the
 * leading `ceil(factor × present.length)` of them in deterministic id order (so
 * at least one person is observed when anyone is present and the factor is
 * positive — "reduced", not "none"). The observation time is the wait's start.
 */
export function waitObservations(
  state: WorldState,
  a: WaitAction,
  truth: TruthAccess,
  events?: readonly SimEvent[],
): WaitObservationResult {
  const loc = state.city.locations[state.player.loc];
  const observations: Observation[] = [];
  const claimsAdded: string[] = [];
  const at = state.time;
  let next = state;

  // A non-public Location: no passive observation at all. The wait still passes
  // time (the Turn Pipeline's job); it just sees nothing.
  if (loc === undefined || !loc.public) {
    return {
      next,
      observations,
      claimsAdded,
      phasesWaited: a.phases,
      stoppedAtClosing: false,
    };
  }

  const present = npcsScheduledAt(state, state.player.loc);
  let phasesWaited = 0;
  let stoppedAtClosing = false;

  for (let step = 0; step < a.phases; step += 1) {
    const phase = ((at.phase + step) % 4) as 0 | 1 | 2 | 3;
    if (loc.hours[phase] !== true) {
      // The Location closes in this phase: stop the wait at closing (Req 25.6).
      stoppedAtClosing = true;
      break;
    }
    phasesWaited += 1;
    const reduced = reducedPresence(present);
    const seen = visiblePersons(next, truth, reduced);
    next = seen.next;
    for (const obs of observationsFor(seen.visible, state.player.loc, at)) {
      observations.push(obs);
      if (obs.kind === 'proposition') {
        claimsAdded.push(obs.prop.id);
      }
    }
  }

  // The Sim events at the Location over the open span, observed at the reduced
  // wait rate (design, "Wait": surveillance observation at ×0.4 with no active
  // detection). The same event-based rule as surveil applies — a `meeting`
  // yields a MEETS_AT contact; co-presence (above) yields only sightings — so a
  // waiting player's meeting Claims still match real meeting events (Req 23.1).
  // The reduced rate is modelled deterministically: only the leading
  // `ceil(factor × n)` of the window's events are observed (a reduced, not
  // empty, yield), each through an always-pass coin so the wait draws no
  // randomness and stays reproducible (Req 25.5).
  if (phasesWaited > 0) {
    const windowed = eventsInWindow(
      state,
      windowEvents(state, events),
      state.player.loc,
      at,
      phasesWaited,
    );
    const reducedEvents = reducedEventYield(windowed);
    const observed = observeEvents(
      next,
      reducedEvents,
      state.player.loc,
      at,
      phasesWaited,
      alwaysObserve(),
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
  }

  if (stoppedAtClosing) {
    observations.push({ kind: 'message', line: WAIT_CLOSED_FACT_LINE });
  }

  return { next, observations, claimsAdded, phasesWaited, stoppedAtClosing };
}

/**
 * Reduce a window's events to the wait's passive yield: the leading
 * `ceil(WAIT_OBSERVATION_FACTOR × n)` events in their (already time-ordered)
 * order. At least one when any event fired, strictly fewer than `n` once `n` is
 * large enough — a reduced, not empty, rate (Req 25.5), mirroring
 * {@link reducedPresence} for sightings.
 */
function reducedEventYield(events: readonly SimEvent[]): SimEvent[] {
  if (events.length === 0) {
    return [];
  }
  const take = Math.max(1, Math.ceil(WAIT_OBSERVATION_FACTOR * events.length));
  return events.slice(0, Math.min(take, events.length));
}

/**
 * A deterministic {@link Prng} whose `next()` is always `0`, so every event's
 * observation coin passes (`0 < p` for any positive `p`). Wait models its
 * reduced rate by observing a reduced *subset* of events rather than by random
 * misses, so it draws no gameplay randomness and stays reproducible — its other
 * methods are never called here, so they throw to catch any misuse.
 */
function alwaysObserve(): Prng {
  const unused = (): never => {
    throw new Error('alwaysObserve(): only next() is used by the wait observation');
  };
  return {
    next: () => 0,
    nextUint32: unused,
    int: unused,
    bool: () => true,
    pick: unused,
    shuffle: <T>(items: readonly T[]): T[] => [...items],
    state: unused,
  };
}

/**
 * Reduce a present-NPC list to the wait's passive yield: the leading
 * `ceil(WAIT_OBSERVATION_FACTOR × n)` persons in id order. At least one when
 * anyone is present (the factor is positive), strictly fewer than `n` once `n`
 * is large enough — a reduced, not empty, rate (Req 25.5).
 */
function reducedPresence(present: readonly `npc:${string}`[]): `npc:${string}`[] {
  if (present.length === 0) {
    return [];
  }
  const take = Math.max(1, Math.ceil(WAIT_OBSERVATION_FACTOR * present.length));
  return present.slice(0, Math.min(take, present.length));
}

// ---------------------------------------------------------------------------
// Shared local helpers (scene + suspicion), kept local to avoid an action cycle
// ---------------------------------------------------------------------------

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

/** How much a courier detection raises Cover Suspicion (matches surveil's delta). */
const DETECTION_SUSPICION_DELTA = 0.1;

/** Raise the player's Cover Suspicion by the detection delta, clamped to [0, 1]. */
function raiseCoverSuspicion(state: WorldState): WorldState {
  const raised = revealTruth(state.player.coverSuspicion) + DETECTION_SUSPICION_DELTA;
  const clamped = raised < 0 ? 0 : raised > 1 ? 1 : raised;
  return {
    ...state,
    player: { ...state.player, coverSuspicion: asTruth(clamped) },
  };
}

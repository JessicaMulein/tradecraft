/**
 * The Action Resolver framework (design, "Action Resolver (`engine/actions`)";
 * Requirements 13.2, 20.1, 21.3, 21.4, 21.5).
 *
 * Every player action goes through two *pure* functions:
 *
 * - {@link quote} — reads the {@link WorldState} and an {@link Action} and
 *   returns an {@link ActionQuote}: whether the action is allowed, a `reason`
 *   when it is not, and the phase and money cost the UI shows *before* the
 *   player commits (Requirement 13.2). `quote` draws no randomness.
 * - {@link resolve} — applies *exactly* the quoted cost and returns the next
 *   {@link WorldState} plus an {@link ActionResult}. It draws only from the
 *   {@link Prng} it is handed, so the same inputs always yield the same result.
 *
 * The design's contract: `resolve` applies exactly the quoted cost; a
 * disallowed action, a closed Location or an unaffordable Budget returns an
 * empty result with the state **unchanged** (`next === state`). Observations
 * become Fact Lines through the predicate *third-person* templates with the
 * player-perspective namer (Requirement 20.1).
 *
 * ## Scope
 *
 * This module owns the *framework*: the {@link Action} union (in `./types.ts`),
 * the {@link quote}/{@link resolve} dispatch, the result shapes, the
 * allowed-action, opening-hours and Budget checks, Fact Line rendering, and the
 * trivial {@link quoteWait wait} action. Every other kind has its own module
 * (`./travel.ts`, `./talk.ts`, `./decrypt.ts`, `./cable.ts`, `./task.ts`, …).
 * The dispatch in {@link quote} and {@link resolve} is exhaustive over
 * `Action['kind']`, checked at compile time by a `never` check in each
 * `default` (slice-integration Req 11.1, 11.2), so a new kind cannot be added
 * to the union without being wired here.
 *
 * The Turn Pipeline (task 16.8) is *not* implemented here: `resolve` returns the
 * next WorldState and the result; advancing the game clock by the quoted phases
 * is the Turn Pipeline's job. `wait` therefore quotes a phase cost and resolves
 * to an empty result that the Turn Pipeline turns into a clock advance.
 *
 * ## End conditions from an action (slice-integration task 1.3; Req 7.1, 7.4)
 *
 * Two resolvers can end the game from inside a turn: an arrest of the Cell
 * leader (`leader-arrested`) and a `seize` of the Plot materiel, which aborts the
 * Plot (`materiel-seized`). `resolve` returns `{ next, result, ended? }`
 * ({@link ResolveResult}) and passes their {@link EndCondition} through. It never
 * writes `WorldState.ended` itself, so `next.ended` is unchanged; the Turn
 * Pipeline writes `ended` at commit.
 */

import type { LocId, NpcId, Phase, Proposition } from '../model/core.js';
import { withOrdinaryLife } from '../city/ordinary-life.js';
import type { WorldState } from '../model/state.js';
import type { Location } from '../city/city.js';
import { effectiveLocation } from '../ambient/locations.js';
import { ambientScene, incidentFactLines } from '../ambient/prompt.js';
import { balance } from '../station/ledger.js';
import { formatDate, type NamerContext } from '../docs/namer.js';
import type { Namer } from '@tradecraft/content';
import type { Prng } from '../prng/prng.js';
import { scheduleWeekdayIndex } from '../city/calendar.js';
import { districtSector, withOccupation } from '../city/occupation.js';
import { scheduledLocation } from '../city/npc.js';
import { callingPlace } from '../recruit/asset.js';
import type { ContentSet, LocationType } from '@tradecraft/content';
import { attendDutyLocation, quoteAttendDuty, resolveAttendDuty } from '../ambient/cover.js';
import { quoteTravel, resolveTravel } from './travel.js';
import { carriageWaitLimit, quoteDepart, resolveDepart, terminalTravellers } from '../travel/depart.js';
import { quotePapers, quoteVisa, resolvePapers, resolveVisa } from '../travel/papers.js';
import {
  quoteLiaisonRequest,
  quoteLiaisonShare,
  resolveLiaisonRequest,
  resolveLiaisonShare,
} from '../liaison/exchange.js';
import { quoteExfiltrate, resolveExfiltrate } from '../region/remote.js';
import { quoteExtension, resolveExtension } from '../extension/dispatch.js';
import { quoteRead, resolveRead } from './read.js';
import {
  quoteSurveil,
  resolveSurveil,
  quoteFollow,
  resolveFollow,
} from './surveil.js';
import {
  quoteTalk,
  resolveTalk,
  quoteApproach,
  resolveApproach,
} from './talk.js';
import { quoteArrangeMeeting, resolveArrangeMeeting } from './arrange-meeting.js';
import { quoteConfront, resolveConfront } from './confront.js';
import { quotePay, resolvePay } from './pay.js';
import { quoteArrest, resolveArrest } from './arrest.js';
import { quoteTurnAgent, resolveTurnAgent } from './turn-agent.js';
import { quoteFeed, resolveFeed } from './feed.js';
import { quoteDecrypt, resolveDecrypt } from './decrypt.js';
import { quoteCable, resolveCable } from './cable.js';
import { quoteTask, resolveTask } from './task.js';
import {
  quoteServiceDrop,
  resolveServiceDrop,
  seizedTemplateOf,
} from './service-drop.js';
import {
  quoteIntercept,
  resolveIntercept,
  waitObservations,
} from './intercept.js';
import { identityAwareNamer, identityContextOf } from './identify.js';
import { endConditionFromAbort } from '../endings/end-conditions.js';
import { isExtensionAction, type Action, type WaitAction } from './types.js';
import type {
  ActionQuote,
  ActionResult,
  Observation,
  ResolverContext,
  ResolveResult,
  SceneDescriptor,
} from './result.js';

// ---------------------------------------------------------------------------
// Location, allowed-action and opening-hours helpers (Req 21.5)
// ---------------------------------------------------------------------------

/**
 * The Location an action concerns — the one whose allowed-action set and
 * opening hours gate it. For most actions this is where they happen; for
 * `travel` it is the destination (which must be open on arrival); for `surveil`
 * and `arrange-meeting` it is their `at`. `confront` and `turn-agent` are
 * face-to-face, so like `talk` they happen at the player's current Location
 * (the core pack allows them wherever it allows `talk`).
 *
 * Actions that are not performed at a Location return `undefined` and skip the
 * Location gate; each one's own quote decides where it can be done:
 *
 * - `read`, `decrypt`: desk work on a Document or Intercept already in hand;
 * - `cable`: sent from the Station, which `quoteCable` checks itself;
 * - `task`, `pay`, `feed`: done through the Asset's Contact Channel, not in
 *   person (slice design: a feed "is allowed when `asset.turned` holds and a
 *   Contact Channel exists");
 * - `arrest`: a request the Station's own officers carry out (slice design,
 *   "Arrest Evidence": allowed iff the evidence count reaches the threshold and
 *   arrest authority remains);
 * - `wait`: just passes time.
 */
export function actionLocation(state: WorldState, a: Action): LocId | undefined {
  if (isExtensionAction(a)) return undefined;
  switch (a.kind) {
    case 'travel':
      return a.to;
    case 'surveil':
    case 'arrange-meeting':
      return a.at;
    case 'talk':
      return a.breakOff === true ? undefined : state.player.loc;
    case 'approach':
    case 'follow':
    case 'service-drop':
    case 'intercept':
    case 'confront':
    case 'turn-agent':
      // These happen at the player's current Location.
      return state.player.loc;
    case 'read':
    case 'decrypt':
    case 'cable':
    case 'task':
    case 'pay':
    case 'feed':
    case 'arrest':
    case 'wait':
      return undefined;
    case 'attend-duty':
      return attendDutyLocation(state, a.duty);
    case 'depart':
    case 'request-papers':
    case 'apply-visa':
      return undefined;
    case 'liaison-request':
    case 'liaison-share':
    case 'exfiltrate':
      return undefined;
  }
}

/**
 * Resolve the content {@link LocationType} a Location was stamped from. The
 * engine stores the bare Location Type id on `Location.type`; the content
 * registry keys entries by their namespaced id (`<pack>/<name>`), so a match is
 * by the id's bare suffix. Returns `undefined` when no type resolves (a
 * defensive path — generation always stamps a known type).
 */
export function locationTypeOf(
  content: ContentSet,
  loc: Location,
): LocationType | undefined {
  const direct = content.locationTypes.get(loc.type);
  if (direct !== undefined) {
    return direct;
  }
  for (const [key, value] of content.locationTypes) {
    if (key === loc.type || key.endsWith(`/${loc.type}`) || value.id === loc.type) {
      return value;
    }
  }
  return undefined;
}

/** True when a Location is open in the given phase (its folded hours). */
export function isOpenAt(loc: Location, phase: Phase): boolean {
  return loc.hours[phase] === true;
}

/**
 * Check the Location gate for an action (Requirement 21.5): the action must be
 * allowed by the target Location's Type and the Location must be open in the
 * current phase. Returns a `reason` string when the gate fails, or `undefined`
 * when it passes (or the action has no Location). The reason names the allowed
 * actions or the opening hours, as the requirement asks.
 */
export function locationGate(
  state: WorldState,
  content: ContentSet,
  a: Action,
): string | undefined {
  if (
    carriageWaitLimit(state) !== undefined &&
    (a.kind === 'talk' || a.kind === 'approach' || a.kind === 'surveil' || a.kind === 'wait')
  ) {
    return undefined;
  }
  const locId = actionLocation(state, a);
  if (locId === undefined) {
    return undefined;
  }
  const loc = state.city.locations[locId];
  if (loc === undefined) {
    return `no such Location ${locId}`;
  }
  const overlays = state.ambient?.overlays ?? [];
  const effective = overlays.length === 0 ? undefined : effectiveLocation(loc, overlays, state.time);
  const hours = effective?.location ?? loc;

  if (effective !== undefined && effective.status !== 'open' && effective.status !== 'newly-opened') {
    return `${loc.name} is ${effective.status}`;
  }

  // Opening hours: a closed Location rejects every action against it.
  if (!isOpenAt(hours, state.time.phase)) {
    return `${loc.name} is closed in this phase`;
  }

  // Allowed actions: the Location Type declares which actions it permits. A
  // `travel` to a Location is always permitted (arriving is not a Location
  // action the Type gates). A cover duty is kept at whatever place the cover
  // fits, and no Location Type lists `attend-duty`, so the duty quote is the
  // gate: the player is there, in the slot.
  if (a.kind === 'travel' || a.kind === 'attend-duty') {
    return undefined;
  }
  const type = locationTypeOf(content, loc);
  if (type === undefined) {
    // No resolvable type: fail closed rather than silently allow.
    return `${loc.name} has no known Location Type`;
  }
  if (!type.allowedActions.includes(a.kind)) {
    return `${loc.name} allows only: ${type.allowedActions.join(', ')}`;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Fact Line rendering (Req 20.1)
// ---------------------------------------------------------------------------

/**
 * Build a player-perspective {@link NamerContext} from the {@link WorldState}.
 * The namer resolves entity ids to view-safe display names (persona names,
 * Location names, org names) and never reads a Truth field, so a rendered Fact
 * Line leaks no ground truth.
 */
export function namerContextOf(state: WorldState): NamerContext {
  return { city: state.city, npcs: state.npcs, orgs: state.orgs };
}

/**
 * The {@link Namer} the predicate renderer is handed. The predicate template
 * engine passes an *entity binding* (`{ kind, id }`) for an entity slot and a
 * plain string for a literal / place / when slot (see the content predicate
 * registry). The player-perspective namer, by contrast, resolves a raw id
 * *string*; so this adapter unwraps a binding to its `id` and delegates,
 * passing plain strings straight through. That keeps `../docs/namer.ts`
 * untouched while letting Fact Lines render through the player namer
 * (Requirement 20.1).
 *
 * The base namer is the *identity-aware* one (task 11.2; Requirement 23.4): a
 * person the player has observed but not identified renders as their
 * Unidentified Subject descriptor (keyed by their `unk:N` id or their raw `npc:`
 * id), while an identified person renders by name. So an observed-but-
 * unidentified subject in a Fact Line appears as `unk:N`/descriptor, matching
 * the design, without touching the underlying `playerNamer`.
 */
export function predicateNamer(state: WorldState): Namer {
  const base = identityAwareNamer(namerContextOf(state), identityContextOf(state));
  return (value: unknown): string => {
    if (
      typeof value === 'object' &&
      value !== null &&
      'id' in value &&
      typeof (value as { id: unknown }).id === 'string'
    ) {
      return base((value as { id: string }).id);
    }
    return base(value);
  };
}

/** The namespace raw kind the predicate renderer expects for an entity binding. */
function entityKind(id: string): 'npc' | 'unk' | 'org' {
  if (id.startsWith('org:')) {
    return 'org';
  }
  if (id.startsWith('unk:')) {
    return 'unk';
  }
  return 'npc';
}

/** English for a predicate id, so a Fact Line never prints the code. */
const SPOKEN_PREDICATE: Readonly<Record<string, string>> = {
  MEMBER_OF: 'belongs to',
  WORKS_FOR: 'works for',
  REPORTS_TO: 'reports to',
  MEETS_AT: 'meets',
  LOCATED_AT: 'is seen at',
  TRAVELS_TO: 'travels to',
  SCHEDULED_FOR: 'is expected',
  PLANS: 'is planning',
  TARGETS: 'is targeting',
  CARRIES: 'is carrying',
  SUPPLIES: 'supplies',
  USES_CHANNEL: 'uses the channel',
  KNOWS: 'knows',
  SUSPECTS: 'suspects',
  IS_ALIAS_OF: 'is also known as',
};

function spokenPredicate(id: string): string {
  const local = id.slice(id.lastIndexOf('/') + 1);
  return SPOKEN_PREDICATE[local.toUpperCase()] ?? local.replace(/_/g, ' ').toLowerCase();
}

/**
 * One Proposition as a sentence. `name` turns an id into the words the player
 * already has. Fact Lines use this when a predicate template cannot be filled,
 * and the Case File uses it so the screen never shows a predicate code.
 */
export function describeProposition(
  prop: Pick<Proposition, 'subject' | 'predicate' | 'object' | 'place'>,
  name: (id: string) => string,
): string {
  const subject = name(prop.subject);
  const object = typeof prop.object === 'string' ? name(prop.object) : literalText(prop.object);
  const verb = spokenPredicate(prop.predicate);
  const placeOnly = verb === 'is seen at' || verb === 'travels to';
  const line = placeOnly ? `${subject} ${verb} ${prop.place === undefined ? object : name(prop.place)}` : `${subject} ${verb} ${object}`;
  if (!placeOnly && prop.place !== undefined) return `${line} at ${name(prop.place)}`;
  return line;
}

/** Format a Proposition's literal object as display text for a Fact Line. */
function literalText(object: Proposition['object']): string {
  if (typeof object === 'string') {
    return object;
  }
  switch (object.kind) {
    case 'text':
      return object.value;
    case 'amount':
      return String(object.value);
    case 'time':
      return formatDate(object.value);
  }
}

/**
 * Render one {@link Proposition} as a third-person Fact Line through the
 * predicate registry and the player-perspective namer (Requirement 20.1). The
 * object is passed as an entity binding (namer-resolved) or a pre-formatted
 * literal, and `place` / `when` are rendered from the Proposition when present.
 * An unknown predicate falls back to a plain id rendering rather than throwing,
 * so a malformed Observation cannot crash a turn.
 */
export function renderPropositionLine(
  content: ContentSet,
  state: WorldState,
  prop: Proposition,
): string {
  const namer = predicateNamer(state);
  const predicate = content.predicates.get(prop.predicate);
  const objectBinding =
    typeof prop.object === 'string'
      ? { kind: entityKind(prop.object), id: prop.object }
      : { literal: literalText(prop.object) };
  const place = prop.place !== undefined ? namer(prop.place) : undefined;
  const when = prop.window !== undefined ? formatDate(prop.window.from) : undefined;

  // Defensive fallback: a Proposition citing a predicate the pack does not
  // define — or one whose slots do not satisfy the predicate's third-person
  // template (a Document asserting a Proposition with no `window` where the
  // template wants a `when`, say) — still renders to *something* readable
  // rather than throwing, so a malformed Observation cannot crash a turn.
  const fallback = (): string => describeProposition(prop, (id) => namer(id));

  if (predicate === undefined) {
    return fallback();
  }

  try {
    return predicate.render(
      'third',
      {
        subject: { kind: entityKind(prop.subject), id: prop.subject },
        object: objectBinding,
        place,
        when,
      },
      namer,
    );
  } catch {
    return fallback();
  }
}

/**
 * Render every {@link Observation} to a Fact Line. A `proposition` Observation
 * goes through {@link renderPropositionLine}; a `message` Observation already
 * carries its line.
 */
export function renderFactLines(
  content: ContentSet,
  state: WorldState,
  observations: readonly Observation[],
): string[] {
  return observations.map((obs) =>
    obs.kind === 'message' ? obs.line : renderPropositionLine(content, state, obs.prop),
  );
}

// ---------------------------------------------------------------------------
// Scene descriptor
// ---------------------------------------------------------------------------

/** The NPCs at a Location at the current time (Requirement 21.7). */
export function visibleNpcsAt(state: WorldState, locId: LocId): NpcId[] {
  // ScheduleEntry.weekday is numeric (0 Monday … 6 Sunday); map the day's
  // string weekday to that index, matching the clock's schedule stepping.
  const weekday = scheduleWeekdayIndex(state.time.day, state.meta.setting.startDate);
  const out: NpcId[] = [];
  for (const npc of Object.values(state.npcs)) {
    const calling = callingPlace(state.relationships[npc.id], state.time.day);
    if (calling !== undefined) {
      if (calling === locId) {
        out.push(npc.id);
      }
      continue;
    }
    if (scheduledLocation(npc.schedule, weekday, state.time.phase) === locId) {
      out.push(npc.id);
    }
  }
  // Deterministic order: by id.
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Build the {@link SceneDescriptor} for a Location at the current time. */
export function sceneAt(state: WorldState, locId: LocId): SceneDescriptor {
  const loc = state.city.locations[locId];
  if (loc === undefined) {
    return { loc: locId, description: '', atmosphere: [], risk: 0, visible: [] };
  }
  const ambient = ambientScene(state, locId);
  const habits = state.player.habits;
  const own =
    habits !== undefined &&
    (habits.flat === locId || habits.cafe === locId || habits.market === locId);
  return {
    loc: locId,
    description: withOrdinaryLife(
      withOccupation(loc.description, districtSector(state.city, locId), state.time.phase),
      loc.type,
      state.time.phase,
      own,
    ),
    atmosphere: [...loc.atmosphere],
    risk: loc.risk,
    visible: visibleNpcsAt(state, locId),
    ...(ambient === undefined ? {} : { ambient }),
  };
}

/** An empty result at the player's current Location, used by disallowed actions. */
export function emptyResult(state: WorldState): ActionResult {
  return {
    observations: [],
    factLines: [],
    scene: sceneAt(state, state.player.loc),
    events: [],
    claimsAdded: [],
  };
}

// ---------------------------------------------------------------------------
// Exhaustiveness (slice-integration Req 11.1, 11.2)
// ---------------------------------------------------------------------------

/**
 * The `never` check in the `default` of the {@link quote} and {@link resolve}
 * dispatch. Every kind in the {@link Action} union is handled before the
 * `default`, so the argument there is `never`, and adding a kind to the union
 * without wiring it in is a compile error. At run time only a value outside
 * the union (a malformed save, say) can get here. The function returns that
 * value's kind tag, so `quote` can refuse it with a reason instead of throwing.
 */
function unhandledKind(a: never): string {
  const kind: unknown = (a as { readonly kind?: unknown } | undefined)?.kind;
  return String(kind);
}

// ---------------------------------------------------------------------------
// Wait (trivial)
// ---------------------------------------------------------------------------

/**
 * Quote a {@link WaitAction}: it costs its `phases` and no money, and is always
 * allowed (it just lets time pass). The actual time advancement is the Turn
 * Pipeline's job (task 16.8); `wait` only names the phase cost here.
 */
export function quoteWait(a: WaitAction): ActionQuote {
  return { allowed: true, phases: a.phases, money: 0 };
}

// ---------------------------------------------------------------------------
// quote / resolve
// ---------------------------------------------------------------------------

/**
 * Quote an {@link Action} (design `quote`; pure, no draws). The Location gate
 * (allowed-action + opening hours, Requirement 21.5) applies to every action
 * performed at a Location ({@link actionLocation}), and the Budget gate
 * (Requirement 28.3) to every action; past those, each kind computes its own
 * cost and eligibility. Every kind in the union has its own quote, and a
 * disallowed quote always carries a reason (slice-integration Req 11.1, 11.3).
 *
 * The returned quote is what {@link resolve} applies *exactly*. When `allowed`
 * is `false`, `resolve` leaves the state unchanged.
 */
export function quote(
  state: WorldState,
  a: Action,
  ctx: ResolverContext,
): ActionQuote {
  // The Location gate first: a closed or disallowing Location rejects the
  // action regardless of its own preconditions (Requirement 21.5).
  const gate = locationGate(state, ctx.content, a);
  if (gate !== undefined) {
    return { allowed: false, reason: gate, phases: 0, money: 0 };
  }

  const base = quoteKind(state, a, ctx);
  if (!base.allowed) {
    return base;
  }

  // The Budget gate: a money-costed action the ledger cannot cover is not
  // allowed, with state left unchanged (Requirement 28.3).
  if (base.money > 0 && base.money > balance(state.station.ledger)) {
    return {
      allowed: false,
      reason: `insufficient Budget: need ${base.money}, have ${balance(
        state.station.ledger,
      )}`,
      phases: base.phases,
      money: base.money,
    };
  }

  return base;
}

/** Quote a single action kind, past the shared Location gate. */
function quoteKind(state: WorldState, a: Action, ctx: ResolverContext): ActionQuote {
  if (isExtensionAction(a)) return quoteExtension(state, a, ctx);
  switch (a.kind) {
    case 'travel':
      return quoteTravel(state, a);
    case 'read':
      return quoteRead(state, a);
    case 'surveil':
      return quoteSurveil(state, a);
    case 'follow':
      return quoteFollow(state, a, ctx.truth);
    case 'talk':
      return quoteTalk(state, a, ctx.truth);
    case 'approach':
      return quoteApproach(state, a, ctx.truth);
    case 'arrange-meeting':
      return quoteArrangeMeeting(state, a);
    case 'service-drop':
      return quoteServiceDrop(state, a);
    case 'intercept':
      return quoteIntercept(state, a);
    case 'decrypt':
      return quoteDecrypt(state, a);
    case 'cable':
      return quoteCable(state, a, ctx);
    case 'task':
      return quoteTask(state, a);
    case 'confront':
      return quoteConfront(state, a, ctx);
    case 'pay':
      return quotePay(state, a);
    case 'turn-agent':
      return quoteTurnAgent(state, a, ctx);
    case 'feed':
      return quoteFeed(state, a, ctx);
    case 'arrest':
      return quoteArrest(state, a, ctx);
    case 'attend-duty':
      return quoteAttendDuty(state, a.duty);
    case 'depart':
      return quoteDepart(state, a);
    case 'request-papers':
      return quotePapers(state, a);
    case 'apply-visa':
      return quoteVisa(state, a);
    case 'liaison-request':
      return quoteLiaisonRequest(state, a);
    case 'liaison-share':
      return quoteLiaisonShare(state, a);
    case 'exfiltrate':
      return quoteExfiltrate(state, a);
    case 'wait': {
      const remaining = carriageWaitLimit(state);
      if (remaining !== undefined && a.phases > remaining) {
        return {
          allowed: false,
          reason: 'a wait in the carriage cannot outlast the transit',
          phases: 0,
          money: 0,
        };
      }
      return quoteWait(a);
    }
    default:
      // `a` is `never` here (compile-time exhaustiveness). Only a value outside
      // the union reaches this at run time, and it is refused, not thrown on.
      return {
        allowed: false,
        reason: `unknown action kind ${unhandledKind(a)}`,
        phases: 0,
        money: 0,
      };
  }
}

/**
 * What {@link resolve} returns (slice-integration design, "`resolve` returns
 * `ended`"): the next {@link WorldState}, the {@link ActionResult}, and the
 * {@link EndCondition} when the action ended the game.
 *
 * `ended` is set by two action kinds only:
 *
 * - `arrest`: a correct arrest of the Cell leader (`leader-arrested`), or any
 *   standing end `detectEnd` reports on the arrest's next state;
 * - `service-drop` in `seize` mode: seizing the Plot materiel aborts the Plot,
 *   and the abort's end intent is widened to an `EndCondition` (outcome
 *   `success`, cause `materiel-seized`).
 *
 * It is absent for every other action and for a disallowed one. `next.ended` is
 * left as it was: `resolve` reports the end and the caller writes it to
 * `WorldState.ended` (Req 7.1, 7.4).
 */
export type { ResolveResult };

/**
 * Resolve an {@link Action} (design `resolve`; pure, draws only from `rng`).
 * Re-quotes to decide eligibility and cost — a disallowed, closed or
 * unaffordable action returns an empty result with the state **unchanged**
 * (`next === state`) and no `ended`, honouring the design's "state is
 * unchanged" contract. Otherwise it dispatches to the kind's resolver, which
 * applies exactly the quoted cost and returns the next state and the
 * {@link ActionResult}, plus the End Condition an arrest or a materiel seizure
 * produced ({@link ResolveResult}).
 */
function appendIncidentLines(outcome: ResolveResult): ResolveResult {
  const lines = incidentFactLines(outcome.next, outcome.next.player.loc);
  if (lines.length === 0) {
    return outcome;
  }
  return {
    ...outcome,
    result: {
      ...outcome.result,
      factLines: [...outcome.result.factLines, ...lines],
    },
  };
}

export function resolve(
  state: WorldState,
  a: Action,
  rng: Prng,
  ctx: ResolverContext,
): ResolveResult {
  return appendIncidentLines(resolveBody(state, a, rng, ctx));
}

function resolveBody(
  state: WorldState,
  a: Action,
  rng: Prng,
  ctx: ResolverContext,
): ResolveResult {
  const q = quote(state, a, ctx);
  if (!q.allowed) {
    // State is unchanged; the same object is returned so `next === state`.
    return { next: state, result: emptyResult(state) };
  }
  if (isExtensionAction(a)) return resolveExtension(state, a, rng, ctx);

  switch (a.kind) {
    case 'travel':
      return resolveTravel(state, a, rng);
    case 'read':
      // The read resolver builds its own Observations and claimsAdded; it leaves
      // Fact Line rendering to this layer (so `./read.ts` need not import this
      // module and form a cycle), rendering against the *next* state.
      return resolveRead(state, a, rng, (obs) =>
        renderFactLines(ctx.content, state, obs),
      );
    case 'surveil': {
      // Surveil observes the NPCs at the watched Location (as `unk:` ids when
      // unidentified, so it needs the Truth Store), builds its own Observations
      // and `claimsAdded`, and leaves Fact Line rendering to this layer (so
      // `./surveil.ts` need not import this module and form a cycle). A missing
      // Truth Store (no caller supplied one) degrades to an empty result.
      if (ctx.truth === undefined) {
        return { next: state, result: emptyResult(state) };
      }
      const watched = resolveSurveil(
        state,
        a,
        rng,
        ctx.truth,
        (rendered, obs) => renderFactLines(ctx.content, rendered, obs),
        ctx.events,
      );
      if (state.region === undefined) {
        return watched;
      }
      const names = terminalTravellers(watched.next, a.at);
      if (names.length === 0) {
        return watched;
      }
      const extra = names.map((name) => `${name} is at the terminal.`);
      return {
        next: watched.next,
        result: {
          ...watched.result,
          factLines: [...watched.result.factLines, ...extra],
          observations: [
            ...watched.result.observations,
            ...extra.map((line) => ({ kind: 'message' as const, line })),
          ],
        },
      };
    }
    case 'follow':
      // Follow steps the target's schedule and observes it, with the same unk
      // and render handling as surveil.
      if (ctx.truth === undefined) {
        return { next: state, result: emptyResult(state) };
      }
      return resolveFollow(
        state,
        a,
        rng,
        ctx.truth,
        (rendered, obs) => renderFactLines(ctx.content, rendered, obs),
        ctx.events,
      );
    case 'talk':
      // Talk opens a scene (openScene); it draws nothing and leaves Fact Line
      // rendering to this layer (so `./talk.ts` need not import this module and
      // form a cycle).
      return resolveTalk(
        state,
        a,
        (rendered, obs) => renderFactLines(ctx.content, rendered, obs),
        ctx.truth,
      );
    case 'approach':
      // Cold Approach draws the firstContact coin on `rng`; on success it opens
      // a scene and mints a Contact Channel, on failure it raises Cover
      // Suspicion. A `unk:` target resolves through the Truth Store, so it is
      // threaded in.
      return resolveApproach(state, a, rng, ctx.truth, (rendered, obs) =>
        renderFactLines(ctx.content, rendered, obs),
      );
    case 'arrange-meeting':
      // Arrange a meeting: draws the acceptance coin on `rng`, records a Meeting
      // in `WorldState.meetings`, mints a deferred `meeting-reply` event the
      // Turn Pipeline delivers, and adds Exposure to the suspicion accumulator.
      // The scene at the slot is opened later by `resolveMeetingAtSlot`, which
      // the clock fires. Fact Line rendering is left to this layer (so
      // `./arrange-meeting.ts` need not import this module and form a cycle).
      return resolveArrangeMeeting(state, a, rng, (rendered, obs) =>
        renderFactLines(ctx.content, rendered, obs),
      );
    case 'service-drop': {
      // Service a dead drop (Req 24.5, 24.6, 24.7): own drops deliver contents
      // and accept left items (half a meeting's Exposure); hostile drops copy
      // (seized-material Documents, drop intact) or seize (empty the drop,
      // disrupt the Plot, and — when the materiel is taken — drive the 7.4
      // abort). Both run a detection check against the drop's watcher. The
      // resolver returns an optional end intent when a materiel seizure aborted
      // the Plot; this layer widens it to an `EndCondition` and passes it
      // through as `ended`, for the Turn Pipeline to write to
      // `WorldState.ended`. Fact Line rendering is left to this layer (so
      // `./service-drop.ts` need not import this module and form a cycle). The
      // seized Document template is read from the content set here.
      const serviced = resolveServiceDrop(
        state,
        a,
        rng,
        seizedTemplateOf(ctx.content),
        (rendered, obs) => renderFactLines(ctx.content, rendered, obs),
        { ...(ctx.truth === undefined ? {} : { truth: ctx.truth }) },
      );
      return serviced.ended === undefined
        ? { next: serviced.next, result: serviced.result }
        : {
            next: serviced.next,
            result: serviced.result,
            ended: endConditionFromAbort(serviced.ended),
          };
    }
    case 'intercept':
      // Intercept (Req 25.2, 25.3, 25.4): at the Station it collects every
      // uncollected in-window transmission on the player's known radio/numbers
      // Channels into Intercepts (no detection); on a courier Channel's route
      // during its window it produces that courier's Intercept and runs a
      // detection check (drawn on `rng`). It adds the Intercepts to
      // `WorldState.intercepts` and reports their traffic metadata as `message`
      // Observations; Fact Line rendering is left to this layer (so
      // `./intercept.ts` need not import this module and form a cycle).
      return resolveIntercept(state, a, rng, (rendered, obs) =>
        renderFactLines(ctx.content, rendered, obs),
      );
    case 'decrypt':
      // Decrypt (slice-integration Req 8.3–8.6): verify the submission against
      // the Intercept with `verifySubmission` (key material from
      // `ctx.cipherKeys`, else the world's own lookup). A correct break marks
      // the Intercept `broken` and reports each recovered Proposition as an
      // `intercept`-sourced Observation; a wrong submission plays one fixed Fact
      // Line; already-broken traffic changes nothing. Draws nothing. Fact Line
      // rendering is left to this layer (so `./decrypt.ts` need not import this
      // module and form a cycle).
      return resolveDecrypt(state, a, ctx, (rendered, obs) =>
        renderFactLines(ctx.content, rendered, obs),
      );
    case 'cable':
      // Cable (slice-integration Req 9.3): submit the trace, funds or report
      // request with `submitCable` and the preset's reply delay, appended to
      // `station.pendingCables`; the Phase Step delivers the reply when it falls
      // due. `quoteCable` has already checked the player is at an open Station.
      // Draws nothing. Fact Line rendering is left to this layer (so
      // `./cable.ts` need not import this module and form a cycle).
      return resolveCable(
        state,
        a,
        (rendered, obs) => renderFactLines(ctx.content, rendered, obs),
        ctx,
      );
    case 'task':
      // Task (slice-integration Req 10.3–10.7): run `runAssetTask` once on
      // `rng` over the Asset's Contact Channel and apply the intent (a collect
      // report sourced `npc`, an introduction's Contact Channel, a courier
      // service of the player's drop, or a hidden `belief-plant`), then add
      // `TASKING_EXPOSURE` to the Asset's Exposure. Collect candidates come from
      // `ctx.truth`. Fact Line rendering is left to this layer (so `./task.ts`
      // need not import this module and form a cycle).
      return resolveTask(state, a, rng, ctx, (rendered, obs) =>
        renderFactLines(ctx.content, rendered, obs),
      );
    case 'confront':
      // Confront (Req 6.3, 6.4): press an NPC with a Case File Claim projected
      // onto `ctx.claims`. Draws the `pressureCheck` coin on `rng`, degrades the
      // NPC's cover state along `intact → strained → cracking → blown`, updates
      // the Relationship, and emits a cover-state Fact Line plus — when the
      // cover breaks — an Agenda-shift line (partial admission, bargaining or
      // flight). Fact Line rendering is left to this layer (so `./confront.ts`
      // need not import this module and form a cycle).
      return resolveConfront(state, a, rng, ctx, (rendered, obs) =>
        renderFactLines(ctx.content, rendered, obs),
      );
    case 'pay':
      // Pay (Req 28.2, 28.3, 28.4): a Budget debit tagged `pay`. It debits the
      // ledger via `payLedgerEffect` (rejecting with state unchanged on an
      // insufficient balance), and for a money-motivated Asset advances the
      // retainer and lifts trust (`payEffect` in `../recruit/retainer.ts`),
      // leaving a non-money Asset untouched. Draws nothing. Fact Line rendering
      // is left to this layer (so `./pay.ts` need not import this module and
      // form a cycle).
      return resolvePay(state, a, (rendered, obs) =>
        renderFactLines(ctx.content, rendered, obs),
      );
    case 'turn-agent':
      // Turn-agent (Req 11.3, 36.1–36.7): turn a hostile agent into a Double
      // Agent. Eligibility (custody / observed crack / evidence) is decided from
      // Player-View and Case File data only (`turnEligibility`, Req 36.2). The
      // resolver draws the `resolveTurn` coin: on success it flips the true
      // allegiance to the Station in the Truth Store, makes the NPC a `turned`
      // Asset, releases Station Custody and applies the release suspicion penalty
      // (Req 36.6, 36.7); on failure it plays the identical refusal Fact Line and
      // raises suspicion (Req 36.5). The Truth Store write needs `ctx.truth`;
      // when a caller omits it the accept degrades to a view-only turn rather
      // than mutating ground truth. Fact Line rendering is left to this layer (so
      // `./turn-agent.ts` need not import this module and form a cycle).
      return resolveTurnAgent(state, a, rng, ctx, (rendered, obs) =>
        renderFactLines(ctx.content, rendered, obs),
      );
    case 'feed': {
      // Feed (Req 37.1, 37.2, 37.6): validate the 1–3 fed items (Case File
      // Claims or composed Propositions, known-set entities, `unk:` ids resolved
      // through held IS_ALIAS_OF Claims, the derived predicate schema and 7-day
      // windows), then schedule a hidden `feed-delivered` event at the agent's
      // next handler contact. Draws nothing. The optional `label` is a view-only
      // Journal note (`resolveFeed` returns it); the Sim ignores it here, so this
      // layer takes only `{ next, result }`. Fact Line rendering is left to this
      // layer (so `./feed.ts` need not import this module and form a cycle).
      const fed = resolveFeed(state, a, ctx, (rendered, obs) =>
        renderFactLines(ctx.content, rendered, obs),
      );
      return { next: fed.next, result: fed.result };
    }
    case 'arrest': {
      // Arrest (Req 19.1–19.5, 40.4): the arrest gate (sufficient corroborated
      // Implicating Claims projected via `ctx.arrestEvidence` ≥ the preset
      // threshold, plus remaining arrest authority) is decided by `quoteArrest`
      // from Player-View data only. The resolver starts Station Custody on the
      // target, reads its true allegiance to tell a correct arrest from a
      // wrongful one, applies the wrongful-arrest penalties (lost authority,
      // Standing, and on the hard preset a Cover Suspicion rise), and — on a
      // correct arrest of the Cell leader — ends the game in success. It also
      // records the target in `player.arrests` and, when the target carries the
      // stage's materiel, sets `plot.materielSeized`. It returns an optional
      // `EndCondition` (its own leader win, else the standing win/lose
      // detector's result), which this layer passes through as `ended` for the
      // Turn Pipeline to write to `WorldState.ended`. Fact Line rendering is
      // left to this layer (so `./arrest.ts` need not import this module and
      // form a cycle).
      const arrested = resolveArrest(state, a, ctx, (rendered, obs) =>
        renderFactLines(ctx.content, rendered, obs),
      );
      return arrested.ended === undefined
        ? { next: arrested.next, result: arrested.result }
        : { next: arrested.next, result: arrested.result, ended: arrested.ended };
    }
    case 'attend-duty': {
      const attended = resolveAttendDuty(state, a.duty);
      const observations = attended.lines.map((line) => ({ kind: 'message' as const, line }));
      return {
        next: attended.next,
        result: {
          observations,
          factLines: attended.lines,
          scene: sceneAt(attended.next, attended.next.player.loc),
          events: [],
          claimsAdded: [],
        },
      };
    }
    case 'wait': {
      // Wait (Req 25.5, 25.6): at a public, open Location it makes passive
      // surveillance Observations at a reduced rate with no detection, stopping
      // at closing. The time advance and event delivery stay the Turn
      // Pipeline's job; this contributes the passive observations. Observing
      // unidentified NPCs allocates `unk:` ids, so it needs the Truth Store; a
      // missing Truth Store degrades to the old empty-result behaviour.
      if (ctx.truth === undefined) {
        return { next: state, result: emptyResult(state) };
      }
      const waited = waitObservations(state, a, ctx.truth, ctx.events);
      const result: ActionResult = {
        observations: waited.observations,
        factLines: renderFactLines(ctx.content, waited.next, waited.observations),
        scene: sceneAt(waited.next, waited.next.player.loc),
        events: [],
        claimsAdded: waited.claimsAdded,
      };
      return { next: waited.next, result };
    }
    case 'depart':
      return resolveDepart(state, a, rng);
    case 'request-papers':
      return resolvePapers(state, a);
    case 'apply-visa':
      return resolveVisa(state, a, rng);
    case 'liaison-request':
      return resolveLiaisonRequest(state, a, rng, ctx.truth);
    case 'liaison-share':
      return resolveLiaisonShare(state, a);
    case 'exfiltrate':
      return resolveExfiltrate(state, a, rng);
    default:
      // `a` is `never` here (compile-time exhaustiveness). A value outside the
      // union was already refused by `quote` above, so this line is
      // unreachable; it leaves the state unchanged rather than throwing.
      unhandledKind(a);
      return { next: state, result: emptyResult(state) };
  }
}

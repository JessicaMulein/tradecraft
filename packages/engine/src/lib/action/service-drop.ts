/**
 * The service-dead-drop action (design, "Action Resolver" → **Service dead
 * drop**; Requirements 24.5, 24.6, 24.7).
 *
 * `{ kind:'service-drop'; drop: DeadDropId; leave: ItemRef[]; hostileMode?:
 * 'copy' | 'seize' }` — the player works a concealed site at a Location to pass
 * or lift items without meeting. The action costs one phase and no money, and
 * is serviced *at* the drop's Location (the shared Location gate in
 * `./action.ts` maps `service-drop` to `player.loc`, so `quoteServiceDrop` also
 * checks the player is standing at the drop's `loc`). What it does depends on
 * who owns the drop:
 *
 * ## The player's own drop (Req 24.5, 24.6)
 *
 * A drop owned by the player's side — one of `player.known.drops` (the Station's
 * own drops) — is serviced to **deliver its contents** and **accept the items
 * the player leaves** (tasking, payment, Documents). {@link resolveServiceDrop}:
 *
 * - reports the drop's current `contents` as delivered items (an
 *   `items-delivered` message Observation naming them);
 * - appends the `leave` items to the drop's `contents` (so a later collector
 *   lifts them), emitting a `drop-loaded` {@link SimEvent} when the player left
 *   anything and a `drop-emptied` event when the drop held contents to deliver;
 * - adds Exposure equal to **half a meeting's** ({@link DROP_EXPOSURE_FACTOR}
 *   of {@link meetingExposure}) to the player's `coverSuspicion` accumulator,
 *   scaled by the same {@link EXPOSURE_SUSPICION_SCALE} arrange-meeting uses, so
 *   servicing a drop is strictly less exposing than a meeting (Req 24.6);
 * - runs a detection check against the drop's watcher, if any (Req 24.7).
 *
 * A `hostileMode` on an own drop is meaningless (you do not *copy* or *seize*
 * your own cache), so `quoteServiceDrop` rejects it.
 *
 * ## A hostile drop (Req 24.7)
 *
 * A drop owned by the Cell or the Hostile Service is worked against its owner,
 * and `hostileMode` is **required**:
 *
 * - **`copy`** — transcribes the drop's contents into **seized-material
 *   Document(s)** ({@link composeSeizedDocument}) and leaves the drop *intact*,
 *   so the owner never knows (Req 24.7). The design also mints *Intercepts* when
 *   the drop carried a transmission; the slice's {@link DeadDrop} model carries
 *   only item ids and no transmission, so no Intercept is produced here — a
 *   documented seam (the Cipher Engine's `generateIntercepts` is wired in when a
 *   drop model carries traffic). The composed Documents and their Propositions
 *   are registered on the next {@link WorldState} (`documents` /
 *   `documentPropositions`) and `claimsAdded` names those Propositions. Copying
 *   reads the material in place, so the Propositions are also returned as
 *   `proposition` Observations sourced `{ kind:'document', id }` (the seized
 *   Document), and the Document is marked read so a later `read` does not file
 *   them a second time (Req 30.4).
 * - **`seize`** — composes the same seized-material Document(s) **and** empties
 *   the drop (`contents` → `[]`). The seized Document is left unread: the
 *   `read` action turns its Propositions into Case File Claims. Seizing the
 *   contents **disrupts the Plot**: it marks the still-`pending` Plot Stage(s)
 *   whose own traces collect the seized delivery as `disrupted` (not every
 *   pending stage, Req 3.7) and, when the seized contents include the
 *   operation's **materiel**, drives task 7.4's
 *   abort — the materiel-seizure hook `abortCheck`/`considerPlotDay` reads
 *   (`AbortCheckContext.materielSeized`). This resolver does not run the clock
 *   tick, so it {@link applyAbort}s the Plot *directly* with the
 *   `materiel-seized` trigger when the materiel is taken (so `WorldState.plot`
 *   ends `aborted` and the hidden `plot-aborted` event is minted and the end
 *   intent reported), and otherwise sets the Plot's stages disrupted and leaves
 *   the materiel-seized condition for the next tick. Finally it **alerts the
 *   Hostile Service** by emitting a `drop-emptied` {@link SimEvent} the Hostile
 *   Service reads (task 19's domain), with a `routine` origin.
 *
 * ## The seizure record (slice-integration Req 4.4)
 *
 * The Plot's materiel (`plot.materiel`) is the delivery its stages move: the
 * Cell's drop is threaded with it at generation (`../city/comms.ts`), and the
 * stages' traces carry it from hand to hand. A `seize` whose contents include it
 * ({@link seizedContentsAreMateriel}) therefore takes the stage's delivery, and
 * the resolver records that as `plot.materielSeized = true` alongside the
 * direct abort. The live Disruption Context reports the flag as
 * `isMaterielSeized()`, so the seizure is a standing World State fact rather
 * than only an abort cause. The flag is set for exactly the seizure that aborts
 * the Plot. Seizing any other item, such as a delivery that only one stage's
 * own trace collects, disrupts that stage and leaves the flag unset, because
 * the flag feeds the abort check's `materiel-seized` trigger, which ends the
 * whole operation. A `copy` never sets it: the materiel stays in the drop. The
 * other seizure path, an arrest of the NPC carrying the materiel, sets the same
 * flag for the same item (`./arrest.ts`).
 *
 * Both hostile modes run a detection check against the drop's watcher (Req
 * 24.7).
 *
 * ## The watcher (detection) seam
 *
 * A drop may be watched by its owner (the Hostile Service may watch its own
 * drops). The slice's {@link DeadDrop} model carries no explicit watcher field,
 * so a watcher is resolved as a documented default: the drop's `owner`, when it
 * is a person (`npc:`), is the watcher; an org-owned drop has no single watching
 * person and so no detection subject in the slice. A caller that holds a richer
 * drop model may pass an explicit watcher through {@link ServiceDropInputs}. The
 * detection check mirrors `./surveil.ts`: the preset's base surveil rate scaled
 * by the watcher's security consciousness, drawn on the passed {@link Prng}; on
 * a hit the player's Cover Suspicion rises and — at the preset reveal
 * probability — a "made" Fact Line shows.
 *
 * ## Purity and the Truth boundary
 *
 * `quoteServiceDrop` is pure and draws nothing. `resolveServiceDrop` draws only
 * the detection coins from the passed {@link Prng} (the seized-Document
 * composition is deterministic), so the same inputs always yield the same
 * result. Fact Line rendering is left to the caller (a `render` callback),
 * exactly as `./surveil.ts` and `./arrange-meeting.ts` do, so this module never
 * imports `./action.ts` and no import cycle forms. It imports task 7.4's
 * {@link applyAbort} (clock) and task 9.1's {@link composeSeizedDocument} (docs)
 * — neither an action module, so no cycle.
 */

import {
  asTruth,
  revealTruth,
  type EntityId,
  type ItemId,
  type NpcId,
  type Proposition,
} from '../model/core.js';
import { currentHolder, type TruthAccess } from '../truth/truth.js';
import type {
  Document,
  SimEvent,
  TraceOrigin,
  WorldState,
} from '../model/state.js';
import type { Prng } from '../prng/prng.js';
import type { DeadDrop, CommsOwner } from '../city/comms.js';
import type { PlotState, StageState } from '../city/plot.js';
import { applyAbort, type EndedIntent } from '../clock/plot-abort.js';
import { composeSeizedDocument } from '../docs/newspaper.js';
import type { NamerContext } from '../docs/namer.js';
import type { DocumentTemplate } from '@tradecraft/content';
import {
  EXPOSURE_SUSPICION_SCALE,
  exposureWeightsOf,
  meetingExposure,
  crowdPenaltyProxy,
} from './arrange-meeting.js';
import {
  surveilDetectionBase,
  madeRevealProbability,
  MADE_FACT_LINE,
  DETECTION_SUSPICION_DELTA,
} from './surveil.js';
import { markDocumentRead } from './read.js';
import type { ActionQuote, ActionResult, Observation } from './result.js';
import type { ObservationSource, ServiceDropAction } from './types.js';

// ---------------------------------------------------------------------------
// Constants (documented defaults)
// ---------------------------------------------------------------------------

/** The phase cost of servicing a drop (design: "Costs 1 phase"; Req 24.6). */
export const SERVICE_DROP_PHASE_COST = 1;

/**
 * The fraction of a meeting's Exposure that servicing a drop adds (design:
 * "Exposure added is half a meeting's"; Req 24.6). `0.5` keeps a drop strictly
 * less exposing than a meeting for any positive meeting Exposure, so a player
 * who trades the convenience of a meeting for a drop pays less in visibility.
 */
export const DROP_EXPOSURE_FACTOR = 0.5;

/**
 * The {@link TraceOrigin} the player's drop events carry. Servicing a drop is a
 * routine operational act of the player's side, not a Plot/Side-Thread trace, so
 * the emitted `drop-loaded`/`drop-emptied` events are tagged `routine`.
 */
export const DROP_SERVICE_ORIGIN: TraceOrigin = asTruth({ kind: 'routine' });

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

/**
 * Whether a drop is the *player's own* (design: the player's own drops are the
 * Station drops; Req 24.5). A drop is the player's own when its id is in
 * `player.known.drops` — the Starting Brief seeds the Station's own drop(s)
 * there (Requirement 29.1: "at least one player Dead Drop"). Any other drop (the
 * Cell's or the Hostile Service's) is a hostile drop.
 */
export function isOwnDrop(state: WorldState, drop: DeadDrop): boolean {
  return state.player.known.drops.includes(drop.id);
}

/**
 * The watcher of a drop, if any — the person who may detect the player working
 * it (Req 24.7). The slice's {@link DeadDrop} carries no explicit watcher, so
 * the documented default is the owner when it is a person (`npc:`); an org-owned
 * drop has no single watching person. A caller holding a richer drop model may
 * override via {@link ServiceDropInputs}.
 */
export function dropWatcher(drop: DeadDrop): NpcId | undefined {
  return ownerIsNpc(drop.owner) ? (drop.owner as NpcId) : undefined;
}

/** True when a comms owner is a person (`npc:`) rather than an org. */
function ownerIsNpc(owner: CommsOwner): boolean {
  return owner.startsWith('npc:');
}

// ---------------------------------------------------------------------------
// Helpers (clamp, scene, detection) — local copies to avoid an action.ts cycle
// ---------------------------------------------------------------------------

/** Clamp a value into `[0, 1]` (the Cover Suspicion accumulator range). */
function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** The scene descriptor for a Location, built locally (no action.ts import). */
function sceneDescriptorAt(state: WorldState, loc: WorldState['player']['loc']): ActionResult['scene'] {
  const place = state.city.locations[loc];
  if (place === undefined) {
    return { loc, description: '', atmosphere: [], risk: 0, visible: [] };
  }
  return {
    loc,
    description: place.description,
    atmosphere: [...place.atmosphere],
    risk: place.risk,
    visible: [],
  };
}

/** The outcome of a detection draw: whether the player was made, and the line. */
interface DetectionOutcome {
  readonly detected: boolean;
  readonly madeObservation?: Observation;
}

/**
 * Run one detection check against the drop's watcher (Req 24.7), mirroring
 * `./surveil.ts`: the preset base surveil rate scaled by the watcher's security
 * consciousness. Draws the detection coin, then — only on a hit — the reveal
 * coin, in that fixed order, so the draw sequence is deterministic. A drop with
 * no watcher cannot be detected (probability 0, no coin drawn against a watcher
 * — but to keep the resolver's draw order stable regardless of watcher, the
 * detection coin is always drawn; a 0 probability simply never hits).
 */
function runWatcherDetection(
  state: WorldState,
  rng: Prng,
  watcher: NpcId | undefined,
): DetectionOutcome {
  const base = surveilDetectionBase(state);
  const npc = watcher === undefined ? undefined : state.npcs[watcher];
  const security = npc === undefined ? 0 : revealTruth(npc.securityConsciousness);
  const p = watcher === undefined ? 0 : clamp01(base * security);
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

/** Raise the player's Cover Suspicion by the detection delta (clamped). */
function raiseCoverSuspicion(state: WorldState): WorldState {
  const next = clamp01(revealTruth(state.player.coverSuspicion) + DETECTION_SUSPICION_DELTA);
  return { ...state, player: { ...state.player, coverSuspicion: asTruth(next) } };
}

/** A player-perspective {@link NamerContext}, built locally (no action.ts import). */
function namerContextOf(state: WorldState): NamerContext {
  return { city: state.city, npcs: state.npcs, orgs: state.orgs };
}

// ---------------------------------------------------------------------------
// Seized-material Documents (Req 24.7)
// ---------------------------------------------------------------------------

/**
 * The `seized`-kind Document template from the content set (the core pack's
 * `seized-handwritten-note`), or `undefined` when the pack ships none. Found by
 * scanning the content set's document templates for the first `seized` kind, so
 * no template id is hard-coded.
 */
export function seizedTemplateOf(
  content: { readonly documentTemplates: Iterable<readonly [string, DocumentTemplate]> },
): DocumentTemplate | undefined {
  for (const [, template] of content.documentTemplates) {
    if (template.kind === 'seized') {
      return template;
    }
  }
  return undefined;
}

/** A short, human-readable transcription of a drop's item contents. */
function describeContents(items: readonly ItemId[]): string {
  if (items.length === 0) {
    return 'nothing of substance';
  }
  return items.map((item) => item.replace(/^item:/, '')).join(', ');
}

/**
 * Compose a seized-material Document from a hostile drop's contents (Req 24.7).
 * The slice's {@link DeadDrop} carries only item ids (no attached Propositions),
 * so the Document transcribes the item contents and asserts the Propositions the
 * caller supplies — none by default, since items carry no inherent Propositions
 * in this model. Returns `undefined` when the content set ships no `seized`
 * template (a pack gap), so the resolver degrades to reporting the copied items
 * without a Document rather than throwing.
 */
function composeDropDocument(
  state: WorldState,
  drop: DeadDrop,
  asserts: readonly Proposition[],
  template: DocumentTemplate,
): { readonly document: Document; readonly propositions: readonly Proposition[] } {
  const place = state.city.locations[drop.loc]?.name ?? drop.loc;
  const composed = composeSeizedDocument(
    template,
    {
      tag: `drop-${drop.id.replace(/^drop:/, '').replace(/[^a-z0-9]+/gi, '-')}`,
      place,
      recoveredBy: state.player.cover.title,
      description: 'the contents of a hostile dead drop',
      contents: describeContents(drop.contents),
      subject: 'a hostile cache',
    },
    { ...namerContextOf(state), date: state.time, asserts },
  );
  return { document: composed.document, propositions: composed.propositions };
}

/** Register a composed Document and its Propositions on a copy of the state. */
function registerDocument(
  state: WorldState,
  document: Document,
  propositions: readonly Proposition[],
): WorldState {
  const documentPropositions = { ...state.documentPropositions };
  for (const prop of propositions) {
    documentPropositions[prop.id] = prop;
  }
  return {
    ...state,
    documents: { ...state.documents, [document.id]: document },
    documentPropositions,
  };
}

// ---------------------------------------------------------------------------
// Plot disruption + the 7.4 abort hook (Req 24.7)
// ---------------------------------------------------------------------------

/**
 * The Cell's `riskTolerance` the abort maths reads, from the resolved scenario /
 * preset doctrine ranges. The full Hostile Service doctrine is task 19's; the
 * abort formulas need only `riskTolerance`, so a documented default of the
 * preset's midpoint is used when no live doctrine is threaded in. Kept small so
 * a preset/doctrine field can drive it later.
 */
export const DEFAULT_RISK_TOLERANCE = 0.5;

/**
 * Mark the still-`pending` Plot Stages whose own traces collect a seized
 * delivery `disrupted` (design: `seize` "marks any Plot Stage that requires the
 * delivery as disrupted"; Req 24.7, 3.7). Now that a stage's traces carry the
 * bound materiel they collect (task 26.1), the seizure disrupts only the stage
 * whose own `drop-emptied` trace lifts one of the `seized` items — the stage the
 * seizure actually blocks — not every pending stage. A stage that merely loads a
 * drop, carries no matching delivery, or has already `executed`/`disrupted` is
 * left untouched. Pure: a new stages array.
 *
 * When `seized` is omitted the function keeps the old whole-operation behaviour
 * (every pending stage disrupted) as a documented fallback for callers that have
 * no item list in hand.
 */
export function disruptPendingStages(
  plot: PlotState,
  seized?: readonly ItemId[],
): PlotState {
  const seizedSet = seized === undefined ? undefined : new Set<ItemId>(seized);
  const stages: StageState[] = plot.stages.map((stage) => {
    if (stage.status !== 'pending') {
      return stage;
    }
    if (seizedSet === undefined || stageCollectsSeized(stage, seizedSet)) {
      return { ...stage, status: 'disrupted' };
    }
    return stage;
  });
  return { ...plot, stages };
}

/**
 * True when one of the stage's own `drop-emptied` traces collects a seized item
 * (its bound materiel is in `seized`) — the test the seizure uses to scope its
 * disruption to the stage that lifts the delivery (Req 24.7, 3.7).
 */
function stageCollectsSeized(
  stage: StageState,
  seized: ReadonlySet<ItemId>,
): boolean {
  return stage.traces.some(
    (trace) =>
      trace.kind === 'drop-emptied' &&
      trace.materiel !== undefined &&
      seized.has(trace.materiel),
  );
}

/**
 * True when the seized contents include the operation's materiel — the
 * condition task 7.4's `abortCheck`/`considerPlotDay` read as `materielSeized`,
 * and the one under which a `seize` sets `plot.materielSeized`
 * (slice-integration Req 4.4). Reads the Plot's ground-truth materiel item id.
 */
export function seizedContentsAreMateriel(
  plot: PlotState,
  contents: readonly ItemId[],
): boolean {
  const materiel = revealTruth(plot.materiel);
  return contents.includes(materiel);
}

// ---------------------------------------------------------------------------
// quote (Req 24.5, 24.6, 24.7)
// ---------------------------------------------------------------------------

/**
 * Quote a {@link ServiceDropAction} (pure, no draws). Allowed when the drop
 * exists and the player is standing at its Location (a drop is serviced at its
 * site; the shared Location gate maps `service-drop` to `player.loc`, so this
 * also checks `player.loc === drop.loc`). `hostileMode` is **required** for a
 * hostile drop and **forbidden** on the player's own drop (you do not copy or
 * seize your own cache). The cost is {@link SERVICE_DROP_PHASE_COST} and no
 * money.
 */
export function quoteServiceDrop(state: WorldState, a: ServiceDropAction): ActionQuote {
  const drop = state.deadDrops[a.drop];
  if (drop === undefined) {
    return { allowed: false, reason: `no such dead drop ${a.drop}`, phases: 0, money: 0 };
  }
  if (state.player.loc !== drop.loc) {
    return {
      allowed: false,
      reason: 'you must be at the drop site to service it',
      phases: 0,
      money: 0,
    };
  }
  const own = isOwnDrop(state, drop);
  if (own && a.hostileMode !== undefined) {
    return {
      allowed: false,
      reason: 'you cannot copy or seize your own drop',
      phases: 0,
      money: 0,
    };
  }
  if (!own && a.hostileMode === undefined) {
    return {
      allowed: false,
      reason: 'servicing a hostile drop requires a mode: copy or seize',
      phases: 0,
      money: 0,
    };
  }
  return { allowed: true, phases: SERVICE_DROP_PHASE_COST, money: 0 };
}

// ---------------------------------------------------------------------------
// resolve (Req 24.5, 24.6, 24.7)
// ---------------------------------------------------------------------------

/**
 * Optional per-service inputs a richer caller may supply, each with a documented
 * default so a plain caller (and the top-level `resolve`) need not pass them:
 *
 * - `watcher` — an explicit watcher NPC when the caller holds a richer drop
 *   model; defaults to {@link dropWatcher} (the drop's owner, when a person).
 * - `riskTolerance` — the Cell's doctrine `riskTolerance` for the abort maths;
 *   defaults to {@link DEFAULT_RISK_TOLERANCE} (task 19 threads the live one).
 * - `copyAsserts` — Propositions the copied/seized material asserts, when the
 *   caller can attach them to the drop's items; defaults to none (items carry no
 *   inherent Propositions in the slice's drop model).
 */
export interface ServiceDropInputs {
  readonly watcher?: NpcId;
  readonly riskTolerance?: number;
  readonly copyAsserts?: readonly Proposition[];
  /** When present, a seize records HANDS_OVER(holder, org:station, item). */
  readonly truth?: TruthAccess;
}

/** A stable event id for a drop event, derived from the drop, time and tag. */
function recordSeizure(
  state: WorldState,
  drop: DeadDrop,
  items: readonly ItemId[],
  truth: TruthAccess | undefined,
): void {
  if (truth === undefined) {
    return;
  }
  const facts = truth.facts().map((fact) => revealTruth(fact));
  for (const item of items) {
    const origin = truth.itemOrigin(item);
    const holder = currentHolder(facts, item, state.time, origin) ?? drop.owner;
    const recipient: EntityId = state.station.org;
    truth.addFact({
      id: `prop:hands-over:${item}:${state.time.day}.${state.time.phase}`,
      subject: holder,
      predicate: 'HANDS_OVER',
      object: recipient,
      instrument: item,
      place: drop.loc,
      window: { from: state.time },
    });
  }
}

function dropEventId(dropId: DeadDrop['id'], tag: string, state: WorldState): SimEvent['id'] {
  return `event:service-drop:${dropId}:${tag}:${state.time.day}.${state.time.phase}` as SimEvent['id'];
}

/** The acting person for the player's drop events — the Station officer (chief). */
function actingNpc(state: WorldState): NpcId {
  return state.station.chief;
}

/**
 * What a hostile `seize` reports to the caller beyond the next state: the
 * {@link EndedIntent} when seizing the materiel drove task 7.4's abort (so the
 * Turn Pipeline writes `WorldState.ended`), or `undefined` when no abort fired.
 * The design: seizing the Plot materiel calls the 7.4 abort hook; this resolver,
 * which does not run the clock tick, applies the abort directly and surfaces the
 * end intent here. The top-level `resolve` widens it to an `EndCondition`
 * (`endConditionFromAbort`) and passes it through as `ended`.
 */
export interface ServiceDropResult {
  readonly next: WorldState;
  readonly result: ActionResult;
  /** The end intent when a materiel seizure aborted the Plot (Req 24.7). */
  readonly ended?: EndedIntent;
}

/**
 * Resolve a {@link ServiceDropAction} (design `resolve`; draws only the
 * detection coin). The caller (`resolve`) has confirmed the action is allowed,
 * so the drop exists, the player is at its site, and `hostileMode` is present
 * exactly when the drop is hostile.
 *
 * See the module overview for the own-drop (Req 24.5, 24.6) and hostile-drop
 * (Req 24.7) behaviours. Fact Line rendering is left to the caller's `render`.
 * `content` carries the seized Document template; `inputs` supply the optional
 * watcher / doctrine / asserts.
 */
export function resolveServiceDrop(
  state: WorldState,
  a: ServiceDropAction,
  rng: Prng,
  seizedTemplate: DocumentTemplate | undefined,
  render: (state: WorldState, observations: readonly Observation[]) => string[],
  inputs: ServiceDropInputs = {},
): ServiceDropResult {
  const drop = state.deadDrops[a.drop];
  const watcher = inputs.watcher ?? dropWatcher(drop);
  const own = isOwnDrop(state, drop);

  return own
    ? resolveOwnDrop(state, a, drop, rng, watcher, render)
    : resolveHostileDrop(state, a, drop, rng, watcher, seizedTemplate, render, inputs);
}

/** Resolve servicing the player's own drop (Req 24.5, 24.6). */
function resolveOwnDrop(
  state: WorldState,
  a: ServiceDropAction,
  drop: DeadDrop,
  rng: Prng,
  watcher: NpcId | undefined,
  render: (state: WorldState, observations: readonly Observation[]) => string[],
): ServiceDropResult {
  const observations: Observation[] = [];
  const events: SimEvent[] = [];
  const delivered = drop.contents;
  const left = a.leave.map((ref) => ref.item);

  // Deliver the drop's current contents to the player (reported as a message).
  observations.push({
    kind: 'message',
    line:
      delivered.length > 0
        ? `You lift the drop: ${describeContents(delivered)}.`
        : 'The drop is empty.',
  });
  if (delivered.length > 0) {
    events.push({
      id: dropEventId(drop.id, 'emptied', state),
      at: state.time,
      visibility: 'hidden',
      kind: 'drop-emptied',
      drop: drop.id,
      by: actingNpc(state),
      items: delivered.map((item) => ({ item })),
      origin: DROP_SERVICE_ORIGIN,
    });
  }

  // Accept the items the player left — appended to the drop's contents so a
  // later collector lifts them (Req 24.6).
  if (left.length > 0) {
    observations.push({
      kind: 'message',
      line: `You leave ${describeContents(left)} in the drop.`,
    });
    events.push({
      id: dropEventId(drop.id, 'loaded', state),
      at: state.time,
      visibility: 'hidden',
      kind: 'drop-loaded',
      drop: drop.id,
      by: actingNpc(state),
      items: left.map((item) => ({ item })),
      origin: DROP_SERVICE_ORIGIN,
    });
  }

  const nextDrop: DeadDrop = { ...drop, contents: [...drop.contents, ...left] };
  let next: WorldState = {
    ...state,
    deadDrops: { ...state.deadDrops, [drop.id]: nextDrop },
  };

  // Exposure: half a meeting's, folded into the suspicion accumulator (Req 24.6).
  next = addDropExposure(next, drop.loc);

  // Detection against the watcher (Req 24.7).
  const detection = runWatcherDetection(next, rng, watcher);
  if (detection.detected) {
    next = raiseCoverSuspicion(next);
    if (detection.madeObservation !== undefined) {
      observations.push(detection.madeObservation);
    }
  }

  return {
    next,
    result: {
      observations,
      factLines: render(next, observations),
      scene: sceneDescriptorAt(next, state.player.loc),
      events,
      claimsAdded: [],
    },
  };
}

/** Resolve servicing a hostile drop — copy or seize (Req 24.7). */
function resolveHostileDrop(
  state: WorldState,
  a: ServiceDropAction,
  drop: DeadDrop,
  rng: Prng,
  watcher: NpcId | undefined,
  seizedTemplate: DocumentTemplate | undefined,
  render: (state: WorldState, observations: readonly Observation[]) => string[],
  inputs: ServiceDropInputs,
): ServiceDropResult {
  const observations: Observation[] = [];
  const events: SimEvent[] = [];
  const claimsAdded: string[] = [];
  let next: WorldState = state;

  // Compose seized-material Document(s) from the contents (both copy and seize).
  const asserts = inputs.copyAsserts ?? [];
  if (seizedTemplate !== undefined && drop.contents.length > 0) {
    const { document, propositions } = composeDropDocument(state, drop, asserts, seizedTemplate);
    next = registerDocument(next, document, propositions);
    for (const prop of propositions) {
      claimsAdded.push(prop.id);
    }
    observations.push({
      kind: 'message',
      line:
        a.hostileMode === 'seize'
          ? `You seize the drop's contents: ${describeContents(drop.contents)}.`
          : `You copy the drop's contents: ${describeContents(drop.contents)}.`,
    });
    if (a.hostileMode === 'copy') {
      // Copying reads the material in place: its Propositions are perceived
      // now, sourced to the seized Document, and the Document is marked read so
      // a later `read` of it adds no second copy of the same Claims (Req 30.4).
      const source: ObservationSource = { kind: 'document', id: document.id };
      for (const prop of propositions) {
        observations.push({ kind: 'proposition', prop, at: state.time, source });
      }
      next = markDocumentRead(next, document.id);
    }
  } else {
    observations.push({
      kind: 'message',
      line:
        drop.contents.length === 0
          ? 'The hostile drop is empty.'
          : `You work the hostile drop: ${describeContents(drop.contents)}.`,
    });
  }

  let ended: EndedIntent | undefined;

  if (a.hostileMode === 'seize') {
    const seized = drop.contents;
    recordSeizure(state, drop, seized, inputs.truth);
    // Empty the drop.
    const emptiedDrop: DeadDrop = { ...drop, contents: [] };
    next = { ...next, deadDrops: { ...next.deadDrops, [drop.id]: emptiedDrop } };

    // Disrupt the Plot: mark only the stage(s) whose own traces collect a
    // seized delivery disrupted (Req 24.7, 3.7), not every pending stage.
    let plot = disruptPendingStages(next.plot, seized);

    // The materiel-seizure hook (task 7.4): when the seized contents ARE the
    // Plot materiel, drive the abort directly (this resolver does not run the
    // clock tick), setting the Plot aborted and reporting the end intent. The
    // seizure itself is recorded on the Plot first (slice-integration Req 4.4),
    // so the aborted Plot carries `materielSeized` as a standing fact.
    if (seizedContentsAreMateriel(next.plot, seized)) {
      plot = { ...plot, materielSeized: true };
      const decision = applyAbort(plot, 'materiel-seized', next.time);
      plot = decision.plot;
      events.push(decision.event);
      ended = decision.ended;
      observations.push({
        kind: 'message',
        line: 'The seized materiel breaks the operation.',
      });
    }
    next = { ...next, plot };

    // Alert the Hostile Service: a `drop-emptied` event they read (task 19).
    events.push({
      id: dropEventId(drop.id, 'seized', state),
      at: state.time,
      visibility: 'hidden',
      kind: 'drop-emptied',
      drop: drop.id,
      by: actingNpc(state),
      items: seized.map((item) => ({ item })),
      origin: DROP_SERVICE_ORIGIN,
    });
  }
  // `copy` leaves the drop intact — no content change, no plot disruption.

  // Detection against the watcher (both modes; Req 24.7).
  const detection = runWatcherDetection(next, rng, watcher);
  if (detection.detected) {
    next = raiseCoverSuspicion(next);
    if (detection.madeObservation !== undefined) {
      observations.push(detection.madeObservation);
    }
  }

  return {
    next,
    result: {
      observations,
      factLines: render(next, observations),
      scene: sceneDescriptorAt(next, state.player.loc),
      events,
      claimsAdded,
    },
    ended,
  };
}

/**
 * Add half a meeting's Exposure to the player's `coverSuspicion` accumulator
 * (design: "Exposure added is half a meeting's"; Req 24.6). Reuses
 * arrange-meeting's {@link meetingExposure} on the scenario's `exposure` weights
 * with the drop Location's risk and the risk-proxy crowd penalty, scaled by
 * {@link DROP_EXPOSURE_FACTOR} and the shared {@link EXPOSURE_SUSPICION_SCALE},
 * clamped into `[0, 1]`.
 */
function addDropExposure(state: WorldState, loc: WorldState['player']['loc']): WorldState {
  const place = state.city.locations[loc];
  const risk = place?.risk ?? 0;
  const exposure = meetingExposure(exposureWeightsOf(state), risk, crowdPenaltyProxy(risk), 0);
  const delta = DROP_EXPOSURE_FACTOR * EXPOSURE_SUSPICION_SCALE * exposure;
  const next = clamp01(revealTruth(state.player.coverSuspicion) + delta);
  return { ...state, player: { ...state.player, coverSuspicion: asTruth(next) } };
}

/**
 * The Hostile Service's running state and daily tick (design, "Hostile Service
 * AI"; Requirements 12.1, 12.2, 12.3).
 *
 * This module composes the three leaves of task 19.1 — the doctrine draw
 * (`./doctrine.ts`), the belief model and Exposure tracking (`./beliefs.ts`),
 * and the detection check with its arrest/double/feed response selection
 * (`./detection.ts`) — into the engine-side {@link HostileServiceState} that
 * replaces the `Skeleton<'HostileServiceState'>` placeholder in
 * `../model/state.ts`, and into the daily counter-intelligence pass the clock's
 * `hostileTick` day-boundary hook fires.
 *
 * ## The state (design)
 *
 * ```ts
 * interface HostileService {
 *   doctrine: { riskTolerance; securityConsciousness; deceptionAppetite };
 *   beliefs: HostileBeliefs;
 *   dailyTick(state, rng): SimEvent[];
 * }
 * ```
 *
 * {@link HostileServiceState} carries the drawn {@link Doctrine} and the
 * {@link HostileBeliefs} that persist across days. The design's `dailyTick`
 * runs eight steps; **task 19.1 owns steps 1 and 2** (detection on each Asset
 * and the response to each detection) plus the doctrine draw (12.1) and the
 * Exposure/belief state (12.2). Steps 3–8 — mole report, Dangle/Walk-in
 * management, Plot adaptation, tailing, newspaper plants and comms traffic —
 * are later tasks (19.2–19.6) that thread into the same tick: task 19.3 adds
 * steps 3 and 6, task 19.4 adds steps 7 (`./newspaper-plants.ts`) and 8
 * (`./comms-traffic.ts`), and task 19.5 the arrest consequences. The module
 * composes those leaves in {@link dailyTickFull} rather than stubbing them.
 *
 * ## The daily tick (steps 1–2; Req 12.2, 12.3)
 *
 * {@link dailyTick} is pure: `(state, candidates, rng) → { next, events }`. It
 * reads the player's Assets (supplied as {@link DetectionCandidate}s so this
 * leaf does not reach into the Relationship model — the Turn Pipeline / hook
 * adapter projects them), runs {@link runDetection} on the day's stream, and
 * for each detection:
 *
 * - emits a hidden `asset-detected` event (every detection is recorded);
 * - **arrest** → a hidden `asset-arrested` event; the Asset is marked suspected;
 * - **double** → a hidden `asset-doubled` event; the Asset is marked suspected
 *   (the ground-truth `hostileControlled` flip on the Relationship is applied by
 *   the Turn Pipeline / task 19.5 from this decision — this leaf does not own
 *   the Relationship);
 * - **feed** → the Asset is marked suspected and kept in play; the deception
 *   selection and the `feed-delivered` scheduling are task 19.6's, so 19.1
 *   records the detection and leaves the feed payload to that task.
 *
 * The returned {@link HostileServiceState} has the detected Assets marked
 * suspected so a later day's tick does not re-detect them.
 *
 * ## The clock hook (design: `dailyTick` fires at the day boundary)
 *
 * {@link hostileDayBoundaryHook} adapts {@link dailyTick} into the clock's
 * `hostileTick` day-boundary hook (`ClockHooks.hostileTick: DayBoundaryHook`),
 * mirroring `plotDayBoundaryHook` / `schedulesDayBoundaryHook`: a closure over
 * the world projection and a `makePrng` builds the day's {@link Prng} from the
 * context's `dailyStreamSeed` and returns the tick's events. The hook contract
 * is events-only, so the updated {@link HostileServiceState} it computes is
 * surfaced through an injected `commit` callback the Turn Pipeline fills (the
 * clock itself threads no world state); a caller that only wants the events can
 * omit it.
 *
 * ## Purity / determinism
 *
 * {@link dailyTick} and {@link drawDoctrine} are pure and draw only from the
 * passed Prng in a fixed order, so a seed fully determines the doctrine and
 * every day's detections (Requirement 1.2).
 */

import type { GameTime, NpcId, Proposition } from '../model/core.js';
import type { EventId, PlotState, SimEvent } from '../model/state.js';
import type { Prng } from '../prng/prng.js';
import { markSuspected } from './beliefs.js';
import {
  runDetection,
  type DetectionBase,
  type DetectionCandidate,
  type DetectionResponse,
} from './detection.js';
import { readWalkIns, type WalkInReading } from './dangles.js';
import {
  decideDoubling,
  type ChickenfeedCandidate,
  type DoublingDecision,
} from './doubling.js';
import { adaptToBeliefs, type AdaptationContext } from './adaptation.js';
import {
  arrestConsequences,
  arrestArticles,
  type ArrestConsequences,
  type CommitmentProjection,
  type ArrestArticleProjection,
} from './consequences.js';
import type { NewspaperItem } from '../docs/newspaper.js';
// Task 19.3: mole report ingestion (step 3) and player tailing / burn (step 6).
import {
  ingestMoleReport,
  type MoleReport,
} from './mole-report.js';
// Task 19.6: feed ingestion (step 5 ingest) and the compromised-Channel
// disruption that feeds the Plot abort path (Req 38.3).
import { ingestFeed, type FeedDelivery } from './ingest-feed.js';
import { accruePressure } from '../clock/plot-abort.js';
import type { ChannelId } from '../model/core.js';
import {
  decideTailing,
  type TailingDecision,
  type TailingInputs,
  type TailingThresholds,
} from './tailing.js';
// Task 19.4: newspaper plants (step 7) and daily comms traffic (step 8).
import {
  planNewspaperPlants,
  type PlantProjection,
} from './newspaper-plants.js';
import {
  produceCommsTraffic,
  type HostileChannelProjection,
} from './comms-traffic.js';
import type { InterceptSource } from '../cipher/intercept.js';
import { type HostileServiceState } from './service-state.js';

// Re-export the data-only core so callers reach the whole Hostile Service
// surface through this module. The state type and its initial draw live in
// `./service-state.ts` (which imports no `../model/state.js`, so
// `../model/state.ts` can import the type without a cycle); the event-emitting
// tick and the hook adapter below need `SimEvent` and so live here.
export {
  initialHostileServiceState,
  type HostileServiceState,
} from './service-state.js';

// The Dangle/Walk-in (step 4), doubling (steps 2/5) and belief-driven
// adaptation (step 5) leaves this module composes into the full daily tick.
export {
  classifyWalkIn,
  readWalkIns,
  type WalkInClassification,
  type WalkInApproach,
  type WalkInReading,
} from './dangles.js';
export {
  chickenfeedCount,
  selectChickenfeed,
  decideDoubling,
  MAX_CHICKENFEED_ITEMS,
  type ChickenfeedCandidate,
  type Chickenfeed,
  type DoublingDecision,
} from './doubling.js';
export {
  classifyBelief,
  adaptToBeliefs,
  type AdaptationContext,
  type AdaptationKind,
  type AdaptationResult,
} from './adaptation.js';
// Task 19.6: feed ingestion (design "Feed ingestion"; Req 37.3, 37.4, 37.5).
export {
  ingestFeed,
  adoptionThreshold,
  CONFIRM_CREDIBILITY,
  REFUTE_CREDIBILITY,
  REFUTE_SUSPICION,
  type FedProposition,
  type FeedDelivery,
  type FeedClass,
  type IngestFeedResult,
} from './ingest-feed.js';
// Task 19.3: mole report ingestion (step 3) and player tailing / burn (step 6).
export {
  ingestMoleReport,
  type MoleReport,
  type MoleReportResult,
} from './mole-report.js';
export {
  decideTailing,
  tailingThresholds,
  DEFAULT_TAIL_SUSPICION_DELTA,
  DEFAULT_TAIL_START,
  TAIL_START_SECURITY_SPAN,
  TAIL_HYSTERESIS,
  type TailingThresholds,
  type TailingInputs,
  type TailingDecision,
  type TailingResult,
} from './tailing.js';

// The off-screen consequences of the hidden events (task 19.5; Req 39.4, 39.5):
// the arrested Asset's voided meetings/drops (for player-view's 16.6 to raise
// its derived Notifications) and the public arrest article gated by
// `1 − deceptionAppetite`. Doubling is deliberately absent — a double has no
// observable consequence (Req 39.4).
export {
  arrestConsequences,
  arrestArticles,
  arrestArticle,
  buildArrestArticle,
  arrestArticleProbability,
  type ArrestConsequences,
  type VoidedMeeting,
  type VoidedDrop,
  type AssetCommitments,
  type CommitmentProjection,
  type ArrestArticleContext,
  type ArrestArticleProjection,
} from './consequences.js';

// Task 19.4: the newspaper plants (step 7; Req 30.2) and the daily comms
// traffic for the Cipher Engine (step 8; Req 29.4) leaves this module composes
// into the full daily tick.
export {
  planNewspaperPlants,
  buildPlantItem,
  plantCount,
  plantProbability,
  MAX_PLANTS_PER_DAY,
  type PlantCandidate,
  type PlantProjection,
} from './newspaper-plants.js';
export {
  produceCommsTraffic,
  decoyProposition,
  hostileTransmissionId,
  type HostileChannel,
  type HostileChannelProjection,
  type HostileOwnerKind,
} from './comms-traffic.js';

// ---------------------------------------------------------------------------
// The daily tick (steps 1–2; Req 12.2, 12.3)
// ---------------------------------------------------------------------------

/** The result of a {@link dailyTick}: the updated state and the day's events. */
export interface DailyTickResult {
  /** The Hostile Service state after the day's detection pass. */
  readonly next: HostileServiceState;
  /** The events the tick emitted, in deterministic order. */
  readonly events: readonly SimEvent[];
}

/** Deterministically mint a hostile-tick event id from a tag, time and seq. */
function hostileEventId(tag: string, at: GameTime, seq: number): EventId {
  return `hostile-evt:${tag}:${at.day}:${at.phase}:${seq}`;
}

/** The hidden SimEvent kind a response maps to (feed records only a detection). */
function responseEventKind(
  response: DetectionResponse,
): 'asset-arrested' | 'asset-doubled' | null {
  switch (response) {
    case 'arrest':
      return 'asset-arrested';
    case 'double':
      return 'asset-doubled';
    case 'feed':
      // The feed payload (deception selection, `feed-delivered` scheduling) is
      // task 19.6's; 19.1 records the detection and keeps the Asset in play.
      return null;
  }
}

/**
 * The default per-day detection base used when no preset base is threaded in.
 * Matches the `standard` preset's `detectionBase` so a direct {@link dailyTick}
 * call behaves like a standard game; the hook adapter and the Turn Pipeline
 * override it with the live preset base via {@link dailyTickWithBase}.
 */
export const DEFAULT_DETECTION_BASE: DetectionBase = {
  surveil: 0.1,
  meeting: 0.06,
  drop: 0.04,
};

/** Added to the next detection check when a hostile informant names who was seen. */
export const INFORMANT_DETECTION_BONUS = 0.1;

/**
 * Run the Hostile Service's daily counter-intelligence pass — detection on each
 * Asset and the response to each detection (design, `dailyTick` steps 1–2;
 * Req 12.2, 12.3). Pure: draws only from `rng`, one coin per not-yet-detected
 * candidate in the order given (sort candidates by id for determinism).
 *
 * For each detection it emits a hidden `asset-detected` event, then the
 * response-specific event (`asset-arrested` for arrest, `asset-doubled` for
 * double, none for feed — the feed payload is task 19.6), and marks the Asset
 * suspected in the returned {@link HostileBeliefs} so it is not re-detected.
 *
 * The off-screen consequences of each response (the arrested Asset missing
 * later meetings, the doubled Asset's `hostileControlled` flip) live on the
 * Relationship, which this leaf does not own; the Turn Pipeline / task 19.5
 * applies them from the `events` and `detections` this returns.
 *
 * This convenience form uses {@link DEFAULT_DETECTION_BASE}; the hook adapter
 * and the Turn Pipeline call {@link dailyTickWithBase} with the live preset's
 * detection rates.
 */
export function dailyTick(
  state: HostileServiceState,
  candidates: readonly DetectionCandidate[],
  at: GameTime,
  rng: Prng,
): DailyTickResult {
  return dailyTickWithBase(state, candidates, at, rng, DEFAULT_DETECTION_BASE);
}

/**
 * {@link dailyTick} with an explicit {@link DetectionBase} (the preset's). The
 * single implementation of the daily pass; {@link dailyTick} delegates here with
 * {@link DEFAULT_DETECTION_BASE}. Pure: draws only from `rng`, one coin per
 * not-yet-detected candidate in candidate order.
 */
export function dailyTickWithBase(
  state: HostileServiceState,
  candidates: readonly DetectionCandidate[],
  at: GameTime,
  rng: Prng,
  base: DetectionBase,
  bonuses: Readonly<Record<string, number>> = {},
): DailyTickResult {
  const { detections } = runDetection(
    rng,
    candidates,
    state.beliefs,
    state.doctrine,
    base,
    bonuses,
  );

  const events: SimEvent[] = [];
  let beliefs = state.beliefs;
  let seq = 0;

  for (const detection of detections) {
    const npc: NpcId = detection.npc;
    events.push({
      id: hostileEventId('detected', at, seq),
      at,
      visibility: 'hidden',
      kind: 'asset-detected',
      npc,
    });
    seq += 1;

    const kind = responseEventKind(detection.response);
    if (kind !== null) {
      events.push({
        id: hostileEventId(detection.response, at, seq),
        at,
        visibility: 'hidden',
        kind,
        npc,
      });
      seq += 1;
    }

    beliefs = markSuspected(beliefs, npc);
  }

  return { next: { ...state, beliefs }, events };
}

// ---------------------------------------------------------------------------
// The full daily tick (steps 1–5; Req 11.1–11.5, 22.7)
// ---------------------------------------------------------------------------

/**
 * The reportable true Propositions a detected Asset could feed back as
 * Chickenfeed if it is doubled, keyed by the Asset's NPC id. The Turn Pipeline
 * projects these from each Asset's access slice (the leaf is Relationship-free);
 * {@link decideDoubling} picks a doctrine-sized subset. An Asset absent from the
 * map simply doubles with empty Chickenfeed.
 */
export type ChickenfeedPool = Readonly<Record<NpcId, readonly ChickenfeedCandidate[]>>;

/**
 * The extra inputs the full daily tick reads beyond the detection pass: the
 * day's events (for the Walk-in management the schedules hook already rolled),
 * the Chickenfeed each Asset could feed if doubled, the running Plot and the
 * adaptation projection (who the Cell members / target are). All optional, so a
 * caller that only wants steps 1–2 keeps the plain {@link dailyTickWithBase}.
 */
export interface FullTickInputs {
  /**
   * The day's events the schedules hook produced, scanned for hidden
   * `walk-in-approach` events to classify as genuine or Dangle (step 4). This
   * tick never re-rolls a Walk-in — it reads what the daily stream decided.
   */
  readonly dayEvents?: readonly SimEvent[];
  /** The reportable true Propositions each Asset could feed as Chickenfeed. */
  readonly chickenfeed?: ChickenfeedPool;
  /** The running Plot, for belief-driven adaptation (step 5). */
  readonly plot?: PlotState;
  /** The adaptation projection; required to run step 5. */
  readonly adaptation?: AdaptationContext;
  /** The beliefs newly adopted this tick (from a mole, a feed, observation). */
  readonly newlyAdopted?: readonly Proposition[];
  /**
   * The feeds delivered to the Hostile Service today (task 19.6; Req 37.3,
   * 37.4, 37.5), projected in by the Turn Pipeline from the day's
   * `feed-delivered` events: the turned agent, the fed Propositions and, per
   * Proposition, the service's confirm/refute/holds reads and the Plot Channel
   * it names (if any). The tick runs {@link ingestFeed} over each, folding the
   * credibility moves and the adopted beliefs into the service beliefs; the
   * newly-adopted beliefs join step 5's adaptation and the compromised Channels
   * each raise Abort Pressure. Omitted ⇒ no feed arrived today, so the feed
   * ingest is a no-op.
   */
  readonly feeds?: readonly FeedDelivery[];
  /**
   * Each Asset's upcoming commitments to the player (the meetings the player
   * arranged with it and the drops it was tasked to load), projected in by the
   * Turn Pipeline so the off-screen arrest consequences (task 19.5) can void the
   * commitments of an arrested Asset. Omitted ⇒ no commitments are voided.
   */
  readonly commitments?: CommitmentProjection;
  /**
   * The place/assertion context for each Asset's public arrest article (task
   * 19.5), projected in by the Turn Pipeline. An arrested Asset absent from the
   * map still gets a neutral article when the article is printed.
   */
  readonly arrestArticleContext?: ArrestArticleProjection;
  // --- Task 19.3 inputs (steps 3 and 6) ---------------------------------
  /**
   * The day's mole report, when a mole is enabled (step 3; Req 12.4): the mole
   * NPC and the Station-known/suspected Propositions it relays, projected in by
   * the Turn Pipeline from the Station's Knowledge Slice. Omitted ⇒ no mole in
   * play, so step 3 is a no-op. Beliefs newly adopted from the report are merged
   * into the service's beliefs and fed to step-5 adaptation.
   */
  readonly moleReport?: MoleReport;
  /**
   * The player's current Cover Suspicion and tailed flag, projected in by the
   * Turn Pipeline from `WorldState.player`, for the tailing decision and burn
   * check (step 6; Req 12.5, 21.4). Omitted ⇒ step 6 is skipped (no tailing
   * decision is returned). The leaf never touches `WorldState.player`.
   */
  readonly tailing?: TailingInputs;
  /**
   * The Cover-Suspicion thresholds for the tailing decision and the burn check
   * (step 6), built from the service doctrine and the preset's
   * `coverSuspicionBurnThreshold` via `tailingThresholds`. Required alongside
   * {@link FullTickInputs.tailing} to run step 6.
   */
  readonly tailingThresholds?: TailingThresholds;
  /**
   * Bonuses added to this tick's detection probability, keyed by NPC id.
   * Omitted means every bonus is zero, so the detection coins match the slice.
   */
  readonly detectionBonuses?: Readonly<Record<string, number>>;
  /**
   * Hidden informant reports recorded by the ambient hook gateway. The tailing
   * step reads a hostile-handler report and turns its seen-with NPC into a
   * detection bonus for the next detection pass.
   */
  readonly informantReports?: readonly InformantReportInput[];
  // --- Task 19.4 inputs (steps 7 and 8) ---------------------------------
  /**
   * The day's candidate newspaper plants (step 7; Req 30.2), projected in by the
   * Turn Pipeline: the false Propositions the service could place in the paper
   * to mislead the player, keyed by candidate id. Omitted ⇒ nothing to plant, so
   * step 7 is a no-op. A deception-happy service plants more of these (gated and
   * weighted by `deceptionAppetite`); the chosen plants are returned as
   * {@link NewspaperItem}s the pipeline folds into the day's newspaper material.
   */
  readonly plantCandidates?: PlantProjection;
  /**
   * The interceptable Channels the Hostile Service runs today (step 8; Req
   * 29.4), projected in by the Turn Pipeline from the world's Channels: the
   * service's own link to the Cell and the decoy noise channels it runs, each
   * with the day's firing phases and any real payload. Omitted ⇒ the service
   * runs no traffic today, so step 8 is a no-op. The day's transmissions are
   * returned as {@link InterceptSource} data the pipeline threads into the
   * Cipher Engine's intercept path.
   */
  readonly commsChannels?: HostileChannelProjection;
}

/**
 * The result of a {@link dailyTickFull}: the detection-pass result plus the data
 * the Turn Pipeline applies for steps 3–5. The leaf stays Relationship-free and
 * Plot-structure-light, so the doublings and the Walk-in reading are returned as
 * data; the adapted {@link PlotState} is returned when a Plot was supplied.
 */
export interface FullTickResult extends DailyTickResult {
  /** The service's reading of the day's Walk-ins (step 4): Dangles vs genuine. */
  readonly walkIns: WalkInReading;
  /**
   * The doubling decisions (one per `double` detection) the pipeline applies:
   * the `hostileControlled` flip and the Chickenfeed the doubled Asset feeds
   * back (steps 2/5). Empty when no detection chose to double.
   */
  readonly doublings: readonly DoublingDecision[];
  /**
   * The Plot after belief-driven adaptation raised Abort Pressure (step 5), or
   * `undefined` when no Plot/adaptation projection was supplied. The caller runs
   * `considerPlotDay` / `abortCheck` on this.
   */
  readonly plot?: PlotState;
  /**
   * The off-screen consequences of the day's arrests (task 19.5; Req 39.5): the
   * meetings each arrested Asset will no-show and the drops it will leave
   * unserviced. The Turn Pipeline applies these to `WorldState.meetings` / the
   * drops' expected-loader records so player-view's 16.6 raises the derived
   * `meeting-no-show` / `drop-unserviced` Notifications. Empty when no Asset was
   * arrested or no commitments were projected in.
   */
  readonly arrestConsequences: ArrestConsequences;
  /**
   * The public arrest articles the day's arrests printed, each gated by
   * `1 − deceptionAppetite` (task 19.5; Req 39.4). The Turn Pipeline folds these
   * into the day's newspaper material. Empty when no arrest made the papers.
   */
  readonly arrestArticles: readonly NewspaperItem[];
  /**
   * The Propositions the service newly adopted from this day's mole report
   * (step 3; Req 12.4), empty when no mole or nothing new was relayed. Carried
   * so the Turn Pipeline / debrief can see what the mole just told the service;
   * these are also folded into `next.beliefs` and fed to step-5 adaptation.
   */
  readonly moleAdopted: readonly Proposition[];
  /**
   * The chickenfeed/deception classification of every fed Proposition the
   * service ingested today (task 19.6; Req 37.3), keyed by the agent's NPC id in
   * the order the feeds were delivered. Carried for the debrief (Req 37.6: the
   * Player View never sees it); empty when no feed arrived. The Propositions the
   * service newly adopted from these feeds are folded into `next.beliefs` and
   * fed to step-5 adaptation.
   */
  readonly feedClasses: Readonly<Record<NpcId, readonly ('chickenfeed' | 'deception')[]>>;
  /**
   * The Plot Channels a credible feed newly marked compromised this tick (task
   * 19.6; Req 38.3), already folded into `next.beliefs.compromisedChannels` and
   * (when a Plot was supplied) counted as Abort Pressure on the returned
   * {@link PlotState}. Carried so the Turn Pipeline can switch the Plot's stages
   * off these Channels. Empty when no adopted belief named a Plot Channel.
   */
  readonly compromisedChannels: readonly ChannelId[];
  /**
   * The player tailing / burn decision (step 6; Req 12.5, 21.4), or `undefined`
   * when no tailing inputs/thresholds were projected in. The Turn Pipeline
   * writes `tailed` → `player.tailed`, `coverSuspicion` → `player.coverSuspicion`
   * and sets the burn/lose condition when `burned`.
   */
  readonly tailing?: TailingDecision;
  /**
   * The false stories the service planted in today's paper (step 7; task 19.4,
   * Req 30.2), gated/weighted by `deceptionAppetite`. The Turn Pipeline folds
   * these into the day's newspaper material (`NewspaperMaterial`) as extra
   * `rumour`-source items, where the composer prints them among the edition's
   * 3–6 articles. Empty when nothing was planted.
   */
  readonly newspaperPlants: readonly NewspaperItem[];
  /**
   * The service's daily comms traffic for the Cipher Engine (step 8; task 19.4,
   * Req 29.4): the interceptable transmissions it put on its channels today, as
   * {@link InterceptSource} data the Turn Pipeline threads into the Cipher
   * Engine's intercept path (the same path world-assembly seeding feeds). Empty
   * when the service ran no interceptable traffic today.
   */
  readonly commsTraffic: readonly InterceptSource[];
  /**
   * Detection bonuses the tailing step produced from hostile informant reports.
   * The next detection pass consumes them. Empty when no hostile report named
   * a seen-with NPC.
   */
  readonly spawnedDetectionBonuses: readonly { readonly npc: NpcId; readonly bonus: number }[];
}

/** A hidden informant report the ambient gateway hands the tailing step. */
export interface InformantReportInput {
  readonly handler: 'police' | 'hostile';
  readonly seenWith?: NpcId;
}

/**
 * Run the Hostile Service's full daily pass — the detection pass (steps 1–2),
 * Dangle/Walk-in management (step 4) and belief-driven Plot adaptation (step 5)
 * — composing the leaves this module owns (design, `dailyTick`; Req 11.1–11.5,
 * 22.7). Pure: it draws only from `rng` (the detection coins), in the same fixed
 * order {@link dailyTickWithBase} uses; steps 4 and 5 make no draws (step 4
 * reads the schedules hook's Walk-in events, step 5 reads newly-adopted
 * beliefs), so threading them in cannot shift the stream.
 *
 * Steps, in order:
 *
 * 1–2. {@link dailyTickWithBase} runs detection and emits the hidden
 *      `asset-detected` / `asset-arrested` / `asset-doubled` events, marking
 *      each detected Asset suspected.
 * 3.   {@link ingestMoleReport} folds the day's mole report (if a mole exists)
 *      into the service's beliefs, emitting the hidden `mole-report` /
 *      `belief-adopted` events (Req 12.4). The newly-adopted beliefs join
 *      `inputs.newlyAdopted` for step 5.
 * 5i.  {@link ingestFeed} folds each feed the service received today (task 19.6;
 *      Req 37.3, 37.4, 37.5) into its beliefs — moving the agent's credibility
 *      by what it can confirm/refute, adopting the beliefs that clear the
 *      doctrine threshold, and marking compromised any Plot Channel a credible
 *      feed names. The newly-adopted beliefs join step 5's adaptation and the
 *      compromised Channels each raise Abort Pressure under the Plot execution
 *      path's `channel-compromised:<chan>` key (Req 38.3). No draws.
 * 4.   {@link readWalkIns} classifies the day's `walk-in-approach` events into
 *      the Dangles the service runs and the genuine volunteers (Req 11.1,
 *      22.7).
 * 2/5. For each `double` detection, {@link decideDoubling} forms the
 *      `hostileControlled` flip and the Chickenfeed the Asset feeds back
 *      (Req 11.3, 11.4, 11.5), returned as data for the pipeline to apply.
 * 5.   When a Plot and projection are supplied, {@link adaptToBeliefs} reroutes
 *      / retargets the operation and raises Abort Pressure through the existing
 *      plot-abort hook for each newly-adopted belief about the target or a Cell
 *      member (Req 11.4, 11.5), appending the hidden `plot-adapted` events.
 *
 * The detection events, then the adaptation events, make up `events`. The
 * caller (the Turn Pipeline / day-boundary adapter) applies the doublings to the
 * Relationship model, takes up the Dangles, and runs the Plot abort check on the
 * returned {@link PlotState}.
 *
 * It also returns the day's off-screen arrest consequences (task 19.5;
 * Req 39.4, 39.5): the meetings/drops an arrested Asset voids (for player-view's
 * 16.6 to raise its derived `meeting-no-show` / `drop-unserviced` Notifications)
 * and the public arrest articles printed with `1 − deceptionAppetite`. These
 * read only `asset-arrested` events, so a quietly doubled Asset produces no
 * consequence and stays signal-free (Req 39.4).
 *
 * Step 6 (task 19.3; Req 12.5, 21.4) decides the day's tailing of the player
 * from the projected Cover Suspicion and checks the burn threshold, emitting
 * `tail-started` / `tail-ended` / `player-burned` and returning the decision
 * data for the pipeline to write back to the player. Steps 3 and 6 make no
 * draws, so they do not shift the detection or arrest-article streams.
 *
 * 7.   {@link planNewspaperPlants} (task 19.4; Req 30.2) decides the false
 *      stories the service plants in the day's paper, gated/weighted by
 *      `deceptionAppetite`, returned as {@link NewspaperItem}s for the pipeline
 *      to fold into the newspaper material.
 * 8.   {@link produceCommsTraffic} (task 19.4; Req 29.4) produces the service's
 *      daily interceptable transmissions as {@link InterceptSource} data for the
 *      Cipher Engine's intercept path.
 *
 * **Draw order (task 19.4).** The step-7 plant coins draw strictly *after* the
 * step 1–2 detection coins and the task-19.5 arrest-article coins, so adding
 * them cannot shift those streams; step 8 makes no draws at all. The clock hook
 * ordering is unchanged — steps 7–8 are appended inside the same tick.
 */
export function dailyTickFull(
  state: HostileServiceState,
  candidates: readonly DetectionCandidate[],
  at: GameTime,
  rng: Prng,
  base: DetectionBase,
  inputs: FullTickInputs = {},
): FullTickResult {
  // Steps 1–2: detection and the per-response events.
  const detectionPass = dailyTickWithBase(
    state,
    candidates,
    at,
    rng,
    base,
    inputs.detectionBonuses ?? {},
  );
  const events: SimEvent[] = [...detectionPass.events];
  let next = detectionPass.next;

  // Step 3 (task 19.3): mole report ingestion, if a mole exists (Req 12.4). No
  // draws — a pure fold through `adoptBelief` — so inserting it here does not
  // shift the detection stream. Its newly-adopted beliefs are merged into the
  // service beliefs and joined with any `inputs.newlyAdopted` for step 5, so the
  // Cell adapts to what the mole just told the service.
  const mole = ingestMoleReport(next.beliefs, inputs.moleReport, at);
  next = { ...next, beliefs: mole.beliefs };
  events.push(...mole.events);

  // Step 5 (ingest): feed ingestion (task 19.6; Req 37.3, 37.4, 37.5). No draws
  // — the classification/confirm/refute reads and the credibility arithmetic are
  // pure — so running it here does not shift the detection stream. Each delivered
  // feed moves the agent's credibility and adopts the beliefs it clears the
  // doctrine threshold for; the newly-adopted beliefs join `newlyAdopted` for the
  // step-5 adaptation below, and the Channels a credible feed marks compromised
  // are collected for the Plot disruption / Abort Pressure (Req 38.3).
  const feedClasses: Record<NpcId, readonly ('chickenfeed' | 'deception')[]> = {};
  const feedAdopted: Proposition[] = [];
  const compromisedChannels: ChannelId[] = [];
  for (const delivery of inputs.feeds ?? []) {
    const ingest = ingestFeed(next.beliefs, delivery, state.doctrine, at);
    next = { ...next, beliefs: ingest.beliefs };
    events.push(...ingest.events);
    feedClasses[delivery.agent] = ingest.classes;
    feedAdopted.push(...ingest.adopted);
    for (const channel of ingest.compromisedChannels) {
      if (!compromisedChannels.includes(channel)) {
        compromisedChannels.push(channel);
      }
    }
  }

  // Step 4: Dangle / Walk-in management — read the schedules hook's events.
  const walkIns = readWalkIns(inputs.dayEvents ?? []);

  // Steps 2/5: doubling decisions for each `double` detection. A detection
  // emitted an `asset-doubled` event iff it chose to double, so read those.
  const doublings: DoublingDecision[] = [];
  for (const event of detectionPass.events) {
    if (event.kind !== 'asset-doubled') {
      continue;
    }
    const pool = inputs.chickenfeed?.[event.npc] ?? [];
    doublings.push(decideDoubling(event.npc, state.doctrine, pool));
  }

  // Step 5: belief-driven Plot adaptation, when a Plot and projection are given.
  // The beliefs newly adopted this tick are the caller-supplied ones, the mole's
  // step-3 relay (task 19.3) and the feeds the service just ingested (task 19.6),
  // so the Cell adapts to a credible feed as well as to the mole's report. They
  // flow through the one `newlyAdopted` channel so `adaptToBeliefs`' once-per-key
  // tally still counts each belief once (no double-count — Property 27).
  const newlyAdopted = [...(inputs.newlyAdopted ?? []), ...mole.adopted, ...feedAdopted];
  let plot = inputs.plot;
  if (plot !== undefined && inputs.adaptation !== undefined) {
    const adaptation = adaptToBeliefs(
      plot,
      newlyAdopted,
      inputs.adaptation,
      at,
    );
    plot = adaptation.plot;
    events.push(...adaptation.events);

    // A belief-compromised Plot Channel is also a stage disruption (design,
    // step-5 rule 3; Req 38.3): add it to Abort Pressure under the same
    // distinct-disruption key the Plot execution path uses
    // (`channel-compromised:<chan>`), so a Channel compromised via a feed and
    // via a stage disruption counts once. `accruePressure` dedupes the key, so
    // the same compromised Channel presses pressure once across the game.
    for (const channel of compromisedChannels) {
      plot = accruePressure(plot, `channel-compromised:${channel}`);
    }
  }

  // Task 19.5: the off-screen consequences of the day's arrests. The voided
  // meetings/drops are a pure projection (no draws); the public arrest articles
  // draw one coin per arrested Asset against `1 − deceptionAppetite`. Those
  // draws run strictly *after* the detection coins (steps 1–2, above) and after
  // steps 4/5 (which make no draws), so threading them in cannot shift the
  // detection stream. Neither reads `asset-doubled`, so a double stays
  // signal-free (Req 39.4).
  const consequences = arrestConsequences(
    detectionPass.events,
    inputs.commitments ?? {},
  );
  const articles = arrestArticles(
    detectionPass.events,
    at.day,
    state.doctrine,
    inputs.arrestArticleContext ?? {},
    rng,
  );

  // Step 6 (task 19.3): tailing of the player from Cover Suspicion and the burn
  // threshold (Req 12.5, 21.4). No draws, so running it after the arrest-article
  // coins cannot shift any stream. Only runs when the Turn Pipeline projected
  // the player's Cover Suspicion / tailed state and the thresholds in; the
  // decision is returned as data for the pipeline to write back to the player.
  let tailing: TailingDecision | undefined;
  if (inputs.tailing !== undefined && inputs.tailingThresholds !== undefined) {
    const result = decideTailing(inputs.tailing, inputs.tailingThresholds, at);
    tailing = result.decision;
    events.push(...result.events);
  }

  // Ambient informant reports are read here, after tailing, and never mark a
  // channel compromised. A hostile report that names who was seen produces a
  // detection bonus for the next detection pass.
  const spawnedDetectionBonuses: { npc: NpcId; bonus: number }[] = [];
  for (const report of inputs.informantReports ?? []) {
    if (report.handler === 'hostile' && report.seenWith !== undefined) {
      spawnedDetectionBonuses.push({ npc: report.seenWith, bonus: INFORMANT_DETECTION_BONUS });
    }
  }

  // Step 7 (task 19.4): newspaper plants (Req 30.2). `planNewspaperPlants` draws
  // one coin per considered candidate on `rng`, gated/weighted by
  // `deceptionAppetite`. These draws run strictly *after* the detection coins
  // (steps 1–2) and the arrest-article coins (task 19.5, above) — and after
  // steps 3/4/5/6, which make no draws — so threading them in cannot shift the
  // detection or arrest-article streams. The chosen plants are returned as data
  // for the pipeline to fold into the day's newspaper material.
  const newspaperPlants = planNewspaperPlants(
    state.doctrine,
    inputs.plantCandidates ?? {},
    at,
    rng,
  );

  // Step 8 (task 19.4): the service's daily comms traffic for the Cipher Engine
  // (Req 29.4). `produceCommsTraffic` makes NO draws — it is a pure projection of
  // the day's channel firings into interceptable transmissions — so running it
  // last cannot shift any stream. The returned sources are data the pipeline
  // threads into the Cipher Engine's intercept path (encipher + collect); this
  // leaf never reaches into `WorldState`.
  const commsTraffic = produceCommsTraffic(inputs.commsChannels ?? {}, at);

  return {
    next,
    events,
    walkIns,
    doublings,
    plot,
    arrestConsequences: consequences,
    arrestArticles: articles,
    moleAdopted: mole.adopted,
    feedClasses,
    compromisedChannels,
    tailing,
    newspaperPlants,
    commsTraffic,
    spawnedDetectionBonuses,
  };
}

// ---------------------------------------------------------------------------
// The clock hook adapter
// ---------------------------------------------------------------------------

/**
 * The world projection the hostile day-boundary hook closes over. Read-only.
 * The hook needs the current {@link HostileServiceState}, the Asset candidates
 * to check (projected from the Relationship model by the Turn Pipeline so this
 * leaf stays Relationship-free) and the preset's detection base.
 */
export interface HostileWorld {
  /** The current Hostile Service state. */
  readonly hostile: HostileServiceState;
  /** The player's Assets to run detection on, as detection candidates. */
  readonly candidates: readonly DetectionCandidate[];
  /** The preset's per-day detection base. */
  readonly detectionBase: DetectionBase;
}

/**
 * Adapt {@link dailyTickWithBase} into the clock's `hostileTick` day-boundary
 * hook (`ClockHooks.hostileTick: DayBoundaryHook`). On each day boundary the
 * returned hook builds a {@link Prng} from the context's `dailyStreamSeed`, runs
 * the tick over the world projection, surfaces the updated
 * {@link HostileServiceState} through the optional `commit` callback (the clock
 * threads no world state, so the Turn Pipeline fills this to persist the new
 * beliefs), and returns the tick's events.
 *
 * `world`, `makePrng`, `commit` are closed over at build time; the hook is
 * otherwise a pure function of its context. The context type is kept structural
 * (`{ time; dailyStreamSeed }`) so this module matches the clock's
 * {@link import('../clock/clock.js').HookContext} shape without importing it for
 * a value — exactly as `schedulesDayBoundaryHook` does.
 *
 * @deprecated The events-only day-boundary adapter. The game path uses the
 * `hostileTick` state reducer in `../clock/world-hooks.ts` (`buildWorldHooks`),
 * run by `advanceWorld` (`../clock/advance-world.ts`), which applies the
 * Hostile Full Tick's state changes (`applyFullTick`) to the Draft and not only
 * its events. Kept for the existing tests and golden replays.
 */
export function hostileDayBoundaryHook(
  world: HostileWorld,
  makePrng: (dailyStreamSeed: string) => Prng,
  commit?: (next: HostileServiceState) => void,
): (ctx: { readonly time: GameTime; readonly dailyStreamSeed: string }) => readonly SimEvent[] {
  return (ctx) => {
    const rng = makePrng(ctx.dailyStreamSeed);
    const result = dailyTickWithBase(
      world.hostile,
      world.candidates,
      ctx.time,
      rng,
      world.detectionBase,
    );
    if (commit !== undefined) {
      commit(result.next);
    }
    return result.events;
  };
}

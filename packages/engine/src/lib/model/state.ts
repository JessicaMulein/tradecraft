/**
 * The top-level Sim state and log types: {@link WorldState}, the {@link SimEvent}
 * union with its fixed per-kind visibility table, {@link TraceOrigin} and
 * {@link ActionLogEntry}, from the design's Data Models section.
 *
 * This module is a *skeleton*. Task 4.6 lays down the shapes so later tasks have
 * something to write against, but most of the sub-structures those shapes point
 * at (the city, orgs, the Plot, channels, the Hostile Service, and so on) are
 * owned by later tasks and are only sketched here. Every field the design names
 * is present; where a later task owns the detail, the referenced type is a
 * clearly-marked skeleton placeholder rather than a finished shape.
 *
 * Three requirements anchor the module:
 *
 * - Requirement 17.1: the save snapshot persists the World State and the event
 *   log, so {@link WorldState} and {@link SimEvent} must be concrete, parseable
 *   shapes. The skeleton establishes those shapes.
 * - Requirement 17.5: the Sim records an ordered action log of every player
 *   action, dialogue line, Case File operation, model-response reference and
 *   extraction commit — that is exactly the {@link ActionLogEntry} union.
 * - Requirement 39.1: every Sim event kind is marked player-visible or hidden.
 *   {@link SIM_EVENT_VISIBILITY} is that mapping as a single fixed table, and the
 *   {@link SimEvent} union carries the matching `visibility` tag.
 *
 * The visibility table is the one piece of real behaviour this skeleton owns, so
 * it is a `const` map plus helpers, and `state.spec.ts` tests it directly. The
 * rest will grow as tasks 4.7, 5.x, 7.x, 11.x, 16.x and 19.x fill in the shapes
 * referenced here.
 */

import type { DifficultyPreset as ContentDifficultyPreset } from '@tradecraft/content';
import { z } from 'zod';

import type { Action, Meeting as MeetingModel } from '../action/types.js';
import type { City as CityModel } from '../city/city.js';
import type {
  Channel as ChannelModel,
  DeadDrop as DeadDropModel,
} from '../city/comms.js';
import type { KnowledgeSlice as KnowledgeSliceModel } from '../city/knowledge.js';
import type { CoverIdentity as CoverIdentityModel } from '../city/starting-brief.js';
import type {
  Intercept as InterceptModel,
  Transmission as TransmissionModel,
} from '../cipher/intercept.js';
import type { Document as DocumentModel } from '../docs/document.js';
import type { Npc as NpcModel, Org as OrgModel } from '../city/npc.js';
import type { Relationship as RelationshipModel } from '../recruit/asset.js';
import type { SceneKind } from '../recruit/intent.js';
import type { HostileServiceState as HostileServiceStateModel } from '../hostile/service-state.js';
import type {
  PlotState as PlotStateModel,
  StageId as StageIdModel,
} from '../city/plot.js';
import type {
  SideThreadState as SideThreadStateModel,
  ThreadId as ThreadIdModel,
} from '../noise/side-threads.js';
import type { ScenarioConfig as ResolvedScenarioConfig } from '../config/scenario-config.js';
import type { SettingSelection } from '../setting/setting.js';
import { type PrngState } from '../prng/prng.js';
import type { Ledger as BudgetLedger } from '../station/ledger.js';
import type {
  Directive as DirectiveModel,
  DirectiveId,
} from '../station/directive-types.js';
import type { PendingCable as PendingCableModel } from '../station/cable-types.js';
import {
  truthSchema,
  type ChannelId,
  type DeadDropId,
  type InterceptId,
  type DocId,
  type EntityId,
  type GameTime,
  type ItemId,
  type LocId,
  type NpcId,
  type OrgId,
  type PropId,
  type Proposition,
  type Truth,
  type UnkId,
} from './core.js';

// ---------------------------------------------------------------------------
// Placeholder ids and skeleton sub-structures (owned by later tasks)
// ---------------------------------------------------------------------------
//
// The design names a large family of ids and record types that other tasks
// own. So this module type-checks and so later tasks have a stable name to
// import, they are declared here as the design writes them, but only to the
// depth task 4.6 needs. Each is marked with the task that will flesh it out.
// They are re-exported from the package index as skeleton names; the owning
// task replaces the declaration in place, so importers keep compiling.

// `ChannelId`, `DocId`, `OrgId`, `ItemId` and the other namespaced entity ids
// are owned by core.ts and imported above; the ids declared here are the ones
// core.ts does not (yet) own, each tagged with the task that will.

/**
 * Dead Drop id. The leaf type now lives in `./core.js` (so the city model can
 * name it without an import cycle) and is re-exported here under its original
 * name, so every importer — including the package index — is unaffected. The
 * full `DeadDrop` record is still fleshed out by task 5.4.
 */
export type { DeadDropId };
/**
 * Intercept id. The leaf type now lives in `./core.js` (so the cipher module and
 * `CipherSpec` can name it without an import cycle) and is re-exported here under
 * its original name, so every importer — including the package index and
 * `spec.ts` — is unaffected. The full `Intercept` record is owned by the Cipher
 * Engine (task 8.3) and re-exported below.
 */
export type { InterceptId };
/**
 * Plot Stage id. The real type now lives in `../city/plot.ts` (task 5.3)
 * alongside the Plot generator and the {@link PlotState}/`StageState` shapes; it
 * is re-exported here under the same name so {@link TraceOrigin} and every other
 * importer keep compiling.
 */
export type StageId = StageIdModel;
/**
 * Side Thread id. The real type now lives in `../noise/side-threads.ts` (task
 * 6.2) alongside the Side-Thread generator and the {@link SideThreadState}
 * shape; it is re-exported here under the same name so {@link TraceOrigin} and
 * every other importer keep compiling.
 */
export type ThreadId = ThreadIdModel;
/** Meeting id. Fleshed out by task 11.5. */
export type MeetingId = `meeting:${string}`;
/**
 * Directive id. The real type now lives in `../station/directive-types.ts` (the
 * leaf the Directive data model lives in, task 10.2) and is re-exported here
 * under the same name — so this module names it without importing the behaviour
 * module, exactly as `DeadDropId`/`InterceptId` moved to `core.ts`. It stays a
 * plain `string`.
 */
export type { DirectiveId };
/** Transmission id. Fleshed out by the Cipher Engine (task 8). */
export type TransmissionId = string;
/** Sim event id, assigned when an event is minted. */
export type EventId = string;
/** Turn id, assigned by the Turn Pipeline (task 16.8). */
export type TurnId = string;
/** Case File Claim id. Owned by `player-view` (task 4.4). */
export type ClaimId = string;
/** Notification id. Owned by `player-view` (task 16.6). */
export type NotificationId = string;
/** LLM Gateway role. Fleshed out by task 13.1. */
export type Role = string;
/**
 * Why a Plot aborted (design, "Plot abort (Req 38)"). Narrowed by task 7.4 from
 * the skeleton `string` to the design's closed union: abort pressure crossed the
 * doctrine tolerance (`pressure`), the leader's suspicion crossed the doctrine
 * threshold (`leader-suspicion`), the operation's materiel was seized
 * (`materiel-seized`), the stage's disruption draw came up `abort`
 * (`disruption-draw`), or a `reroute` had no alternative (`no-reroute`). The
 * abort machinery lives in `clock/plot-abort.ts`.
 */
export type AbortTrigger =
  | 'pressure'
  | 'leader-suspicion'
  | 'materiel-seized'
  | 'disruption-draw'
  | 'no-reroute';
/** The outcome tag of an {@link OutcomeRecord}. Fleshed out by task 20.3. */
export type Outcome = string;

/**
 * A reference to an item changing hands, as it appears on a drop or in a
 * transmission. Task 5.6 / 11.6 give this real structure; the skeleton keeps
 * only the item id.
 */
export interface ItemRef {
  readonly item: ItemId;
}

/**
 * The player action union (design, "Action Resolver"). The real discriminated
 * union now lives in `../action/types.ts` (task 11.1) alongside the pure
 * `quote`/`resolve`; it is re-exported here under the same name so
 * {@link ActionLogEntry} — and every other importer, including the package
 * index — keeps compiling, mirroring the City/Channel/Intercept/
 * SideThreadState re-export pattern above.
 */
export type { Action };

/**
 * A note the player attaches to a Claim. Owned by `player-view` (task 16.2);
 * the skeleton keeps only the free text.
 */
export interface NoteInput {
  readonly text: string;
}

/**
 * An Admiralty Grade: the two-part source-evaluation code real analysts use,
 * and the grade the player assigns to a Case File Claim (Glossary;
 * Requirement 8.1).
 *
 * - `reliability` grades the *source* from `A` (completely reliable) to `F`
 *   (reliability cannot be judged).
 * - `credibility` grades the *information* from `1` (confirmed) to `6`
 *   (truth cannot be judged).
 *
 * The grade is player judgement, never ground truth, so it lives on the view
 * side and crosses no truth boundary. The debrief later scores the player's
 * grading accuracy against the Truth Store (Requirement 8.3), but the grade
 * itself carries no truth value.
 */
export interface AdmiraltyGrade {
  readonly reliability: AdmiraltyReliability;
  readonly credibility: AdmiraltyCredibility;
}

/** The six source-reliability letters, `A` (best) through `F`. */
export const ADMIRALTY_RELIABILITY = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

/** A source-reliability letter. */
export type AdmiraltyReliability = (typeof ADMIRALTY_RELIABILITY)[number];

/** The six information-credibility digits, `1` (best) through `6`. */
export const ADMIRALTY_CREDIBILITY = [1, 2, 3, 4, 5, 6] as const;

/** An information-credibility digit. */
export type AdmiraltyCredibility = (typeof ADMIRALTY_CREDIBILITY)[number];

export const AdmiraltyGradeSchema: z.ZodType<AdmiraltyGrade> = z
  .strictObject({
    reliability: z.enum(ADMIRALTY_RELIABILITY),
    credibility: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
    ]),
  })
  .meta({
    id: 'AdmiraltyGrade',
    description:
      'A two-part source grade: reliability A–F and credibility 1–6.',
  });

/**
 * The canonical display form of a grade, the letter and digit joined (`"B2"`),
 * as it is written on an intelligence report.
 */
export function formatAdmiraltyGrade(grade: AdmiraltyGrade): string {
  return `${grade.reliability}${grade.credibility}`;
}

/**
 * The persisted end-of-game Outcome Record (task 20.3). The full shape now lives
 * in `../endings/outcome-record.ts` alongside the pure {@link
 * import('../endings/outcome-record.js').buildOutcomeRecord} that derives it and
 * the versioned Zod schema that validates it; it is re-exported here under the
 * same name so every importer — including {@link WorldState.ended}, which reads
 * only its `outcome` tag, and the package index — keeps compiling. This mirrors
 * the City/Org/Npc re-export pattern: the leaf owns the real interface, state.ts
 * names it.
 */
export type { OutcomeRecord } from '../endings/outcome-record.js';

/**
 * A placeholder for a {@link WorldState} sub-structure that a later task owns.
 *
 * The design names a dozen record types (the city, orgs, the Plot, channels,
 * the Hostile Service, …) that task 4.6 does not define — each has its own task.
 * Rather than leave their fields `unknown`, this skeleton gives each a named
 * type so {@link WorldState} reads as the design writes it, and so later tasks
 * have a stable name to replace. The phantom `Tag` keeps two skeletons from
 * being interchangeable, and the optional-only shape means code cannot yet rely
 * on any field — exactly the "fill in later" contract this task is after.
 *
 * When the owning task lands, it replaces the alias with a real interface; every
 * importer keeps compiling because the name does not change.
 */
export type Skeleton<Tag extends string> = {
  /** Phantom tag; never present at runtime. Replaced by the owning task. */
  readonly __skeleton?: Tag;
};

// The sub-structures of WorldState that later tasks own, each a tagged
// {@link Skeleton} until its task fills it in.

/**
 * City generation output: Districts, Locations, Routes and the start month the
 * daily weather draw reads (task 5.1). The real interface lives in
 * `../city/city.ts` alongside the pure `crowdLevel`, `travelCost` and
 * `weatherForDay`; it is re-exported here (and from the package index) under
 * the name `WorldState.city` uses, so every importer keeps compiling now that
 * the skeleton placeholder is filled in.
 */
export type City = CityModel;
/**
 * An organisation record (the Station, the Hostile Service, the Cell). The real
 * interface lives in `../city/npc.ts` alongside the Principal-NPC generator; it
 * is re-exported here (and from the package index) under the name
 * `WorldState.orgs` uses, so every importer keeps compiling now that the
 * skeleton placeholder is filled in (task 5.2).
 */
export type Org = OrgModel;
/**
 * A Principal/Background NPC (the design's `Npc`). The real interface lives in
 * `../city/npc.ts` alongside the generator that stamps it; re-exported here
 * (and from the package index) under the name `WorldState.npcs` uses, so every
 * importer keeps compiling now that the skeleton placeholder is filled in
 * (task 5.2).
 */
export type Npc = NpcModel;
/**
 * A relationship between the player and an NPC (design, "Recruitment and
 * Relationships": `Relationship`). The real interface lives in
 * `../recruit/asset.ts` alongside the recruitment code that reads and moves it
 * (task 18.1); re-exported here (and from the package index) under the name
 * `WorldState.relationships` uses, so every importer keeps compiling now that
 * the skeleton placeholder is filled in.
 */
export type Relationship = RelationshipModel;
/**
 * Plot state: the stage DAG, the role/materiel/target bindings and the running
 * status, plus the abort fields. The real interface lives in `../city/plot.ts`
 * alongside the generator that instantiates it (task 5.3); task 7.4 fills in the
 * abort behaviour against the `abortPressure`/`pressureKeys`/`abortCause` fields
 * already declared there. It is re-exported here (and from the package index)
 * under the name `WorldState.plot` uses, so every importer keeps compiling now
 * that the skeleton placeholder is filled in.
 */
export type PlotState = PlotStateModel;
/**
 * A Side Thread's running state (a self-contained minor storyline with no Cell
 * members; design, "Noise Generator", step 2; Requirement 29.2). The real
 * interface lives in `../noise/side-threads.ts` alongside the noise-stream
 * Side-Thread generator (task 6.2); it is re-exported here (and from the package
 * index) under the name `WorldState.sideThreads` uses, so every importer keeps
 * compiling now that the skeleton placeholder is filled in.
 */
export type SideThreadState = SideThreadStateModel;
/**
 * A communications Channel (a radio link, numbers broadcast, courier run or
 * dead-drop exchange, with a kind, an owner and a transmission schedule). The
 * real interface lives in `../city/comms.ts` alongside the step-5 comms
 * generator (task 5.4); it is re-exported here (and from the package index)
 * under the name `WorldState.channels` uses, so every importer keeps compiling
 * now that the skeleton placeholder is filled in.
 */
export type Channel = ChannelModel;
/**
 * A Dead Drop: a concealed site at a Location used to pass items without
 * meeting. The real interface lives in `../city/comms.ts` alongside the step-5
 * comms generator (task 5.4); it is re-exported here (and from the package
 * index) under the name `WorldState.deadDrops` uses, so every importer keeps
 * compiling now that the skeleton placeholder is filled in.
 */
export type DeadDrop = DeadDropModel;
/**
 * A sent transmission (the design's `Transmission`): a signal that went on the
 * wire — a Plot Stage trace, a Side Thread trace or a Noise Traffic firing —
 * paired with the ciphertext {@link Intercept} the Cipher Engine minted for it.
 * The real interface lives in `../cipher/intercept.ts` alongside
 * {@link import('../cipher/intercept.js').generateIntercepts} and the
 * world-assembly seeding (task 26.3); it is re-exported here (and from the
 * package index) under the name `WorldState.transmissions` uses, so every
 * importer keeps compiling now that the skeleton placeholder is filled in.
 */
export type Transmission = TransmissionModel;
/**
 * An Intercept (design's `Intercept`): the ciphertext the player captures off a
 * Channel, with its traffic metadata, the truth-bearing cipher spec/source
 * Propositions/origin, and any exploitable tradecraft error. The real interface
 * lives in `../cipher/intercept.ts` alongside the `generateIntercepts` producer
 * (task 8.3); it is re-exported here (and from the package index) under the name
 * `WorldState.intercepts` uses, so every importer keeps compiling now that the
 * skeleton placeholder is filled in.
 */
export type Intercept = InterceptModel;
/**
 * A Document (design, "Document Generator"; Requirements 30.1, 30.3). The real
 * interface lives in `../docs/document.ts` alongside the Dossier, Cable and
 * public-text composers (task 5.6); it is re-exported here (and from the package
 * index) under the name `WorldState.documents` uses, so every importer keeps
 * compiling now that the skeleton placeholder is filled in.
 */
export type Document = DocumentModel;
/**
 * An arranged meeting (the design's `Meeting`; task 11.5). The record *shape*
 * lives in the dependency-light `../action/types.ts` (beside the {@link Action}
 * union) so the arrange-meeting *behaviour* in `../action/arrange-meeting.ts`
 * — the pure `quoteArrangeMeeting`/`resolveArrangeMeeting`, the acceptance σ
 * primitive and the slot resolver `resolveMeetingAtSlot`, which must import
 * `WorldState` — keeps this module free of a cycle; it is re-exported here (and
 * from the package index) under the name `WorldState.meetings` uses, so every
 * importer keeps compiling now that the skeleton placeholder is filled in —
 * mirroring the Action re-export (same cycle-avoidance reason as `ItemRef`).
 */
export type Meeting = MeetingModel;
/**
 * A Knowledge Slice: what one NPC (or the Station) knows or believes — true
 * Propositions, false beliefs and known entities (Glossary). The real interface
 * lives in `../city/knowledge.ts` alongside the step-6/7 knowledge-assignment
 * generator (task 5.5); it is re-exported here (and from the package index)
 * under the name `WorldState.station.knowledge` uses, so every importer keeps
 * compiling now that the skeleton placeholder is filled in. Task 14.1 (the
 * Knowledge Slicer) reads this shape without widening it.
 */
export type KnowledgeSlice = KnowledgeSliceModel;
/**
 * A Station Directive: an objective the Chief issues with a deadline and a
 * Standing reward (design, "Station, Directives and Budget"; Requirement 27.2).
 * The real interface lives in `../station/directives.ts` alongside the
 * per-phase `checkDirectives` that settles it and moves Standing (task 10.2); it
 * is re-exported here (and from the package index) under the name
 * `WorldState.station.directives` uses, so every importer keeps compiling now
 * that the skeleton placeholder is filled in.
 */
export type Directive = DirectiveModel;
/**
 * The Budget ledger (task 10.1): a starting balance plus an append-only list of
 * signed entries. The real interface lives in `../station/ledger.ts` alongside
 * the pure `balance`, `debit` and `credit` operations; it is re-exported here
 * (and from the package index) under the name the design and `WorldState.station`
 * use, so every importer keeps compiling.
 */
export type Ledger = BudgetLedger;
/**
 * A Cable the player sent that is awaiting HQ's reply (design, "Action
 * Resolver": replies arrive after the preset delay; Requirements 27.4, 27.5).
 * The real interface lives in `../station/cables.ts` alongside `submitCable` and
 * the per-phase `processDueCables` that delivers it (task 10.2); it is
 * re-exported here (and from the package index) under the name
 * `WorldState.station.pendingCables` uses, so every importer keeps compiling now
 * that the skeleton placeholder is filled in.
 */
export type PendingCable = PendingCableModel;
/**
 * The Hostile Service's running state: the drawn doctrine and the belief model
 * with per-Asset Exposure tracking (design, "Hostile Service AI"; Requirements
 * 12.1, 12.2). The real interface lives in `../hostile/service-state.ts`
 * alongside the doctrine draw (task 19); it is re-exported here (and from
 * the package index) under the name `WorldState.hostile` uses, so every importer
 * keeps compiling now that the skeleton placeholder is filled in.
 */
export type HostileServiceState = HostileServiceStateModel;
/**
 * The player's Cover Identity: the title, employer org, plausible Location Types
 * (fit) and Cover Suspicion modifiers the player operates under (design, step 8;
 * Requirement 26.1). The real interface lives in `../city/starting-brief.ts`
 * alongside the Starting Brief generator (task 5.7); it is re-exported here (and
 * from the package index) under the name `WorldState.player.cover` uses, so
 * every importer keeps compiling now that the skeleton placeholder is filled in.
 */
export type CoverIdentity = CoverIdentityModel;
/**
 * The resolved difficulty preset (task 2.7). The scenario loader resolves the
 * named preset against the Content Set, deep-merges the scenario's overrides,
 * and re-validates against the content package's `DifficultyPresetSchema`; this
 * is that resolved value, re-exported here so `WorldState.meta` reads as the
 * design writes it.
 */
export type DifficultyPreset = ContentDifficultyPreset;
/** The resolved scenario config (task 2.7). */
export type ScenarioConfig = ResolvedScenarioConfig;
/** The content manifest (pack hashes). Owned by task 2.4. */
export type ContentManifest = Skeleton<'ContentManifest'>;

// ---------------------------------------------------------------------------
// TraceOrigin
// ---------------------------------------------------------------------------

/**
 * Why a trace exists in the world: the Plot, a Side Thread, noise, a deliberate
 * deception, or ordinary routine. It is wrapped in {@link Truth} because knowing
 * the real origin of a sighting or an intercept is ground truth the player must
 * work to infer, never read directly (Requirement 2.1). Matches the design's
 * `TraceOrigin` union.
 */
export type TraceOrigin = Truth<
  | { readonly kind: 'plot'; readonly stage: StageId }
  | { readonly kind: 'side-thread'; readonly thread: ThreadId }
  | { readonly kind: 'noise'; readonly schedule: string }
  | { readonly kind: 'deception' }
  | { readonly kind: 'routine' }
>;

/** The unbranded body of a {@link TraceOrigin}, for building and parsing. */
export type TraceOriginBody =
  | { readonly kind: 'plot'; readonly stage: StageId }
  | { readonly kind: 'side-thread'; readonly thread: ThreadId }
  | { readonly kind: 'noise'; readonly schedule: string }
  | { readonly kind: 'deception' }
  | { readonly kind: 'routine' };

const TraceOriginBodySchema: z.ZodType<TraceOriginBody> = z
  .discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('plot'), stage: z.string() }),
    z.strictObject({
      kind: z.literal('side-thread'),
      // `ThreadId` is the branded `thread:${string}` owned by task 6.2; the
      // brand is a parse-time fiction, so validate the wire value as a string
      // and retype it, exactly as the Truth brand is handled elsewhere.
      thread: z.string() as unknown as z.ZodType<ThreadId>,
    }),
    z.strictObject({ kind: z.literal('noise'), schedule: z.string() }),
    z.strictObject({ kind: z.literal('deception') }),
    z.strictObject({ kind: z.literal('routine') }),
  ])
  .meta({ id: 'TraceOrigin' });

/**
 * Parser for a {@link TraceOrigin}. The brand is a compile-time fiction (see
 * {@link truthSchema}), so this parses the body and retypes the result as a
 * branded value; a save loader can use it without an unchecked cast.
 */
export const TraceOriginSchema: z.ZodType<TraceOrigin> =
  truthSchema(TraceOriginBodySchema);

// ---------------------------------------------------------------------------
// SimEvent
// ---------------------------------------------------------------------------

/**
 * The per-kind visibility of a {@link SimEvent} (Requirement 39.1): `'player'`
 * for events addressed to the player or the Station, `'hidden'` for everything
 * that happens off-screen.
 */
export type EventVisibility = 'player' | 'hidden';

/**
 * Every {@link SimEvent} kind, so the visibility table and the parser can be
 * checked for exhaustiveness. Order follows the design's union: hidden kinds
 * first, then player-visible kinds.
 */
export const SIM_EVENT_KINDS = [
  // hidden
  'npc-moved',
  'meeting',
  'transmission',
  'drop-loaded',
  'drop-emptied',
  'stage-executed',
  'stage-disrupted',
  'plot-adapted',
  'plot-completed',
  'plot-aborted',
  'asset-detected',
  'asset-arrested',
  'asset-doubled',
  'feed-delivered',
  'belief-adopted',
  'belief-plant',
  'tail-started',
  'tail-ended',
  'player-burned',
  'mole-report',
  'walk-in-approach',
  // player-visible
  'day-start',
  'newspaper',
  'cable',
  'directive',
  'walk-in',
  'meeting-reply',
  'meeting-due',
  'meeting-no-show',
  'meeting-missed-by-player',
  'drop-unserviced',
  'asset-silent',
  'retainer-due',
  'custody-released',
] as const;

/** The discriminant of a {@link SimEvent}. */
export type SimEventKind = (typeof SIM_EVENT_KINDS)[number];

/**
 * The fixed mapping from event kind to visibility (Requirement 39.1). This is
 * the single source of truth the Notifications layer (task 16.6) reads: `notify`
 * acts on `'player'` events and ignores `'hidden'` ones. Every kind in
 * {@link SIM_EVENT_KINDS} has an entry, and the design's rule — player-visible
 * kinds never carry {@link Truth} fields — is honoured by the union below.
 */
export const SIM_EVENT_VISIBILITY: Readonly<Record<SimEventKind, EventVisibility>> = {
  // hidden: off-screen simulation the player must infer, never read
  'npc-moved': 'hidden',
  meeting: 'hidden',
  transmission: 'hidden',
  'drop-loaded': 'hidden',
  'drop-emptied': 'hidden',
  'stage-executed': 'hidden',
  'stage-disrupted': 'hidden',
  'plot-adapted': 'hidden',
  'plot-completed': 'hidden',
  'plot-aborted': 'hidden',
  'asset-detected': 'hidden',
  'asset-arrested': 'hidden',
  'asset-doubled': 'hidden',
  'feed-delivered': 'hidden',
  'belief-adopted': 'hidden',
  'belief-plant': 'hidden',
  'tail-started': 'hidden',
  'tail-ended': 'hidden',
  'player-burned': 'hidden',
  'mole-report': 'hidden',
  'walk-in-approach': 'hidden',
  // player-visible: addressed to the player or the Station
  'day-start': 'player',
  newspaper: 'player',
  cable: 'player',
  directive: 'player',
  'walk-in': 'player',
  'meeting-reply': 'player',
  'meeting-due': 'player',
  'meeting-no-show': 'player',
  'meeting-missed-by-player': 'player',
  'drop-unserviced': 'player',
  'asset-silent': 'player',
  'retainer-due': 'player',
  'custody-released': 'player',
};

/** The fixed visibility of an event kind (Requirement 39.1). */
export function visibilityOf(kind: SimEventKind): EventVisibility {
  return SIM_EVENT_VISIBILITY[kind];
}

/** True when events of this kind are player-visible (never carry Truth). */
export function isPlayerVisibleKind(kind: SimEventKind): boolean {
  return SIM_EVENT_VISIBILITY[kind] === 'player';
}

/** Fields every {@link SimEvent} carries, regardless of kind. */
export interface SimEventBase {
  readonly id: EventId;
  readonly at: GameTime;
  readonly visibility: EventVisibility;
}

/**
 * A simulation event (Requirement 39.1). The union matches the design's
 * `SimEvent`: each variant carries its own payload, and `visibility` is the
 * fixed tag from {@link SIM_EVENT_VISIBILITY} for that kind. Hidden variants may
 * carry {@link Truth}-wrapped fields (such as a {@link TraceOrigin}); the
 * player-visible variants deliberately carry none, so a Notification built from
 * one can never leak ground truth (Requirements 39.4, 39.7).
 *
 * This is a skeleton: the payloads are the design's, but later tasks (7.x, 8.x,
 * 11.x, 19.x) are what actually mint these events, and they may add fields as
 * their mechanics firm up.
 */
export type SimEvent = SimEventBase &
  (
    // --- hidden ---------------------------------------------------------
    | { readonly kind: 'npc-moved'; readonly npc: NpcId; readonly from: LocId; readonly to: LocId }
    | {
        readonly kind: 'meeting';
        readonly participants: readonly NpcId[];
        readonly loc: LocId;
        readonly origin: TraceOrigin;
      }
    | {
        readonly kind: 'transmission';
        readonly channel: ChannelId;
        readonly intercept: InterceptId;
        readonly origin: TraceOrigin;
      }
    | {
        readonly kind: 'drop-loaded' | 'drop-emptied';
        readonly drop: DeadDropId;
        readonly by: NpcId;
        readonly items: readonly ItemRef[];
        readonly origin: TraceOrigin;
      }
    | { readonly kind: 'stage-executed' | 'stage-disrupted'; readonly stage: StageId; readonly cause?: string }
    | { readonly kind: 'plot-adapted'; readonly change: string }
    | { readonly kind: 'plot-completed' }
    | { readonly kind: 'plot-aborted'; readonly trigger: AbortTrigger }
    | { readonly kind: 'asset-detected' | 'asset-arrested' | 'asset-doubled'; readonly npc: NpcId }
    | { readonly kind: 'feed-delivered'; readonly agent: NpcId; readonly props: readonly Proposition[] }
    | { readonly kind: 'belief-adopted'; readonly prop: Proposition }
    | {
        /**
         * A Proposition an Asset's `plant` task placed for the Hostile Service
         * to find (slice-integration Req 10.6). The `task` action schedules it
         * at the next Day Boundary, and that day's Hostile tick takes it into
         * `newlyAdopted`. `by` is the planting Asset and `loc` the Location the
         * plant names, when it names one.
         */
        readonly kind: 'belief-plant';
        readonly prop: Proposition;
        readonly by: NpcId;
        readonly loc?: LocId;
      }
    | { readonly kind: 'tail-started' | 'tail-ended' }
    | { readonly kind: 'player-burned' }
    | { readonly kind: 'mole-report'; readonly summary: string }
    | { readonly kind: 'walk-in-approach'; readonly npc: NpcId; readonly genuine: Truth<boolean> }
    // --- player-visible (no Truth fields) --------------------------------
    | { readonly kind: 'day-start'; readonly weather: Weather }
    | { readonly kind: 'newspaper'; readonly doc: DocId }
    | { readonly kind: 'cable'; readonly doc: DocId }
    | {
        readonly kind: 'directive';
        readonly directive: DirectiveId;
        readonly status: 'issued' | 'met' | 'failed';
      }
    | { readonly kind: 'walk-in'; readonly npc: NpcId }
    | { readonly kind: 'meeting-reply'; readonly meeting: MeetingId; readonly accepted: boolean }
    | {
        readonly kind: 'meeting-due' | 'meeting-no-show' | 'meeting-missed-by-player';
        readonly meeting: MeetingId;
      }
    | { readonly kind: 'drop-unserviced'; readonly drop: DeadDropId }
    | { readonly kind: 'asset-silent'; readonly npc: NpcId; readonly days: number }
    | { readonly kind: 'retainer-due'; readonly npc: NpcId; readonly amount: number }
    | { readonly kind: 'custody-released'; readonly npc: NpcId }
  );

/**
 * Daily weather, as carried by a `day-start` event. Owned by task 5.1; the
 * skeleton keeps only a summary string so the event has a payload.
 */
export interface Weather {
  readonly summary: string;
}

// ---------------------------------------------------------------------------
// ActionLogEntry
// ---------------------------------------------------------------------------

/**
 * A single Case File / view operation recorded on a `view-op` log entry: a
 * grade change, a link or unlink, a note, or a dismissal. Matches the design's
 * `view-op.op` union. Owned in behaviour by `player-view` (tasks 4.4, 16.x); the
 * shape lives here because the action log that records it does.
 */
export type ViewOp =
  | { readonly grade: readonly [ClaimId, AdmiraltyGrade] }
  | { readonly link: readonly [ClaimId, ClaimId] }
  | { readonly unlink: readonly [ClaimId, ClaimId] }
  | { readonly note: NoteInput }
  | { readonly dismiss: NotificationId };

/** Fields every {@link ActionLogEntry} carries. */
export interface ActionLogEntryBase {
  readonly seq: number;
  readonly turn: TurnId;
  readonly at: GameTime;
}

/**
 * One entry in the ordered action log (Requirement 17.5): a player action, a
 * dialogue line, a Case File operation, a model-response reference, or an
 * extraction commit. Replay (Requirement 17.4) regenerates the world from the
 * seed and applies these in `seq` order, serving each `model` entry from the
 * recording by `requestHash` and applying each `extraction-commit` at its
 * logged position. Matches the design's `ActionLogEntry` union.
 *
 * This is a skeleton: {@link Action}, {@link ViewOp} and the model-call fields
 * are the design's, but the tasks that write these entries (16.8 for the Turn
 * Pipeline, 13.x for the Gateway) own the detail.
 */
export type ActionLogEntry = ActionLogEntryBase &
  (
    | { readonly kind: 'action'; readonly action: Action }
    | { readonly kind: 'line'; readonly text: string }
    | { readonly kind: 'view-op'; readonly op: ViewOp }
    | {
        readonly kind: 'model';
        readonly role: Role;
        readonly purpose: 'intent' | 'voice' | 'narrator' | 'extract' | 'refusal-check';
        readonly requestHash: string;
        readonly outcome: 'ok' | 'timeout' | 'fallback' | 'rejected';
      }
    | { readonly kind: 'extraction-commit'; readonly forTurn: TurnId }
  );

// ---------------------------------------------------------------------------
// TalkScene
// ---------------------------------------------------------------------------

/**
 * The most turns a {@link TalkScene} keeps in `recent` (design, "Data Models":
 * `recent` holds at most `RECENT_TURNS`). The dialogue turn drops the oldest
 * entry once the window is full, so the prompt's recent-turns window stays
 * bounded however long the conversation runs.
 */
export const RECENT_TURNS = 6;

/** One line of a {@link TalkScene}'s recent conversation: who spoke, what. */
export interface TalkSceneTurn {
  readonly speaker: 'player' | 'npc';
  readonly text: string;
}

/**
 * What opened a {@link TalkScene}: the player's `talk` or `approach` action, a
 * kept meeting, or a Walk-in.
 */
export type TalkSceneVia = 'talk' | 'approach' | 'meeting' | 'walk-in';

/**
 * The open Talk Scene, held as `player.scene` (slice-integration Req 15.2). It
 * records the NPC the player is talking to, the scene's stakes (`kind`), when
 * and how the scene opened, and the recent turns of the conversation. It
 * replaces the slice's `SceneState` skeleton.
 *
 * The Turn Pipeline sets it at commit when an action or a kept meeting opens a
 * scene (slice-integration Req 15.1) and clears it on `endScene` (Req 15.3).
 * With no conversation in progress, `player.scene` is absent. The stakes also
 * choose the Model Role of the NPC's replies: the three high-stakes kinds go
 * to `voice`, `routine` to `fast` (slice-integration Req 15.9).
 */
export interface TalkScene {
  /** The NPC the player is talking to. */
  readonly npc: NpcId;
  /** The scene's stakes. */
  readonly kind: SceneKind;
  /** When the scene opened. */
  readonly openedAt: GameTime;
  /** What opened the scene. */
  readonly via: TalkSceneVia;
  /** The recent turns, oldest first, at most {@link RECENT_TURNS} of them. */
  readonly recent: readonly TalkSceneTurn[];
}

// ---------------------------------------------------------------------------
// FeedLogEntry
// ---------------------------------------------------------------------------

/**
 * One entry of the Hostile Service's feed log (`hostile.feedLog`): how the
 * service classified each Proposition of a feed it ingested in a daily tick.
 * The Hostile Full Tick reports the classifications as `feedClasses`, and its
 * application appends one entry per fed agent.
 *
 * The classification is ground truth (`chickenfeed` when the fed Proposition
 * holds, `deception` when it does not), kept for the debrief only. The Player
 * View never reads it (Requirement 37.6).
 */
export interface FeedLogEntry {
  /** When the Hostile tick that ingested the feed ran. */
  readonly at: GameTime;
  /** The turned agent whose handler received the feed. */
  readonly agent: NpcId;
  /** Each fed Proposition's classification, in delivered order. */
  readonly classes: readonly ('chickenfeed' | 'deception')[];
}

// ---------------------------------------------------------------------------
// WorldState
// ---------------------------------------------------------------------------

/**
 * The complete ground-truth state of one game (the design's `WorldState`). It is
 * the thing world generation produces and every pure `resolve` threads through,
 * and — with the Truth Store and the view-side state — the thing a save
 * snapshot persists (Requirement 17.1).
 *
 * This is a skeleton. The top-level shape and field names are the design's, so
 * later tasks have a stable target, but almost every field points at a type
 * those tasks own (see the placeholders above). Expect the inner shapes to firm
 * up as tasks 5.x through 19.x land; the field set here should stay stable.
 */
export interface WorldState {
  readonly meta: {
    readonly seed: string;
    readonly generatorVersion: string;
    readonly content: ContentManifest;
    readonly preset: DifficultyPreset;
    readonly scenario: ScenarioConfig;
    /**
     * The setting selection the setting step produced (content-expansion task
     * 3.8): the city the game is placed in (`'core'` or a City id), the Start
     * Date mapped to game day 0, the Game Year and the setting attempt index.
     * Stored so a save restores the setting exactly (Property 13); a save made
     * before this field existed has no `meta.setting` and is refused by the
     * `generatorVersion` check.
     */
    readonly setting: SettingSelection;
  };
  readonly time: GameTime;
  readonly rng: PrngState;

  readonly city: City;
  readonly orgs: Record<OrgId, Org>;
  readonly npcs: Record<NpcId, Npc>;
  /**
   * Where each NPC is now: a Location, or `'absent'` when the NPC is at no
   * Location (its schedule names none for the current phase, or it has been
   * arrested or has fled). Generation sets every NPC's entry from its schedule
   * at the start time. As the clock advances, the schedule step writes the
   * positions it moves NPCs to (slice-integration Req 1.2).
   */
  readonly whereabouts: Record<NpcId, LocId | 'absent'>;
  readonly relationships: Record<NpcId, Relationship>;
  /**
   * Each NPC's Told List: the Propositions the NPC has told the player, in the
   * order they were said. The extraction commit appends a speaker's Claims to
   * its list (slice-integration Req 17.2), the voice prompt reads it, and the
   * Claim Extractor checks new Claims against it for consistency. Empty at
   * generation. An NPC with no entry has told the player nothing.
   */
  readonly told: Record<NpcId, readonly Proposition[]>;

  readonly plot: PlotState;
  readonly sideThreads: readonly SideThreadState[];

  readonly channels: Record<ChannelId, Channel>;
  readonly deadDrops: Record<DeadDropId, DeadDrop>;
  readonly transmissions: readonly Transmission[];
  readonly intercepts: Record<InterceptId, Intercept>;
  readonly documents: Record<DocId, Document>;
  /**
   * The full {@link Proposition}s behind every Document's `asserts`, keyed by
   * PropId (task 9.2). `WorldState.documents` stores only the bare
   * {@link Document} (its `asserts` is a `PropId[]`); the Propositions a
   * composer threaded onto a Document (`ComposedDocument.propositions`) are kept
   * here so the `read` action can turn each asserted PropId into a Case File
   * Claim without a second lookup. Documents whose `asserts` is empty (public
   * texts) contribute nothing; later-minted Documents (newspapers, seized
   * material) register their Propositions here when they enter the world.
   */
  readonly documentPropositions: Record<PropId, Proposition>;
  /** Day number -> that day's newspaper Document. */
  readonly newspapers: Record<number, DocId>;
  readonly meetings: Record<MeetingId, Meeting>;

  readonly station: {
    readonly org: OrgId;
    readonly chief: NpcId;
    readonly staff: readonly NpcId[];
    readonly mole?: Truth<NpcId>;
    readonly knowledge: KnowledgeSlice;
    readonly directives: readonly Directive[];
    readonly standing: number;
    readonly ledger: Ledger;
    readonly pendingCables: readonly PendingCable[];
    readonly lastFundsGrant?: GameTime;
    /**
     * The Propositions a mole could report to the Hostile Service: the
     * Station Knowledge Slice plus the Propositions the player's Case File
     * summary and sent Cables name. The player view writes this projection
     * at each commit, and the Hostile tick builds the mole report from it when
     * a mole is at liberty (slice-integration Req 3.6). Empty at generation.
     */
    readonly reportable: readonly Proposition[];
  };

  /**
   * The Hostile Service's running state, plus the debrief-only
   * {@link FeedLogEntry} log the daily tick appends to when it ingests a feed.
   */
  readonly hostile: HostileServiceState & {
    readonly feedLog: readonly FeedLogEntry[];
    /**
     * The Chickenfeed each Asset the Hostile Service has doubled feeds back,
     * keyed by the Asset's NPC id: the true Propositions the doubling decision
     * selected. The Hostile Full Tick's application writes it with the
     * `hostileControlled` flip (slice-integration Req 3.7). Ground truth, read
     * by the Sim only, never by the Player View. Absent until the first
     * doubling.
     */
    readonly chickenfeed?: Readonly<Record<NpcId, readonly Proposition[]>>;
    readonly beliefs: HostileServiceState['beliefs'] & {
      /**
       * The NPCs who have reported one of the player's recruitment pitches to
       * the Hostile Service, in report order without repeats. The dialogue
       * turn adds the NPC when a pitch fails badly and is reported
       * (slice-integration Req 15.8). Absent until the first report.
       *
       * The field is declared here rather than on `HostileBeliefs` and is
       * optional, so the Hostile tick's own belief type is unchanged. The tick
       * copies its belief records with object spread, so the field survives a
       * tick that is given the Draft's beliefs.
       */
      readonly suspectedApproaches?: readonly NpcId[];
    };
  };

  readonly player: {
    readonly loc: LocId;
    readonly cover: CoverIdentity;
    readonly coverSuspicion: Truth<number>;
    readonly tailed: Truth<boolean>;
    readonly known: {
      readonly entities: readonly EntityId[];
      readonly channels: readonly ChannelId[];
      readonly drops: readonly DeadDropId[];
    };
    /**
     * The player's Unidentified-Subject allocation table (task 11.2;
     * Requirement 21.7): the stable `unk:N` id assigned to each NPC the player
     * has observed but not identified, keyed by the NPC's real id. The Action
     * Resolver's identification machinery (`../action/identify.ts`) allocates a
     * fresh sequential `unk:` id on first observation of an unidentified NPC and
     * reuses it for every later observation, so the same person always carries
     * the same `unk:N`; the ground-truth `identityOf(unk) = npc` mapping it
     * mirrors lives in the Truth Store. An NPC with no entry has not yet been
     * observed unidentified.
     */
    readonly unkIds: Record<NpcId, UnkId>;
    readonly contacts: readonly NpcId[];
    readonly arrestAuthority: number;
    /**
     * The entities the Station has arrested on the player's request, in the
     * order the arrests were granted. A granted `arrest` appends to it, and the
     * Objective Evaluator decides `arrest` objectives from it
     * (slice-integration Req 6.3). Empty at generation.
     */
    readonly arrests: readonly EntityId[];
    /** The open Talk Scene, or absent when the player is talking to no one. */
    readonly scene?: TalkScene;
    readonly burned: boolean;
    /**
     * The Documents the player has already read (task 9.2; Requirement 30.4).
     * The `read` action adds a Document's asserted Propositions as Case File
     * Claims only on the *first* read; a Document whose id is here has been read
     * before, so reading it again adds no new Claims (Property 22, idempotence).
     */
    readonly readDocuments: readonly DocId[];
  };

  /** Future events, ordered by time (the design's `scheduled`). */
  readonly scheduled: readonly SimEvent[];

  readonly ended?: {
    readonly outcome: Outcome;
    readonly at: GameTime;
    readonly cause: AbortTrigger | 'leader-arrested' | 'plot-completed' | 'burned';
  };
}

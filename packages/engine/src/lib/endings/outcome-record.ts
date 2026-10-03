/**
 * The Outcome Record shape and its versioned Zod schema (design, "Outcome
 * Record (`engine/outcome`)"; Requirements 35.1, 35.2, 35.3). Task 20.3.
 *
 * The Outcome Record is the *persisted* reckoning of a finished game, kept
 * separately from saves for a future campaign layer to consume (Req 35.1). This
 * module owns the record's **shape** and its **schema** — the data contract —
 * and nothing else: it is a dependency-light leaf that imports only `../model/
 * core.js`, the content manifest schema and the recruitment/doctrine leaves, so
 * `../model/state.ts` can re-export {@link OutcomeRecord} from here (the name
 * `WorldState.ended.outcome` reads) without forming an import cycle. The same
 * split the design uses for `docs/document.ts` (the leaf interface) versus
 * `docs/newspaper.ts` (the behaviour that imports the state module).
 *
 * The pure derivation {@link import('./build-outcome-record.js').buildOutcomeRecord}
 * — which must import {@link import('../model/state.js').WorldState} and the
 * {@link import('../truth/truth.js').TruthStore} — lives in
 * `./build-outcome-record.ts`, which state.ts does *not* re-export. The
 * filesystem write (`./outcome-store.ts`) is a third module, so the derivation
 * stays testable in isolation (task 20.5, Property 26) and the shape stays free
 * of a cycle.
 *
 * Where the end-of-game {@link import('@tradecraft/player-view').DebriefView}
 * (task 20.2) is the *in-memory* reveal the player reads, the Outcome Record is
 * the slice of that reckoning worth carrying *forward*: the identifying metadata
 * that reproduces or audits the game (seed, generator version, Content Manifest,
 * Difficulty Preset) plus the state a campaign cares about — Standing, Directive
 * results, surviving Assets, Cover status, what the Hostile Service learned (the
 * Hostile Memory) and the remaining Budget (Req 35.2).
 */

import {
  ContentManifestSchema,
  type ContentManifest as ContentManifestData,
} from '@tradecraft/content';
import { z } from 'zod';

import {
  GameTimeSchema,
  NpcIdSchema,
  ChannelIdSchema,
  type ChannelId,
  type DeadDropId,
  type GameTime,
  type NpcId,
} from '../model/core.js';
import { MICE_LEVERS, type MiceLever } from '../recruit/asset.js';
import type { Doctrine } from '../hostile/doctrine.js';

// ---------------------------------------------------------------------------
// The schema version
// ---------------------------------------------------------------------------

/**
 * The Outcome Record schema version (design's `schema: 1`). Bumped whenever the
 * record's shape changes incompatibly, so a future campaign layer reading an old
 * file can tell which shape it holds. The Zod schema pins this exact literal, so
 * a record from a different version fails validation on read (Req 35.3).
 */
export const OUTCOME_RECORD_SCHEMA_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Outcome tag
// ---------------------------------------------------------------------------

/**
 * The persisted outcome tag (design: `'success' | 'failure-plot' |
 * 'failure-burned'`). Narrower than the engine's internal {@link
 * import('../model/state.js').Outcome} (a bare `success`/`failure`), because a
 * campaign layer wants to know *how* a game was lost: the Plot ran its course
 * (`failure-plot`) or the player's cover was blown (`failure-burned`). The two
 * are told apart by `WorldState.ended.cause` (see {@link
 * import('./build-outcome-record.js').outcomeTagOf}).
 */
export type OutcomeTag = 'success' | 'failure-plot' | 'failure-burned';

/** The three persisted outcome tags, as a value for validation and iteration. */
export const OUTCOME_TAGS: readonly OutcomeTag[] = [
  'success',
  'failure-plot',
  'failure-burned',
];

// ---------------------------------------------------------------------------
// The record shape (design: `interface OutcomeRecord`)
// ---------------------------------------------------------------------------

/**
 * One Directive's recorded result (design: `directives: { id; status }[]`). The
 * campaign layer reads which objectives the Station met.
 */
export interface OutcomeDirective {
  readonly id: string;
  readonly status: 'open' | 'met' | 'failed';
}

/**
 * The view-safe persona snapshot carried for a surviving Asset. A flattened,
 * JSON-primitive projection of the NPC's {@link import('../city/npc.js').Persona}
 * — only the fields a campaign layer plausibly needs — so the record never
 * carries functions, branded values or the full live persona object.
 */
export interface OutcomePersona {
  readonly name: string;
  readonly culture: string;
  readonly background: string;
}

/**
 * A surviving Asset's persisted snapshot (design: `survivingAssets[]`;
 * Req 35.2). Every field is already-revealed ground truth or player-side data,
 * flattened to a plain value:
 *
 * - `npc` — the Asset's NPC id;
 * - `archetype` — the archetype the NPC was stamped from;
 * - `persona` — the view-safe persona (name, culture, background) the player knew;
 * - `lever` — the MICE lever the Asset was recruited on (its dominant hidden
 *   lever, revealed now the game is over);
 * - `trust` / `exposure` — the player-side relationship figures;
 * - `doubled` — whether the Hostile Service had quietly doubled this Asset
 *   (`asset.hostileControlled`, ground truth revealed in the record).
 */
export interface SurvivingAsset {
  readonly npc: NpcId;
  readonly archetype: string;
  readonly persona: OutcomePersona;
  readonly lever: MiceLever;
  readonly trust: number;
  readonly exposure: number;
  readonly doubled: boolean;
}

/**
 * The player's Cover status at game end (design: `cover: { identity; blown;
 * suspicion }`; Req 35.2). `identity` is the Cover Identity's content id,
 * `blown` is whether the player was burned, and `suspicion` is the final Cover
 * Suspicion (revealed ground truth).
 */
export interface OutcomeCover {
  readonly identity: string;
  readonly blown: boolean;
  readonly suspicion: number;
}

/**
 * The Hostile Memory: what the Hostile Service learned about the player's
 * network (design: `hostileMemory`; Glossary, "Hostile Memory"; Req 35.2). The
 * part of the record a future campaign carries forward as the opposition's
 * standing knowledge:
 *
 * - `knownCover` — whether the service blew (and so knows) the player's cover;
 * - `suspectedAssets` — the player's Assets the service detected;
 * - `compromisedChannels` — the player Channels it learned were compromised;
 * - `compromisedDrops` — the Dead Drops it learned were compromised;
 * - `doctrineShift` — the parts of the service's {@link Doctrine} that drifted
 *   from its initial draw (empty when the doctrine never moved).
 */
export interface HostileMemory {
  readonly knownCover: boolean;
  readonly suspectedAssets: readonly NpcId[];
  readonly compromisedChannels: readonly ChannelId[];
  readonly compromisedDrops: readonly DeadDropId[];
  readonly doctrineShift: Partial<Doctrine>;
}

/**
 * The Outcome Record (design: `interface OutcomeRecord`; Req 35.2). The durable,
 * versioned end-of-game record. Every field is a plain, serialisable value: the
 * record round-trips through `JSON.parse(JSON.stringify(record))` and through
 * {@link OutcomeRecordSchema} unchanged.
 *
 * This is the full shape that replaces the task-4.6 placeholder in
 * `../model/state.ts`; `WorldState.ended.outcome` reads only its `outcome` tag,
 * via the state module's re-export.
 */
export interface OutcomeRecord {
  /** The schema version this record was written under (Req 35.3). */
  readonly schema: typeof OUTCOME_RECORD_SCHEMA_VERSION;
  /** An optional campaign id a future layer may stamp (design: `campaignId?`). */
  readonly campaignId?: string;

  /** The persisted outcome tag. */
  readonly outcome: OutcomeTag;
  /** When the game ended. */
  readonly endedAt: GameTime;

  /** The display seed the world was generated from. */
  readonly seed: string;
  /** The generator version (part of the determinism key). */
  readonly generatorVersion: string;
  /** The Content Manifest (pack ids/versions/hashes). */
  readonly content: ContentManifestData;
  /** The Difficulty Preset id the game ran under. */
  readonly difficulty: string;

  /** The final Station Standing. */
  readonly standing: number;
  /** Each Directive's result. */
  readonly directives: readonly OutcomeDirective[];
  /** The Assets still active at game end. */
  readonly survivingAssets: readonly SurvivingAsset[];
  /** The player's Cover status. */
  readonly cover: OutcomeCover;
  /** What the Hostile Service learned about the player's network. */
  readonly hostileMemory: HostileMemory;
  /** The Budget remaining at game end. */
  readonly budgetRemaining: number;
}

// ---------------------------------------------------------------------------
// The Zod schema (versioned; validated before writing, Req 35.3)
// ---------------------------------------------------------------------------

const OutcomePersonaSchema: z.ZodType<OutcomePersona> = z
  .strictObject({
    name: z.string(),
    culture: z.string(),
    background: z.string(),
  })
  .meta({ id: 'OutcomePersona' });

const SurvivingAssetSchema: z.ZodType<SurvivingAsset> = z
  .strictObject({
    npc: NpcIdSchema,
    archetype: z.string(),
    persona: OutcomePersonaSchema,
    lever: z.enum(['money', 'ideology', 'coercion', 'ego']),
    trust: z.number(),
    exposure: z.number(),
    doubled: z.boolean(),
  })
  .meta({ id: 'SurvivingAsset' }) as unknown as z.ZodType<SurvivingAsset>;

const OutcomeDirectiveSchema: z.ZodType<OutcomeDirective> = z
  .strictObject({
    id: z.string(),
    status: z.enum(['open', 'met', 'failed']),
  })
  .meta({ id: 'OutcomeDirective' });

const OutcomeCoverSchema: z.ZodType<OutcomeCover> = z
  .strictObject({
    identity: z.string(),
    blown: z.boolean(),
    suspicion: z.number(),
  })
  .meta({ id: 'OutcomeCover' });

/**
 * The {@link Doctrine} drift schema: every doctrine dimension optional, since a
 * doctrine that never moved records an empty shift. Each is a `[0, 1]` number.
 */
const DoctrineShiftSchema: z.ZodType<Partial<Doctrine>> = z
  .strictObject({
    riskTolerance: z.number().optional(),
    securityConsciousness: z.number().optional(),
    deceptionAppetite: z.number().optional(),
  })
  .meta({ id: 'DoctrineShift' });

const HostileMemorySchema: z.ZodType<HostileMemory> = z
  .strictObject({
    knownCover: z.boolean(),
    suspectedAssets: z.array(NpcIdSchema),
    compromisedChannels: z.array(ChannelIdSchema),
    // A Dead Drop id is `drop:${string}`; validate the branded string shape.
    compromisedDrops: z.array(
      z.string().startsWith('drop:') as unknown as z.ZodType<DeadDropId>,
    ),
    doctrineShift: DoctrineShiftSchema,
  })
  .meta({ id: 'HostileMemory' }) as unknown as z.ZodType<HostileMemory>;

/**
 * The versioned Outcome Record schema (Req 35.3). The Sim validates a record
 * against this before writing it, and a reader validates on load. The `schema`
 * field is pinned to {@link OUTCOME_RECORD_SCHEMA_VERSION} so a record of a
 * different version is rejected, and the object is `strict` so an unexpected
 * field is a validation error, not silently dropped.
 *
 * The parse/serialise round-trip is exact: `OutcomeRecordSchema.parse(
 * JSON.parse(JSON.stringify(record)))` returns a value deep-equal to `record`.
 */
export const OutcomeRecordSchema: z.ZodType<OutcomeRecord> = z
  .strictObject({
    schema: z.literal(OUTCOME_RECORD_SCHEMA_VERSION),
    campaignId: z.string().optional(),
    outcome: z.enum(['success', 'failure-plot', 'failure-burned']),
    endedAt: GameTimeSchema,
    seed: z.string(),
    generatorVersion: z.string(),
    content: ContentManifestSchema,
    difficulty: z.string(),
    standing: z.number(),
    directives: z.array(OutcomeDirectiveSchema),
    survivingAssets: z.array(SurvivingAssetSchema),
    cover: OutcomeCoverSchema,
    hostileMemory: HostileMemorySchema,
    budgetRemaining: z.number(),
  })
  .meta({ id: 'OutcomeRecord' }) as unknown as z.ZodType<OutcomeRecord>;

/**
 * Parse and validate an unknown value as an {@link OutcomeRecord} (Req 35.3).
 * Throws a {@link z.ZodError} when the value is malformed or of the wrong schema
 * version. The reader on the campaign side uses this; the writer uses it to
 * validate before serialising.
 */
export function parseOutcomeRecord(value: unknown): OutcomeRecord {
  return OutcomeRecordSchema.parse(value);
}

// ---------------------------------------------------------------------------
// Shared derivation helper (pure; no WorldState)
// ---------------------------------------------------------------------------

/**
 * The dominant MICE lever of a profile: the lever with the greatest strength,
 * ties broken by {@link MICE_LEVERS} order (money › ideology › coercion › ego).
 * This is the lever an Asset was most plausibly recruited on, revealed in the
 * record now the game is over. Pure; owned here (the shape leaf) so both the
 * derivation and the tests share one definition.
 */
export function dominantLever(mice: {
  readonly money: number;
  readonly ideology: number;
  readonly coercion: number;
  readonly ego: number;
}): MiceLever {
  let best: MiceLever = MICE_LEVERS[0];
  let bestValue = mice[best];
  for (const lever of MICE_LEVERS) {
    if (mice[lever] > bestValue) {
      best = lever;
      bestValue = mice[lever];
    }
  }
  return best;
}

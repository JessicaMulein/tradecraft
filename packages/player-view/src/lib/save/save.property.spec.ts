/**
 * Property 13: Save/load round-trip (task 21.2).
 *
 * **Validates: Requirements 17.1, 17.2**
 *
 * The design states (Correctness Property 13): "For any reachable state,
 * `load(save(s))` deep-equals `s`, including PRNG state." A save is the single
 * versioned {@link SaveSnapshot} this package composes — the engine's
 * {@link WorldState} (seed, generator version, Content Manifest, Difficulty
 * Preset, scenario and the serialisable PRNG state) plus the Player-View session
 * stores (Journal, Notifications, Flavour cache, action log, extraction queue).
 * The property drives {@link saveSnapshot} / {@link loadSnapshot} through
 * `JSON.parse(JSON.stringify(...))` (saves are versioned JSON, Req 17.1) and
 * asserts a loaded session is byte-for-byte equal to the one it was taken from
 * (Req 17.2).
 *
 * This spec sweeps generated worlds (varied seeds and Difficulty Presets) and
 * randomly-populated stores (varied Journal entries and notes, Notifications
 * with varied dismissed flags, Flavour cache entries, action-log entries and
 * extraction-queue jobs) with fast-check, then for each case asserts:
 *
 *  1. **Schema.** `saveSnapshot(...)` validates against {@link SaveSnapshotSchema}.
 *  2. **JSON round-trip.** `JSON.parse(JSON.stringify(snapshot))` deep-equals the
 *     snapshot and re-validates against the schema (Req 17.1 — a versioned JSON
 *     snapshot).
 *  3. **Load round-trip.** `loadSnapshot(json, savedManifest)` succeeds and the
 *     restored world, ledger and every store's snapshot deep-equal the originals
 *     — Journal entries + notes, the Notification list, the Flavour cache record,
 *     the action log and the extraction queue (Req 17.2).
 *  4. **Determinism / idempotence.** save -> load -> save yields an equal
 *     snapshot.
 *
 * The generated-world construction mirrors the sibling example spec
 * (`save.spec.ts`): the real core pack, `generate(seed, inputs)` and the same
 * `loadedManifest` helper. The run count is bounded for CI (world generation per
 * case is the cost), matching the engine's property-spec `numRuns` conventions.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  loadCityData,
  loadContent,
  loadDescriptorData,
  loadPublicTexts,
  type CityData,
  type ContentManifest,
  type ContentSet,
  type DescriptorData,
  type DifficultyPreset,
  type PublicText,
} from '@tradecraft/content';
import {
  generate,
  ScenarioConfigSchema,
  type GameTime,
  type GenerateInputs,
  type NpcId,
  type TurnId,
  type WorldState,
} from '@tradecraft/engine';

import type { NpcId as EngineNpcId, TruthStoreData, UnkId } from '@tradecraft/engine';

import { Journal } from '../journal/journal.js';
import { NotificationStore } from '../notify/store.js';
import type { Notification } from '../notify/notification.js';
import { ActionLog, ExtractionQueue } from '../api/turn-pipeline.js';
import { CaseFile } from '../casefile/casefile.js';
import {
  SaveSnapshotSchema,
  loadSnapshot,
  saveSnapshot,
  type FlavourCacheSnapshotData,
  type PipelineSnapshot,
  type SaveSources,
  type ViewStateSnapshot,
} from './save.js';

// ---------------------------------------------------------------------------
// Bounded run count for CI (each case generates a world, so keep it modest).
// ---------------------------------------------------------------------------

const RUNS = 40;

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors the sibling save.spec.ts)
// ---------------------------------------------------------------------------

const CORE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'content',
  'packs',
  'core',
);

function loadCore(): {
  content: ContentSet;
  cityData: CityData;
  descriptors: DescriptorData;
  publicTexts: readonly PublicText[];
} {
  const content = loadContent([CORE_DIR], ['core']);
  if (!content.ok) {
    throw new Error('core pack failed to load');
  }
  const cityData = loadCityData(CORE_DIR);
  const descriptors = loadDescriptorData(CORE_DIR);
  const publicTexts = loadPublicTexts(CORE_DIR);
  if (!cityData.ok || !descriptors.ok || !publicTexts.ok) {
    throw new Error('core pack side files failed to load');
  }
  return {
    content: content.value,
    cityData: cityData.value,
    descriptors: descriptors.value,
    publicTexts: publicTexts.value,
  };
}

const { content, cityData, descriptors, publicTexts } = loadCore();

function preset(id: string): DifficultyPreset {
  for (const [key, value] of content.difficultyPresets) {
    if (key === id || key.endsWith(`/${id}`)) {
      return value;
    }
  }
  throw new Error(`no difficulty preset ${id}`);
}

/** The shipped presets to sweep over (varied Difficulty Preset, Req 34.3). */
const PRESET_IDS = ['easy', 'standard', 'hard'] as const;

function inputs(p: DifficultyPreset, ambient = false): GenerateInputs {
  const scenario = ScenarioConfigSchema.parse({
    difficulty: { preset: p.id },
    mole: true,
    ...(ambient ? { ambient: { enabled: true, density: 'sparse' as const } } : {}),
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
  return { content, preset: p, scenario, cityData, descriptors, publicTexts };
}

/** The real Content Manifest the generated world carries on `meta.content`. */
function loadedManifest(w: WorldState): ContentManifest {
  return w.meta.content as unknown as ContentManifest;
}

// ---------------------------------------------------------------------------
// Arbitraries: a varied world and randomly-populated stores
// ---------------------------------------------------------------------------

/** A short, deterministic seed string. */
const seedArb = fc.string({ minLength: 1, maxLength: 12 });

/** A Difficulty Preset id to generate under. */
const presetArb = fc.constantFrom(...PRESET_IDS);

/** A game time: a small day and a phase in the engine's phase range (0..3). */
const timeArb: fc.Arbitrary<GameTime> = fc.record({
  day: fc.integer({ min: 1, max: 20 }),
  phase: fc.constantFrom(0, 1, 2, 3) as fc.Arbitrary<GameTime['phase']>,
});

/** One Journal entry's inputs: a time, a line or two, and some view-safe refs. */
const journalEntryArb = fc.record({
  at: timeArb,
  factLines: fc.array(fc.string({ minLength: 1, maxLength: 24 }), {
    minLength: 1,
    maxLength: 3,
  }),
  refs: fc.array(
    fc.oneof(
      fc.constantFrom('npc:a', 'loc:kiosk', 'doc:cable-1', 'claim:1'),
      fc.string({ minLength: 1, maxLength: 10 }),
    ),
    { minLength: 0, maxLength: 3 },
  ),
});

/** One player note's inputs: a time, an attachment (day/entity/claim) and text. */
const journalNoteArb = fc.record({
  at: timeArb,
  attachTo: fc.oneof(
    fc.integer({ min: 1, max: 20 }),
    fc.constantFrom('npc:a', 'loc:kiosk', 'claim:1'),
  ),
  text: fc.string({ maxLength: 40 }),
});

/** A randomly-populated Journal (varied entries and notes). */
function journalFrom(
  entries: readonly { at: GameTime; factLines: string[]; refs: string[] }[],
  notes: readonly { at: GameTime; attachTo: number | string; text: string }[],
): Journal {
  const journal = new Journal();
  for (const e of entries) {
    journal.append(e.at, e.factLines, e.refs);
  }
  for (const n of notes) {
    journal.addNote({ at: n.at, attachTo: n.attachTo, text: n.text });
  }
  return journal;
}

/**
 * One generated Notification plus whether the player dismissed it. A couple of
 * kinds exercise distinct per-kind payloads; the `dismissed` flag varies so the
 * round-trip must preserve a mix of dismissed and undismissed Notifications.
 */
const notificationArb = fc
  .record({
    n: fc.integer({ min: 0, max: 1_000_000 }),
    at: timeArb,
    factLine: fc.string({ maxLength: 32 }),
    dismiss: fc.boolean(),
    kind: fc.constantFrom('cable', 'newspaper'),
  })
  .map(({ n, at, factLine, dismiss, kind }) => {
    const base = {
      id: `notif:${n}` as Notification['id'],
      at,
      factLine,
      dismissed: false,
      kind,
      doc: `doc:${n}` as never,
    } as Notification;
    return { notification: base, dismiss };
  });

/** A randomly-populated Notification store (varied list and dismissed flags). */
function notificationsFrom(
  items: readonly { notification: Notification; dismiss: boolean }[],
): NotificationStore {
  const store = new NotificationStore();
  for (const { notification, dismiss } of items) {
    const stored = store.push(notification);
    if (dismiss) {
      store.dismiss(stored.id);
    }
  }
  return store;
}

/** A Flavour cache record: varied `(loc|phase|crowd)` keys to sentence lists. */
const flavourCacheArb: fc.Arbitrary<FlavourCacheSnapshotData> = fc
  .array(
    fc.tuple(
      fc.string({ minLength: 1, maxLength: 16 }),
      fc.array(fc.string({ minLength: 1, maxLength: 24 }), { minLength: 1, maxLength: 3 }),
    ),
    { minLength: 0, maxLength: 4 },
  )
  .map((pairs) => Object.fromEntries(pairs));

/** One action-log entry: a logged line (the simplest view-safe variant). */
const actionLineArb = fc.record({
  turn: fc.integer({ min: 0, max: 50 }).map((i) => `turn:${i}` as TurnId),
  at: timeArb,
  text: fc.string({ maxLength: 32 }),
});

/** A randomly-populated action log (varied logged lines). */
function actionLogFrom(
  lines: readonly { turn: TurnId; at: GameTime; text: string }[],
): ActionLog {
  const log = new ActionLog();
  for (const line of lines) {
    log.append({ kind: 'line', turn: line.turn, at: line.at, text: line.text });
  }
  return log;
}

/** One queued extraction job. */
const extractionJobArb = fc.record({
  turnId: fc.integer({ min: 0, max: 50 }).map((i) => `turn:${i}` as TurnId),
  speaker: fc.constantFrom('npc:a', 'npc:b', 'npc:scene').map((s) => s as NpcId),
  utterance: fc.string({ maxLength: 32 }),
  at: timeArb,
});

/** A randomly-populated extraction queue (varied pending jobs, in order). */
function extractionQueueFrom(
  jobs: readonly { turnId: TurnId; speaker: NpcId; utterance: string; at: GameTime }[],
): ExtractionQueue {
  const queue = new ExtractionQueue();
  for (const job of jobs) {
    // The widened `QueuedExtraction` (slice-integration task 8.3) carries the
    // speaker's knowledge, Told List and cover state captured at the turn; the
    // save round-trip is indifferent to their contents, so fill the empty
    // defaults here.
    queue.enqueue({
      ...job,
      speakerKnowledgeAtTurn: { known: [], falseBeliefs: [], promote: [] },
      toldList: [],
      coverIntact: true,
    });
  }
  return queue;
}

/** One Case File Claim's inputs: a source, a Proposition and a time. */
const npcArb = fc.constantFrom('npc:a', 'npc:b', 'npc:c').map((s) => s as EngineNpcId);

const claimArb = fc.record({
  subject: npcArb,
  predicate: fc.constantFrom('core/WORKS_FOR', 'core/MET_WITH'),
  object: fc.constantFrom('org:cell', 'org:hostile', 'npc:b', 'npc:c'),
  at: timeArb,
});

/** A randomly-populated Case File (varied Claims, minted ids in order). */
function caseFileFrom(
  claims: readonly { subject: EngineNpcId; predicate: string; object: string; at: GameTime }[],
): CaseFile {
  const caseFile = new CaseFile();
  claims.forEach((c, i) => {
    caseFile.add({
      source: { kind: 'npc', npc: c.subject },
      prop: {
        id: `p${i}` as never,
        subject: c.subject,
        predicate: c.predicate,
        object: c.object as never,
      },
      observedAt: c.at,
    });
  });
  return caseFile;
}

/** Truth Store contents: facts plus allegiance/identity Maps and Claim-truths. */
const truthArb: fc.Arbitrary<TruthStoreData> = fc
  .record({
    allegiances: fc.array(
      fc.tuple(npcArb, fc.constantFrom('org:cell', 'org:hostile')),
      { minLength: 0, maxLength: 3 },
    ),
    identities: fc.array(
      fc.tuple(
        fc.constantFrom('unk:1', 'unk:2', 'unk:3').map((u) => u as UnkId),
        npcArb,
      ),
      { minLength: 0, maxLength: 3 },
    ),
  })
  .map(({ allegiances, identities }) => ({
    facts: [],
    allegiances: new Map(allegiances.map(([k, v]) => [k, { org: v as never }])),
    identities: new Map(identities),
    claimTruths: [],
  }));

/** The Player-View bookkeeping: seen hints and observed cover states. */
const viewStateArb: fc.Arbitrary<ViewStateSnapshot> = fc
  .record({
    hintsSeen: fc.array(
      fc.constantFrom('first-document', 'budget-low', 'first-intercept'),
      { minLength: 0, maxLength: 3 },
    ),
    observed: fc.array(
      fc.tuple(npcArb, fc.constantFrom('intact', 'strained', 'cracking', 'blown')),
      { minLength: 0, maxLength: 3 },
    ),
  })
  .map(({ hintsSeen, observed }) => ({
    hintsSeen: [...new Set(hintsSeen)] as ViewStateSnapshot['hintsSeen'],
    observedCoverState: Object.fromEntries(
      observed,
    ) as ViewStateSnapshot['observedCoverState'],
  }));

/** The Turn Pipeline counters. */
const pipelineArb: fc.Arbitrary<PipelineSnapshot> = fc.record({
  turnCounter: fc.nat({ max: 500 }),
  outcomeWritten: fc.boolean(),
});

// ---------------------------------------------------------------------------
// One case: a generated world + randomly-populated stores -> SaveSources.
// ---------------------------------------------------------------------------

interface Case {
  readonly world: WorldState;
  readonly sources: SaveSources;
}

const caseArb: fc.Arbitrary<Case> = fc
  .record({
    seed: seedArb,
    presetId: presetArb,
    entries: fc.array(journalEntryArb, { minLength: 0, maxLength: 4 }),
    notes: fc.array(journalNoteArb, { minLength: 0, maxLength: 4 }),
    notifications: fc.array(notificationArb, { minLength: 0, maxLength: 4 }),
    flavourCache: flavourCacheArb,
    actionLines: fc.array(actionLineArb, { minLength: 0, maxLength: 4 }),
    jobs: fc.array(extractionJobArb, { minLength: 0, maxLength: 3 }),
    claims: fc.array(claimArb, { minLength: 0, maxLength: 4 }),
    truth: truthArb,
    viewState: viewStateArb,
    pipeline: pipelineArb,
    ambient: fc.boolean(),
    // `noInvalidDate`: fast-check 4 can draw an Invalid Date, whose
    // `toISOString()` throws, which made this property fail intermittently.
    savedAt: fc.date({ noInvalidDate: true }).map((d) => d.toISOString()),
  })
  .map((c) => {
    const world = generate(c.seed, inputs(preset(c.presetId), c.ambient));
    const sources: SaveSources = {
      world,
      journal: journalFrom(c.entries, c.notes),
      notifications: notificationsFrom(c.notifications),
      flavourCache: c.flavourCache,
      actionLog: actionLogFrom(c.actionLines),
      extractionQueue: extractionQueueFrom(c.jobs),
      caseFile: caseFileFrom(c.claims),
      truth: c.truth,
      viewState: c.viewState,
      pipeline: c.pipeline,
      savedAt: c.savedAt,
    };
    return { world, sources };
  });

// ---------------------------------------------------------------------------
// Property 13 (Req 17.1, 17.2)
// ---------------------------------------------------------------------------

describe('Property 13: Save/load round-trip', () => {
  it('builds a snapshot that validates against the schema', () => {
    fc.assert(
      fc.property(caseArb, ({ sources }) => {
        const snapshot = saveSnapshot(sources);
        expect(SaveSnapshotSchema.safeParse(snapshot).success).toBe(true);
      }),
      { numRuns: RUNS },
    );
  });

  it('round-trips through JSON unchanged and re-validates (Req 17.1)', () => {
    fc.assert(
      fc.property(caseArb, ({ sources }) => {
        const snapshot = saveSnapshot(sources);
        const roundTripped = JSON.parse(JSON.stringify(snapshot));
        expect(roundTripped).toEqual(snapshot);
        expect(SaveSnapshotSchema.safeParse(roundTripped).success).toBe(true);
      }),
      { numRuns: RUNS },
    );
  });

  it('load restores a session byte-for-byte equal to the original (Req 17.2)', () => {
    fc.assert(
      fc.property(caseArb, ({ world, sources }) => {
        const json = JSON.parse(JSON.stringify(saveSnapshot(sources)));
        const result = loadSnapshot(json, loadedManifest(world));
        expect(result.ok).toBe(true);
        if (!result.ok) {
          return;
        }
        const { session } = result;

        // World and ledger restore verbatim (including the PRNG state on rng).
        expect(session.world).toEqual(world);
        expect(session.world.rng).toEqual(world.rng);
        expect(session.world.station.ledger).toEqual(world.station.ledger);

        // Every store's snapshot deep-equals the original's.
        expect(session.journal.entries()).toEqual(sources.journal.entries());
        expect(session.journal.notes()).toEqual(sources.journal.notes());
        expect(session.journal.snapshot()).toEqual(sources.journal.snapshot());
        expect(session.notifications.list()).toEqual(sources.notifications.list());
        expect(session.flavourCache).toEqual(sources.flavourCache);
        expect(session.actionLog.all()).toEqual(sources.actionLog.all());
        expect(session.extractionQueue.pending()).toEqual(sources.extractionQueue.pending());

        // Version-2 parts round-trip too (Case File, Truth Store, view state,
        // pipeline counters).
        expect(session.caseFile.snapshot()).toEqual(sources.caseFile.snapshot());
        expect(session.truth.facts).toEqual(sources.truth.facts);
        expect(session.truth.allegiances).toEqual(sources.truth.allegiances);
        expect(session.truth.identities).toEqual(sources.truth.identities);
        expect(session.truth.claimTruths).toEqual(sources.truth.claimTruths);
        expect(session.viewState).toEqual(sources.viewState);
        expect(session.pipeline).toEqual(sources.pipeline);
      }),
      { numRuns: RUNS },
    );
  });

  it('is idempotent: save -> load -> save yields an equal snapshot', () => {
    fc.assert(
      fc.property(caseArb, ({ world, sources }) => {
        const manifest = loadedManifest(world);
        const first = JSON.parse(JSON.stringify(saveSnapshot(sources)));
        const result = loadSnapshot(first, manifest);
        expect(result.ok).toBe(true);
        if (!result.ok) {
          return;
        }
        // Re-save the loaded session with the same header time; the second
        // snapshot equals the first (savedAt is the one wall-clock value, so it
        // is pinned here rather than letting it default to `now`).
        const second = JSON.parse(
          JSON.stringify(
            saveSnapshot({
              world: result.session.world,
              journal: result.session.journal,
              notifications: result.session.notifications,
              flavourCache: result.session.flavourCache,
              actionLog: result.session.actionLog,
              extractionQueue: result.session.extractionQueue,
              caseFile: result.session.caseFile,
              truth: result.session.truth,
              viewState: result.session.viewState,
              pipeline: result.session.pipeline,
              savedAt: first.savedAt,
            }),
          ),
        );
        expect(second).toEqual(first);
      }),
      { numRuns: RUNS },
    );
  });
});

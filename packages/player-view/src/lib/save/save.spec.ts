/**
 * Behaviour tests for the versioned {@link SaveSnapshot} and the pure save/load
 * pair (task 21.1; Requirements 17.1, 17.2, 31.6, 34.3).
 *
 * These drive a real, generated {@link WorldState} (the core pack, a real
 * Content Manifest and Difficulty Preset on its `meta`, the serialisable PRNG
 * state on its `rng`) together with populated Player-View stores — a Journal
 * with entries and notes, a Notification store with a dismissed Notification, a
 * Flavour cache, an action log and an extraction queue — through
 * {@link saveSnapshot} and {@link loadSnapshot}. The point is to prove:
 *
 *   - a built snapshot validates against {@link SaveSnapshotSchema} and
 *     round-trips through `JSON.parse(JSON.stringify(...))` unchanged;
 *   - a load rebuilds equal stores (Journal, Notifications, Flavour cache,
 *     action log, extraction queue, ledger and WorldState) — Requirement 17.2;
 *   - a save whose Content Manifest differs from the loaded packs is refused
 *     with a `manifest-mismatch` {@link LoadError} naming the differing packs
 *     (Requirement 31.6);
 *   - a save of an unsupported format version is refused with a `version` error
 *     (Requirement 17.1);
 *   - the Difficulty Preset and seed survive the round-trip (Requirement 34.3).
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

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
  type GenerateInputs,
  type GameTime,
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
  SAVE_VERSION,
  SaveSnapshotSchema,
  diffManifests,
  loadSnapshot,
  parseAndLoad,
  saveSnapshot,
  toTruthSnapshot,
  type FlavourCacheSnapshotData,
  type PipelineSnapshot,
  type SaveSources,
  type ViewStateSnapshot,
} from './save.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors the sibling view specs)
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
  if (!cityData.ok) {
    throw new Error('city.yaml failed to load');
  }
  const descriptors = loadDescriptorData(CORE_DIR);
  if (!descriptors.ok) {
    throw new Error('descriptors.yaml failed to load');
  }
  const publicTexts = loadPublicTexts(CORE_DIR);
  if (!publicTexts.ok) {
    throw new Error('public texts failed to load');
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

const STANDARD = preset('standard');

function scenario() {
  return ScenarioConfigSchema.parse({
    difficulty: { preset: 'standard' },
    mole: true,
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
}

function inputs(): GenerateInputs {
  return { content, preset: STANDARD, scenario: scenario(), cityData, descriptors, publicTexts };
}

function world(seed = 'alpha'): WorldState {
  return generate(seed, inputs());
}

/** The real Content Manifest the generated world carries on `meta.content`. */
function loadedManifest(w: WorldState): ContentManifest {
  return w.meta.content as unknown as ContentManifest;
}

// ---------------------------------------------------------------------------
// Populated Player-View stores
// ---------------------------------------------------------------------------

const AT: GameTime = { day: 2, phase: 1 };

/** A Journal with a couple of entries and a note, so the round-trip has content. */
function populatedJournal(): Journal {
  const journal = new Journal();
  journal.append(AT, ['A courier left the kiosk.'], ['npc:courier', 'loc:kiosk']);
  journal.append({ day: 2, phase: 2 }, ['The Cable arrived.'], ['doc:cable-1']);
  journal.addNote({ at: AT, attachTo: 'npc:courier', text: 'watch this one' });
  journal.addNote({ at: AT, attachTo: 3, text: 'day note' });
  return journal;
}

/** A Notification store with one undismissed and one dismissed Notification. */
function populatedNotifications(): NotificationStore {
  const store = new NotificationStore();
  const a: Notification = {
    id: 'notif:1' as Notification['id'],
    at: AT,
    factLine: 'A Cable arrived.',
    dismissed: false,
    kind: 'cable',
    doc: 'doc:cable-1' as never,
  };
  const b: Notification = {
    id: 'notif:2' as Notification['id'],
    at: { day: 2, phase: 2 },
    factLine: 'The newspaper is out.',
    dismissed: false,
    kind: 'newspaper',
    doc: 'doc:news-2' as never,
  };
  store.push(a);
  store.push(b);
  store.dismiss(b.id);
  return store;
}

/** A Flavour cache snapshot (the plain record the dialogue cache serialises). */
function flavourCache(): FlavourCacheSnapshotData {
  return {
    'loc:kiosk|1|quiet': ['The kiosk smells of newsprint and cheap tobacco.'],
    'loc:cafe|0|busy': ['Steam clouds the café windows against the morning cold.'],
  };
}

/** An action log with a logged action and a dialogue line. */
function populatedActionLog(): ActionLog {
  const log = new ActionLog();
  log.append({ kind: 'line', turn: 'turn:0' as TurnId, at: AT, text: 'hello' });
  return log;
}

/** An extraction queue with one pending job. */
function populatedExtractionQueue(): ExtractionQueue {
  const queue = new ExtractionQueue();
  queue.enqueue({
    turnId: 'turn:0' as TurnId,
    speaker: 'npc:scene' as NpcId,
    utterance: 'the usual place, Thursday',
    at: AT,
    speakerKnowledgeAtTurn: { known: [], falseBeliefs: [], promote: [] },
    toldList: [],
    coverIntact: true,
  });
  return queue;
}

/** A Case File with a couple of Claims and a player grade, so v2 has content. */
function populatedCaseFile(): CaseFile {
  const caseFile = new CaseFile();
  const a = caseFile.add({
    source: { kind: 'document', id: 'doc:cable-1' as never },
    prop: {
      id: 'p1' as never,
      subject: 'npc:a' as EngineNpcId,
      predicate: 'core/WORKS_FOR',
      object: 'org:cell' as never,
    },
    observedAt: AT,
  });
  caseFile.add({
    source: { kind: 'surveillance', loc: 'loc:kiosk' as never },
    prop: {
      id: 'p2' as never,
      subject: 'npc:a' as EngineNpcId,
      predicate: 'core/MET_WITH',
      object: 'npc:b' as never,
      place: 'loc:kiosk' as never,
    },
    observedAt: { day: 2, phase: 2 },
  });
  caseFile.grade(a.id, { reliability: 'B', credibility: 2 } as never);
  return caseFile;
}

/** Truth Store contents (with Maps) so the sorted-entry-array round-trip bites. */
function truthData(): TruthStoreData {
  return {
    facts: [
      {
        id: 'tp1' as never,
        subject: 'npc:a' as EngineNpcId,
        predicate: 'core/WORKS_FOR',
        object: 'org:cell' as never,
      },
    ],
    allegiances: new Map([
      ['npc:b' as EngineNpcId, { org: 'org:cell' as never }],
      ['npc:a' as EngineNpcId, { org: 'org:hostile' as never }],
    ]),
    identities: new Map([
      ['unk:2' as UnkId, 'npc:b' as EngineNpcId],
      ['unk:1' as UnkId, 'npc:a' as EngineNpcId],
    ]),
    claimTruths: [
      {
        claim: {
          id: 'claim:1' as never,
          subject: 'npc:a' as EngineNpcId,
          predicate: 'core/WORKS_FOR',
          object: 'org:cell' as never,
        },
        speaker: 'npc:a' as EngineNpcId,
        at: AT,
        held: true,
        believed: true,
        lie: false,
      },
    ],
  };
}

/** The Player-View bookkeeping: a couple of seen hints and observed covers. */
function viewState(): ViewStateSnapshot {
  return {
    hintsSeen: ['first-document', 'budget-low'],
    observedCoverState: {
      ['npc:a' as EngineNpcId]: 'strained',
      ['npc:b' as EngineNpcId]: 'intact',
    },
  };
}

/** The Turn Pipeline counters. */
function pipeline(): PipelineSnapshot {
  return { turnCounter: 7, outcomeWritten: false };
}

function sources(w: WorldState = world()): SaveSources {
  return {
    world: w,
    journal: populatedJournal(),
    notifications: populatedNotifications(),
    flavourCache: flavourCache(),
    actionLog: populatedActionLog(),
    extractionQueue: populatedExtractionQueue(),
    caseFile: populatedCaseFile(),
    truth: truthData(),
    viewState: viewState(),
    pipeline: pipeline(),
    savedAt: '2024-05-01T12:00:00.000Z',
  };
}

// ---------------------------------------------------------------------------
// Schema and JSON round-trip
// ---------------------------------------------------------------------------

describe('SaveSnapshot — schema and JSON round-trip', () => {
  it('builds a snapshot that validates against the schema', () => {
    const snapshot = saveSnapshot(sources());
    expect(snapshot.version).toBe(SAVE_VERSION);
    const parsed = SaveSnapshotSchema.safeParse(snapshot);
    expect(parsed.success).toBe(true);
  });

  it('round-trips through JSON unchanged', () => {
    const snapshot = saveSnapshot(sources());
    const roundTripped = JSON.parse(JSON.stringify(snapshot));
    expect(roundTripped).toEqual(snapshot);
    // And the re-parsed value still validates.
    expect(SaveSnapshotSchema.safeParse(roundTripped).success).toBe(true);
  });

  it('lifts the determinism key off world.meta (seed, preset, manifest)', () => {
    const w = world('bravo');
    const snapshot = saveSnapshot(sources(w));
    expect(snapshot.seed).toBe(w.meta.seed);
    expect(snapshot.generatorVersion).toBe(w.meta.generatorVersion);
    expect(snapshot.difficulty).toEqual(w.meta.preset); // Req 34.3
    expect(snapshot.content).toEqual(w.meta.content); // Req 31.6 key
    expect(snapshot.ledger).toEqual(w.station.ledger);
  });

  it('writes version 4 and keeps the v2 parts (Req 13.8)', () => {
    const snapshot = saveSnapshot(sources());
    expect(snapshot.version).toBe(4);
    expect(SAVE_VERSION).toBe(4);
    expect(snapshot.world.ambient).toBeUndefined();
    // The Case File, Truth Store, view state and pipeline counters are present.
    expect(snapshot.caseFile.claims).toHaveLength(2);
    expect(snapshot.caseFile.nextId).toBe(3);
    expect(snapshot.truth.facts).toHaveLength(1);
    expect(snapshot.viewState.hintsSeen).toContain('first-document');
    expect(snapshot.pipeline).toEqual({ turnCounter: 7, outcomeWritten: false });
  });

  it('stores the Truth Store Maps as sorted entry arrays', () => {
    const snapshot = saveSnapshot(sources());
    // allegiances and identities are arrays (JSON-safe), sorted by key.
    expect(Array.isArray(snapshot.truth.allegiances)).toBe(true);
    expect(snapshot.truth.allegiances.map(([k]) => k)).toEqual(['npc:a', 'npc:b']);
    expect(snapshot.truth.identities.map(([k]) => k)).toEqual(['unk:1', 'unk:2']);
    // Equal to flattening the live store data the same way.
    expect(snapshot.truth).toEqual(toTruthSnapshot(truthData()));
  });

  it('keeps savedAt in the header only, never in World State', () => {
    const snapshot = saveSnapshot(sources());
    expect(snapshot.savedAt).toBe('2024-05-01T12:00:00.000Z');
    expect(JSON.stringify(snapshot.world)).not.toContain('savedAt');
  });

  it('defaults savedAt to now when the caller does not supply one', () => {
    const { savedAt: _omit, ...rest } = sources();
    void _omit;
    const before = Date.now();
    const snapshot = saveSnapshot(rest);
    const stamped = Date.parse(snapshot.savedAt);
    expect(Number.isNaN(stamped)).toBe(false);
    expect(stamped).toBeGreaterThanOrEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Load round-trip: equal stores and world (Requirement 17.2)
// ---------------------------------------------------------------------------

describe('loadSnapshot — restores an identical session (Req 17.2)', () => {
  it('rebuilds equal Journal, Notifications, Flavour cache, action log, extraction queue, ledger and world', () => {
    const w = world();
    const src = sources(w);
    const snapshot = JSON.parse(JSON.stringify(saveSnapshot(src)));

    const result = loadSnapshot(snapshot, loadedManifest(w));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const { session } = result;

    // World and ledger restore verbatim.
    expect(session.world).toEqual(w);
    expect(session.world.station.ledger).toEqual(w.station.ledger);

    // Journal: same entries and notes (and the counters continue the order).
    expect(session.journal.entries()).toEqual(src.journal.entries());
    expect(session.journal.notes()).toEqual(src.journal.notes());
    expect(session.journal.snapshot()).toEqual(src.journal.snapshot());

    // Notifications: same list, dismissed flags preserved.
    expect(session.notifications.list()).toEqual(src.notifications.list());
    expect(session.notifications.undismissed()).toHaveLength(1);

    // Flavour cache: same record.
    expect(session.flavourCache).toEqual(src.flavourCache);

    // Action log and extraction queue restore in order.
    expect(session.actionLog.all()).toEqual(src.actionLog.all());
    expect(session.extractionQueue.pending()).toEqual(src.extractionQueue.pending());

    // Case File: same Claims and the id counter continues the saved sequence.
    expect(session.caseFile.snapshot()).toEqual(src.caseFile.snapshot());
    expect(session.caseFile.list()).toEqual(src.caseFile.list());

    // Truth Store: Maps restored with the same contents (iteration order is
    // canonicalised to sorted-by-key through the save, so compare as Maps).
    expect(session.truth.facts).toEqual(src.truth.facts);
    expect(session.truth.allegiances).toEqual(src.truth.allegiances);
    expect(session.truth.identities).toEqual(src.truth.identities);
    expect(session.truth.claimTruths).toEqual(src.truth.claimTruths);

    // View state and pipeline counters restore verbatim.
    expect(session.viewState).toEqual(src.viewState);
    expect(session.pipeline).toEqual(src.pipeline);
  });

  it('a restored Case File mints its next Claim id where the save left off', () => {
    const w = world();
    const src = sources(w);
    const snapshot = JSON.parse(JSON.stringify(saveSnapshot(src)));
    const result = loadSnapshot(snapshot, loadedManifest(w));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const added = result.session.caseFile.add({
      source: { kind: 'document', id: 'doc:later' as never },
      prop: {
        id: 'p3' as never,
        subject: 'npc:c' as EngineNpcId,
        predicate: 'core/WORKS_FOR',
        object: 'org:cell' as never,
      },
      observedAt: AT,
    });
    // Two saved Claims (claim:1, claim:2); the next minted id is claim:3.
    expect(added.id).toBe('claim:3');
  });

  it('restored stores continue the saved append order', () => {
    const w = world();
    const snapshot = JSON.parse(JSON.stringify(saveSnapshot(sources(w))));
    const result = loadSnapshot(snapshot, loadedManifest(w));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const restored = result.session.journal.entries();
    const maxOld = Math.max(...restored.map((e) => e.seq));
    const added = result.session.journal.append(AT, ['a later line'], []);
    expect(result.session.journal.entries()).toHaveLength(restored.length + 1);
    // The new entry's seq continues the saved sequence: strictly greater than
    // every restored entry's seq (the counters were restored from the save).
    expect(added?.seq).toBeGreaterThan(maxOld);
  });
});

// ---------------------------------------------------------------------------
// Manifest mismatch refused (Requirement 31.6)
// ---------------------------------------------------------------------------

describe('loadSnapshot — refuses a mismatched Content Manifest (Req 31.6)', () => {
  it('names the differing pack and leaves no session', () => {
    const w = world();
    const snapshot = JSON.parse(JSON.stringify(saveSnapshot(sources(w))));

    // A loaded manifest with the same pack id but a different version/hash.
    const saved = loadedManifest(w);
    const differentLoaded: ContentManifest = {
      ...saved,
      packs: saved.packs.map((p) => ({ ...p, version: '9.9.9', hash: 'deadbeef' })),
    };

    const result = loadSnapshot(snapshot, differentLoaded);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.kind).toBe('manifest-mismatch');
    if (result.error.kind !== 'manifest-mismatch') {
      return;
    }
    expect(result.error.differing.length).toBeGreaterThan(0);
    const core = result.error.differing.find((d) => d.id === 'core');
    expect(core).toBeDefined();
    expect(core?.saved).toBe(saved.packs.find((p) => p.id === 'core')?.version);
    expect(core?.loaded).toBe('9.9.9');
  });

  it('reports a pack present on only one side', () => {
    const w = world();
    const saved = loadedManifest(w);
    const loadedWithExtra: ContentManifest = {
      ...saved,
      packs: [...saved.packs, { id: 'extra', version: '1.0.0', hash: 'abc123' }],
    };
    const differing = diffManifests(saved, loadedWithExtra);
    const extra = differing.find((d) => d.id === 'extra');
    expect(extra).toEqual({ id: 'extra', saved: undefined, loaded: '1.0.0' });
  });

  it('accepts an identical manifest', () => {
    const w = world();
    const snapshot = JSON.parse(JSON.stringify(saveSnapshot(sources(w))));
    const result = loadSnapshot(snapshot, loadedManifest(w));
    expect(result.ok).toBe(true);
    expect(diffManifests(loadedManifest(w), loadedManifest(w))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Version mismatch refused (Requirement 17.1)
// ---------------------------------------------------------------------------

describe('loadSnapshot — refuses an unsupported format version (Req 17.1, 13.5)', () => {
  it('refuses a newer version with a typed error, before touching the manifest', () => {
    const w = world();
    const snapshot = { ...saveSnapshot(sources(w)), version: SAVE_VERSION + 1 };
    const result = loadSnapshot(snapshot, loadedManifest(w));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toEqual({
      kind: 'version',
      saved: SAVE_VERSION + 1,
      supported: SAVE_VERSION,
    });
  });

  it('refuses an older version-1 save with a version error, not corrupt (Req 13.5)', () => {
    const w = world();
    // A version-1-shaped save: the v1 fields only, with version 1. Its shape
    // (no caseFile/truth/viewState/pipeline/savedAt) would fail the v2 strict
    // schema, but parseAndLoad reports the version mismatch first.
    const v1 = {
      version: 1,
      generatorVersion: w.meta.generatorVersion,
      seed: w.meta.seed,
      content: w.meta.content,
      difficulty: w.meta.preset,
      scenario: w.meta.scenario,
      rng: w.rng,
      world: w,
      ledger: w.station.ledger,
      journal: new Journal().snapshot(),
      notifications: [],
      flavourCache: {},
      actionLog: new ActionLog().snapshot(),
      extractionQueue: [],
    };
    const result = parseAndLoad(JSON.parse(JSON.stringify(v1)), loadedManifest(w));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toEqual({ kind: 'version', saved: 1, supported: SAVE_VERSION });
  });

  it('loads a version 3 slice save in slice mode', () => {
    const w = world();
    const snapshot = { ...saveSnapshot(sources(w)), version: 3 as const };
    const result = loadSnapshot(JSON.parse(JSON.stringify(snapshot)), loadedManifest(w));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.session.world.region).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseAndLoad folds a parse failure into a corrupt error
// ---------------------------------------------------------------------------

describe('parseAndLoad — a malformed save is a typed corrupt error, never a throw', () => {
  it('returns corrupt for a value that does not validate', () => {
    const w = world();
    const result = parseAndLoad({ not: 'a save' }, loadedManifest(w));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.kind).toBe('corrupt');
  });

  it('loads a well-formed JSON-parsed save', () => {
    const w = world();
    const json = JSON.parse(JSON.stringify(saveSnapshot(sources(w))));
    const result = parseAndLoad(json, loadedManifest(w));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.session.world).toEqual(w);
  });
});

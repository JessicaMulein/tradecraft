/**
 * Tests for the Outcome Record: the shape and its versioned schema
 * (`outcome-record.ts`), the pure derivation (`build-outcome-record.ts`) and the
 * filesystem write (`outcome-store.ts`). Task 20.3; Requirements 35.1, 35.2,
 * 35.3.
 *
 * These drive a generated {@link WorldState} from the real core pack:
 *
 * - {@link buildOutcomeRecord} derives the record deterministically (same final
 *   state + truth ⇒ an identical record), carries the identifying metadata and
 *   the state a campaign reads (Req 35.2), and lists exactly the recruited,
 *   active Assets;
 * - the outcome tag maps the end's outcome/cause to `success` / `failure-plot` /
 *   `failure-burned`;
 * - the versioned Zod schema round-trips a record through JSON unchanged and
 *   rejects a malformed or wrong-version value on read (Req 35.3);
 * - {@link writeOutcomeRecord} validates, creates `saves/outcomes/` if missing,
 *   and writes one JSON file per game under a temp dir (Req 35.1, 35.3).
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  loadCityData,
  loadContent,
  loadDescriptorData,
  loadPublicTexts,
  type CityData,
  type ContentSet,
  type DescriptorData,
  type DifficultyPreset,
  type PublicText,
} from '@tradecraft/content';

import { ScenarioConfigSchema } from '../config/scenario-config.js';
import { generate, type GenerateInputs } from '../generate.js';
import { TruthStore, type PredicateEvaluatorLookup } from '../truth/truth.js';
import { asTruth, type NpcId } from '../model/core.js';
import type { WorldState } from '../model/state.js';
import type { AssetProfile, Relationship } from '../recruit/asset.js';
import { buildOutcomeRecord, outcomeTagOf } from './build-outcome-record.js';
import {
  OUTCOME_RECORD_SCHEMA_VERSION,
  OutcomeRecordSchema,
  dominantLever,
  parseOutcomeRecord,
  type OutcomeRecord,
} from './outcome-record.js';
import {
  DEFAULT_OUTCOMES_DIR,
  outcomeFileName,
  writeOutcomeRecord,
} from './outcome-store.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors arrest.spec.ts)
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

const STANDARD = preset('standard');

function inputs(p: DifficultyPreset = STANDARD): GenerateInputs {
  const scenario = ScenarioConfigSchema.parse({
    difficulty: { preset: p.id },
    mole: false,
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

function world(seed = 'outcome-alpha'): WorldState {
  return generate(seed, inputs());
}

/** An empty Truth Store (the derivation reads revealed state fields, not it). */
function truth(): TruthStore {
  const lookup: PredicateEvaluatorLookup = { get: () => undefined };
  return TruthStore.create(lookup);
}

/** An active-Asset profile for a recruited relationship. */
function assetProfile(options: { doubled?: boolean } = {}): AssetProfile {
  return {
    access: asTruth({ locs: [], orgs: [], npcs: [] }),
    reliability: asTruth(0.7),
    turned: true,
    hostileControlled: asTruth(options.doubled ?? false),
  };
}

/** A recruited, active-Asset relationship with an NPC. */
function activeAsset(npc: NpcId, options: { doubled?: boolean } = {}): Relationship {
  return {
    npc,
    trust: 0.6,
    suspicion: 0.1,
    exposure: 0.2,
    recruited: true,
    contacts: 3,
    channel: true,
    coverState: 'intact',
    asset: assetProfile(options),
  };
}

/** The first principal NPC id in the generated world. */
function someNpc(state: WorldState): NpcId {
  const id = Object.keys(state.npcs)[0] as NpcId | undefined;
  if (id === undefined) {
    throw new Error('generated world has no NPCs');
  }
  return id;
}

/** An ended world: a successful Plot abort, one recruited active Asset. */
function endedWorld(
  seed = 'outcome-alpha',
  overrides: {
    outcome?: 'success' | 'failure';
    cause?: NonNullable<WorldState['ended']>['cause'];
    doubled?: boolean;
  } = {},
): { state: WorldState; npc: NpcId } {
  const base = world(seed);
  const npc = someNpc(base);
  const state: WorldState = {
    ...base,
    relationships: {
      ...base.relationships,
      [npc]: activeAsset(npc, { doubled: overrides.doubled }),
    },
    station: { ...base.station, standing: 4 },
    ended: {
      outcome: overrides.outcome ?? 'success',
      at: { day: 9, phase: 2 },
      cause: overrides.cause ?? 'pressure',
    },
  };
  return { state, npc };
}

// ---------------------------------------------------------------------------
// buildOutcomeRecord — derivation (Req 35.2, 35.3)
// ---------------------------------------------------------------------------

describe('buildOutcomeRecord — derivation (Req 35.2)', () => {
  it('carries the identifying metadata from the final state', () => {
    const { state } = endedWorld();
    const record = buildOutcomeRecord(state, truth());

    expect(record.schema).toBe(OUTCOME_RECORD_SCHEMA_VERSION);
    expect(record.seed).toBe(state.meta.seed);
    expect(record.generatorVersion).toBe(state.meta.generatorVersion);
    expect(record.difficulty).toBe('standard');
    expect(record.endedAt).toEqual({ day: 9, phase: 2 });
    // The Content Manifest round-trips through the record.
    expect(record.content).toEqual(state.meta.content);
  });

  it('reads Standing and the remaining Budget from the Station', () => {
    const { state } = endedWorld();
    const record = buildOutcomeRecord(state, truth());
    expect(record.standing).toBe(4);
    expect(typeof record.budgetRemaining).toBe('number');
  });

  it('lists exactly the recruited, active Assets', () => {
    const { state, npc } = endedWorld();
    const record = buildOutcomeRecord(state, truth());
    expect(record.survivingAssets.map((a) => a.npc)).toEqual([npc]);
    const asset = record.survivingAssets[0];
    expect(asset.archetype).toBe(state.npcs[npc].archetype);
    expect(asset.persona.name).toBe(state.npcs[npc].persona.name);
    expect(asset.trust).toBe(0.6);
    expect(asset.exposure).toBe(0.2);
    expect(asset.doubled).toBe(false);
  });

  it('excludes an unrecruited relationship from survivingAssets', () => {
    const base = world();
    const npc = someNpc(base);
    const state: WorldState = {
      ...base,
      relationships: {
        [npc]: { ...activeAsset(npc), recruited: false, asset: undefined },
      },
      ended: { outcome: 'success', at: base.time, cause: 'pressure' },
    };
    const record = buildOutcomeRecord(state, truth());
    expect(record.survivingAssets).toEqual([]);
  });

  it('reveals a doubled Asset through the doubled flag', () => {
    const { state } = endedWorld('outcome-alpha', { doubled: true });
    const record = buildOutcomeRecord(state, truth());
    expect(record.survivingAssets[0].doubled).toBe(true);
  });

  it('builds the Cover status from the Cover Identity and the burned flag', () => {
    const { state } = endedWorld();
    const record = buildOutcomeRecord(state, truth());
    expect(record.cover.identity).toBe(state.player.cover.id);
    expect(record.cover.blown).toBe(false);
    expect(typeof record.cover.suspicion).toBe('number');
  });

  it('records knownCover and an empty doctrineShift for an unburned game', () => {
    const { state } = endedWorld();
    const record = buildOutcomeRecord(state, truth());
    expect(record.hostileMemory.knownCover).toBe(false);
    expect(record.hostileMemory.doctrineShift).toEqual({});
    expect(record.hostileMemory.compromisedDrops).toEqual([]);
  });

  it('is deterministic: the same final state yields an identical record', () => {
    const { state } = endedWorld();
    const a = buildOutcomeRecord(state, truth());
    const b = buildOutcomeRecord(state, truth());
    expect(a).toEqual(b);
  });

  it('derives the same record from a freshly re-generated identical world', () => {
    const first = endedWorld('outcome-beta');
    const second = endedWorld('outcome-beta');
    const a = buildOutcomeRecord(first.state, truth());
    const b = buildOutcomeRecord(second.state, truth());
    expect(a).toEqual(b);
  });
});

describe('outcomeTagOf — persisted outcome tag', () => {
  it('maps a win to success', () => {
    const { state } = endedWorld('outcome-alpha', { outcome: 'success', cause: 'pressure' });
    expect(outcomeTagOf(state)).toBe('success');
    expect(buildOutcomeRecord(state, truth()).outcome).toBe('success');
  });

  it('maps a burned loss to failure-burned', () => {
    const { state } = endedWorld('outcome-alpha', { outcome: 'failure', cause: 'burned' });
    expect(outcomeTagOf(state)).toBe('failure-burned');
  });

  it('maps a plot-completed loss to failure-plot', () => {
    const { state } = endedWorld('outcome-alpha', {
      outcome: 'failure',
      cause: 'plot-completed',
    });
    expect(outcomeTagOf(state)).toBe('failure-plot');
  });

  it('falls back to failure-plot when the world is not yet ended', () => {
    const base = world();
    expect(outcomeTagOf(base)).toBe('failure-plot');
  });
});

describe('dominantLever', () => {
  it('picks the strongest lever, ties broken by MICE order', () => {
    expect(dominantLever({ money: 0.2, ideology: 0.9, coercion: 0.1, ego: 0.3 })).toBe(
      'ideology',
    );
    // A tie between money and ego resolves to money (earlier in MICE order).
    expect(dominantLever({ money: 0.5, ideology: 0.1, coercion: 0.1, ego: 0.5 })).toBe(
      'money',
    );
  });
});

// ---------------------------------------------------------------------------
// The versioned schema (Req 35.3)
// ---------------------------------------------------------------------------

describe('OutcomeRecordSchema — round-trip and validation (Req 35.3)', () => {
  function sampleRecord(): OutcomeRecord {
    const { state } = endedWorld();
    return buildOutcomeRecord(state, truth());
  }

  it('round-trips a record through JSON unchanged', () => {
    const record = sampleRecord();
    const parsed = parseOutcomeRecord(JSON.parse(JSON.stringify(record)));
    expect(parsed).toEqual(record);
  });

  it('rejects a record of the wrong schema version', () => {
    const record = sampleRecord();
    const wrong = { ...record, schema: 2 };
    expect(OutcomeRecordSchema.safeParse(wrong).success).toBe(false);
  });

  it('rejects a record missing a required field', () => {
    const record = sampleRecord() as unknown as Record<string, unknown>;
    const withoutStanding = { ...record };
    delete withoutStanding.standing;
    expect(OutcomeRecordSchema.safeParse(withoutStanding).success).toBe(false);
  });

  it('rejects a record with an unexpected extra field', () => {
    const record = { ...sampleRecord(), unexpected: true };
    expect(OutcomeRecordSchema.safeParse(record).success).toBe(false);
  });

  it('rejects a malformed outcome tag', () => {
    const record = { ...sampleRecord(), outcome: 'won' };
    expect(OutcomeRecordSchema.safeParse(record).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// writeOutcomeRecord — the filesystem write (Req 35.1, 35.3)
// ---------------------------------------------------------------------------

describe('writeOutcomeRecord — writing to saves/outcomes/ (Req 35.1, 35.3)', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'tradecraft-outcomes-'));
    dirs.push(dir);
    return dir;
  }

  function sampleRecord(): OutcomeRecord {
    const { state } = endedWorld();
    return buildOutcomeRecord(state, truth());
  }

  it('writes a validated record as one JSON file that reads back equal', () => {
    const record = sampleRecord();
    const dir = tempDir();
    const path = writeOutcomeRecord(record, dir);

    const text = readFileSync(path, 'utf8');
    const parsed = parseOutcomeRecord(JSON.parse(text));
    expect(parsed).toEqual(record);
  });

  it('creates the target directory when it is missing', () => {
    const record = sampleRecord();
    const dir = join(tempDir(), 'nested', 'outcomes');
    const path = writeOutcomeRecord(record, dir);
    // The write succeeded under the created nested directory.
    expect(path.startsWith(dir)).toBe(true);
    expect(() => readFileSync(path, 'utf8')).not.toThrow();
  });

  it('names the file <seed>-<endedAt>.json', () => {
    const record = sampleRecord();
    const name = outcomeFileName(record);
    expect(name).toBe(`${record.seed}-d${record.endedAt.day}p${record.endedAt.phase}.json`);
  });

  it('refuses to write a malformed record', () => {
    const bad = { ...sampleRecord(), outcome: 'won' } as unknown as OutcomeRecord;
    const dir = tempDir();
    expect(() => writeOutcomeRecord(bad, dir)).toThrow();
  });

  it('defaults to saves/outcomes/ when no directory is given', () => {
    expect(DEFAULT_OUTCOMES_DIR).toBe(join('saves', 'outcomes'));
  });
});

/**
 * Integration tests for the Coverage Report orchestrator and the eligibility
 * recount, run end-to-end against the real core pack (content-expansion task
 * 5.11; Req 15.1, 15.3, 15.5; Property 17 clauses).
 *
 * These drive {@link coverage} over the Core City with a real `generate`, so
 * the write-only `UsageSink` is exercised through the actual setting step. The
 * Core City Path records no `loc`/`cover-identity` draws (those are City-Pack
 * draws), so the orchestrator's robustness on an empty-tally cell is covered
 * here; the row/flag arithmetic itself is pinned in `report.spec.ts`. The whole
 * run is deterministic, so the two headline guarantees — the sink does not
 * change the world, and two reports of the same inputs are identical — are
 * checked directly.
 *
 * The eligibility and Required-Query-margin recounts are checked against a
 * small hand-built City Pack bundle, where the Binder counts are known, rather
 * than against the Core City (which has no City Bundle).
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  loadContent,
  loadCityData,
  loadDescriptorData,
  loadPublicTexts,
  type ContentSet,
} from '@tradecraft/content';
import {
  CountingUsageSink,
  ScenarioConfigSchema,
  generate,
  type ContentSetV2,
  type CityBundle,
  type DifficultyPreset,
  type GenerateInputs,
  type ScenarioConfig,
} from '@tradecraft/engine';

import { coverage, coverageSeed, type CoverageDeps } from './coverage.js';
import { eligibleForCity, requiredQueryMarginsForCity, staticBinderCount } from './eligibility.js';
import { runCoverage } from './index.js';
import { CSV_HEADER } from './output.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const CORE_DIR = join(REPO_ROOT, 'packages', 'content', 'packs', 'core');

/** Load the real core pack and its side files, as the engine specs do. */
function loadCore(): {
  content: ContentSet;
  deps: CoverageDeps;
} {
  const content = loadContent([CORE_DIR], ['core']);
  if (!content.ok) {
    throw new Error(
      `core pack failed to load:\n${content.errors.map((e) => `  ${e.file} ${e.path}: ${e.message}`).join('\n')}`,
    );
  }
  const cityData = loadCityData(CORE_DIR);
  const descriptors = loadDescriptorData(CORE_DIR);
  const publicTexts = loadPublicTexts(CORE_DIR);
  if (!cityData.ok || !descriptors.ok || !publicTexts.ok) {
    throw new Error('core pack side files failed to load');
  }

  const set = content.value;
  const preset = (id: string): DifficultyPreset => {
    for (const [key, value] of set.difficultyPresets) {
      if (key === id || key.endsWith(`/${id}`)) {
        return value;
      }
    }
    throw new Error(`no preset ${id}`);
  };
  const scenario = (city: string): ScenarioConfig =>
    ScenarioConfigSchema.parse({
      difficulty: { preset: 'standard' },
      setting: { city },
      mole: false,
      recruitment: {
        pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
        firstContact: { a: 1, b: 1, c: 1, d: 1 },
        meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
        exposure: { k1: 1, k2: 1, k3: 1 },
        turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
      },
    });

  const deps: CoverageDeps = {
    preset,
    inputsFor: (city, resolvedPreset): GenerateInputs => ({
      content: set,
      preset: resolvedPreset,
      scenario: scenario(city),
      cityData: cityData.value,
      descriptors: descriptors.value,
      publicTexts: publicTexts.value,
    }),
  };
  return { content: set, deps };
}

const { content, deps } = loadCore();

describe('coverage() over the real Core City', () => {
  it('builds a report with a Variety row per city/preset cell and no crash on empty tallies', () => {
    const report = coverage(content, ['core'], ['standard'], 3, {}, deps);
    expect(report.variety).toHaveLength(1);
    expect(report.variety[0].city).toBe('core');
    expect(report.variety[0].preset).toBe('standard');
    // The Core City draws no loc/cover-identity through the sink, so there are
    // no usage rows and no Required Query margins (no City Bundle).
    expect(report.requiredQueryMargins).toEqual([]);
  });

  it('is deterministic: two reports of the same inputs are deep-equal (Req 15.5)', () => {
    const a = coverage(content, ['core'], ['standard'], 3, {}, deps);
    const b = coverage(content, ['core'], ['standard'], 3, {}, deps);
    expect(a).toEqual(b);
  });

  it('passing the coverage sink does not change the generated world (Property 14)', () => {
    const seed = coverageSeed('core', 'standard', 0);
    const inputs = deps.inputsFor('core', deps.preset('standard'));
    const withoutSink = generate(seed, inputs);
    const withSink = generate(seed, inputs, { usage: new CountingUsageSink() });
    expect(withSink).toEqual(withoutSink);
  });

  it('covers multiple presets, one Variety row each', () => {
    const report = coverage(content, ['core'], ['standard', 'easy'], 2, {}, deps);
    expect(report.variety.map((v) => v.preset).sort()).toEqual(['easy', 'standard']);
  });
});

// ---------------------------------------------------------------------------
// Eligibility and Required-Query-margin recount on a hand-built City Bundle.
// ---------------------------------------------------------------------------

/** A minimal City Bundle with two Binder Locations of `function:cafe`. */
function sampleBundle(): CityBundle {
  const locationType = {
    id: 'city/cafe',
    public: true,
    allowedActions: ['observe'],
    openingHours: [],
    crowdCurve: [],
    weatherModifiers: [],
    baseRisk: 0.1,
    allowsDeadDrops: false,
    namePatterns: { pool: ['Café {n}'] },
    descriptionPool: { pool: ['a café'] },
    atmosphereTags: ['quiet'],
    tags: ['function:cafe'],
  } as unknown as CityBundle['locationTypes'][number];

  const location = (id: string, tags: string[]) =>
    ({
      id,
      name: id,
      aliases: [],
      type: 'city/cafe',
      district: 'city/d1',
      public: true,
      description: 'a place',
      atmosphere: [],
      city: 'city/sample',
      tags,
      basis: { kind: 'fictional' },
    }) as unknown as CityBundle['locations'][number];

  return {
    def: {
      id: 'city/sample',
      name: 'Sample',
      period: { from: 1950, to: 1955 },
      cultureWeights: [],
    } as unknown as CityBundle['def'],
    districts: [{ id: 'city/d1', city: 'city/sample', name: 'D1', description: 'd', tags: [] }] as unknown as CityBundle['districts'],
    locations: [location('city/l1', []), location('city/l2', [])],
    routes: [],
    locationTypes: [locationType],
    newspapers: [],
    orgs: [],
    weather: {} as unknown as CityBundle['weather'],
    covers: [{ id: 'city/cover-a' }, { id: 'city/cover-b' }] as unknown as CityBundle['covers'],
    streets: [],
    locale: {} as unknown as CityBundle['locale'],
    variants: [],
    sources: [],
  };
}

/** A V2 content set carrying the sample bundle as its one City Pack. */
function v2WithBundle(bundle: CityBundle): ContentSetV2 {
  return {
    ...(content as ContentSetV2),
    cities: { [bundle.def.id]: bundle },
    cultureGroups: {},
    descriptorFragments: [],
    cityScopeOwner: {},
    tagVocabulary: {
      facets: [{ id: 'function', appliesTo: ['location'] }],
      tags: [{ id: 'function:cafe', description: 'cafe' }],
      requiredQueries: [
        { id: 'rq-cafe', query: ['function:cafe'], minStatic: 1, minInstantiated: 1 },
      ],
    },
  } as unknown as ContentSetV2;
}

describe('eligibility and Required-Query margins on a City Bundle (Req 15.2, 15.3)', () => {
  const set = v2WithBundle(sampleBundle());

  it('lists the city Locations (as loc: ids) and Cover Identities as eligible', () => {
    const eligible = eligibleForCity(set, 'city/sample', 1952);
    expect(eligible.get('loc')).toEqual(['loc:city/l1', 'loc:city/l2']);
    expect(eligible.get('cover-identity')).toEqual(['city/cover-a', 'city/cover-b']);
  });

  it('counts static Binders through Effective Tags (own plus Location Type tags)', () => {
    // Both Locations inherit function:cafe from their Location Type → 2 Binders.
    const margins = requiredQueryMarginsForCity(set, 'city/sample', 1952);
    expect(margins).toHaveLength(1);
    expect(margins[0].city).toBe('city/sample');
    expect(margins[0].binders).toBe(2);
    expect(margins[0].min).toBe(1);
    expect(margins[0].query).toContain('rq-cafe');
  });

  it('staticBinderCount reads a query directly off a bundle', () => {
    expect(staticBinderCount(sampleBundle(), ['function:cafe'])).toBe(2);
    expect(staticBinderCount(sampleBundle(), ['function:drop'])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The runCoverage CLI: argv parsing, pack load and file writing.
// ---------------------------------------------------------------------------

describe('runCoverage CLI (end-to-end on the core pack)', () => {
  const tmps: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of tmps.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function outDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'coverage-cli-'));
    tmps.push(dir);
    return dir;
  }

  it('prints the help text for --help without loading anything', () => {
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    runCoverage({ argv: ['--help'] });
    expect(out).toHaveBeenCalled();
    expect(String(out.mock.calls[0][0])).toContain('Usage: pnpm content coverage');
  });

  it('writes coverage.md and coverage.csv for the Core City', () => {
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const dir = outDir();
    runCoverage({
      argv: [
        '--dirs',
        CORE_DIR,
        '--packs',
        'core',
        '--cities',
        'core',
        '--presets',
        'standard',
        '--seeds',
        '2',
        '--out',
        dir,
      ],
    });
    const csv = readFileSync(join(dir, 'coverage.csv'), 'utf8');
    const md = readFileSync(join(dir, 'coverage.md'), 'utf8');
    expect(csv.split('\n')[0]).toBe(CSV_HEADER);
    expect(md).toContain('# Coverage Report');
    expect(md).toContain('## Variety Metric');
  });

  it('throws on an unknown option (the CLI shell reports it, non-zero)', () => {
    expect(() => runCoverage({ argv: ['--nope'] })).toThrow(/unknown option/);
  });

  it('throws when the pack set fails to load', () => {
    const empty = outDir();
    expect(() => runCoverage({ argv: ['--dirs', empty, '--out', empty] })).toThrow(
      /failed to load|no core pack/,
    );
  });
});

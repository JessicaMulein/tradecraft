/**
 * The shipped-content CI gates (content-expansion task 10.1; Req 11.1, 11.8,
 * 15.4, 18.4).
 *
 * This repo has no `.github/workflows`; CI is the root `pnpm check` (nx
 * typecheck/lint/dep-cruise/test) plus the `pnpm content` CLI. The two gates
 * task 10.1 asks for are therefore wired as this test, which `pnpm check` runs
 * through the content-tools Vitest suite:
 *
 * 1. **Release lint gate** (Req 11.1, 11.8, 18.4) — run the Pack Linter at the
 *    `release` profile over the whole shipped set (every pack under
 *    `packages/content/packs`) and assert ZERO error-severity findings. The
 *    linter's exit code is non-zero iff there is an error finding (Req 13.4),
 *    so a zero `summary.errors` is exactly the release gate passing. Warnings
 *    and info do not fail the gate.
 *
 * 2. **Coverage Variety gate** (Req 15.4) — run the Coverage Report over each
 *    of the five shipped cities at preset `standard`, write a merged
 *    `coverage.md`/`coverage.csv` artifact, and assert every city's Variety
 *    Metric is ≤ 0.6 (the design target). A city whose instantiated geography
 *    barely varies from seed to seed (mean pairwise Jaccard above 0.6) fails.
 *
 * Two mechanics of the shipped set shape how the gates load it:
 *
 * - The Pack Linter CLI does not expand a parent directory to its child packs,
 *   so the lint gate enumerates the pack directories itself (one `pack.yaml`
 *   per dir) and passes absolute paths, exactly as the loader expects.
 * - A Content Set holds at most one City Pack (the loader allows exactly one
 *   Era per City Pack and refuses cross-city references), so the five cities
 *   cannot be loaded into one set. The coverage gate loads each city on its own
 *   through {@link loadPreviewContent} — the city pack plus its transitive
 *   `requires` — the same per-city load the golden-preview gate (task 10.3)
 *   uses, and runs the Coverage Report once per city.
 *
 * 50-seed generation over five cities is slow for the default suite, so the
 * seed count defaults to a smaller sample and the full 50-seed run (Req 15.1)
 * is gated behind `CONTENT_CI_FULL=1`. Either way the Variety threshold is
 * asserted; the full run is what CI invokes for the shippable artifact.
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { afterAll, describe, expect, it } from 'vitest';

import {
  ScenarioConfigSchema,
  isContentSetV2,
  type DifficultyPreset,
  type GenerateInputs,
  type ScenarioConfig,
} from '@tradecraft/engine';

import { lint } from './lint/index.js';
import {
  coverage,
  sortRows,
  sortMargins,
  sortVariety,
  DEFAULT_VARIETY_TARGET,
  type CoverageDeps,
  type CoverageReport,
  type CoverageRow,
  type RequiredQueryMargin,
  type VarietyRow,
} from './coverage/index.js';
import { toMarkdown, toCsv } from './coverage/output.js';
import { loadPreviewContent, type PreviewContent } from './preview/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..');
/** The parent of the shipped packs; one `pack.yaml` per child directory. */
const PACKS_DIR = join(REPO_ROOT, 'packages', 'content', 'packs');

/** The shipped City Pack ids (task 9). Each loads with its transitive requires. */
const CITY_PACKS = [
  'city-vienna',
  'city-berlin',
  'city-istanbul',
  'city-lisbon',
  'city-trieste',
] as const;

/** Whether to run the full 50-seed Coverage Report (Req 15.1) for the artifact. */
const FULL = process.env.CONTENT_CI_FULL === '1';
/** Seeds per city in the Variety gate: the full sample in CI, a sample by default. */
const COVERAGE_SEEDS = FULL ? 50 : 8;
/** Generation across five cities is slow; give the gate ample headroom. */
const GATE_TIMEOUT_MS = FULL ? 20 * 60_000 : 5 * 60_000;

/** Every shipped pack directory (one `pack.yaml` per dir) under `packs/`. */
function shippedPackDirs(): string[] {
  return readdirSync(PACKS_DIR)
    .map((name) => join(PACKS_DIR, name))
    .filter((dir) => {
      try {
        return statSync(dir).isDirectory() && statSync(join(dir, 'pack.yaml')).isFile();
      } catch {
        return false;
      }
    })
    .sort();
}

describe('CI gate: release lint over the shipped set (Req 11.1, 11.8, 18.4)', () => {
  it('reports zero error-severity findings for the whole shipped set', () => {
    const dirs = shippedPackDirs();
    expect(dirs.length).toBeGreaterThanOrEqual(5);

    const report = lint(dirs, [], { profile: 'release' });

    // The release gate passes iff there is no error finding (the CLI's exit
    // code, Req 13.4). Surface the offenders in the failure message so a
    // regression names the file and rule, not just a count.
    const errors = report.findings.filter((f) => f.severity === 'error');
    const detail = errors
      .map((f) => `  ${f.rule} ${f.pack}/${f.file}:${f.path} ${f.message}`)
      .join('\n');
    expect(report.summary.errors, `release lint errors:\n${detail}`).toBe(0);
  });
});

describe('CI gate: Coverage Variety Metric over the shipped cities (Req 15.4)', () => {
  const artifacts: string[] = [];
  afterAll(() => {
    for (const dir of artifacts.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it(
    `keeps every shipped city's Variety Metric at or below ${DEFAULT_VARIETY_TARGET}`,
    () => {
      // One Coverage Report per city (a set holds at most one City Pack); merge
      // the reports' rows, margins and Variety rows into a single report so the
      // artifact covers all five cities together.
      const rows: CoverageRow[] = [];
      const margins: RequiredQueryMargin[] = [];
      const variety: VarietyRow[] = [];

      for (const pack of CITY_PACKS) {
        const loaded = loadPreviewContent([PACKS_DIR], [pack]);
        const set = loaded.content;
        expect(isContentSetV2(set), `${pack} is not a V2 content set`).toBe(true);

        // The loaded set carries exactly this pack's City Definition; its
        // namespaced id is what `setting.city` and the Coverage Report take.
        const cityIds = isContentSetV2(set) ? Object.keys(set.cities) : [];
        expect(cityIds, `${pack} should load exactly one City Pack`).toHaveLength(1);
        const city = cityIds[0];

        const report = coverage(
          set,
          [city],
          ['standard'],
          COVERAGE_SEEDS,
          { varietyTarget: DEFAULT_VARIETY_TARGET },
          coverageDeps(loaded),
        );

        // The Variety gate for this city: a row per cell, each at/below target.
        expect(report.variety.length).toBeGreaterThan(0);
        for (const row of report.variety) {
          expect(
            row.meanJaccard,
            `${city}/${row.preset} Variety Metric ${row.meanJaccard.toFixed(3)} exceeds ${DEFAULT_VARIETY_TARGET}`,
          ).toBeLessThanOrEqual(DEFAULT_VARIETY_TARGET);
          expect(row.pass).toBe(true);
        }

        rows.push(...report.rows);
        margins.push(...report.requiredQueryMargins);
        variety.push(...report.variety);
      }

      // Every shipped city produced a Variety row.
      expect(new Set(variety.map((v) => v.city)).size).toBe(CITY_PACKS.length);

      // Write the merged Coverage Report as an artifact (Req 15.4). The report's
      // arrays are the per-city reports' already-flagged rows; re-sort them with
      // the writer's own ordering so the artifact is byte-stable.
      const merged: CoverageReport = {
        rows: sortRows(rows),
        requiredQueryMargins: sortMargins(margins),
        variety: sortVariety(variety),
      };
      const out = mkdtempSync(join(tmpdir(), 'coverage-ci-'));
      artifacts.push(out);
      writeFileSync(join(out, 'coverage.md'), toMarkdown(merged), 'utf8');
      writeFileSync(join(out, 'coverage.csv'), toCsv(merged), 'utf8');
      expect(readFileSync(join(out, 'coverage.md'), 'utf8')).toContain('## Variety Metric');
    },
    GATE_TIMEOUT_MS,
  );
});

/**
 * Build the generator {@link CoverageDeps} for a single loaded city, mirroring
 * the Coverage CLI and the Preview world builder: resolve a preset by bare or
 * namespaced id, and build the `GenerateInputs` for each `(city, preset)` from
 * the loaded set, a scenario placing the game in the city, and the (Core City)
 * side-file data `loadPreviewContent` bundled — the generator reads the authored
 * city on a City-Pack path, so this geometry is required by the type but unused.
 */
function coverageDeps(loaded: PreviewContent): CoverageDeps {
  const set = loaded.content;
  const preset = (id: string): DifficultyPreset => {
    for (const [key, value] of set.difficultyPresets) {
      if (key === id || key.endsWith(`/${id}`)) {
        return value;
      }
    }
    throw new Error(`no Difficulty Preset "${id}"`);
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

  return {
    preset,
    inputsFor: (city, resolvedPreset): GenerateInputs => ({
      content: set,
      preset: resolvedPreset,
      scenario: scenario(city),
      cityData: loaded.cityData,
      descriptors: loaded.descriptors,
      publicTexts: loaded.publicTexts,
    }),
  };
}

/**
 * The Coverage Report orchestrator (content-expansion task 5.11; design,
 * "Coverage Report"; Req 15.1–15.5; Property 17).
 *
 * {@link coverage} generates one world per seed, city and preset, feeding each
 * `generate` call a write-only {@link CountingUsageSink}, and assembles the
 * tallies, eligibility, Required-Query margins and Instantiated-City Location
 * sets into a {@link CoverageReport} through the pure accounting core
 * ({@link ./report}). It is deterministic: the seeds are fixed
 * (`coverage-<city>-<preset>-<i>`, design), the sink is write-only (so the
 * generated worlds are byte-identical to a sinkless run, Property 14), and the
 * accounting core is a pure function of what it collects.
 *
 * The design's signature is `coverage(set, cities, presets, seeds, opts)`.
 * `generate`, though, needs the full {@link GenerateInputs} — the resolved
 * Difficulty Preset, the scenario, and the city/descriptor/public-text pack
 * data — which the CLI ({@link ./index}) loads from disk. To keep this
 * orchestrator testable without that filesystem wiring, the pack data and
 * preset resolution arrive through an injected {@link CoverageDeps}; the CLI
 * supplies the real loaders and a fake can supply a tiny in-memory set. This is
 * the same pure-core / injected-IO split the Authoring Aid uses.
 */

import {
  CountingUsageSink,
  generate,
  isContentSetV2,
  type ContentSetV2,
  type DifficultyPreset,
  type GenerateInputs,
  type ScenarioConfig,
  type WorldState,
} from '@tradecraft/engine';
import { type ContentSet } from '@tradecraft/content';

import {
  buildCoverageReport,
  DEFAULT_UNDERUSE,
  DEFAULT_VARIETY_TARGET,
  type CoverageCell,
  type CoverageReport,
  type ContentId,
  type RequiredQueryMargin,
  type UsageCount,
} from './report.js';
import { eligibleForCity, requiredQueryMarginsForCity } from './eligibility.js';

/** The per-city pack data and preset resolution the generator needs. */
export interface CoverageDeps {
  /** Resolve a preset id to the Difficulty Preset the generator runs under. */
  readonly preset: (id: string) => DifficultyPreset;
  /**
   * Build the `GenerateInputs` for a `(city, preset)`: the content set, the
   * resolved preset, a scenario placing the game in the city, and the city's
   * `city.yaml`/`descriptors.yaml`/public-text pack data. The CLI loads these
   * from the pack directories; a test supplies them in memory.
   */
  readonly inputsFor: (city: string, preset: DifficultyPreset) => GenerateInputs;
}

/** The options to {@link coverage} (design, `opts: { underuse }`, plus seeds/target). */
export interface CoverageOptions {
  /** The underuse fraction (default {@link DEFAULT_UNDERUSE}). */
  readonly underuse?: number;
  /** The Variety-Metric target (default {@link DEFAULT_VARIETY_TARGET}). */
  readonly varietyTarget?: number;
}

/** The fixed seed for the i-th world of a `(city, preset)` (design). */
export function coverageSeed(city: string, preset: string, i: number): string {
  return `coverage-${city}-${preset}-${i}`;
}

/**
 * Generate worlds and build the coverage report (design, "Coverage Report").
 * For every `(city, preset)` and every seed `0..seeds-1`, generate a world with
 * a {@link CountingUsageSink}, tally the sink, record the world's Instantiated
 * City Location set, and compute the eligible items and Required-Query margins
 * for the city at the world's Game Year. The accounting core turns the cells
 * into the report.
 *
 * The Required-Query margins are static (they depend on the city and year, not
 * the seed), so they are computed once per city at the first seed's Game Year.
 */
export function coverage(
  set: ContentSet,
  cities: readonly string[],
  presets: readonly string[],
  seeds: number,
  opts: CoverageOptions,
  deps: CoverageDeps,
): CoverageReport {
  const underuse = opts.underuse ?? DEFAULT_UNDERUSE;
  const varietyTarget = opts.varietyTarget ?? DEFAULT_VARIETY_TARGET;
  const v2: ContentSetV2 | undefined = isContentSetV2(set) ? set : undefined;

  const cells: CoverageCell[] = [];
  const margins: RequiredQueryMargin[] = [];
  const marginedCities = new Set<string>();

  for (const city of cities) {
    for (const preset of presets) {
      const resolved = deps.preset(preset);
      const counts = new CountingUsageSink();
      const locationSets: ContentId[][] = [];
      let year: number | undefined;

      for (let i = 0; i < seeds; i += 1) {
        const seed = coverageSeed(city, preset, i);
        const world = generate(seed, deps.inputsFor(city, resolved), {
          usage: counts,
        });
        year ??= world.meta.setting.year;
        locationSets.push(worldLocationSet(world));
      }

      // Eligibility and margins are read at the city's Game Year; a City Pack's
      // Period Window is fixed, so the first seed's year is representative. A
      // Core City (no bundle in the V2 set) yields empty eligibility, so its
      // rows fall back to the recorded draws alone.
      const eligible =
        v2 !== undefined && year !== undefined
          ? eligibleForCity(v2, city, year)
          : new Map<string, readonly ContentId[]>();

      cells.push({
        city,
        preset,
        counts: toUsageCounts(counts),
        eligible,
        locationSets,
      });

      if (v2 !== undefined && year !== undefined && !marginedCities.has(city)) {
        margins.push(...requiredQueryMarginsForCity(v2, city, year));
        marginedCities.add(city);
      }
    }
  }

  return buildCoverageReport({
    cells,
    requiredQueryMargins: margins,
    underuse,
    varietyTarget,
  });
}

/**
 * The Instantiated-City Location set of a generated world: the ids of the
 * city's Locations. The Variety Metric is the mean pairwise Jaccard of these
 * sets over the seeds, measuring how much the authored-city instantiation
 * varies the geography from seed to seed (design, "Variety Metric").
 */
export function worldLocationSet(world: WorldState): ContentId[] {
  return Object.keys(world.city.locations).sort();
}

/** Convert a {@link CountingUsageSink}'s entries to the core's {@link UsageCount}s. */
function toUsageCounts(sink: CountingUsageSink): UsageCount[] {
  return sink.entries().map((e) => ({ kind: e.kind, id: e.id, count: e.count }));
}

/** A convenience for the common case of placing a game in a city with a preset. */
export type CoverageScenarioFactory = (city: string) => ScenarioConfig;

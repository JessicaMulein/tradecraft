/**
 * The Coverage Report (`content-tools/coverage`).
 *
 * The Coverage Report generates one world per seed, city and preset, counts
 * how often the generator draws each content item through the engine's
 * write-only `UsageSink`, and reports the expected/underuse figures, the
 * Required-Query margins and the Variety Metric as `coverage.md` and
 * `coverage.csv` (content-expansion task 5.11; design, "Coverage Report";
 * Req 15.1–15.5).
 *
 * This module owns the `coverage` subcommand's CLI only: it parses argv, loads
 * the pack set and the Core City pack data from disk, builds the generator
 * {@link CoverageDeps} and writes the two files. The deterministic accounting
 * core ({@link ./report}), the eligibility recount ({@link ./eligibility}),
 * the generation loop ({@link ./coverage}) and the writers ({@link ./output})
 * carry the logic and are unit-tested without the filesystem.
 *
 * CLI: `pnpm content coverage --packs <ids> [--cities ...] [--presets ...]
 *       [--seeds 50] [--underuse 0.25] [--dirs a,b] [--out dir]`.
 */

import { readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  ScenarioConfigSchema,
  isContentSetV2,
  type DifficultyPreset,
  type GenerateInputs,
  type ScenarioConfig,
} from '@tradecraft/engine';
import {
  loadContent,
  loadCityData,
  loadDescriptorData,
  loadPublicTexts,
  SLICE_KIND_REGISTRATIONS,
  CONTENT_EXPANSION_KIND_REGISTRATIONS,
  type ContentSet,
  type ContentKindRegistration,
  type CityData,
  type DescriptorData,
  type PublicText,
} from '@tradecraft/content';

import { coverage, type CoverageDeps } from './coverage.js';
import { DEFAULT_UNDERUSE, DEFAULT_VARIETY_TARGET } from './report.js';
import { toMarkdown, toCsv } from './output.js';

export {
  coverage,
  coverageSeed,
  worldLocationSet,
  type CoverageDeps,
  type CoverageOptions,
} from './coverage.js';
export {
  buildCoverageReport,
  flagFor,
  jaccard,
  meanPairwiseJaccard,
  sortRows,
  sortMargins,
  sortVariety,
  DEFAULT_UNDERUSE,
  DEFAULT_VARIETY_TARGET,
  type CoverageReport,
  type CoverageRow,
  type CoverageCell,
  type CoverageInputs,
  type CoverageFlag,
  type RequiredQueryMargin,
  type VarietyRow,
  type UsageCount,
  type EligibleByKind,
  type ContentId,
} from './report.js';
export {
  eligibleForCity,
  requiredQueryMarginsForCity,
  staticBinderCount,
} from './eligibility.js';
export { toMarkdown, toCsv, CSV_HEADER } from './output.js';

/** Options parsed from the `coverage` subcommand's argv. */
export interface CoverageCliOptions {
  readonly argv: readonly string[];
}

/** The default pack directory the CLI searches for packs when `--dirs` is omitted. */
const DEFAULT_PACK_DIR = 'packages/content/packs';
/** The default preset the Coverage Report runs under (design, CI gate). */
const DEFAULT_PRESET = 'standard';
/** The default seed count (Req 15.1). */
const DEFAULT_SEEDS = 50;

/** The `coverage` subcommand's parsed flags. */
interface ParsedArgs {
  readonly dirs: readonly string[];
  readonly selected: readonly string[];
  readonly cities: readonly string[];
  readonly presets: readonly string[];
  readonly seeds: number;
  readonly underuse: number;
  readonly out: string;
}

/** The usage shown for `pnpm content coverage --help`. */
const COVERAGE_USAGE = `Usage: pnpm content coverage [options]

Options:
  --packs a,b           pack ids to load (default: every pack found under --dirs)
  --dirs path[,path]    pack directories (or parents of them) to search (default: ${DEFAULT_PACK_DIR})
  --cities a,b          cities to cover (default: every City Pack loaded, else the Core City)
  --presets a,b         Difficulty Presets to cover (default: ${DEFAULT_PRESET})
  --seeds <n>           worlds per city/preset (default: ${DEFAULT_SEEDS})
  --underuse <f>        underuse fraction, below f × expected is flagged (default: ${DEFAULT_UNDERUSE})
  --out <dir>           directory for coverage.md and coverage.csv (default: current dir)
  --help                show this help`;

/** Parse the `coverage` argv, or `'help'`. Throws on a bad or missing option. */
function parseArgs(argv: readonly string[]): ParsedArgs | 'help' {
  let dirs: string[] = [DEFAULT_PACK_DIR];
  let selected: string[] = [];
  let cities: string[] = [];
  let presets: string[] = [DEFAULT_PRESET];
  let seeds = DEFAULT_SEEDS;
  let underuse = DEFAULT_UNDERUSE;
  let out = '.';

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const takeValue = (): string => {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new Error(`content coverage: ${arg} needs a value`);
      }
      i += 1;
      return value;
    };
    switch (arg) {
      case '--help':
      case '-h':
        return 'help';
      case '--packs':
        selected = splitList(takeValue());
        break;
      case '--dirs':
        dirs = splitList(takeValue());
        break;
      case '--cities':
        cities = splitList(takeValue());
        break;
      case '--presets':
        presets = splitList(takeValue());
        break;
      case '--seeds': {
        const value = Number(takeValue());
        if (!Number.isInteger(value) || value < 1) {
          throw new Error('content coverage: --seeds must be a positive integer');
        }
        seeds = value;
        break;
      }
      case '--underuse': {
        const value = Number(takeValue());
        if (!Number.isFinite(value) || value < 0) {
          throw new Error('content coverage: --underuse must be a non-negative number');
        }
        underuse = value;
        break;
      }
      case '--out':
        out = takeValue();
        break;
      default:
        throw new Error(`content coverage: unknown option "${arg}"`);
    }
  }

  return { dirs, selected, cities, presets, seeds, underuse, out };
}

/** Split a comma-separated list flag, trimming blanks. */
function splitList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Whether a directory holds a `pack.yaml` (and so is itself a pack directory). */
function isPackDir(dir: string): boolean {
  try {
    return statSync(join(dir, 'pack.yaml')).isFile();
  } catch {
    return false;
  }
}

/**
 * Expand each `--dirs` entry to the pack directories the loader reads: the
 * entry itself when it is a pack, else its immediate subdirectories that are
 * packs. This lets `--dirs packages/content/packs` name the parent of the
 * shipped packs while the loader still receives one directory per pack.
 */
function expandPackDirs(dirs: readonly string[]): string[] {
  const out: string[] = [];
  for (const dir of dirs) {
    if (isPackDir(dir)) {
      out.push(dir);
      continue;
    }
    let entries: string[];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = join(dir, name);
      if (isPackDir(full)) {
        out.push(full);
      }
    }
  }
  return out;
}

/** The effective Content Kind Registry: slice kinds plus this spec's kinds. */
function effectiveRegistry(): ContentKindRegistration[] {
  const byKind = new Map<string, ContentKindRegistration>();
  for (const reg of [...SLICE_KIND_REGISTRATIONS, ...CONTENT_EXPANSION_KIND_REGISTRATIONS]) {
    if (!byKind.has(reg.kind)) {
      byKind.set(reg.kind, reg);
    }
  }
  return [...byKind.values()];
}

/** Resolve a preset id against a loaded Content Set (bare id or namespaced). */
function presetResolver(set: ContentSet): (id: string) => DifficultyPreset {
  return (id) => {
    for (const [key, value] of set.difficultyPresets) {
      if (key === id || key.endsWith(`/${id}`)) {
        return value;
      }
    }
    throw new Error(`content coverage: no Difficulty Preset "${id}"`);
  };
}

/**
 * The Core City pack data (`city.yaml`, `descriptors.yaml`, public texts) every
 * generation needs for its type, loaded from the core pack directory. On the
 * Core City Path the generator reads this geometry directly; on a City-Pack
 * path it instantiates the authored city instead and this data is unused but
 * still required to satisfy {@link GenerateInputs}. This mirrors how the engine
 * specs build inputs for both paths from the core pack.
 */
interface CoreCityData {
  readonly cityData: CityData;
  readonly descriptors: DescriptorData;
  readonly publicTexts: readonly PublicText[];
}

/** Find the core pack directory among the expanded pack dirs (the `core` pack). */
function findCorePackDir(packDirs: readonly string[]): string | undefined {
  for (const dir of packDirs) {
    if (dir.endsWith(`${'/'}core`) || dir.endsWith('\\core') || dir === 'core') {
      return dir;
    }
  }
  return undefined;
}

/** Load the Core City pack data, throwing a clear error if any side file fails. */
function loadCoreCityData(corePackDir: string): CoreCityData {
  const cityData = loadCityData(corePackDir);
  if (!cityData.ok) {
    throw new Error(`content coverage: core city.yaml failed to load`);
  }
  const descriptors = loadDescriptorData(corePackDir);
  if (!descriptors.ok) {
    throw new Error(`content coverage: core descriptors.yaml failed to load`);
  }
  const publicTexts = loadPublicTexts(corePackDir);
  if (!publicTexts.ok) {
    throw new Error(`content coverage: core public texts failed to load`);
  }
  return {
    cityData: cityData.value,
    descriptors: descriptors.value,
    publicTexts: publicTexts.value,
  };
}

/** A minimal valid scenario config placing the game in `city`, no mole. */
function scenarioFor(city: string): ScenarioConfig {
  return ScenarioConfigSchema.parse({
    difficulty: { preset: 'standard' },
    setting: { city },
    mole: false,
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: {
        trust: 1,
        riskAversion: 1,
        scheduleConflict: 1,
        agendaInterest: 1,
      },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
}

/**
 * The `coverage` subcommand. Loads the pack set and the Core City pack data,
 * runs the Coverage Report over the chosen cities, presets and seeds, and
 * writes `coverage.md` and `coverage.csv` to the output directory. Throws (for
 * the CLI shell to report with a non-zero exit) when loading fails or no city
 * is available to cover.
 */
export function runCoverage(options: CoverageCliOptions): void {
  const parsed = parseArgs(options.argv);
  if (parsed === 'help') {
    process.stdout.write(`${COVERAGE_USAGE}\n`);
    return;
  }

  const packDirs = expandPackDirs(parsed.dirs);
  const loaded = loadContent(packDirs, parsed.selected, { kinds: effectiveRegistry() });
  if (!loaded.ok) {
    const detail = loaded.errors
      .map((e) => `  ${e.pack}/${e.file} ${e.path}: ${e.message}`)
      .join('\n');
    throw new Error(`content coverage: the pack set failed to load:\n${detail}`);
  }
  const set = loaded.value;

  const corePackDir = findCorePackDir(packDirs);
  if (corePackDir === undefined) {
    throw new Error('content coverage: no core pack found among the loaded packs');
  }
  const core = loadCoreCityData(corePackDir);

  // Default cities: every loaded City Pack, else the Core City.
  const loadedCities = isContentSetV2(set) ? Object.keys(set.cities).sort() : [];
  const cities =
    parsed.cities.length > 0
      ? parsed.cities
      : loadedCities.length > 0
        ? loadedCities
        : ['core'];

  const preset = presetResolver(set);
  const deps: CoverageDeps = {
    preset,
    inputsFor: (city, resolvedPreset): GenerateInputs => ({
      content: set,
      preset: resolvedPreset,
      scenario: scenarioFor(city),
      cityData: core.cityData,
      descriptors: core.descriptors,
      publicTexts: core.publicTexts,
    }),
  };

  const report = coverage(
    set,
    cities,
    parsed.presets,
    parsed.seeds,
    { underuse: parsed.underuse, varietyTarget: DEFAULT_VARIETY_TARGET },
    deps,
  );

  mkdirSync(parsed.out, { recursive: true });
  writeFileSync(join(parsed.out, 'coverage.md'), toMarkdown(report), 'utf8');
  writeFileSync(join(parsed.out, 'coverage.csv'), toCsv(report), 'utf8');

  const unused = report.rows.filter((r) => r.flag === 'unused').length;
  const underused = report.rows.filter((r) => r.flag === 'underused').length;
  process.stdout.write(
    `coverage: ${report.rows.length} items, ${unused} unused, ${underused} underused — ` +
      `wrote coverage.md and coverage.csv to ${parsed.out}\n`,
  );
}

/**
 * The `scenario.yaml` loader (Requirements 41.1, 41.2, 41.3).
 *
 * Loading a scenario is three steps that can each fail: parsing the YAML,
 * validating it against {@link ScenarioConfigSchema}, and resolving the
 * difficulty — looking up the named preset in the Content Set, deep-merging the
 * `overrides` on top, and re-validating the merged result against the content
 * package's `DifficultyPresetSchema`. Any failure must stop the game from
 * starting and tell the developer exactly what is wrong and where, so this
 * loader turns a YAML syntax error, every Zod issue, an unknown preset id and
 * an unknown pack id into a flat list of {@link ConfigIssue}s, each carrying the
 * file, the dotted field path and a message (Requirements 41.1, 41.2).
 * {@link formatConfigIssues} renders them as the
 * `<file>: <field path>: <message>` lines the design calls for.
 *
 * This mirrors the `models.yaml` loader in `@tradecraft/llm` deliberately: the
 * two config files are the game's whole startup contract, and reporting them
 * the same way keeps the startup error surface uniform.
 *
 * The loader never throws for a configuration problem; it returns a
 * discriminated result so the caller decides how to surface the failure.
 */

import { readFileSync } from 'node:fs';

import {
  DifficultyPresetSchema,
  type DifficultyPreset,
} from '@tradecraft/content';
import { parse as parseYaml, YAMLParseError } from 'yaml';
import { z } from 'zod';

import {
  ScenarioConfigSchema,
  type ScenarioConfig,
} from './scenario-config.js';

/** A single configuration problem, located to a file and a field path. */
export interface ConfigIssue {
  /** The config file the problem is in, as given to the loader. */
  readonly file: string;
  /**
   * The dotted path to the offending field, for example
   * `difficulty.overrides.doctrine.risk.min` or `packs.load[1]`. Empty for a
   * problem with the document as a whole, such as a YAML syntax error.
   */
  readonly path: string;
  /** A human-readable description of the problem. */
  readonly message: string;
}

/** The outcome of loading a config file: either the value or the issues. */
export type LoadResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ConfigIssue[] };

/**
 * A fully resolved scenario: the validated config as written, plus the
 * concrete {@link DifficultyPreset} produced by merging the overrides onto the
 * named preset. The world generator takes both — the scenario for its knobs and
 * the resolved preset for the difficulty maths.
 */
export interface ResolvedScenario {
  /** The scenario config exactly as validated from the file. */
  readonly scenario: ScenarioConfig;
  /** The named preset deep-merged with overrides and re-validated. */
  readonly preset: DifficultyPreset;
}

/**
 * The facts the loader needs from the Content Set to resolve a scenario: the
 * named difficulty presets available, and the pack ids that exist in the
 * configured directories. Passing these in (rather than a whole `ContentSet`)
 * keeps the loader independent of the content loader and trivially testable,
 * while still letting it report an unknown preset or pack as a field error
 * (design: "An unknown preset or pack id is reported as a field error").
 */
export interface ScenarioResolutionContext {
  /** Named difficulty presets available to select, keyed by preset id. */
  readonly presets: ReadonlyMap<string, DifficultyPreset>;
  /** The pack ids that exist and may be named in `packs.load`. */
  readonly availablePackIds: ReadonlySet<string>;
  /**
   * The City Definitions loaded from the Content Set, keyed by City id, used to
   * validate `setting.city` and the `setting.startDate` window (content-
   * expansion Req 9.1). A scenario may also name the Core City with the special
   * id `core`, which is always valid and never appears here.
   *
   * Optional so a caller that does not load City Packs — the slice's core-only
   * setup — can resolve a `core` setting without supplying anything. When it is
   * omitted (or empty), only `core` is accepted for `setting.city`.
   */
  readonly cities?: ReadonlyMap<string, SettingCity>;
  /**
   * The loaded Era Pack's Period Window, as inclusive calendar years. A
   * `setting.startDate` must fall inside it as well as inside the city's
   * `startDates` window. Optional: with no Era Pack loaded (core-only setup)
   * the era bound is not applied.
   */
  readonly eraPeriod?: { readonly from: number; readonly to: number };
}

/**
 * The facts the resolver needs about one loaded City Definition to validate a
 * `setting.startDate`: the inclusive `YYYY-MM-DD` window the city allows for a
 * Start Date. Mirrors the content package `CityDefinition.startDates` field;
 * passing just this (rather than the whole definition) keeps the config loader
 * independent of the City Pack schema.
 */
export interface SettingCity {
  /** The city's Start Date window, inclusive, as ISO `YYYY-MM-DD` strings. */
  readonly startDates: { readonly from: string; readonly to: string };
}

/**
 * Render a Zod path (a mix of object keys and array indices) as the dotted
 * string used in `ConfigIssue.path`. Numeric indices are shown in brackets so
 * `difficulty.overrides.startingBudget` and an array element `packs.load[1]`
 * both read naturally. Shared in spirit with the models loader.
 */
function formatPath(path: ReadonlyArray<PropertyKey>): string {
  let out = '';
  for (const key of path) {
    if (typeof key === 'number') {
      out += `[${key}]`;
    } else {
      out += out === '' ? String(key) : `.${String(key)}`;
    }
  }
  return out;
}

/** Turn a Zod error into the loader's located-issue list for one file. */
function issuesFromZod(
  file: string,
  error: z.ZodError,
  prefix: ReadonlyArray<PropertyKey> = [],
): ConfigIssue[] {
  return error.issues.map((issue) => ({
    file,
    path: formatPath([...prefix, ...issue.path]),
    message: issue.message,
  }));
}

/**
 * Deep-merge an `overrides` block onto a base preset. Plain objects are merged
 * key by key; everything else (numbers, strings, booleans, arrays) is replaced
 * wholesale, so an override of `allowedCiphers` sets the whole list rather than
 * appending to it. This is the merge the design specifies before re-validation.
 */
function deepMerge(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override;
  }
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    out[key] = key in base ? deepMerge(base[key], value) : value;
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

/**
 * Resolve the difficulty of a validated scenario against the Content Set: look
 * up the named preset, deep-merge the overrides, and re-validate the result
 * against `DifficultyPresetSchema`. Also check that every pack in `packs.load`
 * exists. Returns the resolved preset or the located issues.
 */
function resolveDifficulty(
  scenario: ScenarioConfig,
  context: ScenarioResolutionContext,
  file: string,
): LoadResult<DifficultyPreset> {
  const issues: ConfigIssue[] = [];

  // Unknown pack ids are field errors on their position in `packs.load`.
  scenario.packs.load.forEach((packId, index) => {
    if (!context.availablePackIds.has(packId)) {
      issues.push({
        file,
        path: `packs.load[${index}]`,
        message: `unknown pack "${packId}"`,
      });
    }
  });

  const presetName = scenario.difficulty.preset;
  const base = context.presets.get(presetName);
  if (base === undefined) {
    issues.push({
      file,
      path: 'difficulty.preset',
      message: `unknown difficulty preset "${presetName}"`,
    });
    // Without a base preset there is nothing to merge, so stop here but still
    // report any pack issues collected above.
    return { ok: false, issues };
  }

  const merged = deepMerge(base, scenario.difficulty.overrides);
  const result = DifficultyPresetSchema.safeParse(merged);
  if (!result.success) {
    // Locate the re-validation issues under `difficulty.overrides` so the
    // developer sees the field that made the merged preset invalid.
    issues.push(
      ...issuesFromZod(file, result.error, ['difficulty', 'overrides']),
    );
    return { ok: false, issues };
  }

  // The merged preset is valid; surface any pack issues collected above, else
  // return the resolved preset.
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, value: result.data };
}

/**
 * Check the setting selection against the Content Set (content-expansion Req
 * 9.1). Two field-located checks run after schema validation:
 *
 * - `setting.city` must be `core` (the Core City, always valid) or a City id
 *   the Content Set loaded. An unknown city is a field error on `setting.city`.
 * - `setting.startDate`, when given, must fall inside the chosen city's
 *   `startDates` window and inside the Era Pack's Period Window. Each failure
 *   is a field error on `setting.startDate`.
 *
 * ISO `YYYY-MM-DD` strings compare correctly with `<`/`>`, so the window check
 * is a plain string comparison; the era check compares the date's year (its
 * first four characters) against the inclusive Period Window. With the Core
 * City selected there is no city window to check, and the start date is still
 * bounded by the era when one is loaded.
 *
 * Returns the located issues (empty when the setting is valid).
 */
function resolveSetting(
  scenario: ScenarioConfig,
  context: ScenarioResolutionContext,
  file: string,
): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const { city, startDate } = scenario.setting;

  // `core` is always valid and never appears in the cities map.
  const isCore = city === 'core';
  const cityDef = isCore ? undefined : context.cities?.get(city);
  if (!isCore && cityDef === undefined) {
    issues.push({
      file,
      path: 'setting.city',
      message: `unknown city "${city}"`,
    });
  }

  if (startDate !== undefined) {
    // The city's Start Date window (only when a known city is selected).
    if (cityDef !== undefined) {
      const { from, to } = cityDef.startDates;
      if (startDate < from || startDate > to) {
        issues.push({
          file,
          path: 'setting.startDate',
          message: `start date "${startDate}" is outside the city's start-date window ${from}..${to}`,
        });
      }
    }

    // The Era Pack's Period Window, by year.
    if (context.eraPeriod !== undefined) {
      const year = Number(startDate.slice(0, 4));
      const { from, to } = context.eraPeriod;
      if (year < from || year > to) {
        issues.push({
          file,
          path: 'setting.startDate',
          message: `start date "${startDate}" is outside the era period window ${from}..${to}`,
        });
      }
    }
  }

  return issues;
}

/**
 * Parse, validate and resolve a `scenario.yaml` document given its text.
 * Separated from disk access so it is trivially testable with an inline string.
 * `file` is used only to label issues.
 */
export function parseScenarioConfig(
  text: string,
  file: string,
  context: ScenarioResolutionContext,
): LoadResult<ResolvedScenario> {
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (err) {
    const message = err instanceof YAMLParseError ? err.message : String(err);
    return { ok: false, issues: [{ file, path: '', message }] };
  }

  const parsed = ScenarioConfigSchema.safeParse(doc);
  if (!parsed.success) {
    return { ok: false, issues: issuesFromZod(file, parsed.error) };
  }

  const settingIssues = resolveSetting(parsed.data, context, file);

  const resolved = resolveDifficulty(parsed.data, context, file);
  if (!resolved.ok) {
    return { ok: false, issues: [...settingIssues, ...resolved.issues] };
  }
  if (settingIssues.length > 0) {
    return { ok: false, issues: settingIssues };
  }

  return {
    ok: true,
    value: { scenario: parsed.data, preset: resolved.value },
  };
}

/**
 * Load, parse, validate and resolve `scenario.yaml` from disk at `path`. A read
 * failure (missing or unreadable file) is reported as a document-level issue so
 * the caller handles it uniformly with parse, validation and resolution
 * failures. `path` is used both to read and to label issues.
 */
export function loadScenarioConfig(
  path: string,
  context: ScenarioResolutionContext,
): LoadResult<ResolvedScenario> {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, issues: [{ file: path, path: '', message }] };
  }
  return parseScenarioConfig(text, path, context);
}

/**
 * Render loaded issues as one `<file>: <field path>: <message>` line each. A
 * document-level issue (empty path) collapses to `<file>: <message>` so the
 * output never shows a dangling separator.
 */
export function formatConfigIssues(issues: readonly ConfigIssue[]): string {
  return issues
    .map((i) =>
      i.path === ''
        ? `${i.file}: ${i.message}`
        : `${i.file}: ${i.path}: ${i.message}`,
    )
    .join('\n');
}

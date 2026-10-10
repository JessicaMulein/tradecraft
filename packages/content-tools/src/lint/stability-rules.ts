/**
 * The quantity, feasibility and stability Lint Rules (content-expansion task
 * 5.4; design, "Pack Linter"; Requirements 11.8, 13.7, 9.9).
 *
 * Unlike the period, style and localisation rules ({@link ./period-rules}),
 * which run per declared field over the {@link FieldHit} stream, these three
 * are whole-set checks that read the loaded Content Set or the parsed packs
 * directly, so they are rule-table `check(ctx)` functions wired into
 * {@link ./rules} rather than {@link GenericFieldRule}s:
 *
 * - **CE-QUANTITY** — the Req 11 Quantity Target table, evaluated per city, per
 *   Culture Group and across the shipped set. A shortfall is a `warning` in the
 *   `draft` profile and an `error` in `release` (the rule-table `releaseSeverity`
 *   carries the escalation; this check reports at the rule's default severity
 *   and the orchestrator pins the profile's effective severity). Req 11.8.
 * - **CE-FEASIBLE** — `instantiateCity` run over 256 fixed seeds at each Period
 *   Window boundary year of every loaded City Pack; any `'infeasible'` result
 *   is an error naming the city, the year and the seed (design, "City
 *   instantiation": "runs `instantiateCity` over 256 fixed seeds at each Period
 *   Window boundary year"; Req 9.9). The loader-backed CE-FEASIBLE finding and
 *   this one share the rule id.
 * - **CE-IDSTABLE** — against a supplied Baseline Manifest, every content id
 *   present in the baseline and missing from the current pack version, unless
 *   the pack's major version increased (Req 13.7; Property 7).
 *
 * CE-QUANTITY and CE-IDSTABLE read the parsed packs so they still run when the
 * load failed; CE-FEASIBLE needs the assembled City Bundles and merged Tag
 * Vocabulary, so it runs only on a successful load (`ctx.set !== null`), which
 * is the only state in which an instantiation is well-defined.
 */

import {
  createPrng,
  isContentSetV2,
  yearFilter,
  instantiateCity,
  type ContentSetV2,
  type CityBundle,
} from '@tradecraft/engine';
import {
  parseVersion,
  type LocationType,
  type PlotTemplate,
  type SideThreadTemplate,
} from '@tradecraft/content';

import type { LintContext, LintFinding, LintSeverity } from './rules.js';
import { itemsOf, type ParsedPack } from './parsed-files.js';

/**
 * Build a located finding at a fixed severity. The orchestrator pins each
 * finding's severity to the rule's profile-effective severity before
 * reporting, so the severity passed here is only the own-check default (an
 * error for CE-FEASIBLE and CE-IDSTABLE; CE-QUANTITY's default `warning`,
 * escalated to `error` in `release` by the rule table's `releaseSeverity`).
 * This module does not import the rule table, so the lint rule table can
 * reference these checks without a circular import.
 */
function finding(
  ruleId: string,
  pack: string,
  file: string,
  path: string,
  message: string,
  severity: LintSeverity = 'error',
): LintFinding {
  return { rule: ruleId, severity, pack, file, path, message };
}

/**
 * Whether a pack-relative path belongs to a kind written under `dir`: the
 * `<dir>.yaml`/`<dir>.yml` file or any `.yaml`/`.yml` beneath `<dir>/`. Mirrors
 * the loader's `fileOrDir`.
 */
function fileMatchesKind(relPath: string, dir: string): boolean {
  return (
    relPath === `${dir}.yaml` ||
    relPath === `${dir}.yml` ||
    relPath.startsWith(`${dir}/`)
  );
}

/** The effective role of a pack, from its parsed `pack.yaml` manifest. */
function packRole(pack: ParsedPack): string | undefined {
  for (const file of pack.files) {
    if (file.relPath !== 'pack.yaml' && file.relPath !== 'pack.yml') {
      continue;
    }
    const manifest = file.content;
    if (typeof manifest === 'object' && manifest !== null && !Array.isArray(manifest)) {
      const record = manifest as Record<string, unknown>;
      if (typeof record.role === 'string') {
        return record.role;
      }
      // A schema-1 pack with no role is `core` (task 1.1); for quantity-target
      // purposes a role-less pack is not a City, Era or Library pack.
      return 'core';
    }
  }
  return undefined;
}

/** Count every item of every file of a kind in one pack. */
function countKind(pack: ParsedPack, dir: string): number {
  let count = 0;
  for (const file of pack.files) {
    if (file.parsed && fileMatchesKind(file.relPath, dir)) {
      count += itemsOf(file.content).items.length;
    }
  }
  return count;
}

/** The `pack.yaml` location of a pack, for a per-pack finding. */
function manifestFile(pack: ParsedPack): string {
  return pack.files.some((f) => f.relPath === 'pack.yaml') ? 'pack.yaml' : 'pack.yml';
}

// --- CE-QUANTITY ------------------------------------------------------------

/**
 * One Quantity Target: a human id, the content it counts, the minimum required
 * and the scope it is evaluated over (design, "Quantity Targets"). The targets
 * are a data table keyed by id, drawn from Requirement 11's acceptance criteria.
 */
interface QuantityTarget {
  readonly id: string;
  readonly description: string;
  readonly min: number;
}

/** The per-City-Pack Quantity Targets (Req 11.2, 11.3). */
const CITY_TARGETS: readonly (QuantityTarget & { count(pack: ParsedPack): number })[] = [
  { id: 'city-locations', description: 'Locations', min: 25, count: (p) => countKind(p, 'locations') },
  { id: 'city-districts', description: 'Districts', min: 6, count: (p) => countKind(p, 'districts') },
  { id: 'city-newspapers', description: 'newspapers', min: 3, count: (p) => countKind(p, 'newspapers') },
  { id: 'city-local-orgs', description: 'local organisations', min: 4, count: (p) => countKind(p, 'local-orgs') },
  { id: 'city-covers', description: 'local Cover Identities', min: 6, count: (p) => countKind(p, 'cover-identities') },
  { id: 'city-streets', description: 'street names', min: 60, count: countStreets },
  { id: 'city-variants', description: 'Template Variants', min: 30, count: (p) => countKind(p, 'template-variants') },
  { id: 'city-culture-weights', description: 'Culture Groups in the Culture Weights', min: 3, count: countCultureWeights },
];

/** The per-Era-Pack Quantity Targets (Req 11.7). */
const ERA_TARGETS: readonly (QuantityTarget & { count(pack: ParsedPack): number })[] = [
  { id: 'era-technology', description: 'technology items', min: 60, count: (p) => countKind(p, 'technology') },
  { id: 'era-anachronisms', description: 'Anachronism Entries', min: 200, count: (p) => countKind(p, 'anachronisms') },
  { id: 'era-public-texts', description: 'public texts', min: 6, count: (p) => countKind(p, 'public-texts') },
];

/** Sum a City Pack's `streets` name pools into a street-name count (Req 11.2). */
function countStreets(pack: ParsedPack): number {
  let count = 0;
  for (const file of pack.files) {
    if (!file.parsed || !fileMatchesKind(file.relPath, 'streets')) {
      continue;
    }
    for (const item of itemsOf(file.content).items) {
      const names = (item as Record<string, unknown> | null)?.names;
      if (Array.isArray(names)) {
        count += names.length;
      }
    }
  }
  return count;
}

/** The number of Culture Groups a City Pack weights in its `city.yaml` (Req 11.2). */
function countCultureWeights(pack: ParsedPack): number {
  for (const file of pack.files) {
    if (file.relPath !== 'city.yaml' && file.relPath !== 'city.yml') {
      continue;
    }
    const weights = (file.content as Record<string, unknown> | null)?.cultureWeights;
    if (Array.isArray(weights)) {
      return weights.length;
    }
  }
  return 0;
}

/** The distinct-name count of a Culture Group, split into given and family. */
function cultureGroupCounts(group: Record<string, unknown>): {
  given: number;
  family: number;
  total: number;
} {
  const given = group.given;
  let givenCount = 0;
  if (typeof given === 'object' && given !== null) {
    for (const gender of ['f', 'm'] as const) {
      const list = (given as Record<string, unknown>)[gender];
      if (Array.isArray(list)) {
        givenCount += list.length;
      }
    }
  }
  const family = Array.isArray(group.family) ? group.family.length : 0;
  return { given: givenCount, family, total: givenCount + family };
}

/**
 * CE-QUANTITY — the Req 11 Quantity Target table (Req 11.8). Each per-city
 * target is evaluated over every City Pack, each per-era target over the Era
 * Pack, the Culture-Group targets over every `culture-group` item, and the
 * shipped-set targets (civilian archetypes, persona backgrounds, Descriptor
 * Fragments) across the Library Packs. A shortfall names the target, the
 * required count and the actual count (Req 11.8); the orchestrator pins its
 * severity to the profile (warning in `draft`, error in `release`).
 */
export function quantityCheck(ctx: LintContext): LintFinding[] {
  const findings: LintFinding[] = [];

  // Across-set tallies for the Library and shipped-set targets.
  let civilianArchetypes = 0;
  let personaBackgrounds = 0;
  let descriptorFragments = 0;

  for (const pack of ctx.packs) {
    const role = packRole(pack);
    const where = manifestFile(pack);

    if (role === 'city') {
      for (const target of CITY_TARGETS) {
        const actual = target.count(pack);
        if (actual < target.min) {
          findings.push(
            finding(
              'CE-QUANTITY',
              pack.id,
              where,
              'items',
              `${target.id}: ${target.description} shortfall — require ${target.min}, found ${actual}`,
            ),
          );
        }
      }
    }

    if (role === 'era') {
      for (const target of ERA_TARGETS) {
        const actual = target.count(pack);
        if (actual < target.min) {
          findings.push(
            finding(
              'CE-QUANTITY',
              pack.id,
              where,
              'items',
              `${target.id}: ${target.description} shortfall — require ${target.min}, found ${actual}`,
            ),
          );
        }
      }
    }

    if (role === 'library') {
      civilianArchetypes += countCivilianArchetypes(pack);
      personaBackgrounds += countPersonaBackgrounds(pack);
      descriptorFragments += countKind(pack, 'descriptor-fragments');
      findings.push(...cultureGroupFindings(pack));
    }
  }

  // Shipped-set Library targets (Req 11.5, 11.6). Reported once, on the first
  // Library Pack, so the finding is deterministic and attributable.
  const libraryPack = ctx.packs.find((p) => packRole(p) === 'library');
  if (libraryPack !== undefined) {
    const where = manifestFile(libraryPack);
    const setTargets: readonly [string, string, number, number][] = [
      ['set-civilian-archetypes', 'civilian archetypes', 40, civilianArchetypes],
      ['set-persona-backgrounds', 'persona backgrounds', 200, personaBackgrounds],
      ['set-descriptor-fragments', 'Descriptor Fragments', 150, descriptorFragments],
    ];
    for (const [id, description, min, actual] of setTargets) {
      if (actual < min) {
        findings.push(
          finding(
            'CE-QUANTITY',
            libraryPack.id,
            where,
            'items',
            `${id}: ${description} shortfall — require ${min}, found ${actual}`,
          ),
        );
      }
    }
  }

  for (const pack of ctx.packs) {
    const graphs = countKind(pack, 'graphs');
    if (graphs < 1) continue;
    const where = manifestFile(pack);
    const streetTargets: readonly [string, string, number, number][] = [
      ['street-vehicles', 'vehicles', 6, countKind(pack, 'vehicles')],
      ['street-maneuvers', 'evasion maneuvers', 8, countKind(pack, 'maneuvers')],
      ['street-tails', 'tail profiles', 3, countKind(pack, 'tails')],
      ['street-stories', 'story templates', 10, countKind(pack, 'street-stories')],
      ['street-checkpoints', 'checkpoint kinds', 1, countKind(pack, 'checkpoints')],
    ];
    for (const [id, description, min, actual] of streetTargets) {
      if (actual < min) {
        findings.push(
          finding(
            'CE-QUANTITY',
            pack.id,
            where,
            'items',
            `${id}: ${description} shortfall — require ${min}, found ${actual}`,
          ),
        );
      }
    }
  }

  return findings;
}

/** Count the `civilian`-role archetypes a Library Pack defines (Req 11.5). */
function countCivilianArchetypes(pack: ParsedPack): number {
  let count = 0;
  for (const file of pack.files) {
    if (!file.parsed || !fileMatchesKind(file.relPath, 'archetypes')) {
      continue;
    }
    for (const item of itemsOf(file.content).items) {
      if ((item as Record<string, unknown> | null)?.role === 'civilian') {
        count += 1;
      }
    }
  }
  return count;
}

/** Count the persona backgrounds across a Library Pack's Culture Groups (Req 11.6). */
function countPersonaBackgrounds(pack: ParsedPack): number {
  let count = 0;
  for (const file of pack.files) {
    if (!file.parsed || !fileMatchesKind(file.relPath, 'culture-groups')) {
      continue;
    }
    for (const item of itemsOf(file.content).items) {
      const backgrounds = (item as Record<string, unknown> | null)?.backgrounds;
      if (Array.isArray(backgrounds)) {
        count += backgrounds.length;
      }
    }
  }
  return count;
}

/** The per-Culture-Group name-count shortfalls of a Library Pack (Req 11.4). */
function cultureGroupFindings(pack: ParsedPack): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const file of pack.files) {
    if (!file.parsed || !fileMatchesKind(file.relPath, 'culture-groups')) {
      continue;
    }
    const { items, pathAt } = itemsOf(file.content);
    items.forEach((item, index) => {
      if (typeof item !== 'object' || item === null) {
        return;
      }
      const record = item as Record<string, unknown>;
      const { given, family, total } = cultureGroupCounts(record);
      const id = typeof record.id === 'string' ? record.id : `[${index}]`;
      const path = pathAt(index);
      const checks: readonly [string, string, number, number][] = [
        ['culture-names', 'distinct names', 300, total],
        ['culture-given', 'given names', 100, given],
        ['culture-family', 'family names', 100, family],
      ];
      for (const [targetId, description, min, actual] of checks) {
        if (actual < min) {
          findings.push(
            finding(
              'CE-QUANTITY',
              pack.id,
              file.relPath,
              path,
              `${targetId}: Culture Group "${id}" ${description} shortfall — require ${min}, found ${actual}`,
            ),
          );
        }
      }
    });
  }
  return findings;
}

// --- CE-FEASIBLE ------------------------------------------------------------

/** The number of fixed seeds CE-FEASIBLE instantiates at each boundary year. */
export const FEASIBLE_SEED_COUNT = 256;

/** The fixed seed for the i-th instantiation of a city at a boundary year. */
function feasibleSeed(cityId: string, year: number, i: number): string {
  return `feasible-${cityId}-${year}-${i}`;
}

/**
 * The Period Window boundary years CE-FEASIBLE instantiates at: the first and
 * last Game Year the city is playable, i.e. its own Period Window intersected
 * with the era Period Window. The two boundaries coincide for a one-year city,
 * so they are de-duplicated.
 */
function boundaryYears(cityPeriod: { from: number; to: number }, era?: { from: number; to: number }): number[] {
  const from = era === undefined ? cityPeriod.from : Math.max(cityPeriod.from, era.from);
  const to = era === undefined ? cityPeriod.to : Math.min(cityPeriod.to, era.to);
  if (from > to) {
    return [];
  }
  return from === to ? [from] : [from, to];
}

/**
 * CE-FEASIBLE — run `instantiateCity` over 256 fixed seeds at each Period
 * Window boundary year of every loaded City Pack, reporting any infeasibility
 * (design, "City instantiation"; Req 9.9). The bundle is year-filtered to the
 * boundary year through the engine's `yearFilter` — exactly as the generator
 * does — so only in-period Districts, Locations and Routes reach the
 * instantiation, and the merged Tag Vocabulary drives the Required-Query
 * Binder draw. A single infeasible seed fails the whole city, so the first
 * infeasible (city, year, seed) is reported and that boundary stops.
 *
 * This check needs the assembled City Bundles and vocabulary, so it runs only
 * on a successful load. On a failed load the loader-backed CE-FEASIBLE findings
 * (mapped from the loader's own instantiation errors) still report under the
 * same rule id.
 */
export function feasibleCheck(ctx: LintContext): LintFinding[] {
  const set = ctx.set;
  if (set === null || !isContentSetV2(set)) {
    return [];
  }
  const v2: ContentSetV2 = set;
  const findings: LintFinding[] = [];

  for (const [cityId, bundle] of Object.entries(v2.cities)) {
    const where = `${cityId} (city instantiation)`;
    for (const year of boundaryYears(bundle.def.period, v2.era?.period)) {
      const filtered = yearFilter(v2, year, cityId);
      const filteredBundle = filtered.cities[cityId];
      if (filteredBundle === undefined) {
        continue;
      }
      let reported = false;
      for (let i = 0; i < FEASIBLE_SEED_COUNT && !reported; i += 1) {
        const rng = createPrng(feasibleSeed(cityId, year, i));
        const result = instantiateCity(filteredBundle, year, filtered.tagVocabulary, rng);
        if (result === 'infeasible') {
          findings.push(
            finding(
              'CE-FEASIBLE',
              cityPackOf(ctx, cityId) ?? cityId,
              where,
              `year ${year}`,
              `instantiateCity is infeasible for city "${cityId}" at year ${year}, seed "${feasibleSeed(cityId, year, i)}"`,
            ),
          );
          reported = true;
        }
      }
    }
  }
  return findings;
}

/** The pack id that defines a City id (`<pack>/<name>` → the parsed pack). */
function cityPackOf(ctx: LintContext, cityId: string): string | undefined {
  const packId = cityId.split('/')[0];
  return ctx.packs.find((p) => p.id === packId)?.id;
}

// --- CE-IDSTABLE ------------------------------------------------------------

/**
 * CE-IDSTABLE — against a supplied Baseline Manifest, every content id present
 * in the baseline and missing from the current pack version, unless the pack's
 * major version increased (Req 13.7; Property 7). The current ids come from the
 * loaded Content Manifest and the content registries; the baseline carries the
 * ids each pack held and the version it was taken at.
 *
 * For every pack in the baseline: if the current pack's major version is
 * greater than the baseline's, every id removal is allowed (a major bump may
 * break ids), so the pack contributes no findings. Otherwise every baseline id
 * absent from the pack's current ids is an error. A pack present in the
 * baseline but absent now has all its ids removed, which is reported (the pack
 * was dropped without a major bump).
 */
export function idStableCheck(ctx: LintContext): LintFinding[] {
  const baseline = ctx.baseline;
  if (baseline === undefined || ctx.set === null) {
    return [];
  }
  const findings: LintFinding[] = [];
  const currentIds = currentIdsByPack(ctx);
  const currentVersions = new Map(
    ctx.set.manifest.packs.map((p) => [p.id, p.version]),
  );
  const baselineVersions = new Map(
    baseline.manifest.packs.map((p) => [p.id, p.version]),
  );

  for (const [packId, ids] of Object.entries(baseline.ids)) {
    if (majorIncreased(baselineVersions.get(packId), currentVersions.get(packId))) {
      continue;
    }
    const present = currentIds.get(packId) ?? new Set<string>();
    for (const id of ids) {
      if (!present.has(id)) {
        findings.push(
          finding(
            'CE-IDSTABLE',
            packId,
            'pack.yaml',
            `ids/${id}`,
            `content id "${id}" was present in the baseline and is missing now (pack major version unchanged)`,
          ),
        );
      }
    }
  }
  return findings;
}

/** Whether the current major version is strictly greater than the baseline's. */
function majorIncreased(baseVersion: string | undefined, currentVersion: string | undefined): boolean {
  if (baseVersion === undefined || currentVersion === undefined) {
    return false;
  }
  const base = parseVersion(baseVersion);
  const current = parseVersion(currentVersion);
  if (base === null || current === null) {
    return false;
  }
  return current.major > base.major;
}

/**
 * The current content ids each pack holds, grouped by pack id. Every content
 * registry on the Content Set keys its items by namespaced id (`<pack>/<id>`);
 * CE-IDSTABLE compares against the baseline's per-pack bare id lists, so the
 * namespace prefix is split off and the bare id grouped under its pack.
 */
function currentIdsByPack(ctx: LintContext): Map<string, Set<string>> {
  const byPack = new Map<string, Set<string>>();
  const set = ctx.set;
  if (set === null) {
    return byPack;
  }
  const add = (namespacedId: string): void => {
    const slash = namespacedId.indexOf('/');
    if (slash <= 0) {
      return;
    }
    const packId = namespacedId.slice(0, slash);
    const bareId = namespacedId.slice(slash + 1);
    let bucket = byPack.get(packId);
    if (bucket === undefined) {
      bucket = new Set<string>();
      byPack.set(packId, bucket);
    }
    bucket.add(bareId);
  };

  for (const registry of idRegistriesOf(set)) {
    for (const id of registry.keys()) {
      add(id);
    }
  }
  // City-Scoped ids are keyed in `cityScopeOwner` (every City Pack item), and
  // the city bundles' own records carry ids the registries above do not hold.
  for (const id of Object.keys(set.cityScopeOwner)) {
    add(id);
  }
  return byPack;
}

/** Every id-keyed content registry on the Content Set. */
function idRegistriesOf(set: NonNullable<LintContext['set']>): ReadonlyMap<string, unknown>[] {
  return [
    set.archetypes,
    set.locationTypes,
    set.plotTemplates,
    set.sideThreadTemplates,
    set.documentTemplates,
    set.personaLibraries,
    set.coverIdentities,
    set.rumourTemplates,
    set.hints,
    set.difficultyPresets,
    set.services,
    set.templateVariantDefs,
  ];
}


// --- CE-PLOTBIND ------------------------------------------------------------

/**
 * CE-PLOTBIND — every Tag-Query (or Location-Type) place a loaded Plot or Side
 * Thread template names must have a **public, in-period Binder** in each loaded
 * City Pack (content-expansion follow-up: plot trace binding by Tag Query).
 *
 * ## Why this rule exists
 *
 * A plot trace's `place` is the observable event the discovery gate's **signal
 * route** turns on: the player learns a key fact by *surveilling a known
 * Location* the trace binds to. Only a **public** Location is known from the
 * Starting Brief (slice Req 21.8), so a signal route is earned only when the
 * trace binds to a public Location. If a city tags no public Location for a
 * plot's `place.query` (or stamps no public Location of its `place.locationType`),
 * the generator cannot place that trace surveillably and `generate()` throws a
 * `GeneratorError` at runtime for some seed — the exact trap option A removed
 * for Tag Queries, and that CE-FEASIBLE does not catch (it instantiates the
 * city geometry but does not check plot signal-route solvability).
 *
 * This rule is the authoring half of that guarantee: it reads the loaded plot
 * and side-thread templates' `place` forms and, for every loaded City Pack,
 * statically checks each one binds a public in-period Location by Effective
 * Tags (own Tags together with the Location Type's Tags) — the same Binder rule
 * Tag Conformance and the schedule binder use. A shortfall is an error (the
 * rule is non-suppressible, like CE-FEASIBLE), so an uninstantiable-for-plots
 * city is a build-time failure rather than a runtime one.
 */
export function plotBindCheck(ctx: LintContext): LintFinding[] {
  const set = ctx.set;
  if (set === null || !isContentSetV2(set)) {
    return [];
  }
  const v2: ContentSetV2 = set;

  // Every distinct place requirement a loaded Plot/Side Thread template names,
  // de-duplicated so a query used by many traces is checked (and reported) once
  // per city. A `target` place binds to a slot entity, not a Location, so it is
  // skipped here.
  const requirements = collectPlaceRequirements(v2);
  if (requirements.length === 0) {
    return [];
  }

  const findings: LintFinding[] = [];
  for (const [cityId, bundle] of Object.entries(v2.cities)) {
    const typeTags = locationTypeTagIndex(v2, bundle);
    const period = bundle.def.period;
    const where = `${cityId} (plot binding)`;
    const packId = cityPackOf(ctx, cityId) ?? cityId;

    for (const req of requirements) {
      if (!someCityPublicBinder(bundle, typeTags, period, req)) {
        findings.push(
          finding(
            'CE-PLOTBIND',
            packId,
            where,
            req.path,
            `city "${cityId}" binds no public Location for ${describePlace(req)} ` +
              `named by ${req.owner} — a plot signal route cannot be surveilled there`,
          ),
        );
      }
    }
  }
  return findings;
}

/** A place a plot/side-thread trace requires a city to bind. */
interface PlaceRequirement {
  /** A Tag Query (all Tags must be in the Location's Effective Tags). */
  readonly query?: readonly string[];
  /** A bare Location Type id the Location must be stamped from. */
  readonly locationType?: string;
  /** The template id that owns the trace, for the message. */
  readonly owner: string;
  /** A stable report path identifying the requirement across cities. */
  readonly path: string;
}

/** The template-authored place requirements, de-duplicated by their content. */
function collectPlaceRequirements(set: ContentSetV2): PlaceRequirement[] {
  const byKey = new Map<string, PlaceRequirement>();

  const walk = (
    templates: ReadonlyMap<string, PlotTemplate | SideThreadTemplate>,
  ): void => {
    for (const [id, template] of templates) {
      template.stages.forEach((stage, sgi) => {
        stage.traces.forEach((trace, ti) => {
          const place = trace.place;
          if (place === undefined || 'target' in place) {
            return;
          }
          const path = `${id}.stages[${sgi}].traces[${ti}].place`;
          if ('query' in place) {
            const query = [...place.query].sort();
            const key = `q:${query.join(',')}`;
            if (!byKey.has(key)) {
              byKey.set(key, { query: place.query, owner: id, path });
            }
          } else {
            const bare = bareId(place.locationType);
            const key = `t:${bare}`;
            if (!byKey.has(key)) {
              byKey.set(key, { locationType: bare, owner: id, path });
            }
          }
        });
      });
    }
  };

  walk(set.plotTemplates as ReadonlyMap<string, PlotTemplate>);
  walk(set.sideThreadTemplates as ReadonlyMap<string, SideThreadTemplate>);

  return [...byKey.values()];
}

/**
 * The Location-Type → Tags index for a city, keyed by both namespaced and bare
 * id (a City Location's `type` is a bare id, the registries are namespaced).
 * Reads the global Location Types and the city bundle's own types, so a
 * city-specific type resolves too.
 */
function locationTypeTagIndex(
  set: ContentSetV2,
  bundle: CityBundle,
): Map<string, readonly string[]> {
  const out = new Map<string, readonly string[]>();
  const add = (id: string, tags: readonly string[]): void => {
    out.set(id, tags);
    const slash = id.indexOf('/');
    if (slash !== -1) {
      out.set(id.slice(slash + 1), tags);
    }
  };
  for (const [id, type] of set.locationTypes) {
    add(id, (type as LocationType).tags);
  }
  for (const type of bundle.locationTypes) {
    add(type.id, type.tags);
  }
  return out;
}

/**
 * True when the city has at least one public, in-period Location that satisfies
 * the requirement: for a Tag Query, a Location whose Effective Tags contain
 * every query Tag; for a Location Type, a Location stamped from that bare type.
 */
function someCityPublicBinder(
  bundle: CityBundle,
  typeTags: ReadonlyMap<string, readonly string[]>,
  period: { readonly from: number; readonly to: number },
  req: PlaceRequirement,
): boolean {
  for (const loc of bundle.locations) {
    if (!loc.public) {
      continue;
    }
    if (loc.years !== undefined && !(loc.years.from <= period.to && period.from <= loc.years.to)) {
      continue;
    }
    if (req.locationType !== undefined) {
      if (bareId(loc.type) === req.locationType) {
        return true;
      }
      continue;
    }
    const effective = new Set<string>(loc.tags);
    for (const tag of typeTags.get(loc.type) ?? []) {
      effective.add(tag);
    }
    if ((req.query ?? []).every((tag) => effective.has(tag))) {
      return true;
    }
  }
  return false;
}

/** A human description of the place requirement, for the finding message. */
function describePlace(req: PlaceRequirement): string {
  if (req.query !== undefined) {
    return `the Tag Query [${req.query.join(', ')}]`;
  }
  return `a Location of type "${req.locationType}"`;
}

/** The bare local id of a (possibly namespaced) id. */
function bareId(id: string): string {
  const slash = id.lastIndexOf('/');
  return slash === -1 ? id : id.slice(slash + 1);
}

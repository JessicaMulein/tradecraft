/**
 * The period, style and localisation Lint Rules (content-expansion task 5.4;
 * design, "Pack Linter"; Requirements 12.2, 12.3, 12.6, 13.2).
 *
 * Task 5.2 built the framework, task 5.3 added the reference, identity and
 * text-safety rules. This module adds the four *generic* Field-Declaration
 * rules of task 5.4 that run over the {@link FieldHit} stream and the parsed
 * packs (the quantity, feasibility and stability rules of this task are
 * whole-set checks, not per-field, and live in {@link ./stability-rules}):
 *
 * - **CE-ANACH** — a text field matching an Anachronism Entry whose earliest
 *   year is after the start of the item's Effective Year Range (within the
 *   entry's city scope), and a content item naming a technology catalogue item
 *   introduced after the start of the item's Effective Year Range (Req 12.2,
 *   12.3; design, "Effective Year Range").
 * - **CE-PERIOD** — a Year Range field whose range lies outside the item's
 *   city or era Period Window.
 * - **CE-STYLE** — the mechanically-checked Style Guide rules over the template
 *   and Fact-Line surfaces the rules apply to; `manual` rules are listed as
 *   `info` reminders and never fail (Req 12.6).
 * - **CE-ALLOWLIST** — a Locale `allowNames` entry equal to a distinctive alias
 *   of a registered entity (design: "the allowlist cannot hide an entity name
 *   from the guards' intent").
 *
 * Every text comparison reuses the task 5.3 folding tokeniser and the
 * contiguous whole-word matcher, so CE-ANACH matches a term exactly as the
 * design's "Text scanning" and Property 6 require: a whole-word, case- and
 * diacritic-insensitive token sequence outside template slots.
 *
 * These rules read the Anachronism Entries, technology catalogue, Style Guide,
 * Period Windows and entity aliases from the *parsed packs* rather than the
 * loaded Content Set, so they still run when loading failed (Req 13.1), exactly
 * as the task 5.3 rules read the blocklist and Sensitivity Term List.
 */

import type { LintFinding, LintSeverity } from './rules.js';
import { RULES_BY_ID } from './rules.js';
import { itemsOf, type ParsedPack } from './parsed-files.js';
import type { FieldHit, GenericFieldRule } from './generic-rules.js';
import { tokenise, containsSequence } from './concrete-rules.js';

// --- shared period primitives ----------------------------------------------

/** An inclusive year range `[from, to]`. */
interface Range {
  readonly from: number;
  readonly to: number;
}

/** A located finding at a rule's default severity, read from the rule table. */
function severityOf(ruleId: string): LintSeverity {
  return RULES_BY_ID.get(ruleId)?.severity ?? 'error';
}

/** Build a located finding for a rule. */
function finding(
  ruleId: string,
  pack: string,
  file: string,
  path: string,
  message: string,
  severity: LintSeverity = severityOf(ruleId),
): LintFinding {
  return { rule: ruleId, severity, pack, file, path, message };
}

/** Whether `value` is a `{ from, to }` numeric year range. */
function asRange(value: unknown): Range | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.from === 'number' && typeof record.to === 'number') {
    return { from: record.from, to: record.to };
  }
  return undefined;
}

/** The intersection of two ranges, or `undefined` when they do not overlap. */
function intersect(a: Range | undefined, b: Range | undefined): Range | undefined {
  if (a === undefined) {
    return b;
  }
  if (b === undefined) {
    return a;
  }
  const from = Math.max(a.from, b.from);
  const to = Math.min(a.to, b.to);
  return from <= to ? { from, to } : undefined;
}

// --- the pack period index --------------------------------------------------

/**
 * Whether a pack-relative path belongs to a kind written under `dir`: the
 * `<dir>.yaml`/`<dir>.yml` file or any `.yaml`/`.yml` beneath `<dir>/`. Mirrors
 * the loader's `fileOrDir`, kept local like the task 5.3 rules.
 */
function fileMatchesKind(relPath: string, dir: string): boolean {
  return (
    relPath === `${dir}.yaml` ||
    relPath === `${dir}.yml` ||
    relPath.startsWith(`${dir}/`)
  );
}

/** The namespaced City id a City Pack defines, from its `city.yaml`. */
function cityIdOf(pack: ParsedPack): string | undefined {
  for (const file of pack.files) {
    if (file.relPath !== 'city.yaml' && file.relPath !== 'city.yml') {
      continue;
    }
    const def = file.content;
    if (typeof def === 'object' && def !== null && !Array.isArray(def)) {
      const id = (def as Record<string, unknown>).id;
      if (typeof id === 'string' && id.length > 0) {
        return `${pack.id}/${id}`;
      }
    }
  }
  return undefined;
}

/** The city Period Window a City Pack defines, from its `city.yaml` `period`. */
function cityPeriodOf(pack: ParsedPack): Range | undefined {
  for (const file of pack.files) {
    if (file.relPath !== 'city.yaml' && file.relPath !== 'city.yml') {
      continue;
    }
    const def = file.content;
    if (typeof def === 'object' && def !== null && !Array.isArray(def)) {
      return asRange((def as Record<string, unknown>).period);
    }
  }
  return undefined;
}

/**
 * The Period Windows the period rules read, resolved from the parsed packs:
 * the single era Period Window (from any `era` file), each City Pack's own
 * City id and Period Window, and the reverse map from pack id to its City id.
 * A City-Scoped item's city scope is the City id of the pack that defines it,
 * so a text field is tested against the Anachronism Entries scoped to that city.
 */
interface PeriodIndex {
  readonly era?: Range;
  /** City id → that city's own Period Window. */
  readonly cityPeriod: ReadonlyMap<string, Range>;
  /** Pack id → the City id the pack defines (if it is a City Pack). */
  readonly packCity: ReadonlyMap<string, string>;
}

/** Read the single era Period Window from any pack's `era` file. */
function eraPeriodOf(packs: readonly ParsedPack[]): Range | undefined {
  for (const pack of packs) {
    for (const file of pack.files) {
      if (!file.parsed || !fileMatchesKind(file.relPath, 'era')) {
        continue;
      }
      for (const item of itemsOf(file.content).items) {
        const range = asRange((item as Record<string, unknown> | null)?.period);
        if (range !== undefined) {
          return range;
        }
      }
    }
  }
  return undefined;
}

/** Build the {@link PeriodIndex} from the parsed packs. */
function buildPeriodIndex(packs: readonly ParsedPack[]): PeriodIndex {
  const cityPeriod = new Map<string, Range>();
  const packCity = new Map<string, string>();
  for (const pack of packs) {
    const cityId = cityIdOf(pack);
    if (cityId === undefined) {
      continue;
    }
    packCity.set(pack.id, cityId);
    const period = cityPeriodOf(pack);
    if (period !== undefined) {
      cityPeriod.set(cityId, period);
    }
  }
  return { era: eraPeriodOf(packs), cityPeriod, packCity };
}

/**
 * The Effective Year Range of a hit (design, "Effective Year Range"): the
 * item's own `years` ∩ the city Period Window (for a City-Scoped item) ∩ the
 * era Period Window. When the item declares no `years` the Effective Year Range
 * is the applicable Period Window(s); when nothing is in period the range is
 * `undefined` and the period rules fall silent on it (an out-of-period Year
 * Range is CE-PERIOD's concern, not CE-ANACH's).
 *
 * The city of a City-Scoped item is the City id of the pack that defines it,
 * so a hit in a City Pack is bounded by that city's window and scoped to that
 * city for CE-ANACH's city-scope test.
 */
function effectiveRange(
  index: PeriodIndex,
  packId: string,
  itemYears: Range | undefined,
): Range | undefined {
  const cityId = index.packCity.get(packId);
  const cityWindow = cityId === undefined ? undefined : index.cityPeriod.get(cityId);
  return intersect(intersect(itemYears, cityWindow), index.era);
}

/**
 * The item's own `years` for a hit, by reading the item the hit's path points
 * into. The field hit carries a leaf value, not the whole item, so CE-ANACH
 * and CE-PERIOD recover the item's `years` from the parsed packs keyed by the
 * item index embedded in the hit's path (`items[2].…` → the third item).
 */
function itemYearsOf(packs: readonly ParsedPack[], hit: FieldHit): Range | undefined {
  const index = itemIndexOf(hit.path);
  if (index === undefined) {
    return undefined;
  }
  for (const pack of packs) {
    if (pack.id !== hit.pack) {
      continue;
    }
    for (const file of pack.files) {
      if (file.relPath !== hit.file || !file.parsed) {
        continue;
      }
      const item = itemsOf(file.content).items[index];
      if (typeof item === 'object' && item !== null) {
        return asRange((item as Record<string, unknown>).years);
      }
    }
  }
  return undefined;
}

/** The leading item index of a located path (`items[2].…` or `[0].…` → 2, 0). */
function itemIndexOf(path: string): number | undefined {
  const match = /^(?:items)?\[(\d+)\]/.exec(path);
  return match === null ? undefined : Number(match[1]);
}

// --- CE-ANACH ---------------------------------------------------------------

/** One compiled Anachronism Entry: the folded pattern tokens, year and scope. */
interface AnachEntry {
  readonly tokens: string[];
  readonly earliest: number;
  readonly city?: string;
  readonly display: string;
}

/** One compiled technology catalogue surface: a name/alias and its year. */
interface TechSurface {
  readonly tokens: string[];
  readonly introduced: number;
  readonly display: string;
}

/** Whether a pack-relative path is the anachronisms kind. */
function isAnachronismsFile(relPath: string): boolean {
  return fileMatchesKind(relPath, 'anachronisms');
}

/** Whether a pack-relative path is the technology kind. */
function isTechnologyFile(relPath: string): boolean {
  return fileMatchesKind(relPath, 'technology');
}

/**
 * Namespace a city scope the way the loader does: a bare `name` written in an
 * Era Pack's Anachronism Entry becomes `<ownerPack>/<name>`; a `<pack>/<name>`
 * scope is kept as-is. So a city-scoped entry matches the City id the period
 * index records for the city whose pack defines the scanned item.
 */
function namespacedCity(scope: string, ownerPack: string): string {
  return scope.includes('/') ? scope : `${ownerPack}/${scope}`;
}

/** Read and compile every Anachronism Entry from the parsed packs. */
function anachronismsOf(packs: readonly ParsedPack[]): AnachEntry[] {
  const entries: AnachEntry[] = [];
  for (const pack of packs) {
    for (const file of pack.files) {
      if (!file.parsed || !isAnachronismsFile(file.relPath)) {
        continue;
      }
      for (const item of itemsOf(file.content).items) {
        if (typeof item !== 'object' || item === null) {
          continue;
        }
        const record = item as Record<string, unknown>;
        if (
          typeof record.pattern !== 'string' ||
          typeof record.earliest !== 'number'
        ) {
          continue;
        }
        const tokens = tokenise(record.pattern);
        if (tokens.length === 0) {
          continue;
        }
        entries.push({
          tokens,
          earliest: record.earliest,
          city:
            typeof record.city === 'string'
              ? namespacedCity(record.city, pack.id)
              : undefined,
          display: typeof record.term === 'string' ? record.term : record.pattern,
        });
      }
    }
  }
  return entries;
}

/** Read and compile every technology catalogue name and alias surface. */
function technologyOf(packs: readonly ParsedPack[]): TechSurface[] {
  const surfaces: TechSurface[] = [];
  for (const pack of packs) {
    for (const file of pack.files) {
      if (!file.parsed || !isTechnologyFile(file.relPath)) {
        continue;
      }
      for (const item of itemsOf(file.content).items) {
        if (typeof item !== 'object' || item === null) {
          continue;
        }
        const record = item as Record<string, unknown>;
        if (typeof record.introduced !== 'number') {
          continue;
        }
        const names: string[] = [];
        if (typeof record.name === 'string') {
          names.push(record.name);
        }
        if (Array.isArray(record.aliases)) {
          for (const alias of record.aliases) {
            if (typeof alias === 'string') {
              names.push(alias);
            }
          }
        }
        for (const name of names) {
          const tokens = tokenise(name);
          if (tokens.length > 0) {
            surfaces.push({ tokens, introduced: record.introduced, display: name });
          }
        }
      }
    }
  }
  return surfaces;
}

/**
 * The text-bearing hits CE-ANACH scans: `text`, `templates` and `names` string
 * values, as the design's "Text scanning" names (the same set the task 5.3
 * rules scan). Tag, Tag Query and Year Range hits are not text.
 */
function isTextHit(hit: FieldHit): boolean {
  return (
    (hit.category === 'text' ||
      hit.category === 'templates' ||
      hit.category === 'names') &&
    typeof hit.value === 'string'
  );
}

/**
 * CE-ANACH — a text field matching an Anachronism Entry before its earliest
 * year, and a content item naming a technology catalogue item before it was
 * introduced (Req 12.2, 12.3; design, Property 6).
 *
 * For every text hit, the Effective Year Range of the hit's item is computed
 * (its own `years` ∩ city window ∩ era window). An Anachronism Entry fires when
 * its pattern occurs as a contiguous whole-word token sequence, its `earliest`
 * is later than the start of the Effective Year Range, and the entry has no
 * city scope or its scope equals the item's city. A technology surface fires on
 * the same whole-word match when `introduced` is later than the start of the
 * Effective Year Range (technology entries carry no city scope).
 *
 * A hit with no Effective Year Range (nothing in period) is not an anachronism
 * — its out-of-period Year Range is CE-PERIOD's finding — so CE-ANACH skips it.
 * An Era Pack's own anachronism and technology listings are not scanned against
 * themselves.
 */
export const anachRule: GenericFieldRule = {
  id: 'CE-ANACH',
  run(hits, ctx) {
    const entries = anachronismsOf(ctx.packs);
    const technology = technologyOf(ctx.packs);
    if (entries.length === 0 && technology.length === 0) {
      return [];
    }
    const index = buildPeriodIndex(ctx.packs);
    const findings: LintFinding[] = [];

    for (const hit of hits) {
      if (!isTextHit(hit)) {
        continue;
      }
      // The anachronism and technology catalogues define the period; do not
      // check their own term/name text against themselves.
      if (isAnachronismsFile(hit.file) || isTechnologyFile(hit.file)) {
        continue;
      }
      const itemYears = itemYearsOf(ctx.packs, hit);
      const range = effectiveRange(index, hit.pack, itemYears);
      if (range === undefined) {
        continue;
      }
      const tokens = tokenise(hit.value as string);
      const itemCity = index.packCity.get(hit.pack);

      for (const entry of entries) {
        if (entry.earliest <= range.from) {
          continue;
        }
        if (entry.city !== undefined && entry.city !== itemCity) {
          continue;
        }
        if (containsSequence(tokens, entry.tokens)) {
          findings.push(
            finding(
              'CE-ANACH',
              hit.pack,
              hit.file,
              hit.path,
              `text matches Anachronism Entry "${entry.display}" (earliest ${entry.earliest}, after the Effective Year Range start ${range.from})`,
            ),
          );
        }
      }

      for (const surface of technology) {
        if (surface.introduced <= range.from) {
          continue;
        }
        if (containsSequence(tokens, surface.tokens)) {
          findings.push(
            finding(
              'CE-ANACH',
              hit.pack,
              hit.file,
              hit.path,
              `text names technology "${surface.display}" (introduced ${surface.introduced}, after the Effective Year Range start ${range.from})`,
            ),
          );
        }
      }
    }
    return findings;
  },
};

// --- CE-PERIOD --------------------------------------------------------------

/**
 * CE-PERIOD — a Year Range field whose range lies outside the item's city or
 * era Period Window (design, "Pack Linter"). Every `years`-category hit is a
 * `{ from, to }` range; it is out of period when it does not intersect the
 * applicable Period Window — the item's city window (for a City-Scoped item)
 * intersected with the era window. A range that overlaps the window at all is
 * in period (a sector Route or Culture Weight that opens partway through the
 * window is legitimate). When no Period Window is known (a core-only or partial
 * set with no era and no city), the rule falls silent, as there is nothing to
 * be outside of.
 */
export const periodRule: GenericFieldRule = {
  id: 'CE-PERIOD',
  run(hits, ctx) {
    const index = buildPeriodIndex(ctx.packs);
    const findings: LintFinding[] = [];

    for (const hit of hits) {
      if (hit.category !== 'years') {
        continue;
      }
      const range = asRange(hit.value);
      if (range === undefined) {
        continue;
      }
      const cityId = index.packCity.get(hit.pack);
      const cityWindow = cityId === undefined ? undefined : index.cityPeriod.get(cityId);
      const window = intersect(cityWindow, index.era);
      if (window === undefined) {
        continue; // no Period Window to be outside of
      }
      if (intersect(range, window) === undefined) {
        findings.push(
          finding(
            'CE-PERIOD',
            hit.pack,
            hit.file,
            hit.path,
            `Year Range [${range.from}, ${range.to}] is outside the Period Window [${window.from}, ${window.to}]`,
          ),
        );
      }
    }
    return findings;
  },
};

// --- CE-STYLE ---------------------------------------------------------------

/** The mechanical Style Guide checks CE-STYLE runs (era StyleRule `check`). */
const MECHANICAL_CHECKS = new Set([
  'max-words',
  'terminal-stop',
  'no-exclamation',
  'no-first-person',
  'hedging',
  'spelling',
  'upper-case',
  'headline-words',
]);

/** The default maximum words for the `max-words` / `headline-words` checks. */
const DEFAULT_MAX_WORDS = 35;

/** The first-person pronouns `no-first-person` rejects (folded). */
const FIRST_PERSON = new Set(['i', 'me', 'my', 'mine', 'myself', 'we', 'us', 'our', 'ours']);

/** One compiled Style Guide rule, located for its reminder finding. */
interface StyleRuleRecord {
  readonly pack: string;
  readonly file: string;
  readonly path: string;
  readonly id: string;
  readonly appliesTo: Set<string>;
  readonly check: string;
  readonly value: unknown;
  readonly message: string;
}

/** Whether a pack-relative path is the style-guide kind. */
function isStyleGuideFile(relPath: string): boolean {
  return fileMatchesKind(relPath, 'style-guide');
}

/** Read and locate every Style Guide rule from the parsed packs. */
function styleRulesOf(packs: readonly ParsedPack[]): StyleRuleRecord[] {
  const rules: StyleRuleRecord[] = [];
  for (const pack of packs) {
    for (const file of pack.files) {
      if (!file.parsed || !isStyleGuideFile(file.relPath)) {
        continue;
      }
      const { items, pathAt } = itemsOf(file.content);
      items.forEach((item, index) => {
        if (typeof item !== 'object' || item === null) {
          return;
        }
        const record = item as Record<string, unknown>;
        if (
          typeof record.check !== 'string' ||
          !Array.isArray(record.appliesTo) ||
          typeof record.message !== 'string'
        ) {
          return;
        }
        rules.push({
          pack: pack.id,
          file: file.relPath,
          path: pathAt(index),
          id: typeof record.id === 'string' ? record.id : `[${index}]`,
          appliesTo: new Set(record.appliesTo.filter((t): t is string => typeof t === 'string')),
          check: record.check,
          value: record.value,
          message: record.message,
        });
      });
    }
  }
  return rules;
}

/**
 * The Style Guide surface a template hit targets. A Fact-Line template is the
 * `fact-line` surface; a Document template of kind K is `document:K`. The hit's
 * `templateStyle` carries the render style the registry declared (`fact-line`,
 * `document:cable`, …); a non-template hit has no style and matches no rule.
 */
function surfaceOf(hit: FieldHit): string | undefined {
  if (hit.category !== 'templates') {
    return undefined;
  }
  return hit.templateStyle;
}

/** Split a rendered template into sentences on terminal `.`, `!` or `?`. */
function sentencesOf(text: string): string[] {
  return text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** The word count of a text, ignoring template slots and punctuation. */
function wordCount(text: string): number {
  return tokenise(text).length;
}

/**
 * Run one mechanical Style Guide check against a template string, returning the
 * reason it is broken, or `undefined` when it passes. The checks mirror the era
 * StyleRule `check` set (design, Req 12.4, 12.5):
 *
 * - `max-words` — the longest sentence exceeds `value` (default 35) words;
 * - `headline-words` — the whole template exceeds `value` (default 12) words;
 * - `terminal-stop` — the template does not end in a full stop;
 * - `no-exclamation` — the template contains an exclamation mark;
 * - `no-first-person` — the template uses a first-person pronoun;
 * - `hedging` — the template uses a word from the rule's hedging list (`value`);
 * - `spelling` — the template uses a disallowed spelling from `value`;
 * - `upper-case` — the template body is not upper-case (for Cable bodies).
 */
function checkStyle(check: string, value: unknown, text: string): string | undefined {
  const words = tokenise(text);
  const wordSet = new Set(words);

  switch (check) {
    case 'max-words': {
      const max = typeof value === 'number' ? value : DEFAULT_MAX_WORDS;
      const longest = Math.max(0, ...sentencesOf(text).map(wordCount));
      return longest > max
        ? `a sentence has ${longest} words, over the ${max}-word limit`
        : undefined;
    }
    case 'headline-words': {
      const max = typeof value === 'number' ? value : 12;
      const count = wordCount(text);
      return count > max
        ? `the headline has ${count} words, over the ${max}-word limit`
        : undefined;
    }
    case 'terminal-stop': {
      return /\.\s*$/.test(text) ? undefined : 'does not end in a full stop';
    }
    case 'no-exclamation': {
      return text.includes('!') ? 'contains an exclamation mark' : undefined;
    }
    case 'no-first-person': {
      const used = words.find((w) => FIRST_PERSON.has(w));
      return used === undefined ? undefined : `uses the first-person pronoun "${used}"`;
    }
    case 'hedging': {
      const list = Array.isArray(value) ? value : [];
      for (const word of list) {
        if (typeof word === 'string' && containsSequence(words, tokenise(word))) {
          return `uses the hedging word "${word}"`;
        }
      }
      return undefined;
    }
    case 'spelling': {
      const list = Array.isArray(value) ? value : [];
      for (const word of list) {
        if (typeof word === 'string') {
          const folded = tokenise(word);
          if (folded.length === 1 ? wordSet.has(folded[0]) : containsSequence(words, folded)) {
            return `uses the disallowed spelling "${word}"`;
          }
        }
      }
      return undefined;
    }
    case 'upper-case': {
      // A telegraphic Cable body must be upper-case: no lower-case letters.
      const stripped = text.replace(/\{[^}]*\}/g, '');
      return /\p{Ll}/u.test(stripped) ? 'contains lower-case letters' : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * CE-STYLE — the mechanically-checked Style Guide rules over the template and
 * Fact-Line surfaces each rule applies to (Req 12.6). For every template hit
 * whose render style a rule's `appliesTo` names, the rule's mechanical check is
 * run against the template string; a broken check is a `warning` finding naming
 * the rule and the reason.
 *
 * A `manual` rule is never run mechanically — it is a review reminder — so it
 * is listed once, as an `info` finding on the rule's own location, so an author
 * sees which passages a human must read (design, "Pack Linter": "list `manual`
 * rules as reminders, never failing"). Manual reminders are emitted once per
 * rule, independent of the content, so they are deterministic and do not scale
 * with the pack size.
 */
export const styleRule: GenericFieldRule = {
  id: 'CE-STYLE',
  run(hits, ctx) {
    const rules = styleRulesOf(ctx.packs);
    if (rules.length === 0) {
      return [];
    }
    const findings: LintFinding[] = [];

    // Manual rules: one informational reminder each, on the rule's location.
    for (const rule of rules) {
      if (rule.check === 'manual') {
        findings.push(
          finding(
            'CE-STYLE',
            rule.pack,
            rule.file,
            rule.path,
            `manual Style Guide rule "${rule.id}" — ${rule.message} (review reminder)`,
            'info',
          ),
        );
      }
    }

    // Mechanical rules: check every template hit on a surface the rule targets.
    for (const hit of hits) {
      const surface = surfaceOf(hit);
      if (surface === undefined || typeof hit.value !== 'string') {
        continue;
      }
      for (const rule of rules) {
        if (!MECHANICAL_CHECKS.has(rule.check) || !rule.appliesTo.has(surface)) {
          continue;
        }
        const reason = checkStyle(rule.check, rule.value, hit.value);
        if (reason !== undefined) {
          findings.push(
            finding(
              'CE-STYLE',
              hit.pack,
              hit.file,
              hit.path,
              `breaks Style Guide rule "${rule.id}" (${rule.check}): ${reason}`,
            ),
          );
        }
      }
    }
    return findings;
  },
};

// --- CE-ALLOWLIST -----------------------------------------------------------

/**
 * Every distinctive entity alias in the pack set, folded to its token stream.
 * A distinctive alias (`{ text, distinctive: true }`) names an entity
 * specifically enough that a bare mention of it is treated as naming the entity
 * (slice `Alias`). The CE-ALLOWLIST rule rejects a Locale `allowNames` entry
 * equal to one, so the allowlist cannot hide an entity name from the guards
 * (design, Locale section).
 */
function distinctiveAliasesOf(packs: readonly ParsedPack[]): Map<string, string> {
  // folded key → display text, so a finding can name the alias it collides with.
  const aliases = new Map<string, string>();
  const consider = (text: string): void => {
    const key = tokenise(text).join(' ');
    if (key !== '' && !aliases.has(key)) {
      aliases.set(key, text);
    }
  };
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const entry of value) {
        walk(entry);
      }
      return;
    }
    if (typeof value !== 'object' || value === null) {
      return;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.text === 'string' && record.distinctive === true) {
      consider(record.text);
    }
    for (const child of Object.values(record)) {
      if (typeof child === 'object' && child !== null) {
        walk(child);
      }
    }
  };
  for (const pack of packs) {
    for (const file of pack.files) {
      if (file.parsed) {
        walk(file.content);
      }
    }
  }
  return aliases;
}

/**
 * CE-ALLOWLIST — a Locale `allowNames` entry equal to a distinctive entity
 * alias (design, Locale section; Req 8.6). Every `names`-category hit from a
 * Locale's `allowNames` is folded and compared to the distinctive aliases; a
 * folded match is an error, because an allowlisted name equal to a distinctive
 * alias would let the Specifics Guard pass a bare mention of that entity.
 *
 * Comparison is the whole-string folded form (not a substring), so "The Pier"
 * on the allowlist collides with the distinctive alias "The Pier" but a longer
 * phrase containing it does not. The `names` category is produced by the Locale
 * kind's `allowNames` Field Declaration, so no file-path check is needed.
 */
export const allowlistRule: GenericFieldRule = {
  id: 'CE-ALLOWLIST',
  run(hits, ctx) {
    const aliases = distinctiveAliasesOf(ctx.packs);
    if (aliases.size === 0) {
      return [];
    }
    const findings: LintFinding[] = [];
    for (const hit of hits) {
      if (hit.category !== 'names' || typeof hit.value !== 'string') {
        continue;
      }
      // Only the Locale's allowNames are the allowlist; a Culture Group or
      // blocklist name is a different `names` declaration and not an allowlist.
      if (hit.kind !== 'locale') {
        continue;
      }
      const key = tokenise(hit.value).join(' ');
      const alias = aliases.get(key);
      if (alias !== undefined) {
        findings.push(
          finding(
            'CE-ALLOWLIST',
            hit.pack,
            hit.file,
            hit.path,
            `Locale allowlist entry "${hit.value}" equals the distinctive entity alias "${alias}"`,
          ),
        );
      }
    }
    return findings;
  },
};

// --- registration -----------------------------------------------------------

/**
 * The task 5.4 period, style and localisation Lint Rules that run over the
 * FieldHit stream and the parsed packs. {@link ./generic-rules} folds these
 * into `GENERIC_FIELD_RULES` after the task 5.3 rules. The quantity,
 * feasibility and stability rules of task 5.4 are whole-set checks and live in
 * {@link ./stability-rules}.
 */
export const PERIOD_AND_STYLE_RULES: readonly GenericFieldRule[] = [
  anachRule,
  periodRule,
  styleRule,
  allowlistRule,
];

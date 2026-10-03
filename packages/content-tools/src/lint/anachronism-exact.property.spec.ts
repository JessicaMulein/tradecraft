// Feature: content-expansion, Property 6: Anachronism rule is exact.
//
// "For any text, Anachronism Entry, Effective Year Range and item city,
//  CE-ANACH reports the text if and only if all of the following hold:
//   - the entry's pattern occurs as a whole-word, case-insensitive and
//     diacritic-insensitive token sequence outside template slots;
//   - earliest > range.from;
//   - the entry has no city scope or its scope equals the item's city.
//  The same holds for technology catalogue item names and aliases against
//  introduced." (content-expansion design, Correctness Properties, Property 6.)
//
// Validates: Requirements 12.2, 12.3.
//
// Approach. The property drives `anachRule` directly over a parsed-pack set and
// a single text FieldHit, exactly as the task 5.4 unit tests do, and compares
// its finding count against an INDEPENDENT oracle built from the design's three
// conditions. The oracle re-derives the match/year/city predicate from scratch
// (its own folding tokeniser, whole-word sequence matcher and range
// intersection) rather than calling the rule's helpers, so a bug in either the
// rule or the oracle shows up as a disagreement.
//
// Each case generates:
//   - a scanned text (mixing matching/non-matching tokens, diacritics, case,
//     word boundaries and template slots);
//   - an era Period Window and an optional city Period Window;
//   - an item Year Range (or none) for the scanned item;
//   - whether the scanned item lives in an Era Pack or a City Pack (its city
//     scope being that City Pack's City id);
//   - a set of Anachronism Entries, each with its own pattern, earliest year
//     and optional city scope (bare or `pack/name`);
//   - a set of technology items, each with a name, aliases and introduced year.
// The rule and the oracle must agree on the exact number of CE-ANACH findings.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { anachRule } from './period-rules.js';
import type { FieldHit } from './generic-rules.js';
import type { LintContext } from './rules.js';
import type { ParsedFile, ParsedPack } from './parsed-files.js';

// --- independent oracle primitives -----------------------------------------
//
// Re-implemented from the design's "Text scanning" and "Effective Year Range"
// definitions, deliberately NOT importing the rule's own tokenise/
// containsSequence/intersect, so the oracle is a genuine cross-check.

/** Fold a token: lower-case, NFKD-decompose, drop combining marks. */
function oracleFold(token: string): string {
  return token
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Tokenise after removing `{...}` template slots; folded letter/digit runs. */
function oracleTokenise(text: string): string[] {
  const withoutSlots = text.replace(/\{[^}]*\}/g, ' ');
  const matches = withoutSlots.match(/[\p{L}\p{N}]+/gu);
  return matches === null ? [] : matches.map(oracleFold);
}

/** Whether `pattern` occurs as a contiguous whole-word run inside `tokens`. */
function oracleContains(tokens: readonly string[], pattern: readonly string[]): boolean {
  if (pattern.length === 0 || pattern.length > tokens.length) {
    return false;
  }
  for (let i = 0; i + pattern.length <= tokens.length; i += 1) {
    let hit = true;
    for (let j = 0; j < pattern.length; j += 1) {
      if (tokens[i + j] !== pattern[j]) {
        hit = false;
        break;
      }
    }
    if (hit) {
      return true;
    }
  }
  return false;
}

interface Range {
  readonly from: number;
  readonly to: number;
}

/** Intersect two ranges; `undefined` operands pass through; disjoint → undefined. */
function oracleIntersect(a: Range | undefined, b: Range | undefined): Range | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  const from = Math.max(a.from, b.from);
  const to = Math.min(a.to, b.to);
  return from <= to ? { from, to } : undefined;
}

// --- generated scenario model ----------------------------------------------

interface AnachModel {
  readonly term: string;
  readonly pattern: string;
  readonly earliest: number;
  /** Written scope on the entry, as the author would type it (bare or pack/x). */
  readonly city?: string;
}

interface TechModel {
  readonly id: string;
  readonly name: string;
  readonly aliases: string[];
  readonly introduced: number;
}

interface Scenario {
  readonly text: string;
  readonly era: Range;
  readonly cityWindow?: Range;
  readonly itemYears?: Range;
  /** True → the scanned item is in a City Pack; false → in the Era Pack. */
  readonly inCity: boolean;
  readonly anachronisms: AnachModel[];
  readonly technology: TechModel[];
}

// Fixed ids so the city scope and City id line up deterministically.
const CITY_PACK = 'berlin';
const CITY_DEF_ID = 'c';
/** The City id the period index records for the City Pack (pack/defId). */
const CITY_ID = `${CITY_PACK}/${CITY_DEF_ID}`;

// --- generators ------------------------------------------------------------

const YEAR_MIN = 1900;
const YEAR_MAX = 2000;

const year = fc.integer({ min: YEAR_MIN, max: YEAR_MAX });

/** A `{ from, to }` range with from <= to within the year band. */
const rangeArb: fc.Arbitrary<Range> = fc
  .tuple(year, year)
  .map(([a, b]) => (a <= b ? { from: a, to: b } : { from: b, to: a }));

// A small token vocabulary; some tokens carry diacritics / mixed case so the
// folding and whole-word matching are exercised on both sides.
const WORD = fc.constantFrom(
  'wall',
  'Wall',
  'WALL',
  'firewall',
  'checkpoint',
  'Charlie',
  'café',
  'cafe',
  'Müller',
  'muller',
  'radio',
  'transistor',
  'pocket',
  'the',
  'near',
  'crossing',
);

/** A free text: words, template slots and punctuation, any order. */
const textArb: fc.Arbitrary<string> = fc
  .array(
    fc.oneof(
      WORD,
      WORD.map((w) => `{${w}}`), // a slot: its content must not be scanned
      fc.constantFrom('.', ',', '!', '-', '  '),
    ),
    { minLength: 0, maxLength: 10 },
  )
  .map((parts) => parts.join(' '));

/** A multi-token phrase used as an anachronism pattern or a tech name. */
const phraseArb: fc.Arbitrary<string> = fc
  .array(WORD, { minLength: 1, maxLength: 3 })
  .map((parts) => parts.join(' '));

const anachArb: fc.Arbitrary<AnachModel> = fc.record({
  term: fc.constant('T'),
  pattern: phraseArb,
  earliest: year,
  // No scope, a bare city name, or an already-namespaced scope. A bare name is
  // namespaced to the entry's owner pack (the Era Pack here); a `pack/name`
  // scope is kept verbatim.
  city: fc.oneof(
    fc.constant(undefined),
    fc.constant(CITY_DEF_ID), // bare → era/c, never equal to berlin/c
    fc.constant(CITY_ID), // berlin/c → matches the City Pack's City id
    fc.constant('vienna/c'), // some other city → never matches
  ),
});

const techArb: fc.Arbitrary<TechModel> = fc.record({
  id: fc.constant('t'),
  name: phraseArb,
  aliases: fc.array(phraseArb, { minLength: 0, maxLength: 2 }),
  introduced: year,
});

const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  text: textArb,
  era: rangeArb,
  cityWindow: fc.option(rangeArb, { nil: undefined }),
  itemYears: fc.option(rangeArb, { nil: undefined }),
  inCity: fc.boolean(),
  anachronisms: fc.array(anachArb, { minLength: 0, maxLength: 3 }),
  technology: fc.array(techArb, { minLength: 0, maxLength: 3 }),
});

// --- building the parsed packs and the hit ---------------------------------

function fileOf(relPath: string, content: unknown): ParsedFile {
  return { relPath, content, parsed: true };
}

function packOf(id: string, files: ParsedFile[]): ParsedPack {
  return { dir: `/tmp/${id}`, id, files };
}

/**
 * Build the pack set for a scenario. The anachronism and technology catalogues
 * live in the Era Pack (so a bare city scope namespaces to `era/...`). The
 * scanned item lives either in the Era Pack or in the City Pack, at a non-
 * catalogue file, with its own `years` so `itemYearsOf` can recover them.
 */
function packsFor(s: Scenario): { packs: ParsedPack[]; hit: FieldHit } {
  const anachItems = s.anachronisms.map((a) => ({
    term: a.term,
    pattern: a.pattern,
    earliest: a.earliest,
    ...(a.city === undefined ? {} : { city: a.city }),
  }));
  const techItems = s.technology.map((t) => ({
    id: t.id,
    name: t.name,
    aliases: t.aliases,
    category: 'c',
    introduced: t.introduced,
  }));

  const scannedItem = {
    id: 'subject',
    ...(s.itemYears === undefined ? {} : { years: s.itemYears }),
    text: s.text,
  };

  const eraFiles: ParsedFile[] = [
    fileOf('pack.yaml', { id: 'era', role: 'era' }),
    fileOf('era.yaml', [{ id: 'e', period: s.era }]),
    fileOf('anachronisms.yaml', anachItems),
    fileOf('technology.yaml', techItems),
  ];

  const cityFiles: ParsedFile[] = [
    fileOf('pack.yaml', { id: CITY_PACK, role: 'city' }),
    fileOf('city.yaml', {
      id: CITY_DEF_ID,
      ...(s.cityWindow === undefined ? {} : { period: s.cityWindow }),
      cultureWeights: [{ group: 'g' }],
    }),
  ];

  // The scanned item goes into whichever pack we are testing, in a plain file.
  const subjectPackId = s.inCity ? CITY_PACK : 'era';
  const subjectFile = 'personas.yaml';
  if (s.inCity) {
    cityFiles.push(fileOf(subjectFile, [scannedItem]));
  } else {
    eraFiles.push(fileOf(subjectFile, [scannedItem]));
  }

  const packs = [packOf('era', eraFiles), packOf(CITY_PACK, cityFiles)];

  const hit: FieldHit = {
    kind: 'persona-library',
    pack: subjectPackId,
    file: subjectFile,
    path: 'items[0].text',
    category: 'text',
    value: s.text,
  };
  return { packs, hit };
}

function ctxWith(packs: ParsedPack[]): LintContext {
  return {
    set: null,
    loadErrors: [],
    registry: [],
    profile: 'draft',
    packs,
  } as unknown as LintContext;
}

// --- the oracle: expected CE-ANACH finding count ---------------------------

/**
 * The city scope an entry resolves to, mirroring the loader's namespacing: a
 * bare `name` written in the Era Pack becomes `era/name`; a `pack/name` scope
 * is kept. The scanned item's city is the City id of its pack (only for an item
 * in the City Pack).
 */
function resolvedScope(written: string): string {
  return written.includes('/') ? written : `era/${written}`;
}

function expectedFindingCount(s: Scenario): number {
  const itemCity = s.inCity ? CITY_ID : undefined;
  // Effective Year Range = itemYears ∩ cityWindow (city items only) ∩ era.
  const cityWindow = s.inCity ? s.cityWindow : undefined;
  const range = oracleIntersect(oracleIntersect(s.itemYears, cityWindow), s.era);
  if (range === undefined) {
    return 0; // nothing in period → CE-ANACH is silent
  }
  const tokens = oracleTokenise(s.text);
  let count = 0;

  for (const a of s.anachronisms) {
    const pat = oracleTokenise(a.pattern);
    if (pat.length === 0) {
      continue; // an all-slot/empty pattern compiles to no tokens → never matches
    }
    const scopeOk = a.city === undefined || resolvedScope(a.city) === itemCity;
    const yearOk = a.earliest > range.from;
    const matchOk = oracleContains(tokens, pat);
    if (scopeOk && yearOk && matchOk) {
      count += 1;
    }
  }

  for (const t of s.technology) {
    const surfaces = [t.name, ...t.aliases];
    for (const surface of surfaces) {
      const pat = oracleTokenise(surface);
      if (pat.length === 0) {
        continue;
      }
      const yearOk = t.introduced > range.from;
      const matchOk = oracleContains(tokens, pat);
      if (yearOk && matchOk) {
        count += 1; // one finding per matching surface, as the rule emits
      }
    }
  }
  return count;
}

// --- the property ----------------------------------------------------------

describe('Property 6: Anachronism rule is exact (CE-ANACH)', () => {
  it('fires on a text if and only if the match, year and city conditions hold', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const { packs, hit } = packsFor(s);
        const findings = anachRule.run([hit], ctxWith(packs));
        for (const f of findings) {
          expect(f.rule).toBe('CE-ANACH');
        }
        expect(findings.length).toBe(expectedFindingCount(s));
      }),
      { numRuns: 1000 },
    );
  });

  it('is silent when the scanned text is itself a catalogue entry', () => {
    // A hit located in the anachronisms or technology file is never scanned
    // against its own listing, whatever its year or city.
    fc.assert(
      fc.property(scenarioArb, fc.constantFrom('anachronisms.yaml', 'technology.yaml'), (s, catalogueFile) => {
        const { packs } = packsFor(s);
        const selfHit: FieldHit = {
          kind: 'technology',
          pack: 'era',
          file: catalogueFile,
          path: 'items[0].name',
          category: 'text',
          value: s.text,
        };
        expect(anachRule.run([selfHit], ctxWith(packs))).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });
});

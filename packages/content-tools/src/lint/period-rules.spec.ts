/**
 * The period, style, quantity and stability Lint Rules (content-expansion task
 * 5.4; Requirements 11.8, 12.2, 12.3, 12.6, 13.2, 13.7).
 *
 * These tests pin the task 5.4 rules the framework (task 5.2) runs: CE-ANACH
 * (anachronism terms and technology items against the Effective Year Range),
 * CE-PERIOD (out-of-period Year Ranges), CE-STYLE (mechanical Style Guide rules
 * plus `manual` reminders), CE-ALLOWLIST (a Locale allowlist entry equal to a
 * distinctive entity alias), CE-QUANTITY (the Req 11 target table), and
 * CE-IDSTABLE (id removal against a Baseline Manifest). CE-FEASIBLE's own-check
 * is exercised through a minimal City Bundle.
 */

import { describe, expect, it } from 'vitest';

import {
  anachRule,
  periodRule,
  styleRule,
  allowlistRule,
} from './period-rules.js';
import { quantityCheck, idStableCheck, feasibleCheck, plotBindCheck } from './stability-rules.js';
import type { FieldHit, GenericFieldRule } from './generic-rules.js';
import type { BaselineManifest, LintContext } from './rules.js';
import type { ParsedPack, ParsedFile } from './parsed-files.js';

// --- helpers ---------------------------------------------------------------

/** A FieldHit with sensible defaults, overridable per test. */
function hit(over: Partial<FieldHit> & Pick<FieldHit, 'value'>): FieldHit {
  return {
    kind: 'persona-library',
    pack: 'era',
    file: 'personas.yaml',
    path: 'items[0].text',
    category: 'text',
    ...over,
  };
}

/** A parsed file from an already-parsed object. */
function file(relPath: string, content: unknown): ParsedFile {
  return { relPath, content, parsed: true };
}

/** A parsed pack from its id and files. */
function pack(id: string, files: ParsedFile[]): ParsedPack {
  return { dir: `/tmp/${id}`, id, files };
}

/** A LintContext carrying the parsed packs a ctx-reading rule needs. */
function ctxWith(packs: ParsedPack[], over: Partial<LintContext> = {}): LintContext {
  return {
    set: null,
    loadErrors: [],
    registry: [],
    profile: 'draft',
    packs,
    ...over,
  };
}

/** Run a generic rule over hits and a parsed-pack set, as `rule file:path`. */
function run(rule: GenericFieldRule, hits: FieldHit[], packs: ParsedPack[]): string[] {
  return rule.run(hits, ctxWith(packs)).map((f) => `${f.rule} ${f.file}:${f.path}`);
}

/** An Era Pack with a Period Window and the given extra files. */
function eraPack(period: { from: number; to: number }, files: ParsedFile[] = []): ParsedPack {
  return pack('era', [file('pack.yaml', { id: 'era', role: 'era' }), file('era.yaml', [{ id: 'e', period }]), ...files]);
}

/** A City Pack with its own Period Window and the given extra files. */
function cityPack(id: string, period: { from: number; to: number }, files: ParsedFile[] = []): ParsedPack {
  return pack(id, [
    file('pack.yaml', { id, role: 'city' }),
    file('city.yaml', { id: 'c', period, cultureWeights: [{ group: 'g' }] }),
    ...files,
  ]);
}

// --- CE-ANACH --------------------------------------------------------------

describe('CE-ANACH — anachronism terms against the Effective Year Range (Req 12.2)', () => {
  const anachFile = file('anachronisms.yaml', [
    { term: 'the Wall', pattern: 'the wall', earliest: 1961, note: 'x' },
  ]);

  it('fires when the term appears and its earliest year is after the range start', () => {
    const packs = [eraPack({ from: 1945, to: 1965 }, [anachFile])];
    const hits = [hit({ value: 'a crossing at the Wall' })];
    expect(run(anachRule, hits, packs)).toEqual(['CE-ANACH personas.yaml:items[0].text']);
  });

  it('does not fire when the earliest year is within the range start', () => {
    // Era 1961–1965: the term is period-correct, so earliest (1961) <= from.
    const packs = [eraPack({ from: 1961, to: 1965 }, [anachFile])];
    const hits = [hit({ value: 'a crossing at the Wall' })];
    expect(run(anachRule, hits, packs)).toEqual([]);
  });

  it('matches whole-word, folded, and skips template slots', () => {
    const packs = [eraPack({ from: 1945, to: 1965 }, [anachFile])];
    // "firewall" must not match "the wall"; "The  Wall" (folded) must.
    expect(run(anachRule, [hit({ value: 'a firewall protects it' })], packs)).toEqual([]);
    expect(run(anachRule, [hit({ value: 'past {place} The Wall today' })], packs)).toEqual([
      'CE-ANACH personas.yaml:items[0].text',
    ]);
  });
});

describe('CE-ANACH — city-scoped entries (Req 12.2)', () => {
  const scoped = file('anachronisms.yaml', [
    { term: 'checkpoint charlie', pattern: 'checkpoint charlie', earliest: 1961, city: 'berlin/c', note: 'x' },
  ]);

  it('fires only for an item in the scoped city', () => {
    const packs = [
      eraPack({ from: 1945, to: 1965 }, [scoped]),
      cityPack('berlin', { from: 1948, to: 1961 }),
      cityPack('vienna', { from: 1945, to: 1955 }),
    ];
    const berlinHit = hit({ pack: 'berlin', file: 'districts.yaml', value: 'near Checkpoint Charlie' });
    const viennaHit = hit({ pack: 'vienna', file: 'districts.yaml', value: 'near Checkpoint Charlie' });
    expect(run(anachRule, [berlinHit], packs)).toEqual(['CE-ANACH districts.yaml:items[0].text']);
    expect(run(anachRule, [viennaHit], packs)).toEqual([]);
  });
});

describe('CE-ANACH — technology items against introduced (Req 12.3)', () => {
  const techFile = file('technology.yaml', [
    { id: 't1', name: 'transistor radio', aliases: ['pocket radio'], category: 'c', introduced: 1954 },
  ]);

  it('fires when a technology name or alias predates its introduction', () => {
    const packs = [eraPack({ from: 1945, to: 1965 }, [techFile])];
    expect(run(anachRule, [hit({ value: 'a transistor radio on the table' })], packs)).toEqual([
      'CE-ANACH personas.yaml:items[0].text',
    ]);
    expect(run(anachRule, [hit({ value: 'a small pocket radio' })], packs)).toEqual([
      'CE-ANACH personas.yaml:items[0].text',
    ]);
  });

  it('does not fire once the era starts at or after the introduction', () => {
    const packs = [eraPack({ from: 1954, to: 1965 }, [techFile])];
    expect(run(anachRule, [hit({ value: 'a transistor radio' })], packs)).toEqual([]);
  });

  it('does not scan the technology or anachronism catalogues against themselves', () => {
    const packs = [eraPack({ from: 1945, to: 1965 }, [techFile])];
    const techHit = hit({ file: 'technology.yaml', kind: 'technology', value: 'transistor radio', path: 'items[0].name' });
    expect(run(anachRule, [techHit], packs)).toEqual([]);
  });
});

// --- CE-PERIOD -------------------------------------------------------------

describe('CE-PERIOD — Year Range outside the Period Window', () => {
  it('reports a city Year Range that does not overlap the window', () => {
    const packs = [
      eraPack({ from: 1945, to: 1965 }),
      cityPack('berlin', { from: 1948, to: 1961 }),
    ];
    const outHit = hit({ pack: 'berlin', file: 'routes.yaml', category: 'years', value: { from: 1970, to: 1975 }, path: 'items[0].years' });
    expect(run(periodRule, [outHit], packs)).toEqual(['CE-PERIOD routes.yaml:items[0].years']);
  });

  it('accepts a Year Range that overlaps the window', () => {
    const packs = [
      eraPack({ from: 1945, to: 1965 }),
      cityPack('berlin', { from: 1948, to: 1961 }),
    ];
    const inHit = hit({ pack: 'berlin', file: 'routes.yaml', category: 'years', value: { from: 1960, to: 1965 }, path: 'items[0].years' });
    expect(run(periodRule, [inHit], packs)).toEqual([]);
  });

  it('ignores non-year hits and falls silent with no Period Window', () => {
    const packs = [cityPack('x', { from: 1948, to: 1961 })];
    // No era pack → the era window is unknown, but a city window still bounds it.
    const textHit = hit({ pack: 'x', category: 'text', value: 'prose' });
    expect(run(periodRule, [textHit], packs)).toEqual([]);
  });
});

// --- CE-STYLE --------------------------------------------------------------

describe('CE-STYLE — mechanical Style Guide rules (Req 12.6)', () => {
  const styleGuide = (rules: unknown[]): ParsedPack =>
    eraPack({ from: 1945, to: 1965 }, [file('style-guide.yaml', rules)]);

  /** A template hit on a given render style. */
  const tmpl = (value: string, style: string): FieldHit =>
    hit({ category: 'templates', templateStyle: style, value, file: 'templates.yaml', path: 'items[0].template' });

  it('reports a sentence over the max-words limit', () => {
    const long = Array.from({ length: 40 }, (_, i) => `w${i}`).join(' ') + '.';
    const packs = [styleGuide([{ id: 'r1', appliesTo: ['fact-line'], check: 'max-words', value: 35, message: 'm' }])];
    expect(run(styleRule, [tmpl(long, 'fact-line')], packs)).toEqual([
      'CE-STYLE templates.yaml:items[0].template',
    ]);
  });

  it('reports a missing terminal stop and an exclamation', () => {
    const packs = [
      styleGuide([
        { id: 'stop', appliesTo: ['fact-line'], check: 'terminal-stop', message: 'm' },
        { id: 'bang', appliesTo: ['fact-line'], check: 'no-exclamation', message: 'm' },
      ]),
    ];
    expect(run(styleRule, [tmpl('No stop here', 'fact-line')], packs)).toContain(
      'CE-STYLE templates.yaml:items[0].template',
    );
    expect(run(styleRule, [tmpl('A shock!', 'fact-line')], packs)).toContain(
      'CE-STYLE templates.yaml:items[0].template',
    );
  });

  it('reports a first-person pronoun and a hedging word', () => {
    const packs = [
      styleGuide([
        { id: 'fp', appliesTo: ['fact-line'], check: 'no-first-person', message: 'm' },
        { id: 'hedge', appliesTo: ['fact-line'], check: 'hedging', value: ['perhaps'], message: 'm' },
      ]),
    ];
    expect(run(styleRule, [tmpl('I saw it.', 'fact-line')], packs)).toContain(
      'CE-STYLE templates.yaml:items[0].template',
    );
    expect(run(styleRule, [tmpl('perhaps it was there.', 'fact-line')], packs)).toContain(
      'CE-STYLE templates.yaml:items[0].template',
    );
  });

  it('reports a headline over 12 words and lower-case Cable body', () => {
    const headline = Array.from({ length: 13 }, (_, i) => `h${i}`).join(' ');
    const packs = [
      styleGuide([
        { id: 'head', appliesTo: ['document:newspaper'], check: 'headline-words', value: 12, message: 'm' },
        { id: 'caps', appliesTo: ['document:cable'], check: 'upper-case', message: 'm' },
      ]),
    ];
    expect(run(styleRule, [tmpl(headline, 'document:newspaper')], packs)).toEqual([
      'CE-STYLE templates.yaml:items[0].template',
    ]);
    expect(run(styleRule, [tmpl('mostly lower case', 'document:cable')], packs)).toEqual([
      'CE-STYLE templates.yaml:items[0].template',
    ]);
    expect(run(styleRule, [tmpl('ALL UPPER CASE', 'document:cable')], packs)).toEqual([]);
  });

  it('lists a manual rule as a non-failing info reminder, once', () => {
    const packs = [styleGuide([{ id: 'aftermath', appliesTo: ['fact-line'], check: 'manual', message: 'restraint' }])];
    const findings = styleRule.run([tmpl('anything here.', 'fact-line')], ctxWith(packs));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].rule).toBe('CE-STYLE');
  });

  it('only checks a rule on the surfaces it applies to', () => {
    const packs = [styleGuide([{ id: 'bang', appliesTo: ['document:cable'], check: 'no-exclamation', message: 'm' }])];
    // The exclamation is on a fact-line, which the Cable rule does not target.
    expect(run(styleRule, [tmpl('A shock!', 'fact-line')], packs)).toEqual([]);
  });
});

// --- CE-ALLOWLIST ----------------------------------------------------------

describe('CE-ALLOWLIST — allowlist entry equals a distinctive entity alias', () => {
  const districtsWithAlias = file('districts.yaml', [
    { id: 'd1', aliases: [{ text: 'The Pier', distinctive: true }, { text: 'pier', distinctive: false }] },
  ]);

  it('reports a Locale allowlist entry equal to a distinctive alias', () => {
    const packs = [cityPack('x', { from: 1945, to: 1965 }, [districtsWithAlias])];
    const allowHit = hit({ pack: 'x', kind: 'locale', category: 'names', file: 'locale.yaml', value: 'the pier', path: 'items[0].allowNames[0]' });
    expect(run(allowlistRule, [allowHit], packs)).toEqual([
      'CE-ALLOWLIST locale.yaml:items[0].allowNames[0]',
    ]);
  });

  it('does not fire on a non-distinctive alias', () => {
    const packs = [cityPack('x', { from: 1945, to: 1965 }, [districtsWithAlias])];
    const allowHit = hit({ pack: 'x', kind: 'locale', category: 'names', file: 'locale.yaml', value: 'pier', path: 'items[0].allowNames[0]' });
    // "pier" is a non-distinctive alias → not an entity-naming alias.
    expect(run(allowlistRule, [allowHit], packs)).toEqual([]);
  });

  it('only applies to Locale allowNames, not other name fields', () => {
    const packs = [cityPack('x', { from: 1945, to: 1965 }, [districtsWithAlias])];
    const nameHit = hit({ pack: 'x', kind: 'culture-group', category: 'names', value: 'the pier', path: 'items[0].given.m[0]' });
    expect(run(allowlistRule, [nameHit], packs)).toEqual([]);
  });
});

// --- CE-QUANTITY -----------------------------------------------------------

describe('CE-QUANTITY — Req 11 Quantity Target table (Req 11.8)', () => {
  it('reports a City Pack location shortfall naming the required and actual counts', () => {
    const city = cityPack('vienna', { from: 1945, to: 1955 }, [
      file('locations.yaml', [{ id: 'l1' }]),
    ]);
    const findings = quantityCheck(ctxWith([city]));
    const locations = findings.find((f) => f.message.includes('city-locations'));
    expect(locations).toBeDefined();
    expect(locations?.rule).toBe('CE-QUANTITY');
    expect(locations?.message).toContain('require 25, found 1');
  });

  it('reports a Culture Group name shortfall', () => {
    const lib = pack('lib', [
      file('pack.yaml', { id: 'lib', role: 'library' }),
      file('culture-groups.yaml', [{ id: 'g', given: { m: ['A'], f: ['B'] }, family: ['C'] }]),
    ]);
    const findings = quantityCheck(ctxWith([lib]));
    const names = findings.filter((f) => f.file === 'culture-groups.yaml');
    expect(names.map((f) => f.message.includes('culture-names'))).toContain(true);
    expect(names.map((f) => f.message.includes('culture-given'))).toContain(true);
  });

  it('reports a shipped-set civilian-archetype shortfall once', () => {
    const lib = pack('lib', [
      file('pack.yaml', { id: 'lib', role: 'library' }),
      file('archetypes.yaml', [{ id: 'a', role: 'civilian' }, { id: 'b', role: 'cell' }]),
    ]);
    const findings = quantityCheck(ctxWith([lib]));
    const civilian = findings.filter((f) => f.message.includes('set-civilian-archetypes'));
    expect(civilian).toHaveLength(1);
    expect(civilian[0].message).toContain('require 40, found 1');
  });

  it('is silent for a pack that meets every target it is scored on', () => {
    const city = pack('vienna', [
      file('pack.yaml', { id: 'vienna', role: 'city' }),
      file('city.yaml', {
        id: 'c',
        period: { from: 1945, to: 1955 },
        cultureWeights: [{ group: 'a' }, { group: 'b' }, { group: 'c' }],
      }),
      file('locations.yaml', Array.from({ length: 25 }, (_, i) => ({ id: `l${i}` }))),
      file('districts.yaml', Array.from({ length: 6 }, (_, i) => ({ id: `d${i}` }))),
      file('newspapers.yaml', Array.from({ length: 3 }, (_, i) => ({ id: `n${i}` }))),
      file('local-orgs.yaml', Array.from({ length: 4 }, (_, i) => ({ id: `o${i}` }))),
      file('cover-identities.yaml', Array.from({ length: 6 }, (_, i) => ({ id: `cv${i}` }))),
      file('streets.yaml', [{ id: 's', names: Array.from({ length: 60 }, (_, i) => `St ${i}`) }]),
      file('template-variants.yaml', Array.from({ length: 30 }, (_, i) => ({ id: `v${i}` }))),
    ]);
    expect(quantityCheck(ctxWith([city]))).toEqual([]);
  });
});

// --- CE-IDSTABLE -----------------------------------------------------------

describe('CE-IDSTABLE — id removal against a Baseline Manifest (Req 13.7)', () => {
  /** A minimal Content Set carrying only a manifest and the services registry. */
  function setWith(packVersion: string, serviceIds: string[]): LintContext['set'] {
    return {
      predicates: {} as never,
      archetypes: new Map(),
      locationTypes: new Map(),
      plotTemplates: new Map(),
      sideThreadTemplates: new Map(),
      documentTemplates: new Map(),
      personaLibraries: new Map(),
      coverIdentities: new Map(),
      rumourTemplates: new Map(),
      hints: new Map(),
      glossary: new Map(),
      difficultyPresets: new Map(),
      services: new Map(serviceIds.map((id) => [id, {} as never])),
      templateVariantDefs: new Map(),
      templateVariants: {} as never,
      cities: {},
      cultureGroups: {},
      descriptorFragments: [],
      tagVocabulary: { facets: [], tags: [], requiredQueries: [] },
      cityScopeOwner: {},
      registry: [],
      manifest: { schema: 2, packs: [{ id: 'era', version: packVersion, hash: 'h' }] },
    } as unknown as LintContext['set'];
  }

  function baseline(version: string, ids: string[]): BaselineManifest {
    return {
      manifest: { schema: 2, packs: [{ id: 'era', version, hash: 'h0' }] },
      ids: { era: ids },
    };
  }

  it('reports a baseline id missing now when the major version is unchanged', () => {
    const ctx = ctxWith([], {
      set: setWith('1.3.0', ['era/svc-a']),
      baseline: baseline('1.2.0', ['svc-a', 'svc-b']),
    });
    const findings = idStableCheck(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe('CE-IDSTABLE');
    expect(findings[0].message).toContain('svc-b');
  });

  it('allows every removal when the major version increased', () => {
    const ctx = ctxWith([], {
      set: setWith('2.0.0', ['era/svc-a']),
      baseline: baseline('1.2.0', ['svc-a', 'svc-b']),
    });
    expect(idStableCheck(ctx)).toEqual([]);
  });

  it('is silent with no baseline supplied', () => {
    const ctx = ctxWith([], { set: setWith('1.3.0', ['era/svc-a']) });
    expect(idStableCheck(ctx)).toEqual([]);
  });
});

// --- CE-FEASIBLE -----------------------------------------------------------

describe('CE-FEASIBLE — instantiateCity over 256 seeds at boundary years (Req 9.9)', () => {
  /** A minimal, well-formed City Bundle wrapped in a ContentSetV2-shaped set. */
  function setWithCity(bundle: unknown, requiredQueries: unknown[]): LintContext['set'] {
    return {
      predicates: {} as never,
      archetypes: new Map(),
      locationTypes: new Map(),
      plotTemplates: new Map(),
      sideThreadTemplates: new Map(),
      documentTemplates: new Map(),
      personaLibraries: new Map(),
      coverIdentities: new Map(),
      rumourTemplates: new Map(),
      hints: new Map(),
      glossary: new Map(),
      difficultyPresets: new Map(),
      services: new Map(),
      templateVariantDefs: new Map(),
      templateVariants: {} as never,
      cities: { 'city/c': bundle },
      era: { id: 'era/e', period: { from: 1945, to: 1965 } },
      cultureGroups: {},
      descriptorFragments: [],
      tagVocabulary: { facets: [], tags: [], requiredQueries },
      cityScopeOwner: {},
      registry: [],
      manifest: { schema: 2, packs: [{ id: 'city', version: '1.0.0', hash: 'h' }] },
    } as unknown as LintContext['set'];
  }

  /** A minimal District/Location/weather bundle with the given instantiation bounds. */
  function bundle(bounds: { districts: [number, number]; locations: [number, number] }): unknown {
    const emptyWeatherMonth = [{ id: 'clear', label: 'clear', weight: 1 }];
    const months = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [String(i + 1), emptyWeatherMonth]),
    );
    return {
      def: {
        id: 'c',
        name: 'City',
        country: 'X',
        climate: 'climate:temperate',
        period: { from: 1948, to: 1961 },
        startDates: { from: '1948-01-01', to: '1961-12-31' },
        currency: { name: 'c', symbol: 'c', subunit: 's', format: '{amount}', rounding: 1, budgetScale: 1 },
        languages: [{ id: 'l', name: 'L', share: 1 }],
        cultureWeights: [{ group: 'lib/g', weight: 1 }],
        services: ['era/svc'],
        instantiation: bounds,
      },
      districts: [{ id: 'd1', city: 'c', name: 'D1', description: 'x' }],
      locations: [
        { id: 'loc1', name: 'L1', type: 'core/t', district: 'd1', public: true, description: 'x', city: 'c', basis: 'fictional' },
      ],
      routes: [],
      locationTypes: [],
      newspapers: [],
      orgs: [],
      weather: { city: 'c', months },
      covers: [],
      streets: [],
      locale: {
        scope: { city: 'city/c' },
        date: { long: '{day}', short: '{day}', months: Array(12).fill('m'), weekdays: Array(7).fill('w') },
        currency: { pattern: '{amount}' },
        honorifics: { f: ['Ms'], m: ['Mr'] },
        address: '{street}',
        terms: [],
        allowNames: [],
      },
      variants: [],
      sources: [],
    };
  }

  it('reports no finding for a city that instantiates at every boundary year', () => {
    const set = setWithCity(bundle({ districts: [1, 1], locations: [1, 1] }), []);
    expect(feasibleCheck(ctxWith([], { set }))).toEqual([]);
  });

  it('reports an infeasible city with an unbindable Required Query', () => {
    // A Required Query with minInstantiated 1 but no Binders → infeasible.
    const set = setWithCity(bundle({ districts: [1, 1], locations: [1, 1] }), [
      { id: 'rq', query: ['facet:never-tagged'], minStatic: 1, minInstantiated: 1 },
    ]);
    const findings = feasibleCheck(ctxWith([], { set }));
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].rule).toBe('CE-FEASIBLE');
    expect(findings[0].message).toContain('infeasible');
  });

  it('is silent when the Content Set failed to load', () => {
    expect(feasibleCheck(ctxWith([], { set: null }))).toEqual([]);
  });
});

describe('CE-PLOTBIND — a city binds a public Location for every plot place (plot trace binding by Tag Query)', () => {
  /**
   * A ContentSetV2-shaped set with one city and one plot template whose single
   * trace names a `place.query`. `cityLocations` are the city's Locations (so a
   * test can tag one for the query or leave none); `typeTags` maps the global
   * Location Type `core/cafe` to its Tags.
   */
  function setWithPlot(
    cityLocations: unknown[],
    query: string[],
    typeTags: Record<string, string[]> = {},
  ): LintContext['set'] {
    const locationTypes = new Map(
      Object.entries(typeTags).map(([id, tags]) => [id, { id, tags } as unknown]),
    );
    const plot = {
      id: 'core/liaison',
      stages: [
        {
          id: 's1',
          traces: [{ kind: 'meeting', roles: [], place: { query }, evidences: [], text: 't' }],
        },
      ],
    };
    return {
      predicates: {} as never,
      archetypes: new Map(),
      locationTypes,
      plotTemplates: new Map([[plot.id, plot as unknown]]),
      sideThreadTemplates: new Map(),
      documentTemplates: new Map(),
      personaLibraries: new Map(),
      coverIdentities: new Map(),
      rumourTemplates: new Map(),
      hints: new Map(),
      glossary: new Map(),
      difficultyPresets: new Map(),
      services: new Map(),
      templateVariantDefs: new Map(),
      templateVariants: {} as never,
      cities: {
        'city/c': {
          def: { id: 'c', name: 'City', period: { from: 1948, to: 1961 } },
          districts: [],
          locations: cityLocations,
          routes: [],
          locationTypes: [],
          newspapers: [],
          orgs: [],
          weather: { city: 'c', months: {} },
          covers: [],
          streets: [],
          locale: {} as unknown,
          variants: [],
          sources: [],
        },
      },
      era: { id: 'era/e', period: { from: 1945, to: 1965 } },
      cultureGroups: {},
      descriptorFragments: [],
      tagVocabulary: { facets: [], tags: [], requiredQueries: [] },
      cityScopeOwner: {},
      registry: [],
      manifest: { schema: 2, packs: [{ id: 'city', version: '1.0.0', hash: 'h' }] },
    } as unknown as LintContext['set'];
  }

  /** A City Location with the given id, type, public flag and own Tags. */
  function loc(id: string, type: string, isPublic: boolean, tags: string[] = []): unknown {
    return { id, name: id, type, district: 'd1', public: isPublic, description: 'x', city: 'c', basis: 'fictional', tags };
  }

  it('reports no finding when a public Location binds the query by its Location-Type Tags', () => {
    const set = setWithPlot(
      [loc('cafe-1', 'core/cafe', true)],
      ['function:cafe'],
      { 'core/cafe': ['function:cafe'] },
    );
    expect(plotBindCheck(ctxWith([], { set }))).toEqual([]);
  });

  it('reports no finding when a public Location binds the query by its own Tags', () => {
    const set = setWithPlot(
      [loc('spot-1', 'core/other', true, ['function:cafe'])],
      ['function:cafe'],
      { 'core/other': [] },
    );
    expect(plotBindCheck(ctxWith([], { set }))).toEqual([]);
  });

  it('fires when the only binder of the query is a non-public Location', () => {
    const set = setWithPlot(
      [loc('cafe-private', 'core/cafe', false)],
      ['function:cafe'],
      { 'core/cafe': ['function:cafe'] },
    );
    const findings = plotBindCheck(ctxWith([], { set }));
    expect(findings.length).toBe(1);
    expect(findings[0].rule).toBe('CE-PLOTBIND');
    expect(findings[0].message).toContain('function:cafe');
  });

  it('fires when the city tags no Location for the query at all', () => {
    const set = setWithPlot(
      [loc('park-1', 'core/park', true, ['function:park'])],
      ['function:cafe'],
      { 'core/park': ['function:park'] },
    );
    const findings = plotBindCheck(ctxWith([], { set }));
    expect(findings.length).toBe(1);
    expect(findings[0].rule).toBe('CE-PLOTBIND');
  });

  it('is silent when the Content Set failed to load', () => {
    expect(plotBindCheck(ctxWith([], { set: null }))).toEqual([]);
  });
});

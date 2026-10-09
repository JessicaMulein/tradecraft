/**
 * The reference, identity and text-safety Lint Rules (content-expansion task
 * 5.3; Requirements 3.1, 3.4, 3.8, 13.2).
 *
 * These tests pin the concrete rules the framework (task 5.2) runs: the folding
 * tokeniser and whole-word matcher, the exact and near-duplicate text rules,
 * the Name-Pool duplicate rule, the Real-Person Blocklist and Sensitivity Term
 * rules, and the real-landmark source rule. The loader-backed rules (CE-SCHEMA,
 * CE-REF, …, CE-VARIANT, CE-PROVENANCE) are checked through the error map and
 * the end-to-end lint in `lint.spec.ts` / `error-map`; here we also assert the
 * new CE-PROVENANCE routing.
 */

import { describe, expect, it } from 'vitest';

import {
  tokenise,
  containsSequence,
  duptextRule,
  neardupRule,
  namedupRule,
  realPersonRule,
  sensitiveRule,
  sourceRule,
} from './concrete-rules.js';
import { ruleForError } from './error-map.js';
import type { FieldHit, GenericFieldRule } from './generic-rules.js';
import type { LintContext } from './rules.js';
import type { ParsedPack, ParsedFile } from './parsed-files.js';

// --- helpers ---------------------------------------------------------------

/** A FieldHit with sensible defaults, overridable per test. */
function hit(over: Partial<FieldHit> & Pick<FieldHit, 'value'>): FieldHit {
  return {
    kind: 'persona-library',
    pack: 'core',
    file: 'personas.yaml',
    path: 'items[0].backgrounds[0]',
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

/** A LintContext carrying only the parsed packs a ctx-reading rule needs. */
function ctxWith(packs: ParsedPack[]): LintContext {
  return {
    set: null,
    loadErrors: [],
    registry: [],
    profile: 'draft',
    packs,
  };
}

/** Run a generic rule over hits and an optional parsed-pack set. */
function run(rule: GenericFieldRule, hits: FieldHit[], packs: ParsedPack[] = []): string[] {
  return rule.run(hits, ctxWith(packs)).map((f) => `${f.rule} ${f.file}:${f.path}`);
}

// --- tokenisation ----------------------------------------------------------

describe('tokenise — diacritic and case folding, slot skipping (Req 13.2)', () => {
  it('folds case and diacritics', () => {
    expect(tokenise('Café MÜLLER')).toEqual(['cafe', 'muller']);
  });

  it('splits on punctuation and whitespace', () => {
    expect(tokenise('one, two-three. four')).toEqual(['one', 'two', 'three', 'four']);
  });

  it('skips template slots and does not fuse the tokens around them', () => {
    // The {name} slot is removed; "meets" and "at" must stay separate tokens.
    expect(tokenise('meets {name} at {place}')).toEqual(['meets', 'at']);
  });

  it('yields no tokens for empty or slot-only text', () => {
    expect(tokenise('')).toEqual([]);
    expect(tokenise('{a}{b}')).toEqual([]);
  });
});

describe('containsSequence — contiguous whole-word match', () => {
  it('matches a contiguous run', () => {
    expect(containsSequence(['a', 'b', 'c', 'd'], ['b', 'c'])).toBe(true);
  });

  it('rejects a non-contiguous or absent run', () => {
    expect(containsSequence(['a', 'x', 'c'], ['a', 'c'])).toBe(false);
    expect(containsSequence(['a', 'b'], ['c'])).toBe(false);
  });

  it('never matches an empty pattern', () => {
    expect(containsSequence(['a'], [])).toBe(false);
  });
});

// --- CE-DUPTEXT ------------------------------------------------------------

describe('CE-DUPTEXT — exact duplicate within (kind, field)', () => {
  it('reports a later exact (folded) duplicate, ignoring case and diacritics', () => {
    const hits = [
      hit({ value: 'A warm café', path: 'items[0].backgrounds[0]' }),
      hit({ value: 'a warm cafe', path: 'items[1].backgrounds[0]' }),
    ];
    expect(run(duptextRule, hits)).toEqual([
      'CE-DUPTEXT personas.yaml:items[1].backgrounds[0]',
    ]);
  });

  it('does not fire across different fields of the same kind', () => {
    const hits = [
      hit({ value: 'same words here', category: 'text', path: 'items[0].voiceTraits[0]' }),
      hit({ value: 'same words here', category: 'text', path: 'items[0].mannerisms[0]' }),
    ];
    // Different declared fields → different groups → no duplicate.
    expect(run(duptextRule, hits)).toEqual([]);
  });

  it('does not fire across different kinds', () => {
    const hits = [
      hit({ kind: 'a', value: 'shared text value' }),
      hit({ kind: 'b', value: 'shared text value' }),
    ];
    expect(run(duptextRule, hits)).toEqual([]);
  });
});

// --- CE-NEARDUP ------------------------------------------------------------

describe('CE-NEARDUP — 3-shingle Jaccard near-duplicate', () => {
  const base = Array.from({ length: 14 }, (_, i) => `word${i}`).join(' ');

  it('reports a near-duplicate above the threshold, but not an exact one', () => {
    // base vs base with one word changed → high Jaccard, not exact.
    const altered = base.replace('word13', 'wordX');
    const hits = [
      hit({ value: base, path: 'items[0].backgrounds[0]' }),
      hit({ value: altered, path: 'items[1].backgrounds[0]' }),
    ];
    const near = run(neardupRule, hits);
    expect(near).toEqual(['CE-NEARDUP personas.yaml:items[1].backgrounds[0]']);
    // The exact-duplicate rule stays silent on a near (not exact) pair.
    expect(run(duptextRule, hits)).toEqual([]);
  });

  it('ignores short texts below the minimum word count', () => {
    const short = 'one two three four five';
    const hits = [
      hit({ value: short, path: 'items[0].backgrounds[0]' }),
      hit({ value: `${short} six`, path: 'items[1].backgrounds[0]' }),
    ];
    expect(run(neardupRule, hits)).toEqual([]);
  });

  it('does not fire on dissimilar long texts', () => {
    const other = Array.from({ length: 14 }, (_, i) => `other${i}`).join(' ');
    const hits = [
      hit({ value: base, path: 'items[0].backgrounds[0]' }),
      hit({ value: other, path: 'items[1].backgrounds[0]' }),
    ];
    expect(run(neardupRule, hits)).toEqual([]);
  });

  it('leaves an exact duplicate to CE-DUPTEXT, not CE-NEARDUP', () => {
    const hits = [
      hit({ value: base, path: 'items[0].backgrounds[0]' }),
      hit({ value: base, path: 'items[1].backgrounds[0]' }),
    ];
    expect(run(neardupRule, hits)).toEqual([]);
    expect(run(duptextRule, hits)).toEqual([
      'CE-DUPTEXT personas.yaml:items[1].backgrounds[0]',
    ]);
  });
});

// --- CE-NAMEDUP ------------------------------------------------------------

describe('CE-NAMEDUP — duplicate within a Name Pool', () => {
  const culturePack = (given: unknown, family: unknown): ParsedPack =>
    pack('lib', [
      file('culture-groups.yaml', [
        { id: 'g1', name: 'G', naming: {}, given, family },
      ]),
    ]);

  it('reports a repeated given name within one gender pool', () => {
    const packs = [culturePack({ m: ['Franz', 'Karl', 'Franz'], f: ['Maria'] }, ['Huber'])];
    expect(run(namedupRule, [], packs)).toEqual([
      'CE-NAMEDUP culture-groups.yaml:[0].given.m[2]',
    ]);
  });

  it('folds diacritics and case when comparing', () => {
    const packs = [culturePack({ m: ['Müller', 'MULLER'], f: ['Maria'] }, ['Huber'])];
    expect(run(namedupRule, [], packs)).toEqual([
      'CE-NAMEDUP culture-groups.yaml:[0].given.m[1]',
    ]);
  });

  it('does not report the same name across different pools', () => {
    // "Franz" in m and in f is not a within-pool duplicate.
    const packs = [culturePack({ m: ['Franz'], f: ['Franz'] }, ['Franz'])];
    expect(run(namedupRule, [], packs)).toEqual([]);
  });

  it('reports a repeated gendered family-name pair', () => {
    const packs = [
      culturePack({ m: ['Franz'], f: ['Maria'] }, [
        { m: 'Novák', f: 'Nováková' },
        { m: 'Novák', f: 'Nováková' },
      ]),
    ];
    expect(run(namedupRule, [], packs)).toEqual([
      'CE-NAMEDUP culture-groups.yaml:[0].family[1]',
    ]);
  });
});

// --- CE-REALPERSON ---------------------------------------------------------

describe('CE-REALPERSON — Real-Person Blocklist match', () => {
  const blocklistPack = (entries: unknown[]): ParsedPack =>
    pack('era', [file('blocklist.yaml', entries)]);

  it('reports a full-name match in a text field, folded', () => {
    const packs = [blocklistPack([{ name: 'Konrad Adenauer', note: 'chancellor' }])];
    const hits = [hit({ value: 'a letter from konrad adenauer himself' })];
    expect(run(realPersonRule, hits, packs)).toEqual([
      'CE-REALPERSON personas.yaml:items[0].backgrounds[0]',
    ]);
  });

  it('does not fire on a partial, non-contiguous name', () => {
    const packs = [blocklistPack([{ name: 'Konrad Adenauer', note: 'x' }])];
    const hits = [hit({ value: 'konrad went to see adenauer later' })];
    expect(run(realPersonRule, hits, packs)).toEqual([]);
  });

  it('matches a familyOnly entry on the family name alone', () => {
    const packs = [blocklistPack([{ name: 'Josef Stalin', familyOnly: true, note: 'x' }])];
    const hits = [hit({ value: 'the Stalin note was intercepted' })];
    expect(run(realPersonRule, hits, packs)).toEqual([
      'CE-REALPERSON personas.yaml:items[0].backgrounds[0]',
    ]);
  });

  it('matches a hyphenated familyOnly surname and not the piece after the hyphen', () => {
    const packs = [blocklistPack([{ name: 'Alec Douglas-Home', familyOnly: true, note: 'x' }])];
    const surname = [hit({ value: 'a cable from Douglas-Home' })];
    expect(run(realPersonRule, surname, packs)).toEqual([
      'CE-REALPERSON personas.yaml:items[0].backgrounds[0]',
    ]);
    const noun = [hit({ value: 'the cousin will not write home' })];
    expect(run(realPersonRule, noun, packs)).toEqual([]);
  });

  it('does not report the blocklist entry against its own listing', () => {
    const packs = [blocklistPack([{ name: 'Konrad Adenauer', note: 'x' }])];
    const hits = [
      hit({
        kind: 'blocklist',
        file: 'blocklist.yaml',
        category: 'names',
        value: 'Konrad Adenauer',
        path: 'items[0].name',
      }),
    ];
    expect(run(realPersonRule, hits, packs)).toEqual([]);
  });
});

// --- CE-SENSITIVE ----------------------------------------------------------

describe('CE-SENSITIVE — Sensitivity Term match', () => {
  const sensitivityPack = (entries: unknown[]): ParsedPack =>
    pack('era', [file('sensitivity.yaml', entries)]);

  it('reports a term matched as a whole-word sequence, folded', () => {
    const packs = [sensitivityPack([{ term: 'Bad Slur', pattern: 'bad slur' }])];
    const hits = [hit({ value: 'he used a Bad Slur in the cable' })];
    expect(run(sensitiveRule, hits, packs)).toEqual([
      'CE-SENSITIVE personas.yaml:items[0].backgrounds[0]',
    ]);
  });

  it('does not scan the sensitivity list against its own patterns', () => {
    const packs = [sensitivityPack([{ term: 'bad', pattern: 'bad' }])];
    const hits = [
      hit({ kind: 'sensitivity', file: 'sensitivity.yaml', value: 'bad', path: 'items[0].term' }),
    ];
    expect(run(sensitiveRule, hits, packs)).toEqual([]);
  });

  it('does not fire when the term is absent', () => {
    const packs = [sensitivityPack([{ term: 'xyz', pattern: 'xyz' }])];
    const hits = [hit({ value: 'a perfectly ordinary background' })];
    expect(run(sensitiveRule, hits, packs)).toEqual([]);
  });
});

// --- CE-SOURCE -------------------------------------------------------------

describe('CE-SOURCE — real-landmark Location without a source', () => {
  const locationPack = (items: unknown[]): ParsedPack =>
    pack('city', [file('locations.yaml', items)]);

  it('reports a real-landmark Location with no sources', () => {
    const packs = [locationPack([{ id: 'l1', basis: 'real-landmark' }])];
    expect(run(sourceRule, [], packs)).toEqual([
      'CE-SOURCE locations.yaml:[0]',
    ]);
  });

  it('reports a real-landmark Location with an empty sources list', () => {
    const packs = [locationPack([{ id: 'l1', basis: 'real-landmark', sources: [] }])];
    expect(run(sourceRule, [], packs)).toEqual([
      'CE-SOURCE locations.yaml:[0]',
    ]);
  });

  it('accepts a cited real-landmark Location', () => {
    const packs = [locationPack([{ id: 'l1', basis: 'real-landmark', sources: ['city/s1'] }])];
    expect(run(sourceRule, [], packs)).toEqual([]);
  });

  it('does not require sources for real-inspired or fictional Locations', () => {
    const packs = [
      locationPack([
        { id: 'l1', basis: 'real-inspired' },
        { id: 'l2', basis: 'fictional' },
      ]),
    ];
    expect(run(sourceRule, [], packs)).toEqual([]);
  });
});

// --- CE-PROVENANCE routing -------------------------------------------------

describe('ruleForError — Provenance gate routes to CE-PROVENANCE (Req 16.4)', () => {
  it('maps the generated-but-unreviewed refusal to CE-PROVENANCE', () => {
    expect(
      ruleForError({
        pack: 'city',
        file: 'locations.yaml',
        path: 'provenance',
        message:
          'generated content must be reviewed: provenance has "generated: true" but is missing reviewedBy and/or reviewedAt',
      }),
    ).toBe('CE-PROVENANCE');
  });

  it('leaves an unrelated schema error on CE-SCHEMA', () => {
    expect(
      ruleForError({ pack: 'p', file: 'x.yaml', path: '', message: 'Required' }),
    ).toBe('CE-SCHEMA');
  });
});

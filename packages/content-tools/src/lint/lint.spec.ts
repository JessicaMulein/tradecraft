/**
 * The Pack Linter framework (content-expansion task 5.2).
 *
 * These tests pin the framework the later rule tasks (5.3, 5.4) and the
 * property tests (5.5–5.8) build on: the ContentError→rule mapping (Req 13.1),
 * the generic Field-Declaration walk (Req 13.8), `lint.yaml` Suppressions with
 * the non-suppressible rejection (Req 13.5, 13.6), deterministic sorting and
 * text/JSON output (Req 13.3), and the exit code (Req 13.4). The concrete rule
 * bodies are out of scope here, so the generic-rule set is exercised through an
 * injected test rule.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { stringify as toYaml } from 'yaml';

import { lint } from './lint.js';
import {
  readParsedPacks,
  fieldValues,
  itemsOf,
} from './parsed-files.js';
import { ruleForError } from './error-map.js';
import { collectSuppressions, applySuppressions } from './suppressions.js';
import {
  sortFindings,
  buildReport,
  exitCodeFor,
  formatText,
  formatJson,
} from './output.js';
import { collectFieldHits, type GenericFieldRule } from './generic-rules.js';
import type { LintFinding } from './rules.js';
import { SLICE_KIND_REGISTRATIONS } from '@tradecraft/content';

// --- fixtures --------------------------------------------------------------

type PackFiles = Record<string, unknown>;

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

/** Write one pack directory named by its id under a fresh temp root. */
function writePack(id: string, files: PackFiles): string {
  const root = mkdtempSync(join(tmpdir(), 'tc-lint-'));
  tempRoots.push(root);
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  for (const [rel, value] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, typeof value === 'string' ? value : toYaml(value), 'utf8');
  }
  return dir;
}

const predicateMeetsAt = {
  id: 'MEETS_AT',
  subject: ['npc', 'unk'],
  object: { entity: ['npc', 'unk'] },
  place: 'required',
  window: 'required',
  evaluator: 'fact-match',
  fieldCode: 'MT',
  render: {
    second: 'You meet {object} at {place} {when}.',
    third: '{subject} meets {object} at {place} {when}.',
  },
  extractorHint: 'Two people meet at a place.',
};

const archetypeWaiter = {
  id: 'waiter',
  role: 'civilian',
  allowedAllegiances: ['neutral'],
  mice: {
    money: { min: 0, max: 1 },
    ideology: { min: 0, max: 1 },
    coercion: { min: 0, max: 1 },
    ego: { min: 0, max: 1 },
  },
  wariness: { min: 0, max: 1 },
  personaPools: ['austrian'],
  descriptorPools: ['street-clothes'],
};

const personaAustrian = {
  id: 'austrian',
  namePools: [
    { culture: 'austrian', gender: 'male', given: ['Franz'], family: ['Huber'] },
    { culture: 'austrian', gender: 'female', given: ['Maria'], family: ['Gruber'] },
  ],
  backgrounds: ['A lifelong Viennese.'],
};

const descriptorsCore = {
  version: 1,
  shared: { build: ['lean'], grooming: ['clean-shaven'] },
  pools: {
    'street-clothes': {
      garments: [{ text: 'a raincoat', fits: 'any' }],
      accessories: ['a felt hat'],
    },
  },
};

const locationKaffeehaus = {
  id: 'kaffeehaus',
  public: true,
  allowedActions: ['talk'],
  baseRisk: 0.1,
  allowsDeadDrops: false,
  namePatterns: ['Café {pick:names}'],
  descriptionPool: ['A warm coffee house.'],
  atmosphereTags: ['smoky'],
};

/** A minimal core pack that loads cleanly on its own. */
function cleanPack(overrides: PackFiles = {}): PackFiles {
  return {
    'pack.yaml': { id: 'core', version: '1.0.0', contentSchema: 1 },
    'predicates.yaml': [predicateMeetsAt],
    'archetypes.yaml': [archetypeWaiter],
    'personas.yaml': [personaAustrian],
    'descriptors.yaml': descriptorsCore,
    'location-types.yaml': [locationKaffeehaus],
    ...overrides,
  };
}

// --- the JsonPath walker ---------------------------------------------------

describe('fieldValues — Field Declaration path walker', () => {
  it('resolves a list-of-strings field to indexed leaves', () => {
    const content = { items: [{ tags: ['a', 'b'] }, { tags: ['c'] }] };
    const leaves = fieldValues(content, 'items[].tags[]');
    expect(leaves).toEqual([
      { value: 'a', path: 'items[0].tags[0]' },
      { value: 'b', path: 'items[0].tags[1]' },
      { value: 'c', path: 'items[1].tags[0]' },
    ]);
  });

  it('resolves a scalar field under each item', () => {
    const content = { items: [{ name: 'x' }, { name: 'y' }] };
    expect(fieldValues(content, 'items[].name')).toEqual([
      { value: 'x', path: 'items[0].name' },
      { value: 'y', path: 'items[1].name' },
    ]);
  });

  it('yields nothing for a missing optional field', () => {
    expect(fieldValues({ items: [{}] }, 'items[].years')).toEqual([]);
  });

  it('handles a bare list file layout', () => {
    const { items, pathAt } = itemsOf([{ id: 'a' }, { id: 'b' }]);
    expect(items).toHaveLength(2);
    expect(pathAt(1)).toBe('[1]');
  });

  it('handles the envelope file layout', () => {
    const { pathAt } = itemsOf({ provenance: { generated: false }, items: [{ id: 'a' }] });
    expect(pathAt(0)).toBe('items[0]');
  });
});

// --- the ContentError → rule mapping ---------------------------------------

describe('ruleForError — ContentError mapping (Req 13.1)', () => {
  const map = (file: string, message: string): string =>
    ruleForError({ pack: 'p', file, path: '', message });

  it('maps a Zod/schema error to CE-SCHEMA', () => {
    expect(map('archetypes.yaml', 'Required')).toBe('CE-SCHEMA');
    expect(map('pack.yaml', 'contentSchema must be positive')).toBe('CE-SCHEMA');
    expect(map('spaceships.yaml', 'file does not correspond to any registered content kind')).toBe(
      'CE-SCHEMA',
    );
  });

  it('maps a cross-reference error to CE-REF', () => {
    expect(map('cross-reference', 'persona pool "x" does not resolve to any loaded content')).toBe(
      'CE-REF',
    );
  });

  it('maps a duplicate id to CE-DUPID', () => {
    expect(map('archetypes.yaml', 'duplicate id "core/waiter"')).toBe('CE-DUPID');
  });

  it('maps a Tag error to CE-TAG', () => {
    expect(map('locations.yaml', 'tag "x:y" is not in the Tag Vocabulary')).toBe('CE-TAG');
    expect(map('locations.yaml', 'a location must carry at least one tag')).toBe('CE-TAG');
  });

  it('maps a Tag Conformance shortfall to CE-CONFORM', () => {
    expect(map('tag-conformance', 'city core/vienna: 1 binders, minimum 3')).toBe('CE-CONFORM');
  });

  it('maps a Template Variant mismatch to CE-VARIANT', () => {
    expect(map('cross-reference', 'variant slot set differs from base template')).toBe('CE-VARIANT');
  });
});

// --- Suppressions ----------------------------------------------------------

describe('collectSuppressions / applySuppressions (Req 13.5, 13.6)', () => {
  it('accepts a suppressible rule and downgrades the matching finding to info', () => {
    const packs = readParsedPacks([
      writePack('core', {
        'pack.yaml': { id: 'core', version: '1.0.0', contentSchema: 2 },
        'lint.yaml': [{ rule: 'CE-ANACH', path: 'items[0].note', justification: 'period slang' }],
      }),
    ]);
    const { suppressions, errors } = collectSuppressions(packs);
    expect(errors).toHaveLength(0);
    expect(suppressions).toHaveLength(1);

    const finding: LintFinding = {
      rule: 'CE-ANACH',
      severity: 'error',
      pack: 'core',
      file: 'anachronisms.yaml',
      path: 'items[0].note',
      message: 'anachronism',
    };
    const [after] = applySuppressions([finding], suppressions);
    expect(after.severity).toBe('info');
    expect(after.suppressed).toBe('period slang');
  });

  it('rejects a suppression of a non-suppressible rule with a CE-SCHEMA error', () => {
    const packs = readParsedPacks([
      writePack('core', {
        'pack.yaml': { id: 'core', version: '1.0.0', contentSchema: 2 },
        'lint.yaml': [{ rule: 'CE-SCHEMA', path: 'x', justification: 'nope' }],
      }),
    ]);
    const { suppressions, errors } = collectSuppressions(packs);
    expect(suppressions).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].rule).toBe('CE-SCHEMA');
    expect(errors[0].message).toContain('not suppressible');
  });

  it('rejects an empty justification with a CE-SCHEMA error', () => {
    const packs = readParsedPacks([
      writePack('core', {
        'pack.yaml': { id: 'core', version: '1.0.0', contentSchema: 2 },
        'lint.yaml': [{ rule: 'CE-ANACH', path: 'p', justification: '' }],
      }),
    ]);
    const { suppressions, errors } = collectSuppressions(packs);
    expect(suppressions).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].rule).toBe('CE-SCHEMA');
  });

  it('rejects an unknown rule id with a CE-SCHEMA error', () => {
    const packs = readParsedPacks([
      writePack('core', {
        'pack.yaml': { id: 'core', version: '1.0.0', contentSchema: 2 },
        'lint.yaml': [{ rule: 'CE-BOGUS', path: 'p', justification: 'x' }],
      }),
    ]);
    const { suppressions, errors } = collectSuppressions(packs);
    expect(suppressions).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('unknown lint rule');
  });

  it('never downgrades a non-suppressible finding even if named', () => {
    const finding: LintFinding = {
      rule: 'CE-REF',
      severity: 'error',
      pack: 'core',
      file: 'cross-reference',
      path: 'p',
      message: 'ref',
    };
    const [after] = applySuppressions(
      [finding],
      [{ pack: 'core', rule: 'CE-REF', path: 'p', justification: 'x' }],
    );
    expect(after.severity).toBe('error');
    expect(after.suppressed).toBeUndefined();
  });
});

// --- deterministic sorting + output ----------------------------------------

describe('sortFindings / output (Req 13.3, 13.4)', () => {
  const findings: LintFinding[] = [
    { rule: 'CE-TAG', severity: 'error', pack: 'b', file: 'f', path: 'items[1]', message: 'm' },
    { rule: 'CE-REF', severity: 'warning', pack: 'a', file: 'f', path: 'items[1]', message: 'm' },
    { rule: 'CE-REF', severity: 'error', pack: 'a', file: 'f', path: 'items[0]', message: 'm' },
  ];

  it('sorts by (pack, file, path, rule)', () => {
    const sorted = sortFindings(findings);
    expect(sorted.map((f) => `${f.pack}:${f.path}:${f.rule}`)).toEqual([
      'a:items[0]:CE-REF',
      'a:items[1]:CE-REF',
      'b:items[1]:CE-TAG',
    ]);
  });

  it('summarises and sets the exit code from error severity', () => {
    const report = buildReport(findings, []);
    expect(report.summary).toEqual({ errors: 2, warnings: 1, info: 0 });
    expect(exitCodeFor(report)).toBe(1);
    expect(exitCodeFor(buildReport([], []))).toBe(0);
  });

  it('produces identical text and JSON on repeated runs', () => {
    const a = formatText(buildReport(findings, []));
    const b = formatText(buildReport([...findings].reverse(), []));
    expect(a).toBe(b);
    expect(formatJson(buildReport(findings, []))).toContain('"summary"');
  });
});

// --- the generic Field-Declaration walk ------------------------------------

describe('collectFieldHits — generic plumbing (Req 13.8)', () => {
  it('streams declared fields of a registered kind with located paths', () => {
    const packs = readParsedPacks([
      writePack('core', {
        'pack.yaml': { id: 'core', version: '1.0.0', contentSchema: 1 },
        'cover-identities.yaml': [
          { id: 'c1', title: 'Clerk', employerOrg: 'Bank', tags: ['x:y'], fitLocationTypes: [] },
        ],
      }),
    ]);
    const hits = collectFieldHits(packs, SLICE_KIND_REGISTRATIONS);
    const cover = hits.filter((h) => h.kind === 'cover-identity');
    // cover-identity declares text [title, employerOrg] and tags [tags[]]. The
    // file is a bare list, so item paths are `[i]` (matching the loader).
    expect(cover.find((h) => h.category === 'text' && h.value === 'Clerk')?.path).toBe(
      '[0].title',
    );
    expect(cover.find((h) => h.category === 'tags' && h.value === 'x:y')?.path).toBe(
      '[0].tags[0]',
    );
  });

  it('uses the envelope item path when the file is a { items } envelope', () => {
    const packs = readParsedPacks([
      writePack('core', {
        'pack.yaml': { id: 'core', version: '1.0.0', contentSchema: 1 },
        'cover-identities.yaml': {
          provenance: { generated: false },
          items: [{ id: 'c1', title: 'Clerk', employerOrg: 'Bank', tags: ['x:y'], fitLocationTypes: [] }],
        },
      }),
    ]);
    const hits = collectFieldHits(packs, SLICE_KIND_REGISTRATIONS);
    expect(
      hits.find((h) => h.kind === 'cover-identity' && h.value === 'Clerk')?.path,
    ).toBe('items[0].title');
  });
});

// --- end-to-end lint() -----------------------------------------------------

describe('lint() — orchestration', () => {
  it('reports no finding and exits 0 on a clean pack set', () => {
    const dir = writePack('core', cleanPack());
    const report = lint([dir], ['core']);
    expect(report.findings).toHaveLength(0);
    expect(exitCodeFor(report)).toBe(0);
  });

  it('maps a loader schema error to a CE-SCHEMA finding (Req 13.1)', () => {
    const dir = writePack('core', cleanPack({ 'spaceships.yaml': [{ id: 'enterprise' }] }));
    const report = lint([dir], ['core']);
    const schema = report.findings.find((f) => f.file === 'spaceships.yaml');
    expect(schema?.rule).toBe('CE-SCHEMA');
    expect(schema?.severity).toBe('error');
    expect(exitCodeFor(report)).toBe(1);
  });

  it('runs generic rules over parsed files even when loading fails (Req 13.1)', () => {
    // A broken pack whose load fails; a test generic rule still sees the hits.
    const dir = writePack('core', cleanPack({ 'spaceships.yaml': [{ id: 'enterprise' }] }));
    const seen: string[] = [];
    const probe: GenericFieldRule = {
      id: 'CE-PROBE',
      run: (hits) => {
        seen.push(...hits.filter((h) => h.kind === 'location-type').map((h) => h.path));
        return [];
      },
    };
    lint([dir], ['core'], { genericRules: [probe] });
    // The clean location-type's declared template fields are still visited.
    expect(seen.length).toBeGreaterThan(0);
  });

  it('is deterministic across directory order for a multi-pack set', () => {
    // A core pack and a dependent library pack: linting the same set from
    // either directory permutation yields identical output (Req 13.3; the
    // output is sorted by (pack, file, path, rule), not by load order).
    const core = writePack('core', cleanPack({ 'spaceships.yaml': [{ id: 'x' }] }));
    const lib = writePack('lib', {
      'pack.yaml': {
        id: 'lib',
        version: '1.0.0',
        contentSchema: 1,
        requires: [{ id: 'core', range: '^1.0.0' }],
      },
      'ufos.yaml': [{ id: 'y' }],
    });
    const r1 = lint([core, lib], ['core', 'lib']);
    const r2 = lint([lib, core], ['core', 'lib']);
    expect(formatJson(r1)).toBe(formatJson(r2));
    // Both unregistered-kind files are reported, under either order.
    expect(r1.findings.some((f) => f.file === 'spaceships.yaml')).toBe(true);
    expect(r1.findings.some((f) => f.file === 'ufos.yaml')).toBe(true);
  });

  it('raises CE-QUANTITY severity to error under the release profile', () => {
    const quantityRule = {
      id: 'CE-QUANTITY',
      defect: 'q',
      severity: 'warning' as const,
      releaseSeverity: 'error' as const,
      suppressible: false,
      check: () => [
        { rule: 'CE-QUANTITY', severity: 'warning' as const, pack: 'core', file: 'f', path: '', message: 'short' },
      ],
    };
    const dir = writePack('core', cleanPack());
    const draft = lint([dir], ['core'], { profile: 'draft', rules: [quantityRule] });
    const release = lint([dir], ['core'], { profile: 'release', rules: [quantityRule] });
    expect(draft.findings[0].severity).toBe('warning');
    expect(release.findings[0].severity).toBe('error');
    expect(exitCodeFor(draft)).toBe(0);
    expect(exitCodeFor(release)).toBe(1);
  });
});

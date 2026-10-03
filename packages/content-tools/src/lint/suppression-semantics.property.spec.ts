/**
 * Property 5: Suppression semantics (content-expansion task 5.6; design,
 * "Correctness Properties"; Pack Linter).
 *
 * **Feature: content-expansion, Property 5.**
 *
 * **Validates: Requirements 13.5, 13.6.**
 *
 * > For any pack set with seeded findings and any set of Suppressions, a finding
 * > is downgraded to informational if and only if a Suppression with a non-empty
 * > justification matches its rule and path and the rule is suppressible. Every
 * > Suppression naming a non-suppressible rule produces an error. (design,
 * > Property 5)
 *
 * The property is checked through the real {@link collectSuppressions} /
 * {@link applySuppressions} pair — the two halves the orchestrator wires
 * together in {@link lint} — exercised over a pack's actual `lint.yaml`. Each
 * sample writes an arbitrary `lint.yaml` to a real temp pack directory, parses
 * it with the real {@link readParsedPacks}, collects its Suppressions and
 * applies the accepted ones to an arbitrary set of findings, then asserts both
 * halves of the biconditional and the non-suppressible rejection.
 *
 * The arbitraries deliberately span the whole input space the property quantifies
 * over: rule ids drawn from both suppressible and non-suppressible rules (plus an
 * unknown id), paths that match or miss a finding, and empty or non-empty
 * justifications. The oracle below recomputes the expected outcome independently
 * of the implementation, from the one invariant the property names, so a passing
 * run pins the implementation against that invariant rather than against itself.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { stringify as toYaml } from 'yaml';

import { collectSuppressions, applySuppressions } from './suppressions.js';
import { readParsedPacks } from './parsed-files.js';
import { LINT_RULES, NON_SUPPRESSIBLE_RULES, type LintFinding } from './rules.js';

// ---------------------------------------------------------------------------
// Rule universe (derived from the real rule table, so the test never drifts)
// ---------------------------------------------------------------------------

/** The ids a Suppression may silence (the rule table's `suppressible` rules). */
const SUPPRESSIBLE_RULE_IDS = LINT_RULES.filter((r) => r.suppressible).map((r) => r.id);

/** The ids a Suppression may never silence (Req 13.6), from the same table. */
const NON_SUPPRESSIBLE_RULE_IDS = LINT_RULES.filter((r) => !r.suppressible).map((r) => r.id);

/** A rule id that is in no rule table at all, to exercise the unknown-id path. */
const UNKNOWN_RULE_ID = 'CE-DOES-NOT-EXIST';

// Guard the fixtures: the property is only meaningful if both classes exist and
// the derived non-suppressible set agrees with the exported one.
if (SUPPRESSIBLE_RULE_IDS.length === 0 || NON_SUPPRESSIBLE_RULE_IDS.length === 0) {
  throw new Error('expected both suppressible and non-suppressible rules in the table');
}

// ---------------------------------------------------------------------------
// Temp-pack plumbing
// ---------------------------------------------------------------------------

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

/** The pack id every sample uses; findings and suppressions share it so they can match. */
const PACK_ID = 'core';

/** Write a `lint.yaml` (the given suppression entries) into a fresh temp pack. */
function writeLintPack(entries: readonly unknown[]): string {
  const root = mkdtempSync(join(tmpdir(), 'tc-suppress-'));
  tempRoots.push(root);
  const dir = join(root, PACK_ID);
  const files: Record<string, unknown> = {
    'pack.yaml': { id: PACK_ID, version: '1.0.0', contentSchema: 2 },
    'lint.yaml': entries,
  };
  for (const [rel, value] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, toYaml(value), 'utf8');
  }
  return dir;
}

// ---------------------------------------------------------------------------
// Arbitraries spanning the quantified input space
// ---------------------------------------------------------------------------

/**
 * A set of distinct error paths the generators draw from, so a suppression's
 * path can either match a finding's path or miss every one of them.
 */
const PATHS = ['items[0].note', 'items[1].text', 'items[2].name', 'items[3].title'] as const;

const ruleIdArb = fc.constantFrom(
  ...SUPPRESSIBLE_RULE_IDS,
  ...NON_SUPPRESSIBLE_RULE_IDS,
  UNKNOWN_RULE_ID,
);

const pathArb = fc.constantFrom(...PATHS);

/**
 * Justification: either empty (invalid, rejected by the schema's `.min(1)`) or a
 * short non-empty string (valid). The non-empty case is drawn from a plain
 * alphanumeric alphabet so it survives the `lint.yaml` YAML round-trip
 * unchanged — whitespace-only or whitespace-edged strings can be re-quoted or
 * trimmed by YAML, which would decouple the authored text from what the linter
 * reads back and is not what this property is about.
 */
const justificationArb = fc.oneof(
  fc.constant(''),
  fc.string({
    minLength: 1,
    maxLength: 12,
    unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
  }),
);

/** One authored `lint.yaml` entry, spanning rule class, match and validity. */
interface SuppressionEntry {
  readonly rule: string;
  readonly path: string;
  readonly justification: string;
}

const entryArb: fc.Arbitrary<SuppressionEntry> = fc.record({
  rule: ruleIdArb,
  path: pathArb,
  justification: justificationArb,
});

/** A finding to be (maybe) suppressed: any rule and any path, in the one pack. */
const findingArb: fc.Arbitrary<LintFinding> = fc.record({
  rule: ruleIdArb,
  path: pathArb,
}).map(
  ({ rule, path }): LintFinding => ({
    rule,
    severity: 'error',
    pack: PACK_ID,
    file: 'content.yaml',
    path,
    message: 'seeded finding',
  }),
);

// ---------------------------------------------------------------------------
// Independent oracle for the property's biconditional
// ---------------------------------------------------------------------------

/**
 * The schema the collector enforces per `lint.yaml` entry: all three fields
 * present and `rule`/`justification` non-empty (`path` may be empty). An empty
 * justification is the only schema-invalid shape these generators produce (an
 * unknown or non-suppressible rule is still a non-empty string, so it passes the
 * schema and is rejected later, per entry).
 */
function entryPassesSchema(entry: SuppressionEntry): boolean {
  return entry.rule.length > 0 && entry.justification.length > 0;
}

/**
 * The collector parses the whole `lint.yaml` array against the schema first, so
 * a single schema-invalid entry (here, an empty justification) rejects the
 * entire file and *no* suppression from it is accepted. Mirror that: a file is
 * usable only when every entry passes the schema.
 */
function fileIsSchemaValid(entries: readonly SuppressionEntry[]): boolean {
  return entries.every(entryPassesSchema);
}

/**
 * Whether some accepted suppression downgrades this finding, computed straight
 * from the property's invariant and the collector's parse contract: the file
 * must parse (every entry schema-valid), the finding's rule must be suppressible,
 * and an entry must name that same rule and path. Unknown and non-suppressible
 * rules never downgrade, because such entries are rejected before they can match.
 */
function expectDowngraded(
  finding: LintFinding,
  entries: readonly SuppressionEntry[],
): boolean {
  if (!fileIsSchemaValid(entries)) {
    return false;
  }
  if (!SUPPRESSIBLE_RULE_IDS.includes(finding.rule)) {
    return false;
  }
  return entries.some(
    (e) =>
      e.rule === finding.rule &&
      e.path === finding.path &&
      e.justification.length > 0,
  );
}

// ---------------------------------------------------------------------------
// Property 5
// ---------------------------------------------------------------------------

describe('Property 5: suppression semantics (Req 13.5, 13.6)', () => {
  // The core biconditional (Req 13.5): over arbitrary findings and arbitrary
  // `lint.yaml` entries, a finding ends up `info` (with its justification
  // recorded) if and only if a suppressible rule's entry matches its rule and
  // path with a non-empty justification. Every other finding keeps its
  // severity, and the non-suppressible / unknown / empty-justification entries
  // never silence anything.
  it(
    'downgrades a finding iff a matching suppressible entry has a non-empty justification',
    () => {
      fc.assert(
        fc.property(
          fc.array(findingArb, { minLength: 1, maxLength: 6 }),
          fc.array(entryArb, { minLength: 0, maxLength: 6 }),
          (findings, entries) => {
            const dir = writeLintPack(entries);
            const packs = readParsedPacks([dir]);
            const { suppressions } = collectSuppressions(packs);
            const applied = applySuppressions(findings, suppressions);

            // Position-preserving: applySuppressions maps 1:1 over findings.
            expect(applied).toHaveLength(findings.length);

            findings.forEach((finding, i) => {
              const after = applied[i];
              const shouldDowngrade = expectDowngraded(finding, entries);

              if (shouldDowngrade) {
                // Req 13.5: downgraded to info, justification listed, and the
                // justification is a non-empty one authored for that path/rule.
                expect(after.severity).toBe('info');
                expect(after.suppressed).toBeDefined();
                expect(after.suppressed?.length ?? 0).toBeGreaterThan(0);
                const matching = entries.filter(
                  (e) =>
                    e.rule === finding.rule &&
                    e.path === finding.path &&
                    e.justification.length > 0,
                );
                expect(matching.map((e) => e.justification)).toContain(
                  after.suppressed,
                );
              } else {
                // No matching accepted suppression: the finding is untouched.
                expect(after.severity).toBe(finding.severity);
                expect(after.suppressed).toBeUndefined();
              }
            });
          },
        ),
      );
    },
  );

  // Req 13.6: every entry naming a non-suppressible rule is ignored and reported
  // as a CE-SCHEMA error, and never joins the accepted suppressions. So a
  // finding on a non-suppressible rule is never downgraded, however the entry is
  // phrased.
  it(
    'rejects every non-suppressible entry as an error and never downgrades such findings',
    () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              rule: fc.constantFrom(...NON_SUPPRESSIBLE_RULE_IDS),
              path: pathArb,
              // Non-empty so only the non-suppressibility (not the empty
              // justification) can be the reason it is rejected.
              justification: fc.string({ minLength: 1, maxLength: 12 }),
            }),
            { minLength: 1, maxLength: 6 },
          ),
          (entries) => {
            const dir = writeLintPack(entries);
            const packs = readParsedPacks([dir]);
            const { suppressions, errors } = collectSuppressions(packs);

            // No non-suppressible rule is ever accepted (Req 13.6).
            for (const s of suppressions) {
              expect(NON_SUPPRESSIBLE_RULES.has(s.rule)).toBe(false);
            }

            // Each entry raises exactly one CE-SCHEMA error flagged as such.
            const notSuppressible = errors.filter((e) =>
              e.message.includes('not suppressible'),
            );
            expect(notSuppressible).toHaveLength(entries.length);
            for (const e of notSuppressible) {
              expect(e.rule).toBe('CE-SCHEMA');
              expect(e.severity).toBe('error');
            }

            // A finding on a non-suppressible rule, matching a rejected entry
            // exactly, is still never downgraded.
            entries.forEach((entry) => {
              const finding: LintFinding = {
                rule: entry.rule,
                severity: 'error',
                pack: PACK_ID,
                file: 'content.yaml',
                path: entry.path,
                message: 'seeded finding',
              };
              const [after] = applySuppressions([finding], suppressions);
              expect(after.severity).toBe('error');
              expect(after.suppressed).toBeUndefined();
            });
          },
        ),
      );
    },
  );

  // Req 13.5 (justification required): an otherwise-valid suppressible entry with
  // an empty justification is rejected and never downgrades its matching
  // finding.
  it(
    'rejects a suppressible entry with an empty justification and leaves its finding intact',
    () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...SUPPRESSIBLE_RULE_IDS),
          pathArb,
          (rule, path) => {
            const dir = writeLintPack([{ rule, path, justification: '' }]);
            const packs = readParsedPacks([dir]);
            const { suppressions, errors } = collectSuppressions(packs);

            expect(suppressions).toHaveLength(0);
            expect(errors).toHaveLength(1);
            expect(errors[0].rule).toBe('CE-SCHEMA');

            const finding: LintFinding = {
              rule,
              severity: 'warning',
              pack: PACK_ID,
              file: 'content.yaml',
              path,
              message: 'seeded finding',
            };
            const [after] = applySuppressions([finding], suppressions);
            expect(after.severity).toBe('warning');
            expect(after.suppressed).toBeUndefined();
          },
        ),
      );
    },
  );
});

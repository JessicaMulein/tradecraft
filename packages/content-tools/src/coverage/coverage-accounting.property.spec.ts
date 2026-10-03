// Feature: content-expansion, Property 17: Coverage accounting.
//
// "For any pack set, city list, preset list, seed count and underuse fraction:
//   - every coverage count equals a naive recount of the `UsageSink` events;
//   - every expected value equals total draws ÷ eligible items;
//   - an item is flagged `unused` if and only if its count is 0, and
//     `underused` if and only if its count is positive and below the fraction ×
//     expected;
//   - the Required Query margins equal the static Binder recounts;
//   - the Markdown and CSV output is identical across runs."
//   (content-expansion design, Correctness Properties, Property 17.)
//
// Validates: Requirements 15.1, 15.2, 15.3, 15.5.
//
// Approach. The accounting core is pure (`buildCoverageReport` and the
// `flagFor` / `jaccard` / `meanPairwiseJaccard` primitives make no draws, read
// no filesystem and generate no worlds — design, "Coverage Report"), so the
// property drives it directly over arbitrary cells, raw `(kind, id)` usage
// tallies, eligibility sets, Required-Query margins and an underuse fraction,
// exactly as the orchestrator feeds it. For each clause an INDEPENDENT oracle
// re-derives the expected result from scratch rather than calling the core's
// helpers, so a bug in either the core or the oracle shows up as a
// disagreement:
//
//   - counts: naively re-sum the generated usage events per `(city, preset,
//     kind, id)` and match every row's count against it (Req 15.1);
//   - expected: re-divide each kind's total draws by its eligible-set size and
//     match every row's expected use (Req 15.3);
//   - flags: re-derive `unused`/`underused`/`ok` from count, expected and the
//     fraction (Req 15.3);
//   - margins: the core must pass the margins through unchanged as a set
//     (Req 15.2);
//   - stability: two builds of the same inputs produce byte-identical Markdown
//     and CSV (Req 15.5).

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  buildCoverageReport,
  flagFor,
  jaccard,
  meanPairwiseJaccard,
  type CoverageCell,
  type CoverageInputs,
  type RequiredQueryMargin,
  type UsageCount,
} from './report.js';
import { toCsv, toMarkdown } from './output.js';

// --- generated scenario model ----------------------------------------------
//
// A scenario is a set of cells, a set of Required-Query margins, an underuse
// fraction and a Variety target. Each cell carries its `(city, preset)`, a set
// of eligible ids per kind, a bag of raw usage counts (some for eligible ids,
// some for ids outside the eligible set, so the "a draw is never hidden" path
// is exercised) and a list of per-seed Location sets for the Variety Metric.

/** A small, fixed id/kind/city/preset vocabulary so collisions are frequent. */
const KINDS = ['loc', 'cover-identity', 'archetype'] as const;
const IDS = ['x/a', 'x/b', 'x/c', 'x/d', 'x/e'] as const;
const CITIES = ['city/alpha', 'city/beta'] as const;
const PRESETS = ['easy', 'standard'] as const;

const kindArb = fc.constantFrom(...KINDS);
const idArb = fc.constantFrom(...IDS);

/** A raw usage event, as the write-only `UsageSink` records it. */
const usageCountArb: fc.Arbitrary<UsageCount> = fc.record({
  kind: kindArb,
  id: idArb,
  count: fc.integer({ min: 0, max: 50 }),
});

/** An eligibility map: for each kind, a (possibly empty) subset of the ids. */
const eligibleArb: fc.Arbitrary<Map<string, readonly string[]>> = fc
  .record(
    Object.fromEntries(
      KINDS.map((k) => [k, fc.subarray([...IDS], { minLength: 0, maxLength: IDS.length })]),
    ) as Record<(typeof KINDS)[number], fc.Arbitrary<string[]>>,
  )
  .map((rec) => {
    const m = new Map<string, readonly string[]>();
    for (const k of KINDS) {
      m.set(k, rec[k]);
    }
    return m;
  });

/** A per-seed Location set (ids drawn from a tiny location vocabulary). */
const locationSetArb: fc.Arbitrary<string[]> = fc.subarray(
  ['L1', 'L2', 'L3', 'L4'],
  { minLength: 0, maxLength: 4 },
);

const cellArb: fc.Arbitrary<CoverageCell> = fc
  .record({
    city: fc.constantFrom(...CITIES),
    preset: fc.constantFrom(...PRESETS),
    counts: fc.array(usageCountArb, { minLength: 0, maxLength: 12 }),
    eligible: eligibleArb,
    locationSets: fc.array(locationSetArb, { minLength: 0, maxLength: 4 }),
  })
  .map((c) => ({ ...c }) as CoverageCell);

const marginArb: fc.Arbitrary<RequiredQueryMargin> = fc.record({
  city: fc.constantFrom(...CITIES),
  query: fc.constantFrom('rq-cafe [function:cafe]', 'rq-drop [function:drop]', 'rq-safe [function:safehouse]'),
  binders: fc.integer({ min: 0, max: 20 }),
  min: fc.integer({ min: 0, max: 10 }),
});

const inputsArb: fc.Arbitrary<CoverageInputs> = fc.record({
  // Unique `(city, preset)` per cell so a cell's rows are unambiguous when the
  // oracle re-tallies counts; duplicate cells would merge in neither map.
  cells: fc
    .array(cellArb, { minLength: 0, maxLength: 4 })
    .map(dedupeCellsByCityPreset),
  requiredQueryMargins: fc.array(marginArb, { minLength: 0, maxLength: 6 }),
  underuse: fc.double({ min: 0, max: 1, noNaN: true }),
  varietyTarget: fc.double({ min: 0, max: 1, noNaN: true }),
});

/** Keep the first cell for each `(city, preset)` so cells don't collide. */
function dedupeCellsByCityPreset(cells: readonly CoverageCell[]): CoverageCell[] {
  const seen = new Set<string>();
  const out: CoverageCell[] = [];
  for (const c of cells) {
    const key = `${c.city}\u0000${c.preset}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(c);
    }
  }
  return out;
}

// --- independent oracles ----------------------------------------------------

/** Naive recount: `(kind, id) → summed count` from a cell's raw events. */
function recountCell(counts: readonly UsageCount[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of counts) {
    const key = `${c.kind}\u0000${c.id}`;
    m.set(key, (m.get(key) ?? 0) + c.count);
  }
  return m;
}

/** Naive per-kind total draws from a cell's raw events. */
function totalsByKind(counts: readonly UsageCount[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of counts) {
    m.set(c.kind, (m.get(c.kind) ?? 0) + c.count);
  }
  return m;
}

/** The oracle expected use for a kind: total draws ÷ eligible items (0 if none). */
function expectedFor(totalDraws: number, eligibleCount: number): number {
  return eligibleCount > 0 ? totalDraws / eligibleCount : 0;
}

/** The oracle flag: unused iff count 0, underused iff 0 < count < f × expected. */
function oracleFlag(count: number, expected: number, underuse: number): 'ok' | 'underused' | 'unused' {
  if (count === 0) {
    return 'unused';
  }
  return count < underuse * expected ? 'underused' : 'ok';
}

/** The id set the core produces a row for in a cell/kind: eligible ∪ drawn. */
function rowIdsFor(cell: CoverageCell, kind: string): Set<string> {
  const ids = new Set<string>(cell.eligible.get(kind) ?? []);
  for (const c of cell.counts) {
    if (c.kind === kind) {
      ids.add(c.id);
    }
  }
  return ids;
}

// --- the property -----------------------------------------------------------

describe('Property 17: Coverage accounting', () => {
  it('counts, expected use and flags match an independent recount of the inputs', () => {
    fc.assert(
      fc.property(inputsArb, (inputs) => {
        const report = buildCoverageReport(inputs);

        // Index the produced rows by (city, preset, kind, id).
        const rowKey = (city: string, preset: string, kind: string, id: string): string =>
          [city, preset, kind, id].join('\u0001');
        const byKey = new Map(
          report.rows.map((r) => [rowKey(r.city, r.preset, r.kind, r.id), r]),
        );
        // No duplicate rows: one row per (city, preset, kind, id).
        expect(byKey.size).toBe(report.rows.length);

        // Build the complete expected row set from the oracle and compare.
        let expectedRowCount = 0;
        for (const cell of inputs.cells) {
          const recount = recountCell(cell.counts);
          const totals = totalsByKind(cell.counts);
          const kinds = new Set<string>([...cell.eligible.keys(), ...totals.keys()]);

          for (const kind of kinds) {
            const eligibleCount = (cell.eligible.get(kind) ?? []).length;
            const expected = expectedFor(totals.get(kind) ?? 0, eligibleCount);
            const ids = rowIdsFor(cell, kind);

            for (const id of ids) {
              expectedRowCount += 1;
              const row = byKey.get(rowKey(cell.city, cell.preset, kind, id));
              expect(row).toBeDefined();
              if (row === undefined) {
                continue;
              }
              const count = recount.get(`${kind}\u0000${id}`) ?? 0;
              // Count = naive recount (Req 15.1).
              expect(row.count).toBe(count);
              // Expected = total draws ÷ eligible items (Req 15.3).
              expect(row.expected).toBeCloseTo(expected, 10);
              // Flag per the unused/underused rule (Req 15.3).
              expect(row.flag).toBe(oracleFlag(count, expected, inputs.underuse));
            }
          }
        }
        // The core produces exactly the oracle's rows — no more, no fewer.
        expect(report.rows.length).toBe(expectedRowCount);
      }),
      { numRuns: 500 },
    );
  });

  it('passes the Required Query margins through unchanged as a set (Req 15.2)', () => {
    fc.assert(
      fc.property(inputsArb, (inputs) => {
        const report = buildCoverageReport(inputs);
        // Same multiset of margins, order aside.
        const norm = (m: RequiredQueryMargin): string =>
          [m.city, m.query, m.binders, m.min].join('\u0001');
        const got = report.requiredQueryMargins.map(norm).sort();
        const want = inputs.requiredQueryMargins.map(norm).sort();
        expect(got).toEqual(want);
      }),
      { numRuns: 300 },
    );
  });

  it('reports the Variety Metric as the mean pairwise Jaccard, with pass = mean ≤ target', () => {
    fc.assert(
      fc.property(inputsArb, (inputs) => {
        const report = buildCoverageReport(inputs);
        const byKey = new Map(report.variety.map((v) => [`${v.city}\u0001${v.preset}`, v]));
        expect(report.variety.length).toBe(inputs.cells.length);
        for (const cell of inputs.cells) {
          const v = byKey.get(`${cell.city}\u0001${cell.preset}`);
          expect(v).toBeDefined();
          if (v === undefined) {
            continue;
          }
          const mean = meanPairwiseJaccard(cell.locationSets);
          expect(v.meanJaccard).toBeCloseTo(mean, 10);
          expect(v.pass).toBe(mean <= inputs.varietyTarget);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('produces byte-identical Markdown and CSV across repeated builds (Req 15.5)', () => {
    fc.assert(
      fc.property(inputsArb, (inputs) => {
        const a = buildCoverageReport(inputs);
        const b = buildCoverageReport(inputs);
        expect(toMarkdown(a)).toBe(toMarkdown(b));
        expect(toCsv(a)).toBe(toCsv(b));
      }),
      { numRuns: 200 },
    );
  });
});

// --- primitive cross-checks (flagFor / jaccard) -----------------------------
//
// Small properties pinning the two primitives Property 17's clauses rest on,
// independent of the cell plumbing above.

describe('Property 17 primitives: flagFor and jaccard', () => {
  it('flagFor is unused iff count 0, underused iff 0 < count < f × expected', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }),
        fc.double({ min: 0, max: 1000, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (count, expected, underuse) => {
          const flag = flagFor(count, expected, underuse);
          if (count === 0) {
            expect(flag).toBe('unused');
          } else if (count < underuse * expected) {
            expect(flag).toBe('underused');
          } else {
            expect(flag).toBe('ok');
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  it('jaccard equals |A ∩ B| / |A ∪ B| (1 for two empty sets), in [0, 1] and symmetric', () => {
    const idsArb = fc.subarray(['a', 'b', 'c', 'd', 'e'], { minLength: 0, maxLength: 5 });
    fc.assert(
      fc.property(idsArb, idsArb, (aIds, bIds) => {
        const a = new Set(aIds);
        const b = new Set(bIds);
        const j = jaccard(a, b);
        expect(j).toBeGreaterThanOrEqual(0);
        expect(j).toBeLessThanOrEqual(1);
        // Symmetric.
        expect(j).toBeCloseTo(jaccard(b, a), 12);
        // Oracle: intersection over union, with two empty sets identical.
        let inter = 0;
        for (const x of a) {
          if (b.has(x)) {
            inter += 1;
          }
        }
        const union = a.size + b.size - inter;
        const want = union === 0 ? 1 : inter / union;
        expect(j).toBeCloseTo(want, 12);
      }),
      { numRuns: 300 },
    );
  });
});

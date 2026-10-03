/**
 * Unit tests for the pure coverage-accounting core and the output writers
 * (content-expansion task 5.11; Property 17 clauses; Req 15.1, 15.2, 15.3,
 * 15.5).
 *
 * These exercise {@link buildCoverageReport} and the {@link flagFor},
 * {@link jaccard} and {@link meanPairwiseJaccard} primitives directly, plus the
 * Markdown and CSV writers, over hand-built cells — no generation, no
 * filesystem — so the accounting is pinned independently of the engine. The
 * orchestrator test (`coverage.spec.ts`) covers the end-to-end wiring against
 * the real core pack.
 */

import { describe, expect, it } from 'vitest';

import {
  buildCoverageReport,
  flagFor,
  jaccard,
  meanPairwiseJaccard,
  type CoverageCell,
  type RequiredQueryMargin,
} from './report.js';
import { toCsv, toMarkdown, CSV_HEADER } from './output.js';

/** A `(kind, id, count)` eligibility+count fixture for a one-cell report. */
function cell(
  city: string,
  preset: string,
  eligible: Record<string, string[]>,
  counts: { kind: string; id: string; count: number }[],
  locationSets: string[][] = [],
): CoverageCell {
  return {
    city,
    preset,
    counts,
    eligible: new Map(Object.entries(eligible)),
    locationSets,
  };
}

describe('flagFor — unused/underused/ok (Req 15.3)', () => {
  it('flags a zero count as unused regardless of expected', () => {
    expect(flagFor(0, 0, 0.25)).toBe('unused');
    expect(flagFor(0, 10, 0.25)).toBe('unused');
  });

  it('flags a positive count below the fraction × expected as underused', () => {
    // expected 8, fraction 0.25 → threshold 2. count 1 < 2 → underused.
    expect(flagFor(1, 8, 0.25)).toBe('underused');
  });

  it('flags a count at or above the threshold as ok', () => {
    // threshold 2; count 2 is not below 2.
    expect(flagFor(2, 8, 0.25)).toBe('ok');
    expect(flagFor(100, 8, 0.25)).toBe('ok');
  });

  it('never flags underused when expected is zero (nothing is below zero)', () => {
    expect(flagFor(3, 0, 0.25)).toBe('ok');
  });
});

describe('jaccard and meanPairwiseJaccard (Variety Metric, Req 15.4)', () => {
  it('is 1 for two identical sets and 0 for disjoint sets', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1);
    expect(jaccard(new Set(['a']), new Set(['b']))).toBe(0);
  });

  it('is |∩| / |∪| for overlapping sets', () => {
    // {a,b,c} vs {b,c,d}: intersection 2, union 4 → 0.5.
    expect(jaccard(new Set(['a', 'b', 'c']), new Set(['b', 'c', 'd']))).toBe(0.5);
  });

  it('treats two empty sets as identical (similarity 1)', () => {
    expect(jaccard(new Set(), new Set())).toBe(1);
  });

  it('averages over every unordered pair, and is 0 with fewer than two sets', () => {
    expect(meanPairwiseJaccard([])).toBe(0);
    expect(meanPairwiseJaccard([['a', 'b']])).toBe(0);
    // Three sets, pairwise Jaccards 0.5, 0, 0 → mean 1/6.
    const mean = meanPairwiseJaccard([
      ['a', 'b', 'c'],
      ['b', 'c', 'd'],
      ['x', 'y'],
    ]);
    expect(mean).toBeCloseTo((0.5 + 0 + 0) / 3, 10);
  });
});

describe('buildCoverageReport — rows, expected, flags (Property 17)', () => {
  it('produces a row for every eligible item, reporting an undrawn item as unused', () => {
    const c = cell(
      'city/x',
      'standard',
      { loc: ['loc:a', 'loc:b', 'loc:c', 'loc:d'] },
      [
        { kind: 'loc', id: 'loc:a', count: 10 },
        { kind: 'loc', id: 'loc:b', count: 1 },
        // loc:c and loc:d never drawn.
      ],
    );
    const report = buildCoverageReport({
      cells: [c],
      requiredQueryMargins: [],
      underuse: 0.25,
      varietyTarget: 0.6,
    });

    // Four eligible → four rows, even for the never-drawn ids.
    expect(report.rows).toHaveLength(4);
    const byId = new Map(report.rows.map((r) => [r.id, r]));

    // Expected use = total draws (11) / eligible (4) = 2.75.
    for (const r of report.rows) {
      expect(r.expected).toBeCloseTo(11 / 4, 10);
    }
    // Counts match the tallies exactly (Property 17: count = naive recount).
    expect(byId.get('loc:a')?.count).toBe(10);
    expect(byId.get('loc:b')?.count).toBe(1);
    expect(byId.get('loc:c')?.count).toBe(0);

    // Flags: a=ok (10 ≥ 0.6875), b=underused (1 < 0.6875? no → ok? recompute),
    // threshold = 0.25 × 2.75 = 0.6875. b=1 ≥ 0.6875 → ok; c,d = unused.
    expect(byId.get('loc:a')?.flag).toBe('ok');
    expect(byId.get('loc:b')?.flag).toBe('ok');
    expect(byId.get('loc:c')?.flag).toBe('unused');
    expect(byId.get('loc:d')?.flag).toBe('unused');
  });

  it('flags an item below the fraction × expected as underused', () => {
    // 8 eligible, one drawn 100 times, one drawn once, the rest 0 → total 101,
    // expected 101/8 = 12.625, threshold 0.25 × 12.625 = 3.156. The hot id is
    // ok, the once-drawn id (1 < 3.156) is underused, the rest unused.
    const eligible = Array.from({ length: 8 }, (_, i) => `loc:${i}`);
    const c = cell(
      'city/x',
      'standard',
      { loc: eligible },
      [
        { kind: 'loc', id: 'loc:0', count: 100 },
        { kind: 'loc', id: 'loc:1', count: 1 },
      ],
    );
    const report = buildCoverageReport({
      cells: [c],
      requiredQueryMargins: [],
      underuse: 0.25,
      varietyTarget: 0.6,
    });
    const byId = new Map(report.rows.map((r) => [r.id, r]));
    expect(byId.get('loc:1')?.flag).toBe('underused');
    expect(byId.get('loc:0')?.flag).toBe('ok');
    expect(byId.get('loc:2')?.flag).toBe('unused');
  });

  it('sorts rows worst-offender first (unused, then underused, then ok)', () => {
    const c = cell(
      'city/x',
      'standard',
      { loc: ['loc:hot', 'loc:cold', 'loc:dead'] },
      [
        { kind: 'loc', id: 'loc:hot', count: 100 },
        { kind: 'loc', id: 'loc:cold', count: 1 },
      ],
    );
    const report = buildCoverageReport({
      cells: [c],
      requiredQueryMargins: [],
      underuse: 0.25,
      varietyTarget: 0.6,
    });
    expect(report.rows.map((r) => r.flag)).toEqual(['unused', 'underused', 'ok']);
  });

  it('computes and sorts the Variety Metric, flagging a mean above the target', () => {
    const varied = cell('city/varied', 'standard', { loc: [] }, [], [
      ['a', 'b'],
      ['c', 'd'],
    ]);
    const stale = cell('city/stale', 'standard', { loc: [] }, [], [
      ['a', 'b', 'c'],
      ['a', 'b', 'c'],
    ]);
    const report = buildCoverageReport({
      cells: [varied, stale],
      requiredQueryMargins: [],
      underuse: 0.25,
      varietyTarget: 0.6,
    });
    const byCity = new Map(report.variety.map((v) => [v.city, v]));
    expect(byCity.get('city/varied')?.meanJaccard).toBe(0);
    expect(byCity.get('city/varied')?.pass).toBe(true);
    expect(byCity.get('city/stale')?.meanJaccard).toBe(1);
    expect(byCity.get('city/stale')?.pass).toBe(false);
    // Failures sort first.
    expect(report.variety[0].city).toBe('city/stale');
  });

  it('passes Required Query margins through, worst margin first (Req 15.2)', () => {
    const margins: RequiredQueryMargin[] = [
      { city: 'city/x', query: 'rq-cafe [function:cafe]', binders: 9, min: 2 },
      { city: 'city/x', query: 'rq-drop [function:drop]', binders: 2, min: 2 },
    ];
    const report = buildCoverageReport({
      cells: [],
      requiredQueryMargins: margins,
      underuse: 0.25,
      varietyTarget: 0.6,
    });
    // Worst margin (0) first.
    expect(report.requiredQueryMargins[0].query).toBe('rq-drop [function:drop]');
    expect(report.requiredQueryMargins[1].query).toBe('rq-cafe [function:cafe]');
  });

  it('is deterministic: two builds of the same inputs are deep-equal', () => {
    const inputs = {
      cells: [
        cell('city/x', 'standard', { loc: ['loc:a', 'loc:b'] }, [
          { kind: 'loc', id: 'loc:a', count: 3 },
        ], [['a'], ['a', 'b']]),
      ],
      requiredQueryMargins: [
        { city: 'city/x', query: 'q', binders: 3, min: 1 },
      ],
      underuse: 0.25,
      varietyTarget: 0.6,
    };
    expect(buildCoverageReport(inputs)).toEqual(buildCoverageReport(inputs));
  });
});

describe('output writers — coverage.md and coverage.csv (Req 15.5)', () => {
  const report = buildCoverageReport({
    cells: [
      cell(
        'city/x',
        'standard',
        { loc: ['loc:a', 'loc:b'], 'cover-identity': ['city/cov1'] },
        [
          { kind: 'loc', id: 'loc:a', count: 4 },
          { kind: 'cover-identity', id: 'city/cov1', count: 2 },
        ],
        [['a'], ['a', 'b']],
      ),
    ],
    requiredQueryMargins: [{ city: 'city/x', query: 'rq [t]', binders: 3, min: 2 }],
    underuse: 0.25,
    varietyTarget: 0.6,
  });

  it('CSV starts with the design header and has one line per row', () => {
    const csv = toCsv(report);
    const lines = csv.trimEnd().split('\n');
    expect(lines[0]).toBe(CSV_HEADER);
    expect(lines[0]).toBe('city,preset,kind,id,count,expected,flag');
    // Three eligible ids → three data lines.
    expect(lines).toHaveLength(1 + report.rows.length);
    expect(csv.endsWith('\n')).toBe(true);
  });

  it('CSV escapes a field containing a comma', () => {
    const r = buildCoverageReport({
      cells: [
        cell('city,comma', 'standard', { loc: ['loc:a'] }, [
          { kind: 'loc', id: 'loc:a', count: 1 },
        ]),
      ],
      requiredQueryMargins: [],
      underuse: 0.25,
      varietyTarget: 0.6,
    });
    expect(toCsv(r)).toContain('"city,comma"');
  });

  it('Markdown has the three section headers and a summary line', () => {
    const md = toMarkdown(report);
    expect(md).toContain('# Coverage Report');
    expect(md).toContain('## Usage');
    expect(md).toContain('## Required Query margins');
    expect(md).toContain('## Variety Metric');
    expect(md).toContain('unused');
    expect(md.endsWith('\n')).toBe(true);
  });

  it('both writers are byte-stable across runs', () => {
    expect(toCsv(report)).toBe(toCsv(report));
    expect(toMarkdown(report)).toBe(toMarkdown(report));
  });
});

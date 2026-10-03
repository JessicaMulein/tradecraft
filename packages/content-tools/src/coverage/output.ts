/**
 * The `coverage.md` and `coverage.csv` writers (content-expansion task 5.11;
 * design, "Coverage Report"; Req 15.5).
 *
 * Both renderers are pure string functions of a {@link CoverageReport}. The
 * report's rows, margins and Variety rows are already sorted deterministically
 * by the accounting core ({@link ./report}), so the output is byte-identical
 * for the same inputs across runs (Req 15.5) and uses `\n` line endings
 * throughout, matching the Preview CLI's byte-stable UTF-8 convention.
 *
 * - **`coverage.md`** — a human summary with three tables: the usage rows
 *   (worst offenders first — `unused` then `underused` then `ok`), the Required
 *   Query margins (worst margin first), and the Variety Metric per city and
 *   preset (failures first). Numbers are shown to a fixed precision so the
 *   text is stable.
 * - **`coverage.csv`** — one machine row per usage row:
 *   `city,preset,kind,id,count,expected,flag` (design, "Output"), with a header
 *   line. Fields that could contain a comma or quote are CSV-escaped.
 */

import type { CoverageReport, CoverageRow } from './report.js';

/** Render a number to a fixed 3-decimal string, so the text is byte-stable. */
function num(value: number): string {
  return value.toFixed(3);
}

/** The CSV header, matching the design's `coverage.csv` column list. */
export const CSV_HEADER = 'city,preset,kind,id,count,expected,flag';

/**
 * Render the coverage CSV: a header line and one line per usage row,
 * `city,preset,kind,id,count,expected,flag`. The rows are already sorted, so
 * the file is deterministic. Every field is CSV-escaped so an id or label with
 * a comma or quote cannot break a column.
 */
export function toCsv(report: CoverageReport): string {
  const lines = [CSV_HEADER];
  for (const row of report.rows) {
    lines.push(
      [
        csvField(row.city),
        csvField(row.preset),
        csvField(row.kind),
        csvField(row.id),
        String(row.count),
        num(row.expected),
        row.flag,
      ].join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

/** Escape a CSV field: quote and double inner quotes when it needs it. */
function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Render the coverage Markdown: a title, a short summary line, then the usage,
 * Required-Query-margin and Variety tables. The usage table lists worst
 * offenders first (the sort the report already applied); the summary line
 * counts the unused and underused items so an author sees the headline figure
 * without scanning the table.
 */
export function toMarkdown(report: CoverageReport): string {
  const unused = report.rows.filter((r) => r.flag === 'unused').length;
  const underused = report.rows.filter((r) => r.flag === 'underused').length;
  const varietyFails = report.variety.filter((v) => !v.pass).length;

  const sections: string[] = [];
  sections.push('# Coverage Report');
  sections.push(
    `${report.rows.length} items across ${report.variety.length} city/preset cells — ` +
      `${unused} unused, ${underused} underused, ${varietyFails} Variety-Metric failures.`,
  );

  sections.push(usageTable(report.rows));
  sections.push(marginTable(report));
  sections.push(varietyTable(report));

  return `${sections.join('\n\n')}\n`;
}

/** The usage table, worst offenders first (`unused`, then `underused`, then `ok`). */
function usageTable(rows: readonly CoverageRow[]): string {
  const header = [
    '## Usage',
    '',
    '| city | preset | kind | id | count | expected | flag |',
    '| --- | --- | --- | --- | ---: | ---: | --- |',
  ];
  if (rows.length === 0) {
    return [...header, '| _(no items)_ |  |  |  |  |  |  |'].join('\n');
  }
  const body = rows.map(
    (r) =>
      `| ${r.city} | ${r.preset} | ${r.kind} | ${r.id} | ${r.count} | ${num(r.expected)} | ${r.flag} |`,
  );
  return [...header, ...body].join('\n');
}

/** The Required-Query-margin table, worst margin first. */
function marginTable(report: CoverageReport): string {
  const header = [
    '## Required Query margins',
    '',
    '| city | query | binders | min | margin |',
    '| --- | --- | ---: | ---: | ---: |',
  ];
  if (report.requiredQueryMargins.length === 0) {
    return [...header, '| _(no Required Queries)_ |  |  |  |  |'].join('\n');
  }
  const body = report.requiredQueryMargins.map(
    (m) => `| ${m.city} | ${m.query} | ${m.binders} | ${m.min} | ${m.binders - m.min} |`,
  );
  return [...header, ...body].join('\n');
}

/** The Variety-Metric table, failures first. */
function varietyTable(report: CoverageReport): string {
  const header = [
    '## Variety Metric',
    '',
    '| city | preset | mean Jaccard | result |',
    '| --- | --- | ---: | --- |',
  ];
  if (report.variety.length === 0) {
    return [...header, '| _(no cities)_ |  |  |  |'].join('\n');
  }
  const body = report.variety.map(
    (v) => `| ${v.city} | ${v.preset} | ${num(v.meanJaccard)} | ${v.pass ? 'pass' : 'fail'} |`,
  );
  return [...header, ...body].join('\n');
}

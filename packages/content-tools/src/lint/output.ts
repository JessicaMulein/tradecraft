/**
 * Deterministic sorting and the text and JSON output of the Pack Linter
 * (content-expansion task 5.2; Req 13.3, 13.4; design, "Pack Linter").
 *
 * Findings are sorted by `(pack, file, path, rule)` so a run's output is
 * identical across repeated runs and directory permutations (design,
 * "Output"). The text form is one line per finding; the JSON form is
 * `{ findings, suppressions, summary }`. The exit code is non-zero when any
 * finding has error severity (Req 13.4).
 */

import type { Suppression } from './suppressions.js';
import type { LintFinding, LintSeverity } from './rules.js';

/**
 * The linter's result (data model: `LintReport`). `findings` are sorted;
 * `suppressions` lists the Suppressions that were applied (Req 13.5); `summary`
 * counts the findings by severity.
 */
export interface LintReport {
  readonly findings: readonly LintFinding[];
  readonly suppressions: readonly Suppression[];
  readonly summary: { readonly errors: number; readonly warnings: number; readonly info: number };
}

/** Compare two strings for a stable, locale-independent order. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Sort findings deterministically by `(pack, file, path, rule)` (design,
 * "Output"). The message is not a sort key: two findings differing only by
 * message share a location and rule, and their relative order is already fixed
 * by the stable sort over the order the rules produced them.
 */
export function sortFindings(findings: readonly LintFinding[]): LintFinding[] {
  return [...findings].sort(
    (a, b) =>
      cmp(a.pack, b.pack) ||
      cmp(a.file, b.file) ||
      cmp(a.path, b.path) ||
      cmp(a.rule, b.rule),
  );
}

/** Count findings by severity for the report summary. */
export function summarise(findings: readonly LintFinding[]): LintReport['summary'] {
  let errors = 0;
  let warnings = 0;
  let info = 0;
  for (const finding of findings) {
    if (finding.severity === 'error') {
      errors += 1;
    } else if (finding.severity === 'warning') {
      warnings += 1;
    } else {
      info += 1;
    }
  }
  return { errors, warnings, info };
}

/** Build a sorted {@link LintReport} from findings and applied Suppressions. */
export function buildReport(
  findings: readonly LintFinding[],
  suppressions: readonly Suppression[],
): LintReport {
  const sorted = sortFindings(findings);
  return { findings: sorted, suppressions, summary: summarise(sorted) };
}

/** The exit code: 0 when no finding has error severity, 1 otherwise (Req 13.4). */
export function exitCodeFor(report: LintReport): number {
  return report.summary.errors > 0 ? 1 : 0;
}

/** The uppercase tag shown for a severity in text output. */
function severityTag(severity: LintSeverity): string {
  return severity.toUpperCase();
}

/**
 * The text form: one line per finding, `SEVERITY rule pack/file:path message`,
 * then a trailing summary line, then the applied Suppressions. A finding with
 * an empty `path` omits the `:path` suffix.
 */
export function formatText(report: LintReport): string {
  const lines: string[] = [];
  for (const f of report.findings) {
    const location = f.path === '' ? `${f.pack}/${f.file}` : `${f.pack}/${f.file}:${f.path}`;
    const suffix = f.suppressed === undefined ? '' : ` (suppressed: ${f.suppressed})`;
    lines.push(`${severityTag(f.severity)} ${f.rule} ${location} ${f.message}${suffix}`);
  }
  const { errors, warnings, info } = report.summary;
  lines.push(`${errors} error(s), ${warnings} warning(s), ${info} info`);
  if (report.suppressions.length > 0) {
    lines.push(`${report.suppressions.length} suppression(s) applied:`);
    for (const s of report.suppressions) {
      lines.push(`  ${s.rule} ${s.path} — ${s.justification}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/** The JSON form: `{ findings, suppressions, summary }`, pretty-printed. */
export function formatJson(report: LintReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

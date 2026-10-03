/**
 * The comparison reports for the model evaluation harness (task 23.4; Req 18.4).
 *
 * Req 18.4: the harness "SHALL run the fixtures through both profiles from
 * `models.yaml` and produce a Markdown and a CSV comparison report". This module
 * owns the two things that sentence names:
 *
 *   1. the **result aggregate** a run produces — {@link ProfileEvalResult} per
 *      profile (its name, the recorded {@link JudgeIdentity}, its
 *      {@link MechanicalMetrics}, its per-scenario/per-role judge scores and any
 *      same-as-voice warning) and the {@link EvalComparison} that bundles the
 *      profiles together with the fixtures they ran; and
 *   2. the two **pure renderers** — {@link renderMarkdownReport} and
 *      {@link renderCsvReport} — that turn an {@link EvalComparison} into a
 *      string.
 *
 * ## The renderers are pure string builders
 *
 * Both take a structured {@link EvalComparison} and return a `string`. They read
 * no clock, touch no gateway and sort nothing by insertion order: profiles are
 * emitted in `comparison.profiles` order, scenarios in {@link EVAL_SCENARIOS}
 * order, roles in {@link METRIC_ROLES} order, and rubric criteria in the fixed
 * rubric's own criterion order. Every number is formatted through one of a small
 * set of fixed formatters (see {@link fmtRate}, {@link fmtMs}, {@link fmtTps},
 * {@link fmtScore}), so the same comparison always renders byte-for-byte the
 * same report. This is what lets a test pin the exact output and what lets two
 * runs on two days be diffed.
 *
 * ## What the Markdown report shows
 *
 * A human-readable document with four sections:
 *
 *   - a **header** naming the profiles compared and the fixtures run;
 *   - a **judge identity** block, one line per profile stating which model
 *     judged (Req 18.3's "report the judge model's identity"), and surfacing the
 *     same-as-voice warning when a profile's judge model equals its voice model;
 *   - a **mechanical metrics** table — one column per profile — covering the run
 *     totals (Leak Guard trips, Specifics Guard trips, chance leaks, Told List
 *     contradictions) and the per-role numbers (refusal rate, time to first
 *     sentence, tokens/sec for `voice` and `narrator`);
 *   - a **judge scores** table — the aggregate per scenario and the per-criterion
 *     scores within each scenario, one column per profile — so a reader can see
 *     "profile A voices the mole interrogation better, profile B narrates the
 *     stake-out better" at a glance.
 *
 * ## What the CSV report shows
 *
 * The same comparison as machine-readable rows. The schema is one flat table
 * with a fixed header (documented on {@link CSV_HEADER}); every row is one
 * `(profile, scenario, metric)` fact. A `scenario` of `*` marks a run-level
 * mechanical metric (not tied to a single scene); a concrete scenario tag marks
 * a judge score for that scene. The `role` column is the Model Role for a
 * per-role metric and empty for a run total. This flat shape is deliberately
 * tall-and-narrow so a spreadsheet or a script can pivot it any way without the
 * report having to guess the comparison the reader wants.
 */

import {
  EVAL_SCENARIOS,
  type EvalFixture,
  type EvalScenario,
} from '../eval-fixtures/eval-fixtures.js';
import {
  METRIC_ROLES,
  type MechanicalMetrics,
  type MetricRole,
} from '../metrics/mechanical-metrics.js';
import type { JudgeIdentity, JudgeResult } from '../judge/judge.js';
import {
  rubricForRole,
  type RubricCriterion,
  type RubricKind,
} from '../judge/rubric.js';

// ---------------------------------------------------------------------------
// The per-profile result aggregate
// ---------------------------------------------------------------------------

/**
 * One scored output in a profile's run: which scenario it came from, which Model
 * Role produced it, and the full {@link JudgeResult} (per-criterion scores,
 * aggregate, rubric kind). A scenario can carry more than one scored output —
 * the surveillance scene scores a `narrator` output, the dialogue scenes score a
 * `voice` reply — so the harness keeps a list keyed by both scenario and role.
 */
export interface ScenarioJudgeScore {
  /** Which of the five evaluation scenes this score is for (Req 18.5). */
  readonly scenario: EvalScenario;
  /** The Model Role whose output was graded (`voice` or `narrator`). */
  readonly role: MetricRole;
  /** The judge's full result for this output. */
  readonly result: JudgeResult;
}

/**
 * A single profile's eval result (Req 18.4). Bundles everything a report needs
 * about one `models.yaml` profile after it ran the fixtures:
 *
 *   - `profile`  — the profile name (the key under `profiles` in `models.yaml`);
 *   - `judge`    — the recorded {@link JudgeIdentity} (which model judged, from
 *     which active profile) (Req 18.3);
 *   - `metrics`  — the aggregated {@link MechanicalMetrics} for the run (Req 18.2);
 *   - `judgeScores` — the per-scenario/per-role judge scores (Req 18.3); and
 *   - `warning`  — the same-as-voice warning when this profile's judge model
 *     equals its voice model, or `null`.
 *
 * The warning is lifted to the top level (as well as living on each
 * {@link JudgeResult}) so a report can surface it once per profile without
 * walking every score.
 */
export interface ProfileEvalResult {
  /** The profile name from `models.yaml`. */
  readonly profile: string;
  /** Who judged this profile's outputs (Req 18.3). */
  readonly judge: JudgeIdentity;
  /** The mechanical metrics for the run (Req 18.2). */
  readonly metrics: MechanicalMetrics;
  /** The judge scores, one per scored output, in run order. */
  readonly judgeScores: readonly ScenarioJudgeScore[];
  /** The same-as-voice warning for this profile, or `null`. */
  readonly warning: string | null;
}

/**
 * The comparison a report renders (Req 18.4): the profiles' results and the
 * fixtures they ran. "Run both profiles from `models.yaml`" means `profiles`
 * holds a {@link ProfileEvalResult} for each profile the config defined, in the
 * order the harness ran them; a report lays them out side by side. `fixtures`
 * records which fixtures were run so the header can name them (and so a reader
 * knows the comparison covered all five scenes).
 */
export interface EvalComparison {
  /** One result per profile, in the order the harness ran them. */
  readonly profiles: readonly ProfileEvalResult[];
  /** The fixtures the profiles were run against. */
  readonly fixtures: readonly EvalFixture[];
}

// ---------------------------------------------------------------------------
// Fixed number formatting (determinism)
// ---------------------------------------------------------------------------

/** A `null` numeric renders as a stable dash so an undefined rate is legible. */
const NA = '—';

/** Format a 0..1 rate as a percentage with one decimal (or the dash). */
function fmtRate(rate: number | null): string {
  return rate === null ? NA : `${(rate * 100).toFixed(1)}%`;
}

/** Format a millisecond figure as an integer count of ms (or the dash). */
function fmtMs(ms: number | null): string {
  return ms === null ? NA : `${Math.round(ms)} ms`;
}

/** Format a tokens/sec figure with one decimal (or the dash). */
function fmtTps(tps: number | null): string {
  return tps === null ? NA : tps.toFixed(1);
}

/** Format a judge score / aggregate with two decimals. */
function fmtScore(score: number): string {
  return score.toFixed(2);
}

/** Format a plain integer count. */
function fmtInt(n: number): string {
  return `${n}`;
}

// ---------------------------------------------------------------------------
// Shared row ordering
// ---------------------------------------------------------------------------

/**
 * The run-total mechanical metrics, in fixed row order, each with a label and a
 * reader off {@link MechanicalMetrics}. These are not per-role — they are counts
 * over the whole run — so they share one ordering used by both renderers.
 */
const RUN_TOTAL_METRICS: readonly {
  readonly key: string;
  readonly label: string;
  readonly read: (m: MechanicalMetrics) => string;
}[] = [
  {
    key: 'leak-guard-trips',
    label: 'Leak Guard trips',
    read: (m) => fmtInt(m.leakGuardTrips),
  },
  {
    key: 'leak-guard-hits',
    label: 'Leak Guard hits',
    read: (m) => fmtInt(m.leakGuardHits),
  },
  {
    key: 'specifics-guard-trips',
    label: 'Specifics Guard trips',
    read: (m) => fmtInt(m.specificsGuardTrips),
  },
  {
    key: 'chance-leaks',
    label: 'Chance leaks',
    read: (m) => fmtInt(m.chanceLeaks),
  },
  {
    key: 'told-list-contradictions',
    label: 'Told List contradictions',
    read: (m) => fmtInt(m.toldListContradictions),
  },
];

/**
 * The per-role mechanical metrics, in fixed row order, each with a label and a
 * reader off {@link MechanicalMetrics} for a given role. Iterated once per
 * {@link MetricRole} so both renderers walk roles the same way.
 */
const PER_ROLE_METRICS: readonly {
  readonly key: string;
  readonly label: string;
  readonly read: (m: MechanicalMetrics, role: MetricRole) => string;
}[] = [
  {
    key: 'refusal-rate',
    label: 'Refusal rate',
    read: (m, role) => fmtRate(m.refusalRate[role].rate),
  },
  {
    key: 'ttfs-mean',
    label: 'Time to first sentence (mean)',
    read: (m, role) => fmtMs(m.timeToFirstSentence[role].meanMs),
  },
  {
    key: 'ttfs-max',
    label: 'Time to first sentence (max)',
    read: (m, role) => fmtMs(m.timeToFirstSentence[role].maxMs),
  },
  {
    key: 'tokens-per-sec',
    label: 'Tokens per second',
    read: (m, role) => fmtTps(m.tokensPerSecond[role].tokensPerSec),
  },
];

/**
 * Look up a profile's scored output for a `(scenario, role)` pair, or
 * `undefined` when that profile produced none (a scenario that scores only one
 * role leaves the other empty). The lookup is linear over a profile's scores —
 * the list is tiny (one per scene) — and returns the first match in run order.
 */
function scoreFor(
  profile: ProfileEvalResult,
  scenario: EvalScenario,
  role: MetricRole,
): JudgeResult | undefined {
  return profile.judgeScores.find(
    (s) => s.scenario === scenario && s.role === role,
  )?.result;
}

/**
 * The set of `(scenario, role)` pairs any profile scored, in fixed order:
 * scenarios in {@link EVAL_SCENARIOS} order, roles in {@link METRIC_ROLES}
 * order. A pair is included when *at least one* profile scored it, so the two
 * reports show the same rows for every profile (a profile that did not score a
 * pair shows a dash there) rather than a ragged per-profile set.
 */
function scoredPairs(
  comparison: EvalComparison,
): readonly { readonly scenario: EvalScenario; readonly role: MetricRole }[] {
  const pairs: { scenario: EvalScenario; role: MetricRole }[] = [];
  for (const scenario of EVAL_SCENARIOS) {
    for (const role of METRIC_ROLES) {
      const any = comparison.profiles.some(
        (p) => scoreFor(p, scenario, role) !== undefined,
      );
      if (any) pairs.push({ scenario, role });
    }
  }
  return pairs;
}

/** The rubric kind a `(scenario, role)` pair is graded under. */
function rubricKindFor(role: MetricRole): RubricKind {
  return rubricForRole(role).kind;
}

/** The ordered criteria for a role's rubric. */
function criteriaFor(role: MetricRole): readonly RubricCriterion[] {
  return rubricForRole(role).criteria;
}

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------

/** Join cells into a Markdown table row. */
function mdRow(cells: readonly string[]): string {
  return `| ${cells.join(' | ')} |`;
}

/** The `---` separator row for a table of `n` columns. */
function mdDivider(n: number): string {
  return mdRow(Array.from({ length: n }, () => '---'));
}

/**
 * Render the Markdown comparison report (Req 18.4). A pure function of the
 * {@link EvalComparison}: deterministic column order (the profiles as given),
 * deterministic row order (fixed metric rows, scenarios in
 * {@link EVAL_SCENARIOS} order, criteria in rubric order) and fixed number
 * formatting, so the same comparison always renders the same document.
 */
export function renderMarkdownReport(comparison: EvalComparison): string {
  const { profiles, fixtures } = comparison;
  const out: string[] = [];

  // --- Header ---
  out.push('# Model evaluation comparison');
  out.push('');
  const names = profiles.map((p) => p.profile);
  out.push(
    `Profiles compared: ${names.length === 0 ? '(none)' : names.map((n) => `\`${n}\``).join(', ')}.`,
  );
  const scenes = fixtures.map((f) => f.scenario);
  out.push(
    `Fixtures run (${fixtures.length}): ${
      scenes.length === 0 ? '(none)' : scenes.map((s) => `\`${s}\``).join(', ')
    }.`,
  );
  out.push('');

  // --- Judge identity (Req 18.3) ---
  out.push('## Judge identity');
  out.push('');
  for (const p of profiles) {
    out.push(
      `- **${p.profile}** — judged by \`${p.judge.model}\` (active profile ` +
        `\`${p.judge.profile}\`).`,
    );
    if (p.warning !== null) {
      out.push(`  - ⚠️ ${p.warning}`);
    }
  }
  if (profiles.length === 0) out.push('- (no profiles)');
  out.push('');

  // --- Mechanical metrics (Req 18.2) ---
  out.push('## Mechanical metrics');
  out.push('');
  const metricHeader = ['Metric', ...names];
  out.push(mdRow(metricHeader));
  out.push(mdDivider(metricHeader.length));
  for (const row of RUN_TOTAL_METRICS) {
    out.push(mdRow([row.label, ...profiles.map((p) => row.read(p.metrics))]));
  }
  for (const role of METRIC_ROLES) {
    for (const row of PER_ROLE_METRICS) {
      out.push(
        mdRow([
          `${row.label} (${role})`,
          ...profiles.map((p) => row.read(p.metrics, role)),
        ]),
      );
    }
  }
  out.push('');

  // --- Judge scores (Req 18.3) ---
  out.push('## Judge scores');
  out.push('');
  const pairs = scoredPairs(comparison);
  if (pairs.length === 0) {
    out.push('_No judge scores recorded._');
    out.push('');
  } else {
    const scoreHeader = ['Scenario', 'Role', 'Criterion', ...names];
    out.push(mdRow(scoreHeader));
    out.push(mdDivider(scoreHeader.length));
    for (const { scenario, role } of pairs) {
      // Aggregate row first, then one row per rubric criterion.
      out.push(
        mdRow([
          scenario,
          role,
          `aggregate (${rubricKindFor(role)})`,
          ...profiles.map((p) => {
            const r = scoreFor(p, scenario, role);
            return r === undefined ? NA : fmtScore(r.aggregate);
          }),
        ]),
      );
      for (const criterion of criteriaFor(role)) {
        out.push(
          mdRow([
            scenario,
            role,
            criterion.id,
            ...profiles.map((p) => {
              const r = scoreFor(p, scenario, role);
              if (r === undefined) return NA;
              const s = r.scores.find((x) => x.criterionId === criterion.id);
              return s === undefined ? NA : fmtScore(s.score);
            }),
          ]),
        );
      }
    }
    out.push('');
  }

  return out.join('\n');
}

// ---------------------------------------------------------------------------
// CSV renderer
// ---------------------------------------------------------------------------

/**
 * The CSV column header, documenting the flat schema (Req 18.4). One row per
 * `(profile, scenario, metric)` fact:
 *
 *   - `profile`       — the `models.yaml` profile name;
 *   - `scenario`      — the evaluation scene tag, or `*` for a run-level
 *     mechanical metric not tied to one scene;
 *   - `role`          — the Model Role for a per-role metric or judge score;
 *     empty for a run-total mechanical metric;
 *   - `metric`        — the metric key (a `RUN_TOTAL_METRICS`/`PER_ROLE_METRICS`
 *     key, or `judge-aggregate` / a rubric criterion id for a judge score);
 *   - `kind`          — `mechanical` or `judge`, so a consumer can split the two
 *     families without parsing the metric key;
 *   - `value`         — the numeric value, formatted the same way the Markdown
 *     report formats it (so the two reports never disagree), or empty for an
 *     undefined/`null` value;
 *   - `judge_model`   — the judge model id recorded for the profile (Req 18.3),
 *     on every row so a single row is self-describing;
 *   - `warning`       — the profile's same-as-voice warning, repeated on every
 *     row for that profile, or empty.
 */
export const CSV_HEADER = [
  'profile',
  'scenario',
  'role',
  'metric',
  'kind',
  'value',
  'judge_model',
  'warning',
] as const;

/** Quote a CSV field per RFC 4180 when it holds a comma, quote or newline. */
function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Join cells into one CSV line. */
function csvLine(cells: readonly string[]): string {
  return cells.map(csvField).join(',');
}

/**
 * Render the CSV comparison report (Req 18.4). A pure function of the
 * {@link EvalComparison}: the fixed {@link CSV_HEADER} first, then rows in a
 * deterministic order — for each profile (in `profiles` order), its run-total
 * mechanical metrics, then its per-role mechanical metrics (roles in
 * {@link METRIC_ROLES} order), then its judge scores (scenarios in
 * {@link EVAL_SCENARIOS} order, aggregate then rubric criteria). Values are
 * formatted identically to the Markdown report, so the two never disagree.
 *
 * Rows are grouped by profile (rather than interleaved by metric) because the
 * flat schema already carries the profile on every row; grouping keeps the file
 * readable and the order stable without changing what a pivot recovers.
 */
export function renderCsvReport(comparison: EvalComparison): string {
  const { profiles } = comparison;
  const lines: string[] = [csvLine(CSV_HEADER)];

  for (const p of profiles) {
    const warning = p.warning ?? '';
    const judgeModel = p.judge.model;

    const row = (
      scenario: string,
      role: string,
      metric: string,
      kind: 'mechanical' | 'judge',
      value: string,
    ): void => {
      lines.push(
        csvLine([
          p.profile,
          scenario,
          role,
          metric,
          kind,
          value,
          judgeModel,
          warning,
        ]),
      );
    };

    // Run-total mechanical metrics: scenario '*', no role.
    for (const m of RUN_TOTAL_METRICS) {
      row('*', '', m.key, 'mechanical', m.read(p.metrics));
    }
    // Per-role mechanical metrics: scenario '*', the role.
    for (const role of METRIC_ROLES) {
      for (const m of PER_ROLE_METRICS) {
        row('*', role, m.key, 'mechanical', m.read(p.metrics, role));
      }
    }

    // Judge scores: the scenario, the role, aggregate then each criterion.
    for (const scenario of EVAL_SCENARIOS) {
      for (const role of METRIC_ROLES) {
        const r = scoreFor(p, scenario, role);
        if (r === undefined) continue;
        row(scenario, role, 'judge-aggregate', 'judge', fmtScore(r.aggregate));
        for (const criterion of criteriaFor(role)) {
          const s = r.scores.find((x) => x.criterionId === criterion.id);
          row(
            scenario,
            role,
            criterion.id,
            'judge',
            s === undefined ? '' : fmtScore(s.score),
          );
        }
      }
    }
  }

  return lines.join('\n');
}

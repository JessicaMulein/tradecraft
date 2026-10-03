/**
 * The Pack Linter's rule table and the core framework types (content-expansion
 * task 5.2; design, "Pack Linter"; Requirement 13).
 *
 * A {@link LintRule} is one Defect Class: its id, the human-readable defect it
 * names, its default severity, whether a pack may suppress it and whether it
 * only runs in the `release` profile. A rule's `check` reads a {@link
 * LintContext} — the loaded Content Set (or `null` when loading failed), the
 * loader's errors, the effective Content Kind Registry, the active profile, an
 * optional Baseline Manifest and the parsed files — and returns the {@link
 * LintFinding}s it found.
 *
 * This task fixes the rule table, the framework types and the orchestration.
 * The concrete rule bodies land in tasks 5.3 (reference, identity and
 * text-safety rules) and 5.4 (period, style, quantity and stability rules); a
 * rule that is not implemented yet is registered here with an empty `check` so
 * the framework runs the whole table and the generic Field-Declaration plumbing
 * (Requirement 13.8) is exercised from day one.
 */

import type {
  ContentError,
  ContentKindRegistration,
  ContentManifest,
  ContentSet,
} from '@tradecraft/content';

import type { ParsedPack } from './parsed-files.js';
import { quantityCheck, feasibleCheck, plotBindCheck, idStableCheck } from './stability-rules.js';

/** The Lint Profiles (design, "Pack Linter"). */
export type LintProfile = 'draft' | 'release';

/** A finding's severity. `info` is also the result of a suppression (Req 13.5). */
export type LintSeverity = 'error' | 'warning' | 'info';

/**
 * One Defect Class the linter checks for (design, "Pack Linter"). `defect` is
 * the prose name used in messages and docs; `severity` is the finding's default
 * severity; `suppressible` says whether a pack's `lint.yaml` may downgrade a
 * matching finding (Req 13.5); `releaseOnly` runs the rule only in the
 * `release` profile; and `releaseSeverity` raises the severity under `release`
 * (CE-QUANTITY is a warning in `draft` and an error in `release`).
 */
export interface LintRule {
  readonly id: string;
  readonly defect: string;
  readonly severity: LintSeverity;
  readonly suppressible: boolean;
  readonly releaseOnly?: boolean;
  readonly releaseSeverity?: LintSeverity;
  /** The checks this rule performs over the context (empty until 5.3/5.4). */
  check(ctx: LintContext): LintFinding[];
}

/**
 * A single reported defect (design, "Pack Linter"; Req 13.3). `rule` is the
 * rule id, `severity` the effective severity, `pack`/`file`/`path` the location
 * and `message` the human-readable description. `suppressed` carries the
 * justification when a Suppression downgraded the finding to `info` (Req 13.5).
 */
export interface LintFinding {
  readonly rule: string;
  readonly severity: LintSeverity;
  readonly pack: string;
  readonly file: string;
  readonly path: string;
  readonly message: string;
  readonly suppressed?: string;
}

/**
 * The Baseline Manifest a `--baseline` run compares against (data model;
 * Req 13.7): the Content Manifest it was taken from and, per pack, the content
 * ids it then held. CE-IDSTABLE (task 5.4) reports an id present here and
 * missing now.
 */
export interface BaselineManifest {
  readonly manifest: ContentManifest;
  readonly ids: Record<string, readonly string[]>;
}

/**
 * Everything a rule reads (design, "Pack Linter"). `set` is the loaded Content
 * Set, or `null` when loading failed; `loadErrors` are the loader's
 * {@link ContentError}s (already mapped to findings by the framework, but
 * available to rules that want them); `registry` is the effective Content Kind
 * Registry whose Field Declarations the generic rules walk (Req 13.8);
 * `profile` is the active Lint Profile; `baseline` is the optional Baseline
 * Manifest; and `packs` are the parsed, pack-relative files — present even when
 * loading failed, so a rule still runs wherever its inputs exist (Req 13.1).
 */
export interface LintContext {
  readonly set: ContentSet | null;
  readonly loadErrors: readonly ContentError[];
  readonly registry: readonly ContentKindRegistration[];
  readonly profile: LintProfile;
  readonly baseline?: BaselineManifest;
  readonly packs: readonly ParsedPack[];
}

/** A rule that is not implemented yet contributes no findings of its own. */
const notYetImplemented = (): LintFinding[] => [];

/**
 * The rule table (design, "Pack Linter"). The id, severity and suppressibility
 * of every Defect Class are fixed here; the ContentError mapping
 * ({@link ../error-map}) and the generic Field-Declaration plumbing
 * ({@link ../generic-rules}) reference these ids, so the table is the single
 * source of truth for which defects exist and how severe they are.
 *
 * Ordered as in the design's table. The purely loader-backed rules (CE-SCHEMA,
 * CE-REF, CE-DUPID, CE-SLOT, CE-TAG, CE-CONFORM, CE-VARIANT, CE-PROVENANCE)
 * draw their findings from the mapped loader errors rather than from `check`,
 * so their `check` stays empty. The text, period, style and identity rules of
 * tasks 5.3/5.4 run as generic Field-Declaration rules ({@link
 * ../generic-rules}), so their rule-table `check` is also empty. The three
 * whole-set rules of task 5.4 — CE-QUANTITY, CE-FEASIBLE and CE-IDSTABLE — read
 * the Content Set, the baseline and the parsed packs directly, so they carry an
 * own `check` ({@link ../stability-rules}); CE-FEASIBLE additionally receives
 * loader-backed findings on a failed load, under the same rule id.
 */
export const LINT_RULES: readonly LintRule[] = [
  { id: 'CE-SCHEMA', defect: 'Schema violation', severity: 'error', suppressible: false, check: notYetImplemented },
  { id: 'CE-REF', defect: 'Dangling or cross-city reference', severity: 'error', suppressible: false, check: notYetImplemented },
  { id: 'CE-DUPID', defect: 'Duplicate id or illegal override', severity: 'error', suppressible: false, check: notYetImplemented },
  { id: 'CE-SLOT', defect: 'Undeclared template slot', severity: 'error', suppressible: false, check: notYetImplemented },
  { id: 'CE-TAG', defect: 'Unknown or inapplicable Tag', severity: 'error', suppressible: false, check: notYetImplemented },
  { id: 'CE-CONFORM', defect: 'Tag Conformance shortfall', severity: 'error', suppressible: false, check: notYetImplemented },
  { id: 'CE-FEASIBLE', defect: 'Instantiation infeasible for some seed or year', severity: 'error', suppressible: false, check: feasibleCheck },
  { id: 'CE-PLOTBIND', defect: 'City binds no public Location for a plot signal-route place', severity: 'error', suppressible: false, check: plotBindCheck },
  { id: 'CE-ANACH', defect: 'Anachronism term or technology item before its year', severity: 'error', suppressible: true, check: notYetImplemented },
  { id: 'CE-PERIOD', defect: 'Year Range outside the city or era Period Window', severity: 'error', suppressible: true, check: notYetImplemented },
  { id: 'CE-DUPTEXT', defect: 'Exact duplicate text within (kind, field)', severity: 'warning', suppressible: true, check: notYetImplemented },
  { id: 'CE-NEARDUP', defect: 'Near-duplicate text', severity: 'warning', suppressible: true, check: notYetImplemented },
  { id: 'CE-NAMEDUP', defect: 'Duplicate entry within a Name Pool', severity: 'error', suppressible: true, check: notYetImplemented },
  { id: 'CE-REALPERSON', defect: 'Real-Person Blocklist match', severity: 'error', suppressible: false, check: notYetImplemented },
  { id: 'CE-SENSITIVE', defect: 'Sensitivity Term match', severity: 'error', suppressible: false, check: notYetImplemented },
  {
    id: 'CE-QUANTITY',
    defect: 'Quantity Target shortfall',
    severity: 'warning',
    releaseSeverity: 'error',
    suppressible: false,
    check: quantityCheck,
  },
  { id: 'CE-VARIANT', defect: 'Template Variant slot mismatch', severity: 'error', suppressible: false, check: notYetImplemented },
  { id: 'CE-ALLOWLIST', defect: 'Locale allowlist entry equals a distinctive entity alias', severity: 'error', suppressible: true, check: notYetImplemented },
  { id: 'CE-SOURCE', defect: 'real-landmark Location without a source', severity: 'error', suppressible: true, check: notYetImplemented },
  { id: 'CE-PROVENANCE', defect: 'Generated content missing reviewer or review time', severity: 'error', suppressible: false, check: notYetImplemented },
  { id: 'CE-STYLE', defect: 'Mechanical Style Guide rule broken', severity: 'warning', suppressible: true, check: notYetImplemented },
  { id: 'CE-IDSTABLE', defect: 'Id removed against the Baseline Manifest within a major version', severity: 'error', suppressible: false, check: idStableCheck },
];

/** The rule table indexed by id, for mapping and output. */
export const RULES_BY_ID: ReadonlyMap<string, LintRule> = new Map(
  LINT_RULES.map((rule) => [rule.id, rule]),
);

/**
 * The rules a Suppression may never silence (Req 13.6). A `lint.yaml`
 * suppression naming any of these is ignored and reported as a CE-SCHEMA error
 * on the offending entry. Derived from the rule table's `suppressible` flag so
 * the two never drift apart.
 */
export const NON_SUPPRESSIBLE_RULES: ReadonlySet<string> = new Set(
  LINT_RULES.filter((rule) => !rule.suppressible).map((rule) => rule.id),
);

/**
 * The effective severity of a rule under a profile. CE-QUANTITY is a warning in
 * `draft` and an error in `release` (design, "Pack Linter"); every other rule
 * keeps its default severity.
 */
export function effectiveSeverity(rule: LintRule, profile: LintProfile): LintSeverity {
  if (profile === 'release' && rule.releaseSeverity !== undefined) {
    return rule.releaseSeverity;
  }
  return rule.severity;
}

/** Whether a rule runs under a profile (a `releaseOnly` rule skips `draft`). */
export function ruleRunsInProfile(rule: LintRule, profile: LintProfile): boolean {
  return !(rule.releaseOnly === true && profile === 'draft');
}

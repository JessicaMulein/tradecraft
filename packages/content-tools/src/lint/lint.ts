/**
 * The `lint()` orchestrator (content-expansion task 5.2; design, "Pack Linter";
 * Req 13.1, 13.3, 13.4, 13.5, 13.6, 13.8).
 *
 * `lint(dirs, selected, opts)` is the deterministic core of the Pack Linter:
 *
 * 1. Read and parse every pack's files itself, so the rules run over the parsed
 *    files even when loading fails (Req 13.1; {@link readParsedPacks}).
 * 2. Run the Content Loader. Every loader {@link ContentError} becomes a
 *    finding under its matching rule (Req 13.1; {@link findingForError}).
 * 3. Build the {@link LintContext}: the Content Set (or `null` on failure), the
 *    loader errors, the effective Content Kind Registry, the profile, the
 *    optional Baseline Manifest and the parsed packs.
 * 4. Run every Lint Rule's `check` and the generic Field-Declaration rules
 *    (Req 13.8). The loader-backed rules draw from the mapped errors instead.
 * 5. Collect `lint.yaml` Suppressions, rejecting any that name a
 *    non-suppressible rule with a CE-SCHEMA error (Req 13.6), and downgrade a
 *    matching suppressible finding to informational (Req 13.5).
 * 6. Sort the findings `(pack, file, path, rule)` and build the report
 *    (Req 13.3).
 *
 * The result is a {@link LintReport}; the CLI ({@link ../index}) renders it as
 * text or JSON and sets the exit code. `lint()` reads no argv and writes no
 * output, so it is fully testable.
 */

import { loadContent, type LoadOptions } from '@tradecraft/content';
import {
  SLICE_KIND_REGISTRATIONS,
  CONTENT_EXPANSION_KIND_REGISTRATIONS,
  type ContentKindRegistration,
} from '@tradecraft/content';

import {
  LINT_RULES,
  effectiveSeverity,
  ruleRunsInProfile,
  type BaselineManifest,
  type LintContext,
  type LintFinding,
  type LintProfile,
  type LintRule,
} from './rules.js';
import { readParsedPacks } from './parsed-files.js';
import { findingForError } from './error-map.js';
import { collectSuppressions, applySuppressions } from './suppressions.js';
import { runGenericRules, GENERIC_FIELD_RULES, type GenericFieldRule } from './generic-rules.js';
import { buildReport, type LintReport } from './output.js';

/** Options to {@link lint}. */
export interface LintOptions {
  readonly profile?: LintProfile;
  readonly baseline?: BaselineManifest;
  /** Extra content kinds (follow-on specs register through here, as the loader does). */
  readonly kinds?: readonly ContentKindRegistration[];
  /** Override the rule set — tests inject rules; defaults to {@link LINT_RULES}. */
  readonly rules?: readonly LintRule[];
  /** Override the generic Field-Declaration rules — defaults to {@link GENERIC_FIELD_RULES}. */
  readonly genericRules?: readonly GenericFieldRule[];
}

/**
 * Build the effective Content Kind Registry the linter walks: the slice kinds,
 * this spec's kinds and any caller-supplied kinds, de-duplicated by kind name
 * with earlier registrations winning — the same precedence the loader uses, so
 * the linter and the loader agree on every kind's Field Declarations (Req 13.8,
 * 17.1).
 */
function effectiveRegistry(
  kinds: readonly ContentKindRegistration[] | undefined,
): ContentKindRegistration[] {
  const byKind = new Map<string, ContentKindRegistration>();
  for (const reg of [
    ...SLICE_KIND_REGISTRATIONS,
    ...CONTENT_EXPANSION_KIND_REGISTRATIONS,
    ...(kinds ?? []),
  ]) {
    if (!byKind.has(reg.kind)) {
      byKind.set(reg.kind, reg);
    }
  }
  return [...byKind.values()];
}

/**
 * Lint the selected packs from the given directories, deterministically.
 * Returns the {@link LintReport}; it never throws for a content defect — a
 * defect is a finding, not an exception.
 */
export function lint(
  dirs: readonly string[],
  selected: readonly string[],
  opts: LintOptions = {},
): LintReport {
  const profile: LintProfile = opts.profile ?? 'draft';
  const rules = opts.rules ?? LINT_RULES;
  const genericRules = opts.genericRules ?? GENERIC_FIELD_RULES;

  // 1. Parse the packs ourselves so rules see the files even when loading fails.
  const packs = readParsedPacks(dirs);

  // 2. Run the loader and map every error to its rule.
  const loadOptions: LoadOptions | undefined =
    opts.kinds === undefined ? undefined : { kinds: opts.kinds };
  const loaded = loadContent(dirs, selected, loadOptions);
  const loadErrors = loaded.ok ? [] : loaded.errors;
  const loaderFindings: LintFinding[] = loadErrors.map((error) =>
    findingForError(error, profile),
  );

  // 3. Build the context the rules read.
  const ctx: LintContext = {
    set: loaded.ok ? loaded.value : null,
    loadErrors,
    registry: effectiveRegistry(opts.kinds),
    profile,
    baseline: opts.baseline,
    packs,
  };

  // 4. Run each rule's own check (profile-gated) at the profile's severity,
  //    then the generic Field-Declaration rules. The loader-backed rules have
  //    an empty `check` and contribute only through the mapped loader errors.
  const ruleFindings: LintFinding[] = [];
  for (const rule of rules) {
    if (!ruleRunsInProfile(rule, profile)) {
      continue;
    }
    const severity = effectiveSeverity(rule, profile);
    for (const finding of rule.check(ctx)) {
      // A rule reports its own rule id and location; the orchestrator pins the
      // severity to the profile's effective severity so a rule cannot bypass
      // the draft/release distinction.
      ruleFindings.push({ ...finding, rule: rule.id, severity });
    }
  }
  const genericFindings = runGenericRules(ctx, genericRules);

  // 5. Suppressions: reject non-suppressible entries (CE-SCHEMA errors) and
  //    downgrade matching suppressible findings to informational.
  const { suppressions, errors: suppressionErrors } = collectSuppressions(packs);
  const allFindings = [
    ...loaderFindings,
    ...ruleFindings,
    ...genericFindings,
    ...suppressionErrors,
  ];
  const suppressed = applySuppressions(allFindings, suppressions);

  // 6. Sort and summarise.
  const applied = suppressions.filter((s) =>
    suppressed.some(
      (f) => f.suppressed !== undefined && f.pack === s.pack && f.rule === s.rule && f.path === s.path,
    ),
  );
  return buildReport(suppressed, applied);
}

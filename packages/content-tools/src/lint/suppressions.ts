/**
 * Suppressions from a pack's `lint.yaml` (content-expansion task 5.2; Req 13.5,
 * 13.6; design, "Pack Linter").
 *
 * A pack may carry a `lint.yaml` listing `{ rule, path, justification }`
 * Suppressions. A Suppression for a *suppressible* rule with a non-empty
 * justification downgrades a matching finding to informational and is listed in
 * the report (Req 13.5). A Suppression naming a *non-suppressible* rule — the
 * schema, dangling-reference, Real-Person Blocklist, Sensitivity Term and
 * Provenance rules — is ignored and raises a CE-SCHEMA error on the offending
 * `lint.yaml` entry (Req 13.6). A malformed `lint.yaml` entry (a missing field,
 * an empty justification, an unknown rule id) is likewise a CE-SCHEMA error.
 *
 * A Suppression matches a finding when its `rule` equals the finding's rule and
 * its `path` equals the finding's `path`. The `path` is matched exactly against
 * the located finding path (`items[2].name`), the same string the loader and
 * the generic rules write, so a Suppression is as precise as the finding it
 * silences.
 */

import { z } from 'zod';

import type { LintFinding } from './rules.js';
import { NON_SUPPRESSIBLE_RULES, RULES_BY_ID } from './rules.js';
import type { ParsedPack } from './parsed-files.js';

/** One Suppression entry, as authored in a pack's `lint.yaml`. */
export interface Suppression {
  readonly rule: string;
  readonly path: string;
  readonly justification: string;
}

/** A Suppression together with the pack that declared it, for matching. */
export interface OwnedSuppression extends Suppression {
  readonly pack: string;
}

/** The `lint.yaml` entry schema: all three fields required and non-empty. */
const SuppressionSchema = z
  .object({
    rule: z.string().min(1),
    path: z.string(),
    justification: z.string().min(1, 'a suppression needs a non-empty justification'),
  })
  .strict();

const LintFileSchema = z.array(SuppressionSchema);

/** The outcome of collecting a pack set's Suppressions. */
export interface CollectedSuppressions {
  /** The accepted, suppressible Suppressions, used to downgrade findings. */
  readonly suppressions: readonly OwnedSuppression[];
  /** CE-SCHEMA errors for malformed or non-suppressible `lint.yaml` entries. */
  readonly errors: readonly LintFinding[];
}

/**
 * Read every pack's `lint.yaml` and sort each accepted or rejected entry.
 *
 * An entry naming a non-suppressible rule, or an unknown rule id, or failing
 * the schema (missing field, empty justification), is turned into a CE-SCHEMA
 * error finding on its `lint.yaml` location and *not* added to the active
 * Suppressions, so it can never silence anything (Req 13.6). A valid entry for
 * a suppressible rule is kept.
 */
export function collectSuppressions(packs: readonly ParsedPack[]): CollectedSuppressions {
  const suppressions: OwnedSuppression[] = [];
  const errors: LintFinding[] = [];

  for (const pack of packs) {
    const file = pack.files.find(
      (f) => f.relPath === 'lint.yaml' || f.relPath === 'lint.yml',
    );
    if (file === undefined) {
      continue;
    }

    if (!file.parsed) {
      errors.push(schemaError(pack.id, file.relPath, '', 'lint.yaml could not be parsed'));
      continue;
    }

    const result = LintFileSchema.safeParse(file.content);
    if (!result.success) {
      for (const issue of result.error.issues) {
        errors.push(
          schemaError(pack.id, file.relPath, formatPath(issue.path), issue.message),
        );
      }
      continue;
    }

    result.data.forEach((entry, index) => {
      const rule = RULES_BY_ID.get(entry.rule);
      if (rule === undefined) {
        errors.push(
          schemaError(
            pack.id,
            file.relPath,
            `[${index}].rule`,
            `unknown lint rule "${entry.rule}"`,
          ),
        );
        return;
      }
      if (NON_SUPPRESSIBLE_RULES.has(entry.rule)) {
        errors.push(
          schemaError(
            pack.id,
            file.relPath,
            `[${index}]`,
            `rule "${entry.rule}" is not suppressible; this suppression is ignored`,
          ),
        );
        return;
      }
      suppressions.push({ pack: pack.id, ...entry });
    });
  }

  return { suppressions, errors };
}

/**
 * Apply the accepted Suppressions to the findings (Req 13.5). A finding is
 * downgraded to `info` with its justification recorded when a Suppression in
 * the same pack matches its rule and path and the rule is suppressible. A
 * non-suppressible finding is never downgraded even if some entry names it (that
 * entry was already rejected in {@link collectSuppressions}). Findings keep
 * their input order; the orchestrator sorts the whole set afterwards.
 */
export function applySuppressions(
  findings: readonly LintFinding[],
  suppressions: readonly OwnedSuppression[],
): LintFinding[] {
  return findings.map((finding) => {
    const rule = RULES_BY_ID.get(finding.rule);
    if (rule === undefined || !rule.suppressible) {
      return finding;
    }
    const match = suppressions.find(
      (s) => s.pack === finding.pack && s.rule === finding.rule && s.path === finding.path,
    );
    if (match === undefined) {
      return finding;
    }
    return { ...finding, severity: 'info', suppressed: match.justification };
  });
}

/** A CE-SCHEMA error finding for a `lint.yaml` problem. */
function schemaError(
  pack: string,
  file: string,
  path: string,
  message: string,
): LintFinding {
  return { rule: 'CE-SCHEMA', severity: 'error', pack, file, path, message };
}

/** Format a Zod issue path as the dotted/bracketed string used in findings. */
function formatPath(path: ReadonlyArray<PropertyKey>): string {
  let out = '';
  for (const key of path) {
    if (typeof key === 'number') {
      out += `[${key}]`;
    } else {
      out += out === '' ? String(key) : `.${String(key)}`;
    }
  }
  return out;
}

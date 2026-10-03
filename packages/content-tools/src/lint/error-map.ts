/**
 * Mapping a loader {@link ContentError} to its Lint Rule (content-expansion
 * task 5.2; Req 13.1).
 *
 * The Content Loader runs every structural check — schema validation, id
 * namespacing and overrides, cross-reference resolution, the Tag check and Tag
 * Conformance, template-slot and Template Variant compilation — and collects a
 * located {@link ContentError} for each failure. The Pack Linter re-runs the
 * loader and turns every one of those errors into a {@link LintFinding} under
 * the matching rule, so a single `content lint` run reports loader defects and
 * Lint Rule defects together (design, "Pack Linter": "Every loader
 * `ContentError` becomes a finding under the matching loader rule").
 *
 * The loader does not stamp its errors with a rule id, so the mapping reads the
 * error's `file` and `message` the loader itself writes (see
 * `content/src/lib/loader.ts` and `tag-check.ts`). Anything the mapping does
 * not recognise falls back to CE-SCHEMA, the non-suppressible catch-all, so a
 * new or unrecognised loader error is never dropped and never silently
 * downgraded.
 */

import type { ContentError } from '@tradecraft/content';

import type { LintFinding } from './rules.js';
import { RULES_BY_ID, effectiveSeverity, type LintProfile } from './rules.js';

/**
 * The rule id a loader {@link ContentError} belongs to. The loader writes a
 * fixed set of `file` sentinels and message phrasings; this reads them:
 *
 * - `file === 'tag-conformance'` → CE-CONFORM (Tag Conformance shortfall).
 * - `file === 'cross-reference'` → CE-VARIANT for a Template Variant slot
 *   mismatch, else CE-REF for a dangling/cross-city reference.
 * - a Tag-vocabulary message (`not in the Tag Vocabulary`, `does not apply to
 *   kind`, `must carry at least one tag`) → CE-TAG.
 * - a duplicate-id message → CE-DUPID.
 * - a template-slot message → CE-SLOT.
 * - a Provenance-gate refusal (a generated-but-unreviewed file) → CE-PROVENANCE.
 * - everything else (Zod schema issues, YAML parse errors, bad `contentSchema`,
 *   missing/incompatible/cyclic `requires`, an unregistered content kind) →
 *   CE-SCHEMA.
 */
export function ruleForError(error: ContentError): string {
  const { file, message } = error;
  const msg = message.toLowerCase();

  if (file === 'tag-conformance') {
    return 'CE-CONFORM';
  }

  if (file === 'cross-reference') {
    // A Template Variant mismatch is reported on `cross-reference` too; its
    // message names the slot-set difference rather than an unresolved id.
    if (isVariantMismatch(msg)) {
      return 'CE-VARIANT';
    }
    return 'CE-REF';
  }

  if (
    msg.includes('tag vocabulary') ||
    msg.includes('does not apply to kind') ||
    msg.includes('must carry at least one tag')
  ) {
    return 'CE-TAG';
  }

  if (msg.includes('duplicate id')) {
    return 'CE-DUPID';
  }

  if (isTemplateSlotMessage(msg)) {
    return 'CE-SLOT';
  }

  // The Provenance gate (loader step 4) refuses a generated-but-unreviewed
  // file; its error is located on the file's `provenance` path and names the
  // missing review. Route it to CE-PROVENANCE so the generated-content gate
  // surfaces under its own rule rather than the CE-SCHEMA catch-all (Req 16.4).
  if (isProvenanceMessage(file, msg)) {
    return 'CE-PROVENANCE';
  }

  return 'CE-SCHEMA';
}

/**
 * A Provenance-gate refusal: the error sits on the `provenance` path and names
 * generated content missing its review (`checkProvenance` in the loader). Keyed
 * on both so an unrelated schema error mentioning "generated" stays CE-SCHEMA.
 */
function isProvenanceMessage(file: string, msg: string): boolean {
  return (
    msg.includes('generated content must be reviewed') ||
    (msg.includes('generated') && msg.includes('reviewed') && file !== '')
  );
}

/** A Template Variant mismatch message names the variant's slot sets. */
function isVariantMismatch(msg: string): boolean {
  return msg.includes('slot') && (msg.includes('variant') || msg.includes('base template'));
}

/**
 * A template-slot message from the template engine's slot check: an undeclared
 * slot, a slot not in the declared set, or an unknown slot in a pattern. These
 * surface as `cross-reference` or on the owning file; keyed on the word "slot"
 * paired with "declare"/"unknown"/"undeclared" so a plain reference error
 * ("role slot ... does not resolve") stays CE-REF.
 */
function isTemplateSlotMessage(msg: string): boolean {
  if (!msg.includes('slot')) {
    return false;
  }
  return (
    msg.includes('undeclared') ||
    msg.includes('not declared') ||
    msg.includes('unknown slot') ||
    msg.includes('reserved')
  );
}

/**
 * Turn one loader error into a located finding under its rule, at the profile's
 * effective severity for that rule. CE-SCHEMA, CE-REF, CE-DUPID, CE-SLOT,
 * CE-TAG, CE-CONFORM and CE-VARIANT are all non-suppressible or structural, so
 * a loader-backed finding is reported at full severity; the suppression pass
 * (which only ever matches suppressible rules) then leaves them untouched.
 */
export function findingForError(error: ContentError, profile: LintProfile): LintFinding {
  const ruleId = ruleForError(error);
  const rule = RULES_BY_ID.get(ruleId);
  const severity = rule === undefined ? 'error' : effectiveSeverity(rule, profile);
  return {
    rule: ruleId,
    severity,
    pack: error.pack,
    file: error.file,
    path: error.path,
    message: error.message,
  };
}

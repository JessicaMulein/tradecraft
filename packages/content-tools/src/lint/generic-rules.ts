/**
 * The generic Field-Declaration rule plumbing (content-expansion task 5.2;
 * Req 13.8).
 *
 * The text, Tag, Year Range, duplicate and localisation Lint Rules are *generic*:
 * they apply to every content kind in the Content Kind Registry according to
 * its Field Declarations, not to a hard-coded list of kinds (Req 13.8; design,
 * "Pack Linter": "Text fields come from Field Declarations (`text`,
 * `templates`, `names`)"). So the moment a follow-on package registers a kind
 * with, say, a `text` field, that field is scanned — no linter change needed
 * (Req 17.3).
 *
 * This module is the plumbing those rules share: it visits every registered
 * kind's files across the pack set, walks each declared field with the
 * {@link fieldValues} path resolver, and streams a located {@link FieldHit} —
 * the kind, pack, file, concrete path, the field category and the value — to a
 * set of {@link GenericFieldRule}s. The concrete rules (CE-ANACH, CE-PERIOD,
 * CE-DUPTEXT, CE-NEARDUP, CE-NAMEDUP, CE-REALPERSON, CE-SENSITIVE, CE-STYLE,
 * CE-ALLOWLIST) are implemented in tasks 5.3 and 5.4 as {@link GenericFieldRule}s;
 * this task fixes the plumbing and leaves the rule set they plug into empty, so
 * the walk is exercised and correct before the rules arrive.
 */

import type { ContentKindRegistration } from '@tradecraft/content';

import type { LintContext, LintFinding } from './rules.js';
import { fieldValues, itemsOf, type ParsedFile, type ParsedPack } from './parsed-files.js';
import { TEXT_SAFETY_AND_IDENTITY_RULES } from './concrete-rules.js';
import { PERIOD_AND_STYLE_RULES } from './period-rules.js';

/** Which Field Declaration category a hit came from. */
export type FieldCategory = 'text' | 'tags' | 'tagQueries' | 'years' | 'templates' | 'names';

/**
 * One declared field value located in the pack set. `kind` is the registered
 * content kind; `pack`/`file`/`path` locate it (the path is the loader's
 * concrete indexed form, e.g. `items[2].text`); `category` is the Field
 * Declaration category; `value` is the resolved leaf; and `templateStyle` is
 * the render style when `category === 'templates'`.
 */
export interface FieldHit {
  readonly kind: string;
  readonly pack: string;
  readonly file: string;
  readonly path: string;
  readonly category: FieldCategory;
  readonly value: unknown;
  readonly templateStyle?: string;
}

/**
 * A generic rule that reads the stream of {@link FieldHit}s for the whole pack
 * set and returns its findings. A rule that groups hits (CE-DUPTEXT across a
 * `(kind, field)` group, CE-NEARDUP) receives the full list, so it can compare
 * across packs and files; a rule that checks each value independently
 * (CE-ANACH, CE-PERIOD) simply iterates. The {@link LintContext} is passed too,
 * for the Anachronism Entries, Period Windows, blocklist and Locale data a rule
 * reads from the Content Set.
 */
export interface GenericFieldRule {
  readonly id: string;
  run(hits: readonly FieldHit[], ctx: LintContext): LintFinding[];
}

/**
 * The generic Field-Declaration rules. Task 5.3 contributes the reference,
 * identity and text-safety rules ({@link TEXT_SAFETY_AND_IDENTITY_RULES}); task
 * 5.4 appends the period, style, quantity and stability rules. The orchestrator
 * calls {@link runGenericRules} with this list, so adding a rule is a one-line
 * change here and the plumbing never changes.
 */
export const GENERIC_FIELD_RULES: readonly GenericFieldRule[] = [
  ...TEXT_SAFETY_AND_IDENTITY_RULES,
  ...PERIOD_AND_STYLE_RULES,
];

/**
 * Whether a pack-relative path belongs to a kind written under `dir`: the
 * `<dir>.yaml`/`<dir>.yml` file or any `.yaml`/`.yml` beneath `<dir>/`. Mirrors
 * the loader's `fileOrDir`, kept local so the linter does not reach into the
 * loader's internals.
 */
function fileMatchesKind(relPath: string, dir: string): boolean {
  return (
    relPath === `${dir}.yaml` ||
    relPath === `${dir}.yml` ||
    relPath.startsWith(`${dir}/`)
  );
}

/**
 * Collect every declared-field hit across the pack set, in deterministic order
 * (pack order, then file path order, then declaration order). The per-item
 * error path a hit carries is built from the item's own prefix (`items[2]`,
 * `[0]` or ``) joined to the declaration's per-item tail, so it matches the
 * loader's located paths exactly.
 */
export function collectFieldHits(
  packs: readonly ParsedPack[],
  registry: readonly ContentKindRegistration[],
): FieldHit[] {
  const hits: FieldHit[] = [];
  for (const pack of packs) {
    for (const file of pack.files) {
      if (!file.parsed) {
        continue;
      }
      const reg = registry.find((r) => fileMatchesKind(file.relPath, r.dir));
      if (reg === undefined) {
        continue;
      }
      collectFileHits(hits, pack.id, file, reg);
    }
  }
  return hits;
}

/** Collect every declared-field hit from one file of a known kind. */
function collectFileHits(
  hits: FieldHit[],
  packId: string,
  file: ParsedFile,
  reg: ContentKindRegistration,
): void {
  const { items, pathAt } = itemsOf(file.content);
  const fields = reg.fields;

  items.forEach((item, index) => {
    const base = pathAt(index);

    const emit = (
      category: FieldCategory,
      perItemTail: string,
      templateStyle?: string,
    ): void => {
      for (const leaf of fieldValues(item, perItemTail)) {
        hits.push({
          kind: reg.kind,
          pack: packId,
          file: file.relPath,
          path: joinPath(base, leaf.path),
          category,
          value: leaf.value,
          templateStyle,
        });
      }
    };

    for (const decl of fields.text ?? []) {
      emit('text', perItemPath(decl));
    }
    for (const decl of fields.tags ?? []) {
      emit('tags', perItemPath(decl));
    }
    for (const decl of fields.tagQueries ?? []) {
      emit('tagQueries', perItemPath(decl));
    }
    for (const decl of fields.years ?? []) {
      emit('years', perItemPath(decl));
    }
    for (const decl of fields.templates ?? []) {
      emit('templates', perItemPath(decl.path), decl.style);
    }
    for (const decl of fields.names ?? []) {
      emit('names', perItemPath(decl));
    }
  });
}

/** Strip the leading `items`/`items[]` segment of a declaration path. */
function perItemPath(path: string): string {
  if (path === 'items' || path === 'items[]') {
    return '';
  }
  if (path.startsWith('items[].')) {
    return path.slice('items[].'.length);
  }
  if (path.startsWith('items.')) {
    return path.slice('items.'.length);
  }
  return path;
}

/** Join an item's base path to a within-item leaf path. */
function joinPath(base: string, tail: string): string {
  if (base === '') {
    return tail;
  }
  if (tail === '') {
    return base;
  }
  return tail.startsWith('[') ? `${base}${tail}` : `${base}.${tail}`;
}

/** Run every generic Field-Declaration rule over the collected hits. */
export function runGenericRules(
  ctx: LintContext,
  rules: readonly GenericFieldRule[] = GENERIC_FIELD_RULES,
): LintFinding[] {
  const hits = collectFieldHits(ctx.packs, ctx.registry);
  const findings: LintFinding[] = [];
  for (const rule of rules) {
    findings.push(...rule.run(hits, ctx));
  }
  return findings;
}

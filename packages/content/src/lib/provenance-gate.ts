/**
 * The Provenance gate — loader pipeline step 4 (content-expansion task 2.4).
 *
 * After the files of every discovered pack are parsed (step 3) and before they
 * merge into the registries (step 5), the loader refuses two kinds of content
 * so that model-drafted material can never load unreviewed (design, "Loader
 * pipeline" step 4; Requirements 16.3, 16.4):
 *
 * - **Generated-but-unreviewed files (Req 16.4).** A content file may carry a
 *   {@link import('./content-file.js').Provenance} record in its
 *   `{ provenance?, items }` envelope. The Authoring Aid writes a draft with
 *   `generated: true` and no reviewer; a human promotes it by stamping
 *   `reviewedBy` and `reviewedAt`. The gate refuses any file whose provenance
 *   has `generated: true` without *both* a `reviewedBy` and a `reviewedAt`, so
 *   an unpromoted draft that slips into a pack directory does not load. A file
 *   with no provenance, or with `generated: false`, is accepted — every
 *   generation-1 bare-list file loads unchanged.
 *
 * - **Packs under the Draft Area (Req 16.3).** The Authoring Aid writes drafts
 *   to `content-drafts/` (design, "Authoring Aid"; the Draft Area). A pack
 *   whose directory lies under that path is refused outright, whatever its
 *   files say, so pointing the loader at the Draft Area cannot ship a draft
 *   pack. The refusal names `pack.yaml` with an empty path, matching how the
 *   discovery step locates a pack-level problem.
 *
 * The gate reads only the already-parsed files (it never touches disk) and
 * reports each refusal as a located {@link ContentError}, collected into the
 * loader's error sink alongside every other problem.
 */

import { ProvenanceSchema, type Provenance } from './content-file.js';
import type { ContentError } from './pack.js';

/**
 * The directory name of the Draft Area (design, "Authoring Aid"). The Authoring
 * Aid writes model drafts under `content-drafts/<pack>/…`; a pack loaded from
 * anywhere under a `content-drafts` directory is refused (Req 16.3).
 */
export const DRAFT_AREA_SEGMENT = 'content-drafts';

/** One discovered pack as the gate sees it: its id, directory and parsed files. */
export interface PackForProvenance {
  readonly id: string;
  readonly dir: string;
  readonly files: readonly { readonly relPath: string; readonly content: unknown }[];
}

/**
 * True when `dir` lies under the Draft Area: a path segment equal to
 * {@link DRAFT_AREA_SEGMENT} anywhere in it. Both OS separators are considered
 * so the check holds on every platform, and the comparison is per segment so a
 * directory merely *named* like a longer word (e.g. `content-drafts-archive`)
 * does not match.
 */
export function isUnderDraftArea(dir: string): boolean {
  return dir
    .split(/[\\/]+/)
    .some((segment) => segment === DRAFT_AREA_SEGMENT);
}

/**
 * The reviewed state of a provenance record. A record with `generated: true`
 * is accepted only when it also carries both a non-empty `reviewedBy` and a
 * non-empty `reviewedAt` (Req 16.4). A record with `generated: false` (or a
 * file with no provenance at all) is always accepted.
 */
function isGeneratedButUnreviewed(provenance: Provenance): boolean {
  return (
    provenance.generated &&
    (provenance.reviewedBy === undefined || provenance.reviewedAt === undefined)
  );
}

/**
 * Read the Provenance record of a parsed file if it is written in the
 * `{ provenance?, items }` envelope form. A bare list, a scalar, or an object
 * with no `provenance` key carries no provenance, so the gate does not apply.
 * A malformed envelope is left to the normalisation step in merge to report as
 * a located error; here it simply yields no provenance.
 */
function provenanceOf(content: unknown): Provenance | undefined {
  if (
    typeof content !== 'object' ||
    content === null ||
    Array.isArray(content) ||
    !('provenance' in (content as Record<string, unknown>))
  ) {
    return undefined;
  }
  const parsed = ProvenanceSchema.safeParse(
    (content as Record<string, unknown>).provenance,
  );
  return parsed.success ? parsed.data : undefined;
}

/**
 * Run the Provenance gate over the discovered packs, pushing a located
 * {@link ContentError} for every refusal into `errors` (design, "Loader
 * pipeline" step 4; Req 16.3, 16.4).
 *
 * A pack under the Draft Area is refused once, at its `pack.yaml`, and its
 * files are not inspected further — the whole pack is off-limits. Every other
 * pack's files are checked for a generated-but-unreviewed provenance record.
 */
export function checkProvenance(
  packs: readonly PackForProvenance[],
  errors: ContentError[],
): void {
  for (const pack of packs) {
    if (isUnderDraftArea(pack.dir)) {
      errors.push({
        pack: pack.id,
        file: 'pack.yaml',
        path: '',
        message: `pack directory lies under the Draft Area ("${DRAFT_AREA_SEGMENT}/"); promote its drafts before loading`,
      });
      continue;
    }

    for (const file of pack.files) {
      const provenance = provenanceOf(file.content);
      if (provenance !== undefined && isGeneratedButUnreviewed(provenance)) {
        errors.push({
          pack: pack.id,
          file: file.relPath,
          path: 'provenance',
          message:
            'generated content must be reviewed: provenance has "generated: true" but is missing reviewedBy and/or reviewedAt',
        });
      }
    }
  }
}

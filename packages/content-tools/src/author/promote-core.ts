/**
 * Promoting a reviewed draft into its pack (content-expansion task 5.13;
 * design, "Authoring Aid"; Req 16.5, 16.7, 16.8).
 *
 * `pnpm content promote <draft> --into <pack-file> --reviewer <name>` takes a
 * draft the Authoring Aid wrote to the Draft Area and merges it into a real
 * pack file, but only after the whole pack set lints clean with the draft
 * included (Req 16.5):
 *
 * 1. Read the draft's items and the target pack file's current items.
 * 2. Build the *promoted* target: the existing items plus the draft items,
 *    carried in a `{ provenance, items }` envelope whose provenance stamps
 *    `reviewedBy` and `reviewedAt` on top of the draft's `generated`/`model`/
 *    `promptHash` record — so the merged file is reviewed, not a bare draft.
 * 3. Lint the pack set with that merged file in place of the target. The lint
 *    runs over a temporary copy of the pack directories, so nothing on disk
 *    changes while the decision is made.
 * 4. If the lint reports **no error**, write the merged file to the real target
 *    and delete the draft (Req 16.5). Otherwise leave every file untouched and
 *    return the findings (Req 16.8).
 *
 * The filesystem is reached through an injectable {@link PromoteFs}, so the
 * whole decision — including the merged-set lint — runs in a unit test over an
 * in-memory tree, and the real CLI supplies a thin `node:fs` adapter.
 */

import { parse as parseYaml, stringify as toYaml } from 'yaml';
import { normalizeContentFile, type Provenance } from '@tradecraft/content';

import { lint, type LintOptions } from '../lint/lint.js';
import type { LintReport } from '../lint/output.js';

/**
 * The filesystem surface promotion needs: read and write files, delete the
 * draft, and run the merged-set lint. The lint is injected rather than called
 * directly so a test can drive promotion over an in-memory tree without writing
 * a temp directory; the production adapter writes a temp copy and calls the
 * real {@link lint}.
 */
export interface PromoteFs {
  readFile(path: string): string;
  writeFile(path: string, contents: string): void;
  deleteFile(path: string): void;
  /**
   * Lint the pack set as it would be with `mergedFile`'s contents written at
   * `targetFile`, without mutating the real tree. Returns the report.
   */
  lintWithMerged(targetFile: string, mergedContents: string, opts: LintOptions): LintReport;
}

/** The parameters of a promote run. */
export interface PromoteRequest {
  /** The draft file in the Draft Area to promote. */
  readonly draftFile: string;
  /** The real pack file the items are promoted into. */
  readonly targetFile: string;
  /** The reviewer's name, stamped into the promoted provenance. */
  readonly reviewer: string;
  /** The lint profile to gate on (default `draft`). */
  readonly profile?: LintOptions['profile'];
}

/** The outcome of a promote run. */
export type PromoteResult =
  | {
      readonly promoted: true;
      readonly targetFile: string;
      readonly count: number;
    }
  | {
      readonly promoted: false;
      readonly report: LintReport;
    };

/** The clock the `reviewedAt` stamp reads; injectable for tests. */
export interface PromoteClock {
  now(): Date;
}

/** The default clock: the system clock. */
export const systemPromoteClock: PromoteClock = { now: () => new Date() };

/** The items of a parsed content file (bare list or `{ items }` envelope). */
function itemsOfParsed(content: unknown): readonly unknown[] {
  const normalized = normalizeContentFile(content);
  return normalized.ok ? normalized.value.items : [];
}

/** The provenance of a parsed draft file, if any. */
function provenanceOfParsed(content: unknown): Provenance | undefined {
  const normalized = normalizeContentFile(content);
  return normalized.ok ? normalized.value.provenance : undefined;
}

/**
 * Build the promoted target file's YAML: the target's existing items plus the
 * draft's items, in a `{ provenance, items }` envelope whose provenance carries
 * the draft's generation record stamped with `reviewedBy` and `reviewedAt`
 * (Req 16.5). The reviewed provenance is what lets the merged file pass the
 * loader's Provenance gate (Req 16.4) once it lands in the pack.
 */
export function buildPromotedFile(
  targetContent: unknown,
  draftContent: unknown,
  reviewer: string,
  reviewedAt: string,
): { readonly yaml: string; readonly addedCount: number; readonly totalCount: number } {
  const existing = itemsOfParsed(targetContent);
  const added = itemsOfParsed(draftContent);
  const draftProvenance = provenanceOfParsed(draftContent);

  const provenance: Provenance = {
    generated: draftProvenance?.generated ?? true,
    ...(draftProvenance?.model === undefined ? {} : { model: draftProvenance.model }),
    ...(draftProvenance?.promptHash === undefined
      ? {}
      : { promptHash: draftProvenance.promptHash }),
    ...(draftProvenance?.generatedAt === undefined
      ? {}
      : { generatedAt: draftProvenance.generatedAt }),
    reviewedBy: reviewer,
    reviewedAt,
  };

  const items = [...existing, ...added];
  return {
    yaml: toYaml({ provenance, items }),
    addedCount: added.length,
    totalCount: items.length,
  };
}

/**
 * Run a promote: build the merged target, lint the set with it in place and —
 * only if the lint reports no error — write the merged file and delete the
 * draft (Req 16.5, 16.8). On any error finding, nothing is written or deleted
 * and the report is returned so the CLI can print the findings.
 */
export function runPromoteCore(
  request: PromoteRequest,
  fs: PromoteFs,
  clock: PromoteClock = systemPromoteClock,
): PromoteResult {
  const draftContent = parseYaml(fs.readFile(request.draftFile));

  // The target file may not exist yet (promoting into a new file); treat a
  // missing or unreadable target as empty rather than failing.
  let targetContent: unknown = [];
  try {
    targetContent = parseYaml(fs.readFile(request.targetFile));
  } catch {
    targetContent = [];
  }

  const reviewedAt = clock.now().toISOString();
  const merged = buildPromotedFile(
    targetContent,
    draftContent,
    request.reviewer,
    reviewedAt,
  );

  const report = fs.lintWithMerged(request.targetFile, merged.yaml, {
    profile: request.profile ?? 'draft',
  });

  if (report.summary.errors > 0) {
    return { promoted: false, report };
  }

  fs.writeFile(request.targetFile, merged.yaml);
  fs.deleteFile(request.draftFile);
  return { promoted: true, targetFile: request.targetFile, count: merged.addedCount };
}

/** Re-export so the CLI adapter can thread the real {@link lint} through. */
export { lint };

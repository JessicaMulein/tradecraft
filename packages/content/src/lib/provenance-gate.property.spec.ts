/**
 * Feature: content-expansion, Property 18: Provenance gate.
 *
 * The dedicated property for the loader's Provenance gate (task 2.4,
 * `provenance-gate.ts`; design, "Property 18: Provenance gate"; Requirements
 * 16.3, 16.4). The example-based `provenance-gate.spec.ts` pins the specific
 * accept/refuse cases; this property asserts the gate's full accept/refuse
 * decision across arbitrary provenance records and arbitrary pack placement.
 *
 * For any pack set and any assignment of Provenance Records to files and of
 * files to pack or Draft Area paths, the loader accepts a file **if and only
 * if** it is outside the Draft Area *and* either `generated` is false or
 * absent, or both `reviewedBy` and `reviewedAt` are present:
 *
 * - **Draft Area (Req 16.3).** A pack whose directory lies under a
 *   `content-drafts` segment is refused outright — once, at its `pack.yaml`,
 *   whatever its files say — so its files are never inspected.
 * - **Generated-but-unreviewed (Req 16.4).** For a pack outside the Draft
 *   Area, each file is refused exactly when its provenance has
 *   `generated: true` and is missing `reviewedBy` and/or `reviewedAt`. A file
 *   with no provenance, or `generated: false`, is accepted.
 *
 * The check reads only already-parsed files and never touches disk, so the
 * property drives `checkProvenance` directly over generated inputs and
 * compares its error sink against an independent oracle of the iff rule.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { ContentError } from './pack.js';
import {
  DRAFT_AREA_SEGMENT,
  checkProvenance,
  type PackForProvenance,
} from './provenance-gate.js';

/** A parsed-file content value with (optionally) a provenance envelope. */
interface GenFile {
  readonly relPath: string;
  readonly content: unknown;
  /** Independent oracle: true when this file alone would be refused. */
  readonly expectRefused: boolean;
}

/** A non-empty token used for ids, path segments and reviewer fields. */
const token = fc.string({ minLength: 1, maxLength: 8 }).filter((s) => /\S/.test(s));

/**
 * An arbitrary parsed file. It carries one of:
 *  - no provenance (a bare list or a plain object) — always accepted;
 *  - an envelope with `generated: false` — always accepted;
 *  - an envelope with `generated: true` and an independent choice of whether
 *    `reviewedBy` / `reviewedAt` are present — refused unless both are present.
 */
const fileArb: fc.Arbitrary<GenFile> = fc.oneof(
  // No provenance at all: a bare list.
  token.map((id) => ({
    relPath: `${id}.yaml`,
    content: [{ id }],
    expectRefused: false,
  })),
  // An object with no `provenance` key.
  token.map((id) => ({
    relPath: `${id}.yaml`,
    content: { items: [{ id }] },
    expectRefused: false,
  })),
  // generated: false — always accepted.
  token.map((id) => ({
    relPath: `${id}.yaml`,
    content: { provenance: { generated: false }, items: [] },
    expectRefused: false,
  })),
  // generated: true, with/without each reviewer field.
  fc
    .record({
      id: token,
      reviewedBy: fc.option(token, { nil: undefined }),
      reviewedAt: fc.option(token, { nil: undefined }),
    })
    .map(({ id, reviewedBy, reviewedAt }) => {
      const provenance: Record<string, unknown> = { generated: true };
      if (reviewedBy !== undefined) provenance.reviewedBy = reviewedBy;
      if (reviewedAt !== undefined) provenance.reviewedAt = reviewedAt;
      return {
        relPath: `${id}.yaml`,
        content: { provenance, items: [] },
        expectRefused: reviewedBy === undefined || reviewedAt === undefined,
      };
    }),
);

/** An arbitrary pack: an id, a placement (under the Draft Area or not), files. */
const packArb: fc.Arbitrary<{
  pack: PackForProvenance;
  underDraft: boolean;
  files: readonly GenFile[];
}> = fc
  .record({
    id: token,
    underDraft: fc.boolean(),
    // Where in the directory the draft segment (if any) sits does not matter;
    // vary the surrounding segments to exercise the per-segment match.
    before: fc.array(token.filter((s) => s !== DRAFT_AREA_SEGMENT), { maxLength: 3 }),
    after: fc.array(token.filter((s) => s !== DRAFT_AREA_SEGMENT), { maxLength: 3 }),
    files: fc.array(fileArb, { minLength: 1, maxLength: 4 }),
  })
  .map(({ id, underDraft, before, after, files }) => {
    const segments = underDraft
      ? [...before, DRAFT_AREA_SEGMENT, ...after, id]
      : [...before, ...after, id];
    const dir = `/${segments.join('/')}`;
    return {
      pack: { id, dir, files: files.map((f) => ({ relPath: f.relPath, content: f.content })) },
      underDraft,
      files,
    };
  });

describe('Feature: content-expansion, Property 18: Provenance gate', () => {
  it('accepts a file iff it is outside the Draft Area and not generated-but-unreviewed', () => {
    fc.assert(
      fc.property(fc.array(packArb, { minLength: 1, maxLength: 4 }), (raw) => {
        // Make pack ids unique so the per-pack "refused once" check is
        // unambiguous even when the generator repeats a token.
        const generated = raw.map((g, i) => {
          const id = `${g.pack.id}#${i}`;
          return { ...g, pack: { ...g.pack, id } };
        });
        const packs = generated.map((g) => g.pack);
        const errors: ContentError[] = [];
        checkProvenance(packs, errors);

        // Build the independent oracle: the exact set of refusals the iff rule
        // predicts, keyed so order does not matter.
        const expected: { pack: string; file: string; path: string }[] = [];
        for (const g of generated) {
          if (g.underDraft) {
            // The whole pack is refused once at pack.yaml; files not inspected.
            expected.push({ pack: g.pack.id, file: 'pack.yaml', path: '' });
            continue;
          }
          for (const f of g.files) {
            if (f.expectRefused) {
              expected.push({ pack: g.pack.id, file: f.relPath, path: 'provenance' });
            }
          }
        }

        const actual = errors.map((e) => ({ pack: e.pack, file: e.file, path: e.path }));

        const key = (e: { pack: string; file: string; path: string }) =>
          `${e.pack}\u0000${e.file}\u0000${e.path}`;
        expect([...actual].map(key).sort()).toEqual([...expected].map(key).sort());

        // A Draft-Area pack is refused exactly once and names content-drafts.
        for (const g of generated.filter((x) => x.underDraft)) {
          const packErrors = errors.filter((e) => e.pack === g.pack.id);
          expect(packErrors).toHaveLength(1);
          expect(packErrors[0].message).toContain(DRAFT_AREA_SEGMENT);
        }
      }),
    );
  });
});

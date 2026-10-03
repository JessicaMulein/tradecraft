/**
 * The content-file envelope and its Provenance Record (contentSchema 2).
 *
 * A content file in a pack is a list of items of one kind. From generation 2 a
 * file may instead be an object `{ provenance?, items }`, so a file produced by
 * the offline Authoring Aid can carry a Provenance Record alongside its items
 * (Requirement 16.2). The bare-list form stays valid, so every generation-1
 * file loads unchanged.
 *
 * This module fixes the two shapes the loader accepts and the pure helper that
 * normalises a parsed file into its items plus any provenance. It enforces no
 * policy: the Provenance gate that refuses generated-but-unreviewed files lands
 * with task 2.4 (Requirements 16.3, 16.4), and the role-to-kind rules land with
 * task 1.2. Here a file is only reshaped into `{ provenance?, items }`.
 */

import { z } from 'zod';

/**
 * The Provenance Record carried by a content file produced with the Authoring
 * Aid (design, data model `Provenance`). `generated` marks a file as model
 * output; `model`, `promptHash` and `generatedAt` record how it was drafted;
 * `reviewedBy` and `reviewedAt` are stamped when a human promotes the draft
 * into a pack. The loader's Provenance gate (task 2.4) refuses a `generated`
 * file that lacks a reviewer and review time (Requirement 16.4).
 */
export const ProvenanceSchema = z
  .object({
    generated: z.boolean(),
    model: z.string().min(1).optional(),
    promptHash: z.string().min(1).optional(),
    generatedAt: z.string().min(1).optional(),
    reviewedBy: z.string().min(1).optional(),
    reviewedAt: z.string().min(1).optional(),
  })
  .strict();
export type Provenance = z.infer<typeof ProvenanceSchema>;

/**
 * The object form of a content file: an optional {@link Provenance} record and
 * the list of items. `items` is validated against the kind's own schema later;
 * here it is only required to be an array so a mistyped envelope is reported as
 * a located error rather than silently treated as a single item.
 */
export const ContentFileEnvelopeSchema = z
  .object({
    provenance: ProvenanceSchema.optional(),
    items: z.array(z.unknown()),
  })
  .strict();
export type ContentFileEnvelope = z.infer<typeof ContentFileEnvelopeSchema>;

/** A content file after normalisation: its items and any Provenance Record. */
export interface NormalizedContentFile {
  readonly provenance?: Provenance;
  readonly items: readonly unknown[];
}

/**
 * True when a parsed file is written in the object envelope form rather than as
 * a bare list. An envelope is a non-null, non-array object carrying an `items`
 * key; anything else (a list, a scalar, a single mapping with no `items`) is
 * read as the bare-list form by {@link normalizeContentFile}.
 */
export function isContentFileEnvelope(content: unknown): boolean {
  return (
    typeof content === 'object' &&
    content !== null &&
    !Array.isArray(content) &&
    'items' in (content as Record<string, unknown>)
  );
}

/** The outcome of normalising a parsed file into provenance plus items. */
export type NormalizeResult =
  | { readonly ok: true; readonly value: NormalizedContentFile }
  | { readonly ok: false; readonly error: z.ZodError };

/**
 * Normalise a parsed YAML file into its items and any Provenance Record,
 * accepting either the bare-list form or the `{ provenance?, items }` envelope
 * (Requirement 16.2, design loader step 3).
 *
 * The envelope form is recognised by {@link isContentFileEnvelope} and is
 * validated against {@link ContentFileEnvelopeSchema}, so a malformed envelope
 * (for example `items` not a list, or an unknown extra key) becomes a Zod error
 * the caller can locate. Every other shape — a list, a scalar, `null`, or a
 * single mapping with no `items` key — is treated as the bare-list form and
 * passed through with no provenance, preserving the pre-envelope behaviour.
 */
export function normalizeContentFile(content: unknown): NormalizeResult {
  if (isContentFileEnvelope(content)) {
    const parsed = ContentFileEnvelopeSchema.safeParse(content);
    if (!parsed.success) {
      return { ok: false, error: parsed.error };
    }
    const { provenance, items } = parsed.data;
    return {
      ok: true,
      value: provenance === undefined ? { items } : { provenance, items },
    };
  }

  if (Array.isArray(content)) {
    return { ok: true, value: { items: content } };
  }
  if (content === null || content === undefined) {
    return { ok: true, value: { items: [] } };
  }
  return { ok: true, value: { items: [content] } };
}

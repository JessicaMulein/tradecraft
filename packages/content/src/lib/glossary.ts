/**
 * The glossary (Requirement 26.5).
 *
 * The glossary is the list of game and tradecraft terms the Help view lists
 * alongside the current Location's quoted actions (design, "Help and hints":
 * "Help lists `quote()` results for the current Location plus the glossary").
 * Each entry is a plain `{ term, definition }` pair — no template slots, so the
 * text renders verbatim — and a pack's `glossary.yaml` is simply a list of
 * them.
 *
 * Unlike the keyed content kinds, a glossary term has no authored `id`: the
 * authors keep the file alphabetical and read it as prose. The loader keys an
 * entry by its `term` so later packs can override an earlier definition, and so
 * the merged registry is addressable the same way every other kind is.
 */

import { z } from 'zod';

/** A single glossary entry: the term and its plain-prose definition. */
export const GlossaryTermSchema = z
  .object({
    term: z.string().min(1, 'a glossary term must not be empty'),
    definition: z.string().min(1, 'a glossary definition must not be empty'),
  })
  .strict();
export type GlossaryTerm = z.infer<typeof GlossaryTermSchema>;

/**
 * A `glossary.yaml` file is a list of terms. The loader tolerates the file in
 * either the bare-list form or (defensively) a single term.
 */
export const GlossaryFileSchema = z.array(GlossaryTermSchema);

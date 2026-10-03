/**
 * The game-facing cipher specification.
 *
 * A {@link CipherSpec} is the Cipher Engine's description of *how a particular
 * Intercept is enciphered*, as the design's Cipher Engine section defines it. It
 * is distinct from the pure {@link CipherKey} in `cipher.ts`: a spec carries the
 * *references* that get stored in an Intercept and shown in the workbench — a
 * book cipher names a public-text `DocId`, a one-time pad names a `padId` —
 * whereas a `CipherKey` carries the resolved key material (the public text's
 * content, the pad's letters) that the pure cipher functions actually consume.
 *
 * Resolving a spec to a key means looking its references up in the World State.
 * {@link resolveCipherSpec} does that given a lookup for public-text content and
 * pad streams, so the lookup (and therefore any world access) stays outside the
 * pure cipher core.
 *
 * The player submits a candidate decryption as a {@link KeySubmission}: either a
 * guessed `CipherSpec`-shaped key, or a plaintext they believe is the answer.
 * This is the `submission` carried by the `decrypt` Action in the design's
 * Action union; the Sim verifies it (task 8.4).
 */

import { z } from 'zod';

import { DocIdSchema, type DocId, type InterceptId } from '../model/core.js';
import type { CipherKey } from './cipher.js';

/** Book-cipher addressing scheme. The slice ships one: page, line, word. */
export const BOOK_SCHEMES = ['page-line-word'] as const;
export type BookScheme = (typeof BOOK_SCHEMES)[number];

/**
 * How an Intercept is enciphered, by reference. Matches the design's
 * `CipherSpec` union. Truth-bearing when stored on an Intercept (the player
 * must deduce it); the same shape is reused for a player's guessed key in a
 * {@link KeySubmission}.
 */
export const CipherSpecSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('caesar'),
    shift: z.int(),
  }),
  z.strictObject({
    kind: z.literal('vigenere'),
    key: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal('columnar'),
    key: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal('book'),
    textId: DocIdSchema,
    scheme: z.enum(BOOK_SCHEMES),
  }),
  z.strictObject({
    kind: z.literal('otp'),
    padId: z.string().min(1),
    // A reused pad is a hostile tradecraft error (Req 9.4); naming the other
    // intercept it was reused with lets the generator and workbench model it.
    reusedWith: z.string().min(1).optional(),
  }),
]);

export type CipherSpec =
  | { kind: 'caesar'; shift: number }
  | { kind: 'vigenere'; key: string }
  | { kind: 'columnar'; key: string }
  | { kind: 'book'; textId: DocId; scheme: BookScheme }
  | { kind: 'otp'; padId: string; reusedWith?: InterceptId };

/**
 * What the player submits when attempting a decryption (the `submission` on the
 * `decrypt` Action). They may either name a key they have worked out, or paste a
 * plaintext they believe is the message. The Sim verifies either against the
 * Intercept (task 8.4).
 */
export const KeySubmissionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('key'), spec: CipherSpecSchema }),
  z.strictObject({ kind: z.literal('plaintext'), text: z.string() }),
]);

export type KeySubmission =
  | { kind: 'key'; spec: CipherSpec }
  | { kind: 'plaintext'; text: string };

/**
 * Supplies the key material a {@link CipherSpec} refers to: the content of a
 * public text by `DocId` (for book ciphers) and the letter stream of a pad by
 * `padId` (for one-time pads). The World State provides this; the cipher core
 * never sees it directly.
 */
export interface CipherKeyLookup {
  publicText(id: DocId): string | undefined;
  pad(id: string): string | undefined;
}

/**
 * Resolve a game-facing {@link CipherSpec} to a pure {@link CipherKey} the
 * cipher functions can run. Throws, naming the missing reference, if a book
 * cipher's public text or an OTP's pad is not found — a resolution failure is a
 * world-generation or save-integrity bug, not a normal gameplay outcome.
 */
export function resolveCipherSpec(
  spec: CipherSpec,
  lookup: CipherKeyLookup,
): CipherKey {
  switch (spec.kind) {
    case 'caesar':
      return { kind: 'caesar', shift: spec.shift };
    case 'vigenere':
      return { kind: 'vigenere', keyword: spec.key };
    case 'columnar':
      return { kind: 'columnar', key: spec.key };
    case 'book': {
      const text = lookup.publicText(spec.textId);
      if (text === undefined) {
        throw new Error(`book cipher: unknown public text ${spec.textId}`);
      }
      return { kind: 'book', text };
    }
    case 'otp': {
      const pad = lookup.pad(spec.padId);
      if (pad === undefined) {
        throw new Error(`otp cipher: unknown pad ${spec.padId}`);
      }
      return { kind: 'otp', pad };
    }
  }
}

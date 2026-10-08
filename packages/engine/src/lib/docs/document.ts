/**
 * The {@link Document} model and the shared machinery the Document composers use
 * (design, "Document Generator"; Requirements 30.1, 30.3).
 *
 * A Document is any readable text the game puts in front of the player: a
 * newspaper edition, one of the public-text corpora (almanac, anthology,
 * timetable), an HQ Dossier, a Cable, or seized material. Every Document carries
 * the same shape the design's `Document` interface names:
 *
 * ```ts
 * interface Document {
 *   id: DocId; kind: 'newspaper'|'public-text'|'dossier'|'cable'|'seized';
 *   title: string; date: GameTime; body: string;   // rendered template text (fact layer)
 *   asserts: PropId[];                               // Propositions the text asserts (not necessarily true)
 *   obtainableAt?: LocId[];                          // kiosk, library, bookshop
 * }
 * ```
 *
 * Two properties of this shape matter for the rest of the Sim:
 *
 * - `body` is **fact-layer** text: it is rendered deterministically from a
 *   content {@link import('@tradecraft/content').DocumentTemplate} (or, for a
 *   public text, from the corpus body) with no language model involved, so the
 *   Narrator may elaborate around it but may never contradict it (design).
 * - `asserts` are the ids of the Propositions the text *claims* — not
 *   necessarily ground truth. A Dossier composed from the Station's Knowledge
 *   Slice asserts both the Station's true leads and its HQ false beliefs, so
 *   reading a Document is a source of Claims, not of truth. The Document itself
 *   carries no {@link import('../model/core.js').Truth} field (design: "Dossiers
 *   never contain truth fields"), so it can be shown to the player directly.
 *
 * The composers that build concrete Documents live in sibling modules
 * (`dossier.ts`, `cable.ts`, `public-text.ts`); this module owns only the shape
 * and the few helpers they share — the deterministic namer, the DocId minting
 * and the letter counter the public-text composer uses to guarantee a corpus is
 * long enough to key every book cipher (Requirement 30.5).
 */

import {
  type DocId,
  type GameTime,
  type LocId,
  type PropId,
  type Proposition,
} from '../model/core.js';

/** The kinds of Document the generator produces (design's `Document.kind`). */
export const DOCUMENT_KINDS = [
  'newspaper',
  'public-text',
  'dossier',
  'cable',
  'seized',
  'notice',
] as const;

/** One Document kind. */
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/**
 * A readable in-game Document (design, "Document Generator"). `body` is rendered
 * fact-layer text; `asserts` names the Propositions the text claims (true or
 * not); `obtainableAt`, when present, lists the Locations where the player can
 * obtain the Document (a kiosk, library or bookshop for a public text — a
 * Dossier or Cable is delivered, not obtained, so it carries none).
 *
 * This is the real interface that replaces the task-4.6 skeleton `Document` in
 * `../model/state.ts`; `WorldState.documents` is `Record<DocId, Document>`.
 */
export interface Document {
  readonly id: DocId;
  readonly kind: DocumentKind;
  readonly title: string;
  readonly date: GameTime;
  /** Rendered fact-layer text. The Narrator may not contradict it. */
  readonly body: string;
  /** Ids of the Propositions the text asserts (not necessarily true). */
  readonly asserts: readonly PropId[];
  /** Locations where the Document can be obtained (kiosk, library, bookshop). */
  readonly obtainableAt?: readonly LocId[];
}

/**
 * The Propositions a composer threads onto a Document, keyed by the PropId the
 * Document asserts. A composer returns both the {@link Document} and this map so
 * the read action (task 9.2) can turn each asserted PropId into a Case File
 * Claim without a second lookup: the Document stores only the ids, but the Sim
 * keeps the full Propositions here so a reader learns the full fact.
 */
export interface ComposedDocument {
  readonly document: Document;
  /** The full Propositions behind `document.asserts`, in the same order. */
  readonly propositions: readonly Proposition[];
}

/**
 * Mint a stable {@link DocId} from a kind tag and a local slug, so the id reads
 * back to its origin and stays stable for the same seed and content:
 * `doc:<kind>/<local>`.
 */
export function docId(kind: DocumentKind, local: string): DocId {
  return `doc:${kind}/${slugify(local)}` as DocId;
}

/** Turn an arbitrary tag into a slug-safe id fragment. */
export function slugify(value: string): string {
  const s = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s.length > 0 ? s : 'x';
}

/**
 * Count the ASCII letters (A–Z, a–z) in a string. The book cipher keys off a
 * public text's letters only (see `../cipher/cipher.ts`), so this is the measure
 * the public-text composer uses to guarantee a corpus can key a message of a
 * given letter length (Requirement 30.5).
 */
export function countLetters(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122)
    ) {
      n += 1;
    }
  }
  return n;
}

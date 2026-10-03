/**
 * The public-text composer (design, "Document Generator"; Requirements 30.1,
 * 30.3, 30.5).
 *
 * A public text — the almanac, the poetry-and-prose anthology, the Vienna
 * tram-and-rail timetable — is both a readable Document and the key material a
 * **book cipher** counts letters across (design: "Book-cipher keys … are
 * generated at world generation from corpus word lists. Each is long enough for
 * the page-line-word scheme of every book cipher keyed to it. They are
 * obtainable at the library or bookshop").
 *
 * Two guarantees this composer owns:
 *
 * - **Long enough to key every book cipher (Requirement 30.5).** The book cipher
 *   keys off a public text's *letters*: to encipher a field message it needs at
 *   least as many letters in the key text as the message has (see
 *   `../cipher/cipher.ts`). So a public text's readable body must hold at least
 *   as many letters as the longest field message any book cipher would encode.
 *   The composer takes that required minimum and, if a corpus body falls short,
 *   extends it deterministically (repeating the corpus) until it clears the bar
 *   — so the invariant holds by construction, whatever the authored corpus
 *   length (the core corpora are already word-rich, so no extension is needed in
 *   practice, but the guarantee does not depend on that).
 * - **Obtainable at real Locations (Requirement 30.3).** Each public text is
 *   obtainable at the city's library, bookshop and tobacconist-kiosk Locations —
 *   the public places that stock reading matter and allow the `read` action. The
 *   composer resolves those Location ids from the generated city, so
 *   `obtainableAt` always references Locations that exist.
 *
 * A public text asserts no Propositions (`asserts: []`): it is a key corpus and
 * ordinary reading matter, not a carrier of leads. Determinism: the composer
 * makes no random draws, so the Documents are a pure function of the corpora and
 * the city.
 */

import {
  type PublicText,
} from '@tradecraft/content';
import { type LocId } from '../model/core.js';
import type { City, Location } from '../city/city.js';
import {
  countLetters,
  docId,
  type Document,
} from './document.js';

/**
 * The Location Types at which a public text is obtainable (design: library,
 * bookshop; plus the tobacconist kiosk / Trafik, which stocks papers and
 * reading matter, Requirement 30.3). These are the core-pack Location Type ids.
 */
export const PUBLIC_TEXT_LOCATION_TYPES = [
  'library',
  'bookshop',
  'tobacconist-kiosk',
] as const;

/** Options for {@link composePublicTexts}. */
export interface PublicTextOptions {
  /**
   * The minimum number of letters a public text's body must hold, so a book
   * cipher keyed to it can encipher a message of up to this letter length
   * (Requirement 30.5). A composer sizes this to the longest field message any
   * book cipher would encode. Defaults to {@link DEFAULT_MIN_KEY_LETTERS}.
   */
  readonly minKeyLetters?: number;
}

/**
 * A conservative default minimum key length: enough letters to key a long field
 * message (several Propositions with places and windows), comfortably longer
 * than any Intercept the engine composes. The core corpora already clear this,
 * so this only matters as a floor if a corpus were ever authored very short.
 */
export const DEFAULT_MIN_KEY_LETTERS = 800;

/** The Locations in the city whose type stocks public texts, id-sorted. */
export function publicTextLocations(city: City): LocId[] {
  const wanted = new Set<string>(PUBLIC_TEXT_LOCATION_TYPES);
  return Object.values(city.locations)
    .filter((loc: Location) => wanted.has(loc.type))
    .map((loc) => loc.id)
    .sort();
}

/**
 * The readable body of a public text: its lines joined by newlines. This is the
 * text a reader sees and the text the book cipher counts letters across, so it
 * is a single stable string per corpus.
 */
export function corpusBody(text: PublicText): string {
  return text.lines.join('\n');
}

/**
 * Extend `body` deterministically until it holds at least `minLetters` ASCII
 * letters, by repeating the body (separated by a blank line). The core corpora
 * never need this; it is the floor that makes the Requirement 30.5 guarantee
 * hold for any corpus length. A body with no letters at all is returned
 * unchanged (there is nothing to repeat into letters), which the composer treats
 * as a content bug the caller surfaces.
 */
export function extendToKeyLength(body: string, minLetters: number): string {
  const have = countLetters(body);
  if (have >= minLetters || have === 0) {
    return body;
  }
  const copies = Math.ceil(minLetters / have);
  const parts: string[] = [];
  for (let i = 0; i < copies; i += 1) {
    parts.push(body);
  }
  return parts.join('\n\n');
}

/**
 * Compose the public-text Documents from the loaded corpora and the generated
 * city.
 *
 * Each corpus becomes one `public-text` Document: a readable `body` (extended if
 * needed to clear the key-length floor), obtainable at the city's library,
 * bookshop and kiosk Locations, asserting nothing. The Documents are returned in
 * corpus order, keyed internally by a `doc:public-text/<corpus id>` id.
 *
 * @param corpora the loaded public-text corpora (task's content loader).
 * @param city the generated city, for resolving obtainable Locations.
 */
export function composePublicTexts(
  corpora: readonly PublicText[],
  city: City,
  options: PublicTextOptions = {},
): Document[] {
  const minKeyLetters = options.minKeyLetters ?? DEFAULT_MIN_KEY_LETTERS;
  const obtainableAt = publicTextLocations(city);

  return corpora.map((corpus) => {
    const body = extendToKeyLength(corpusBody(corpus), minKeyLetters);
    const document: Document = {
      id: docId('public-text', corpus.id),
      kind: 'public-text',
      title: corpus.title,
      date: { day: 0, phase: 0 },
      body,
      asserts: [],
      ...(obtainableAt.length > 0 ? { obtainableAt } : {}),
    };
    return document;
  });
}

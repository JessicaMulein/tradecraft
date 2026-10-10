/**
 * Pencil-and-paper aids for one captured ciphertext.
 *
 * The index of coincidence and a trial reading are arithmetic on the
 * ciphertext and the player's own guess. They do not read the cipher spec, and
 * they do not spend a phase. Filing the reading is still the decrypt action.
 */

import { decrypt, type CipherKey } from '@tradecraft/engine';

export interface CoincidenceRow {
  readonly length: number;
  /** Average index of coincidence of the columns, three decimal places. */
  readonly coincidence: number;
}

export interface KeyCoincidence {
  /** Index of coincidence of the whole ciphertext. Near 0.065 reads as one alphabet. */
  readonly overall: number;
  readonly rows: readonly CoincidenceRow[];
}

const LENGTHS = [4, 5, 6, 7] as const;

/** Friedman columns for key lengths 4–7, plus the whole-text coincidence. */
export function keyCoincidence(ciphertext: string): KeyCoincidence {
  const letters = onlyLetters(ciphertext);
  return {
    overall: round3(coincidence(letters)),
    rows: LENGTHS.map((length) => ({
      length,
      coincidence: round3(columnCoincidence(letters, length)),
    })),
  };
}

export type TrialAttempt =
  | { readonly kind: 'caesar'; readonly shift: number }
  | { readonly kind: 'vigenere'; readonly keyword: string }
  | { readonly kind: 'columnar'; readonly keyword: string }
  | { readonly kind: 'book'; readonly text: string }
  | { readonly kind: 'otp'; readonly pad: string };

/**
 * What the ciphertext says under the player's guess, or a short reason the
 * guess cannot be applied. A wrong guess comes back as letters, not an error.
 */
export function trialReading(ciphertext: string, attempt: TrialAttempt): string {
  if (attempt.kind === 'otp') {
    return 'A one-time pad does not open to a guessed word. It opens only when the same pad was used twice.';
  }
  const key = keyOf(attempt);
  if (key === undefined) return '';
  try {
    return decrypt(ciphertext, key);
  } catch {
    return 'That guess does not fit this capture.';
  }
}

function keyOf(attempt: Exclude<TrialAttempt, { kind: 'otp' }>): CipherKey | undefined {
  if (attempt.kind === 'caesar') return { kind: 'caesar', shift: attempt.shift };
  if (attempt.kind === 'vigenere') {
    const keyword = lettersOnly(attempt.keyword);
    if (keyword.length < 2) return undefined;
    return { kind: 'vigenere', keyword };
  }
  if (attempt.kind === 'columnar') {
    const keyword = lettersOnly(attempt.keyword);
    if (keyword.length < 2) return undefined;
    return { kind: 'columnar', key: keyword };
  }
  const text = attempt.text.trim();
  if (text.length < 8) return undefined;
  return { kind: 'book', text };
}

function lettersOnly(word: string): string {
  return word.toUpperCase().replace(/[^A-Z]/g, '');
}

function onlyLetters(text: string): string {
  return text.toUpperCase().replace(/[^A-Z]/g, '');
}

function columnCoincidence(letters: string, length: number): number {
  let total = 0;
  let used = 0;
  for (let column = 0; column < length; column += 1) {
    let slice = '';
    for (let i = column; i < letters.length; i += length) slice += letters[i];
    if (slice.length < 2) continue;
    total += coincidence(slice);
    used += 1;
  }
  if (used === 0) return 0;
  return total / used;
}

function coincidence(letters: string): number {
  const counts = new Array<number>(26).fill(0);
  for (let i = 0; i < letters.length; i += 1) {
    counts[letters.charCodeAt(i) - 65] += 1;
  }
  const n = letters.length;
  if (n < 2) return 0;
  let sum = 0;
  for (const count of counts) sum += count * (count - 1);
  return sum / (n * (n - 1));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

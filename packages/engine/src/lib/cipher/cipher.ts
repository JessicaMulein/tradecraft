/**
 * The Cipher Engine's five hand ciphers, as pure functions.
 *
 * Requirement 9.2 lists the ciphers the engine must support: Caesar, Vigenère,
 * columnar transposition, book cipher (keyed to an in-game public text) and
 * one-time pad. Requirement 9.3 requires these be deterministic code with no
 * language model involvement — so this whole module is pure arithmetic over the
 * alphabet, with no I/O, no clock and no randomness of its own.
 *
 * Every cipher round-trips: `decrypt(encrypt(plain, key), key) === plain` for
 * any valid plaintext and key (Property 8, formalised in task 8.5). The unit
 * tests next to this file check that directly, alongside known vectors.
 *
 * ## Charset
 *
 * The substitution and polyalphabetic ciphers (Caesar, Vigenère, book,
 * one-time pad) work over the 26-letter English alphabet A–Z. They treat the
 * plaintext character by character:
 *
 * - A letter is enciphered within its own case: `a` stays lower, `A` stays
 *   upper, so case survives the round trip.
 * - Any non-letter (digits, spaces, punctuation, accented letters) is a
 *   *passthrough*: it is copied to the output unchanged and does not advance
 *   the running key. This keeps word shapes and formatting readable in the
 *   ciphertext, which matters for an in-game intercept the player must triage,
 *   and it keeps the key aligned to letters only.
 *
 * The columnar transposition cipher is different: it only rearranges
 * characters, it does not substitute them. To keep the grid unambiguous it
 * works on the whole string as given (every character, including spaces, is a
 * cell) and pads the final short row with a sentinel so the inverse can recover
 * the exact original, including trailing spaces. See {@link columnarCipher}.
 */

/** Number of letters in the working alphabet. */
const ALPHABET_SIZE = 26;
const UPPER_A = 'A'.charCodeAt(0);
const UPPER_Z = 'Z'.charCodeAt(0);
const LOWER_A = 'a'.charCodeAt(0);
const LOWER_Z = 'z'.charCodeAt(0);

/** True for an ASCII letter A–Z or a–z. */
function isLetter(code: number): boolean {
  return (
    (code >= UPPER_A && code <= UPPER_Z) ||
    (code >= LOWER_A && code <= LOWER_Z)
  );
}

/** The 0–25 index of an ASCII letter, preserving nothing about its case. */
function letterIndex(code: number): number {
  return code >= LOWER_A ? code - LOWER_A : code - UPPER_A;
}

/** Rebuild a letter character from a 0–25 index and the case of the original. */
function letterFromIndex(index: number, wasUpper: boolean): string {
  const base = wasUpper ? UPPER_A : LOWER_A;
  return String.fromCharCode(base + index);
}

/** JS `%` keeps the sign of the dividend; this always lands in `[0, m)`. */
function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/**
 * The resolved key material for one cipher operation.
 *
 * This is deliberately distinct from the game-facing {@link CipherSpec}. A
 * `CipherSpec` carries *references* — a book cipher names a public-text
 * `DocId`, a one-time pad names a `padId` — because that is what gets stored in
 * an Intercept and shown in the workbench. The pure cipher functions, by
 * contrast, need the actual bytes: the book cipher needs the public text's
 * content, the pad needs its key stream. Resolving a `CipherSpec` to a
 * `CipherKey` (looking the `DocId`/`padId` up in the world) is the caller's
 * job; keeping that lookup out of here is what lets these functions stay pure.
 */
export type CipherKey =
  | { kind: 'caesar'; shift: number }
  | { kind: 'vigenere'; keyword: string }
  | { kind: 'columnar'; key: string }
  | { kind: 'book'; text: string }
  | { kind: 'otp'; pad: string };

/** The cipher kinds, matching the `kind` tags of {@link CipherKey}. */
export type CipherKind = CipherKey['kind'];

/**
 * A single cipher: a kind tag plus a matched pair of pure transforms.
 *
 * `encrypt` and `decrypt` are inverses over valid inputs. They never mutate
 * their arguments and never read anything but their arguments.
 */
export interface Cipher<K extends CipherKey = CipherKey> {
  readonly kind: K['kind'];
  encrypt(plain: string, key: K): string;
  decrypt(cipher: string, key: K): string;
}

// ---------------------------------------------------------------------------
// Shared letter-stream machinery
// ---------------------------------------------------------------------------

/**
 * Apply a per-letter shift to a string, letters only, case preserved,
 * non-letters passed through. `shiftFor(i)` returns the shift (mod 26) to apply
 * to the i-th *letter* (passthrough characters do not advance `i`). This is the
 * common core of Caesar, Vigenère, book and one-time pad; they differ only in
 * where the shift comes from.
 */
function shiftLetters(
  text: string,
  shiftFor: (letterNumber: number) => number,
): string {
  let out = '';
  let letterPos = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (!isLetter(code)) {
      out += text[i];
      continue;
    }
    const wasUpper = code <= UPPER_Z;
    const shifted = mod(letterIndex(code) + shiftFor(letterPos), ALPHABET_SIZE);
    out += letterFromIndex(shifted, wasUpper);
    letterPos += 1;
  }
  return out;
}

/**
 * The letters of a keyword as 0–25 shifts. Non-letters in the keyword are
 * dropped, so `"KEY 1"` keys the same as `"KEY"`.
 */
function keywordShifts(keyword: string): number[] {
  const shifts: number[] = [];
  for (let i = 0; i < keyword.length; i += 1) {
    const code = keyword.charCodeAt(i);
    if (isLetter(code)) {
      shifts.push(letterIndex(code));
    }
  }
  return shifts;
}

// ---------------------------------------------------------------------------
// Caesar
// ---------------------------------------------------------------------------

/**
 * Caesar (shift) cipher. Every letter moves `shift` places along the alphabet.
 * The shift is normalised mod 26, so a shift of 29 is the same as 3 and a
 * negative shift decrypts.
 */
export const caesarCipher: Cipher<{ kind: 'caesar'; shift: number }> = {
  kind: 'caesar',
  encrypt(plain, key) {
    const s = mod(Math.trunc(key.shift), ALPHABET_SIZE);
    return shiftLetters(plain, () => s);
  },
  decrypt(cipher, key) {
    const s = mod(Math.trunc(key.shift), ALPHABET_SIZE);
    return shiftLetters(cipher, () => -s);
  },
};

// ---------------------------------------------------------------------------
// Vigenère
// ---------------------------------------------------------------------------

/**
 * Vigenère cipher. The keyword's letters give a repeating sequence of Caesar
 * shifts; the i-th plaintext letter is shifted by the (i mod keyLen)-th keyword
 * letter. A keyword with no letters is rejected, since it has no shifts to
 * apply.
 */
export const vigenereCipher: Cipher<{ kind: 'vigenere'; keyword: string }> = {
  kind: 'vigenere',
  encrypt(plain, key) {
    const shifts = requireKeywordShifts(key.keyword);
    return shiftLetters(plain, (i) => shifts[i % shifts.length]);
  },
  decrypt(cipher, key) {
    const shifts = requireKeywordShifts(key.keyword);
    return shiftLetters(cipher, (i) => -shifts[i % shifts.length]);
  },
};

function requireKeywordShifts(keyword: string): number[] {
  const shifts = keywordShifts(keyword);
  if (shifts.length === 0) {
    throw new Error('vigenere: keyword must contain at least one letter');
  }
  return shifts;
}

// ---------------------------------------------------------------------------
// Book cipher
// ---------------------------------------------------------------------------

/**
 * Book cipher keyed to an in-game public text (Req 9.2). The public text's
 * letters form a running key, exactly like a Vigenère with an extremely long,
 * non-repeating keyword: the i-th plaintext letter is shifted by the i-th
 * *letter* of the key text. This is the "running-key" form of a book cipher; it
 * needs only the text's content, which is what makes a public almanac or poetry
 * anthology usable as a shared key.
 *
 * The key text must hold at least as many letters as the plaintext, otherwise
 * the stream runs dry and the message cannot be fully keyed. Non-letters in the
 * key text are skipped when building the stream, matching how plaintext
 * non-letters are passed through untouched.
 */
export const bookCipher: Cipher<{ kind: 'book'; text: string }> = {
  kind: 'book',
  encrypt(plain, key) {
    const stream = letterStream(key.text, countLetters(plain), 'book');
    return shiftLetters(plain, (i) => stream[i]);
  },
  decrypt(cipher, key) {
    const stream = letterStream(key.text, countLetters(cipher), 'book');
    return shiftLetters(cipher, (i) => -stream[i]);
  },
};

// ---------------------------------------------------------------------------
// One-time pad
// ---------------------------------------------------------------------------

/**
 * One-time pad (Req 9.2). Identical machinery to the book cipher — a running
 * key of letter shifts — but the key stream is a dedicated pad rather than a
 * public text, and a correct pad is used once and never reused. (Deliberate pad
 * *reuse* as a hostile tradecraft error under Req 9.4 is handled by the
 * intercept generator in task 8.3, not here; here the pad is simply the key
 * material.)
 *
 * The pad must contain at least as many letters as the message has letters.
 */
export const otpCipher: Cipher<{ kind: 'otp'; pad: string }> = {
  kind: 'otp',
  encrypt(plain, key) {
    const stream = letterStream(key.pad, countLetters(plain), 'otp');
    return shiftLetters(plain, (i) => stream[i]);
  },
  decrypt(cipher, key) {
    const stream = letterStream(key.pad, countLetters(cipher), 'otp');
    return shiftLetters(cipher, (i) => -stream[i]);
  },
};

/** Count the ASCII letters in a string. */
function countLetters(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (isLetter(text.charCodeAt(i))) {
      n += 1;
    }
  }
  return n;
}

/**
 * The first `needed` letter-shifts (0–25) of a key text, skipping its
 * non-letters. Throws, naming the cipher, if the text does not have enough
 * letters to key the whole message.
 */
function letterStream(source: string, needed: number, label: string): number[] {
  const shifts: number[] = [];
  for (let i = 0; i < source.length && shifts.length < needed; i += 1) {
    const code = source.charCodeAt(i);
    if (isLetter(code)) {
      shifts.push(letterIndex(code));
    }
  }
  if (shifts.length < needed) {
    throw new Error(
      `${label}: key material has ${shifts.length} letters but the message needs ${needed}`,
    );
  }
  return shifts;
}

// ---------------------------------------------------------------------------
// Columnar transposition
// ---------------------------------------------------------------------------

/**
 * A character that cannot appear in a plaintext and so can safely pad the last
 * row of the transposition grid. U+0000 (NUL) is not something a rendered Fact
 * Line or field message ever contains.
 */
const COLUMNAR_PAD = '\u0000';

/**
 * Columnar transposition cipher, keyed by a key string whose letters define the
 * column read-out order. Unlike the substitution ciphers this one *moves*
 * characters without changing them.
 *
 * Encryption writes the plaintext left-to-right into a grid with one column per
 * key character, padding the final short row with a sentinel, then reads the
 * columns out in the order given by sorting the key characters (ties broken by
 * original position — a stable sort — so repeated key letters are handled).
 * Decryption inverts the column order and strips the padding, recovering the
 * plaintext exactly, including any trailing spaces.
 *
 * The key must be non-empty. Its characters' identities, not their letters, set
 * the order, so a key with spaces or digits still works; what matters is the
 * sort order of its code points.
 */
export const columnarCipher: Cipher<{ kind: 'columnar'; key: string }> = {
  kind: 'columnar',
  encrypt(plain, key) {
    const order = columnOrder(key.key);
    const cols = order.length;
    const rows = Math.ceil(plain.length / cols) || 1;
    const padded = plain.padEnd(rows * cols, COLUMNAR_PAD);

    let out = '';
    for (const col of order) {
      for (let row = 0; row < rows; row += 1) {
        out += padded[row * cols + col];
      }
    }
    return out;
  },
  decrypt(cipher, key) {
    const order = columnOrder(key.key);
    const cols = order.length;
    const rows = Math.ceil(cipher.length / cols) || 1;

    // Fill the grid column by column in read-out order, then read it back
    // row by row to undo the transposition.
    const grid: string[] = new Array<string>(rows * cols).fill('');
    let k = 0;
    for (const col of order) {
      for (let row = 0; row < rows; row += 1) {
        grid[row * cols + col] = cipher[k];
        k += 1;
      }
    }

    let out = '';
    for (let i = 0; i < grid.length; i += 1) {
      out += grid[i];
    }
    // Strip the trailing sentinel padding added at encryption time.
    let end = out.length;
    while (end > 0 && out[end - 1] === COLUMNAR_PAD) {
      end -= 1;
    }
    return out.slice(0, end);
  },
};

/**
 * The column read-out order for a transposition key: the indices 0..n-1 sorted
 * by their key character's code point, ties broken by original index so the
 * sort is stable and repeated key characters stay in left-to-right order.
 */
function columnOrder(key: string): number[] {
  if (key.length === 0) {
    throw new Error('columnar: key must not be empty');
  }
  return Array.from({ length: key.length }, (_, i) => i).sort((a, b) => {
    const ca = key.charCodeAt(a);
    const cb = key.charCodeAt(b);
    return ca === cb ? a - b : ca - cb;
  });
}

// ---------------------------------------------------------------------------
// Registry and dispatch
// ---------------------------------------------------------------------------

/** Every cipher, keyed by kind, so a `CipherKey` can be dispatched by tag. */
export const CIPHERS: { readonly [K in CipherKind]: Cipher<Extract<CipherKey, { kind: K }>> } = {
  caesar: caesarCipher,
  vigenere: vigenereCipher,
  columnar: columnarCipher,
  book: bookCipher,
  otp: otpCipher,
};

/**
 * Encrypt `plain` under a resolved {@link CipherKey}, dispatching on its kind.
 */
export function encrypt(plain: string, key: CipherKey): string {
  switch (key.kind) {
    case 'caesar':
      return caesarCipher.encrypt(plain, key);
    case 'vigenere':
      return vigenereCipher.encrypt(plain, key);
    case 'columnar':
      return columnarCipher.encrypt(plain, key);
    case 'book':
      return bookCipher.encrypt(plain, key);
    case 'otp':
      return otpCipher.encrypt(plain, key);
  }
}

/**
 * Decrypt `cipher` under a resolved {@link CipherKey}, dispatching on its kind.
 */
export function decrypt(cipher: string, key: CipherKey): string {
  switch (key.kind) {
    case 'caesar':
      return caesarCipher.decrypt(cipher, key);
    case 'vigenere':
      return vigenereCipher.decrypt(cipher, key);
    case 'columnar':
      return columnarCipher.decrypt(cipher, key);
    case 'book':
      return bookCipher.decrypt(cipher, key);
    case 'otp':
      return otpCipher.decrypt(cipher, key);
  }
}

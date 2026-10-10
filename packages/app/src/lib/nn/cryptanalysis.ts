/**
 * Break an Intercept from what the Workbench shows.
 *
 * The ciphertext, its punctuation, a Caesar preview's worth of shifts, any
 * public text the player can open, and a revealed operator mistake (a fixed
 * header, or a pad reused on another capture). The cipher spec itself is never
 * read. A break is a plaintext the analyst can justify, submitted as the
 * player's own solution.
 *
 * Traffic is a field message: a field code, then entity ids such as `npc:` and
 * `loc:`. Spaces and colons are not enciphered, so those skeletons are already
 * on the page. Caesar is the twenty-six shifts. Vigenère fits a repeating
 * keyword to the cribs those skeletons imply. A book cipher is each public
 * text tried as the running key. Columnar is each column order of a short key.
 * A one-time pad is left alone unless the operator reused it, in which case the
 * two captures are read against each other.
 */

import { CIPHER_KEYWORDS, decrypt, type KeySubmission } from '@tradecraft/engine';

/** One capture, as the Workbench lists it. */
export interface TrafficCopy {
  readonly id: string;
  readonly ciphertext: string;
  /** The stereotyped header crib, when the Workbench shows a fixed-header error. */
  readonly header?: string;
  /** The other capture a reused pad was used on, when the Workbench says so. */
  readonly padReuseWith?: string;
}

/** A public text the player can open and try as a book-cipher key. */
export interface ReadableText {
  readonly id: string;
  readonly body: string;
}

/** A decryption the analyst can defend from the traffic alone. */
export interface BreakResult {
  readonly method: 'caesar' | 'vigenere' | 'columnar' | 'book' | 'pad-reuse';
  readonly submission: KeySubmission;
}

const FIELD_CODES = [
  'MO',
  'WF',
  'RT',
  'MT',
  'LA',
  'TT',
  'SF',
  'PL',
  'TG',
  'CA',
  'SU',
  'UC',
  'KN',
  'SP',
  'AL',
  // Ambient pack: city events and the relationships among townsfolk.
  'OC',
  'AD',
  'HS',
  'RL',
  'IV',
  'OW',
] as const;

const PREFIXES = ['npc', 'loc', 'org', 'unk', 'item', 'doc', 'chan', 'evt'];

const FIELD_CODE_SET = new Set<string>(FIELD_CODES);

/** Verbs and phase words on an operational German cable. */
const CABLE_WORDS = new Set<string>([
  'GEHOERT',
  'ARBEITET',
  'MELDET',
  'TRIFFT',
  'GESEHEN',
  'REIST',
  'ERWARTET',
  'PLANT',
  'ZIEL',
  'TRAEGT',
  'LIEFERT',
  'KANAL',
  'KENNT',
  'VERMUTET',
  'ALIAS',
  'MORGENS',
  'NACHMITTAGS',
  'ABENDS',
  'NACHTS',
]);

/** The phase word that follows `TAG n` on a cable, by its letter count. */
const PHASE_CRIB: Readonly<Record<number, readonly string[]>> = {
  6: ['ABENDS', 'NACHTS'],
  7: ['MORGENS'],
  11: ['NACHMITTAGS'],
};

const SEARCH_LIMIT = 100_000;

interface Anchor {
  readonly pos: number;
  readonly cipher: string;
  readonly candidates: readonly string[];
}

/**
 * Which attempts to run. `structure` is Caesar, Vigenère, and columnar, which
 * depend only on the ciphertext. `books` tries the supplied public texts.
 * `all` runs structure, then books. A reused pad is only attempted in `all`.
 */
export type BreakMode = 'all' | 'structure' | 'books';

/**
 * Recover the field message, or `undefined` when the traffic does not give
 * it up. `knownIds` are entity ids already on the map, the people list, or
 * the Case File, used as cribs when a pad was reused.
 */
export function breakTraffic(
  traffic: TrafficCopy,
  library: readonly ReadableText[] = [],
  others: readonly TrafficCopy[] = [],
  knownIds: readonly string[] = [],
  mode: BreakMode = 'all',
): BreakResult | undefined {
  if (mode === 'all' && traffic.padReuseWith !== undefined) {
    const other = others.find((copy) => copy.id === traffic.padReuseWith);
    if (other === undefined || other.id === traffic.id) return undefined;
    return breakPad(traffic, other, knownIds);
  }
  if (mode !== 'books') {
    const structural =
      breakCaesar(traffic) ?? breakVigenere(traffic) ?? breakColumnar(traffic);
    if (structural !== undefined || mode === 'structure') return structural;
  }
  return breakBook(traffic, library);
}

function breakCaesar(traffic: TrafficCopy): BreakResult | undefined {
  for (let shift = 0; shift < 26; shift += 1) {
    const field = recovered(
      traffic,
      decrypt(traffic.ciphertext, { kind: 'caesar', shift }),
    );
    if (field !== undefined) return done('caesar', field);
  }
  return undefined;
}

function breakByWord(
  traffic: TrafficCopy,
  kind: 'vigenere' | 'columnar',
): BreakResult | undefined {
  for (const word of CIPHER_KEYWORDS) {
    if (word.length < 4 || word.length > 7) continue;
    let plain: string;
    try {
      plain =
        kind === 'vigenere'
          ? decrypt(traffic.ciphertext, { kind: 'vigenere', keyword: word })
          : decrypt(traffic.ciphertext, { kind: 'columnar', key: word });
    } catch {
      continue;
    }
    const field = recovered(traffic, plain);
    if (field !== undefined) return done(kind, field);
  }
  return undefined;
}

function breakVigenere(traffic: TrafficCopy): BreakResult | undefined {
  const byWord = breakByWord(traffic, 'vigenere');
  if (byWord !== undefined) return byWord;
  const anchors = anchorsOf(traffic.ciphertext, traffic.header, []);
  if (anchors.length === 0) return undefined;
  for (let length = 4; length <= 7; length += 1) {
    const keyword = fitKey(anchors, length, true, (shifts) =>
      recovered(
        traffic,
        decrypt(traffic.ciphertext, {
          kind: 'vigenere',
          keyword: letters(shifts),
        }),
      ),
    );
    if (keyword !== undefined) return done('vigenere', keyword);
  }
  return undefined;
}

function breakBook(
  traffic: TrafficCopy,
  library: readonly ReadableText[],
): BreakResult | undefined {
  for (const text of library) {
    if (text.body.length === 0) continue;
    let plain: string;
    try {
      plain = decrypt(traffic.ciphertext, { kind: 'book', text: text.body });
    } catch {
      continue;
    }
    const field = recovered(traffic, plain);
    if (field !== undefined) return done('book', field);
  }
  return undefined;
}

function breakColumnar(traffic: TrafficCopy): BreakResult | undefined {
  const byWord = breakByWord(traffic, 'columnar');
  if (byWord !== undefined) return byWord;
  for (let length = 4; length <= 7; length += 1) {
    for (const order of permutations(length)) {
      let plain: string;
      try {
        plain = decrypt(traffic.ciphertext, {
          kind: 'columnar',
          key: keyForOrder(order),
        });
      } catch {
        continue;
      }
      const field = recovered(traffic, plain);
      if (field !== undefined) return done('columnar', field);
    }
  }
  return undefined;
}

function breakPad(
  traffic: TrafficCopy,
  other: TrafficCopy,
  knownIds: readonly string[],
): BreakResult | undefined {
  const anchors = [
    ...anchorsOf(traffic.ciphertext, traffic.header, knownIds),
    ...anchorsOf(other.ciphertext, other.header, knownIds),
  ];
  const lettersNeeded = countLetters(traffic.ciphertext);
  const length = Math.max(lettersNeeded, countLetters(other.ciphertext));
  if (lettersNeeded === 0 || anchors.length === 0) return undefined;
  const plain = fitKey(
    anchors,
    length,
    false,
    (shifts) => {
      try {
        const pad = letters(shifts.slice(0, lettersNeeded));
        const target = recovered(
          traffic,
          decrypt(traffic.ciphertext, { kind: 'otp', pad }),
        );
        if (target === undefined) return undefined;
        const partner = recovered(
          other,
          decrypt(other.ciphertext, { kind: 'otp', pad }),
        );
        return partner === undefined ? undefined : target;
      } catch {
        return undefined;
      }
    },
    lettersNeeded,
  );
  return plain === undefined ? undefined : done('pad-reuse', plain);
}

function done(method: BreakResult['method'], text: string): BreakResult {
  return { method, submission: { kind: 'plaintext', text } };
}

/**
 * Fit cribs to a repeating keyword (`periodic`) or a running pad. Returns the
 * recovered field message when the fitted key decrypts into one.
 */
function fitKey(
  anchors: readonly Anchor[],
  length: number,
  periodic: boolean,
  render: (shifts: readonly number[]) => string | undefined,
  required = length,
): string | undefined {
  const key: (number | undefined)[] = Array.from({ length }, () => undefined);
  const ordered = [...anchors].sort(
    (a, b) => a.candidates.length - b.candidates.length || a.pos - b.pos,
  );
  let steps = 0;
  let found: string | undefined;
  let ambiguous = false;
  if (!covers(anchors, length, periodic, required)) return undefined;

  function rec(n: number): void {
    steps += 1;
    if (ambiguous || steps > SEARCH_LIMIT) {
      if (steps > SEARCH_LIMIT) ambiguous = true;
      return;
    }
    if (n === ordered.length) {
      for (let i = 0; i < required; i += 1) {
        if (key[i] === undefined) return undefined;
      }
      const plain = render(key.map((shift) => shift ?? 0));
      if (plain === undefined) return undefined;
      if (found === undefined) {
        found = plain;
        return undefined;
      }
      if (plain !== found) ambiguous = true;
      return undefined;
    }
    const anchor = ordered[n];
    for (const cand of anchor.candidates) {
      if (cand.length !== anchor.cipher.length) continue;
      const wrote: number[] = [];
      let clash = false;
      for (let i = 0; i < cand.length; i += 1) {
        const slot = periodic ? (anchor.pos + i) % length : anchor.pos + i;
        if (slot >= length) {
          clash = true;
          break;
        }
        const shift = mod(
          letterIndex(anchor.cipher[i]) - letterIndex(cand[i]),
          26,
        );
        if (key[slot] === undefined) {
          key[slot] = shift;
          wrote.push(slot);
        } else if (key[slot] !== shift) {
          clash = true;
          break;
        }
      }
      if (!clash) rec(n + 1);
      for (const slot of wrote) key[slot] = undefined;
      if (ambiguous) return;
    }
  }

  rec(0);
  return ambiguous ? undefined : found;
}

/** True when the cribs touch every key slot the message needs. */
function covers(
  anchors: readonly Anchor[],
  length: number,
  periodic: boolean,
  required: number,
): boolean {
  const seen = Array<boolean>(required).fill(false);
  for (const anchor of anchors) {
    for (let i = 0; i < anchor.cipher.length; i += 1) {
      const slot = periodic ? (anchor.pos + i) % length : anchor.pos + i;
      if (slot >= 0 && slot < required) seen[slot] = true;
    }
  }
  return seen.every(Boolean);
}

function anchorsOf(
  ciphertext: string,
  header: string | undefined,
  knownIds: readonly string[],
): Anchor[] {
  const anchors: Anchor[] = [];
  const headerLetters = header === undefined ? '' : onlyLetters(header);
  let i = 0;
  let pos = 0;
  let lineStart = true;
  while (i < ciphertext.length) {
    const ch = ciphertext[i];
    if (!isLetterChar(ch)) {
      lineStart = ch === '\n';
      i += 1;
      continue;
    }
    const start = pos;
    let run = '';
    while (i < ciphertext.length && isLetterChar(ciphertext[i])) {
      run += ciphertext[i];
      i += 1;
      pos += 1;
    }
    const next = ciphertext[i];
    if (next === ':') {
      let localLetters = '';
      let j = i + 1;
      while (j < ciphertext.length && isLocalChar(ciphertext[j])) {
        if (isLetterChar(ciphertext[j])) localLetters += ciphertext[j];
        j += 1;
      }
      const full = knownIdLetters(run.length, localLetters.length, knownIds);
      if (full.length > 0) {
        anchors.push({
          pos: start,
          cipher: run + localLetters,
          candidates: full,
        });
      } else {
        const prefixes = PREFIXES.filter(
          (prefix) => prefix.length === run.length,
        );
        if (prefixes.length > 0) {
          anchors.push({ pos: start, cipher: run, candidates: prefixes });
        }
      }
      i = j;
      pos += localLetters.length;
      lineStart = false;
      continue;
    }
    if (lineStart && next === ' ' && run.length >= 2 && run.length <= 4) {
      const codes = FIELD_CODES.filter((code) => code.length === run.length);
      if (codes.length > 0)
        anchors.push({ pos: start, cipher: run, candidates: codes });
    }
    lineStart = false;
  }
  anchors.push(...cableCribs(ciphertext));
  if (headerLetters.length > 0) {
    const first = onlyLetters(ciphertext.split('\n')[0] ?? '');
    if (first.length === headerLetters.length) {
      anchors.unshift({ pos: 0, cipher: first, candidates: [headerLetters] });
    }
  }
  return anchors;
}

function knownIdLetters(
  prefixLength: number,
  nameLength: number,
  knownIds: readonly string[],
): string[] {
  const found: string[] = [];
  for (const id of knownIds) {
    const colon = id.indexOf(':');
    if (colon <= 0) continue;
    const prefix = onlyLetters(id.slice(0, colon));
    const name = onlyLetters(id.slice(colon + 1));
    if (prefix.length === prefixLength && name.length === nameLength) {
      found.push(prefix + name);
    }
    if (found.length >= 24) break;
  }
  return [...new Set(found)];
}

function recovered(traffic: TrafficCopy, plain: string): string | undefined {
  let body = plain;
  if (traffic.header !== undefined) {
    const prefix = `${traffic.header}\n`;
    if (!body.startsWith(prefix)) return undefined;
    body = body.slice(prefix.length);
  }
  if (looksLikeFieldMessage(body) || looksLikeCable(body)) return body;
  return undefined;
}

/**
 * A cable: uppercase words, one fact a line, with a verb the operational
 * notes actually use. Digits and spaces stay in the clear, as on the wire.
 */
function looksLikeCable(text: string): boolean {
  const lines = text.split('\n').filter((line) => line.length > 0);
  if (lines.length === 0 || text.includes('\u0000')) return false;
  let verbs = 0;
  for (const line of lines) {
    if (!/^[A-Z0-9 ]+$/.test(line)) return false;
    const words = line.split(' ').filter((word) => word.length > 0);
    if (words.length < 3) return false;
    if (words.some((word) => CABLE_WORDS.has(word))) verbs += 1;
  }
  return verbs > 0;
}

/**
 * `TAG 4 MORGENS` keeps the digit in the clear. The three-letter word before
 * it and the phase word after it are cribs, and a phase word of seven letters
 * or more covers a keyword of length 4–7 by itself.
 */
function cableCribs(ciphertext: string): Anchor[] {
  const tokens: { readonly letters: string; readonly pos: number; readonly kind: 'word' | 'number' }[] = [];
  let i = 0;
  let pos = 0;
  while (i < ciphertext.length) {
    const ch = ciphertext[i];
    if (ch >= '0' && ch <= '9') {
      while (i < ciphertext.length && ciphertext[i] >= '0' && ciphertext[i] <= '9') i += 1;
      tokens.push({ letters: '', pos, kind: 'number' });
      continue;
    }
    if (!isLetterChar(ch)) {
      i += 1;
      continue;
    }
    const start = pos;
    let run = '';
    while (i < ciphertext.length && isLetterChar(ciphertext[i])) {
      run += ciphertext[i];
      i += 1;
      pos += 1;
    }
    tokens.push({ letters: run, pos: start, kind: 'word' });
  }
  const anchors: Anchor[] = [];
  for (let t = 0; t < tokens.length; t += 1) {
    if (tokens[t].kind !== 'number') continue;
    const before = tokens[t - 1];
    const after = tokens[t + 1];
    if (before === undefined || after === undefined) continue;
    if (before.kind !== 'word' || after.kind !== 'word') continue;
    const phase = PHASE_CRIB[after.letters.length];
    if (phase === undefined || before.letters.length !== 3) continue;
    anchors.push({ pos: before.pos, cipher: before.letters, candidates: ['TAG'] });
    anchors.push({ pos: after.pos, cipher: after.letters, candidates: phase });
  }
  return anchors;
}

/** A field message: field codes, entity ids, and the sigils the wire format uses. */
function looksLikeFieldMessage(text: string): boolean {
  const lines = text.split('\n').filter((line) => line.length > 0);
  if (lines.length === 0 || text.includes('\u0000')) return false;
  let ids = 0;
  for (const line of lines) {
    const tokens = line.split(' ');
    if (tokens.length < 3 || !FIELD_CODE_SET.has(tokens[0])) return false;
    for (let i = 1; i < tokens.length; i += 1) {
      const token = tokens[i];
      if (token.startsWith('@') || token.startsWith('^')) {
        if (!isEntityToken(token.slice(1))) return false;
        ids += 1;
      } else if (token.startsWith('~')) {
        if (!/^\d+\.\d+(\.\.\d+\.\d+)?$/.test(token.slice(1))) return false;
      } else if (token.startsWith('=')) {
        if (!/^=[TAM]:\S+$/.test(token)) return false;
      } else if (isEntityToken(token)) {
        ids += 1;
      } else {
        return false;
      }
    }
  }
  return ids > 0;
}

function isEntityToken(token: string): boolean {
  return /^(npc|loc|org|unk|item|doc|chan|evt):[A-Za-z0-9][A-Za-z0-9_-]*$/.test(
    token,
  );
}

function isLocalChar(ch: string): boolean {
  return (
    isLetterChar(ch) || (ch >= '0' && ch <= '9') || ch === '_' || ch === '-'
  );
}

function permutations(n: number): number[][] {
  const items = Array.from({ length: n }, (_, i) => i);
  const out: number[][] = [];
  function heap(k: number): void {
    if (k === 1) {
      out.push([...items]);
      return;
    }
    heap(k - 1);
    for (let i = 0; i < k - 1; i += 1) {
      const swapWith = k % 2 === 0 ? i : 0;
      const tmp = items[swapWith];
      items[swapWith] = items[k - 1];
      items[k - 1] = tmp;
      heap(k - 1);
    }
  }
  heap(n);
  return out;
}

/** A keyword whose letter order reads columns out in `order`. */
function keyForOrder(order: readonly number[]): string {
  const key = Array<string>(order.length);
  for (let rank = 0; rank < order.length; rank += 1) {
    key[order[rank]] = String.fromCharCode(65 + rank);
  }
  return key.join('');
}

function letters(shifts: readonly number[]): string {
  return shifts.map((shift) => String.fromCharCode(65 + shift)).join('');
}

function countLetters(text: string): number {
  return onlyLetters(text).length;
}

function onlyLetters(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    if (isLetterChar(text[i])) out += text[i];
  }
  return out;
}

function isLetterChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function letterIndex(ch: string): number {
  const code = ch.charCodeAt(0);
  return code >= 97 ? code - 97 : code - 65;
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

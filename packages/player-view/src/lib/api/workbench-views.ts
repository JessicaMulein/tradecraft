/**
 * The Intercepts list and Workbench Player-View projections (design, "Engine
 * API (`player-view/api`)", "TUI": "Workbench: the selected Intercept with
 * metadata, frequency table, shift preview, and a key/plaintext entry";
 * Requirements 9.5, 9.6, 25.3).
 *
 * These are the view-safe projections of the player's collected
 * {@link import('@tradecraft/engine').Intercept}s — the ciphertext captured off
 * a Channel (Requirement 25.3), with the traffic metadata, the frequency table
 * and the caesar shift preview the analyst works from (Requirement 9.6). The
 * player deduces the cipher from the ciphertext, the frequency table and any
 * revealed tradecraft error; the Sim verifies their submission (the `decrypt`
 * action; Requirement 9.5), so this surface never carries the answer.
 *
 * ## Truth isolation (Requirement 2.2; Property 3)
 *
 * An Intercept's truth-bearing fields — its ground-truth cipher `spec`, its
 * source `plaintextProps`, and its trace `origin` — are
 * {@link import('@tradecraft/engine').Truth}-branded: they are exactly the
 * secret the player works to recover, and must never cross into a projection.
 * Every function here reads only the *unbranded* Intercept surface:
 *
 * - the id, Channel, owner and direction (traffic metadata the player reads off
 *   the capture);
 * - the {@link import('@tradecraft/engine').InterceptMeta} (length, optional
 *   header crib, optional callsign);
 * - the `ciphertext` itself; and
 * - the `tradecraftError`, when one was injected and is therefore observable.
 *
 * It never reads `intercept.spec`, `intercept.plaintextProps` or
 * `intercept.origin`, and it never calls the engine's `revealedSpec`/`decrypt`
 * helpers (those read Truth and are Sim operations). The frequency table and
 * the shift preview are *pure client-side analysis* of the ciphertext — the
 * same arithmetic an analyst would do by hand — so they reveal nothing the
 * ciphertext does not already show.
 */

import type {
  ChannelId,
  CommsOwner,
  GameTime,
  Intercept,
  InterceptId,
  TradecraftError,
  WorldState,
} from '@tradecraft/engine';

// ---------------------------------------------------------------------------
// Caesar shift preview arithmetic
// ---------------------------------------------------------------------------

/** Number of letters in the working alphabet A–Z (mirrors the Cipher Engine). */
const ALPHABET_SIZE = 26;
const UPPER_A = 'A'.charCodeAt(0);
const UPPER_Z = 'Z'.charCodeAt(0);
const LOWER_A = 'a'.charCodeAt(0);
const LOWER_Z = 'z'.charCodeAt(0);

/** The 26 shift amounts a caesar preview offers, `0..25`. */
export const CAESAR_SHIFTS: readonly number[] = Array.from(
  { length: ALPHABET_SIZE },
  (_, i) => i,
);

/** True for an ASCII letter A–Z or a–z. */
function isLetter(code: number): boolean {
  return (
    (code >= UPPER_A && code <= UPPER_Z) || (code >= LOWER_A && code <= LOWER_Z)
  );
}

/** A positive modulus, so a negative shift wraps into `[0, 26)`. */
function mod(n: number): number {
  return ((n % ALPHABET_SIZE) + ALPHABET_SIZE) % ALPHABET_SIZE;
}

/**
 * The ciphertext as it would read if it were a caesar enciphered with `shift` —
 * i.e. each letter moved *back* by `shift` places, case preserved, non-letters
 * passed through. This is the "decrypt at shift N" the analyst slides through
 * `0..25` to eyeball a caesar: at the true shift the plaintext falls out.
 *
 * Pure arithmetic on the ciphertext string only (Requirement 9.6); it uses no
 * key material and consults no Truth, so it reveals nothing the ciphertext does
 * not already show. The shift is normalised mod 26.
 */
export function caesarShift(ciphertext: string, shift: number): string {
  const s = mod(Math.trunc(shift));
  let out = '';
  for (let i = 0; i < ciphertext.length; i += 1) {
    const code = ciphertext.charCodeAt(i);
    if (!isLetter(code)) {
      out += ciphertext[i];
      continue;
    }
    const base = code <= UPPER_Z ? UPPER_A : LOWER_A;
    out += String.fromCharCode(base + mod(code - base - s));
  }
  return out;
}

/** One row of the caesar shift preview: the shift and the resulting text. */
export interface ShiftPreviewRow {
  /** The shift applied, `0..25`. */
  readonly shift: number;
  /** The ciphertext read back at this shift (a caesar-decrypt guess). */
  readonly text: string;
}

/**
 * The caesar shift preview over a ciphertext: all 26 shifts `0..25`, each with
 * the ciphertext read back at that shift (Requirement 9.6). Pure client-side
 * analysis — the player slides through the rows looking for the one that reads
 * as plaintext.
 */
export function caesarShiftPreview(ciphertext: string): readonly ShiftPreviewRow[] {
  return CAESAR_SHIFTS.map((shift) => ({ shift, text: caesarShift(ciphertext, shift) }));
}

// ---------------------------------------------------------------------------
// Frequency table
// ---------------------------------------------------------------------------

/** One letter's count in the frequency table. */
export interface FrequencyEntry {
  /** The upper-case letter A–Z. */
  readonly letter: string;
  /** How many times it occurs in the ciphertext (case-insensitive). */
  readonly count: number;
}

/**
 * The letter-frequency table of a ciphertext: the count of each letter A–Z,
 * case-insensitive, in alphabetical order (Requirement 9.6). Non-letters are
 * ignored; every letter A–Z is present (count `0` when absent) so the table is
 * a stable 26-row shape the Workbench renders directly. Pure analysis of the
 * ciphertext — the classic first move against a substitution cipher.
 */
export function frequencyTable(ciphertext: string): readonly FrequencyEntry[] {
  const counts = new Array<number>(ALPHABET_SIZE).fill(0);
  for (let i = 0; i < ciphertext.length; i += 1) {
    const code = ciphertext.charCodeAt(i);
    if (code >= UPPER_A && code <= UPPER_Z) {
      counts[code - UPPER_A] += 1;
    } else if (code >= LOWER_A && code <= LOWER_Z) {
      counts[code - LOWER_A] += 1;
    }
  }
  return counts.map((count, i) => ({
    letter: String.fromCharCode(UPPER_A + i),
    count,
  }));
}

// ---------------------------------------------------------------------------
// Intercepts list view
// ---------------------------------------------------------------------------

/**
 * One Intercept as the Intercepts list presents it: the view-safe traffic
 * metadata the player reads before opening the Workbench (Requirement 25.3). An
 * Intercept carries its truth behind {@link import('@tradecraft/engine').Truth}
 * branding; none of those fields are read here.
 *
 * `hasTradecraftError` is a *flag* only — whether the capture carries an
 * exploitable operator mistake — so the list can mark the promising captures
 * without the Workbench-only detail (the error kind and its link) spilling into
 * the summary.
 */
export interface InterceptListEntry {
  readonly id: InterceptId;
  /** The Channel it was captured on. */
  readonly channel: ChannelId;
  /** The organisation that sent it (the Channel's owner). */
  readonly owner: CommsOwner;
  /** Direction of travel relative to the owner. */
  readonly direction: 'outbound' | 'inbound';
  /** When the transmission fired. */
  readonly at: GameTime;
  /** The ciphertext length (the first thing an analyst reads). */
  readonly length: number;
  /** The call sign derived from the Channel, when present. */
  readonly callsign?: string;
  /** Whether an exploitable tradecraft error is attached (Requirement 9.4). */
  readonly hasTradecraftError: boolean;
}

/**
 * The Intercepts list the TUI shows: the player's collected Intercepts, newest
 * first, each as a view-safe {@link InterceptListEntry}. The player collects
 * Intercepts into `WorldState.intercepts` with the intercept action
 * (Requirement 25.3); this projection lists exactly those, so a freshly
 * generated world (nothing collected yet) lists nothing.
 */
export interface InterceptListView {
  readonly intercepts: readonly InterceptListEntry[];
}

/** Order Intercepts newest first, ties broken by id for a total, stable order. */
function compareByTimeDesc(a: Intercept, b: Intercept): number {
  if (a.at.day !== b.at.day) {
    return b.at.day - a.at.day;
  }
  if (a.at.phase !== b.at.phase) {
    return b.at.phase - a.at.phase;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Project one Intercept to its list entry (view-safe metadata only). */
function interceptListEntry(intercept: Intercept): InterceptListEntry {
  return {
    id: intercept.id,
    channel: intercept.channel,
    owner: intercept.owner,
    direction: intercept.direction,
    at: intercept.at,
    length: intercept.meta.length,
    ...(intercept.meta.callsign !== undefined
      ? { callsign: intercept.meta.callsign }
      : {}),
    hasTradecraftError: intercept.tradecraftError !== undefined,
  };
}

/**
 * Build the {@link InterceptListView} for the player's collected Intercepts
 * (`WorldState.intercepts`), newest first. Pure read of view-safe surface — no
 * Intercept's `spec`, `plaintextProps` or `origin` is touched.
 */
export function interceptListView(state: WorldState): InterceptListView {
  const intercepts = Object.values(state.intercepts)
    .slice()
    .sort(compareByTimeDesc)
    .map(interceptListEntry);
  return { intercepts };
}

// ---------------------------------------------------------------------------
// Workbench view
// ---------------------------------------------------------------------------

/**
 * The Workbench view for one Intercept (design, "TUI"; Requirements 9.5, 9.6,
 * 25.3): the selected Intercept's metadata, its ciphertext, the letter-
 * frequency table, the caesar shift preview, and the revealed tradecraft error
 * if one applies.
 *
 * This is the full analyst surface, and it is entirely view-safe. It carries
 * **no** true cipher spec and **no** plaintext — the player deduces the cipher
 * and submits a key or plaintext, and the Sim verifies it (the `decrypt`
 * action; Requirement 9.5). The frequency table and shift preview are pure
 * client-side analysis of the ciphertext (Requirement 9.6). The
 * `tradecraftError`, when present, is the already-observable operator mistake
 * (pad reuse's linked Intercept, or the fixed-header crib) the player can
 * exploit — it is not Truth-branded, so surfacing it leaks nothing.
 */
export interface WorkbenchView {
  readonly id: InterceptId;
  /** The Channel it was captured on. */
  readonly channel: ChannelId;
  /** The organisation that sent it (the Channel's owner). */
  readonly owner: CommsOwner;
  /** Direction of travel relative to the owner. */
  readonly direction: 'outbound' | 'inbound';
  /** When the transmission fired. */
  readonly at: GameTime;
  /** The ciphertext length. */
  readonly length: number;
  /** The call sign derived from the Channel, when present. */
  readonly callsign?: string;
  /** A stereotyped header crib, present only on a `fixed-header` error. */
  readonly header?: string;
  /** The enciphered field message the player works on. */
  readonly ciphertext: string;
  /** The letter-frequency table of the ciphertext (Requirement 9.6). */
  readonly frequency: readonly FrequencyEntry[];
  /** The caesar shift preview over all 26 shifts (Requirement 9.6). */
  readonly shiftPreview: readonly ShiftPreviewRow[];
  /** The exploitable tradecraft error, when one is attached (Requirement 9.4). */
  readonly tradecraftError?: TradecraftError;
}

/**
 * Build the {@link WorkbenchView} for one Intercept, or `undefined` if the id
 * names no Intercept the player has collected. Pure read of the Intercept's
 * view-safe surface plus the client-side frequency/shift analysis of its
 * ciphertext; it never reads the Truth-branded `spec`, `plaintextProps` or
 * `origin`.
 */
export function workbenchView(
  state: WorldState,
  id: InterceptId,
): WorkbenchView | undefined {
  const intercept = state.intercepts[id];
  if (intercept === undefined) {
    return undefined;
  }
  return {
    id: intercept.id,
    channel: intercept.channel,
    owner: intercept.owner,
    direction: intercept.direction,
    at: intercept.at,
    length: intercept.meta.length,
    ...(intercept.meta.callsign !== undefined
      ? { callsign: intercept.meta.callsign }
      : {}),
    ...(intercept.meta.header !== undefined
      ? { header: intercept.meta.header }
      : {}),
    ciphertext: intercept.ciphertext,
    frequency: frequencyTable(intercept.ciphertext),
    shiftPreview: caesarShiftPreview(intercept.ciphertext),
    ...(intercept.tradecraftError !== undefined
      ? { tradecraftError: intercept.tradecraftError }
      : {}),
  };
}

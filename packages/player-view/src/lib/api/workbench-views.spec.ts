/**
 * Behaviour and truth-safety tests for the Intercepts list and Workbench
 * Player-View projections (task 22.5; design, "Engine API", "TUI"; Requirements
 * 9.5, 9.6, 25.3).
 *
 * These check the two things the projections must get right:
 *
 * - the analyst arithmetic — the letter-frequency table and the caesar shift
 *   preview — is computed correctly from the ciphertext alone (Requirement
 *   9.6); and
 * - the projection carries **no truth** — no Intercept's ground-truth cipher
 *   `spec`, source `plaintextProps` or trace `origin` crosses into the view
 *   (Requirement 2.2), so a player who serialises a `WorkbenchView` cannot read
 *   the answer off it.
 *
 * The fixtures build real {@link Intercept}s — including their Truth-branded
 * fields — so the truth-safety assertions run against ground truth actually
 * present on the record, not a stripped shape.
 */

import { describe, expect, it } from 'vitest';
import {
  asTruth,
  encrypt,
  type ChannelId,
  type CipherSpec,
  type GameTime,
  type Intercept,
  type InterceptId,
  type WorldState,
} from '@tradecraft/engine';

import {
  CAESAR_SHIFTS,
  caesarShift,
  caesarShiftPreview,
  frequencyTable,
  interceptListView,
  workbenchView,
} from './workbench-views.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Build an Intercept with real Truth-branded fields for truth-safety checks. */
function makeIntercept(opts: {
  id: string;
  channel?: string;
  ciphertext: string;
  spec: CipherSpec;
  plaintextProps?: readonly string[];
  day?: number;
  phase?: number;
  tradecraftError?: Intercept['tradecraftError'];
  callsign?: string;
  header?: string;
}): Intercept {
  return {
    id: opts.id as InterceptId,
    at: { day: opts.day ?? 1, phase: (opts.phase ?? 0) as GameTime['phase'] },
    channel: (opts.channel ?? 'chan:numbers') as ChannelId,
    owner: 'org:hostile',
    direction: 'outbound',
    meta: {
      length: opts.ciphertext.length,
      ...(opts.header !== undefined ? { header: opts.header } : {}),
      ...(opts.callsign !== undefined ? { callsign: opts.callsign } : {}),
    },
    ciphertext: opts.ciphertext,
    spec: asTruth(opts.spec),
    plaintextProps: asTruth(opts.plaintextProps ?? ['prop:secret-meeting']),
    origin: asTruth('plot'),
    ...(opts.tradecraftError !== undefined
      ? { tradecraftError: opts.tradecraftError }
      : {}),
  };
}

/** A minimal WorldState carrying only the Intercepts the projections read. */
function stateWith(intercepts: readonly Intercept[]): WorldState {
  const record: Record<string, Intercept> = {};
  for (const i of intercepts) {
    record[i.id] = i;
  }
  return { intercepts: record } as unknown as WorldState;
}

// ---------------------------------------------------------------------------
// Frequency table (Req 9.6)
// ---------------------------------------------------------------------------

describe('frequencyTable', () => {
  it('counts each letter case-insensitively and lists all 26 in order', () => {
    const table = frequencyTable('AaBbbZ 1!z');
    expect(table).toHaveLength(26);
    expect(table[0]).toEqual({ letter: 'A', count: 2 });
    expect(table[1]).toEqual({ letter: 'B', count: 3 });
    // Z: one upper, one lower.
    expect(table[25]).toEqual({ letter: 'Z', count: 2 });
    // A gap letter is present with count 0.
    expect(table.find((e) => e.letter === 'C')).toEqual({ letter: 'C', count: 0 });
  });

  it('ignores non-letters entirely', () => {
    const table = frequencyTable('12 34 .,!');
    expect(table.every((e) => e.count === 0)).toBe(true);
  });

  it('sums to the number of letters in the ciphertext', () => {
    const text = 'The quick brown fox';
    const letters = text.replace(/[^A-Za-z]/g, '').length;
    const total = frequencyTable(text).reduce((n, e) => n + e.count, 0);
    expect(total).toBe(letters);
  });
});

// ---------------------------------------------------------------------------
// Caesar shift preview (Req 9.6)
// ---------------------------------------------------------------------------

describe('caesarShift / caesarShiftPreview', () => {
  it('shift 0 is the identity', () => {
    expect(caesarShift('Hello, World!', 0)).toBe('Hello, World!');
  });

  it('reads a caesar ciphertext back to plaintext at its true shift', () => {
    const plain = 'ATTACK AT DAWN';
    const cipher = encrypt(plain, { kind: 'caesar', shift: 7 });
    // The preview "decrypts" by shifting back, so shift 7 recovers the plaintext.
    expect(caesarShift(cipher, 7)).toBe(plain);
  });

  it('preserves case and passes non-letters through', () => {
    const out = caesarShift('Ab, 9!', 1);
    // 'A'->'Z' (back one), 'b'->'a'; punctuation and digits untouched.
    expect(out).toBe('Za, 9!');
  });

  it('normalises the shift mod 26', () => {
    expect(caesarShift('HELLO', 26)).toBe(caesarShift('HELLO', 0));
    expect(caesarShift('HELLO', 27)).toBe(caesarShift('HELLO', 1));
  });

  it('lists all 26 shifts, each with its read-back text', () => {
    const rows = caesarShiftPreview('KHOOR');
    expect(rows).toHaveLength(26);
    expect(rows.map((r) => r.shift)).toEqual([...CAESAR_SHIFTS]);
    // "KHOOR" is "HELLO" shifted forward 3, so reading back 3 recovers it.
    expect(rows[3]).toEqual({ shift: 3, text: 'HELLO' });
  });
});

// ---------------------------------------------------------------------------
// Intercepts list view (Req 25.3)
// ---------------------------------------------------------------------------

describe('interceptListView', () => {
  it('lists collected Intercepts newest first with view-safe metadata', () => {
    const older = makeIntercept({
      id: 'int:a',
      ciphertext: 'KHOOR',
      spec: { kind: 'caesar', shift: 3 },
      day: 1,
      phase: 0,
      callsign: 'NUM1',
    });
    const newer = makeIntercept({
      id: 'int:b',
      ciphertext: 'ABCDE',
      spec: { kind: 'vigenere', key: 'KEY' },
      day: 2,
      phase: 1,
      tradecraftError: { kind: 'fixed-header', header: 'NR' },
    });
    const view = interceptListView(stateWith([older, newer]));
    expect(view.intercepts.map((i) => i.id)).toEqual(['int:b', 'int:a']);

    const [first, second] = view.intercepts;
    expect(first.hasTradecraftError).toBe(true);
    expect(first.length).toBe(5);
    expect(second.callsign).toBe('NUM1');
    expect(second.hasTradecraftError).toBe(false);
  });

  it('lists nothing when no Intercepts are collected', () => {
    expect(interceptListView(stateWith([])).intercepts).toEqual([]);
  });

  it('carries no truth: no spec/plaintextProps/origin field on any entry', () => {
    const view = interceptListView(
      stateWith([
        makeIntercept({ id: 'int:a', ciphertext: 'KHOOR', spec: { kind: 'caesar', shift: 3 } }),
      ]),
    );
    const serialised = JSON.stringify(view);
    expect(serialised).not.toContain('spec');
    expect(serialised).not.toContain('plaintextProps');
    expect(serialised).not.toContain('origin');
    expect(serialised).not.toContain('shift');
  });
});

// ---------------------------------------------------------------------------
// Workbench view (Req 9.5, 9.6, 25.3)
// ---------------------------------------------------------------------------

describe('workbenchView', () => {
  it('carries metadata, ciphertext, frequency table and shift preview', () => {
    const intercept = makeIntercept({
      id: 'int:a',
      ciphertext: 'KHOOR',
      spec: { kind: 'caesar', shift: 3 },
      callsign: 'NUM1',
    });
    const view = workbenchView(stateWith([intercept]), 'int:a' as InterceptId);
    expect(view).toBeDefined();
    expect(view?.id).toBe('int:a');
    expect(view?.ciphertext).toBe('KHOOR');
    expect(view?.length).toBe(5);
    expect(view?.callsign).toBe('NUM1');
    expect(view?.frequency).toEqual(frequencyTable('KHOOR'));
    expect(view?.shiftPreview).toEqual(caesarShiftPreview('KHOOR'));
    // The shift preview recovers HELLO at shift 3.
    expect(view?.shiftPreview[3]?.text).toBe('HELLO');
  });

  it('surfaces a revealed tradecraft error and header crib', () => {
    const intercept = makeIntercept({
      id: 'int:h',
      ciphertext: 'ABCDEF',
      spec: { kind: 'otp', padId: 'pad:1' },
      header: 'NR',
      tradecraftError: { kind: 'fixed-header', header: 'NR' },
    });
    const view = workbenchView(stateWith([intercept]), 'int:h' as InterceptId);
    expect(view?.header).toBe('NR');
    expect(view?.tradecraftError).toEqual({ kind: 'fixed-header', header: 'NR' });
  });

  it('returns undefined for an Intercept the player has not collected', () => {
    const view = workbenchView(stateWith([]), 'int:missing' as InterceptId);
    expect(view).toBeUndefined();
  });

  it('carries no truth: never the cipher spec, plaintext props or origin', () => {
    const intercept = makeIntercept({
      id: 'int:a',
      ciphertext: 'KHOOR',
      spec: { kind: 'vigenere', key: 'SECRETKEY' },
      plaintextProps: ['prop:the-answer'],
    });
    const view = workbenchView(stateWith([intercept]), 'int:a' as InterceptId);
    const serialised = JSON.stringify(view);
    // No truth-bearing field names, and no truth-bearing values.
    expect(serialised).not.toContain('plaintextProps');
    expect(serialised).not.toContain('prop:the-answer');
    expect(serialised).not.toContain('SECRETKEY');
    expect(serialised).not.toContain('vigenere');
    // The view object has no own `spec`/`origin` property.
    expect(Object.prototype.hasOwnProperty.call(view, 'spec')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(view, 'origin')).toBe(false);
  });
});

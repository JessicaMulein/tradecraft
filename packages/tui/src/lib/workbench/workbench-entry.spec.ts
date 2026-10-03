/**
 * Unit tests for the Workbench entry reducer (task 22.5; design, "TUI";
 * Requirements 9.5, 9.6). These drive the pure reducer and the submission
 * builders without a TTY, checking the shift wraps `0..25`, the mode and cipher
 * kind cycle, the text field edits, and that {@link buildSubmission} produces a
 * well-formed key and plaintext {@link KeySubmission}.
 */

import { describe, expect, it } from 'vitest';
import type { KeySubmission } from '@tradecraft/player-view';

import {
  KEY_KINDS,
  buildKeySpec,
  buildSubmission,
  initialWorkbenchState,
  reduceWorkbench,
  type WorkbenchState,
} from './workbench-entry.js';

describe('reduceWorkbench shift selection', () => {
  it('steps the shift up and down, wrapping 0..25', () => {
    let state = initialWorkbenchState();
    expect(state.shift).toBe(0);
    state = reduceWorkbench(state, { type: 'shiftDown' });
    expect(state.shift).toBe(25);
    state = reduceWorkbench(state, { type: 'shiftUp' });
    expect(state.shift).toBe(0);
    state = reduceWorkbench(state, { type: 'shiftUp' });
    expect(state.shift).toBe(1);
  });

  it('sets a shift explicitly, wrapping out-of-range values', () => {
    const state = reduceWorkbench(initialWorkbenchState(), { type: 'setShift', shift: 29 });
    expect(state.shift).toBe(3);
    expect(reduceWorkbench(state, { type: 'setShift', shift: -1 }).shift).toBe(25);
  });
});

describe('reduceWorkbench mode and kind', () => {
  it('toggles between key and plaintext entry', () => {
    let state = initialWorkbenchState();
    expect(state.mode).toBe('key');
    state = reduceWorkbench(state, { type: 'toggleMode' });
    expect(state.mode).toBe('plaintext');
    state = reduceWorkbench(state, { type: 'toggleMode' });
    expect(state.mode).toBe('key');
  });

  it('cycles the cipher kind forward and backward, wrapping', () => {
    let state = initialWorkbenchState();
    expect(state.keyKind).toBe(KEY_KINDS[0]);
    state = reduceWorkbench(state, { type: 'prevKind' });
    expect(state.keyKind).toBe(KEY_KINDS[KEY_KINDS.length - 1]);
    state = reduceWorkbench(state, { type: 'nextKind' });
    expect(state.keyKind).toBe(KEY_KINDS[0]);
    state = reduceWorkbench(state, { type: 'setKind', kind: 'vigenere' });
    expect(state.keyKind).toBe('vigenere');
  });

  it('does not clear the text when switching mode or kind', () => {
    let state = reduceWorkbench(initialWorkbenchState(), { type: 'setText', text: 'LEMON' });
    state = reduceWorkbench(state, { type: 'toggleMode' });
    expect(state.text).toBe('LEMON');
    state = reduceWorkbench(state, { type: 'nextKind' });
    expect(state.text).toBe('LEMON');
  });
});

describe('buildKeySpec', () => {
  it('builds a caesar key from the selected shift, always submittable', () => {
    const state: WorkbenchState = { shift: 7, mode: 'key', keyKind: 'caesar', text: '' };
    expect(buildKeySpec(state)).toEqual({ kind: 'caesar', shift: 7 });
  });

  it('builds a vigenere/columnar key from the text, or undefined when empty', () => {
    const base: WorkbenchState = { shift: 0, mode: 'key', keyKind: 'vigenere', text: 'LEMON' };
    expect(buildKeySpec(base)).toEqual({ kind: 'vigenere', key: 'LEMON' });
    expect(buildKeySpec({ ...base, text: '  ' })).toBeUndefined();
    expect(buildKeySpec({ ...base, keyKind: 'columnar' })).toEqual({
      kind: 'columnar',
      key: 'LEMON',
    });
  });

  it('builds a book key with the default scheme and an otp key from the text', () => {
    const book = buildKeySpec({ shift: 0, mode: 'key', keyKind: 'book', text: 'doc:almanac' });
    expect(book).toEqual({ kind: 'book', textId: 'doc:almanac', scheme: 'page-line-word' });
    const otp = buildKeySpec({ shift: 0, mode: 'key', keyKind: 'otp', text: 'pad:7' });
    expect(otp).toEqual({ kind: 'otp', padId: 'pad:7' });
  });
});

describe('buildSubmission', () => {
  it('builds a key submission wrapping the composed spec', () => {
    const state: WorkbenchState = { shift: 3, mode: 'key', keyKind: 'caesar', text: '' };
    const submission = buildSubmission(state);
    expect(submission).toEqual<KeySubmission>({ kind: 'key', spec: { kind: 'caesar', shift: 3 } });
  });

  it('builds a plaintext submission from the trimmed text', () => {
    const state: WorkbenchState = { shift: 0, mode: 'plaintext', keyKind: 'caesar', text: '  ATTACK AT DAWN  ' };
    expect(buildSubmission(state)).toEqual<KeySubmission>({
      kind: 'plaintext',
      text: 'ATTACK AT DAWN',
    });
  });

  it('is undefined when the submission is incomplete', () => {
    // Plaintext mode with an empty field.
    expect(
      buildSubmission({ shift: 0, mode: 'plaintext', keyKind: 'caesar', text: '   ' }),
    ).toBeUndefined();
    // Key mode on a kind that needs text, with none.
    expect(
      buildSubmission({ shift: 0, mode: 'key', keyKind: 'vigenere', text: '' }),
    ).toBeUndefined();
  });
});

/**
 * Unit tests for the pure start-screen options reducer (task 22.1; design,
 * "Start screen"; Requirements 1.6, 34.3). These exercise the field navigation,
 * option cycling, seed editing and the projection to `newGame` options without
 * a TTY — the component tests then confirm the Ink layer wires keys to these.
 */

import { describe, expect, it } from 'vitest';
import {
  DIFFICULTY_PRESETS,
  initialStartState,
  reduceStart,
  toNewGameOptions,
  type StartState,
} from './options.js';

describe('initialStartState', () => {
  it('defaults to a blank seed, standard difficulty, mole off, full narration, seed focused', () => {
    expect(initialStartState()).toEqual<StartState>({
      focus: 'seed',
      seed: '',
      preset: 'standard',
      mole: false,
      narration: 'full',
    });
  });

  it('shows a seed the Sim already generated when passed as a default (Req 1.6)', () => {
    expect(initialStartState({ seed: 'orient-express' }).seed).toBe('orient-express');
  });
});

describe('reduceStart focus movement', () => {
  it('walks fields forward and wraps', () => {
    let s = initialStartState();
    s = reduceStart(s, { type: 'focus-next' });
    expect(s.focus).toBe('preset');
    s = reduceStart(s, { type: 'focus-next' });
    expect(s.focus).toBe('mole');
    s = reduceStart(s, { type: 'focus-next' });
    expect(s.focus).toBe('narration');
    s = reduceStart(s, { type: 'focus-next' });
    expect(s.focus).toBe('seed');
  });

  it('walks fields backward and wraps', () => {
    const s = reduceStart(initialStartState(), { type: 'focus-prev' });
    expect(s.focus).toBe('narration');
  });
});

describe('reduceStart option cycling', () => {
  it('cycles the Difficulty Preset through all three and wraps (Req 34.3)', () => {
    let s: StartState = { ...initialStartState(), focus: 'preset', preset: 'easy' };
    const seen: string[] = [s.preset];
    for (let i = 0; i < DIFFICULTY_PRESETS.length; i++) {
      s = reduceStart(s, { type: 'cycle-next' });
      seen.push(s.preset);
    }
    expect(seen).toEqual(['easy', 'standard', 'hard', 'easy']);
  });

  it('cycles the preset backward', () => {
    const s = reduceStart(
      { ...initialStartState(), focus: 'preset', preset: 'easy' },
      { type: 'cycle-prev' },
    );
    expect(s.preset).toBe('hard');
  });

  it('toggles the mole in either direction', () => {
    const base: StartState = { ...initialStartState(), focus: 'mole', mole: true };
    expect(reduceStart(base, { type: 'cycle-next' }).mole).toBe(false);
    expect(reduceStart(base, { type: 'cycle-prev' }).mole).toBe(false);
  });

  it('cycles narration through full/brief/off', () => {
    let s: StartState = { ...initialStartState(), focus: 'narration', narration: 'full' };
    s = reduceStart(s, { type: 'cycle-next' });
    expect(s.narration).toBe('brief');
    s = reduceStart(s, { type: 'cycle-next' });
    expect(s.narration).toBe('off');
    s = reduceStart(s, { type: 'cycle-next' });
    expect(s.narration).toBe('full');
  });

  it('does not cycle the seed field', () => {
    const s: StartState = { ...initialStartState(), focus: 'seed', seed: 'abc' };
    expect(reduceStart(s, { type: 'cycle-next' })).toEqual(s);
  });
});

describe('reduceStart seed editing', () => {
  it('appends and backspaces only while the seed is focused', () => {
    let s = initialStartState();
    s = reduceStart(s, { type: 'seed-append', char: 'a' });
    s = reduceStart(s, { type: 'seed-append', char: 'b' });
    expect(s.seed).toBe('ab');
    s = reduceStart(s, { type: 'seed-backspace' });
    expect(s.seed).toBe('a');
  });

  it('ignores seed edits when another field is focused', () => {
    const s: StartState = { ...initialStartState(), focus: 'preset', seed: 'x' };
    expect(reduceStart(s, { type: 'seed-append', char: 'y' }).seed).toBe('x');
    expect(reduceStart(s, { type: 'seed-backspace' }).seed).toBe('x');
  });

  it('does not mutate the input state', () => {
    const s = initialStartState();
    reduceStart(s, { type: 'seed-append', char: 'z' });
    expect(s.seed).toBe('');
  });
});

describe('toNewGameOptions', () => {
  it('drops an empty seed so the Sim generates one (Req 1.6)', () => {
    const opts = toNewGameOptions(initialStartState());
    expect(opts).toEqual({ preset: 'standard', mole: false, narration: 'full' });
    expect('seed' in opts).toBe(false);
  });

  it('trims and sends a supplied seed with the chosen options', () => {
    const state: StartState = {
      focus: 'seed',
      seed: '  night-train  ',
      preset: 'hard',
      mole: false,
      narration: 'brief',
    };
    expect(toNewGameOptions(state)).toEqual({
      seed: 'night-train',
      preset: 'hard',
      mole: false,
      narration: 'brief',
    });
  });

  it('treats a whitespace-only seed as no seed', () => {
    const state: StartState = { ...initialStartState(), seed: '   ' };
    expect('seed' in toNewGameOptions(state)).toBe(false);
  });
});

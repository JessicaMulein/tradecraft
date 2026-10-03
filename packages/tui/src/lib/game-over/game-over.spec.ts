/**
 * Unit tests for the pure game-over model (task 22.10; design, "TUI": the
 * game-over screen "stating the outcome (success, Plot failure or burned)";
 * Requirements 13.7, 19.4, 19.5). These exercise the outcome classification and
 * the fixed three-option menu reducer — without a TTY; the component tests then
 * confirm the Ink layer wires keys and callbacks to these.
 */

import { describe, expect, it } from 'vitest';
import {
  GAME_OVER_OPTIONS,
  classifyOutcome,
  initialGameOverState,
  outcomeHeadline,
  reduceGameOver,
  selectedOption,
  type GameOverState,
} from './game-over.js';

describe('classifyOutcome', () => {
  it('reads a Station success (Plot disrupted, Req 19.4)', () => {
    expect(classifyOutcome('success')).toBe('success');
    expect(classifyOutcome('plot-disrupted')).toBe('success');
    expect(classifyOutcome('WIN')).toBe('success');
  });

  it('reads a burned cover as burned, even when tagged with "plot" (Req 19.5)', () => {
    expect(classifyOutcome('burned')).toBe('burned');
    expect(classifyOutcome('cover-blown')).toBe('burned');
    // Burned takes precedence: a blown cover ends the game regardless of Plot.
    expect(classifyOutcome('plot-active-but-burned')).toBe('burned');
  });

  it('reads a Plot running to completion as a Plot failure', () => {
    expect(classifyOutcome('plot-failure')).toBe('plot-failure');
    expect(classifyOutcome('plot_completed')).toBe('plot-failure');
    expect(classifyOutcome('objective-failed')).toBe('plot-failure');
  });

  it('reads an unrecognised tag as unknown', () => {
    expect(classifyOutcome('something-else')).toBe('unknown');
    expect(classifyOutcome('')).toBe('unknown');
  });

  it('normalises whitespace and case', () => {
    expect(classifyOutcome('  Success  ')).toBe('success');
  });
});

describe('outcomeHeadline', () => {
  it('gives a distinct headline per outcome reading', () => {
    expect(outcomeHeadline('success')).toContain('Success');
    expect(outcomeHeadline('plot-failure')).toContain('Failure');
    expect(outcomeHeadline('burned')).toContain('Burned');
    expect(outcomeHeadline('unknown')).toBe('Game over');
  });
});

describe('initialGameOverState', () => {
  it('starts the cursor on the first option (Open Debrief)', () => {
    expect(initialGameOverState()).toEqual<GameOverState>({ index: 0 });
    expect(selectedOption(initialGameOverState())).toBe('debrief');
  });
});

describe('reduceGameOver cursor movement', () => {
  it('moves forward through the three options', () => {
    let s = initialGameOverState();
    s = reduceGameOver(s, { type: 'next' });
    expect(selectedOption(s)).toBe('save');
    s = reduceGameOver(s, { type: 'next' });
    expect(selectedOption(s)).toBe('quit');
  });

  it('wraps forward from the last option to the first', () => {
    const s = reduceGameOver({ index: GAME_OVER_OPTIONS.length - 1 }, { type: 'next' });
    expect(s.index).toBe(0);
  });

  it('moves backward and wraps from the first to the last', () => {
    const s = reduceGameOver({ index: 0 }, { type: 'prev' });
    expect(selectedOption(s)).toBe('quit');
  });

  it('does not mutate the input state', () => {
    const s: GameOverState = { index: 1 };
    reduceGameOver(s, { type: 'next' });
    expect(s.index).toBe(1);
  });
});

describe('reduceGameOver select', () => {
  it('jumps to a given index', () => {
    expect(reduceGameOver({ index: 0 }, { type: 'select', index: 2 }).index).toBe(2);
  });

  it('clamps a too-large index to the last option', () => {
    expect(reduceGameOver({ index: 0 }, { type: 'select', index: 9 }).index).toBe(2);
  });

  it('clamps a negative index to the first option', () => {
    expect(reduceGameOver({ index: 2 }, { type: 'select', index: -5 }).index).toBe(0);
  });
});

describe('selectedOption', () => {
  it('clamps a stale out-of-range index into the option list', () => {
    expect(selectedOption({ index: 99 })).toBe('quit');
    expect(selectedOption({ index: -1 })).toBe('debrief');
  });
});

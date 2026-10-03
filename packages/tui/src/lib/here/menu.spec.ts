/**
 * Unit tests for the pure action-menu selection reducer (task 22.3; design,
 * "TUI": the Here pane's "allowed actions with quotes"; Requirements 13.1,
 * 21.5). These exercise cursor movement, wrapping, jump-to-index and the
 * re-clamp when the option list changes length — all without a TTY; the
 * component tests then confirm the Ink layer wires keys to these.
 */

import { describe, expect, it } from 'vitest';
import { initialMenuState, reduceMenu, type MenuState } from './menu.js';

describe('initialMenuState', () => {
  it('starts the cursor on the first option', () => {
    expect(initialMenuState()).toEqual<MenuState>({ index: 0 });
  });
});

describe('reduceMenu cursor movement', () => {
  it('moves the cursor forward through the options', () => {
    let s = initialMenuState();
    s = reduceMenu(s, { type: 'next' }, 3);
    expect(s.index).toBe(1);
    s = reduceMenu(s, { type: 'next' }, 3);
    expect(s.index).toBe(2);
  });

  it('wraps forward from the last option to the first', () => {
    const s = reduceMenu({ index: 2 }, { type: 'next' }, 3);
    expect(s.index).toBe(0);
  });

  it('moves backward and wraps from the first to the last', () => {
    const s = reduceMenu({ index: 0 }, { type: 'prev' }, 3);
    expect(s.index).toBe(2);
  });

  it('does not mutate the input state', () => {
    const s: MenuState = { index: 1 };
    reduceMenu(s, { type: 'next' }, 3);
    expect(s.index).toBe(1);
  });
});

describe('reduceMenu select', () => {
  it('jumps to a given index', () => {
    expect(reduceMenu({ index: 0 }, { type: 'select', index: 2 }, 4).index).toBe(2);
  });

  it('clamps a too-large index to the last option', () => {
    expect(reduceMenu({ index: 0 }, { type: 'select', index: 9 }, 4).index).toBe(3);
  });

  it('clamps a negative index to the first option', () => {
    expect(reduceMenu({ index: 2 }, { type: 'select', index: -5 }, 4).index).toBe(0);
  });
});

describe('reduceMenu clamp on list changes', () => {
  it('re-clamps a stale index when the list shrank', () => {
    expect(reduceMenu({ index: 5 }, { type: 'clamp' }, 3).index).toBe(2);
  });

  it('leaves a valid index unchanged', () => {
    expect(reduceMenu({ index: 1 }, { type: 'clamp' }, 3).index).toBe(1);
  });
});

describe('reduceMenu with no options', () => {
  it('resolves every action to index 0 when the list is empty', () => {
    expect(reduceMenu({ index: 0 }, { type: 'next' }, 0).index).toBe(0);
    expect(reduceMenu({ index: 0 }, { type: 'prev' }, 0).index).toBe(0);
    expect(reduceMenu({ index: 3 }, { type: 'clamp' }, 0).index).toBe(0);
    expect(reduceMenu({ index: 0 }, { type: 'select', index: 2 }, 0).index).toBe(0);
  });
});

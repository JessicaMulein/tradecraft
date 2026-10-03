/**
 * Unit tests for the pure save/load list model (task 22.12; design, "TUI" → the
 * Save/load screen: lists `saves.list()`, marks `manifestMatches: false` saves,
 * and refuses to load a mismatched save; Requirements 13.9, 31.6). These
 * exercise the cursor reducer and the manifest-load gate without a TTY; the
 * component tests then confirm the Ink layer wires keys and callbacks to these.
 */

import { describe, expect, it } from 'vitest';
import type { SaveInfo } from '@tradecraft/player-view';

import {
  canLoad,
  initialSaveListState,
  reduceSaveList,
  selectedSave,
  type SaveListState,
} from './save-list.js';

/** Build a `SaveInfo` fixture; `manifestMatches` defaults to a matching save. */
function makeSave(overrides: Partial<SaveInfo> = {}): SaveInfo {
  return {
    name: 'alpha',
    seed: 'seed-1',
    difficulty: 'standard',
    at: { day: 1, phase: 0 },
    savedAt: '2024-01-01T00:00:00.000Z',
    manifestMatches: true,
    ...overrides,
  };
}

const SAVES: readonly SaveInfo[] = [
  makeSave({ name: 'alpha', seed: 's1' }),
  makeSave({ name: 'bravo', seed: 's2', manifestMatches: false }),
  makeSave({ name: 'charlie', seed: 's3', at: { day: 5, phase: 3 } }),
];

describe('initialSaveListState', () => {
  it('starts the cursor on the first save', () => {
    const state = initialSaveListState(SAVES);
    expect(state.index).toBe(0);
    expect(selectedSave(state)?.name).toBe('alpha');
  });

  it('yields no selection for an empty listing', () => {
    const state = initialSaveListState([]);
    expect(state.index).toBe(0);
    expect(selectedSave(state)).toBeUndefined();
  });
});

describe('reduceSaveList cursor movement', () => {
  it('moves forward through the saves', () => {
    let s = initialSaveListState(SAVES);
    s = reduceSaveList(s, { type: 'next' });
    expect(selectedSave(s)?.name).toBe('bravo');
    s = reduceSaveList(s, { type: 'next' });
    expect(selectedSave(s)?.name).toBe('charlie');
  });

  it('wraps forward from the last save to the first', () => {
    const s = reduceSaveList({ saves: SAVES, index: SAVES.length - 1 }, { type: 'next' });
    expect(s.index).toBe(0);
  });

  it('moves backward and wraps from the first to the last', () => {
    const s = reduceSaveList(initialSaveListState(SAVES), { type: 'prev' });
    expect(selectedSave(s)?.name).toBe('charlie');
  });

  it('keeps the cursor at 0 over an empty listing', () => {
    const empty: SaveListState = { saves: [], index: 0 };
    expect(reduceSaveList(empty, { type: 'next' }).index).toBe(0);
    expect(reduceSaveList(empty, { type: 'prev' }).index).toBe(0);
  });

  it('does not mutate the input state', () => {
    const s: SaveListState = { saves: SAVES, index: 1 };
    reduceSaveList(s, { type: 'next' });
    expect(s.index).toBe(1);
  });
});

describe('reduceSaveList select', () => {
  it('jumps to a given index', () => {
    expect(reduceSaveList(initialSaveListState(SAVES), { type: 'select', index: 2 }).index).toBe(2);
  });

  it('clamps a too-large index to the last save', () => {
    expect(reduceSaveList(initialSaveListState(SAVES), { type: 'select', index: 9 }).index).toBe(2);
  });

  it('clamps a negative index to the first save', () => {
    expect(reduceSaveList({ saves: SAVES, index: 2 }, { type: 'select', index: -5 }).index).toBe(0);
  });
});

describe('reduceSaveList set-saves', () => {
  it('swaps the listing and re-clamps the cursor onto it', () => {
    const s = reduceSaveList({ saves: SAVES, index: 2 }, {
      type: 'set-saves',
      saves: [SAVES[0]],
    });
    expect(s.saves).toHaveLength(1);
    expect(s.index).toBe(0);
    expect(selectedSave(s)?.name).toBe('alpha');
  });

  it('keeps the cursor when the new listing is long enough', () => {
    const s = reduceSaveList({ saves: SAVES, index: 1 }, {
      type: 'set-saves',
      saves: SAVES,
    });
    expect(s.index).toBe(1);
  });
});

describe('selectedSave', () => {
  it('clamps a stale out-of-range index into the listing', () => {
    expect(selectedSave({ saves: SAVES, index: 99 })?.name).toBe('charlie');
    expect(selectedSave({ saves: SAVES, index: -1 })?.name).toBe('alpha');
  });
});

describe('canLoad (manifest gate, Req 31.6)', () => {
  it('allows loading a save whose manifest matches', () => {
    expect(canLoad(makeSave({ manifestMatches: true }))).toBe(true);
  });

  it('refuses a save whose manifest no longer matches', () => {
    expect(canLoad(makeSave({ manifestMatches: false }))).toBe(false);
  });

  it('treats nothing selected as not loadable', () => {
    expect(canLoad(undefined)).toBe(false);
  });
});

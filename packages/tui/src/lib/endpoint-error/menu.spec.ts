/**
 * Unit tests for the pure endpoint-error menu reducer (task 22.13; design,
 * "TUI": "Endpoint error screen"; Requirements 13.10, 16.1). These exercise
 * cursor movement, wrapping and jump-to-index over the two choices (Retry /
 * Save and Quit) without a TTY; the component test then confirms the Ink layer
 * wires keys to these.
 */

import { describe, expect, it } from 'vitest';
import {
  ENDPOINT_CHOICES,
  initialEndpointMenuState,
  reduceEndpointMenu,
  selectedChoice,
  type EndpointMenuState,
} from './menu.js';

describe('ENDPOINT_CHOICES', () => {
  it('lists retry first, then save-and-quit', () => {
    expect(ENDPOINT_CHOICES).toEqual(['retry', 'save-and-quit']);
  });
});

describe('initialEndpointMenuState', () => {
  it('starts the cursor on the first choice (Retry)', () => {
    expect(initialEndpointMenuState()).toEqual<EndpointMenuState>({ index: 0 });
    expect(selectedChoice(initialEndpointMenuState())).toBe('retry');
  });
});

describe('reduceEndpointMenu cursor movement', () => {
  it('moves the cursor forward to the next choice', () => {
    const s = reduceEndpointMenu(initialEndpointMenuState(), { type: 'next' });
    expect(s.index).toBe(1);
    expect(selectedChoice(s)).toBe('save-and-quit');
  });

  it('wraps forward from the last choice back to the first', () => {
    const s = reduceEndpointMenu({ index: 1 }, { type: 'next' });
    expect(s.index).toBe(0);
    expect(selectedChoice(s)).toBe('retry');
  });

  it('moves backward and wraps from the first to the last', () => {
    const s = reduceEndpointMenu({ index: 0 }, { type: 'prev' });
    expect(s.index).toBe(1);
    expect(selectedChoice(s)).toBe('save-and-quit');
  });

  it('does not mutate the input state', () => {
    const s: EndpointMenuState = { index: 0 };
    reduceEndpointMenu(s, { type: 'next' });
    expect(s.index).toBe(0);
  });
});

describe('reduceEndpointMenu select', () => {
  it('jumps to a given index', () => {
    expect(reduceEndpointMenu({ index: 0 }, { type: 'select', index: 1 }).index).toBe(1);
  });

  it('clamps a too-large index to the last choice', () => {
    expect(reduceEndpointMenu({ index: 0 }, { type: 'select', index: 9 }).index).toBe(1);
  });

  it('clamps a negative index to the first choice', () => {
    expect(reduceEndpointMenu({ index: 1 }, { type: 'select', index: -5 }).index).toBe(0);
  });
});

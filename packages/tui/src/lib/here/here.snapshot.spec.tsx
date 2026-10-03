/**
 * Snapshot tests for the Ink Here pane and action menu (task 22.9; Requirements
 * 13.2, 13.6). These capture the rendered frame of the "here" side pane and the
 * action menu — allowed actions with their phase/money cost and disallowed ones
 * with their reason — from fixed, deterministic fixtures so the snapshots stay
 * stable.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import type { ActionOption, HereView } from '@tradecraft/player-view';

import { HerePane } from './here-pane.js';
import { ActionMenu } from './action-menu.js';

/** A view-safe here fixture (the `HereView` shape). */
const here: HereView = {
  location: {
    id: 'loc:cafe',
    name: 'The Riverside Café',
    type: 'kaffeehaus',
    tags: ['sector:american', 'type:kaffeehaus'],
    district: { id: 'district:inner', name: 'Innere Stadt' },
    atmosphere: ['smoky', 'crowded'],
    risk: 2,
    public: true,
  },
  crowd: 'busy',
  weather: 'cold and clear',
  visible: [
    { id: 'npc:ana', label: 'Ana Petrova' },
    { id: 'unk:1', label: 'a man in a grey coat' },
  ],
};

/** A spread of actions with mixed quotes, allowed and not. */
const options: readonly ActionOption[] = [
  {
    action: { kind: 'talk', npc: 'npc:ana' },
    quote: { allowed: true, phases: 1, money: 0 },
  },
  {
    action: { kind: 'surveil', at: 'loc:cafe', phases: 2 },
    quote: { allowed: true, phases: 2, money: 20 },
  },
  {
    action: { kind: 'arrest', npc: 'npc:ana' },
    quote: {
      allowed: false,
      reason: 'needs Station authorisation',
      phases: 0,
      money: 0,
    },
  },
];

/**
 * Strip ANSI colour escapes from a rendered frame. ink emits colour codes only
 * when the runner reports colour support, so snapshotting the raw frame would
 * differ between the direct `vitest` run and the `nx`/CI run; the plain text is
 * stable across both.
 */
function plain(frame: string | undefined): string {
  // eslint-disable-next-line no-control-regex
  return (frame ?? '').replace(/\u001B\[[0-9;]*m/g, '');
}

afterEach(() => {
  cleanup();
});

describe('HerePane snapshot', () => {
  it('renders the Location, conditions and visible persons', () => {
    const { lastFrame } = render(<HerePane here={here} />);
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "The Riverside Café
      smoky, crowded
      cold and clear · busy · risk 2 · public
      Here: Ana Petrova, a man in a grey coat"
    `);
  });
});

describe('ActionMenu snapshot', () => {
  it('renders the actions with their quotes and the cursor on the first row', () => {
    const { lastFrame } = render(<ActionMenu options={options} />);
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "> talk — 1 phase
        surveil — 2 phases, 20
        arrest — needs Station authorisation"
    `);
  });

  it('renders the no-actions hint for an empty list', () => {
    const { lastFrame } = render(<ActionMenu options={[]} />);
    expect(plain(lastFrame())).toMatchInlineSnapshot(`"No actions available here."`);
  });
});

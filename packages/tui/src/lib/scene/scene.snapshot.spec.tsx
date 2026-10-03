/**
 * Snapshot tests for the Ink Scene pane and status bar (task 22.9; Requirements
 * 13.2, 13.6). These capture the rendered frame of the scene/transcript surface
 * — the Fact (plain) versus Flavour/speech (dim italic) styling the player
 * relies on to tell Fact from Flavour (Req 13.6) — and the status bar, with
 * fixed, deterministic fixtures so the snapshots stay stable.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import type { ActionOption, SceneView, StatusView } from '@tradecraft/player-view';

import { ScenePane } from './scene-pane.js';
import { StatusBar } from './status-bar.js';
import type { TranscriptLine } from './transcript.js';

/** A view-safe scene fixture (the `SceneView` shape). */
const scene: SceneView = {
  location: {
    id: 'loc:cafe',
    name: 'The Riverside Café',
    type: 'kaffeehaus',
    tags: ['sector:american', 'type:kaffeehaus'],
    district: { id: 'district:inner', name: 'Innere Stadt' },
    description: 'A warm café on the embankment.',
    atmosphere: ['smoky', 'crowded'],
    risk: 2,
  },
  time: { day: 3, phase: 1 },
  weather: 'cold and clear',
  crowd: 'busy',
  visible: [
    { id: 'npc:ana', label: 'Ana Petrova' },
    { id: 'unk:1', label: 'a man in a grey coat' },
  ],
};

/** A transcript mixing the three line kinds so the styles are all exercised. */
const lines: readonly TranscriptLine[] = [
  { kind: 'fact', text: 'You enter the café.' },
  { kind: 'flavour', text: 'Steam clouds the windows against the cold.' },
  { kind: 'speech', speaker: 'Ana Petrova', text: 'You came after all.' },
];

/** A view-safe status fixture (the `StatusView` shape). */
const status: StatusView = {
  time: { day: 3, phase: 2 },
  location: { id: 'loc:cafe', name: 'The Riverside Café' },
  budget: 1200,
  standing: 4,
  ended: false,
};

/** A highlighted action with a quote (the `ActionOption` shape). */
const highlighted: ActionOption = {
  action: { kind: 'surveil', at: 'loc:cafe', phases: 1 },
  quote: { allowed: true, phases: 1, money: 20 },
};

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

describe('ScenePane snapshot', () => {
  it('renders the header alone before any turn has streamed', () => {
    const { lastFrame } = render(<ScenePane scene={scene} />);
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "The Riverside Café
      A warm café on the embankment.
      smoky, crowded
      Day 3, afternoon · cold and clear · busy · risk 2
      Here: Ana Petrova, a man in a grey coat"
    `);
  });

  it('renders fact (plain) and flavour/speech (dim italic) lines distinctly', () => {
    const { lastFrame } = render(<ScenePane scene={scene} lines={lines} />);
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "The Riverside Café
      A warm café on the embankment.
      smoky, crowded
      Day 3, afternoon · cold and clear · busy · risk 2
      Here: Ana Petrova, a man in a grey coat

      You enter the café.
      Steam clouds the windows against the cold.
      Ana Petrova: You came after all."
    `);
  });
});

describe('StatusBar snapshot', () => {
  it('renders the day/phase, Location, Budget, Standing and no Directives', () => {
    const { lastFrame } = render(<StatusBar status={status} />);
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "Day 3, evening · The Riverside Café · Budget 1200 · Standing 4
      Directives: none"
    `);
  });

  it('renders open Directives and the highlighted action cost', () => {
    const { lastFrame } = render(
      <StatusBar
        status={status}
        directives={['Identify the mole', 'Service the drop']}
        highlighted={highlighted}
      />,
    );
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "Day 3, evening · The Riverside Café · Budget 1200 · Standing 4
      Directives: Identify the mole; Service the drop
      Cost — surveil: 1 phase, 20"
    `);
  });
});

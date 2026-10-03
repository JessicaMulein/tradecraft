/**
 * Component tests for the Ink Scene pane (task 22.2; design, "Scene";
 * Requirements 13.2, 13.4, 13.6). These render the real component with
 * ink-testing-library and assert the header fields and the transcript lines —
 * fact plain, flavour and speech distinct, speech showing the speaker — in
 * arrival order.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import type { SceneView } from '@tradecraft/player-view';

import { ScenePane } from './scene-pane.js';
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

afterEach(() => {
  cleanup();
});

describe('ScenePane header', () => {
  it('renders the Location name, description, atmosphere and conditions', () => {
    const { lastFrame } = render(<ScenePane scene={scene} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('The Riverside Café');
    expect(frame).toContain('A warm café on the embankment.');
    expect(frame).toContain('smoky, crowded');
    expect(frame).toContain('Day 3, afternoon');
    expect(frame).toContain('cold and clear');
    expect(frame).toContain('busy');
    expect(frame).toContain('risk 2');
  });

  it('lists the visible persons by label', () => {
    const { lastFrame } = render(<ScenePane scene={scene} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Ana Petrova');
    expect(frame).toContain('a man in a grey coat');
  });

  it('shows a no-one hint when nobody is visible', () => {
    const empty: SceneView = { ...scene, visible: [] };
    const { lastFrame } = render(<ScenePane scene={empty} />);
    expect(lastFrame() ?? '').toContain('no one in sight');
  });
});

describe('ScenePane transcript', () => {
  it('renders fact, flavour and speech lines in order with the speaker shown', () => {
    const lines: TranscriptLine[] = [
      { kind: 'fact', text: 'You enter the café.' },
      { kind: 'flavour', text: 'Steam clouds the windows against the cold.' },
      { kind: 'speech', speaker: 'Ana Petrova', text: 'You came after all.' },
    ];
    const { lastFrame } = render(<ScenePane scene={scene} lines={lines} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('You enter the café.');
    expect(frame).toContain('Steam clouds the windows against the cold.');
    // Speech is prefixed with the speaker's player-facing name.
    expect(frame).toContain('Ana Petrova: You came after all.');

    // The lines appear in arrival order.
    const factAt = frame.indexOf('You enter the café.');
    const flavourAt = frame.indexOf('Steam clouds the windows');
    const speechAt = frame.indexOf('Ana Petrova: You came');
    expect(factAt).toBeLessThan(flavourAt);
    expect(flavourAt).toBeLessThan(speechAt);
  });

  it('renders only the header when there are no transcript lines', () => {
    const { lastFrame } = render(<ScenePane scene={scene} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('The Riverside Café');
  });
});

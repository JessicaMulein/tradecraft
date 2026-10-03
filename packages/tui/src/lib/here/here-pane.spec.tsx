/**
 * Component tests for the Ink Here pane (task 22.3; design, "TUI": the Here side
 * pane; Requirements 21.5, 21.7). These render the real component with
 * ink-testing-library and assert the Location (name, atmosphere, risk, public
 * flag), crowd, weather and the visible persons by label (Req 21.7).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import type { HereView } from '@tradecraft/player-view';

import { HerePane } from './here-pane.js';

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

afterEach(() => {
  cleanup();
});

describe('HerePane', () => {
  it('renders the Location name, atmosphere, risk and crowd/weather', () => {
    const { lastFrame } = render(<HerePane here={here} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('The Riverside Café');
    expect(frame).toContain('smoky, crowded');
    expect(frame).toContain('cold and clear');
    expect(frame).toContain('busy');
    expect(frame).toContain('risk 2');
  });

  it('shows the public/private access flag', () => {
    const publicFrame = render(<HerePane here={here} />).lastFrame() ?? '';
    expect(publicFrame).toContain('public');
    cleanup();

    const privateHere: HereView = {
      ...here,
      location: { ...here.location, public: false },
    };
    const privateFrame = render(<HerePane here={privateHere} />).lastFrame() ?? '';
    expect(privateFrame).toContain('private');
  });

  it('lists the visible persons by label (Req 21.7)', () => {
    const { lastFrame } = render(<HerePane here={here} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Ana Petrova');
    expect(frame).toContain('a man in a grey coat');
  });

  it('shows a no-one hint when nobody is visible', () => {
    const empty: HereView = { ...here, visible: [] };
    const { lastFrame } = render(<HerePane here={empty} />);
    expect(lastFrame() ?? '').toContain('no one in sight');
  });
});

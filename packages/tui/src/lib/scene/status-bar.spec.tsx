/**
 * Component tests for the Ink status bar (task 22.2; design, "Status bar";
 * Requirements 13.2, 13.4, 13.6). These render the real component with
 * ink-testing-library and assert the day/phase, Location, Budget, Standing,
 * open Directives and the highlighted action's cost.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import type { ActionOption, StatusView } from '@tradecraft/player-view';

import { StatusBar } from './status-bar.js';

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

afterEach(() => {
  cleanup();
});

describe('StatusBar', () => {
  it('renders the day/phase, Location, Budget and Standing', () => {
    const { lastFrame } = render(<StatusBar status={status} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Day 3, evening');
    expect(frame).toContain('The Riverside Café');
    expect(frame).toContain('Budget 1200');
    expect(frame).toContain('Standing 4');
  });

  it('lists the open Directives, and "none" when there are none', () => {
    const withDirectives = render(
      <StatusBar
        status={status}
        directives={['Identify the mole', 'Service the drop']}
      />,
    );
    const frame = withDirectives.lastFrame() ?? '';
    expect(frame).toContain('Identify the mole');
    expect(frame).toContain('Service the drop');
    cleanup();

    const none = render(<StatusBar status={status} />);
    expect(none.lastFrame() ?? '').toContain('Directives: none');
  });

  it('shows the highlighted action\'s phase and money cost', () => {
    const { lastFrame } = render(
      <StatusBar status={status} highlighted={highlighted} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('surveil');
    expect(frame).toContain('1 phase');
    expect(frame).toContain('20');
  });

  it('omits the cost line when nothing is highlighted', () => {
    const { lastFrame } = render(<StatusBar status={status} />);
    expect(lastFrame() ?? '').not.toContain('Cost —');
  });
});

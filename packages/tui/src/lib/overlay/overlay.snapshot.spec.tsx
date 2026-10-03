/**
 * Snapshot tests for the Ink help overlay and hint-toast strip (task 22.9;
 * Requirements 13.2, 13.6). These capture the rendered frame of the help panel
 * (actions with costs plus the glossary) and a hint toast, from fixed,
 * deterministic fixtures so the snapshots stay stable. The toast strip runs
 * with auto-expiry disabled (`durationMs={0}`) so the frame does not depend on
 * wall-clock timing.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import type { HelpView, HintView } from '@tradecraft/player-view';

import { HelpOverlay } from './help-overlay.js';
import { HintToasts } from './hint-toasts.js';

/** A help projection with mixed allowed/disallowed actions and a glossary. */
const help: HelpView = {
  location: { id: 'loc:cafe' as HelpView['location']['id'], name: 'Café Mozart' },
  actions: [
    { kind: 'talk', quote: { allowed: true, phases: 1, money: 0 }, targeted: true },
    {
      kind: 'surveil',
      quote: { allowed: true, phases: 2, money: 20 },
      targeted: false,
    },
    {
      kind: 'arrest',
      quote: {
        allowed: false,
        reason: 'needs Station authorisation',
        phases: 0,
        money: 0,
      },
      targeted: true,
    },
  ],
  glossary: [
    { term: 'Dead drop', definition: 'A location used to pass items in secret.' },
    { term: 'Legend', definition: 'A spy’s fabricated cover identity.' },
  ],
};

/** A hint fixture with a given trigger/text. */
const hint = (trigger: string, text: string): HintView =>
  ({ trigger, text } as unknown as HintView);

/** Advance a tick so ink flushes effect-driven re-renders. */
const tick = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 10));
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

describe('HelpOverlay snapshot', () => {
  it('renders the actions with costs and the glossary when visible', () => {
    const { lastFrame } = render(<HelpOverlay help={help} visible />);
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "╭──────────────────────────────────────────────────────────────────────────────────────────────────╮
      │ Help — Café Mozart                                                                               │
      │                                                                                                  │
      │ Actions here                                                                                     │
      │ talk — 1 phase · pick target                                                                     │
      │ surveil — 2 phases, 20                                                                           │
      │ arrest — needs Station authorisation                                                             │
      │                                                                                                  │
      │ Glossary                                                                                         │
      │ Dead drop: A location used to pass items in secret.                                              │
      │ Legend: A spy’s fabricated cover identity.                                                       │
      │                                                                                                  │
      │ ? or Esc to close                                                                                │
      ╰──────────────────────────────────────────────────────────────────────────────────────────────────╯"
    `);
  });

  it('renders nothing while hidden', () => {
    const { lastFrame } = render(<HelpOverlay help={help} visible={false} />);
    expect(plain(lastFrame())).toMatchInlineSnapshot(`""`);
  });
});

describe('HintToasts snapshot', () => {
  it('renders a toast for an incoming hint', async () => {
    const { lastFrame } = render(
      <HintToasts incoming={hint('first-intercept', 'Try the Workbench.')} durationMs={0} />,
    );
    await tick();
    expect(plain(lastFrame())).toMatchInlineSnapshot(`"💡 Try the Workbench."`);
  });
});

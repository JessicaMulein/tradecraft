/**
 * Inline-snapshot tests for the Ink Debrief screen (task 22.15; design, the
 * Debrief screen; Requirements 13.8). These render the real component with
 * ink-testing-library 4.0.0 and capture `lastFrame()` as inline snapshots for
 * the opening outcome summary of a populated {@link DebriefView}, a paged-to
 * section (allegiances) reached with Down, and the null (not-ended) placeholder.
 *
 * All fixtures are fixed data — the end time is a literal day/phase and no
 * section reads a clock — so the frames are deterministic.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import type { DebriefView } from '@tradecraft/player-view';

import { Debrief } from './debrief.js';

/** Terminal escape sequences ink decodes into `useInput` key presses. */
const KEY = {
  down: '\u001B[B',
} as const;

/** Advance a tick so ink flushes input-driven re-renders. */
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

/** A fully populated ended-game {@link DebriefView} fixture. */
const view: DebriefView = {
  outcome: 'burned',
  endedAt: { day: 7, phase: 2 },
  cause: 'cover blown at the border',
  allegiances: [
    {
      npc: 'npc:viktor',
      name: 'Viktor',
      role: 'cell',
      apparent: 'neutral',
      trueOrg: 'org:hostile',
      trueOrgName: 'The Service',
      deceptive: true,
    },
  ],
  timeline: [
    {
      stage: 'stage:1',
      templateId: 'tmpl:recruit',
      status: 'executed',
      deadline: { day: 3, phase: 0 },
      traces: ['A courier changed hands at the station.'],
    },
  ],
  lies: [{ claim: 'claim:1', text: 'Viktor is a journalist', deliberate: true }],
  noiseLeads: [
    {
      claim: 'claim:2',
      text: 'A smuggling ring works the docks',
      kind: 'side-thread',
      thread: 'thread:docks',
    },
  ],
  fedPropositions: [
    {
      agent: 'npc:ana',
      text: 'The drop moved to the park',
      classification: 'deception',
    },
  ],
  directives: [
    { id: 'dir:1', text: 'Identify the handler', status: 'met', reward: 2 },
  ],
  score: {
    standing: 5,
    claimsTotal: 10,
    claimsTrue: 7,
    gradedTotal: 6,
    gradedCorrect: 4,
    gradingAccuracy: 4 / 6,
  },
};

afterEach(() => {
  cleanup();
});

describe('Debrief snapshots', () => {
  it('renders the opening outcome summary of a populated debrief', () => {
    const { lastFrame } = render(<Debrief view={view} />);
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "Debrief — Outcome (1/8)

      Outcome: Burned
      Ended: Day 7, evening
      Cause: cover blown at the border

      ↑/↓ section · PgUp/PgDn first/last"
    `);
  });

  it('renders the allegiances section after paging down', async () => {
    const { lastFrame, stdin } = render(<Debrief view={view} />);
    await tick();
    stdin.write(KEY.down);
    await tick();
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "Debrief — True allegiances (2/8) · 1 item

      Viktor (cell) — presented neutral, truly The Service — DECEPTIVE

      ↑/↓ section · PgUp/PgDn first/last"
    `);
  });

  it('renders the not-ended placeholder when the view is null', () => {
    const { lastFrame } = render(<Debrief view={null} />);
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "Debrief
      The debrief is available once the operation is over."
    `);
  });
});

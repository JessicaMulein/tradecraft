/**
 * Component tests for the Ink Debrief screen (task 22.11; design, Debrief
 * screen; Requirements 13.8, 19.6). These render the real component with
 * ink-testing-library and assert that it opens on the outcome summary, pages
 * through the sections with up/down (revealing allegiances, the timeline, the
 * lies, the noise leads, the fed Propositions, the Directive results and the
 * score), jumps to the last and first sections, and shows a quiet placeholder
 * when the debrief is `null` (the game has not ended).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import type { DebriefView } from '@tradecraft/player-view';

import { Debrief } from './debrief.js';

// Terminal escape sequences ink decodes into `useInput` key presses.
const KEY = {
  up: '\u001B[A',
  down: '\u001B[B',
  pageUp: '\u001B[5~',
  pageDown: '\u001B[6~',
} as const;

/** Advance a tick so ink flushes input-driven re-renders. */
const tick = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 10));
};

/** A full ended-game {@link DebriefView} fixture (every section populated). */
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

describe('Debrief placeholder', () => {
  it('shows a placeholder when the debrief is null (game not ended)', () => {
    const { lastFrame } = render(<Debrief view={null} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Debrief');
    expect(frame).toContain('once the operation is over');
  });
});

describe('Debrief sections', () => {
  it('opens on the outcome summary', () => {
    const { lastFrame } = render(<Debrief view={view} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Outcome');
    expect(frame).toContain('Burned');
    expect(frame).toContain('Day 7, evening');
    expect(frame).toContain('cover blown at the border');
    expect(frame).toContain('(1/8)');
  });

  it('pages down to the allegiances section and unmasks a deceptive NPC', async () => {
    const { lastFrame, stdin } = render(<Debrief view={view} />);
    await tick();
    stdin.write(KEY.down);
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('True allegiances');
    expect(frame).toContain('Viktor');
    expect(frame).toContain('The Service');
    expect(frame).toContain('DECEPTIVE');
    expect(frame).toContain('(2/8)');
  });

  it('pages through to the Plot timeline', async () => {
    const { lastFrame, stdin } = render(<Debrief view={view} />);
    await tick();
    stdin.write(KEY.down);
    stdin.write(KEY.down);
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Plot timeline');
    expect(frame).toContain('tmpl:recruit');
    expect(frame).toContain('executed');
    expect(frame).toContain('A courier changed hands');
  });

  it('reaches the lies, noise-leads and fed-propositions sections in order', async () => {
    const { lastFrame, stdin } = render(<Debrief view={view} />);
    await tick();
    stdin.write(KEY.down);
    stdin.write(KEY.down);
    stdin.write(KEY.down);
    await tick();
    expect(lastFrame() ?? '').toContain('Viktor is a journalist');
    stdin.write(KEY.down);
    await tick();
    expect(lastFrame() ?? '').toContain('A smuggling ring works the docks');
    stdin.write(KEY.down);
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('The drop moved to the park');
    expect(frame).toContain('deception');
  });

  it('jumps to the last (score) section with PageDown', async () => {
    const { lastFrame, stdin } = render(<Debrief view={view} />);
    await tick();
    stdin.write(KEY.pageDown);
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Score & grading accuracy');
    expect(frame).toContain('Final Standing');
    expect(frame).toContain('7/10');
    expect(frame).toContain('67%');
    expect(frame).toContain('(8/8)');
  });

  it('jumps back to the first section with PageUp and clamps at the top', async () => {
    const { lastFrame, stdin } = render(<Debrief view={view} />);
    await tick();
    stdin.write(KEY.pageDown);
    await tick();
    stdin.write(KEY.pageUp);
    await tick();
    // One more up press must not run off the top.
    stdin.write(KEY.up);
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('(1/8)');
    expect(frame).toContain('Burned');
  });

  it('shows an empty-section line when a list section has no rows', async () => {
    const empty: DebriefView = { ...view, allegiances: [] };
    const { lastFrame, stdin } = render(<Debrief view={empty} />);
    await tick();
    stdin.write(KEY.down);
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('True allegiances');
    expect(frame).toContain('No persons to reckon');
  });
});

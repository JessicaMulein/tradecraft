/**
 * Component tests for the Ink Case File browser (task 22.4; design, "Case File";
 * Requirements 8.1, 13.3). These render the real component with
 * ink-testing-library and drive it through simulated key presses, asserting the
 * rendered Claim list and the grade/link/filter callbacks it fires.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import type { CaseFileFilter, ClaimView } from '@tradecraft/player-view';

import { CaseFileBrowser } from './case-file-browser.js';
import type { AdmiraltyGrade, ClaimId } from './case-file.js';

// Terminal escape sequences ink decodes into `useInput` key presses.
const KEY = {
  up: '\u001B[A',
  down: '\u001B[B',
  right: '\u001B[C',
  left: '\u001B[D',
  tab: '\t',
  esc: '\u001B',
} as const;

/** A graded, corroborated NPC Claim fixture. */
const npcClaim: ClaimView = {
  id: 'claim:1',
  source: { kind: 'npc', npc: 'npc:viktor' },
  prop: {
    id: 'prop:1',
    subject: 'npc:viktor',
    predicate: 'core/meets',
    object: 'npc:lena',
    place: 'loc:cafe',
  },
  observedAt: { day: 1, phase: 0 },
  hedged: false,
  grade: { reliability: 'B', credibility: 2 },
  links: [],
  relation: 'corroborated',
};

/** An ungraded, hedged intercept Claim fixture with a literal object. */
const interceptClaim: ClaimView = {
  id: 'claim:2',
  source: { kind: 'intercept', id: 'int:7' },
  prop: {
    id: 'prop:2',
    subject: 'npc:lena',
    predicate: 'core/carries',
    object: { kind: 'text', value: 'a sealed envelope' },
  },
  observedAt: { day: 1, phase: 1 },
  hedged: true,
  links: [],
  relation: 'none',
};

const CLAIMS: readonly ClaimView[] = [npcClaim, interceptClaim];

afterEach(() => {
  cleanup();
});

/** Advance a tick so ink flushes input-driven re-renders. */
const tick = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 10));
};

describe('CaseFileBrowser listing', () => {
  it('lists each Claim with its source, Proposition, grade and relation', () => {
    const { lastFrame } = render(<CaseFileBrowser claims={CLAIMS} />);
    const frame = lastFrame() ?? '';
    // NPC Claim: source, prop with place, grade, relation.
    expect(frame).toContain('from Viktor');
    expect(frame).toContain('Viktor meets Lena at Cafe');
    expect(frame).toContain('grade B2');
    expect(frame).toContain('corroborated');
    // Intercept Claim: source, literal object, hedge flag, ungraded.
    expect(frame).toContain('from an intercept');
    expect(frame).toContain('a sealed envelope');
    expect(frame).toContain('(hedged)');
    expect(frame).toContain('grade ungraded');
  });

  it('shows an empty-state line when no Claims match', () => {
    const { lastFrame } = render(<CaseFileBrowser claims={[]} />);
    expect(lastFrame() ?? '').toContain('No Claims match the filter');
  });
});

describe('CaseFileBrowser filtering (Req 13.3)', () => {
  it('cycles the source filter and emits the matching CaseFileFilter', async () => {
    const onFilter = vi.fn<(f: CaseFileFilter) => void>();
    const { stdin } = render(
      <CaseFileBrowser claims={CLAIMS} onFilter={onFilter} />,
    );
    await tick();
    // Source axis is focused first; one step forward selects the first kind.
    stdin.write(KEY.right);
    await tick();
    expect(onFilter).toHaveBeenLastCalledWith({ source: 'npc' });
  });

  it('cycles to the grade axis and emits a grade filter', async () => {
    const onFilter = vi.fn<(f: CaseFileFilter) => void>();
    const { stdin } = render(
      <CaseFileBrowser claims={CLAIMS} onFilter={onFilter} />,
    );
    await tick();
    stdin.write(KEY.tab); // move to grade axis
    await tick();
    stdin.write(KEY.right); // first grade A1
    await tick();
    expect(onFilter).toHaveBeenLastCalledWith({
      grade: { reliability: 'A', credibility: 1 },
    });
  });

  it('cycles to the entity axis and emits an entity filter from the supplied entities', async () => {
    const onFilter = vi.fn<(f: CaseFileFilter) => void>();
    const { stdin } = render(
      <CaseFileBrowser
        claims={CLAIMS}
        entities={['npc:viktor', 'npc:lena']}
        onFilter={onFilter}
      />,
    );
    await tick();
    stdin.write(KEY.tab); // grade
    await tick();
    stdin.write(KEY.tab); // entity
    await tick();
    stdin.write(KEY.right);
    await tick();
    expect(onFilter).toHaveBeenLastCalledWith({ entity: 'npc:viktor' });
  });

  it('clears all filters with x', async () => {
    const onFilter = vi.fn<(f: CaseFileFilter) => void>();
    const { stdin } = render(
      <CaseFileBrowser claims={CLAIMS} onFilter={onFilter} />,
    );
    await tick();
    stdin.write(KEY.right); // source: npc
    await tick();
    stdin.write('x');
    await tick();
    expect(onFilter).toHaveBeenLastCalledWith({});
  });
});

describe('CaseFileBrowser grading (Req 8.1)', () => {
  it('selects a Claim, composes a grade and applies it with g', async () => {
    const onGrade = vi.fn<(id: ClaimId, g: AdmiraltyGrade) => void>();
    const { stdin } = render(
      <CaseFileBrowser claims={CLAIMS} onGrade={onGrade} />,
    );
    await tick();
    // Move the Claim cursor to the second (intercept) Claim.
    stdin.write(KEY.down);
    await tick();
    // Compose a grade: reliability A -> B (r), credibility 1 -> 2 -> 3 (c, c).
    stdin.write('r');
    await tick();
    stdin.write('c');
    await tick();
    stdin.write('c');
    await tick();
    stdin.write('g');
    await tick();
    expect(onGrade).toHaveBeenCalledTimes(1);
    expect(onGrade).toHaveBeenCalledWith('claim:2', {
      reliability: 'B',
      credibility: 3,
    });
  });
});

describe('CaseFileBrowser linking', () => {
  it('links the two selected Claims with two l presses', async () => {
    const onLink = vi.fn<(a: ClaimId, b: ClaimId) => void>();
    const { stdin } = render(
      <CaseFileBrowser claims={CLAIMS} onLink={onLink} />,
    );
    await tick();
    // Anchor the first Claim.
    stdin.write('l');
    await tick();
    // Move to the second Claim and link.
    stdin.write(KEY.down);
    await tick();
    stdin.write('l');
    await tick();
    expect(onLink).toHaveBeenCalledTimes(1);
    expect(onLink).toHaveBeenCalledWith('claim:1', 'claim:2');
  });

  it('unlinks the anchored Claim from the selected one with u', async () => {
    const onUnlink = vi.fn<(a: ClaimId, b: ClaimId) => void>();
    const { stdin } = render(
      <CaseFileBrowser claims={CLAIMS} onUnlink={onUnlink} />,
    );
    await tick();
    stdin.write('l'); // anchor claim:1
    await tick();
    stdin.write(KEY.down); // select claim:2
    await tick();
    stdin.write('u');
    await tick();
    expect(onUnlink).toHaveBeenCalledWith('claim:1', 'claim:2');
  });

  it('clears a held link anchor on Esc without calling onLink', async () => {
    const onLink = vi.fn<(a: ClaimId, b: ClaimId) => void>();
    const { stdin, lastFrame } = render(
      <CaseFileBrowser claims={CLAIMS} onLink={onLink} />,
    );
    await tick();
    stdin.write('l'); // anchor
    await tick();
    expect(lastFrame() ?? '').toContain('link anchor: claim:1');
    stdin.write(KEY.esc);
    await tick();
    expect(lastFrame() ?? '').not.toContain('link anchor:');
    stdin.write('l'); // re-anchors rather than linking
    await tick();
    expect(onLink).not.toHaveBeenCalled();
  });
});

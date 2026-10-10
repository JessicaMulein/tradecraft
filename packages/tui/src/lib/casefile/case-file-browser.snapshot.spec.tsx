/**
 * Snapshot tests for the Ink Case File browser (task 22.9; Requirements 13.2,
 * 13.6). These capture the rendered frame of the Claim list with its source,
 * Proposition, grade and relation, the filter summary and grade cursor, from
 * fixed, deterministic fixtures so the snapshots stay stable.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import type { ClaimView } from '@tradecraft/player-view';

import { CaseFileBrowser } from './case-file-browser.js';

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

describe('CaseFileBrowser snapshot', () => {
  it('renders the Claim list with sources, props, grades and relations', () => {
    const { lastFrame } = render(<CaseFileBrowser claims={CLAIMS} />);
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "Case File

      Filter [source]: source=all · grade=all · entity=all · city=all

      >   from Viktor · Viktor meets Lena at Cafe · grade B2 · corroborated
          from an intercept · Lena is carrying a sealed envelope (hedged) · grade ungraded · —

      Grade cursor: A1
      ↑/↓ select · Tab axis · ←/→ filter · x clear · r/c grade · g apply · l link · u unlink"
    `);
  });

  it('renders the empty-state line when no Claims match', () => {
    const { lastFrame } = render(<CaseFileBrowser claims={[]} />);
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "Case File

      Filter [source]: source=all · grade=all · entity=all · city=all

      No Claims match the filter.

      Grade cursor: A1
      ↑/↓ select · Tab axis · ←/→ filter · x clear · r/c grade · g apply · l link · u unlink"
    `);
  });
});

/**
 * Inline-snapshot tests for the Ink Feed composer (task 22.15; design, "TUI":
 * the Feed composer picks Case File Claims or composes a Proposition and shows
 * `validateFeed` errors inline; Requirements 13.1). These render the real
 * component with ink-testing-library 4.0.0 and capture `lastFrame()` as inline
 * snapshots for three meaningful states: Claims mode with a couple of Claims,
 * the Compose form after a Tab, and the inline-error state after a failed submit
 * (an injected `validateFeed` that rejects the empty feed with a FeedError).
 *
 * The Claims and compose options are fixed fixtures and the injected validators
 * are pure, so each frame is deterministic.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import type { ClaimView, FeedError, FeedItem, Result } from '@tradecraft/player-view';

import { FeedComposer } from './feed-composer.js';
import type { ComposeOptions } from './feed.js';

/** Terminal escape sequences ink decodes into `useInput` key presses. */
const KEY = {
  enter: '\r',
  tab: '\t',
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

/** Build a minimal, valid {@link ClaimView} for the Claims list. */
function claim(id: string, subject: string, object: string): ClaimView {
  return {
    id,
    source: { kind: 'npc', npc: 'npc:ana' },
    prop: {
      id: `${id}-prop`,
      subject,
      predicate: 'core/MEETS_AT',
      object,
    },
    observedAt: { day: 1, phase: 0 },
    hedged: false,
    links: [],
    relation: 'none',
  } as ClaimView;
}

const claims: readonly ClaimView[] = [
  claim('claim:a', 'npc:ana', 'npc:viktor'),
  claim('claim:b', 'npc:viktor', 'npc:ana'),
];

const options: ComposeOptions = {
  predicates: [{ value: 'core/MEMBER_OF', label: 'MEMBER_OF' }],
  subjects: [{ value: 'npc:ana', label: 'Ana' }],
  objects: [{ value: 'org:cell', label: 'The Cell' }],
  places: [{ value: undefined, label: '(none)' }],
};

/** A validator that always accepts. */
const alwaysOk: (items: readonly FeedItem[]) => Result<void, FeedError[]> = () => ({
  ok: true,
  value: undefined,
});

/** A validator that rejects an empty feed with a single error. */
const rejectEmpty: (items: readonly FeedItem[]) => Result<void, FeedError[]> = (
  items,
) =>
  items.length === 0
    ? {
        ok: false,
        error: [{ index: -1, field: 'items', reason: 'a feed needs at least one item' }],
      }
    : { ok: true, value: undefined };

afterEach(() => {
  cleanup();
});

describe('FeedComposer snapshots', () => {
  it('renders Claims mode with a couple of Claims', () => {
    const { lastFrame } = render(
      <FeedComposer claims={claims} options={options} validateFeed={alwaysOk} />,
    );
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "Feed composer

      Mode: [Claims] Compose · 0 items

      > [ ] npc:ana core/MEETS_AT npc:viktor
        [ ] npc:viktor core/MEETS_AT npc:ana

      Tab mode · ↑/↓ select · Space toggle · Enter submit"
    `);
  });

  it('renders the Compose form after Tab', async () => {
    const { lastFrame, stdin } = render(
      <FeedComposer claims={claims} options={options} validateFeed={alwaysOk} />,
    );
    await tick();
    stdin.write(KEY.tab);
    await tick();
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "Feed composer

      Mode: Claims [Compose] · 0 items

      > predicate: MEMBER_OF
        subject: Ana
        object: The Cell
        place: (none)

      Draft: npc:ana core/MEMBER_OF org:cell
      Composed: 0 staged

      Tab mode · ↑/↓ field · ←/→ option · a add · d remove · Enter submit"
    `);
  });

  it('renders the inline-error state after a failed submit', async () => {
    const { lastFrame, stdin } = render(
      <FeedComposer claims={claims} options={options} validateFeed={rejectEmpty} />,
    );
    await tick();
    stdin.write(KEY.enter); // submit an empty feed -> validator rejects
    await tick();
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "Feed composer

      Mode: [Claims] Compose · 0 items

      > [ ] npc:ana core/MEETS_AT npc:viktor
        [ ] npc:viktor core/MEETS_AT npc:ana

      Cannot submit — 1 error:
      • Feed (items): a feed needs at least one item

      Tab mode · ↑/↓ select · Space toggle · Enter submit"
    `);
  });
});

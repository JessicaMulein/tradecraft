/**
 * Component tests for the Ink Feed composer (task 22.14; design, "TUI": "Feed
 * composer: pick Case File Claims or compose a Proposition … It shows
 * `validateFeed` errors inline"; Requirements 13.1, 37.1, 37.2). These render
 * the real component with ink-testing-library and assert that it lists Claims to
 * toggle, switches to the compose form, surfaces an injected validator's
 * {@link FeedError}s inline on a failed submit, and fires `onSubmit` with the
 * assembled {@link FeedItem} list when the feed validates.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import type { ClaimView, FeedError, FeedItem, Result } from '@tradecraft/player-view';

import { FeedComposer } from './feed-composer.js';
import type { ComposeOptions } from './feed.js';

/** Terminal escape sequences ink decodes into `useInput` key presses. */
const KEY = {
  up: '\u001B[A',
  down: '\u001B[B',
  right: '\u001B[C',
  left: '\u001B[D',
  enter: '\r',
  tab: '\t',
  space: ' ',
} as const;

/** Advance a tick so ink flushes input-driven re-renders. */
const tick = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 10));
};

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

/** A validator that rejects an empty feed with a single count error. */
const rejectEmpty: (items: readonly FeedItem[]) => Result<void, FeedError[]> = (
  items,
) =>
  items.length === 0
    ? {
        ok: false,
        error: [{ index: -1, field: 'items', reason: 'a feed needs at least one item' }],
      }
    : { ok: true, value: undefined };

/**
 * A validator that always rejects with a per-item field error on the first
 * item, so the composer's item/field tagging can be asserted.
 */
const rejectFirstItemSubject: (
  items: readonly FeedItem[],
) => Result<void, FeedError[]> = () => ({
  ok: false,
  error: [{ index: 0, field: 'subject', reason: 'that person is not in your known set' }],
});

afterEach(() => {
  cleanup();
});

describe('FeedComposer rendering', () => {
  it('starts in Claims mode and lists the Claims (Req 37.1)', () => {
    const { lastFrame } = render(
      <FeedComposer claims={claims} options={options} validateFeed={alwaysOk} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Feed composer');
    expect(frame).toContain('[Claims]');
    expect(frame).toContain('npc:ana core/MEETS_AT npc:viktor');
  });

  it('switches to the compose form on Tab (Req 37.2)', async () => {
    const { lastFrame, stdin } = render(
      <FeedComposer claims={claims} options={options} validateFeed={alwaysOk} />,
    );
    await tick();
    stdin.write(KEY.tab);
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('[Compose]');
    expect(frame).toContain('predicate: MEMBER_OF');
    expect(frame).toContain('subject: Ana');
  });
});

describe('FeedComposer Claim toggling', () => {
  it('toggles the highlighted Claim into the feed on Space', async () => {
    const { lastFrame, stdin } = render(
      <FeedComposer claims={claims} options={options} validateFeed={alwaysOk} />,
    );
    await tick();
    stdin.write(KEY.space);
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('[x] npc:ana core/MEETS_AT npc:viktor');
    expect(frame).toContain('1 item');
  });
});

describe('FeedComposer validation', () => {
  it('shows validator errors inline and does not submit (Req 37.2)', async () => {
    const onSubmit = vi.fn();
    const { lastFrame, stdin } = render(
      <FeedComposer
        claims={claims}
        options={options}
        validateFeed={rejectEmpty}
        onSubmit={onSubmit}
      />,
    );
    await tick();
    stdin.write(KEY.enter); // submit an empty feed
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Cannot submit');
    expect(frame).toContain('a feed needs at least one item');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('tags a count error as a feed-level problem, not "item -1" (Req 37.2)', async () => {
    const { lastFrame, stdin } = render(
      <FeedComposer claims={claims} options={options} validateFeed={rejectEmpty} />,
    );
    await tick();
    stdin.write(KEY.enter); // submit an empty feed → count error (index -1)
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Feed (items): a feed needs at least one item');
    expect(frame).not.toContain('item -1');
    expect(frame).not.toContain('Item 0');
  });

  it('shows the 1-based item number and field for a per-item error (Req 37.2)', async () => {
    const { lastFrame, stdin } = render(
      <FeedComposer
        claims={claims}
        options={options}
        validateFeed={rejectFirstItemSubject}
      />,
    );
    await tick();
    stdin.write(KEY.space); // toggle a Claim in so there is an item to fault
    await tick();
    stdin.write(KEY.enter);
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Item 1 (subject): that person is not in your known set');
  });

  it('fires onSubmit with the assembled items when the feed validates', async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(
      <FeedComposer
        claims={claims}
        options={options}
        validateFeed={rejectEmpty}
        onSubmit={onSubmit}
      />,
    );
    await tick();
    stdin.write(KEY.space); // toggle claim:a in
    await tick();
    stdin.write(KEY.enter); // submit a non-empty feed
    await tick();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith([{ from: 'claim', claim: 'claim:a' }]);
  });

  it('clears the inline errors once the feed is edited', async () => {
    const { lastFrame, stdin } = render(
      <FeedComposer claims={claims} options={options} validateFeed={rejectEmpty} />,
    );
    await tick();
    stdin.write(KEY.enter); // surface the empty-feed error
    await tick();
    expect(lastFrame() ?? '').toContain('Cannot submit');
    stdin.write(KEY.space); // toggle a Claim in — feed changed
    await tick();
    expect(lastFrame() ?? '').not.toContain('Cannot submit');
  });
});

describe('FeedComposer compose form', () => {
  it('stages a composed Proposition and counts it as an item', async () => {
    const onSubmit = vi.fn();
    const { lastFrame, stdin } = render(
      <FeedComposer
        claims={claims}
        options={options}
        validateFeed={alwaysOk}
        onSubmit={onSubmit}
      />,
    );
    await tick();
    stdin.write(KEY.tab); // to compose mode
    await tick();
    stdin.write('a'); // stage the draft Proposition
    await tick();
    expect(lastFrame() ?? '').toContain('Composed: 1 staged');
    stdin.write(KEY.enter);
    await tick();
    expect(onSubmit).toHaveBeenCalledWith([
      {
        from: 'composed',
        prop: {
          predicate: 'core/MEMBER_OF',
          subject: 'npc:ana',
          object: 'org:cell',
        },
      },
    ]);
  });
});

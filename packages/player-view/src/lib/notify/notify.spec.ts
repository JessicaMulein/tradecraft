/**
 * Unit tests for the pure {@link notify} over player-visible events, its content
 * templates and the player-perspective namer (task 16.6; Requirements 39.2,
 * 39.3, 39.5, 39.7).
 *
 * These drive {@link notify} with hand-built, view-safe fixtures — a minimal
 * {@link NotifyView} and player-visible / hidden {@link SimEvent}s — and assert:
 *
 * - every player-visible event the design lists produces its Notification with
 *   the right kind and payload (Req 39.3);
 * - a Fact Line is rendered from the content template with the identity-aware
 *   player namer: an identified NPC is named, an unidentified one is referenced
 *   by descriptor only (Req 39.7);
 * - hidden events are ignored, so `notify(all)` equals `notify(player-only)`
 *   and a lone hidden event raises nothing (the Property 28 shape; the property
 *   test itself is task 16.7); and
 * - the player-visible kinds that carry no status-bar alert (`day-start`, a
 *   player's own missed meeting, a custody release) produce no Notification.
 */

import { describe, expect, it } from 'vitest';

import type {
  DeadDrop,
  GameTime,
  Meeting,
  NpcId,
  Phase,
  SimEvent,
} from '@tradecraft/engine';

import { notify, notificationIdFor } from './notify.js';
import type { NotifyView } from './view.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function time(day: number, phase: Phase): GameTime {
  return { day, phase };
}

/**
 * A minimal, view-safe {@link NotifyView}: two NPCs (one identified, one not),
 * one Location, one Dead Drop, one arranged meeting, one Directive. Cast through
 * `unknown` to the view slice — the namer and `notify` read only these fields.
 */
function view(over: { known?: NpcId[] } = {}): NotifyView {
  const ana = 'npc:ana' as NpcId;
  const viktor = 'npc:viktor' as NpcId;
  const meeting: Meeting = {
    id: 'meeting:npc:ana@loc:cafe#2.1',
    npc: ana,
    at: 'loc:cafe',
    slot: time(2, 1),
    status: 'accepted',
    acceptance: 0.8,
  } as Meeting;
  const drop: DeadDrop = {
    id: 'drop:alley',
    loc: 'loc:cafe',
    owner: { kind: 'player' },
    contents: [],
  } as unknown as DeadDrop;

  return {
    npcs: {
      [ana]: { persona: { name: 'Ana Fischer' }, descriptor: { summary: 'a woman in a red scarf' } },
      [viktor]: { persona: { name: 'Viktor Kessler' }, descriptor: { summary: 'a man in a grey coat' } },
    },
    city: { locations: { 'loc:cafe': { name: 'The Landtmann' } } },
    player: { known: { entities: over.known ?? [ana], channels: [], drops: ['drop:alley'] } },
    deadDrops: { 'drop:alley': drop },
    station: {
      directives: [
        { id: 'dir:1', text: 'Identify the cell leader', objective: {}, deadline: time(9, 0), reward: 1, status: 'open' },
      ],
    },
    meetings: { 'meeting:npc:ana@loc:cafe#2.1': meeting },
  } as unknown as NotifyView;
}

/** A player-visible event with the given fields. */
function playerEvent(over: Partial<SimEvent> & Pick<SimEvent, 'kind'>): SimEvent {
  return {
    id: `e:${over.kind}`,
    at: time(2, 1),
    visibility: 'player',
    ...over,
  } as SimEvent;
}

/** A hidden event (an off-screen arrest). */
function arrestEvent(): SimEvent {
  return {
    id: 'e:arrest',
    at: time(2, 1),
    visibility: 'hidden',
    kind: 'asset-arrested',
    npc: 'npc:ana' as NpcId,
  } as SimEvent;
}

// ---------------------------------------------------------------------------
// Per-kind Notifications (Req 39.3)
// ---------------------------------------------------------------------------

describe('notify — per-kind Notifications', () => {
  it('builds a cable Notification', () => {
    const [n] = notify([playerEvent({ kind: 'cable', doc: 'doc:brief' } as never)], view());
    expect(n.kind).toBe('cable');
    expect(n).toMatchObject({ doc: 'doc:brief', dismissed: false, at: time(2, 1) });
    expect(n.factLine).toMatch(/Cable/);
  });

  it('builds a newspaper Notification', () => {
    const [n] = notify([playerEvent({ kind: 'newspaper', doc: 'doc:news-2' } as never)], view());
    expect(n.kind).toBe('newspaper');
    expect(n.factLine).toMatch(/newspaper/i);
  });

  it('builds a directive Notification rendering the Directive wording', () => {
    const [n] = notify(
      [playerEvent({ kind: 'directive', directive: 'dir:1', status: 'issued' } as never)],
      view(),
    );
    expect(n.kind).toBe('directive');
    expect(n).toMatchObject({ directive: 'dir:1', status: 'issued' });
    expect(n.factLine).toContain('Identify the cell leader');
  });

  it('builds accepted and declined meeting-reply Notifications, naming the party', () => {
    const accepted = notify(
      [playerEvent({ kind: 'meeting-reply', meeting: 'meeting:npc:ana@loc:cafe#2.1', accepted: true } as never)],
      view(),
    )[0];
    expect(accepted.kind).toBe('meeting-reply');
    expect(accepted).toMatchObject({ accepted: true, npc: 'npc:ana' });
    expect(accepted.factLine).toContain('Ana Fischer');
    expect(accepted.factLine).toMatch(/agreed/i);

    const declined = notify(
      [playerEvent({ kind: 'meeting-reply', meeting: 'meeting:npc:ana@loc:cafe#2.1', accepted: false } as never)],
      view(),
    )[0];
    expect(declined.factLine).toMatch(/declined/i);
  });

  it('builds meeting-due and meeting-no-show Notifications', () => {
    const due = notify([playerEvent({ kind: 'meeting-due', meeting: 'meeting:npc:ana@loc:cafe#2.1' } as never)], view())[0];
    expect(due.kind).toBe('meeting-due');
    const noShow = notify([playerEvent({ kind: 'meeting-no-show', meeting: 'meeting:npc:ana@loc:cafe#2.1' } as never)], view())[0];
    expect(noShow.kind).toBe('meeting-no-show');
    expect(noShow.factLine).toMatch(/did not appear/i);
  });

  it('builds a walk-in Notification', () => {
    const [n] = notify([playerEvent({ kind: 'walk-in', npc: 'npc:ana' } as never)], view());
    expect(n.kind).toBe('walk-in');
    expect(n.factLine).toContain('Ana Fischer');
  });

  it('builds a drop-unserviced Notification labelled by the drop Location', () => {
    const [n] = notify([playerEvent({ kind: 'drop-unserviced', drop: 'drop:alley' } as never)], view());
    expect(n.kind).toBe('drop-unserviced');
    expect(n.factLine).toContain('The Landtmann');
  });

  it('builds an asset-silent Notification with a day span', () => {
    const [n] = notify([playerEvent({ kind: 'asset-silent', npc: 'npc:ana', days: 3 } as never)], view());
    expect(n.kind).toBe('asset-silent');
    expect(n).toMatchObject({ npc: 'npc:ana', days: 3 });
    expect(n.factLine).toMatch(/3 days/);
  });

  it('builds a retainer-due Notification with the amount', () => {
    const [n] = notify([playerEvent({ kind: 'retainer-due', npc: 'npc:ana', amount: 500 } as never)], view());
    expect(n.kind).toBe('retainer-due');
    expect(n).toMatchObject({ npc: 'npc:ana', amount: 500 });
    expect(n.factLine).toContain('500');
  });
});

// ---------------------------------------------------------------------------
// Player-perspective namer (Req 39.7)
// ---------------------------------------------------------------------------

describe('notify — player-perspective namer', () => {
  it('names an identified NPC by persona name', () => {
    const [n] = notify([playerEvent({ kind: 'walk-in', npc: 'npc:ana' } as never)], view({ known: ['npc:ana' as NpcId] }));
    expect(n.factLine).toContain('Ana Fischer');
    expect(n.factLine).not.toContain('a woman in a red scarf');
  });

  it('references an unidentified NPC by descriptor, never by name', () => {
    const [n] = notify([playerEvent({ kind: 'walk-in', npc: 'npc:viktor' } as never)], view({ known: [] }));
    expect(n.factLine).toContain('a man in a grey coat');
    expect(n.factLine).not.toContain('Viktor Kessler');
  });
});

// ---------------------------------------------------------------------------
// Visibility soundness (Req 39.4/39.5 shape; Property 28 is task 16.7)
// ---------------------------------------------------------------------------

describe('notify — visibility', () => {
  it('ignores hidden events: notify(all) equals notify(player-only)', () => {
    const v = view();
    const player = playerEvent({ kind: 'cable', doc: 'doc:brief' } as never);
    const hidden = arrestEvent();
    expect(notify([hidden, player], v)).toEqual(notify([player], v));
  });

  it('a lone hidden event raises nothing', () => {
    expect(notify([arrestEvent()], view())).toEqual([]);
  });

  it('produces no Notification for day-start, a player missed meeting, or a custody release', () => {
    const v = view();
    expect(notify([playerEvent({ kind: 'day-start', weather: { summary: 'clear' } } as never)], v)).toEqual([]);
    expect(
      notify([playerEvent({ kind: 'meeting-missed-by-player', meeting: 'meeting:npc:ana@loc:cafe#2.1' } as never)], v),
    ).toEqual([]);
    expect(notify([playerEvent({ kind: 'custody-released', npc: 'npc:ana' } as never)], v)).toEqual([]);
  });

  it('preserves input order and derives a stable id from the event id', () => {
    const v = view();
    const a = playerEvent({ kind: 'cable', doc: 'doc:a', id: 'e:a' } as never);
    const b = playerEvent({ kind: 'newspaper', doc: 'doc:b', id: 'e:b' } as never);
    const out = notify([a, b], v);
    expect(out.map((n) => n.kind)).toEqual(['cable', 'newspaper']);
    expect(out[0].id).toBe(notificationIdFor(a));
  });
});

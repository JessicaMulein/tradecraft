/**
 * Property 28: Notification soundness (task 16.7).
 *
 *   "For any event sequence and Player View:
 *     - `notify(events, view)` equals
 *       `notify(events.filter(e => e.visibility === 'player'), view)`;
 *     - every Notification references only entities in the player's known set
 *       and contains no truth-branded field;
 *     - adding a hidden event that produces no player-visible event (for example
 *       a quiet doubling) leaves the Notification stream unchanged."
 *   — design.md, Correctness Properties, Property 28.
 *   **Validates: Requirements 39.2, 39.4, 39.5, 39.7**
 *
 * The test drives the just-built Notifications module ({@link notify},
 * {@link notificationIdFor}, {@link raiseDerivedEvents}) over generated
 * {@link SimEvent} sequences that mix player-visible and hidden events against a
 * crafted, view-safe {@link NotifyView} fixture, and asserts the three clauses
 * the property names, plus the derived-event clause (Req 39.5):
 *
 * - **(a) Visibility soundness (Req 39.4).** `notify` over the whole sequence
 *   equals `notify` over only the player-visible slice: hidden events contribute
 *   nothing. The companion clause — inserting a hidden event anywhere in the
 *   sequence leaves the Notification stream unchanged — is the same fact stated
 *   as a stability property and is asserted directly.
 * - **(b) Identity-aware naming (Req 39.7).** Every Notification's `factLine`
 *   references an NPC only through the identity-aware namer: an identified NPC
 *   may appear by persona name, but an *un*identified NPC never does — only by
 *   their physical descriptor. No `factLine` ever spells out the persona name of
 *   an NPC outside the player's known set, and no Notification carries a
 *   truth-branded field (the player-visible `SimEvent` variants carry none, so
 *   `notify` cannot introduce one).
 * - **(c) Derived events from player-side expectations (Req 39.5).**
 *   `raiseDerivedEvents` reads only the view-safe expectations it is handed, so
 *   every event it raises is player-visible and, run back through `notify`,
 *   yields a stream that honours the same identity-aware naming. A hidden event
 *   with no observable consequence contributes no expectation and so raises
 *   nothing.
 *
 * ## Why the fixture is crafted rather than a generated WorldState
 *
 * `notify` reads a narrow, view-safe slice of the world (NPC persona/descriptor,
 * the known set, Locations, Dead Drops, Directives, meetings). A hand-built
 * {@link NotifyView} lets the generators range freely over *which* entities each
 * event names and over the known set, while keeping the oracle for clause (b)
 * exact: we know every NPC's persona name and descriptor, so we can assert that
 * an unidentified NPC's persona name never appears in a Fact Line. The persona
 * names and descriptors are coined, collision-free tokens so a descriptor can
 * never accidentally contain a persona name (which would make the oracle
 * ambiguous).
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  isPlayerVisibleKind,
  SIM_EVENT_KINDS,
  type DeadDrop,
  type DeadDropId,
  type GameTime,
  type Meeting,
  type MeetingId,
  type Phase,
  type SimEvent,
  type SimEventKind,
} from '@tradecraft/engine';

import { type DerivedExpectations, raiseDerivedEvents } from './derived.js';
import { notify, notificationIdFor } from './notify.js';
import type { NotifyView } from './view.js';

// ---------------------------------------------------------------------------
// The crafted, view-safe fixture
// ---------------------------------------------------------------------------

/**
 * The NPCs the fixture knows about, with coined, collision-free persona names
 * and descriptors. A persona name is a capitalised invented word; a descriptor
 * is a lowercase phrase that never contains a persona name. That disjointness is
 * what makes the clause-(b) oracle exact: finding a persona name in a Fact Line
 * can only mean the namer rendered that NPC by name.
 */
const NPCS = {
  'npc:qvarl': { persona: 'Qvarl', descriptor: 'a figure in a long coat' },
  'npc:zbryn': { persona: 'Zbryn', descriptor: 'a stranger by the kiosk' },
  'npc:plofk': { persona: 'Plofk', descriptor: 'someone carrying a satchel' },
} as const satisfies Record<string, { persona: string; descriptor: string }>;

type FixtureNpc = keyof typeof NPCS;
const NPC_IDS = Object.keys(NPCS) as FixtureNpc[];

const LOC = 'loc:markt';
const LOC_NAME = 'The Marktplatz';
const DROP = 'drop:zedov';
const DIRECTIVE = 'dir:alpha';
const DIRECTIVE_TEXT = 'Vorkel the courier line';

/** The arranged meetings the view holds, one per NPC, so `meeting-reply` resolves a party. */
const MEETINGS: Record<string, Meeting> = Object.fromEntries(
  NPC_IDS.map((npc) => {
    const id = `meeting:${npc}@${LOC}#2.1`;
    return [
      id,
      { id, npc, at: LOC, slot: { day: 2, phase: 1 }, status: 'accepted', acceptance: 0.8 } as Meeting,
    ];
  }),
);
const MEETING_IDS = Object.keys(MEETINGS);

const DROP_RECORD = {
  id: DROP,
  loc: LOC,
  owner: { kind: 'player' },
  contents: [],
} as unknown as DeadDrop;

/**
 * Build the view with the given known set. The namer renders an NPC by persona
 * name when it is in `known`, and by descriptor otherwise.
 */
function viewWith(known: readonly FixtureNpc[]): NotifyView {
  return {
    npcs: Object.fromEntries(
      NPC_IDS.map((npc) => [
        npc,
        { persona: { name: NPCS[npc].persona }, descriptor: { summary: NPCS[npc].descriptor } },
      ]),
    ),
    city: { locations: { [LOC]: { name: LOC_NAME } } },
    player: { known: { entities: [...known], channels: [], drops: [DROP] } },
    deadDrops: { [DROP]: DROP_RECORD },
    station: {
      directives: [
        { id: DIRECTIVE, text: DIRECTIVE_TEXT, objective: {}, deadline: { day: 9, phase: 0 }, reward: 1, status: 'open' },
      ],
    },
    meetings: MEETINGS,
  } as unknown as NotifyView;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const HIDDEN_KINDS = SIM_EVENT_KINDS.filter((k) => !isPlayerVisibleKind(k));

const npcArb: fc.Arbitrary<FixtureNpc> = fc.constantFrom(...NPC_IDS);
const meetingArb: fc.Arbitrary<MeetingId> = fc.constantFrom(...(MEETING_IDS as MeetingId[]));
const timeArb: fc.Arbitrary<GameTime> = fc.record({
  day: fc.integer({ min: 0, max: 20 }),
  phase: fc.integer({ min: 0, max: 3 }).map((n) => n as Phase),
});

/**
 * A well-formed {@link SimEvent} of the given kind, naming only fixture
 * entities. Payloads match the engine's `SimEvent` union; hidden kinds that the
 * player can never observe still carry their required fields so the sequence is
 * a faithful "mixed" stream. The `index` disambiguates ids within a sequence so
 * two events of the same kind can coexist.
 */
function eventOfKind(kind: SimEventKind, index: number): fc.Arbitrary<SimEvent> {
  const base = <T>(payload: T) =>
    timeArb.map(
      (at) =>
        ({
          id: `e:${kind}:${index}`,
          at,
          visibility: isPlayerVisibleKind(kind) ? 'player' : 'hidden',
          kind,
          ...payload,
        }) as unknown as SimEvent,
    );

  switch (kind) {
    // --- player-visible ------------------------------------------------
    case 'day-start':
      return base({ weather: { summary: 'clear' } });
    case 'newspaper':
    case 'cable':
      return base({ doc: `doc:${kind}:${index}` });
    case 'directive':
      return fc
        .constantFrom('issued' as const, 'met' as const, 'failed' as const)
        .chain((status) => base({ directive: DIRECTIVE, status }));
    case 'walk-in':
      return npcArb.chain((npc) => base({ npc }));
    case 'meeting-reply':
      return fc
        .tuple(meetingArb, fc.boolean())
        .chain(([meeting, accepted]) => base({ meeting, accepted }));
    case 'meeting-due':
    case 'meeting-no-show':
    case 'meeting-missed-by-player':
      return meetingArb.chain((meeting) => base({ meeting }));
    case 'drop-unserviced':
      return base({ drop: DROP });
    case 'asset-silent':
      return fc.tuple(npcArb, fc.integer({ min: 1, max: 10 })).chain(([npc, days]) => base({ npc, days }));
    case 'retainer-due':
      return fc.tuple(npcArb, fc.integer({ min: 1, max: 5000 })).chain(([npc, amount]) => base({ npc, amount }));
    case 'custody-released':
      return npcArb.chain((npc) => base({ npc }));
    case 'public-announcement':
    case 'cover-employer-message':
      return base({ text: 'The office is closed tomorrow.' });
    case 'cover-duty-due':
    case 'cover-duty-missed':
      return base({ duty: 'Office hours' });
    case 'drop-disturbed':
      return base({ drop: DROP });
    case 'departure-cancelled':
      return base({ route: 'route:west' });
    case 'border-outcome':
      return base({ post: 'post:gate', outcome: 'passed' as const });
    case 'papers-issued':
      return base({ doc: 'paper:pass' });
    case 'visa-decision':
      return base({ country: 'Eastland', granted: true });
    case 'liaison-report':
      return base({ service: 'service:liaison' });
    case 'outstation-report':
      return base({ city: 'city:east' });
    case 'courier-delivery':
      return base({ handoff: 'handoff:parcel' });
    case 'asset-arrived':
      return npcArb.chain((npc) => base({ npc }));
    case 'expelled':
      return base({ country: 'Eastland' });
    // --- hidden --------------------------------------------------------
    case 'asset-detected':
    case 'asset-arrested':
    case 'asset-doubled':
      return npcArb.chain((npc) => base({ npc }));
    default:
      // Every other hidden kind: a bare event is enough — `notify` never reads
      // a hidden payload, it drops the event on visibility alone.
      return base({});
  }
}

/** A single event of any kind (player-visible or hidden), naming fixture entities. */
function anyEventArb(index: number): fc.Arbitrary<SimEvent> {
  return fc.constantFrom(...SIM_EVENT_KINDS).chain((kind) => eventOfKind(kind, index));
}

/** Ambient event kinds the slice generator now always mixes into a sequence. */
const AMBIENT_EVENT_KINDS = [
  'public-announcement',
  'cover-duty-due',
  'cover-duty-missed',
  'cover-employer-message',
  'drop-disturbed',
  'gossip',
  'incident',
  'life-event',
  'ambient-hook',
  'location-status',
] as const satisfies readonly SimEventKind[];

/** A sequence of mixed events (0..12 of them), plus one ambient event. */
const eventSequenceArb: fc.Arbitrary<SimEvent[]> = fc
  .array(fc.integer(), { minLength: 0, maxLength: 12 })
  .chain((seeds) => fc.tuple(...seeds.map((_, i) => anyEventArb(i))))
  .chain((events) =>
    fc.constantFrom(...AMBIENT_EVENT_KINDS).chain((kind) =>
      eventOfKind(kind, events.length).map((extra) => [...events, extra]),
    ),
  );

/** A single hidden event (for the stability clause). */
const hiddenEventArb: fc.Arbitrary<SimEvent> = fc
  .constantFrom(...HIDDEN_KINDS)
  .chain((kind) => eventOfKind(kind, 999));

/** A known set: any subset of the fixture NPCs. */
const knownArb: fc.Arbitrary<FixtureNpc[]> = fc.subarray(NPC_IDS);

// ---------------------------------------------------------------------------
// Oracle helpers for the identity-aware-naming clause
// ---------------------------------------------------------------------------

/**
 * The persona names of every NPC *not* in the known set. Clause (b) asserts no
 * Fact Line ever contains any of these.
 */
function forbiddenPersonaNames(known: readonly FixtureNpc[]): string[] {
  return NPC_IDS.filter((npc) => !known.includes(npc)).map((npc) => NPCS[npc].persona);
}

// ---------------------------------------------------------------------------
// Property 28
// ---------------------------------------------------------------------------

describe('Property 28: Notification soundness', () => {
  it('(a) notify over all events equals notify over only the player-visible ones', () => {
    fc.assert(
      fc.property(eventSequenceArb, knownArb, (events, known) => {
        const view = viewWith(known);
        const playerOnly = events.filter((e) => e.visibility === 'player');
        expect(notify(events, view)).toEqual(notify(playerOnly, view));
      }),
    );
  });

  it('(a′) inserting a hidden event anywhere leaves the Notification stream unchanged', () => {
    fc.assert(
      fc.property(eventSequenceArb, knownArb, hiddenEventArb, fc.nat(), (events, known, hidden, pos) => {
        const view = viewWith(known);
        const before = notify(events, view);
        const at = events.length === 0 ? 0 : pos % (events.length + 1);
        const injected = [...events.slice(0, at), hidden, ...events.slice(at)];
        expect(notify(injected, view)).toEqual(before);
      }),
    );
  });

  it('(b) every Fact Line references an unidentified NPC only by descriptor, never by persona name', () => {
    fc.assert(
      fc.property(eventSequenceArb, knownArb, (events, known) => {
        const view = viewWith(known);
        const notifications = notify(events, view);
        const forbidden = forbiddenPersonaNames(known);
        for (const n of notifications) {
          for (const name of forbidden) {
            expect(n.factLine.includes(name)).toBe(false);
          }
          // No Notification carries a truth-branded field: the view-safe
          // variants expose only plain ids, counts and the rendered Fact Line.
          expect(Object.prototype.hasOwnProperty.call(n, 'truth')).toBe(false);
          expect(Object.prototype.hasOwnProperty.call(n, 'origin')).toBe(false);
        }
      }),
    );
  });

  it('(b′) an identified NPC may be named, and the Notification id derives from the event id', () => {
    fc.assert(
      fc.property(npcArb, (npc) => {
        // With the NPC identified, a walk-in names them by persona; unidentified,
        // it names them by descriptor and never by persona.
        const walkIn = {
          id: 'e:walk-in:probe',
          at: { day: 1, phase: 0 },
          visibility: 'player',
          kind: 'walk-in',
          npc,
        } as unknown as SimEvent;

        const identified = notify([walkIn], viewWith([npc]));
        expect(identified).toHaveLength(1);
        expect(identified[0].factLine).toContain(NPCS[npc].persona);
        expect(identified[0].id).toBe(notificationIdFor(walkIn));

        const unidentified = notify([walkIn], viewWith([]));
        expect(unidentified[0].factLine).toContain(NPCS[npc].descriptor);
        expect(unidentified[0].factLine.includes(NPCS[npc].persona)).toBe(false);
      }),
    );
  });

  it('(c) derived events are raised only from player-side expectations and stay view-safe', () => {
    const expectationArb: fc.Arbitrary<DerivedExpectations> = fc.record({
      silenceDays: fc.integer({ min: 1, max: 7 }),
      meetingNoShows: fc.array(
        fc.record({ meeting: meetingArb, slot: timeArb }),
        { maxLength: 3 },
      ),
      unservicedDrops: fc.array(
        fc.record({ drop: fc.constant(DROP as DeadDropId), at: timeArb }),
        { maxLength: 3 },
      ),
      silences: fc.array(
        fc.record({ npc: npcArb, days: fc.integer({ min: 0, max: 10 }), at: timeArb }),
        { maxLength: 3 },
      ),
      retainersDue: fc.array(
        fc.record({ npc: npcArb, amount: fc.integer({ min: 1, max: 5000 }), at: timeArb }),
        { maxLength: 3 },
      ),
    });

    fc.assert(
      fc.property(expectationArb, knownArb, (expectations, known) => {
        const derived = raiseDerivedEvents(expectations);
        // Everything raised is player-visible — never a hidden Sim event.
        for (const e of derived) {
          expect(e.visibility).toBe('player');
          expect(isPlayerVisibleKind(e.kind)).toBe(true);
        }
        // A silence below the threshold raises nothing (no observable consequence).
        const belowThreshold = (expectations.silences ?? []).filter(
          (s) => s.days < expectations.silenceDays,
        );
        for (const s of belowThreshold) {
          const raised = derived.filter((e) => e.kind === 'asset-silent' && e.npc === s.npc && e.at.day === s.at.day);
          // Only raised when another silence for the same npc/day meets the threshold.
          const meets = (expectations.silences ?? []).some(
            (o) => o.npc === s.npc && o.at.day === s.at.day && o.days >= expectations.silenceDays,
          );
          if (!meets) {
            expect(raised).toEqual([]);
          }
        }
        // Fed back through notify, the derived stream honours identity-aware naming.
        const view = viewWith(known);
        const notifications = notify(derived, view);
        const forbidden = forbiddenPersonaNames(known);
        for (const n of notifications) {
          for (const name of forbidden) {
            expect(n.factLine.includes(name)).toBe(false);
          }
        }
      }),
    );
  });
});

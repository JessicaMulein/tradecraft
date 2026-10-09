import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  ADMIRALTY_CREDIBILITY,
  ADMIRALTY_RELIABILITY,
  AdmiraltyGradeSchema,
  formatAdmiraltyGrade,
  isPlayerVisibleKind,
  SIM_EVENT_KINDS,
  SIM_EVENT_VISIBILITY,
  TraceOriginSchema,
  visibilityOf,
  type SimEvent,
  type SimEventKind,
} from './state.js';

// ---------------------------------------------------------------------------
// The per-kind visibility table (Requirement 39.1)
// ---------------------------------------------------------------------------

/**
 * The design fixes which event kinds are player-visible and which are hidden.
 * These two sets are the design's own split (hidden kinds first in the union,
 * player-visible kinds after the `// player-visible` comment), restated here so
 * the test fails loudly if the table in `state.ts` ever drifts from the design.
 */
const HIDDEN_KINDS: readonly SimEventKind[] = [
  'npc-moved',
  'meeting',
  'transmission',
  'drop-loaded',
  'drop-emptied',
  'stage-executed',
  'stage-disrupted',
  'plot-adapted',
  'plot-completed',
  'plot-aborted',
  'branch-resolved',
  'plot-resolved',
  'asset-detected',
  'asset-arrested',
  'asset-doubled',
  'feed-delivered',
  'belief-adopted',
  'belief-plant',
  'tail-started',
  'tail-ended',
  'player-burned',
  'mole-report',
  'walk-in-approach',
  'city-event-stage',
  'incident',
  'life-event',
  'gossip',
  'informant-report',
  'ambient-hook',
  'location-status',
  'drop-raided',
  'promotion',
  'officer-recognised',
  'transit-started',
  'transit-arrived',
  'border-check',
  'handoff-moved',
  'belief-shared',
  'penetration-relay',
  'rival-exposure',
];

const PLAYER_VISIBLE_KINDS: readonly SimEventKind[] = [
  'day-start',
  'newspaper',
  'cable',
  'directive',
  'walk-in',
  'meeting-reply',
  'meeting-due',
  'meeting-no-show',
  'meeting-missed-by-player',
  'drop-unserviced',
  'asset-silent',
  'retainer-due',
  'custody-released',
  'public-announcement',
  'cover-duty-due',
  'cover-duty-missed',
  'cover-employer-message',
  'drop-disturbed',
  'departure-cancelled',
  'border-outcome',
  'papers-issued',
  'visa-decision',
  'liaison-report',
  'outstation-report',
  'courier-delivery',
  'asset-arrived',
  'expelled',
];

const kindArb: fc.Arbitrary<SimEventKind> = fc.constantFrom(...SIM_EVENT_KINDS);

describe('SIM_EVENT_VISIBILITY', () => {
  it('is a fixed mapping with an entry for every event kind', () => {
    // Every kind in the union has exactly one entry, and the table has no
    // extra keys. This is the "fixed per-kind table" the task calls for.
    expect(Object.keys(SIM_EVENT_VISIBILITY).sort()).toEqual([...SIM_EVENT_KINDS].sort());
  });

  it('marks every kind either player-visible or hidden, never both', () => {
    for (const kind of SIM_EVENT_KINDS) {
      const v = SIM_EVENT_VISIBILITY[kind];
      expect(v === 'player' || v === 'hidden').toBe(true);
    }
  });

  it('covers both the hidden and the player-visible kinds exhaustively', () => {
    // The two restated sets together must be exactly the union, with no overlap.
    const union = [...HIDDEN_KINDS, ...PLAYER_VISIBLE_KINDS].sort();
    expect(union).toEqual([...SIM_EVENT_KINDS].sort());
    const overlap = HIDDEN_KINDS.filter((k) => PLAYER_VISIBLE_KINDS.includes(k));
    expect(overlap).toEqual([]);
  });

  it('assigns the design visibility to each hidden kind', () => {
    for (const kind of HIDDEN_KINDS) {
      expect(SIM_EVENT_VISIBILITY[kind]).toBe('hidden');
    }
  });

  it('assigns the design visibility to each player-visible kind', () => {
    for (const kind of PLAYER_VISIBLE_KINDS) {
      expect(SIM_EVENT_VISIBILITY[kind]).toBe('player');
    }
  });

  it('exposes the same answer through visibilityOf and isPlayerVisibleKind', () => {
    fc.assert(
      fc.property(kindArb, (kind) => {
        expect(visibilityOf(kind)).toBe(SIM_EVENT_VISIBILITY[kind]);
        expect(isPlayerVisibleKind(kind)).toBe(SIM_EVENT_VISIBILITY[kind] === 'player');
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// The visibility tag on a SimEvent matches the table
// ---------------------------------------------------------------------------

describe('SimEvent visibility tag', () => {
  it("a player-visible event's visibility field agrees with the table", () => {
    // A concrete player-visible event. Building one and checking its tag is the
    // compile-time-plus-runtime guarantee that the union and the table agree.
    const event: SimEvent = {
      id: 'evt:1',
      at: { day: 0, phase: 0 },
      visibility: 'player',
      kind: 'newspaper',
      doc: 'doc:edition-1',
    };
    expect(event.visibility).toBe(SIM_EVENT_VISIBILITY[event.kind]);
  });

  it("a hidden event's visibility field agrees with the table", () => {
    const event: SimEvent = {
      id: 'evt:2',
      at: { day: 1, phase: 2 },
      visibility: 'hidden',
      kind: 'npc-moved',
      npc: 'npc:ana',
      from: 'loc:cafe',
      to: 'loc:pier',
    };
    expect(event.visibility).toBe(SIM_EVENT_VISIBILITY[event.kind]);
  });
});

// ---------------------------------------------------------------------------
// TraceOrigin schema
// ---------------------------------------------------------------------------

describe('TraceOriginSchema', () => {
  it('parses each origin kind from the design', () => {
    const origins = [
      { kind: 'plot', stage: 'stage-1' },
      { kind: 'side-thread', thread: 'thread-1' },
      { kind: 'noise', schedule: 'tram-07' },
      { kind: 'deception' },
      { kind: 'routine' },
    ];
    for (const o of origins) {
      expect(() => TraceOriginSchema.parse(o)).not.toThrow();
    }
  });

  it('rejects an unknown origin kind and missing fields', () => {
    expect(() => TraceOriginSchema.parse({ kind: 'mystery' })).toThrow();
    expect(() => TraceOriginSchema.parse({ kind: 'plot' })).toThrow();
    expect(() => TraceOriginSchema.parse({ kind: 'side-thread' })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Admiralty Grade (Requirement 8.1)
// ---------------------------------------------------------------------------

describe('AdmiraltyGrade', () => {
  it('accepts every reliability letter paired with every credibility digit', () => {
    for (const reliability of ADMIRALTY_RELIABILITY) {
      for (const credibility of ADMIRALTY_CREDIBILITY) {
        const parsed = AdmiraltyGradeSchema.parse({ reliability, credibility });
        expect(parsed).toEqual({ reliability, credibility });
      }
    }
  });

  it('rejects out-of-range letters and digits', () => {
    expect(AdmiraltyGradeSchema.safeParse({ reliability: 'G', credibility: 1 }).success).toBe(false);
    expect(AdmiraltyGradeSchema.safeParse({ reliability: 'A', credibility: 0 }).success).toBe(false);
    expect(AdmiraltyGradeSchema.safeParse({ reliability: 'A', credibility: 7 }).success).toBe(false);
    expect(AdmiraltyGradeSchema.safeParse({ reliability: 'a', credibility: 1 }).success).toBe(false);
  });

  it('rejects unknown and missing fields', () => {
    expect(AdmiraltyGradeSchema.safeParse({ reliability: 'B' }).success).toBe(false);
    expect(
      AdmiraltyGradeSchema.safeParse({ reliability: 'B', credibility: 2, extra: true }).success,
    ).toBe(false);
  });

  it('formats as the letter-digit code analysts write', () => {
    expect(formatAdmiraltyGrade({ reliability: 'B', credibility: 2 })).toBe('B2');
    expect(formatAdmiraltyGrade({ reliability: 'F', credibility: 6 })).toBe('F6');
  });

  it('exposes six reliabilities and six credibilities', () => {
    expect(ADMIRALTY_RELIABILITY).toHaveLength(6);
    expect(ADMIRALTY_CREDIBILITY).toHaveLength(6);
  });
});

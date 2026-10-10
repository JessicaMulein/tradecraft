/**
 * Tests for Station Cables: submitting trace/funds/report requests and
 * delivering their replies after the preset delay (task 10.2; Requirements
 * 27.4, 27.5).
 *
 * The design fixes the behaviour: "Supported requests are trace, funds and
 * report. Replies arrive as Cable Documents after the preset delay"; a funds
 * request grants an amount determined by Standing, capped by the preset, at most
 * once per two days; a trace returns a Dossier on the subject. These tests drive
 * {@link submitCable} and {@link processDueCables} and assert the reply timing,
 * the ledger credit (with its cap and cooldown), the Standing moves, the trace
 * target hand-off and the `cable` events, plus determinism.
 */

import fc from 'fast-check';

import type { GameTime } from '../model/core.js';
import { balance, createLedger, type Ledger } from './ledger.js';
import type { CableRequest } from '../action/types.js';
import {
  DEFAULT_CABLE_DELAY_PHASES,
  DEFAULT_FUNDS_BASE,
  DEFAULT_FUNDS_CAP,
  FUNDS_COOLDOWN_DAYS,
  fundsCooldownElapsed,
  fundsGrantAmount,
  processDueCables,
  submitCable,
  type CableStationSlice,
  type FundsPolicy,
} from './cables.js';
import type { PendingCable } from './cable-types.js';

const T = (day: number, phase: 0 | 1 | 2 | 3 = 0): GameTime => ({ day, phase });

const FUNDS: FundsPolicy = { base: DEFAULT_FUNDS_BASE, cap: DEFAULT_FUNDS_CAP };

function station(
  pendingCables: readonly PendingCable[],
  over: Partial<CableStationSlice> = {},
): CableStationSlice {
  return {
    pendingCables,
    standing: 0,
    ledger: createLedger(500),
    ...over,
  };
}

describe('submitCable', () => {
  it('schedules the reply the preset delay after the send time', () => {
    const request: CableRequest = { kind: 'funds', amount: 300 };
    const pending = submitCable(request, T(1, 0), { delayPhases: 4 });

    expect(pending.sentAt).toEqual(T(1, 0));
    expect(pending.replyDue).toEqual(T(2, 0)); // +4 phases = +1 day
    expect(pending.reply.kind).toBe('funds');
  });

  it('falls back to the documented default delay when none is given', () => {
    const pending = submitCable({ kind: 'report', body: 'all quiet' }, T(0, 0));
    expect(pending.replyDue).toEqual(
      T(Math.floor(DEFAULT_CABLE_DELAY_PHASES / 4), (DEFAULT_CABLE_DELAY_PHASES % 4) as 0),
    );
    expect(pending.reply.kind).toBe('report');
  });

  it('carries the trace target into the reply spec', () => {
    const pending = submitCable({ kind: 'trace', target: 'npc:ana' }, T(0, 0));
    expect(pending.reply).toEqual({ kind: 'trace', target: 'npc:ana' });
  });
});

describe('processDueCables — a cable not yet due', () => {
  it('produces no reply and keeps the pending cable', () => {
    const pending = submitCable({ kind: 'funds', amount: 200 }, T(1, 0), {
      delayPhases: 4,
    });
    const result = processDueCables(station([pending]), T(1, 2), FUNDS);

    expect(result.replies).toHaveLength(0);
    expect(result.events).toHaveLength(0);
    expect(result.pendingCables).toHaveLength(1);
    expect(result.pendingCables[0]).toBe(pending);
  });
});

describe('processDueCables — a funds cable', () => {
  it('credits the ledger after the delay with a Standing-scaled amount', () => {
    const pending = submitCable({ kind: 'funds' }, T(1, 0), { delayPhases: 4 });
    // Standing 10 => base * (1 + 10/10) = 200.
    const result = processDueCables(
      station([pending], { standing: 10 }),
      T(2, 0),
      FUNDS,
    );

    expect(result.replies).toHaveLength(1);
    expect(result.replies[0].fundsGranted).toBe(200);
    expect(balance(result.ledger)).toBe(700); // 500 start + 200 grant
    expect(result.lastFundsGrant).toEqual(T(2, 0));
    expect(result.events).toHaveLength(1);
    expect(result.events[0].kind).toBe('cable');
  });

  it('caps the grant at the preset cap', () => {
    const pending = submitCable({ kind: 'funds' }, T(0, 0), { delayPhases: 4 });
    // Standing 100 => base * 11 = 1100, capped to 1000.
    const result = processDueCables(
      station([pending], { standing: 100 }),
      T(1, 0),
      FUNDS,
    );
    expect(result.replies[0].fundsGranted).toBe(DEFAULT_FUNDS_CAP);
  });

  it('grants nothing inside the two-day cooldown', () => {
    const pending = submitCable({ kind: 'funds' }, T(1, 0), { delayPhases: 4 });
    const result = processDueCables(
      station([pending], { standing: 10, lastFundsGrant: T(1, 0) }),
      T(2, 0), // one day after the last grant: still inside the 2-day cooldown
      FUNDS,
    );
    expect(result.replies[0].fundsGranted).toBe(0);
    expect(result.replies[0].didGrantFunds).toBe(false);
    expect(balance(result.ledger)).toBe(500); // untouched
    expect(result.lastFundsGrant).toEqual(T(1, 0)); // unchanged
    // The reply still arrives as a cable event.
    expect(result.events).toHaveLength(1);
  });

  it('honours a smaller requested amount', () => {
    const pending = submitCable({ kind: 'funds', amount: 50 }, T(0, 0), {
      delayPhases: 4,
    });
    const result = processDueCables(
      station([pending], { standing: 10 }),
      T(1, 0),
      FUNDS,
    );
    expect(result.replies[0].fundsGranted).toBe(50);
  });
});

describe('processDueCables — a report cable', () => {
  it('adjusts Standing and emits a cable event', () => {
    const pending = submitCable({ kind: 'report', body: 'situation report' }, T(0, 0), {
      delayPhases: 4,
    });
    const result = processDueCables(
      station([pending], { standing: 2 }),
      T(1, 0),
      FUNDS,
    );
    expect(result.standing).toBe(3); // +REPORT_STANDING_DELTA
    expect(result.events[0].kind).toBe('cable');
    expect(balance(result.ledger)).toBe(500); // no money move
  });

  it('leaves Standing unchanged when the report is empty', () => {
    const pending = submitCable({ kind: 'report', body: '   ' }, T(0, 0), {
      delayPhases: 4,
    });
    expect(pending.reply).toEqual({ kind: 'report', standingDelta: 0 });
    const result = processDueCables(
      station([pending], { standing: 2 }),
      T(1, 0),
      FUNDS,
    );
    expect(result.standing).toBe(2);
  });
});

describe('processDueCables — a trace cable', () => {
  it('replies after the delay carrying the Dossier target and a cable event', () => {
    const pending = submitCable({ kind: 'trace', target: 'unk:3' }, T(0, 0), {
      delayPhases: 4,
    });
    const result = processDueCables(station([pending]), T(1, 0), FUNDS);

    expect(result.replies).toHaveLength(1);
    expect(result.replies[0].traceTarget).toBe('unk:3');
    expect(result.events[0].kind).toBe('cable');
    expect(result.standing).toBe(0); // trace does not move standing
    expect(balance(result.ledger)).toBe(500); // trace does not move money
  });
});

describe('fundsGrantAmount / fundsCooldownElapsed', () => {
  it('scales by Standing and clamps to [0, cap]', () => {
    expect(fundsGrantAmount(0, undefined, 100, 1000)).toBe(100);
    expect(fundsGrantAmount(10, undefined, 100, 1000)).toBe(200);
    expect(fundsGrantAmount(100, undefined, 100, 1000)).toBe(1000); // capped
    expect(fundsGrantAmount(-20, undefined, 100, 1000)).toBe(0); // never negative
  });

  it('elapses only after the cooldown days', () => {
    expect(fundsCooldownElapsed(T(5), undefined)).toBe(true);
    expect(fundsCooldownElapsed(T(1), T(0))).toBe(false);
    expect(fundsCooldownElapsed(T(FUNDS_COOLDOWN_DAYS), T(0))).toBe(true);
  });
});

describe('processDueCables — determinism (Req 1.2)', () => {
  it('is a pure function of its inputs', () => {
    const requestArb: fc.Arbitrary<CableRequest> = fc.oneof(
      fc.record({
        kind: fc.constant<'trace'>('trace'),
        target: fc.constantFrom('npc:ana', 'unk:1'),
      }),
      fc.record({
        kind: fc.constant<'funds'>('funds'),
        amount: fc.option(fc.integer({ min: 0, max: 2000 }), { nil: undefined }),
      }),
      fc.record({
        kind: fc.constant<'report'>('report'),
        body: fc.string(),
      }),
    );

    fc.assert(
      fc.property(
        fc.array(requestArb, { maxLength: 5 }),
        fc.double({ min: -50, max: 200, noNaN: true, noDefaultInfinity: true }),
        fc.integer({ min: 0, max: 20 }),
        (requests, standing, nowDay) => {
          const pendings = requests.map((r, i) =>
            submitCable(r, T(0, 0), { delayPhases: i }),
          );
          const now = T(nowDay);
          const base: Ledger = createLedger(1000);
          const slice: CableStationSlice = {
            pendingCables: pendings,
            standing,
            ledger: base,
          };
          const a = processDueCables(slice, now, FUNDS);
          const b = processDueCables(slice, now, FUNDS);
          expect(a).toEqual(b);
          // The still-pending set plus the delivered replies cover every cable.
          expect(a.pendingCables.length + a.replies.length).toBe(pendings.length);
          for (const e of a.events) {
            expect(e.kind).toBe('cable');
            expect(e.visibility).toBe('player');
          }
        },
      ),
    );
  });
});

/**
 * Tests for mole report ingestion (task 19.3, `dailyTick` step 3; Requirement
 * 12.4).
 *
 * These pin:
 *
 * - a mole report folds the Station's known/suspected Propositions into belief
 *   adoption and emits a `mole-report` summary plus a `belief-adopted` per newly
 *   adopted Proposition;
 * - an already-held belief is not re-adopted and emits no `belief-adopted`;
 * - a mole that relays nothing still emits the `mole-report` summary;
 * - no mole in play (`undefined` report) is a clean no-op;
 * - the newly-adopted list and the events are deterministic regardless of the
 *   caller's Proposition ordering.
 */

import { describe, expect, it } from 'vitest';

import type { EntityId, GameTime, NpcId, Proposition } from '../model/core.js';
import { adoptBelief, emptyHostileBeliefs } from './beliefs.js';
import { ingestMoleReport, type MoleReport } from './mole-report.js';

const AT: GameTime = { day: 4, phase: 1 };
const MOLE = 'npc:mole' as NpcId;

/** A `KNOWS(station, object)` Proposition the Station is projected to know. */
function knows(object: string, id = `p:${object}`): Proposition {
  return {
    id,
    subject: 'org:station' as EntityId,
    predicate: 'core/KNOWS',
    object: object as EntityId,
  };
}

describe('ingestMoleReport', () => {
  it('adopts each relayed Proposition and emits mole-report + belief-adopted', () => {
    const report: MoleReport = {
      mole: MOLE,
      propositions: [knows('npc:cell-lead'), knows('npc:target')],
    };
    const result = ingestMoleReport(emptyHostileBeliefs(), report, AT);

    // Both Propositions were newly adopted into the belief model.
    expect(result.beliefs.adopted).toHaveLength(2);
    expect(result.adopted).toHaveLength(2);

    // One mole-report summary, then one belief-adopted per newly adopted belief.
    const kinds = result.events.map((e) => e.kind);
    expect(kinds).toEqual(['mole-report', 'belief-adopted', 'belief-adopted']);
    expect(result.events.every((e) => e.visibility === 'hidden')).toBe(true);

    const summary = result.events[0];
    if (summary.kind !== 'mole-report') throw new Error('expected mole-report');
    expect(summary.summary).toContain('npc:mole');
    expect(summary.summary).toContain('adopted:2');
  });

  it('does not re-adopt an already-held belief and emits no belief-adopted for it', () => {
    const held = adoptBelief(emptyHostileBeliefs(), knows('npc:cell-lead')).beliefs;
    const report: MoleReport = {
      mole: MOLE,
      // One already-held belief, one new one.
      propositions: [knows('npc:cell-lead'), knows('npc:target')],
    };
    const result = ingestMoleReport(held, report, AT);

    expect(result.adopted).toHaveLength(1);
    expect(result.beliefs.adopted).toHaveLength(2); // the held one plus the new one
    const kinds = result.events.map((e) => e.kind);
    expect(kinds).toEqual(['mole-report', 'belief-adopted']);
  });

  it('emits only the mole-report summary when the mole relays nothing new', () => {
    const result = ingestMoleReport(
      emptyHostileBeliefs(),
      { mole: MOLE, propositions: [] },
      AT,
    );
    expect(result.adopted).toHaveLength(0);
    expect(result.events.map((e) => e.kind)).toEqual(['mole-report']);
  });

  it('is a clean no-op when no mole is in play', () => {
    const beliefs = emptyHostileBeliefs();
    const result = ingestMoleReport(beliefs, undefined, AT);
    expect(result.beliefs).toBe(beliefs);
    expect(result.adopted).toHaveLength(0);
    expect(result.events).toHaveLength(0);
  });

  it('is deterministic and independent of the caller`s Proposition order', () => {
    const a = knows('npc:a');
    const b = knows('npc:b');
    const first = ingestMoleReport(
      emptyHostileBeliefs(),
      { mole: MOLE, propositions: [a, b] },
      AT,
    );
    const second = ingestMoleReport(
      emptyHostileBeliefs(),
      { mole: MOLE, propositions: [b, a] },
      AT,
    );
    expect(second).toEqual(first);
  });

  it('dedupes a Proposition repeated within one report', () => {
    const result = ingestMoleReport(
      emptyHostileBeliefs(),
      { mole: MOLE, propositions: [knows('npc:a'), knows('npc:a', 'p:dup')] },
      AT,
    );
    expect(result.adopted).toHaveLength(1);
    expect(result.events.map((e) => e.kind)).toEqual(['mole-report', 'belief-adopted']);
  });
});

/**
 * Tests for filing surveillance / follow observations into the Case File
 * (task 11.3; Requirements 23.3, 23.6, 23.7).
 *
 * `addSurveillanceClaims` takes the Player-View-safe result of a watch — the
 * watched Location, the observed Propositions, and the observation time — and
 * records one Case File Claim per Proposition, each sourced
 * `{ kind: 'surveillance', loc }`. These tests pin:
 *
 * - one Claim per observed Proposition, each with the surveillance source and
 *   the given observedAt, and the Claims appear in the Case File;
 * - the per-source history groups them under the watched Location;
 * - a `unk:`-id Proposition is recorded as-is (identity resolution is the Case
 *   File's job, off a held IS_ALIAS_OF Claim);
 * - an empty watch (observed nobody) adds nothing;
 * - a property: for any Proposition list, the count of Claims added equals the
 *   list length and every Claim carries the surveillance source.
 *
 * The test builds a plain CaseFile and feeds it a result. It never touches
 * Truth: a surveillance Observation is true at its observed time in the engine,
 * but the recorded Claim carries only the Player-View shape.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { GameTime, LocId, Proposition } from '@tradecraft/engine';

import { CaseFile } from './casefile.js';
import {
  addSurveillanceClaims,
  surveillanceSource,
  type SurveillanceResult,
} from './surveillance-claims.js';

const LOC: LocId = 'loc:cafe';
const OBSERVED_AT: GameTime = { day: 2, phase: 1 };

/** A sighting and a contact a watch observed (Player-View shape). */
function observed(): Proposition[] {
  return [
    {
      id: 'surveil:located:npc:viktor@loc:cafe:2.1',
      subject: 'npc:viktor',
      predicate: 'LOCATED_AT',
      object: 'npc:viktor',
      place: LOC,
      window: { from: OBSERVED_AT },
    },
    {
      id: 'surveil:meets:npc:viktor+unk:1@loc:cafe:2.1',
      subject: 'npc:viktor',
      predicate: 'MEETS_AT',
      object: 'unk:1',
      place: LOC,
      window: { from: OBSERVED_AT },
    },
  ];
}

function result(overrides: Partial<SurveillanceResult> = {}): SurveillanceResult {
  return {
    loc: LOC,
    propositions: observed(),
    observedAt: OBSERVED_AT,
    ...overrides,
  };
}

describe('surveillanceSource', () => {
  it('builds a surveillance-kind ClaimSource for a Location id', () => {
    expect(surveillanceSource(LOC)).toEqual({ kind: 'surveillance', loc: LOC });
  });
});

describe('addSurveillanceClaims (Req 23.3)', () => {
  it('adds one Claim per observed Proposition, sourced surveillance', () => {
    const caseFile = new CaseFile();
    const claims = addSurveillanceClaims(caseFile, result());

    expect(claims).toHaveLength(2);
    expect(caseFile.size).toBe(2);
    for (const claim of claims) {
      expect(claim.source).toEqual({ kind: 'surveillance', loc: LOC });
      expect(claim.observedAt).toEqual(OBSERVED_AT);
    }
    expect(claims.map((c) => c.prop.predicate)).toEqual(['LOCATED_AT', 'MEETS_AT']);
  });

  it('the Claims appear in the Case File and in the source history', () => {
    const caseFile = new CaseFile();
    const claims = addSurveillanceClaims(caseFile, result());

    for (const claim of claims) {
      expect(caseFile.has(claim.id)).toBe(true);
    }
    const history = caseFile.sourceHistory({ kind: 'surveillance', loc: LOC });
    expect(history).toBeDefined();
    expect(history?.claims).toHaveLength(2);
    expect(history?.source).toEqual({ kind: 'surveillance', loc: LOC });
  });

  it('records a unk-id Proposition as-is', () => {
    const caseFile = new CaseFile();
    const claims = addSurveillanceClaims(caseFile, result());
    const meets = claims.find((c) => c.prop.predicate === 'MEETS_AT');
    expect(meets?.prop.object).toBe('unk:1');
  });

  it('adds nothing for an empty watch', () => {
    const caseFile = new CaseFile();
    const claims = addSurveillanceClaims(caseFile, result({ propositions: [] }));
    expect(claims).toEqual([]);
    expect(caseFile.size).toBe(0);
  });
});

describe('addSurveillanceClaims — property', () => {
  it('adds exactly one surveillance-sourced Claim per Proposition', () => {
    const propArb = fc.record({
      id: fc.string({ minLength: 1 }).map((s) => `p:${s}`),
      subject: fc.constant('npc:a' as const),
      predicate: fc.constant('LOCATED_AT' as const),
      object: fc.constant('npc:a' as const),
      place: fc.constant(LOC),
    });
    fc.assert(
      fc.property(fc.array(propArb), (props) => {
        const caseFile = new CaseFile();
        const claims = addSurveillanceClaims(caseFile, {
          loc: LOC,
          propositions: props as Proposition[],
          observedAt: OBSERVED_AT,
        });
        expect(claims).toHaveLength(props.length);
        for (const claim of claims) {
          expect(claim.source).toEqual({ kind: 'surveillance', loc: LOC });
        }
      }),
    );
  });
});

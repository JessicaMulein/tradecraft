/**
 * Tests for filing a verified Intercept break into the Case File (task 8.4;
 * Requirement 9.5).
 *
 * `addInterceptClaims` takes the Player-View-safe result of a correct Intercept
 * decryption — the recovered Propositions, the Intercept id and the observation
 * time — and records one Case File Claim per Proposition, each sourced
 * `{ kind: 'intercept', id }`. These tests pin:
 *
 * - one Claim per recovered Proposition, each with the intercept source and the
 *   given observedAt, and the Claims appear in the Case File;
 * - the per-source history groups them under the Intercept;
 * - an empty break adds nothing;
 * - calling twice appends again (the Case File's own append semantics), and the
 *   duplicates corroborate under Requirement 7.4.
 *
 * The test builds a plain CaseFile and feeds it a verification result. It never
 * touches Truth: the Propositions are built directly as the Player-View shape.
 */

import { describe, expect, it } from 'vitest';
import type { GameTime, InterceptId, Proposition } from '@tradecraft/engine';

import { CaseFile } from './casefile.js';
import {
  addInterceptClaims,
  interceptSource,
  type InterceptBreak,
} from './intercept-claims.js';

const INTERCEPT_ID = 'int:tx-1' as InterceptId;
const OBSERVED_AT: GameTime = { day: 4, phase: 2 };

/** The two Propositions a correct break recovered (Player-View shape). */
function recovered(): Proposition[] {
  return [
    {
      id: 'p:0:0',
      subject: 'npc:ana',
      predicate: 'MEETS_AT',
      object: 'npc:boris',
      place: 'loc:cafe',
      window: { from: { day: 2, phase: 1 } },
    },
    {
      id: 'p:0:1',
      subject: 'npc:boris',
      predicate: 'USES_CHANNEL',
      object: 'chan:a',
    },
  ];
}

function brk(overrides: Partial<InterceptBreak> = {}): InterceptBreak {
  return {
    interceptId: INTERCEPT_ID,
    propositions: recovered(),
    observedAt: OBSERVED_AT,
    ...overrides,
  };
}

describe('interceptSource', () => {
  it('builds an intercept-kind ClaimSource for an Intercept id', () => {
    expect(interceptSource(INTERCEPT_ID)).toEqual({
      kind: 'intercept',
      id: INTERCEPT_ID,
    });
  });
});

describe('addInterceptClaims (Req 9.5)', () => {
  it('adds one Claim per recovered Proposition, sourced intercept', () => {
    const caseFile = new CaseFile();
    const claims = addInterceptClaims(caseFile, brk());

    expect(claims).toHaveLength(2);
    expect(caseFile.size).toBe(2);
    for (const claim of claims) {
      expect(claim.source).toEqual({ kind: 'intercept', id: INTERCEPT_ID });
      expect(claim.observedAt).toEqual(OBSERVED_AT);
    }
    // The Propositions are recorded in order.
    expect(claims.map((c) => c.prop.predicate)).toEqual([
      'MEETS_AT',
      'USES_CHANNEL',
    ]);
    expect(claims.map((c) => c.prop.id)).toEqual(['p:0:0', 'p:0:1']);
  });

  it('the Claims appear in the Case File and in the source history', () => {
    const caseFile = new CaseFile();
    const claims = addInterceptClaims(caseFile, brk());

    for (const claim of claims) {
      expect(caseFile.has(claim.id)).toBe(true);
    }
    const history = caseFile.sourceHistory({
      kind: 'intercept',
      id: INTERCEPT_ID,
    });
    expect(history).toBeDefined();
    expect(history?.claims).toHaveLength(2);
  });

  it('adds nothing for an empty break', () => {
    const caseFile = new CaseFile();
    const claims = addInterceptClaims(caseFile, brk({ propositions: [] }));
    expect(claims).toEqual([]);
    expect(caseFile.size).toBe(0);
  });

  it('appends again when called twice (Case File append semantics)', () => {
    const caseFile = new CaseFile();
    const first = addInterceptClaims(caseFile, brk());
    const second = addInterceptClaims(caseFile, brk());

    // Four Claims total, with fresh ids each time — the Case File does not
    // dedupe, and neither does this module.
    expect(caseFile.size).toBe(4);
    const allIds = [...first, ...second].map((c) => c.id);
    expect(new Set(allIds).size).toBe(4);

    // One Intercept filed twice is still one source: repeating itself does
    // not corroborate (Requirement 7.4 needs independent origins).
    for (const claim of caseFile.list()) {
      expect(claim.relation).toBe('none');
    }
  });
});

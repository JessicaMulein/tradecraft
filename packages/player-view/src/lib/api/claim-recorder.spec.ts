/**
 * Tests for the claim recorder (slice-integration task 7.2; Requirements 8.4,
 * 10.3).
 *
 * `recordObservationClaims` takes the Player-View-safe result of an action — the
 * Case File and the action's Observations — and records each `proposition`
 * Observation as a Case File Claim under the `ClaimSource` matching its engine
 * `ObservationSource`, routing through the four claim modules. These tests pin:
 *
 * - each of the four source kinds lands a Claim with the matching `ClaimSource`
 *   in the Case File, filed through the right module (checked via the per-source
 *   history the module feeds);
 * - the source copies across one to one (same field names: `loc`, `id`, `npc`);
 * - the returned ids match the recorded Claims, in Observation order;
 * - `message` Observations are skipped (they carry no Proposition);
 * - re-recording an already-filed Claim is idempotent *because the action
 *   reports no Proposition Observations the second time* — a broken Intercept
 *   decrypted twice yields nothing, so a second record adds nothing.
 *
 * The test builds Observations directly as the Player-View shape, as the
 * casefile module specs do; it never touches the Truth Store.
 */

import { describe, expect, it } from 'vitest';
import type {
  DocId,
  GameTime,
  InterceptId,
  LocId,
  NpcId,
  Observation,
  Proposition,
} from '@tradecraft/engine';

import { CaseFile } from '../casefile/casefile.js';
import { recordObservationClaims } from './claim-recorder.js';

const AT: GameTime = { day: 3, phase: 1 };

/** A plain Proposition in the Player-View shape, parameterised by id. */
function prop(id: string, predicate = 'MEETS_AT'): Proposition {
  return {
    id,
    subject: 'npc:ana',
    predicate,
    object: 'npc:boris',
    place: 'loc:cafe',
    window: { from: { day: 2, phase: 1 } },
  };
}

function surveillanceObs(loc: LocId, p: Proposition): Observation {
  return { kind: 'proposition', prop: p, at: AT, source: { kind: 'surveillance', loc } };
}
function documentObs(id: DocId, p: Proposition): Observation {
  return { kind: 'proposition', prop: p, at: AT, source: { kind: 'document', id } };
}
function interceptObs(id: InterceptId, p: Proposition): Observation {
  return { kind: 'proposition', prop: p, at: AT, source: { kind: 'intercept', id } };
}
function npcObs(npc: NpcId, p: Proposition): Observation {
  return { kind: 'proposition', prop: p, at: AT, source: { kind: 'npc', npc } };
}

describe('recordObservationClaims (Req 8.4, 10.3)', () => {
  it('files a surveillance Observation under the surveillance source', () => {
    const caseFile = new CaseFile();
    const loc = 'loc:cafe' as LocId;
    const ids = recordObservationClaims(caseFile, [
      surveillanceObs(loc, prop('p:s')),
    ]);

    expect(ids).toHaveLength(1);
    const claim = caseFile.get(ids[0]);
    expect(claim?.source).toEqual({ kind: 'surveillance', loc });
    expect(claim?.observedAt).toEqual(AT);
    // Filed through the surveillance module → it groups under that source.
    expect(caseFile.sourceHistory({ kind: 'surveillance', loc })?.claims).toHaveLength(1);
  });

  it('files a document Observation under the document source', () => {
    const caseFile = new CaseFile();
    const id = 'doc:dossier-1' as DocId;
    const ids = recordObservationClaims(caseFile, [documentObs(id, prop('p:d'))]);

    expect(ids).toHaveLength(1);
    expect(caseFile.get(ids[0])?.source).toEqual({ kind: 'document', id });
    expect(caseFile.sourceHistory({ kind: 'document', id })?.claims).toHaveLength(1);
  });

  it('files an intercept Observation under the intercept source (Req 8.4)', () => {
    const caseFile = new CaseFile();
    const id = 'int:tx-1' as InterceptId;
    const ids = recordObservationClaims(caseFile, [interceptObs(id, prop('p:i'))]);

    expect(ids).toHaveLength(1);
    expect(caseFile.get(ids[0])?.source).toEqual({ kind: 'intercept', id });
    expect(caseFile.sourceHistory({ kind: 'intercept', id })?.claims).toHaveLength(1);
  });

  it('files an npc Observation under the npc source naming the Asset (Req 10.3)', () => {
    const caseFile = new CaseFile();
    const npc = 'npc:viktor' as NpcId;
    const ids = recordObservationClaims(caseFile, [npcObs(npc, prop('p:n'))]);

    expect(ids).toHaveLength(1);
    expect(caseFile.get(ids[0])?.source).toEqual({ kind: 'npc', npc });
    expect(caseFile.sourceHistory({ kind: 'npc', npc })?.claims).toHaveLength(1);
  });

  it('records a mixed batch in order and returns the recorded Claim ids', () => {
    const caseFile = new CaseFile();
    const loc = 'loc:cafe' as LocId;
    const doc = 'doc:1' as DocId;
    const int = 'int:1' as InterceptId;
    const npc = 'npc:ana' as NpcId;

    const ids = recordObservationClaims(caseFile, [
      surveillanceObs(loc, prop('p:0')),
      documentObs(doc, prop('p:1')),
      interceptObs(int, prop('p:2')),
      npcObs(npc, prop('p:3')),
    ]);

    expect(ids).toHaveLength(4);
    expect(caseFile.size).toBe(4);
    // Returned ids match the Observation order, by their recorded Propositions.
    expect(ids.map((id) => caseFile.get(id)?.prop.id)).toEqual([
      'p:0',
      'p:1',
      'p:2',
      'p:3',
    ]);
    // Each landed under its own source kind.
    expect(caseFile.get(ids[0])?.source.kind).toBe('surveillance');
    expect(caseFile.get(ids[1])?.source.kind).toBe('document');
    expect(caseFile.get(ids[2])?.source.kind).toBe('intercept');
    expect(caseFile.get(ids[3])?.source.kind).toBe('npc');
  });

  it('skips message Observations (no Proposition, no Claim)', () => {
    const caseFile = new CaseFile();
    const loc = 'loc:cafe' as LocId;
    const ids = recordObservationClaims(caseFile, [
      { kind: 'message', line: 'You may have been made.' },
      surveillanceObs(loc, prop('p:only')),
    ]);

    expect(ids).toHaveLength(1);
    expect(caseFile.size).toBe(1);
    expect(caseFile.get(ids[0])?.prop.id).toBe('p:only');
  });

  it('records nothing for an empty Observation list', () => {
    const caseFile = new CaseFile();
    expect(recordObservationClaims(caseFile, [])).toEqual([]);
    expect(caseFile.size).toBe(0);
  });

  it('is idempotent when the action reports no Observations the second time', () => {
    // A broken Intercept decrypted twice: the first decrypt reports the
    // recovered Propositions; the second reports none (the engine returns no
    // Proposition Observations on an already-broken Intercept). So re-running
    // the recorder on the second, empty result adds nothing (Req 8.6).
    const caseFile = new CaseFile();
    const id = 'int:tx-1' as InterceptId;

    const first = recordObservationClaims(caseFile, [interceptObs(id, prop('p:a'))]);
    expect(first).toHaveLength(1);
    expect(caseFile.size).toBe(1);

    const second = recordObservationClaims(caseFile, []);
    expect(second).toEqual([]);
    expect(caseFile.size).toBe(1);
  });
});

/**
 * Tests for filing a read Document's assertions into the Case File (task 9.2;
 * Requirements 30.3, 30.4).
 *
 * `addDocumentClaims` takes the Player-View-safe result of a first read — the
 * Document id, the Propositions it asserted, and the observation time — and
 * records one Case File Claim per Proposition, each sourced
 * `{ kind: 'document', id }`. These tests pin:
 *
 * - one Claim per asserted Proposition, each with the document source and the
 *   given observedAt, and the Claims appear in the Case File;
 * - the per-source history groups them under the Document;
 * - an empty read (a Document that asserts nothing, or a repeat read) adds
 *   nothing.
 *
 * The test builds a plain CaseFile and feeds it a read result. It never touches
 * Truth: the Propositions are built directly as the Player-View shape (a
 * Document's assertions are leads, not facts).
 */

import { describe, expect, it } from 'vitest';
import type { DocId, GameTime, Proposition } from '@tradecraft/engine';

import { CaseFile } from './casefile.js';
import {
  addDocumentClaims,
  documentSource,
  type DocumentRead,
} from './document-claims.js';

const DOC_ID = 'doc:cable/hq-0001' as DocId;
const OBSERVED_AT: GameTime = { day: 1, phase: 0 };

/** The two Propositions a brief Cable asserted (Player-View shape). */
function asserted(): Proposition[] {
  return [
    {
      id: 'p:brief:0',
      subject: 'npc:viktor',
      predicate: 'WORKS_FOR',
      object: 'org:cell',
    },
    {
      id: 'p:brief:1',
      subject: 'npc:ana',
      predicate: 'MEETS_AT',
      object: 'npc:viktor',
      place: 'loc:cafe',
      window: { from: { day: 1, phase: 1 } },
    },
  ];
}

function read(overrides: Partial<DocumentRead> = {}): DocumentRead {
  return {
    docId: DOC_ID,
    propositions: asserted(),
    observedAt: OBSERVED_AT,
    ...overrides,
  };
}

describe('documentSource', () => {
  it('builds a document-kind ClaimSource for a Document id', () => {
    expect(documentSource(DOC_ID)).toEqual({ kind: 'document', id: DOC_ID });
  });
});

describe('addDocumentClaims (Req 30.3)', () => {
  it('adds one Claim per asserted Proposition, sourced document', () => {
    const caseFile = new CaseFile();
    const claims = addDocumentClaims(caseFile, read());

    expect(claims).toHaveLength(2);
    expect(caseFile.size).toBe(2);
    for (const claim of claims) {
      expect(claim.source).toEqual({ kind: 'document', id: DOC_ID });
      expect(claim.observedAt).toEqual(OBSERVED_AT);
    }
    // The Propositions are recorded in the Document's assert order.
    expect(claims.map((c) => c.prop.id)).toEqual(['p:brief:0', 'p:brief:1']);
    expect(claims.map((c) => c.prop.predicate)).toEqual(['WORKS_FOR', 'MEETS_AT']);
  });

  it('the Claims appear in the Case File and in the source history', () => {
    const caseFile = new CaseFile();
    const claims = addDocumentClaims(caseFile, read());

    for (const claim of claims) {
      expect(caseFile.has(claim.id)).toBe(true);
    }
    const history = caseFile.sourceHistory({ kind: 'document', id: DOC_ID });
    expect(history).toBeDefined();
    expect(history?.claims).toHaveLength(2);
    expect(history?.source).toEqual({ kind: 'document', id: DOC_ID });
  });

  it('adds nothing for an empty read (no assertions / repeat read)', () => {
    const caseFile = new CaseFile();
    const claims = addDocumentClaims(caseFile, read({ propositions: [] }));
    expect(claims).toEqual([]);
    expect(caseFile.size).toBe(0);
  });
});

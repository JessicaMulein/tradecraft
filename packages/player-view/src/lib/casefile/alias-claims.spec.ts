/**
 * Tests for filing an identification's `IS_ALIAS_OF` Claim into the Case File
 * (task 11.2; Requirements 23.5, 7.4).
 *
 * These build a view-safe {@link AliasClaimReport} (as the engine's `identify`
 * reports) and check:
 *
 * - `addAliasClaim` records an `IS_ALIAS_OF(unk, npc)` Claim, sourced to match
 *   the trigger (a Dossier -> `document`, an introduction / Asset report ->
 *   `npc`);
 * - the Case File's own alias resolver ({@link aliasClasses}) then unions the
 *   `unk:` id and the `npc:` id — the People-view merge (Requirement 7.4).
 */

import { describe, expect, it } from 'vitest';

import type {
  AliasClaimReport,
  GameTime,
  NpcId,
  Proposition,
  UnkId,
} from '@tradecraft/engine';

import { CaseFile } from './casefile.js';
import { aliasClasses } from './evidence.js';
import { addAliasClaim, aliasClaimLink, aliasClaimSource } from './alias-claims.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const T: GameTime = { day: 2, phase: 1 };
const UNK: UnkId = 'unk:3';
const VIKTOR: NpcId = 'npc:viktor';

/** The `IS_ALIAS_OF(unk, npc)` Proposition an identification reports. */
function aliasProp(unk: UnkId, npc: NpcId): Proposition {
  return {
    id: `alias:${unk}->${npc}`,
    subject: unk,
    predicate: 'IS_ALIAS_OF',
    object: npc,
  };
}

/** A dossier-triggered identification report (source: a Document). */
function dossierReport(): AliasClaimReport {
  return {
    unk: UNK,
    npc: VIKTOR,
    prop: aliasProp(UNK, VIKTOR),
    trigger: 'dossier',
    sourceId: 'doc:dossier/viktor' as never,
    observedAt: T,
  };
}

/** An introduction-triggered identification report (source: the NPC). */
function introductionReport(): AliasClaimReport {
  return {
    unk: UNK,
    npc: VIKTOR,
    prop: aliasProp(UNK, VIKTOR),
    trigger: 'introduction',
    sourceId: VIKTOR,
    observedAt: T,
  };
}

// ---------------------------------------------------------------------------
// addAliasClaim — records the Claim with the right source (Req 23.5)
// ---------------------------------------------------------------------------

describe('addAliasClaim — records an IS_ALIAS_OF Claim (Req 23.5)', () => {
  it('files a dossier identification as a document-sourced Claim', () => {
    const cf = new CaseFile();
    const report = dossierReport();

    const claim = addAliasClaim(cf, report);

    expect(claim.prop.predicate).toBe('IS_ALIAS_OF');
    expect(claim.prop.subject).toBe(UNK);
    expect(claim.prop.object).toBe(VIKTOR);
    expect(claim.observedAt).toEqual(T);
    expect(claim.source).toEqual({ kind: 'document', id: 'doc:dossier/viktor' });
    expect(cf.size).toBe(1);
  });

  it('files a face-to-face introduction as an npc-sourced Claim', () => {
    const cf = new CaseFile();
    const claim = addAliasClaim(cf, introductionReport());
    expect(claim.source).toEqual({ kind: 'npc', npc: VIKTOR });
  });

  it('aliasClaimSource picks document for dossier and npc otherwise', () => {
    expect(aliasClaimSource(dossierReport())).toEqual({
      kind: 'document',
      id: 'doc:dossier/viktor',
    });
    expect(aliasClaimSource(introductionReport())).toEqual({
      kind: 'npc',
      npc: VIKTOR,
    });
    expect(aliasClaimLink(dossierReport())).toEqual([UNK, VIKTOR]);
  });
});

// ---------------------------------------------------------------------------
// People-view merge: aliasClasses unions unk and npc (Req 7.4)
// ---------------------------------------------------------------------------

describe('aliasClasses — the People-view merge (Req 7.4)', () => {
  it('unions the unk and the npc once the IS_ALIAS_OF Claim is filed', () => {
    const cf = new CaseFile();

    // Before filing, the two ids are in separate alias classes.
    const before = aliasClasses(cf);
    expect(before(UNK)).toBe(UNK);
    expect(before(VIKTOR)).toBe(VIKTOR);

    addAliasClaim(cf, dossierReport());

    // After filing, they share a representative — the two are merged.
    const after = aliasClasses(cf);
    expect(after(UNK)).toBe(after(VIKTOR));
  });
});

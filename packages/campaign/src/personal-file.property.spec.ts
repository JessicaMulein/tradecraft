/**
 * Property 7: for any Player Carry history and any two placement sets, the
 * Personal File is byte-identical, and every proposition it asserts is a
 * claim held in that history.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { campaignContent } from './content/library.js';
import { campaignSources, loadCampaignContent } from './content/load.js';
import { personalFile, type PersonalFileSources } from './personal-file.js';
import type { CampaignPersonId, CarryClaim, PlayerCarry } from './state.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CORE = join(ROOT, 'packages', 'content', 'packs', 'core');

const loaded = loadCampaignContent([CORE], ['core']);
if (!loaded.ok) {
  throw new Error(loaded.errors.map((error) => error.message).join('; '));
}
const content = campaignContent(loaded.value, campaignSources([CORE], new Set(['core'])).sources);

const personNo = fc.integer({ min: 1, max: 8 });
const name = fc.stringMatching(/^[A-Z][a-z]{2,7}$/);

const placement = fc.record({
  person: personNo.map((n): CampaignPersonId => `cp-${n}`),
  as: fc.constantFrom('asset', 'handed-over', 'recogniser', 'nemesis', 'arc', 'hq-visitor'),
  contact: fc.boolean(),
  optional: fc.boolean(),
  priority: fc.integer({ min: 0, max: 9 }),
  city: fc.constantFrom('core', 'lisbon', 'away'),
});

const claimArb: fc.Arbitrary<CarryClaim> = fc
  .record({
    id: fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/),
    predicate: fc.constantFrom('MEMBER_OF', 'WORKS_FOR', 'IS_ALIAS_OF', 'KNOWS', 'MEETS_AT'),
    subject: personNo,
    objectKind: fc.constantFrom('org', 'person'),
    objectPerson: personNo,
    relation: fc.constantFrom('none', 'corroborated', 'conflicted'),
  })
  .map((value) => ({
    id: value.id,
    prop: {
      id: `prop-${value.id}`,
      subject: `npc:cp-${value.subject}` as const,
      predicate: value.predicate,
      object:
        value.objectKind === 'org'
          ? (`org:station-${value.objectPerson}` as const)
          : (`npc:cp-${value.objectPerson}` as const),
    },
    text: value.id,
    relation: value.relation,
  }));

const carryArb: fc.Arbitrary<PlayerCarry> = fc.record({
  identified: fc.array(
    fc.record({
      person: personNo.map((n): CampaignPersonId => `cp-${n}`),
      name,
      aliases: fc.array(name, { maxLength: 2 }),
      apparentAffiliation: fc.option(name, { nil: undefined }),
    }),
    { maxLength: 4 },
  ),
  unidentified: fc.array(
    fc.record({
      person: fc.stringMatching(/^unk-[a-z]{1,4}$/),
      descriptor: name,
      sightings: fc.array(
        fc.record({
          city: fc.constantFrom('core', 'lisbon'),
          year: fc.integer({ min: 1948, max: 1962 }),
        }),
        { maxLength: 2 },
      ),
    }),
    { maxLength: 2 },
  ),
  heldClaims: fc.array(claimArb, { maxLength: 6 }),
  grades: fc.constant([]),
  notes: fc.constant([]),
  observedBurns: fc.constant([]),
});

describe('personal file provenance property', () => {
  it('is byte-identical for any two placement sets, and asserts only held claims', () => {
    // Feature: campaign-career, Property 7: Personal File provenance
    fc.assert(
      fc.property(
        fc.array(carryArb, { maxLength: 4 }),
        fc.array(placement, { maxLength: 6 }),
        fc.array(placement, { maxLength: 6 }),
        fc.integer({ min: 1940, max: 1970 }),
        fc.integer({ min: 0, max: 6 }),
        (carries, leftPlacements, rightPlacements, year, personalFileMax) => {
          const sources: PersonalFileSources = {
            texts: content.texts,
            epochs: content.epochs,
            predicates: content.set.predicates,
            year,
            personalFileMax,
          };
          const left = personalFile(carries, leftPlacements, sources);
          const right = personalFile(carries, rightPlacements, sources);
          expect(JSON.stringify(left)).toBe(JSON.stringify(right));

          const held = new Set(
            carries.flatMap((entry) => entry.heldClaims.map((claim) => JSON.stringify(claim.prop))),
          );
          for (const prop of left.asserts) {
            expect(held.has(JSON.stringify(prop))).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

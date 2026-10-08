/**
 * The Personal File lists identified persons from Player Carry, newest first,
 * and renders only the carried membership, employment and alias claims.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { campaignContent } from './content/library.js';
import { campaignSources, loadCampaignContent } from './content/load.js';
import { personalFile, type PersonalFileSources } from './personal-file.js';
import type { CarryClaim, PlayerCarry } from './state.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CORE = join(ROOT, 'packages', 'content', 'packs', 'core');

const loaded = loadCampaignContent([CORE], ['core']);
if (!loaded.ok) {
  throw new Error(loaded.errors.map((error) => error.message).join('; '));
}
const content = campaignContent(loaded.value, campaignSources([CORE], new Set(['core'])).sources);

function sources(year: number, personalFileMax?: number): PersonalFileSources {
  return {
    texts: content.texts,
    epochs: content.epochs,
    predicates: content.set.predicates,
    year,
    ...(personalFileMax === undefined ? {} : { personalFileMax }),
  };
}

function carry(
  identified: PlayerCarry['identified'],
  heldClaims: readonly CarryClaim[] = [],
): PlayerCarry {
  return {
    identified,
    unidentified: [],
    heldClaims,
    grades: [],
    notes: [],
    observedBurns: [],
  };
}

function claim(id: string, predicate: string, subject: string, object: string): CarryClaim {
  return {
    id,
    prop: {
      id: `prop-${id}`,
      subject: subject as 'npc:cp-1',
      predicate,
      object: object as 'org:station',
    },
    text: id,
    relation: 'corroborated',
  };
}

describe('personalFile', () => {
  it('lists identified persons most recent first and keeps the newest record', () => {
    const file = personalFile(
      [
        carry([{ person: 'cp-1', name: 'Old Ada', aliases: ['A'] }]),
        carry([{ person: 'cp-2', name: 'Bea', aliases: [] }]),
        carry([
          { person: 'cp-1', name: 'Ada', aliases: ['Anna'], apparentAffiliation: 'East' },
          { person: 'cp-3', name: 'Cara', aliases: [] },
        ]),
      ],
      [],
      sources(1948, 2),
    );

    expect(file.title).toBe('Personal file');
    expect(file.body.startsWith('Your file lists the people you can name')).toBe(true);
    const ada = file.body.indexOf('\nAda\n');
    const cara = file.body.indexOf('\nCara\n');
    expect(ada).toBeGreaterThan(-1);
    expect(cara).toBeGreaterThan(ada);
    expect(file.body).toContain('Aliases: Anna');
    expect(file.body).toContain('Apparent affiliation: East');
    expect(file.body).not.toContain('Bea');
    expect(file.body).not.toContain('Old Ada');
    expect(file.body).toContain('Courier season');
    expect(file.body).not.toContain('The barrier');
  });

  it('renders membership, employment and alias claims through third-person templates', () => {
    const membership = claim('member', 'MEMBER_OF', 'npc:cp-1', 'org:station');
    const employment = claim('works', 'WORKS_FOR', 'npc:cp-1', 'org:station');
    const alias = claim('alias', 'IS_ALIAS_OF', 'npc:cp-1', 'npc:cp-2');
    const knows = claim('knows', 'KNOWS', 'npc:cp-1', 'org:station');
    const file = personalFile(
      [
        carry(
          [
            { person: 'cp-1', name: 'Greta', aliases: ['Irina'] },
            { person: 'cp-2', name: 'Otto', aliases: [] },
          ],
          [knows, membership, employment, alias],
        ),
      ],
      [],
      sources(1960, 24),
    );

    expect(file.body).toContain('Greta belongs to station.');
    expect(file.body).toContain('Greta works for station.');
    expect(file.body).toContain('Greta is the same person as Otto.');
    expect(file.body).not.toContain('KNOWS');
    expect(file.asserts).toEqual([membership.prop, employment.prop, alias.prop]);
    expect(file.body).toContain('The barrier');
    expect(file.body).not.toContain('Courier season');
  });

  it('drops claims about a person the cap leaves out', () => {
    const kept = claim('kept', 'MEMBER_OF', 'npc:cp-1', 'org:station');
    const dropped = claim('dropped', 'WORKS_FOR', 'npc:cp-2', 'org:station');
    const file = personalFile(
      [
        carry(
          [
            { person: 'cp-1', name: 'Ada', aliases: [] },
            { person: 'cp-2', name: 'Bea', aliases: [] },
          ],
          [kept, dropped],
        ),
      ],
      [],
      sources(1948, 1),
    );
    expect(file.asserts).toEqual([kept.prop]);
    expect(file.body).not.toContain('Bea');
  });

  it('is unchanged when called again with the same carry', () => {
    const carries = [carry([{ person: 'cp-1', name: 'Ada', aliases: [] }])];
    const input = sources(1952);
    expect(personalFile(carries, [], input)).toEqual(personalFile(carries, [], input));
  });
});

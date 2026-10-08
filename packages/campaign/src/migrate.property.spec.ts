/**
 * Property 24: synthetic migrations reach the latest version in order, a
 * current save stays identical, and a bad or newer save changes nothing.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { migrate, type CampaignMigration } from './save.js';

interface SyntheticSave {
  readonly version: number;
  readonly n: number;
  readonly tag: string;
}

function shape(version: number) {
  return z.object({
    version: z.literal(version),
    n: z.number().int(),
    tag: z.string(),
  });
}

function bump(document: unknown, version: number): SyntheticSave {
  const save = document as SyntheticSave;
  return { version, n: save.n + version, tag: save.tag };
}

function chain(origin: number, latest: number): Record<number, CampaignMigration> {
  const table: Record<number, CampaignMigration> = {};
  for (let version = origin; version < latest; version += 1) {
    const next = version + 1;
    table[version] = {
      from: shape(version),
      to: shape(next),
      up: (document) => bump(document, next),
    };
  }
  return table;
}

function applyAll(
  save: SyntheticSave,
  latest: number,
  table: Readonly<Record<number, CampaignMigration>>,
): SyntheticSave {
  let value: unknown = save;
  for (let version = save.version; version < latest; version += 1) {
    const step = table[version];
    if (step === undefined) {
      throw new Error(`missing migration ${version}`);
    }
    value = step.up(value);
  }
  return value as SyntheticSave;
}

describe('migration', () => {
  it('follows a synthetic chain and leaves the current game on a failed step', () => {
    // Feature: campaign-career, Property 24: Migration
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 4 }),
        fc.integer({ min: 1, max: 3 }),
        fc.integer({ min: 0, max: 3 }),
        fc.integer({ min: 0, max: 3 }),
        fc.integer({ min: -20, max: 40 }),
        fc.stringMatching(/^[a-z]{1,6}$/),
        fc.integer({ min: 1, max: 4 }),
        (origin, steps, place, breakOffset, n, tag, ahead) => {
          const latest = origin + steps;
          const version = origin + (place % (steps + 1));
          const table = chain(origin, latest);
          const save: SyntheticSave = { version, n, tag };
          const before = structuredClone(save);
          const migrated = migrate(save, latest, table);
          expect(migrated.ok).toBe(true);
          if (!migrated.ok) {
            return;
          }
          const applied = applyAll(save, latest, table);
          expect(migrated.value).toEqual(applied);
          expect(shape(latest).safeParse(migrated.value).success).toBe(true);
          expect(save).toEqual(before);

          const current: SyntheticSave = { version: latest, n, tag };
          const currentBefore = structuredClone(current);
          const same = migrate(current, latest, table);
          expect(same.ok).toBe(true);
          if (same.ok) {
            expect(same.value).toEqual(current);
          }
          expect(current).toEqual(currentBefore);

          const game = { career: 'open' };
          let playing: unknown = game;
          const newer: SyntheticSave = { version: latest + ahead, n, tag };
          const newerBefore = structuredClone(newer);
          const refused = migrate(newer, latest, table);
          if (refused.ok) {
            playing = refused.value;
          }
          expect(refused.ok).toBe(false);
          if (!refused.ok) {
            expect(refused.error).toEqual({
              kind: 'campaign-version',
              saved: latest + ahead,
              supported: latest,
            });
          }
          expect(newer).toEqual(newerBefore);
          expect(playing).toBe(game);

          const breakAt = origin + (breakOffset % steps);
          const step = table[breakAt];
          if (step === undefined) {
            throw new Error(`missing migration ${breakAt}`);
          }
          const broken: Record<number, CampaignMigration> = {
            ...table,
            [breakAt]: {
              ...step,
              to: shape(breakAt + 1).extend({ marker: z.literal('ready') }),
            },
          };
          const stalled: SyntheticSave = { version: breakAt, n, tag };
          const stalledBefore = structuredClone(stalled);
          let held: unknown = game;
          const failed = migrate(stalled, latest, broken);
          if (failed.ok) {
            held = failed.value;
          }
          expect(failed.ok).toBe(false);
          if (!failed.ok) {
            expect(failed.error.kind).toBe('migration-failed');
          }
          expect(stalled).toEqual(stalledBefore);
          expect(held).toBe(game);
        },
      ),
      { numRuns: 100 },
    );
  });
});

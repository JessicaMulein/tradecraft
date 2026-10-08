/**
 * Property 23: a reachable campaign, with or without an in-progress posting
 * snapshot, survives save and load unchanged, including its PRNG state.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { campaignContent } from './content/library.js';
import { campaignSources, loadCampaignContent } from './content/load.js';
import { quoteChoice, step } from './reducer.js';
import { loadCampaign, nodeSaveIo, saveCampaign } from './save.js';
import type { CampaignChoice, CampaignState } from './state.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CORE = join(ROOT, 'packages', 'content', 'packs', 'core');

const loaded = loadCampaignContent([CORE], ['core']);
if (!loaded.ok) {
  throw new Error(loaded.errors.map((error) => error.message).join('; '));
}
const content = campaignContent(loaded.value, campaignSources([CORE], new Set(['core'])).sources);
const manifest = loaded.value.manifest;

const backgrounds = content.backgrounds.map((background) => background.id);
const skills = content.skills.map((skill) => skill.id);
const requisitions = content.requisitions.map((item) => item.id);
if (backgrounds.length === 0) {
  throw new Error('no backgrounds');
}

type Command =
  | { readonly kind: 'accept' }
  | { readonly kind: 'advance' }
  | { readonly kind: 'leave' }
  | { readonly kind: 'adopt' }
  | { readonly kind: 'train'; readonly skill: string }
  | { readonly kind: 'requisition'; readonly id: string };

const commands: fc.Arbitrary<Command>[] = [
  fc.constant({ kind: 'accept' }),
  fc.constant({ kind: 'advance' }),
  fc.constant({ kind: 'leave' }),
  fc.constant({ kind: 'adopt' }),
];
if (skills.length > 0) {
  commands.push(fc.record({ kind: fc.constant('train'), skill: fc.constantFrom(...skills) }));
}
if (requisitions.length > 0) {
  commands.push(
    fc.record({ kind: fc.constant('requisition'), id: fc.constantFrom(...requisitions) }),
  );
}

interface EmbeddedSnapshot {
  readonly version: 3;
  readonly seed: string;
  readonly rng: readonly [number, number, number, number];
  readonly content: typeof manifest;
}

function reachable(
  seed: string,
  year: number,
  name: string,
  background: string,
  script: readonly Command[],
): CampaignState {
  const state = step(
    undefined,
    {
      kind: 'choice',
      choice: {
        kind: 'create',
        seed,
        preset: 'standard',
        officerName: name,
        background,
        startYear: year,
      },
    },
    content,
  );
  if (!state.ok) {
    throw new Error(state.error.reason);
  }
  let current = state.value;
  for (const command of script) {
    const choice = choiceOf(current, command);
    if (choice === undefined || !quoteChoice(current, choice, content).allowed) {
      continue;
    }
    const next = step(current, { kind: 'choice', choice }, content);
    if (next.ok) {
      current = next.value;
    }
  }
  return current;
}

function choiceOf(state: CampaignState, command: Command): CampaignChoice | undefined {
  if (command.kind === 'accept') {
    const offer = state.view.offers[0];
    if (offer === undefined) {
      return undefined;
    }
    return { kind: 'accept-offer', offer: offer.id };
  }
  if (command.kind === 'advance') {
    return { kind: 'advance' };
  }
  if (command.kind === 'leave') {
    return { kind: 'leave' };
  }
  if (command.kind === 'train') {
    return { kind: 'train', skill: command.skill };
  }
  if (command.kind === 'requisition') {
    return { kind: 'requisition', id: command.id };
  }
  return { kind: 'adopt-manifest', manifest };
}

describe('campaign save round-trip', () => {
  it('restores a reachable campaign and its in-progress posting snapshot', () => {
    // Feature: campaign-career, Property 23: Campaign save round-trip
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z0-9]{1,12}$/),
        fc.integer({ min: 1948, max: 1950 }),
        fc.stringMatching(/^[A-Za-z][A-Za-z]{0,12}$/),
        fc.constantFrom(...backgrounds),
        fc.array(fc.oneof(...commands), { maxLength: 6 }),
        fc.option(
          fc.record({
            version: fc.constant(3 as const),
            seed: fc.stringMatching(/^[a-z0-9]{1,12}$/),
            rng: fc.tuple(
              fc.integer({ min: 0, max: 0xffffffff }),
              fc.integer({ min: 0, max: 0xffffffff }),
              fc.integer({ min: 0, max: 0xffffffff }),
              fc.integer({ min: 0, max: 0xffffffff }),
            ),
            content: fc.constant(manifest),
          }),
          { nil: undefined },
        ),
        (seed, year, name, background, script, snapshot: EmbeddedSnapshot | undefined) => {
          const state = reachable(seed, year, name, background, script);
          const dir = mkdtempSync(join(tmpdir(), 'campaign-round-trip-'));
          try {
            const io = nodeSaveIo(dir);
            saveCampaign(io, {
              state,
              savedAt: '2026-01-01T00:00:00.000Z',
              ...(snapshot === undefined ? {} : { currentPosting: snapshot }),
            });
            const restored = loadCampaign(io, manifest);
            expect(restored.ok).toBe(true);
            if (!restored.ok) {
              return;
            }
            expect(restored.value.state).toEqual(state);
            expect(restored.value.state.rng).toEqual(state.rng);
            expect(restored.value.currentPosting).toEqual(snapshot);
          } finally {
            rmSync(dir, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

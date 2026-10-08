/**
 * Property 1: the same campaign inputs fold to the same state twice, and
 * replaying the choice log reproduces it. An accepted choice adds one log
 * entry. A rejected choice leaves the state unchanged.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { asTruth } from '@tradecraft/engine';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { loadCampaignConfig } from './config.js';
import { campaignContent } from './content/library.js';
import { campaignSources, loadCampaignContent } from './content/load.js';
import { quoteChoice, step, type CampaignInput } from './reducer.js';
import { replayCampaign } from './replay.js';
import type { CampaignChoice, CampaignState, PostingResult } from './state.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CORE = join(ROOT, 'packages', 'content', 'packs', 'core');

const loaded = loadCampaignContent([CORE], ['core']);
if (!loaded.ok) {
  throw new Error(loaded.errors.map((error) => error.message).join('; '));
}
const content = campaignContent(loaded.value, campaignSources([CORE], new Set(['core'])).sources);
const manifest = loaded.value.manifest;
const config = loadCampaignConfig(join(ROOT, 'config', 'campaign.yaml'));
if (!config.ok) {
  throw new Error(config.issues.map((issue) => issue.message).join('; '));
}

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
  | { readonly kind: 'legend' }
  | { readonly kind: 'retire' }
  | { readonly kind: 'defect' }
  | { readonly kind: 'train'; readonly skill: string }
  | { readonly kind: 'requisition'; readonly id: string }
  | { readonly kind: 'posting'; readonly index: number; readonly decrypts: number };

const commands: fc.Arbitrary<Command>[] = [
  fc.constant({ kind: 'accept' }),
  fc.constant({ kind: 'advance' }),
  fc.constant({ kind: 'leave' }),
  fc.constant({ kind: 'adopt' }),
  fc.constant({ kind: 'legend' }),
  fc.constant({ kind: 'retire' }),
  fc.constant({ kind: 'defect' }),
  fc.record({
    kind: fc.constant('posting'),
    index: fc.integer({ min: 0, max: 4 }),
    decrypts: fc.integer({ min: 0, max: 6 }),
  }),
];
if (skills.length > 0) {
  commands.push(fc.record({ kind: fc.constant('train'), skill: fc.constantFrom(...skills) }));
}
if (requisitions.length > 0) {
  commands.push(
    fc.record({ kind: fc.constant('requisition'), id: fc.constantFrom(...requisitions) }),
  );
}

function quietResult(index: number, decrypts: number): PostingResult {
  return {
    schema: 1,
    index,
    plotTemplate: 'rail-junction',
    plots: [
      {
        templateId: 'rail-junction',
        variantKey: 'rail-junction@1',
        archetype: 'sabotage',
        role: 'primary',
        outcome: 'succeeded',
      },
    ],
    stats: {
      decrypts,
      recruits: 0,
      turned: 0,
      surveilObservations: 0,
      followsCompleted: 0,
      arrestsCorrect: 0,
      arrestsWrongful: 0,
      madeFactLines: 0,
      meetingsHeld: 0,
      dropsServiced: 0,
    },
    carry: {
      identified: [],
      unidentified: [],
      heldClaims: [],
      grades: [],
      notes: [],
      observedBurns: [],
    },
    debrief: {
      full: asTruth({
        outcome: 'success',
        cause: 'plot',
        sections: [{ id: 'plot', text: 'The posting ended.' }],
      }),
      redacted: {
        sections: [{ id: 'plot', items: [{ kind: 'shown', item: { text: 'The posting ended.' } }] }],
      },
    },
    extract: asTruth({
      survivingHostiles: [],
      assets: [],
      arcClues: [],
      service: 'svc-east',
      cityId: 'core',
    }),
    outcome: {
      schema: 1,
      outcome: 'success',
      endedAt: { day: 30, phase: 2 },
      seed: 'posting-seed',
      generatorVersion: '0.7.0',
      content: manifest,
      difficulty: 'standard',
      standing: 1,
      directives: [],
      survivingAssets: [],
      cover: { identity: 'clerk', blown: false, suspicion: 0 },
      hostileMemory: {
        knownCover: false,
        suspectedAssets: [],
        compromisedChannels: [],
        compromisedDrops: [],
        doctrineShift: {},
      },
      budgetRemaining: 12,
    },
  };
}

function choiceOf(state: CampaignState | undefined, command: Command): CampaignChoice {
  if (command.kind === 'accept') {
    const offer = state?.view.offers[0];
    return { kind: 'accept-offer', offer: offer === undefined ? 'missing-offer' : offer.id };
  }
  if (command.kind === 'advance') {
    return { kind: 'advance' };
  }
  if (command.kind === 'leave') {
    return { kind: 'leave' };
  }
  if (command.kind === 'adopt') {
    return { kind: 'adopt-manifest', manifest };
  }
  if (command.kind === 'legend') {
    return { kind: 'legend', cover: 'clerk', name: 'Helen' };
  }
  if (command.kind === 'retire') {
    return { kind: 'retire' };
  }
  if (command.kind === 'defect') {
    return { kind: 'defect' };
  }
  if (command.kind === 'train') {
    return { kind: 'train', skill: command.skill };
  }
  return { kind: 'requisition', id: command.kind === 'requisition' ? command.id : 'missing' };
}

function inputsFor(
  seed: string,
  year: number,
  name: string,
  background: string,
  script: readonly Command[],
): CampaignInput[] {
  const create: CampaignInput = {
    kind: 'choice',
    choice: {
      kind: 'create',
      seed,
      preset: 'standard',
      officerName: name,
      background,
      startYear: year,
    },
  };
  const inputs: CampaignInput[] = [create];
  let state: CampaignState | undefined;
  const started = step(undefined, create, content);
  if (started.ok) {
    state = started.value;
  }
  for (const command of script) {
    const input: CampaignInput =
      command.kind === 'posting'
        ? { kind: 'posting-result', index: command.index, result: quietResult(command.index, command.decrypts) }
        : { kind: 'choice', choice: choiceOf(state, command) };
    inputs.push(input);
    const next = step(state, input, content);
    if (next.ok) {
      state = next.value;
    }
  }
  return inputs;
}

function fold(inputs: readonly CampaignInput[]): CampaignState {
  let state: CampaignState | undefined;
  for (const input of inputs) {
    const before = state === undefined ? undefined : structuredClone(state);
    if (input.kind === 'choice') {
      const quote = quoteChoice(state, input.choice, content);
      const next = step(state, input, content);
      expect(next.ok).toBe(quote.allowed);
      if (!next.ok) {
        if (state !== undefined) {
          expect(state).toEqual(before);
        }
        continue;
      }
      const length = state === undefined ? 0 : state.log.length;
      expect(next.value.log).toHaveLength(length + 1);
      const appended = next.value.log[next.value.log.length - 1];
      expect(appended).toMatchObject({ kind: 'choice', choice: input.choice });
      state = next.value;
      continue;
    }
    const next = step(state, input, content);
    if (!next.ok) {
      if (state !== undefined) {
        expect(state).toEqual(before);
      }
      continue;
    }
    state = next.value;
  }
  if (state === undefined) {
    throw new Error('campaign was not created');
  }
  return state;
}

describe('campaign determinism', () => {
  it('folds one input sequence twice and replays its log', () => {
    // Feature: campaign-career, Property 1: Campaign determinism
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z0-9]{1,12}$/),
        fc.integer({ min: 1948, max: 1950 }),
        fc.stringMatching(/^[A-Za-z][A-Za-z]{0,12}$/),
        fc.constantFrom(...backgrounds),
        fc.array(fc.oneof(...commands), { maxLength: 8 }),
        (seed, year, name, background, script) => {
          const inputs = inputsFor(seed, year, name, background, script);
          const first = fold(inputs);
          const second = fold(inputs);
          expect(second).toEqual(first);
          const replayed = replayCampaign(seed, first.log, () => content, () => {
            throw new Error('the log has no posting to replay');
          }, { manifest, config: config.value });
          expect(replayed).toEqual(first);
        },
      ),
      { numRuns: 100 },
    );
  });
});

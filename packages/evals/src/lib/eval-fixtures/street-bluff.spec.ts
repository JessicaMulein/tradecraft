/**
 * Bluff phrasing eval (street-ops task 15.5).
 *
 * The guard's wording is flavour. Two different lines with the same story
 * produce the same fact lines and the same suspicion, and neither line tells
 * the player a tail is there.
 */

import { describe, expect, it } from 'vitest';

import {
  ScenarioConfigSchema,
  TruthStore,
  compileStreetGraph,
  createPrng,
  generate,
  gridGraph,
  resolve,
  runtimeFromScenario,
  streetOpsRegistry,
  type Action,
  type ResolverContext,
} from '@tradecraft/engine';

import { buildInputs } from '../replays/fixtures.js';

const LINES = ['Where are you going, exactly?', 'Papers. Now.', 'Step out of the car.'] as const;

describe('street bluff phrasing', () => {
  it('keeps the outcome when the wording changes and does not mention a tail', () => {
    const base = buildInputs();
    const scenario = ScenarioConfigSchema.parse({ ...base.scenario, streetOps: { enabled: true } });
    const world = generate('street-bluff-eval', { ...base, scenario });
    const file = gridGraph(2, 2);
    const segment = file.segments[0]?.id;
    if (segment === undefined) throw new Error('grid has no segment');
    const graph = compileStreetGraph({
      ...file,
      frontages: [{ location: world.player.loc, segment, at: 0.2, side: 'right' }],
      checkpoints: [{ id: 'halt', kind: 'document-halt', segment, at: 0.5, service: 'local' }],
    });
    const runtime = runtimeFromScenario(scenario, {
      graphs: [graph],
      checkpoints: [
        {
          id: 'document-halt',
          borderCheck: 'pass',
          thoroughness: 0.3,
          hours: ['morning', 'afternoon', 'evening', 'night'],
          searches: ['visual'],
          watchesAvoidance: false,
          avoidanceSuspicion: 0,
          strictness: 0.5,
        },
      ],
      stories: [{ id: 'late-from-the-office', slots: ['origin'], fits: ['cover'], followUps: [] }],
      vehicles: [
        {
          id: 'pool-coupe',
          name: 'Pool coupe',
          era: { from: world.meta.setting.year, to: world.meta.setting.year },
          speed: 'normal',
          seats: 2,
          conspicuousness: 0.4,
          spots: [],
        },
      ],
    });
    const begun = resolve(world, { kind: 'street-ops.drive', vehicle: 'pool-coupe' }, createPrng('street-bluff-eval'), {
      content: base.content,
      extensions: streetOpsRegistry(scenario, runtime),
      truth: TruthStore.create({ get: () => undefined }),
    });
    const played = LINES.map((flavour) => {
      const action: Action = { kind: 'street-ops.bluff', template: 'late-from-the-office', flavour };
      const ctx: ResolverContext = {
        content: base.content,
        extensions: streetOpsRegistry(scenario, runtime),
        truth: TruthStore.create({ get: () => undefined }),
      };
      return resolve(begun.next, action, createPrng('street-bluff-eval'), ctx);
    });
    const first = played[0];
    if (first === undefined) throw new Error('no bluff result');
    for (const item of played) {
      expect(item.result.factLines).toEqual(first.result.factLines);
      expect(item.next.player.coverSuspicion).toEqual(first.next.player.coverSuspicion);
      const text = item.result.factLines.join('\n').toLowerCase();
      expect(text).not.toContain('tail');
      expect(text).not.toContain('followed');
      expect(text).not.toContain(LINES[0]?.toLowerCase() ?? '');
    }
  });
});

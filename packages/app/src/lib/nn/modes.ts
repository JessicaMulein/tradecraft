/**
 * The three games the neural player can be pointed at.
 *
 * `slice` is the shipped scenario. `ambient` is that city with living
 * crowds. `region` is `config/scenario-region.yaml`: Vienna, Berlin and
 * Trieste, with ambient on.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ScenarioConfigSchema } from '@tradecraft/engine';
import { parse as parseYaml } from 'yaml';

import {
  WALK_REPO_ROOT,
  type ScenarioOverrides,
} from '../game-harness-config.js';

export const PLAY_MODES = ['slice', 'ambient', 'region'] as const;
export type PlayMode = (typeof PLAY_MODES)[number];

export const AMBIENT_SCENARIO: ScenarioOverrides = {
  ambient: { enabled: true, density: 'standard' },
};

/** Packs, region template and ambient flag from the regional scenario file. */
export function regionalScenario(): ScenarioOverrides {
  const parsed = ScenarioConfigSchema.parse(
    parseYaml(
      readFileSync(join(WALK_REPO_ROOT, 'config', 'scenario-region.yaml'), 'utf8'),
    ),
  );
  const region = parsed.region;
  return {
    packs: parsed.packs,
    mole: parsed.mole,
    ...(parsed.ambient === undefined ? {} : { ambient: parsed.ambient }),
    ...(region === undefined
      ? {}
      : {
          region: {
            template: region.template,
            stationModel: region.stationModel,
          },
        }),
  };
}

export function scenarioForMode(mode: PlayMode): ScenarioOverrides | undefined {
  if (mode === 'ambient') return AMBIENT_SCENARIO;
  if (mode === 'region') return regionalScenario();
  return undefined;
}

export function playModes(name: string): readonly PlayMode[] {
  if (name === 'all') return PLAY_MODES;
  if (name === 'slice' || name === 'ambient' || name === 'region') return [name];
  throw new Error(`scenario must be slice, ambient, region, or all`);
}

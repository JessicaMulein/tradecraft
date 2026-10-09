/**
 * The teacher plays the slice, an ambient city, and the regional posting.
 * It uses only the player view. Full training is `pnpm player:train`.
 */
import { describe, expect, it } from 'vitest';

import { playEpisode } from './episode.js';
import { AMBIENT_SCENARIO, regionalScenario } from './modes.js';
import { teacherChoice } from './teacher.js';

async function play(scenario: Parameters<typeof playEpisode>[0]['scenario'], turns: number) {
  return playEpisode({
    seed: 'nn-modes',
    preset: 'standard',
    maxTurns: turns,
    ...(scenario === undefined ? {} : { scenario }),
    choose: (obs) =>
      teacherChoice(
        obs.state,
        obs.actions.map((action) => action.context),
      ),
  });
}

describe('neural player modes', () => {
  it('plays the slice', async () => {
    const result = await play(undefined, 2);
    expect(result.turns).toBe(2);
    expect(result.preset).toBe('standard');
  });

  it('plays an ambient city', async () => {
    const result = await play(AMBIENT_SCENARIO, 2);
    expect(result.turns).toBe(2);
  });

  it('plays the regional posting', async () => {
    const result = await play(regionalScenario(), 4);
    expect(result.turns).toBe(4);
    expect(result.threshold).toBeGreaterThan(0);
  });
});

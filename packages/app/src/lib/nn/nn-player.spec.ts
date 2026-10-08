/**
 * One short game through the real harness, so the observation and the teacher
 * stay wired to the catalogue. Full training is `pnpm player:train`.
 */
import { describe, expect, it } from 'vitest';

import { playEpisode } from './episode.js';
import { teacherChoice } from './teacher.js';

describe('neural player harness', () => {
  it('plays two teacher decisions on easy', async () => {
    const result = await playEpisode({
      seed: 'nn-spec-easy',
      preset: 'easy',
      maxTurns: 2,
      choose: (obs) =>
        teacherChoice(
          obs.state,
          obs.actions.map((action) => action.context),
        ),
    });
    expect([
      'win',
      'plot-completed',
      'burned',
      'wrongful',
      'stalled',
    ]).toContain(result.outcome);
    expect(result.turns).toBeGreaterThan(0);
    expect(result.turns).toBeLessThanOrEqual(2);
    expect(result.threshold).toBeGreaterThan(0);
    expect(result.preset).toBe('easy');
  });
});

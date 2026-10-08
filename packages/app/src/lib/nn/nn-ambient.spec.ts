/**
 * Ambient turns the same seed into a louder city. Two plays of that city, with
 * the same teacher, must take the same actions and end the same way.
 */
import { describe, expect, it } from 'vitest';

import type { ScenarioOverrides } from '../game-harness-config.js';
import { playEpisode, type DecisionSample } from './episode.js';
import { teacherChoice } from './teacher.js';

const AMBIENT: ScenarioOverrides = {
  ambient: { enabled: true, density: 'standard' },
};

describe('ambient replay', () => {
  it('replays a standard ambient game identically', async () => {
    const play = async (): Promise<{
      outcome: string;
      day: number;
      turns: number;
      evidence: number;
      choices: readonly number[];
    }> => {
      const sink: DecisionSample[] = [];
      const result = await playEpisode({
        seed: 'nn-ambient-replay',
        preset: 'standard',
        maxTurns: 24,
        scenario: AMBIENT,
        sink,
        choose: (obs) =>
          teacherChoice(
            obs.state,
            obs.actions.map((action) => action.context),
          ),
      });
      return {
        outcome: result.outcome,
        day: result.day,
        turns: result.turns,
        evidence: result.evidence,
        choices: sink.map((sample) => sample.chosen),
      };
    };

    const first = await play();
    const second = await play();
    expect(second).toEqual(first);
    expect(first.turns).toBe(24);
  });
});

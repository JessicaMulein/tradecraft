/**
 * Golden campaign replay (campaign-career task 14.1).
 *
 * The fixture under `packages/evals/replays/campaign/` is a two-posting career:
 * one handover, one carried recogniser, and the mole-hunt clue `mole-access`.
 * It is not a slice session, so the slice golden loader leaves it alone.
 * CI replays each posting through ReplayGateway and folds the log with
 * `replayCampaign`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CampaignLogEntry, CampaignState } from '@tradecraft/campaign';
import { describe, expect, it } from 'vitest';

import { recordCampaignGolden, replayCampaignGolden } from './campaign-golden.walk.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'evals', 'replays', 'campaign');

function plain(state: CampaignState): unknown {
  return JSON.parse(JSON.stringify(state)) as unknown;
}

describe('golden campaign replay', () => {
  it(
    'replays the checked-in two-posting campaign to the same state',
    async () => {
      if (process.env['RECORD_CAMPAIGN'] === '1') {
        await recordCampaignGolden(DIR);
      }
      const logPath = join(DIR, 'log.json');
      const statePath = join(DIR, 'state.json');
      if (!existsSync(logPath) || !existsSync(statePath)) {
        throw new Error('The campaign golden is missing. Record it with RECORD_CAMPAIGN=1.');
      }
      const log = JSON.parse(readFileSync(logPath, 'utf8')) as CampaignLogEntry[];
      const expected = JSON.parse(readFileSync(statePath, 'utf8')) as CampaignState;
      const postings = log.filter((entry) => entry.kind === 'posting');
      expect(postings).toHaveLength(2);

      const state = await replayCampaignGolden(log);
      expect(plain(state)).toEqual(expected);

      const handed = Object.values(state.truth.cities).flatMap((city) => [...city.handedOver]);
      expect(handed.length).toBeGreaterThan(0);
      const carried = state.truth.carriedHostiles.find(
        (person) => person.service === 'svc-east' && person.status === 'at-large',
      );
      expect(carried).toBeDefined();
      expect(state.truth.arcs['mole-hunt']?.clues['mole-access']).toBe(true);
    },
    180_000,
  );
});

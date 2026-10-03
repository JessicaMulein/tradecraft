/**
 * Golden replay CI gate (task 21.4; Req 17.4).
 *
 * This is the whole-session, checked-in half of Property 14 (replay
 * determinism). The sibling property tests sweep determinism abstractly over
 * generated seeds and action logs (`@tradecraft/player-view` and
 * `@tradecraft/llm`); this spec pins it against concrete golden sessions
 * recorded into `packages/evals/replays/`. Each fixture is replayed end to end
 * through a real {@link ReplayGateway} — no live model — and its reproduced
 * artifact is asserted to deep-equal the checked-in `expected.json`.
 *
 * A failure here means a fresh replay no longer reproduces a recorded session:
 * either an intentional generator/core-pack change (bump `generatorVersion` or
 * the pack version and re-record with `scripts/record-golden.ts`) or a
 * regression that broke determinism. Both must be surfaced loudly, which is why
 * the comparison is a strict deep-equal on the full artifact, not just a hash.
 *
 * The slice fixtures (`01-wait-only`, `02-travel-and-wait` and
 * `03-travel-countersurveillance`) were re-recorded once against the integrated
 * Turn Pipeline (slice-integration task 19.1; Req 24.1), so every fixture is now
 * compared against its checked-in `expected.json` with no fixture skipped.
 *
 * The sessions are model-free (`wait`/`travel`), so each `recording.jsonl` is
 * empty — but the replay is still wired through the `ReplayGateway` seam, so a
 * session that *did* make a model call would be served from (or diverge
 * against) its recording with no endpoint touched (Req 17.3).
 */

import { describe, expect, it } from 'vitest';

import {
  buildExpectedArtifact,
  listFixtureIds,
  loadAllFixtures,
} from './fixtures.js';

const fixtures = loadAllFixtures();

describe('golden replays reproduce their recorded sessions (Req 17.4)', () => {
  it('finds the checked-in golden fixtures', () => {
    // Guards against a silently-empty suite: if the fixtures move or the loader
    // breaks, this fails rather than the suite passing vacuously.
    expect(listFixtureIds().length).toBeGreaterThanOrEqual(2);
    expect(fixtures.length).toBe(listFixtureIds().length);
  });

  for (const fixture of fixtures) {
    describe(`fixture ${fixture.id}`, () => {
      it('replays to an artifact deep-equal to the checked-in golden', async () => {
        const reproduced = await buildExpectedArtifact(fixture);
        expect(reproduced).toEqual(fixture.expected);
      });

      it('reproduces the golden final-state hash', async () => {
        const reproduced = await buildExpectedArtifact(fixture);
        expect(reproduced.stateHash).toBe(fixture.expected.stateHash);
      });

      it('reproduces the golden action log in seq order', async () => {
        const reproduced = await buildExpectedArtifact(fixture);
        expect(reproduced.actionLog).toEqual(fixture.expected.actionLog);
        reproduced.actionLog.forEach((entry, i) => {
          expect(entry.seq).toBe(i);
        });
      });

      it('is deterministic: two replays of the fixture agree', async () => {
        const first = await buildExpectedArtifact(fixture);
        const second = await buildExpectedArtifact(fixture);
        expect(second).toEqual(first);
      });
    });
  }
});

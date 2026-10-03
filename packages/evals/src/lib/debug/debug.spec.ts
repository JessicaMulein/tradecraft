/**
 * Integration spec for the engine-inspection debug helpers (checkpoint 12).
 *
 * These exercise the pure logic behind the `pnpm world` and `pnpm sim` operator
 * CLIs against a real content load but NO model, for a fixed seed — so the test
 * is deterministic and offline. It asserts:
 *
 *   - `renderWorldDump` produces a sectioned player-safe dump that never shows a
 *     `TRUTH ·` section, and a `reveal` dump that does reveal the ground truth
 *     (allegiances, the mole, the Plot) on top of it;
 *   - `runScript` folds a short `wait`/`travel` script through the pure engine
 *     and returns one step per action with a well-formed, renderable report.
 *
 * The world/sim helpers are the testable core; `scripts/world.ts` and
 * `scripts/sim.ts` are thin arg-parse + IO shells over them (not run here).
 */

import { generateGame, type Action, type LocId } from '@tradecraft/engine';

import { buildInputs } from '../replays/fixtures.js';
import { renderWorldDump } from './world-dump.js';
import { renderSimReport, runScript } from './sim-run.js';

const SEED = 'vienna-debug-fixture';

describe('renderWorldDump', () => {
  const inputs = buildInputs();
  const { world, truth } = generateGame(SEED, inputs);

  it('produces a player-safe dump with no revealed ground truth', () => {
    const dump = renderWorldDump(world, truth, { reveal: false });
    expect(dump.length).toBeGreaterThan(0);
    expect(dump).toContain('== World ==');
    expect(dump).toContain('== Starting Brief ==');
    expect(dump).toContain(SEED);
    // Player-safe: no TRUTH sections.
    expect(dump).not.toContain('TRUTH ·');
  });

  it('reveals the ground truth with reveal=true', () => {
    const dump = renderWorldDump(world, truth, { reveal: true });
    expect(dump).toContain('TRUTH · Allegiances');
    expect(dump).toContain('TRUTH · Mole');
    expect(dump).toContain('TRUTH · Plot');
    expect(dump).toContain('TRUTH · Seeded Facts');
    // The seeded Truth Store contributed at least one fact to reveal.
    expect(truth.facts().length).toBeGreaterThan(0);
    // A revealed allegiance names a real org id the player-safe dump never shows.
    const leader = world.plot.leader;
    expect(dump).toContain(String(leader));
  });

  it('defaults to the player-safe dump when no options are given', () => {
    expect(renderWorldDump(world, truth)).not.toContain('TRUTH ·');
  });
});

describe('runScript', () => {
  const inputs = buildInputs();

  it('folds a wait/travel script through the pure engine, one step per action', () => {
    // A reachable destination from the player's start location keeps the travel
    // step from being rejected; the id is resolved from the generated world so
    // the script is valid for this seed.
    const { world } = generateGame(SEED, inputs);
    const destination = Object.keys(world.city.locations).find(
      (id) => id !== world.player.loc,
    ) as LocId;

    const actions: readonly Action[] = [
      { kind: 'wait', phases: 1 },
      { kind: 'travel', to: destination, countersurveillance: false },
      { kind: 'wait', phases: 2 },
    ];

    const result = runScript(SEED, actions, inputs);
    expect(result.seed).toBe(SEED);
    expect(result.steps).toHaveLength(actions.length);
    // Every scripted action is accounted for in order.
    expect(result.steps.map((s) => s.action.kind)).toEqual([
      'wait',
      'travel',
      'wait',
    ]);
    // The report renders without throwing and names the sections.
    const report = renderSimReport(result);
    expect(report).toContain(`== Sim: seed ${SEED} ==`);
    expect(report).toContain('== Fact Lines (per action) ==');
    expect(report).toContain('== Case File ==');
  });

  it('is deterministic in (seed, actions)', () => {
    const actions: readonly Action[] = [{ kind: 'wait', phases: 1 }];
    const a = renderSimReport(runScript(SEED, actions, inputs));
    const b = renderSimReport(runScript(SEED, actions, inputs));
    expect(a).toEqual(b);
  });
});

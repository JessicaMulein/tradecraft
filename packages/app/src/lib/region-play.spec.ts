/**
 * A regional scenario starts a regional world and the turn clock moves it.
 * The shipped `config/scenario.yaml` is not this file.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ScenarioConfigSchema, loadRegionContent, type WorldState } from '@tradecraft/engine';
import { parseModelsConfig } from '@tradecraft/llm';
import { InMemorySaveStore, type EngineApi, type TurnChunk } from '@tradecraft/player-view';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

import { createGame } from './composition-root.js';
import { buildFakeSeams } from './fake-seams.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

async function drain(stream: AsyncIterable<TurnChunk>): Promise<void> {
  for await (const _chunk of stream) {
    // The clock runs as the stream is consumed.
  }
}

describe('regional play', () => {
  it('starts central-1953 and advances a phase', async () => {
    const scenario = ScenarioConfigSchema.parse(
      parseYaml(readFileSync(join(REPO, 'config', 'scenario-region.yaml'), 'utf8')),
    );
    const models = parseModelsConfig(
      readFileSync(join(REPO, 'config', 'models.yaml'), 'utf8'),
      'config/models.yaml',
    );
    if (!models.ok) {
      throw new Error(models.issues.map((issue) => issue.message).join('\n'));
    }
    const dirs = scenario.packs.dirs.map((dir) => join(REPO, dir));
    const content = loadRegionContent(dirs, scenario.packs.load);
    if (!content.ok) {
      throw new Error(content.errors.map((error) => error.message).join('\n'));
    }
    const holder: { api?: EngineApi } = {};
    const game = createGame({
      repoRoot: REPO,
      scenario,
      models: models.value,
      seams: buildFakeSeams({
        seed: 'regional-play',
        getState: () => {
          const api = holder.api;
          if (api === undefined) {
            throw new Error('fake seams read state before the game existed');
          }
          return (api as unknown as { readonly state: WorldState }).state;
        },
        predicates: content.value.predicates,
      }),
      saveStore: new InMemorySaveStore(),
      outcomes: () => undefined,
    });
    holder.api = game.api;
    const started = await game.api.newGame({
      seed: 'regional-play',
      preset: 'standard',
      mole: false,
      narration: 'off',
    });
    expect(started.status.city?.name.length).toBeGreaterThan(0);
    const before = game.api.status().time;
    await drain(game.api.act({ kind: 'wait', phases: 1 }));
    const after = game.api.status();
    expect(after.city?.id).toBe(started.status.city?.id);
    expect(after.time).not.toEqual(before);
    expect(game.api.caseFile.list({}).length).toBeGreaterThan(0);
    const live = (game.api as unknown as { readonly state: WorldState }).state;
    expect(live.ambient?.enabled).toBe(true);
    expect(live.documents['doc:cable/brief']?.asserts.length).toBeGreaterThan(0);
    await game.close();
  });
});

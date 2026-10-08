import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadCityData,
  loadContent,
  loadDescriptorData,
  loadPublicTexts,
  type DifficultyPreset,
} from '@tradecraft/content';
import { ScenarioConfigSchema, settingGeography, type BindCity, type GenerateInputs } from '@tradecraft/engine';

import {
  checkTemplates,
  DEFAULT_THRESHOLDS,
  fixtureCity,
  loadThresholds,
  reportCsv,
  reportMarkdown,
  thresholdFailures,
} from './check.js';

const PACKS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'content', 'packs');

function presetOf(presets: ReadonlyMap<string, DifficultyPreset>, id: string): DifficultyPreset {
  for (const [key, value] of presets) {
    if (key === id || key.endsWith(`/${id}`)) {
      return value;
    }
  }
  throw new Error(`no difficulty preset ${id}`);
}

/** The slice core city, projected the way generation binds a plot. */
function cityBind(
  content: Parameters<typeof checkTemplates>[0],
  presetId: 'easy' | 'standard' | 'hard',
  city: string,
): BindCity {
  if (city === 'fixture') {
    return fixtureCity();
  }
  const cityData = loadCityData(join(PACKS, 'core'));
  const descriptors = loadDescriptorData(join(PACKS, 'core'));
  const publicTexts = loadPublicTexts(join(PACKS, 'core'));
  if (!cityData.ok || !descriptors.ok || !publicTexts.ok) {
    throw new Error('core city data failed to load');
  }
  const inputs: GenerateInputs = {
    content,
    preset: presetOf(content.difficultyPresets, presetId),
    scenario: ScenarioConfigSchema.parse({
      difficulty: { preset: presetId },
      setting: { city: 'core' },
      mole: false,
      recruitment: {
        pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
        firstContact: { a: 1, b: 1, c: 1, d: 1 },
        meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
        exposure: { k1: 1, k2: 1, k3: 1 },
        turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
      },
    }),
    cityData: cityData.value,
    descriptors: descriptors.value,
    publicTexts: publicTexts.value,
  };
  const geography = settingGeography('plot-lab-core', inputs);
  if (geography === undefined) {
    throw new Error('core city setting was infeasible');
  }
  return geography.bind;
}

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

const command = process.argv[2];
if (command !== 'check' && command !== 'sidethreads') {
  process.stderr.write('usage: plot-lab check|sidethreads --seeds <n> --preset <id> --out <dir>\n');
  process.exit(2);
}

const loaded = loadContent(
  [join(PACKS, 'core'), join(PACKS, 'coldwar-plots')],
  ['core', 'coldwar-plots'],
);
if (!loaded.ok) {
  process.stderr.write(`${loaded.errors.map((error) => error.message).join('\n')}\n`);
  process.exit(1);
}

const preset = arg('--preset', 'standard');
if (preset !== 'easy' && preset !== 'standard' && preset !== 'hard') {
  process.stderr.write(`unknown preset ${preset}\n`);
  process.exit(2);
}
const city = arg('--cities', 'core').split(',')[0] ?? 'core';
const report = checkTemplates(
  loaded.value,
  preset,
  Number(arg('--seeds', '50')),
  cityBind(loaded.value, preset, city),
  command === 'sidethreads' ? 'side-thread' : 'plot',
  city,
);
const out = resolve(arg('--out', 'dist/plot-lab'));
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'report.md'), reportMarkdown(report));
writeFileSync(join(out, 'report.csv'), reportCsv(report));
process.stdout.write(reportMarkdown(report) + '\n');
const thresholdsPath = arg('--thresholds', '');
const thresholds = thresholdsPath === '' ? DEFAULT_THRESHOLDS : loadThresholds(thresholdsPath);
const failures = thresholdFailures(report, thresholds);
if (failures.length > 0) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exit(1);
}
process.exit(0);

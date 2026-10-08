import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadCityData, loadContent } from '@tradecraft/content';

import { bindable } from './src/lib/plotgen/bind.ts';
import { createPrng } from './src/lib/prng/prng.ts';
import { generateCity } from './src/lib/city/generate.ts';
import { cityView } from './src/lib/setting/city-view.ts';

const packs = join(dirname(fileURLToPath(import.meta.url)), '..', 'content', 'packs');
const loaded = loadContent(
  [join(packs, 'core'), join(packs, 'coldwar-plots')],
  ['core', 'coldwar-plots'],
);
if (!loaded.ok) {
  console.error(loaded.errors);
  process.exit(1);
}
const cityData = loadCityData(join(packs, 'core'));
if (!cityData.ok) {
  console.error(cityData.errors);
  process.exit(1);
}
const content = loaded.value;
const generated = generateCity(createPrng('bind-rate'), content.locationTypes.values(), cityData.value);
const view = cityView(generated.city, content, {
  city: 'core',
  year: 1952,
  startDate: '1952-03-01' as `${number}-${number}-${number}`,
  attempt: 0,
});
const templates = [...(content.plotTemplatesV2?.values() ?? [])];
const seen = new Set<string>();
let failed = 0;
for (const template of templates) {
  if (seen.has(template.id) || template.subOnly) {
    continue;
  }
  seen.add(template.id);
  const result = bindable(template, view);
  if (!result.ok) {
    failed += 1;
    console.log(template.id, JSON.stringify(result.missing));
  } else {
    console.log(template.id, 'ok');
  }
}
console.log(`failed ${failed} of ${seen.size}`);

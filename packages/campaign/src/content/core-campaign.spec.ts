/**
 * Core campaign content smoke (campaign-career Req 22.3, 17.1, 15.1, 16.1).
 * The slice load leaves `campaign/` unread. This load registers the campaign
 * kinds and checks the authored set.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { loadCampaignContent } from './load.js';
import {
  ArcTemplateSchema,
  ArcThreadTemplateSchema,
  BackgroundSchema,
  CampaignTextSchema,
  EpochSchema,
  ExfiltrationSchema,
  FactionSchema,
  HqCastTemplateSchema,
  RANKS,
  RankRowSchema,
  RequisitionSchema,
  ReviewWeightsSchema,
  SkillSchema,
  TraitSchema,
} from './schemas.js';

const CORE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'packages',
  'content',
  'packs',
  'core',
);

function readList<T>(file: string, schema: { parse: (value: unknown) => T }): T[] {
  const parsed = parse(readFileSync(join(CORE, 'campaign', file), 'utf8')) as unknown[];
  return parsed.map((item) => schema.parse(item));
}

describe('core campaign content', () => {
  it('loads with the core pack and covers the career catalogue', () => {
    const loaded = loadCampaignContent([CORE], ['core']);
    expect(loaded.ok, loaded.ok ? '' : JSON.stringify(loaded.errors.slice(0, 8))).toBe(true);

    const backgrounds = readList('backgrounds.yaml', BackgroundSchema);
    const ranks = readList('ranks.yaml', RankRowSchema);
    const skills = readList('skills.yaml', SkillSchema);
    const traits = readList('traits.yaml', TraitSchema);
    const factions = readList('factions.yaml', FactionSchema);
    const cast = readList('hq-cast.yaml', HqCastTemplateSchema);
    const requisitions = readList('requisitions.yaml', RequisitionSchema);
    const exfiltrations = readList('exfiltrations.yaml', ExfiltrationSchema);
    const weights = readList('review-weights.yaml', ReviewWeightsSchema);
    const arcs = readList('arcs.yaml', ArcTemplateSchema);
    const threads = readList('arc-threads.yaml', ArcThreadTemplateSchema);
    const epochs = readList('epochs.yaml', EpochSchema);
    const texts = readList('texts.yaml', CampaignTextSchema);

    expect(backgrounds.length).toBeGreaterThanOrEqual(3);
    expect(ranks.map((row) => row.id)).toEqual([...RANKS]);
    expect(skills.filter((skill) => skill.language).length).toBeGreaterThanOrEqual(2);
    expect(traits.some((trait) => trait.id === 'strained')).toBe(true);
    expect(factions.some((faction) => faction.id === 'security')).toBe(true);
    expect(cast.length).toBeGreaterThanOrEqual(5);
    expect(cast.length).toBeLessThanOrEqual(7);
    expect(requisitions.length).toBeGreaterThan(0);
    expect(exfiltrations.length).toBeGreaterThan(0);
    expect(weights.length).toBeGreaterThan(0);
    expect(arcs.map((arc) => arc.id).sort()).toEqual(['mole-hunt', 'nemesis']);

    const threadIds = new Set(threads.map((thread) => thread.id));
    for (const arc of arcs) {
      for (const stage of arc.stages) {
        expect(threadIds.has(stage.thread)).toBe(true);
      }
    }

    const years = epochs.map((epoch) => epoch.years).sort((a, b) => a[0] - b[0]);
    expect(years[0]?.[0]).toBe(1948);
    expect(years[years.length - 1]?.[1]).toBe(1962);
    for (let i = 1; i < years.length; i += 1) {
      expect(years[i]?.[0]).toBe((years[i - 1]?.[1] ?? 0) + 1);
    }

    for (const use of ['review', 'capture', 'accusation', 'personal-file'] as const) {
      expect(texts.some((text) => text.use === use)).toBe(true);
    }
    const events = new Set(texts.filter((text) => text.use === 'background-event').map((text) => text.id));
    expect(events.size).toBeGreaterThan(0);
    for (const epoch of epochs) {
      expect(epoch.events.length).toBeGreaterThan(0);
      for (const event of epoch.events) {
        expect(events.has(event)).toBe(true);
      }
    }
  });
});

/**
 * Day-0 ambient initialisation (ambient-world Req 3). Pure. New people,
 * institutions and dormant sites live on {@link AmbientState}. The slice
 * city, orgs and NPCs are not rewritten, so discovery-path verification sees
 * the same graph the noise pass already accepted.
 */

import type { ContentSet, DifficultyPreset } from '@tradecraft/content';

import { BACKGROUND_ID_PREFIX } from '../noise/background.js';
import type { ScenarioConfig } from '../config/scenario-config.js';
import { asTruth, type LocId, type NpcId } from '../model/core.js';
import type { WorldState } from '../model/state.js';
import { createPrng, type Prng } from '../prng/prng.js';

import { ambientBudgets } from './budgets.js';
import { ambientCatalogue } from './catalogue.js';
import { METRIC_IDS } from './content.js';
import { ambientPreset } from './preset.js';
import {
  type AmbientOutlet,
  type AmbientState,
  type CivicOrg,
  type CivicOrgKind,
  type Density,
  type MetricId,
  type NpcTie,
  type Townsfolk,
} from './state.js';
import { ambientInitRetry } from './streams.js';

const BASELINES: Record<MetricId, number> = {
  unrest: 0.2,
  police: 0.3,
  shortage: 0.2,
  tension: 0.3,
  festivity: 0.1,
};

const BUILTIN_OUTLETS: readonly AmbientOutlet[] = [
  { id: 'gazette', name: 'The Evening Gazette', slant: 'commercial' },
  { id: 'herald', name: 'The Morning Herald', slant: 'government' },
  { id: 'parish', name: 'The Parish Paper', slant: 'church' },
];

const BUILTIN_ORGS: readonly { id: string; name: string; kind: CivicOrgKind }[] = [
  { id: 'police', name: 'City police', kind: 'police' },
  { id: 'dock-union', name: 'The dock union', kind: 'union' },
  { id: 'tram-union', name: 'The tram union', kind: 'union' },
  { id: 'civic-party', name: 'The civic party', kind: 'party' },
  { id: 'labour-party', name: 'The labour party', kind: 'party' },
  { id: 'centre-party', name: 'The centre party', kind: 'party' },
  { id: 'mill', name: 'The mill', kind: 'employer' },
  { id: 'press-house', name: 'The press house', kind: 'employer' },
];

function siteTagsOf(world: WorldState, content: ContentSet): Readonly<Record<string, readonly string[]>> {
  const byType = new Map<string, readonly string[]>();
  for (const [id, type] of content.locationTypes) {
    const tags = type.tags;
    byType.set(id, tags);
    const slash = id.indexOf('/');
    if (slash !== -1) {
      byType.set(id.slice(slash + 1), tags);
    }
  }
  const sites: Record<string, readonly string[]> = {};
  for (const loc of Object.values(world.city.locations)) {
    sites[loc.id] = byType.get(loc.type) ?? [];
  }
  return sites;
}

function takeSome<T>(rng: Prng, items: readonly T[], min: number, max: number): T[] {
  if (items.length === 0 || max <= 0) {
    return [];
  }
  const lo = Math.min(min, items.length);
  const hi = Math.min(max, items.length);
  const count = lo >= hi ? hi : rng.int(lo, hi);
  return rng.shuffle(items).slice(0, count);
}

function orgOf(templateId: string, name: string, kind: CivicOrgKind): CivicOrg {
  return { id: `org:${templateId}`, name, kind, templateId };
}

function civilianArchetypes(content: ContentSet): string[] {
  const ids = [...content.archetypes.entries()]
    .filter(([, archetype]) => archetype.role === 'civilian')
    .map(([id]) => id)
    .sort();
  return ids.length > 0 ? ids : ['civilian'];
}

function isBackground(id: string): boolean {
  return id.startsWith(`npc:${BACKGROUND_ID_PREFIX}-`);
}

/**
 * Build the day-0 ambient state. `attempt` selects the derived init seed
 * `derive(derive(seed, 0x50000), attempt)`.
 */
export function initAmbient(
  world: WorldState,
  content: ContentSet,
  preset: DifficultyPreset,
  scenario: ScenarioConfig,
  attempt = 0,
): AmbientState {
  const density: Density = scenario.ambient?.density ?? 'standard';
  const rng = createPrng(ambientInitRetry(world.meta.seed, attempt));
  const budgets = ambientBudgets(density);
  const knobs = ambientPreset(preset.id, preset.ambient);
  const archetypes = civilianArchetypes(content);

  const outlets = takeSome(rng, ambientCatalogue().outlets.length === 0 ? BUILTIN_OUTLETS : ambientCatalogue().outlets, 1, 3);
  const orgs = ambientCatalogue().orgs.length === 0 ? BUILTIN_ORGS : ambientCatalogue().orgs;
  const police = orgs.filter((org) => org.kind === 'police');
  const unions = takeSome(
    rng,
    orgs.filter((org) => org.kind === 'union'),
    1,
    2,
  );
  const parties = takeSome(
    rng,
    orgs.filter((org) => org.kind === 'party'),
    2,
    3,
  );
  const employers = takeSome(
    rng,
    orgs.filter((org) => org.kind === 'employer'),
    1,
    2,
  );
  const coverName =
    world.player.cover.employerOrg.trim() === ''
      ? 'Cover employer'
      : world.player.cover.employerOrg;
  const cover = orgOf('cover-employer', coverName, 'cover-employer');
  const press = outlets.map((outlet) =>
    orgOf(`press-${outlet.id}`, outlet.name, 'press'),
  );
  const civicOrgs = [
    ...police.map((org) => orgOf(org.id, org.name, org.kind)),
    ...press,
    ...unions.map((org) => orgOf(org.id, org.name, org.kind)),
    ...parties.map((org) => orgOf(org.id, org.name, org.kind)),
    ...employers.map((org) => orgOf(org.id, org.name, org.kind)),
    cover,
  ];

  const dormantCount = rng.int(2, 4);
  const dormant: LocId[] = [];
  for (let i = 0; dormant.length < dormantCount; i += 1) {
    const id: LocId = `loc:dormant-${i}`;
    if (world.city.locations[id] === undefined) {
      dormant.push(id);
    }
  }

  const townsfolk: Record<NpcId, Townsfolk> = {};
  for (let i = 0; i < budgets.townsfolk; i += 1) {
    const id: NpcId = `npc:town-${i}`;
    const archetype = archetypes[i % archetypes.length] ?? 'civilian';
    townsfolk[id] = {
      id,
      archetype,
      descriptor: `a passer-by (${i + 1})`,
      schedule: 'ambient/day-round',
      recollections: [],
      regard: { warmth: 0, wariness: 0, familiarity: 0 },
      informant: asTruth(false),
    };
  }

  const full = (Object.keys(world.npcs) as NpcId[]).sort();
  const degree = new Map<NpcId, number>();
  const ties: NpcTie[] = [];
  for (const id of full) {
    const others = rng.shuffle(full.filter((other) => other > id));
    for (const other of others) {
      if ((degree.get(id) ?? 0) >= 8) {
        break;
      }
      if ((degree.get(other) ?? 0) >= 8) {
        continue;
      }
      ties.push({ a: id, b: other, affinity: Math.round(rng.next() * 100) / 100 });
      degree.set(id, (degree.get(id) ?? 0) + 1);
      degree.set(other, (degree.get(other) ?? 0) + 1);
    }
  }

  const pool = [
    ...(Object.keys(townsfolk) as NpcId[]),
    ...full.filter((id) => isBackground(id)),
  ];
  const informantCount = Math.round(pool.length * knobs.informantDensity);
  const chosen = rng.shuffle(pool).slice(0, informantCount);
  const informants: Record<NpcId, 'police' | 'hostile'> = {};
  for (const id of chosen) {
    const handler = rng.bool() ? 'police' : 'hostile';
    informants[id] = handler;
    const person = townsfolk[id];
    if (person !== undefined) {
      townsfolk[id] = { ...person, informant: asTruth(handler) };
    }
  }

  const exo = { ...BASELINES, police: knobs.policeBaseline };
  const react = { unrest: 0, police: 0, shortage: 0, tension: 0, festivity: 0 };
  for (const metric of METRIC_IDS) {
    exo[metric] = Math.min(1, Math.max(0, exo[metric]));
  }

  const tier: Record<NpcId, 'full' | 'coarse'> = {};
  for (const id of full) {
    tier[id] = 'full';
  }

  return {
    schema: 1,
    cityId: world.meta.setting.city,
    enabled: true,
    density,
    calendar: {
      startDate: world.meta.setting.startDate,
      holidays: ambientCatalogue().holidays.map((holiday) => holiday.id),
    },
    metrics: { exo, react },
    events: {},
    history: {},
    triggers: [],
    overlays: [],
    siteTags: siteTagsOf(world, content),
    dormant,
    life: {},
    tieKnowledge: {},
    falseBeliefs: {},
    ties,
    tier,
    townsfolk,
    civicOrgs,
    promotionQueue: [],
    lastInteraction: {},
    memory: asTruth({}),
    regard: asTruth({}),
    informants: asTruth(informants),
    stories: {},
    outlets,
    duties: [],
    coverStanding: asTruth(0.5),
    hookLedger: asTruth([]),
    ambientDelayDays: 0,
    coverDeltaToday: { pos: 0, neg: 0 },
    channelOutages: [],
    informantReports: [],
    detectionBonuses: {},
    gate: { solvable: [], anchors: [], slowRunsToday: 0 },
    counters: {
      starts: 0,
      incidents: 0,
      lifeEvents: 0,
      gossip: 0,
      promotions: 0,
      threads: 0,
    },
    promptCache: { day: world.time.day, facts: {} },
  };
}

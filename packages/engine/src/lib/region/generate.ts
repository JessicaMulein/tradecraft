/**
 * Region Generator (multi-city design, engine/region; Requirements 1, 5, 6,
 * 10, 14).
 *
 * Slice `generate` is untouched. This entry point runs only when a scenario
 * names a region. City core, noise, spine and ambient streams come from the
 * region seed. A failed verification retries on `derive(regionSeed, k)` and
 * raises {@link GeneratorError} when the regional preset's attempt limit is
 * spent.
 */

import {
  WEEKDAYS,
  type ContentSet,
  type DifficultyPreset,
  type PlotTemplateV2,
  type ServiceDefinition,
} from '@tradecraft/content';

import { createLedger } from '../station/ledger.js';
import type { Channel, ChannelSchedule } from '../city/comms.js';
import type { City, District, DistrictId, Location, Weather } from '../city/city.js';
import { enginePhaseOf } from '../city/time-mapping.js';
import type { DisruptionWeights, PlotState, StageState } from '../city/plot.js';
import { emptyHostileBeliefs } from '../hostile/beliefs.js';
import { drawDoctrine, type Doctrine, type DoctrineRanges } from '../hostile/doctrine.js';
import type { Org, Npc, NpcSchedule } from '../city/npc.js';
import { GENERATOR_VERSION, GeneratorError } from '../generate.js';
import type { CityId, IRouteId, ServiceId } from '../fidelity/types.js';
import {
  asTruth,
  type EntityId,
  type GameTime,
  type ItemId,
  type LocId,
  type NpcId,
  type OrgId,
  type Proposition,
} from '../model/core.js';
import { scenarioForStore, type ScenarioConfig } from '../config/scenario-config.js';
import { initAmbient } from '../ambient/init.js';
import { attachMystery } from './mystery.js';
import { recordRegionTiming } from './metrics-log.js';
import { createPrng, type Prng, type PrngState } from '../prng/prng.js';
import type { KnowledgeSlice } from '../city/knowledge.js';
import type { ContentManifest, WorldState } from '../model/state.js';
import { lookup, refId, type RegionCatalog } from './catalog.js';
import type { IntercityRouteTemplate, RegionalPreset, RegionTemplate, TravelDocumentKind } from './content.js';
import {
  cityAmbientSeed,
  cityCoreSeed,
  cityNoiseRetrySeed,
  cityNoiseSeed,
  initialCityStreams,
  regionRetrySeed,
} from './streams.js';
import {
  sliceService,
  type Residency,
  type RivalryEdge,
  type ServiceKind,
  type ServiceState,
} from './services.js';
import { registerRegionGraph, verifyRegion, type RegionGraph, type RegionWitness } from './verify.js';
import type {
  BorderPostId,
  CityState,
  Handoff,
  HandoffId,
  IntercityRoute,
  LocationOf,
  Placement,
  RegionWorld,
  RouteDuration,
  TravelDocId,
  TravelDocument,
  TravelMode,
} from './world.js';

const DURATIONS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const PHASES = [0, 1, 2, 3] as const;
const PRINCIPAL_CITY_CAP = 22;
const PRINCIPAL_REGION_CAP = 48;
const PRODUCER_DEADLINE: GameTime = { day: 3, phase: 0 };

export interface GenerateRegionInputs {
  readonly seed: string;
  readonly content: ContentSet;
  readonly catalog: RegionCatalog;
  readonly preset: DifficultyPreset;
  readonly regionalPreset: RegionalPreset;
  readonly scenario: ScenarioConfig;
  /**
   * Replace one city's noise stream with retry `k`. Core and spine streams
   * stay on the region seed. Used to show city noise does not move another
   * city's core.
   */
  readonly noiseAttempt?: Readonly<Record<string, number>>;
  /** Replace one city's ambient seed with retry `k`. Spine and core stay put. */
  readonly ambientAttempt?: Readonly<Record<string, number>>;
}

interface BoundCity {
  readonly contentId: string;
  readonly id: CityId;
  readonly name: string;
  readonly country: string;
  readonly hub: boolean;
  readonly index: number;
}

interface BuiltRoute {
  readonly route: IntercityRoute;
  readonly mode: TravelMode;
  readonly fromCity: CityId;
  readonly toCity: CityId;
  readonly papers: readonly string[];
}

export function generateRegion(inputs: GenerateRegionInputs): WorldState {
  const started = performance.now();
  try {
    const world = generateRegionBody(inputs);
    recordRegionTiming(inputs.scenario.metrics, {
      purpose: 'region-generate',
      durationMs: performance.now() - started,
      day: world.time.day,
      phase: world.time.phase,
    });
    return world;
  } catch (error) {
    recordRegionTiming(inputs.scenario.metrics, {
      purpose: 'region-generate',
      durationMs: performance.now() - started,
      day: 0,
      phase: 0,
    });
    throw error;
  }
}

function generateRegionBody(inputs: GenerateRegionInputs): WorldState {
  const templateId = inputs.scenario.region?.template;
  if (templateId === undefined) {
    throw new GeneratorError(inputs.seed, 1, {
      kind: 'stage',
      hasHuman: false,
      hasSignal: false,
      reason: 'scenario.region.template is unset',
    }, 'region');
  }
  const template = findTemplate(inputs.catalog, templateId);
  if (template === undefined) {
    throw new GeneratorError(inputs.seed, 1, {
      kind: 'stage',
      hasHuman: false,
      hasSignal: false,
      reason: `region template "${templateId}" is not loaded`,
    }, 'region');
  }
  const limit = inputs.regionalPreset.verifierAttemptLimit;
  for (let attempt = 0; attempt < limit; attempt += 1) {
    const world = attemptRegion(inputs, template, attempt);
    if (world !== undefined) {
      return withCityAmbient(inputs, attachMystery(world));
    }
  }
  throw new GeneratorError(inputs.seed, limit, {
    kind: 'stage',
    hasHuman: false,
    hasSignal: false,
    reason: 'regional verification failed',
  }, 'region');
}

function findTemplate(catalog: RegionCatalog, templateId: string): RegionTemplate | undefined {
  const direct = catalog.templates.get(templateId);
  if (direct !== undefined) {
    return direct;
  }
  for (const template of catalog.templates.values()) {
    if (template.id === templateId || template.id.endsWith(`/${templateId}`)) {
      return template;
    }
  }
  return undefined;
}

function packOf(id: string): string {
  const slash = id.indexOf('/');
  return slash === -1 ? id : id.slice(0, slash);
}

function slug(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function runtimeCityId(contentId: string): CityId {
  return `city:${slug(contentId)}`;
}

function runtimeServiceId(contentId: string): ServiceId {
  return `service:${slug(contentId)}`;
}

function yearOf(eraDate: string): number {
  return Number(eraDate.slice(0, 4));
}

function inEra(era: { readonly from: number; readonly to: number } | undefined, year: number): boolean {
  if (era === undefined) {
    return true;
  }
  return era.from <= year && year <= era.to;
}

function durationOf(value: number): RouteDuration {
  const index = Math.min(8, Math.max(1, Math.round(value))) - 1;
  return DURATIONS[index] ?? 1;
}

const NAMED_PHASE: Readonly<Record<string, 0 | 1 | 2 | 3 | 'any'>> = {
  morning: 0,
  midday: 1,
  afternoon: 1,
  evening: 2,
  night: 3,
  daily: 'any',
};

function departuresOf(
  timetable: IntercityRouteTemplate['timetable'],
): { readonly weekday: number; readonly phase: 0 | 1 | 2 | 3 }[] {
  if (typeof timetable === 'string') {
    const named = NAMED_PHASE[timetable] ?? 'any';
    const phases = named === 'any' ? PHASES : [named];
    const slots: { weekday: number; phase: 0 | 1 | 2 | 3 }[] = [];
    for (let weekday = 0; weekday < WEEKDAYS.length; weekday += 1) {
      for (const phase of phases) {
        slots.push({ weekday, phase });
      }
    }
    return slots;
  }
  const slots: { weekday: number; phase: 0 | 1 | 2 | 3 }[] = [];
  for (const slot of timetable) {
    const weekday = WEEKDAYS.indexOf(slot.weekday);
    if (weekday < 0) {
      continue;
    }
    slots.push({ weekday, phase: enginePhaseOf(slot.phase) });
  }
  return slots;
}

function sameRef(left: string, right: string): boolean {
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}

function postForSectorLine(inputs: GenerateRegionInputs, lineId: string): BorderPostId | undefined {
  for (const border of inputs.catalog.borders.values()) {
    if (border.between.kind !== 'sector-line' || !sameRef(border.between.line, lineId)) {
      continue;
    }
    for (const post of inputs.catalog.posts.values()) {
      if (!sameRef(post.border, border.id)) {
        continue;
      }
      return `post:${slug(post.id)}`;
    }
  }
  return undefined;
}

function districtWithSector(city: CityState, power: string): DistrictId | undefined {
  const want = power.trim().toLowerCase();
  const matches = Object.values(city.districts)
    .filter((district) => district.sector.trim().toLowerCase() === want)
    .sort((a, b) => a.id.localeCompare(b.id));
  return matches[0]?.id;
}

function bindSectorLines(
  inputs: GenerateRegionInputs,
  template: RegionTemplate,
  cities: Readonly<Record<CityId, CityState>>,
): Record<CityId, CityState> {
  const next: Record<CityId, CityState> = { ...cities };
  for (const line of template.sectorLines) {
    const post = postForSectorLine(inputs, line.id);
    if (post === undefined) {
      continue;
    }
    for (const city of Object.values(cities)) {
      const a = districtWithSector(city, line.a);
      const b = districtWithSector(city, line.b);
      if (a === undefined || b === undefined || a === b) {
        continue;
      }
      const current = next[city.id] ?? city;
      next[city.id] = {
        ...current,
        sectorLines: [...current.sectorLines, { a, b, post }],
      };
    }
  }
  return next;
}

function addPhases(time: GameTime, phases: number): GameTime {
  const total = time.day * 4 + time.phase + phases;
  const phase = PHASES[total % 4] ?? 0;
  return { day: Math.floor(total / 4), phase };
}

function attemptRegion(
  inputs: GenerateRegionInputs,
  template: RegionTemplate,
  attempt: number,
): WorldState | undefined {
  const year = yearOf(template.eraDate);
  const rng = createPrng(regionRetrySeed(inputs.seed, attempt));
  const bound = bindCities(inputs.content, template, year);
  if (bound === undefined) {
    return undefined;
  }
  const cityCount = inputs.regionalPreset.cityCount;
  if (bound.length < cityCount.min || bound.length > cityCount.max) {
    return undefined;
  }
  const routes = buildRoutes(inputs, template, bound, year);
  const services = buildServices(inputs, template, bound, rng, year);
  if (services === undefined) {
    return undefined;
  }
  const plot = choosePlot(inputs.content, template, bound, rng);
  if (plot === undefined) {
    return undefined;
  }
  const roles = bindRoles(plot.template, bound, routes, rng);
  if (roles === undefined) {
    return undefined;
  }
  const minted = mintCities(inputs, bound, roles, plot.template, services.byContent);
  const stages = stagePlan(plot.template, roles, routes);
  if (stages === undefined) {
    return undefined;
  }
  const papers = startingPapers(inputs.catalog, template, routes, bound);
  const graph = buildGraph(bound, routes, services.list, roles, stages, papers, plot.template);
  if (!verifyRegion(graph).ok) {
    return undefined;
  }
  const withNoise = addNoise(inputs, bound, minted);
  if (!verifyRegion(graph).ok) {
    return undefined;
  }
  const world = assemble(inputs, template, bound, routes, services, plot, roles, withNoise, stages, papers, graph);
  registerRegionGraph(inputs.seed, graph);
  return world;
}

function bindCities(
  content: ContentSet,
  template: RegionTemplate,
  year: number,
): readonly BoundCity[] | undefined {
  if (!inEra(template.era, year)) {
    return undefined;
  }
  const bound: BoundCity[] = [];
  for (let index = 0; index < template.cities.length; index += 1) {
    const slot = template.cities[index];
    if (slot === undefined) {
      return undefined;
    }
    const bundle = content.cities[slot.city];
    if (bundle === undefined) {
      return undefined;
    }
    const period = bundle.def.period;
    if (period.from > year || period.to < year) {
      return undefined;
    }
    bound.push({
      contentId: slot.city,
      id: runtimeCityId(slot.city),
      name: bundle.def.name,
      country: bundle.def.country ?? template.countries[index] ?? template.countries[0] ?? '',
      hub: slot.hub,
      index,
    });
  }
  return bound;
}

function cityByContent(cities: readonly BoundCity[], contentId: string): BoundCity | undefined {
  return cities.find((city) => city.contentId === contentId || city.contentId.endsWith(`/${contentId}`));
}

function terminalCity(cities: readonly BoundCity[], terminal: string): BoundCity | undefined {
  const slash = terminal.indexOf('/');
  const pack = slash === -1 ? terminal : terminal.slice(0, slash);
  return cities.find((city) => city.contentId === terminal || packOf(city.contentId) === pack);
}

function buildRoutes(
  inputs: GenerateRegionInputs,
  template: RegionTemplate,
  cities: readonly BoundCity[],
  year: number,
): readonly BuiltRoute[] {
  const pack = packOf(template.id);
  const built: BuiltRoute[] = [];
  for (const ref of template.routes) {
    const item = lookup(inputs.catalog.routes, ref, pack);
    if (item === undefined || !inEra(item.era, year)) {
      continue;
    }
    const fromRef = item.terminals[0];
    const toRef = item.terminals[1];
    if (fromRef === undefined || toRef === undefined) {
      continue;
    }
    const fromCity = terminalCity(cities, fromRef);
    const toCity = terminalCity(cities, toRef);
    if (fromCity === undefined || toCity === undefined) {
      continue;
    }
    const posts: BorderPostId[] = [];
    const papers: string[] = [];
    for (const borderRef of item.borders) {
      for (const post of inputs.catalog.posts.values()) {
        if (!inEra(post.era, year)) {
          continue;
        }
        const borderId = refId(borderRef, pack);
        const postBorder = refId(post.border, packOf(post.id));
        if (postBorder !== borderId && post.border !== borderRef) {
          continue;
        }
        posts.push(`post:${slug(post.id)}`);
        for (const document of post.documents) {
          if (!papers.includes(document)) {
            papers.push(document);
          }
        }
      }
    }
    const id = `route:${slug(item.id)}` as IRouteId;
    built.push({
      mode: item.mode,
      fromCity: fromCity.id,
      toCity: toCity.id,
      papers,
      route: {
        id,
        mode: item.mode,
        from: locId(fromCity, fromRef),
        to: locId(toCity, toRef),
        fromCity: fromCity.id,
        toCity: toCity.id,
        duration: durationOf(item.duration),
        fare: item.fare,
        borders: posts,
        timetable: typeof item.timetable === 'string' ? item.timetable : 'listed',
        departures: departuresOf(item.timetable),
        cancellingWeather: item.cancellingWeather,
      },
    });
  }
  return built;
}

function locId(city: BoundCity, terminal: string): LocId {
  return `loc:${slug(city.contentId)}-${slug(terminal)}`;
}

interface ServiceBuild {
  readonly list: readonly ServiceState[];
  readonly byContent: ReadonlyMap<string, ServiceState>;
  readonly rivalry: readonly RivalryEdge[];
  readonly jurisdiction: Readonly<Record<string, ServiceId>>;
}

function buildServices(
  inputs: GenerateRegionInputs,
  template: RegionTemplate,
  cities: readonly BoundCity[],
  rng: Prng,
  year: number,
): ServiceBuild | undefined {
  const pack = packOf(template.id);
  const ranges: DoctrineRanges = {
    risk: inputs.preset.doctrine.risk,
    security: inputs.preset.doctrine.security,
    deception: inputs.preset.doctrine.deception,
  };
  const list: ServiceState[] = [];
  const byContent = new Map<string, ServiceState>();
  const refs = [...template.services].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const ref of refs) {
    const contentId = resolveServiceId(inputs.content, ref, pack);
    if (contentId === undefined) {
      continue;
    }
    const definition = inputs.content.services.get(contentId);
    if (definition === undefined || !inEra(definition.years, year)) {
      continue;
    }
    const extension = extensionFor(inputs.catalog, contentId, ref, pack);
    const drawn = drawDoctrine(rng, ranges);
    const doctrine = applyDoctrine(drawn, extension?.doctrine);
    const kind = definition.kind as ServiceKind;
    const residencies = residenciesFor(extension, cities);
    const reliability = drawUnit(rng, inputs.regionalPreset.liaisonReliability);
    const service = serviceState(definition, contentId, kind, doctrine, residencies, reliability, rng, inputs);
    list.push(service);
    byContent.set(contentId, service);
  }
  if (list.length === 0) {
    return undefined;
  }
  return {
    list,
    byContent,
    rivalry: rivalryEdges(inputs, template, byContent, pack),
    jurisdiction: jurisdictionMap(inputs, template, cities, byContent, pack),
  };
}

function resolveServiceId(content: ContentSet, ref: string, pack: string): string | undefined {
  if (content.services.has(ref)) {
    return ref;
  }
  const namespaced = refId(ref, pack);
  if (content.services.has(namespaced)) {
    return namespaced;
  }
  for (const id of content.services.keys()) {
    if (id === ref || id.endsWith(`/${ref}`)) {
      return id;
    }
  }
  return undefined;
}

function extensionFor(
  catalog: RegionCatalog,
  contentId: string,
  ref: string,
  pack: string,
) {
  for (const extension of catalog.extensions.values()) {
    const target = refId(extension.service, packOf(extension.id));
    if (target === contentId || target === refId(ref, pack) || extension.service === ref) {
      return extension;
    }
  }
  return undefined;
}

function applyDoctrine(
  drawn: Doctrine,
  override: { readonly riskTolerance?: number; readonly securityConsciousness?: number; readonly deceptionAppetite?: number } | undefined,
): Doctrine {
  if (override === undefined) {
    return drawn;
  }
  return {
    riskTolerance: override.riskTolerance ?? drawn.riskTolerance,
    securityConsciousness: override.securityConsciousness ?? drawn.securityConsciousness,
    deceptionAppetite: override.deceptionAppetite ?? drawn.deceptionAppetite,
  };
}

function drawUnit(rng: Prng, range: { readonly min: number; readonly max: number }): number {
  const t = rng.next();
  return range.min + t * (range.max - range.min);
}

function residenciesFor(
  extension: { readonly residency: readonly string[] } | undefined,
  cities: readonly BoundCity[],
): Record<CityId, Residency> {
  const residencies: Record<CityId, Residency> = {};
  for (const ref of extension?.residency ?? []) {
    const city = cityByContent(cities, ref) ?? terminalCity(cities, ref);
    if (city === undefined) {
      continue;
    }
    residencies[city.id] = { officers: [], channels: [], drops: [], capacity: 2 };
  }
  return residencies;
}

function serviceState(
  definition: ServiceDefinition,
  contentId: string,
  kind: ServiceKind,
  doctrine: Doctrine,
  residencies: Record<CityId, Residency>,
  reliability: number,
  rng: Prng,
  inputs: GenerateRegionInputs,
): ServiceState {
  const id = runtimeServiceId(contentId);
  const beliefs = {
    ...emptyHostileBeliefs(),
    coverSuspicion: 0,
    watch: asTruth({ persons: [] as readonly NpcId[], descriptors: [] as readonly string[] }),
  };
  const knowledge = liaisonKnowledge(kind, reliability, rng);
  const penetrated = kind === 'liaison' && rng.next() < inputs.regionalPreset.penetrationProbability;
  return {
    id,
    kind,
    country: definition.country,
    doctrine,
    residencies,
    beliefs,
    knowledge,
    ...(kind === 'liaison'
      ? {
          liaison: {
            reliability: asTruth(reliability),
            agenda: { conceal: [], promote: [], obtain: [] },
            trust: inputs.regionalPreset.liaisonTrustThreshold,
            delayPhases: inputs.regionalPreset.papersDelay,
          },
        }
      : {}),
    ...(penetrated
      ? {
          penetratedBy: asTruth({
            service: id,
            agent: 'npc:mole' as NpcId,
            delayPhases: inputs.regionalPreset.papersDelay,
          }),
        }
      : {}),
  };
}

function liaisonKnowledge(kind: ServiceKind, reliability: number, rng: Prng): KnowledgeSlice {
  if (kind !== 'liaison') {
    return { known: [], falseBeliefs: [], knownEntities: [] };
  }
  const known: Proposition[] = [];
  const falseBeliefs: Proposition[] = [];
  const fact: Proposition = {
    id: 'prop:liaison/known',
    subject: 'npc:liaison-officer',
    predicate: 'KNOWS',
    object: { kind: 'text', value: 'a route' },
  };
  known.push(fact);
  if (rng.next() > reliability) {
    falseBeliefs.push({
      id: 'prop:liaison/false',
      subject: 'npc:liaison-officer',
      predicate: 'KNOWS',
      object: { kind: 'text', value: 'a rumour' },
    });
  }
  return { known, falseBeliefs, knownEntities: [] };
}

function rivalryEdges(
  inputs: GenerateRegionInputs,
  template: RegionTemplate,
  byContent: ReadonlyMap<string, ServiceState>,
  pack: string,
): readonly RivalryEdge[] {
  if (template.rivalry === undefined) {
    return [];
  }
  const table = lookup(inputs.catalog.rivalries, template.rivalry, pack);
  if (table === undefined) {
    return [];
  }
  const edges: RivalryEdge[] = [];
  for (const edge of table.edges) {
    const from = serviceByRef(byContent, edge.from, pack);
    const to = serviceByRef(byContent, edge.to, pack);
    if (from === undefined || to === undefined) {
      continue;
    }
    const bothHostile = from.kind === 'hostile' && to.kind === 'hostile';
    edges.push({
      from: from.id,
      to: to.id,
      share: edge.share,
      delayPhases: edge.delayPhases,
      compete: bothHostile && !edge.share,
      expose: bothHostile ? inputs.regionalPreset.rivalryIntensity : 0,
    });
  }
  return edges;
}

function serviceByRef(
  byContent: ReadonlyMap<string, ServiceState>,
  ref: string,
  pack: string,
): ServiceState | undefined {
  const namespaced = refId(ref, pack);
  for (const [contentId, service] of byContent) {
    if (contentId === ref || contentId === namespaced || contentId.endsWith(`/${ref}`)) {
      return service;
    }
  }
  return undefined;
}

function jurisdictionMap(
  inputs: GenerateRegionInputs,
  template: RegionTemplate,
  cities: readonly BoundCity[],
  byContent: ReadonlyMap<string, ServiceState>,
  pack: string,
): Record<string, ServiceId> {
  const map: Record<string, ServiceId> = {};
  for (const entry of template.jurisdiction) {
    const service = serviceByRef(byContent, entry.service, pack);
    if (service === undefined) {
      continue;
    }
    const city = cityForPlace(inputs.content, cities, entry.place);
    const key = city?.id ?? entry.place;
    map[key] = service.id;
  }
  return map;
}

function cityForPlace(
  content: ContentSet,
  cities: readonly BoundCity[],
  place: string,
): BoundCity | undefined {
  const direct = cityByContent(cities, place);
  if (direct !== undefined) {
    return direct;
  }
  for (const city of cities) {
    const bundle = content.cities[city.contentId];
    if (bundle === undefined) {
      continue;
    }
    const pack = packOf(city.contentId);
    for (const district of bundle.districts) {
      if (district.id === place || `${pack}/${district.id}` === place) {
        return city;
      }
    }
  }
  return undefined;
}

interface ChosenPlot {
  readonly id: string;
  readonly template: PlotTemplateV2;
}

function choosePlot(
  content: ContentSet,
  template: RegionTemplate,
  cities: readonly BoundCity[],
  rng: Prng,
): ChosenPlot | undefined {
  const pack = packOf(template.id);
  const eligible: ChosenPlot[] = [];
  for (const ref of template.plots) {
    const id = refId(ref, pack);
    const plot = content.plotTemplatesV2?.get(id) ?? content.plotTemplatesV2?.get(ref);
    if (plot === undefined || !inEra(plot.era, yearOf(template.eraDate))) {
      continue;
    }
    const roles = Object.keys(plot.cityRoles ?? {});
    if (roles.length > cities.length) {
      continue;
    }
    eligible.push({ id: plot.id, template: plot });
  }
  eligible.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (eligible.length === 0) {
    return undefined;
  }
  return rng.pick(eligible);
}

function bindRoles(
  template: PlotTemplateV2,
  cities: readonly BoundCity[],
  routes: readonly BuiltRoute[],
  rng: Prng,
): Readonly<Record<string, CityId>> | undefined {
  const roles = Object.keys(template.cityRoles ?? {}).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const search = (
    index: number,
    binding: Record<string, CityId>,
  ): Record<string, CityId> | undefined => {
    if (index >= roles.length) {
      return handoffsOk(template, binding, routes) ? binding : undefined;
    }
    const role = roles[index];
    if (role === undefined) {
      return undefined;
    }
    const constraint = template.cityRoles?.[role];
    const used = new Set(Object.values(binding));
    const candidates = rng.shuffle(
      cities.filter((city) => !used.has(city.id) && !(constraint?.not === 'hub' && city.hub)),
    );
    for (const city of candidates) {
      const found = search(index + 1, { ...binding, [role]: city.id });
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  };
  return search(0, {});
}

interface PlotStageView {
  readonly id: string;
  readonly city?: string;
  readonly handoff?: { readonly from: string; readonly modes?: readonly string[] };
}

function stageViews(template: PlotTemplateV2): readonly PlotStageView[] {
  const views: PlotStageView[] = [];
  for (const stage of template.stages) {
    if (!('id' in stage) || typeof stage.id !== 'string') {
      continue;
    }
    const record = stage as {
      readonly id: string;
      readonly city?: string;
      readonly handoff?: { readonly from?: string; readonly modes?: readonly string[] };
    };
    const from = record.handoff?.from;
    views.push({
      id: record.id,
      ...(typeof record.city === 'string' ? { city: record.city } : {}),
      ...(typeof from === 'string'
        ? { handoff: { from, ...(record.handoff?.modes === undefined ? {} : { modes: record.handoff.modes }) } }
        : {}),
    });
  }
  return views;
}

function handoffsOk(
  template: PlotTemplateV2,
  binding: Readonly<Record<string, CityId>>,
  routes: readonly BuiltRoute[],
): boolean {
  for (const stage of stageViews(template)) {
    if (stage.handoff === undefined || stage.city === undefined) {
      continue;
    }
    const fromStage = stageViews(template).find((item) => item.id === stage.handoff?.from);
    const fromRole = fromStage?.city;
    const toRole = stage.city;
    if (fromRole === undefined) {
      continue;
    }
    const from = binding[fromRole];
    const to = binding[toRole];
    if (from === undefined || to === undefined) {
      return false;
    }
    const modes = new Set(stage.handoff.modes ?? []);
    const linked = routes.some(
      (route) =>
        modes.has(route.mode) &&
        ((route.fromCity === from && route.toCity === to) ||
          (route.fromCity === to && route.toCity === from)),
    );
    if (!linked) {
      return false;
    }
  }
  return true;
}

interface StagePlan {
  readonly id: string;
  readonly city: CityId;
  readonly deadline: GameTime;
  readonly handoff?: { readonly from: string; readonly duration: number; readonly route: IRouteId };
}

function stagePlan(
  template: PlotTemplateV2,
  binding: Readonly<Record<string, CityId>>,
  routes: readonly BuiltRoute[],
): readonly StagePlan[] | undefined {
  const deadlines = new Map<string, GameTime>();
  const plans: StagePlan[] = [];
  for (const stage of stageViews(template)) {
    const role = stage.city;
    const city = role === undefined ? undefined : binding[role];
    if (city === undefined) {
      return undefined;
    }
    let deadline = PRODUCER_DEADLINE;
    let handoff: StagePlan['handoff'];
    if (stage.handoff !== undefined) {
      const fromDeadline = deadlines.get(stage.handoff.from) ?? PRODUCER_DEADLINE;
      const hop = shortestHop(template, stage, binding, routes);
      if (hop === undefined) {
        return undefined;
      }
      deadline = addPhases(fromDeadline, hop.duration);
      handoff = { from: stage.handoff.from, duration: hop.duration, route: hop.route };
    }
    deadlines.set(stage.id, deadline);
    plans.push({ id: stage.id, city, deadline, ...(handoff === undefined ? {} : { handoff }) });
  }
  return plans;
}

function shortestHop(
  template: PlotTemplateV2,
  stage: PlotStageView,
  binding: Readonly<Record<string, CityId>>,
  routes: readonly BuiltRoute[],
): { readonly duration: number; readonly route: IRouteId } | undefined {
  const fromStage = stageViews(template).find((item) => item.id === stage.handoff?.from);
  const from = fromStage?.city === undefined ? undefined : binding[fromStage.city];
  const to = stage.city === undefined ? undefined : binding[stage.city];
  if (from === undefined || to === undefined || stage.handoff === undefined) {
    return undefined;
  }
  const modes = new Set(stage.handoff.modes ?? []);
  let best: { readonly duration: number; readonly route: IRouteId } | undefined;
  for (const route of routes) {
    const links =
      (route.fromCity === from && route.toCity === to) ||
      (route.fromCity === to && route.toCity === from);
    if (!links || !modes.has(route.mode)) {
      continue;
    }
    if (best === undefined || route.route.duration < best.duration) {
      best = { duration: route.route.duration, route: route.route.id };
    }
  }
  return best;
}

interface PaperSet {
  readonly held: readonly TravelDocumentKind[];
  readonly obtainable: readonly TravelDocumentKind[];
}

function startingPapers(
  catalog: RegionCatalog,
  template: RegionTemplate,
  routes: readonly BuiltRoute[],
  cities: readonly BoundCity[],
): PaperSet {
  const year = yearOf(template.eraDate);
  const hub = cities.find((city) => city.hub);
  const required = new Set<string>();
  for (const route of routes) {
    if (hub !== undefined && route.fromCity !== hub.id && route.toCity !== hub.id) {
      continue;
    }
    for (const paper of route.papers) {
      required.add(paper);
    }
  }
  const held: TravelDocumentKind[] = [];
  const obtainable: TravelDocumentKind[] = [];
  for (const document of catalog.documents.values()) {
    if (!inEra(document.era, year)) {
      continue;
    }
    if (document.obtainableBy !== 'none') {
      obtainable.push(document);
    }
    const local = document.id.slice(document.id.indexOf('/') + 1);
    const needed = required.has(document.id) || required.has(local);
    if (document.obtainableBy === 'station' || needed) {
      held.push(document);
    }
  }
  return { held, obtainable };
}

function buildGraph(
  cities: readonly BoundCity[],
  routes: readonly BuiltRoute[],
  services: readonly ServiceState[],
  binding: Readonly<Record<string, CityId>>,
  stages: readonly StagePlan[],
  papers: PaperSet,
  template: PlotTemplateV2,
): RegionGraph {
  const held = papers.held.map((document) => localId(document.id));
  const obtainable = papers.obtainable.map((document) => localId(document.id));
  const liaisons = services.filter((service) => service.kind === 'liaison').map((service) => service.id);
  const targets = stages.map((stage) => {
    const human: RegionWitness = {
      role: 'human',
      edge: 'carriage',
      node: `npc:${slug(stage.city)}-cell`,
      route: stage.handoff?.route,
      requiresPapers: papersForCity(stage.city, routes),
    };
    const signal: RegionWitness = {
      role: 'signal',
      edge: 'courier',
      node: `chan:courier:${slug(stage.id)}`,
      route: stage.handoff?.route,
    };
    return { key: `prop:${stage.id}`, paths: [human, signal] };
  });
  const permits = cities.map((city) => ({
    city: city.id,
    permitsArrest: services.some(
      (service) =>
        (service.kind === 'own' || service.kind === 'liaison') &&
        service.residencies[city.id] !== undefined,
    ),
  }));
  const success = successKinds(template);
  const abortRoutes = routes.map((route) => route.route.id);
  const handoffAt = stages
    .map((stage) => stage.handoff?.route)
    .filter((route): route is IRouteId => route !== undefined);
  void binding;
  return {
    papers: held,
    obtainablePapers: obtainable,
    knownLocs: cities.map((city) => city.id),
    targets,
    jurisdiction: permits,
    success,
    handoffAt,
    abortRoutes,
    brief: {
      papers: held,
      cities: cities.map((city) => city.id),
      routes: routes.map((route) => route.route.id),
      liaisons,
    },
  };
}

function localId(id: string): string {
  const slash = id.lastIndexOf('/');
  return slash === -1 ? id : id.slice(slash + 1);
}

function papersForCity(city: CityId, routes: readonly BuiltRoute[]): readonly string[] {
  const papers: string[] = [];
  for (const route of routes) {
    if (route.fromCity !== city && route.toCity !== city) {
      continue;
    }
    for (const paper of route.papers) {
      if (!papers.includes(paper)) {
        papers.push(paper);
      }
    }
  }
  return papers;
}

function successKinds(template: PlotTemplateV2): Array<'arrest' | 'handoff' | 'abort'> {
  const kinds = new Set<'arrest' | 'handoff' | 'abort'>();
  for (const condition of template.outcomes?.success ?? []) {
    if (condition.kind === 'arrest-role') {
      kinds.add('arrest');
    } else {
      kinds.add('abort');
    }
  }
  if (kinds.size === 0) {
    kinds.add('abort');
  }
  return [...kinds];
}

interface Minted {
  readonly npcs: Record<NpcId, Npc>;
  readonly orgs: Record<OrgId, Org>;
  readonly principals: readonly NpcId[];
  readonly leader: NpcId;
  readonly chief: NpcId;
  readonly mole?: NpcId;
  readonly staffByCity: Readonly<Record<CityId, NpcId>>;
  readonly channels: Record<`chan:${string}`, Channel>;
  readonly cities: Record<CityId, CityState>;
}

function mintCities(
  inputs: GenerateRegionInputs,
  cities: readonly BoundCity[],
  binding: Readonly<Record<string, CityId>>,
  template: PlotTemplateV2,
  services: ReadonlyMap<string, ServiceState>,
): Minted {
  const touched = new Set(Object.values(binding));
  const npcs: Record<NpcId, Npc> = {};
  const orgs: Record<OrgId, Org> = {};
  const principals: NpcId[] = [];
  const staffByCity: Record<CityId, NpcId> = {};
  const channels: Record<`chan:${string}`, Channel> = {};
  const cityStates: Record<CityId, CityState> = {};
  let leader: NpcId | undefined;
  let chief: NpcId | undefined;
  const perCity = inputs.scenario.region?.stationModel === 'per-city';
  for (const city of cities) {
    const core = createPrng(cityCoreSeed(inputs.seed, city.index));
    const orgId = `org:cell:${slug(city.id)}` as OrgId;
    orgs[orgId] = { id: orgId, name: `${city.name} cell`, kind: 'cell', allegiance: 'cell' };
    const stationOrg = `org:station:${slug(city.id)}` as OrgId;
    orgs[stationOrg] = { id: stationOrg, name: `${city.name} station`, kind: 'station', allegiance: 'station' };
    const first = firstLoc(inputs.content, city);
    cityStates[city.id] = cityState(inputs, city);
    if (principals.length >= PRINCIPAL_REGION_CAP) {
      continue;
    }
    const staffRole = city.hub || perCity ? 'station-chief' : 'station-staff';
    const staff = mintNpc(core, city, staffRole, stationOrg, 'station', first, principals.length);
    if (principalsFor(city, npcs) < PRINCIPAL_CITY_CAP) {
      npcs[staff.id] = staff;
      principals.push(staff.id);
      staffByCity[city.id] = staff.id;
      if (city.hub) {
        chief = staff.id;
      }
    }
    if (!touched.has(city.id)) {
      continue;
    }
    const member = mintNpc(core, city, 'cell', orgId, 'cell', first, principals.length);
    if (principals.length < PRINCIPAL_REGION_CAP && principalsFor(city, npcs) < PRINCIPAL_CITY_CAP) {
      npcs[member.id] = member;
      principals.push(member.id);
      if (leader === undefined) {
        leader = member.id;
      }
    }
    const courier = `chan:courier:${slug(city.id)}` as const;
    channels[courier] = {
      id: courier,
      kind: 'courier',
      owner: orgId,
      schedule: { period: 1, start: { day: 1, phase: 0 }, phase: 0 },
    };
  }
  void template;
  void services;
  const leaderId = leader ?? principals[0];
  const chiefId = chief ?? staffByCity[cities.find((city) => city.hub)?.id ?? cities[0]?.id ?? 'city:none'] ?? leaderId;
  if (leaderId === undefined || chiefId === undefined) {
    throw new GeneratorError(inputs.seed, 1, {
      kind: 'stage',
      hasHuman: false,
      hasSignal: false,
      reason: 'a region needs a plot leader and a station chief',
    }, 'region');
  }
  const mole = inputs.scenario.mole ? chiefId : undefined;
  return {
    npcs,
    orgs,
    principals,
    leader: leaderId,
    chief: chiefId,
    ...(mole === undefined ? {} : { mole }),
    staffByCity,
    channels,
    cities: cityStates,
  };
}

function principalsFor(city: BoundCity, npcs: Record<NpcId, Npc>): number {
  const prefix = `npc:${slug(city.id)}-`;
  return Object.keys(npcs).filter((id) => id.startsWith(prefix)).length;
}

function firstLoc(content: ContentSet, city: BoundCity): string {
  const bundle = content.cities[city.contentId];
  const loc = bundle?.locations[0];
  return loc === undefined ? 'halt' : loc.id;
}

function cityState(inputs: GenerateRegionInputs, city: BoundCity): CityState {
  const bundle = inputs.content.cities[city.contentId];
  const districts: Record<DistrictId, District> = {};
  const locations: Record<LocId, Location> = {};
  for (const district of bundle?.districts ?? []) {
    const id = `district:${slug(city.contentId)}-${slug(district.id)}` as DistrictId;
    districts[id] = { id, name: district.name, sector: district.sector?.power ?? '' };
  }
  for (const loc of bundle?.locations ?? []) {
    const id = `loc:${slug(city.contentId)}-${slug(loc.id)}` as LocId;
    const district = `district:${slug(city.contentId)}-${slug(loc.district)}` as DistrictId;
    locations[id] = {
      id,
      name: loc.name,
      aliases: [],
      type: loc.type,
      district,
      public: loc.public,
      description: loc.description,
      atmosphere: loc.atmosphere,
      hours: { 0: true, 1: true, 2: true, 3: true },
      risk: 0.2,
      deadDropSites: [],
    };
  }
  const weather: Weather = { condition: 'clear', label: 'clear', season: 'summer' };
  const styleSheet = bundle?.def.styleSheet?.trim();
  const ambientSeed = inputs.ambientAttempt?.[city.id];
  const ambientState = createPrng(
    ambientSeed === undefined
      ? cityAmbientSeed(inputs.seed, city.index)
      : cityNoiseRetrySeed(inputs.seed, city.index, ambientSeed),
  ).state();
  void ambientState;
  return {
    id: city.id,
    name: city.name,
    ...(styleSheet === undefined || styleSheet.length === 0 ? {} : { styleSheet }),
    tier: city.hub ? 'full' : 'coarse',
    districts,
    locations,
    routes: [],
    weather,
    sectorLines: [],
    country: city.country,
  };
}

function mintNpc(
  rng: Prng,
  city: BoundCity,
  role: string,
  org: OrgId,
  allegiance: 'station' | 'cell' | 'neutral',
  loc: string,
  index: number,
): Npc {
  const given = rng.pick(['alex', 'blair', 'casey', 'drew']);
  const family = rng.pick(['hale', 'keller', 'moroz', 'novak']);
  const id = `npc:${slug(city.id)}-${role}-${index}` as NpcId;
  const schedule: NpcSchedule = {
    entries: [{ weekday: 0, phase: 0, loc: `loc:${slug(city.contentId)}-${slug(loc)}` }],
  };
  return {
    id,
    archetype: role,
    role,
    org,
    trueAllegiance: asTruth({ org }),
    apparentAllegiance: allegiance,
    mice: asTruth({ money: rng.next(), ideology: rng.next(), coercion: rng.next(), ego: rng.next() }),
    moneyNeed: asTruth(1),
    reliability: asTruth(rng.next()),
    tradecraft: asTruth(rng.next()),
    securityConsciousness: asTruth(rng.next()),
    persona: {
      name: `${given} ${family}`,
      given,
      family,
      library: 'regional',
      culture: 'regional',
      gender: 'female',
      voiceTraits: [],
      mannerisms: [],
      background: city.name,
      openness: rng.next(),
    },
    descriptor: { summary: 'a traveller', phrases: [], pools: [] },
    schedule,
    wariness: 0.4,
  };
}

function addNoise(inputs: GenerateRegionInputs, cities: readonly BoundCity[], minted: Minted): Minted {
  const npcs = { ...minted.npcs };
  const channels = { ...minted.channels };
  for (const city of cities) {
    const attempt = inputs.noiseAttempt?.[city.id];
    const seed = attempt === undefined
      ? cityNoiseSeed(inputs.seed, city.index)
      : cityNoiseRetrySeed(inputs.seed, city.index, attempt);
    const rng = createPrng(seed);
    const count = inputs.preset.noiseCounts.backgroundNpcs;
    const org = `org:station:${slug(city.id)}` as OrgId;
    const loc = firstLoc(inputs.content, city);
    for (let n = 0; n < count; n += 1) {
      const npc = mintNpc(rng, city, 'background', org, 'neutral', loc, n);
      npcs[npc.id] = npc;
    }
    const state = rng.state();
    const phase = PHASES[state[0] % 4] ?? 0;
    const id = `chan:noise:${slug(city.id)}` as const;
    const schedule: ChannelSchedule = {
      period: Math.max(1, inputs.preset.noiseTrafficRatio.noise),
      start: { day: state[1] % 1000, phase },
      phase,
    };
    channels[id] = { id, kind: 'numbers', owner: org, schedule };
  }
  return { ...minted, npcs, channels };
}

function assemble(
  inputs: GenerateRegionInputs,
  template: RegionTemplate,
  cities: readonly BoundCity[],
  routes: readonly BuiltRoute[],
  services: ServiceBuild,
  plot: ChosenPlot,
  binding: Readonly<Record<string, CityId>>,
  minted: Minted,
  stages: readonly StagePlan[],
  papers: PaperSet,
  graph: RegionGraph,
): WorldState {
  const hub = cities.find((city) => city.hub) ?? cities[0];
  if (hub === undefined) {
    throw new GeneratorError(inputs.seed, 1, {
      kind: 'stage',
      hasHuman: false,
      hasSignal: false,
      reason: 'a region template has no city',
    }, 'region');
  }
  const year = yearOf(template.eraDate);
  const hostile = [...services.list].find((service) => service.kind === 'hostile') ?? services.list[0];
  if (hostile === undefined) {
    throw new GeneratorError(inputs.seed, 1, {
      kind: 'stage',
      hasHuman: false,
      hasSignal: false,
      reason: 'a region template has no service',
    }, 'region');
  }
  const sliceHostile = sliceService(
    { doctrine: hostile.doctrine, beliefs: emptyHostileBeliefs() },
    0,
  );
  const travelDocs: Record<TravelDocId, TravelDocument> = {};
  const paperIds: TravelDocId[] = [];
  for (const document of papers.held) {
    const id = `paper:${slug(document.id)}` as TravelDocId;
    paperIds.push(id);
    travelDocs[id] = {
      id,
      kind: localId(document.id),
      holder: 'player',
      quality: asTruth(document.baseQuality),
      issuedBy: { kind: 'station', id: minted.chief },
      valid: { from: { day: 0, phase: 0 }, to: { day: document.validityDays, phase: 0 } },
    };
  }
  const whereabouts: Record<NpcId, LocId | 'absent'> = {};
  const locationOf: Record<string, Placement> = {};
  for (const npc of Object.values(minted.npcs)) {
    const loc = npc.schedule.entries[0]?.loc ?? locId(hub, firstLoc(inputs.content, hub));
    whereabouts[npc.id] = loc;
    const owner = cities.find((city) => npc.id.startsWith(`npc:${slug(city.id)}-`));
    locationOf[npc.id] = { city: owner?.id ?? hub.id, loc };
  }
  const playerLoc = locId(hub, firstLoc(inputs.content, hub));
  locationOf.player = { city: hub.id, loc: playerLoc };
  const item = `item:${slug(plot.id)}/materiel` as ItemId;
  locationOf[item] = { city: hub.id, loc: playerLoc };
  const handoffs: Record<HandoffId, Handoff> = {};
  for (const stage of stages) {
    if (stage.handoff === undefined) {
      continue;
    }
    const id = `handoff:${slug(stage.id)}` as HandoffId;
    const from = stages.find((item) => item.id === stage.handoff?.from);
    handoffs[id] = {
      id,
      plot: plot.id,
      stage: stage.id,
      courier: minted.leader,
      item,
      from: from?.city ?? hub.id,
      to: stage.city,
      route: stage.handoff.route,
      status: 'preparing',
    };
  }
  const weights: DisruptionWeights = { delay: 1, reroute: 1, abort: 1 };
  const plotStages: StageState[] = stages.map((stage) => ({
    id: stage.id,
    templateId: stage.id,
    requires: stage.handoff === undefined ? [] : [`prop:${stage.handoff.from}`],
    produces: [`prop:${stage.id}`],
    deadline: stage.deadline,
    traces: [],
    onDisrupted: weights,
    status: 'pending',
  }));
  const stationOrg = `org:station:${slug(hub.id)}` as OrgId;
  const outstations: Record<CityId, { readonly city: CityId; readonly staff: readonly NpcId[] }> = {};
  for (const city of cities) {
    if (city.hub || inputs.scenario.region?.stationModel === 'per-city') {
      continue;
    }
    const staff = minted.staffByCity[city.id];
    outstations[city.id] = { city: city.id, staff: staff === undefined ? [] : [staff] };
  }
  const perCityChiefs = inputs.scenario.region?.stationModel === 'per-city';
  if (perCityChiefs) {
    for (const city of cities) {
      if (city.hub) {
        continue;
      }
      const staff = minted.staffByCity[city.id];
      outstations[city.id] = { city: city.id, staff: staff === undefined ? [] : [staff] };
    }
  }
  const knownEntities: EntityId[] = [playerLoc];
  const briefBody = [
    `cities ${graph.brief?.cities.join(' ')}`,
    `routes ${graph.brief?.routes.join(' ')}`,
    `liaisons ${graph.brief?.liaisons.join(' ')}`,
    `papers ${graph.brief?.papers.join(' ')}`,
  ].join('\n');
  const order = cities.map((city) => city.id);
  const streams = initialCityStreams(inputs.seed, order);
  const ambient: Record<CityId, PrngState> = { ...streams.ambient };
  for (const city of cities) {
    const retry = inputs.ambientAttempt?.[city.id];
    if (retry !== undefined) {
      ambient[city.id] = createPrng(cityNoiseRetrySeed(inputs.seed, city.index, retry)).state();
    }
  }
  const region: RegionWorld = {
    template: template.id,
    cities: bindSectorLines(inputs, template, minted.cities),
    order,
    intercity: Object.fromEntries(routes.map((route) => [route.route.id, route.route])),
    borderPosts: borderPosts(inputs, template),
    jurisdiction: services.jurisdiction,
    latency: {
      sameCountry: inputs.regionalPreset.communicationLatency.sameCountry,
      crossBorder: inputs.regionalPreset.communicationLatency.crossBorder,
      acrossCurtain: inputs.regionalPreset.communicationLatency.acrossCurtain,
    },
    rules: {
      detentionPhases: inputs.regionalPreset.detentionPhases,
      contrabandCashThreshold: inputs.regionalPreset.contrabandCashThreshold,
      papersDelay: inputs.regionalPreset.papersDelay,
      papersCost: inputs.regionalPreset.papersCost,
      watchListSensitivity: inputs.regionalPreset.watchListSensitivity,
      liaisonTrustThreshold: inputs.regionalPreset.liaisonTrustThreshold,
    },
  };
  const plotState: PlotState = {
    template: plot.id,
    status: 'running',
    stages: plotStages,
    roles: [{ slot: 'leader', archetype: 'cell', npc: minted.leader }],
    materielSlots: [{ slot: 'materiel', item }],
    targetSlots: [{ slot: 'target', entity: playerLoc }],
    materiel: asTruth(item),
    leader: asTruth(minted.leader),
    target: asTruth(playerLoc),
    abortPressure: 0,
    pressureKeys: [],
    materielSeized: false,
  };
  const cityView: City = {
    displayName: hub.name,
    districts: minted.cities[hub.id]?.districts ?? {},
    locations: minted.cities[hub.id]?.locations ?? {},
    routes: [],
    crowdModels: {},
    startMonth: Number(template.eraDate.slice(5, 7)),
  };
  return {
    meta: {
      seed: inputs.seed,
      generatorVersion: GENERATOR_VERSION,
      content: inputs.content.manifest as unknown as ContentManifest,
      preset: inputs.preset,
      scenario: scenarioForStore(inputs.scenario),
      setting: { city: hub.contentId, startDate: template.eraDate, year, attempt: 0 },
    },
    time: { day: 0, phase: 0 },
    rng: createPrng(inputs.seed).state(),
    cityStreams: { spine: streams.spine, ambient },
    city: cityView,
    orgs: minted.orgs,
    npcs: minted.npcs,
    whereabouts,
    relationships: {},
    told: {},
    plot: plotState,
    plots: [
      {
        id: plot.id,
        templateId: plot.id,
        displayName: plot.template.displayName,
        archetype: plot.template.archetype,
        role: 'primary',
        variantKey: plot.id,
        cells: cities
          .filter((city) => Object.values(binding).includes(city.id))
          .map((city) => ({
            org: `org:cell:${slug(city.id)}`,
            spec: 'cell',
            security: 0.5,
            members: minted.principals.filter((id) => id.startsWith(`npc:${slug(city.id)}-cell`)),
          })),
        cutouts: [],
        bindings: binding,
        roleHolders: { leader: minted.leader },
        knowledge: {},
        runtimeBranches: [],
        outcomes: { success: [], failure: [] },
        offMap: [],
        subPlots: [],
        standingPenalty: 0,
        standingReward: 0,
        stages: stages.map((stage) => ({
          id: stage.id,
          status: 'pending' as const,
          deadlineDay: stage.deadline.day,
          offMap: false,
          facade: false,
          roles: [],
          city: stage.city,
          ...(stage.handoff === undefined
            ? {}
            : { handoff: { from: stage.handoff.from, carrier: 'courier-line', modes: ['rail'] } }),
        })),
      },
    ],
    sideThreads: [],
    channels: minted.channels,
    deadDrops: {},
    transmissions: [],
    intercepts: {},
    documents: {
      'doc:cable/brief': {
        id: 'doc:cable/brief',
        kind: 'cable',
        title: 'starting brief',
        date: { day: 0, phase: 0 },
        body: briefBody,
        asserts: [],
      },
    },
    documentPropositions: {},
    newspapers: {},
    meetings: {},
    station: {
      org: stationOrg,
      chief: minted.chief,
      staff: Object.values(minted.staffByCity),
      ...(inputs.scenario.mole ? { mole: asTruth(minted.chief) } : {}),
      knowledge: { known: [], falseBeliefs: [], knownEntities: [] },
      directives: [],
      standing: 1,
      ledger: createLedger(inputs.preset.startingBudget),
      pendingCables: [],
      reportable: [],
    },
    hostile: {
      doctrine: sliceHostile.doctrine,
      beliefs: { ...emptyHostileBeliefs() },
      feedLog: [],
    },
    player: {
      loc: playerLoc,
      cover: {
        id: 'cover:regional',
        title: 'a commercial traveller',
        employerOrg: 'a trading house',
        fitLocationTypes: [],
        suspicionModifiers: { atFit: -0.1, elsewhere: 0.1 },
      },
      coverSuspicion: asTruth(0),
      tailed: asTruth(false),
      known: { entities: knownEntities, channels: [], drops: [] },
      unkIds: {},
      contacts: [],
      arrestAuthority: inputs.preset.arrest.threshold,
      arrests: [],
      burned: false,
      readDocuments: [],
      city: hub.id,
      papers: paperIds,
      png: [],
    },
    scheduled: [],
    region,
    locationOf: locationOf as LocationOf,
    transits: {},
    handoffs,
    travelDocs,
    stations: {
      hub: {
        org: stationOrg,
        chief: minted.chief,
        staff: minted.staffByCity[hub.id] === undefined ? [] : [minted.staffByCity[hub.id]],
        knowledge: { known: [], falseBeliefs: [], knownEntities: [] },
        standing: 1,
      },
      outstations,
    },
    pendingNotices: [],
    services: Object.fromEntries(services.list.map((service) => [service.id, service])),
    rivalry: services.rivalry,
  };
}

function withCityAmbient(inputs: GenerateRegionInputs, world: WorldState): WorldState {
  if (inputs.scenario.ambient?.enabled !== true || world.region === undefined) {
    return world;
  }
  const cities = { ...world.region.cities };
  world.region.order.forEach((cityId, index) => {
    const city = cities[cityId];
    if (city === undefined) {
      return;
    }
    const seeded: WorldState = {
      ...world,
      meta: {
        ...world.meta,
        seed: cityAmbientSeed(inputs.seed, index),
        setting: { ...world.meta.setting, city: cityId },
      },
      city: {
        ...world.city,
        displayName: city.name ?? world.city.displayName,
        districts: city.districts,
        locations: city.locations,
        routes: city.routes,
      },
    };
    const ambient = initAmbient(seeded, inputs.content, inputs.preset, inputs.scenario);
    cities[cityId] = { ...city, ambient: { ...ambient, cityId } };
  });
  const playerCity = world.player.city;
  const playerAmbient = playerCity === undefined || playerCity === null ? undefined : cities[playerCity]?.ambient;
  return {
    ...world,
    region: { ...world.region, cities },
    ...(playerAmbient === undefined ? {} : { ambient: playerAmbient }),
  };
}

function borderPosts(
  inputs: GenerateRegionInputs,
  template: RegionTemplate,
): RegionWorld['borderPosts'] {
  const year = yearOf(template.eraDate);
  const posts: Record<BorderPostId, { readonly id: BorderPostId; readonly service: ServiceId; readonly strictness: number; readonly documents: readonly string[] }> = {};
  for (const post of inputs.catalog.posts.values()) {
    if (!inEra(post.era, year)) {
      continue;
    }
    const id = `post:${slug(post.id)}` as BorderPostId;
    posts[id] = {
      id,
      service: runtimeServiceId(post.service),
      strictness: post.strictness,
      documents: post.documents,
    };
  }
  return posts;
}

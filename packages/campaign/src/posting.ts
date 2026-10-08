/**
 * Posting Context (design, "Posting Context"; Requirements 4.1, 5.1, 5.2,
 * 11.3, 11.5, 12.4, 12.5, 15.2, 16.3, 17.5, 21.1, 21.5).
 *
 * Pure. It does not draw on the campaign stream: a year whose tension is
 * already cached is used as stored, and a year that has not been drawn uses
 * the middle of the epoch range. Player History is built from the view and
 * `archive.visible` only. Placements, the dossier and arc bindings are read
 * from Campaign Truth because that is where those records live.
 *
 * A budget credit is already inside the officer preset override, so it is not
 * repeated as a carry-in ledger grant.
 */

import type { DifficultyPreset } from '@tradecraft/content';
import { asTruth, toTemplateHistory, type Proposition, type Result } from '@tradecraft/engine';

import { activeArcThreads, type ArcFacts } from './arcs.js';
import type { CampaignConfig } from './config.js';
import type { CampaignContent } from './content/library.js';
import type { ArcThreadTemplate } from './content/schemas.js';
import { dossierCarry } from './dossier.js';
import { epochAt, eraOverrides } from './era.js';
import { moleHuntThreads, type MoleThreadSpec } from './molehunt.js';
import { placeNemesis } from './nemesis.js';
import { officerModifiers, type RecruitmentWeights } from './officer.js';
import { PERSONAL_FILE_MAX, personalFile } from './personal-file.js';
import { broughtPlacement } from './assets.js';
import { postingSeed } from './seed.js';
import type {
  CampaignPersonId,
  CampaignState,
  CarriedAsset,
  CarriedNpc,
  CarryIn,
  HostileDossier,
  PostingContext,
  PostingOffer,
} from './state.js';

export interface PostingContextSources {
  readonly config: CampaignConfig;
  /** The scenario's recruitment weights, before officer overrides. */
  readonly weights: RecruitmentWeights;
}

/** The posting context for one accepted offer. */
export function buildPostingContext(
  state: CampaignState,
  offer: PostingOffer,
  content: CampaignContent,
  sources: PostingContextSources,
): Result<PostingContext, string> {
  const legend = legendFor(state);
  if (legend === undefined) {
    return { ok: false, error: 'Choose a legend before the posting starts.' };
  }
  const epoch = epochAt(offer.year, content.epochs);
  if (!epoch.ok) {
    return epoch;
  }
  const preset = findPreset(content, state.preset);
  if (preset === undefined) {
    return { ok: false, error: `unknown preset "${state.preset}"` };
  }
  const tension = tensionFor(state, offer.year, epoch.value.tension);
  const officer = officerModifiers(
    state.view.officer,
    {
      tier: offer.tier,
      cityLanguages: languagesOf(content, offer.city),
      requisitions: state.view.pendingRequisitions,
      era: { tension, doctrineScale: sources.config.eraDoctrineScale },
    },
    content,
    { preset, weights: sources.weights },
  );
  if (!officer.ok) {
    return officer;
  }
  const era = eraOverrides(epoch.value, tension, preset, sources.config.eraDoctrineScale);
  const dossier = findDossier(state.truth.dossiers, offer.service);
  const facts = postingFacts(state, offer, dossier);
  const placements = carryPlacements(state, offer, content, facts, sources.config.carry.assetTrustDecay);
  const threads = arcThreadsFor(state, offer, content, facts);
  let file: CarryIn['personalFile'];
  try {
    file = personalFile(
      state.archive.visible.map((entry) => entry.carry),
      placements,
      {
        texts: content.texts,
        epochs: content.epochs,
        predicates: content.set.predicates,
        year: offer.year,
        personalFileMax: PERSONAL_FILE_MAX + (state.truth.extraLeads ?? 0),
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
  const skills: Record<string, number> = {};
  for (const [id, skill] of Object.entries(state.view.officer.skills)) {
    skills[id] = skill.level;
  }
  const rank = content.ranks.find((row) => sameId(row.id, state.view.officer.rank));
  return {
    ok: true,
    value: {
      campaignId: state.id,
      index: state.postings,
      seed: postingSeed(state.seed, state.postings),
      city: offer.city,
      service: offer.service,
      year: offer.year,
      tension,
      epoch: epoch.value.id,
      epochFlags: epoch.value.flags,
      presetOverrides: { ...officer.value.preset, allowedCiphers: era.allowedCiphers },
      scenarioOverrides: officer.value.weights,
      legend: { cover: legend.cover, name: legend.name, official: legend.official },
      carry: asTruth({
        placements,
        personalFile: file,
        arcThreads: threads,
        modifiers: dossierCarry(
          dossier ?? emptyDossier(offer.service),
          officer.value.resolvedPreset,
          sources.config.carry,
        ),
        unkPrealloc: unkFor(state, placements),
        requisitions: carryRequisitions(state, content),
        recogniserSuspicion: sources.config.carry.recogniserSuspicion,
      }),
      history: {
        campaignId: state.id,
        postingIndex: state.postings,
        city: offer.city,
        templateHistory: toTemplateHistory(state.archive.visible),
        context: {
          year: offer.year,
          skills,
          // The drawn tension stays on the posting. History uses the epoch
          // midpoint, which does not read Campaign Truth (Req 21.1).
          tension: (epoch.value.tension[0] + epoch.value.tension[1]) / 2,
          epochFlags: epoch.value.flags,
          rank: state.view.officer.rank,
          ...(rank === undefined ? {} : { scaling: rank.budgetScale }),
        },
      },
    },
  };
}

function legendFor(state: CampaignState): CampaignState['view']['officer']['legends'][number] | undefined {
  const rows = state.view.officer.legends.filter((row) => row.posting === state.postings);
  return rows[rows.length - 1];
}

function tensionFor(
  state: CampaignState,
  year: number,
  range: readonly [number, number],
): number {
  if (Object.hasOwn(state.truth.tensionByYear, year)) {
    return state.truth.tensionByYear[year] ?? (range[0] + range[1]) / 2;
  }
  return (range[0] + range[1]) / 2;
}

function findPreset(content: CampaignContent, id: string): DifficultyPreset | undefined {
  const direct = content.set.difficultyPresets.get(id);
  if (direct !== undefined) {
    return direct;
  }
  for (const [key, preset] of content.set.difficultyPresets) {
    if (sameId(key, id) || sameId(preset.id, id)) {
      return preset;
    }
  }
  return undefined;
}

function languagesOf(content: CampaignContent, cityId: string): string[] {
  for (const [id, bundle] of Object.entries(content.set.cities)) {
    if (sameId(id, cityId) || sameId(bundle.def.id, cityId)) {
      return bundle.def.languages.map((language) => language.id);
    }
  }
  return [];
}

function findDossier(
  dossiers: CampaignState['truth']['dossiers'],
  service: string,
): HostileDossier | undefined {
  const direct = dossiers[service];
  if (direct !== undefined) {
    return direct;
  }
  for (const [id, dossier] of Object.entries(dossiers)) {
    if (sameId(id, service)) {
      return dossier;
    }
  }
  return undefined;
}

function emptyDossier(service: string): HostileDossier {
  return {
    service,
    notoriety: 0,
    descriptorKnown: false,
    burnedLegends: [],
    patterns: [],
    channelKinds: [],
    suspectedAssets: [],
    doctrineShift: {},
  };
}

function postingFacts(
  state: CampaignState,
  offer: PostingOffer,
  dossier: HostileDossier | undefined,
): ArcFacts {
  const roster: Record<
    string,
    { status: CarriedNpc['status']; service?: string }
  > = {};
  for (const person of state.truth.carriedHostiles) {
    roster[person.id] = {
      status: person.status,
      ...(person.service === undefined ? {} : { service: person.service }),
    };
  }
  const presentClues: { clue: string; present: boolean }[] = [];
  for (const arc of Object.values(state.truth.arcs)) {
    for (const [clue, held] of Object.entries(arc.clues)) {
      if (held) {
        presentClues.push({ clue, present: true });
      }
    }
  }
  return {
    postingIndex: state.postings,
    year: offer.year,
    service: offer.service,
    rank: state.view.officer.rank,
    notoriety: dossier?.notoriety ?? 0,
    heldClaims: state.archive.visible.flatMap((entry) => [...entry.carry.heldClaims]),
    presentClues,
    roster,
  };
}

function carryPlacements(
  state: CampaignState,
  offer: PostingOffer,
  content: CampaignContent,
  facts: ArcFacts,
  decay: number,
): CarryIn['placements'] {
  const brought = state.truth.brought
    .filter((asset) => placeable(asset.person))
    .slice()
    .sort(byAsset);
  const broughtIds = new Set(brought.map((asset) => asset.person.id));
  const handed = handedOver(state, offer.city)
    .filter((asset) => placeable(asset.person) && !broughtIds.has(asset.person.id))
    .slice()
    .sort(byAsset);
  const nemesisId = state.truth.nemesis;
  const nemesis = state.truth.carriedHostiles.find(
    (person) => person.id === nemesisId && placeable(person),
  );
  const recognisers = state.truth.carriedHostiles
    .filter(
      (person) =>
        placeable(person) &&
        person.id !== nemesisId &&
        person.service !== undefined &&
        sameId(person.service, offer.service) &&
        !cellArchetype(person.archetype),
    )
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id));
  const placed = new Set<string>([
    ...brought.map((asset) => asset.person.id),
    ...handed.map((asset) => asset.person.id),
    ...recognisers.map((person) => person.id),
    ...(nemesis === undefined ? [] : [nemesis.id]),
  ]);
  const mole = moleHuntThreads(state.truth.arcs, content.arcs, content.arcThreads, facts, offer.service);
  return [
    ...brought.map((asset) => broughtPlacement(asset)),
    ...handed.map((asset) => handedPlacement(asset, offer.year, decay)),
    ...recognisers.map((person) => recogniserPlacement(person)),
    ...placeNemesis(state.truth.arcs, content.arcs, content.arcThreads, nemesis, facts),
    ...visitorPlacements(mole, content, state, offer, placed),
  ];
}

function handedOver(state: CampaignState, city: string): readonly CarriedAsset[] {
  const direct = state.truth.cities[city];
  if (direct !== undefined) {
    return direct.handedOver;
  }
  for (const [id, row] of Object.entries(state.truth.cities)) {
    if (sameId(id, city)) {
      return row.handedOver;
    }
  }
  return [];
}

function handedPlacement(
  asset: CarriedAsset,
  year: number,
  decay: number,
): CarryIn['placements'][number] {
  const years = Math.max(0, year - asset.leftYear);
  const trust = years > 0 && decay > 0 ? asset.trust * (1 - decay) ** years : asset.trust;
  return {
    person: asset.person,
    as: 'handed-over',
    trust,
    contact: true,
    hostileControlled: asset.hostileControlled,
    optional: false,
    priority: 1,
  };
}

function recogniserPlacement(person: CarriedNpc): CarryIn['placements'][number] {
  return { person, as: 'recogniser', contact: false, optional: true, priority: 0 };
}

function visitorPlacements(
  threads: readonly MoleThreadSpec[],
  content: CampaignContent,
  state: CampaignState,
  offer: PostingOffer,
  placed: ReadonlySet<string>,
): CarryIn['placements'] {
  const visitors: CarryIn['placements'][number][] = [];
  const seen = new Set<string>();
  for (const thread of threads) {
    const id = thread.visitor;
    if (id === undefined || placed.has(id) || seen.has(id)) {
      continue;
    }
    const figure = state.view.hqCast.find((row) => row.id === id);
    const spec = content.arcThreads.find((item) => sameId(item.id, thread.template));
    visitors.push({
      person: visitorPerson(id, figure, spec, offer, state.postings),
      as: 'hq-visitor',
      contact: false,
      optional: false,
      priority: thread.priority,
    });
    seen.add(id);
  }
  return visitors;
}

function visitorPerson(
  id: CampaignPersonId,
  figure: CampaignState['view']['hqCast'][number] | undefined,
  spec: ArcThreadTemplate | undefined,
  offer: PostingOffer,
  posting: number,
): CarriedNpc {
  const name = figure?.name ?? id;
  const role = figure?.role ?? 'visitor';
  const parts = name.split(' ');
  const given = parts[0] ?? name;
  const family = parts.slice(1).join(' ');
  const slot = spec?.slots.find((item) => item.binding === 'mole');
  const roleSlot = spec?.roleSlots.find((item) => item.id === slot?.id);
  const archetype = roleSlot?.archetypes.find((item) => !cellArchetype(item)) ?? 'station-clerk';
  return {
    id,
    archetype,
    name,
    aliases: [],
    persona: {
      name,
      given,
      family: family === '' ? role : family,
      library: '',
      culture: '',
      gender: 'male',
      voiceTraits: [],
      mannerisms: [],
      background: role,
      openness: 0.5,
    },
    descriptor: role,
    allegiance: { true: 'org:station', apparent: 'org:station' },
    mice: asTruth({ money: 0, ideology: 0, coercion: 0, ego: 0 }),
    loyalty: 0.5,
    status: 'at-large',
    seen: [{ posting, city: offer.city }],
  };
}

function arcThreadsFor(
  state: CampaignState,
  offer: PostingOffer,
  content: CampaignContent,
  facts: ArcFacts,
): CarryIn['arcThreads'] {
  const mole = moleHuntThreads(
    state.truth.arcs,
    content.arcs,
    content.arcThreads,
    facts,
    offer.service,
  );
  return activeArcThreads(state.truth.arcs, content.arcs, content.arcThreads, facts).map((thread) => {
    const bindings = withoutCell(thread.bindings, state.truth.carriedHostiles);
    const rich = mole.find(
      (item) => sameId(item.arc, thread.arc) && sameId(item.template, thread.template),
    );
    if (rich !== undefined) {
      return {
        arc: thread.arc,
        template: thread.template,
        bindings,
        clues: rich.clues.map((clue) => ({ id: clue.id, prop: clue.prop })),
        priority: thread.priority,
      };
    }
    const spec = content.arcThreads.find((item) => sameId(item.id, thread.template));
    return {
      ...thread,
      bindings,
      clues: thread.clues.map((clue) => clueWithProp(clue.id, spec, bindings, offer.service)),
    };
  });
}

function clueWithProp(
  id: string,
  spec: ArcThreadTemplate | undefined,
  bindings: Readonly<Record<string, CampaignPersonId>>,
  service: string,
): { readonly id: string; readonly prop?: Proposition } {
  const authored = spec?.clues.find((clue) => sameId(clue.id, id));
  const subject = Object.values(bindings)[0];
  if (authored === undefined || subject === undefined) {
    return { id };
  }
  return {
    id,
    prop: {
      id: `prop:${id}`,
      subject: npcId(subject),
      predicate: authored.prop,
      object: orgId(service),
    },
  };
}

function withoutCell(
  bindings: Readonly<Record<string, CampaignPersonId>>,
  hostiles: readonly CarriedNpc[],
): Record<string, CampaignPersonId> {
  const cells = new Set(
    hostiles.filter((person) => cellArchetype(person.archetype)).map((person) => person.id),
  );
  const next: Record<string, CampaignPersonId> = {};
  for (const [slot, person] of Object.entries(bindings)) {
    if (!cells.has(person)) {
      next[slot] = person;
    }
  }
  return next;
}

function unkFor(
  state: CampaignState,
  placements: CarryIn['placements'],
): CarryIn['unkPrealloc'] {
  const placed = new Set(placements.map((placement) => placement.person.id));
  const entries: CarryIn['unkPrealloc'][number][] = [];
  for (const [ref, person] of Object.entries(state.truth.unkMap)) {
    if (!placed.has(person)) {
      continue;
    }
    const sightings = state.view.unk[ref]?.sightings;
    entries.push({
      ref,
      person,
      ...(sightings === undefined || sightings.length === 0 ? {} : { sightings: [...sightings] }),
    });
  }
  entries.sort((left, right) => (left.ref < right.ref ? -1 : left.ref > right.ref ? 1 : 0));
  return entries;
}

function carryRequisitions(
  state: CampaignState,
  content: CampaignContent,
): CarryIn['requisitions'] {
  const effects: CarryIn['requisitions'][number][] = [];
  for (const id of state.view.pendingRequisitions) {
    const item = content.requisitions.find(
      (requisition) => requisition.id === id || id.endsWith(`/${requisition.id}`),
    );
    if (item === undefined || item.effect.kind === 'budget-credit') {
      continue;
    }
    effects.push(item.effect);
  }
  return effects;
}

function placeable(person: CarriedNpc): boolean {
  return person.status === 'at-large' || person.status === 'turned';
}

function byAsset(left: CarriedAsset, right: CarriedAsset): number {
  return left.person.id < right.person.id ? -1 : left.person.id > right.person.id ? 1 : 0;
}

function cellArchetype(id: string): boolean {
  return id === 'cell' || id.endsWith('/cell');
}

function npcId(id: string): `npc:${string}` {
  return id.startsWith('npc:') ? (id as `npc:${string}`) : `npc:${id}`;
}

function orgId(id: string): `org:${string}` {
  return id.startsWith('org:') ? (id as `org:${string}`) : `org:${id}`;
}

function sameId(left: string, right: string): boolean {
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}

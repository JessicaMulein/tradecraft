/**
 * Carry-Over (design, "Carry-Over"; Requirements 5.4, 6.1–6.4, 12.5).
 *
 * A pure fold of one Posting Result into campaign state. The result is
 * validated first. A failure returns the field paths and does not build a new
 * state. The fold then runs in order: archive, calendar, skills, stress,
 * traits, dossier merge, carried persons, arcs, and review staging.
 *
 * Trait triggers run after stress, so a burn in this posting can add `strained`
 * before the officer returns to HQ. Rank, reprimands and Career Points stay
 * put: the Review Board is staged for the player to read, not applied.
 * `advanceArcs` records clues and moves a stage only when its conditions hold,
 * and returns the same arc record when nothing changed. Remaining budget has
 * no campaign field; it stays on the validated Outcome Record.
 */

import {
  AdmiraltyGradeSchema,
  asTruth,
  GameTimeSchema,
  OutcomeRecordSchema,
  PropositionSchema,
  type ChannelId,
  type DeadDropId,
  type Result,
} from '@tradecraft/engine';
import { z } from 'zod';

import type { CampaignContent } from './content/library.js';
import type { CampaignConfig } from './config.js';
import { advanceArcs, arcFactsFromPosting } from './arcs.js';
import { mergeHostileMemory } from './dossier.js';
import { applyStress, applyTraitTriggers, growSkills } from './progress.js';
import { applyReview, careerScore } from './review.js';
import type {
  CampaignState,
  CampaignTruth,
  CarriedAsset,
  CarriedAssetView,
  CarriedNpc,
  HostileDossier,
  LegendId,
  Officer,
  PostingResult,
  PostingTruthExtract,
  ServiceId,
} from './state.js';

export interface CarryInvalid {
  readonly kind: 'invalid';
  readonly paths: readonly string[];
}

const plotSchema = z.object({
  templateId: z.string(),
  variantKey: z.string(),
  archetype: z.string(),
  role: z.enum(['primary', 'secondary']),
  outcome: z.string(),
});

const statsSchema = z.object({
  decrypts: z.number(),
  recruits: z.number(),
  turned: z.number(),
  surveilObservations: z.number(),
  followsCompleted: z.number(),
  arrestsCorrect: z.number(),
  arrestsWrongful: z.number(),
  madeFactLines: z.number(),
  meetingsHeld: z.number(),
  dropsServiced: z.number(),
});

const carrySchema = z.object({
  identified: z.array(
    z.object({
      person: z.string(),
      name: z.string(),
      aliases: z.array(z.string()),
      apparentAffiliation: z.string().optional(),
    }),
  ),
  unidentified: z.array(
    z.object({
      person: z.string(),
      descriptor: z.string(),
      sightings: z.array(z.object({ city: z.string(), year: z.number() })),
    }),
  ),
  heldClaims: z.array(
    z.object({
      id: z.string(),
      prop: PropositionSchema,
      text: z.string(),
      relation: z.enum(['none', 'corroborated', 'conflicted']),
    }),
  ),
  grades: z.array(z.object({ source: z.string(), grade: AdmiraltyGradeSchema })),
  notes: z.array(
    z.object({
      seq: z.number(),
      at: GameTimeSchema,
      attachTo: z.union([z.number(), z.string()]),
      text: z.string(),
    }),
  ),
  observedBurns: z.array(z.string()),
});

const debriefSchema = z.object({
  full: z.object({
    outcome: z.string(),
    cause: z.string(),
    sections: z.array(z.object({ id: z.string(), text: z.string() })),
  }),
  redacted: z.object({
    sections: z.array(
      z.object({
        id: z.string(),
        items: z.array(
          z.discriminatedUnion('kind', [
            z.object({ kind: z.literal('shown'), item: z.object({ text: z.string() }) }),
            z.object({ kind: z.literal('redacted'), ref: z.string() }),
          ]),
        ),
      }),
    ),
  }),
});

const extractSchema = z.object({
  survivingHostiles: z.array(
    z.object({
      id: z.string().regex(/^cp-\d+$/),
      archetype: z.string(),
      name: z.string(),
      status: z.enum(['at-large', 'arrested', 'dead', 'turned']),
      seen: z.array(z.object({ posting: z.number(), city: z.string() })),
    }),
  ),
  assets: z.array(
    z.object({
      person: z.string().regex(/^cp-\d+$/),
      npc: z.object({ id: z.string() }),
      rel: z.object({ trust: z.number() }),
    }),
  ),
  arcClues: z.array(z.object({ clue: z.string(), present: z.boolean() })),
  service: z.string(),
  cityId: z.string(),
});

const postingResultSchema = z.object({
  schema: z.literal(1),
  index: z.number().int().nonnegative(),
  outcome: OutcomeRecordSchema,
  plots: z.array(plotSchema).optional(),
  stats: statsSchema,
  carry: carrySchema,
  debrief: debriefSchema,
  extract: extractSchema,
  plotTemplate: z.string(),
});

/** City-local id suffix. `drop:warehouse` is a location type; `chan:radio` is a channel kind. */
export function localPattern(id: DeadDropId | ChannelId | string): string {
  const mark = id.indexOf(':');
  return mark < 0 ? id : id.slice(mark + 1);
}

/**
 * Fold one posting into a new campaign state. The input state is not modified.
 * An invalid result returns field paths and no new state.
 */
export function carryOver(
  state: CampaignState,
  result: PostingResult,
  content: CampaignContent,
  config: CampaignConfig,
  localTypes: (id: DeadDropId | ChannelId) => string = localPattern,
): Result<CampaignState, CarryInvalid> {
  const parsed = postingResultSchema.safeParse(result);
  if (!parsed.success) {
    return { ok: false, error: { kind: 'invalid', paths: fieldPaths(parsed.error) } };
  }
  const span = yearsOf(state);
  const archived = archivePosting(state, result);
  const dated = advanceCalendar(archived, span.tour + span.lost);
  const progressed = applyOfficerProgress(dated, result, content, config);
  const remembered = mergeServiceDossier(progressed, result, config, localTypes);
  const carried = updateCarriedPersons(remembered, result);
  const arced = withTruth(carried, {
    arcs: advanceArcs(carried.truth.arcs, content.arcs, arcFactsFromPosting(carried, result)),
  });
  return { ok: true, value: stageReview(arced, result, content, config) };
}

function archivePosting(state: CampaignState, result: PostingResult): CampaignState {
  const legend = legendFor(state, result.index);
  const extract = copyExtract(result);
  const visible = {
    index: result.index,
    city: extract.cityId,
    year: state.calendar.year,
    legend,
    rankAtStart: state.view.officer.rank,
    outcome: result.outcome.outcome,
    redacted: result.debrief.redacted,
    stats: result.stats,
    carry: result.carry,
    caseFileRef: `case-file:${result.index}`,
    plotTemplate: result.plotTemplate,
    plots: result.plots,
  };
  return {
    ...state,
    postings: state.postings + 1,
    view: state.view,
    archive: { ...state.archive, visible: [...state.archive.visible, visible] },
    truth: asTruth({
      ...state.truth,
      archive: [
        ...state.truth.archive,
        {
          debrief: {
            outcome: result.debrief.full.outcome,
            cause: result.debrief.full.cause,
            sections: result.debrief.full.sections.map((section) => ({ ...section })),
          },
          extract,
        },
      ],
    }),
  };
}

function advanceCalendar(state: CampaignState, years: number): CampaignState {
  return { ...state, calendar: { year: state.calendar.year + years } };
}

function applyOfficerProgress(
  state: CampaignState,
  result: PostingResult,
  content: CampaignContent,
  config: CampaignConfig,
): CampaignState {
  const officer = state.view.officer;
  const burned = result.outcome.outcome === 'failure-burned' || result.outcome.cover.blown;
  const events = { burned, assetArrested: false, captured: false };
  const skills = growSkills(officer.skills, result.stats, content.skills);
  const stress = applyStress(officer.stress, events, config.stress);
  const traits = applyTraitTriggers(officer.traits, stress, events, content.traits);
  const legend = legendFor(state, result.index);
  const observed = result.carry.observedBurns.includes(legend) && result.outcome.cover.blown;
  return withOfficer(state, {
    ...officer,
    skills,
    stress,
    traits,
    legends: officer.legends.map((row) => {
      if (row.id !== legend || !observed || row.observedBurnedBy.includes(result.extract.service)) {
        return row;
      }
      return { ...row, observedBurnedBy: [...row.observedBurnedBy, result.extract.service] };
    }),
  });
}

function mergeServiceDossier(
  state: CampaignState,
  result: PostingResult,
  config: CampaignConfig,
  localTypes: (id: DeadDropId | ChannelId) => string,
): CampaignState {
  const service = result.extract.service;
  const current = state.truth.dossiers[service] ?? emptyDossier(service);
  const merged = mergeHostileMemory(
    current,
    result.outcome.hostileMemory,
    result.outcome.cover,
    legendFor(state, result.index),
    localTypes,
    config.carry.maxDoctrineShift,
  );
  return withTruth(state, { dossiers: { ...state.truth.dossiers, [service]: merged } });
}

function updateCarriedPersons(state: CampaignState, result: PostingResult): CampaignState {
  const city = result.extract.cityId;
  const stagedAssets = result.outcome.survivingAssets.flatMap((asset) => {
    const carried = carriedAsset(asset, city, state.calendar.year, result.index);
    return carried === undefined ? [] : [carried];
  });
  const views = stagedAssets.map(assetView);
  return {
    ...withTruth(state, {
      carriedHostiles: mergeHostiles(state.truth.carriedHostiles, result.extract.survivingHostiles),
      stagedAssets,
      // Brought assets were injected into the posting just folded. They do not
      // travel into the one after it.
      brought: [],
    }),
    view: {
      ...state.view,
      staged: { ...state.view.staged, assets: views },
    },
  };
}

function stageReview(
  state: CampaignState,
  result: PostingResult,
  content: CampaignContent,
  config: CampaignConfig,
): CampaignState {
  const officer = state.view.officer;
  const score = careerScore(
    {
      outcome: result.outcome.outcome,
      standing: result.outcome.standing,
      directives: result.outcome.directives,
      arrestsWrongful: result.stats.arrestsWrongful,
      assetsLost: 0,
    },
    officer,
    config.review.weights,
  );
  const reviewed = applyReview(
    officer,
    score,
    result.outcome.standing,
    content.ranks,
    content.texts,
    config.review.dismissalFloor,
  );
  if (!reviewed.ok) {
    return state;
  }
  return withOfficer(
    {
      ...state,
      step: { kind: 'debrief' },
      view: {
        ...state.view,
        staged: {
          ...state.view.staged,
          review: {
            score: reviewed.value.score,
            decision: reviewed.value.decision,
            text: reviewed.value.cable.body,
          },
        },
      },
    },
    { ...officer, careerStanding: reviewed.value.careerStanding },
  );
}

function yearsOf(state: CampaignState): { readonly tour: number; readonly lost: number } {
  const offer = state.view.offers.find((row) => row.id === state.view.chosen);
  const capture = state.view.staged.capture;
  const lost = capture !== undefined && capture.kind !== 'death' ? capture.yearsLost : 0;
  return { tour: offer?.tourYears ?? 0, lost };
}

function legendFor(state: CampaignState, index: number): LegendId {
  const legends = state.view.officer.legends;
  const match = legends.find((legend) => legend.posting === index);
  return match?.id ?? legends[legends.length - 1]?.id ?? `lg-${index}`;
}

function emptyDossier(service: ServiceId): HostileDossier {
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

function carriedAsset(
  asset: PostingResult['outcome']['survivingAssets'][number],
  city: string,
  leftYear: number,
  posting: number,
): CarriedAsset | undefined {
  const id = campaignPerson(asset.npc);
  if (id === undefined) {
    return undefined;
  }
  const [given, ...rest] = asset.persona.name.split(' ');
  const family = rest.join(' ');
  return {
    person: {
      id,
      archetype: asset.archetype,
      name: asset.persona.name,
      aliases: [],
      persona: {
        name: asset.persona.name,
        given: given ?? asset.persona.name,
        family: family === '' ? (given ?? asset.persona.name) : family,
        library: '',
        culture: asset.persona.culture,
        gender: 'female',
        voiceTraits: [],
        mannerisms: [],
        background: asset.persona.background,
        openness: 0.5,
      },
      descriptor: asset.persona.name,
      allegiance: { true: '', apparent: '' },
      mice: asTruth({
        money: asset.lever === 'money' ? 1 : 0,
        ideology: asset.lever === 'ideology' ? 1 : 0,
        coercion: asset.lever === 'coercion' ? 1 : 0,
        ego: asset.lever === 'ego' ? 1 : 0,
      }),
      loyalty: 0,
      status: 'at-large',
      seen: [{ posting, city }],
    },
    trust: asset.trust,
    exposure: asset.exposure,
    reliability: 0,
    hostileControlled: asset.doubled,
    turned: false,
    lever: asset.lever,
    city,
    leftYear,
  };
}

function assetView(asset: CarriedAsset): CarriedAssetView {
  return {
    id: asset.person.id,
    name: asset.person.name,
    rapport: asset.trust >= 0.66 ? 'trusted' : asset.trust >= 0.33 ? 'warm' : 'wary',
    history: `${asset.city}, ${asset.leftYear}`,
  };
}

function mergeHostiles(current: readonly CarriedNpc[], incoming: readonly CarriedNpc[]): CarriedNpc[] {
  const next = [...current];
  for (const hostile of incoming) {
    const index = next.findIndex((row) => row.id === hostile.id);
    if (index < 0) {
      next.push(hostile);
    } else {
      next[index] = hostile;
    }
  }
  return next;
}

function copyExtract(result: PostingResult): PostingTruthExtract {
  return {
    survivingHostiles: [...result.extract.survivingHostiles],
    assets: result.extract.assets.map((asset) => ({ ...asset })),
    arcClues: result.extract.arcClues.map((clue) => ({ ...clue })),
    service: result.extract.service,
    cityId: result.extract.cityId,
  };
}

function campaignPerson(id: string): `cp-${number}` | undefined {
  const bare = id.startsWith('npc:') ? id.slice(4) : id;
  const match = /^cp-(\d+)$/.exec(bare);
  if (match?.[1] === undefined) {
    return undefined;
  }
  return `cp-${Number(match[1])}`;
}

function withOfficer(state: CampaignState, officer: Officer): CampaignState {
  return { ...state, view: { ...state.view, officer } };
}

function withTruth(state: CampaignState, patch: Partial<CampaignTruth>): CampaignState {
  return { ...state, truth: asTruth({ ...state.truth, ...patch }) };
}

interface Issue {
  readonly path: readonly PropertyKey[];
  readonly errors?: readonly (readonly Issue[])[];
  readonly unionErrors?: readonly { readonly issues: readonly Issue[] }[];
}

function fieldPaths(error: z.ZodError): string[] {
  const out: string[] = [];
  collect(error.issues as Issue[], [], out);
  return [...new Set(out)];
}

function collect(issues: readonly Issue[], prefix: readonly string[], out: string[]): void {
  for (const issue of issues) {
    const path = [...prefix, ...issue.path.map(String)];
    const branches = issue.unionErrors?.map((branch) => branch.issues) ?? issue.errors;
    if (branches !== undefined && branches.length > 0) {
      for (const branch of branches) {
        collect(branch, path, out);
      }
      continue;
    }
    out.push(path.length === 0 ? '(root)' : path.join('.'));
  }
}

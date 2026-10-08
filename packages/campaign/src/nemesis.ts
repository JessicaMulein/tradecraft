/**
 * Nemesis (design, "Arc engine"; Requirements 15.1–15.5).
 *
 * When the arc activates, a surviving at-large hostile officer is chosen on
 * the campaign stream. If none is left, one is minted for this service.
 * While the stage's conditions hold, that officer is placed as a principal of
 * the hostile service and as a recogniser. Surviving a posting raises rank by
 * one, up to 5, and raises securityConsciousness and tradecraft by 0.1, up to
 * 0.9. Arrest, turning, or death resolves the arc through person-status.
 * A stage with `allowsPitch` schedules a walk-in or a drop letter and
 * registers a defection offer. Accepting it waits for the End Offers step.
 */

import { asTruth, type Prng } from '@tradecraft/engine';

import { activeArcThreads, type ArcFacts } from './arcs.js';
import type { ArcTemplate, ArcThreadTemplate } from './content/schemas.js';
import type { CampaignPersonId, CampaignTruth, CarriedNpc, CarryIn } from './state.js';

/** Rank stops here. The design names a cap and does not number it. */
export const NEMESIS_RANK_CAP = 5;

/** Added to each doctrine skill when the nemesis survives. */
export const NEMESIS_SKILL_STEP = 0.1;

/** Doctrine skills do not rise past this. */
export const NEMESIS_SKILL_CAP = 0.9;

/** The drop letter scheduled by a pitch. */
export const NEMESIS_PITCH_DOCUMENT = 'doc:nemesis-pitch';

const OFFICER_ARCHETYPES = ['hostile-case-officer', 'hostile-officer'] as const;

export type NemesisPitch =
  | { readonly kind: 'walk-in' }
  | { readonly kind: 'drop-letter'; readonly document: typeof NEMESIS_PITCH_DOCUMENT };

export interface NemesisChoice {
  readonly hostiles: readonly CarriedNpc[];
  readonly id: CampaignPersonId;
  readonly nextPerson: number;
  readonly generated: boolean;
}

/** Choose a surviving hostile officer, or mint one on this service. */
export function selectNemesis(
  hostiles: readonly CarriedNpc[],
  archetype: string,
  service: string,
  city: string,
  posting: number,
  nextPerson: number,
  rng: Prng,
): NemesisChoice {
  const living = hostiles
    .filter((person) => person.status === 'at-large' && isHostileOfficer(person.archetype))
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id));
  if (living.length > 0) {
    const chosen = rng.pick(living);
    return { hostiles, id: chosen.id, nextPerson, generated: false };
  }
  const id: CampaignPersonId = `cp-${nextPerson}`;
  const person = mintNemesis(id, archetype, service, city, posting);
  return { hostiles: [...hostiles, person], id, nextPerson: nextPerson + 1, generated: true };
}

/**
 * Principal and recogniser placements while the nemesis stage's conditions
 * hold for this posting. An idle or resolved arc places no one.
 */
export function placeNemesis(
  arcs: CampaignTruth['arcs'],
  templates: readonly ArcTemplate[],
  threads: readonly ArcThreadTemplate[],
  person: CarriedNpc | undefined,
  facts: ArcFacts,
): CarryIn['placements'] {
  if (person === undefined) {
    return [];
  }
  const active = activeArcThreads(arcs, templates, threads, facts).some((thread) => sameId(thread.arc, 'nemesis'));
  if (!active) {
    return [];
  }
  const priority = templates.find((template) => sameId(template.id, 'nemesis'))?.priority ?? 2;
  return [
    { person, as: 'nemesis', contact: false, optional: false, priority },
    { person, as: 'recogniser', contact: false, optional: false, priority },
  ];
}

/** Raise rank and doctrine after a posting the nemesis survived. */
export function growNemesis(person: CarriedNpc): CarriedNpc {
  if (person.status !== 'at-large') {
    return person;
  }
  const rank = Math.min(NEMESIS_RANK_CAP, (person.rank ?? 1) + 1);
  const securityConsciousness = capSkill((person.securityConsciousness ?? 0) + NEMESIS_SKILL_STEP);
  const tradecraft = capSkill((person.tradecraft ?? 0) + NEMESIS_SKILL_STEP);
  return { ...person, rank, securityConsciousness, tradecraft };
}

/**
 * Apply the posting's outcome. Survival grows the officer. Arrest, turning,
 * or death records that status and leaves rank and doctrine where they were.
 */
export function settleNemesis(person: CarriedNpc, status: CarriedNpc['status']): CarriedNpc {
  if (status === 'at-large') {
    return growNemesis({ ...person, status: 'at-large' });
  }
  if (person.status === status) {
    return person;
  }
  return { ...person, status };
}

/** A pitch on a stage that allows one. The draw is the campaign stream. */
export function scheduleNemesisPitch(
  template: ArcTemplate,
  stageId: string,
  rng: Prng,
): NemesisPitch | undefined {
  const stage = template.stages.find((item) => sameId(item.id, stageId));
  if (stage === undefined || !stage.allowsPitch) {
    return undefined;
  }
  if (rng.bool()) {
    return { kind: 'walk-in' };
  }
  return { kind: 'drop-letter', document: NEMESIS_PITCH_DOCUMENT };
}

/** Record the pitch so the next End Offers step can accept defection. */
export function registerDefectionOffer(
  offers: readonly ('retire' | 'defect')[],
): readonly ('retire' | 'defect')[] {
  if (offers.includes('defect')) {
    return offers;
  }
  return [...offers, 'defect'];
}

function mintNemesis(
  id: CampaignPersonId,
  archetype: string,
  service: string,
  city: string,
  posting: number,
): CarriedNpc {
  const name = `Rival ${id}`;
  return {
    id,
    archetype,
    name,
    aliases: [],
    persona: {
      name,
      given: 'Rival',
      family: id,
      library: '',
      culture: '',
      gender: 'male',
      voiceTraits: [],
      mannerisms: [],
      background: 'officer',
      openness: 0.5,
    },
    descriptor: 'a hostile officer',
    allegiance: { true: service, apparent: service },
    mice: asTruth({ money: 0, ideology: 1, coercion: 0, ego: 0 }),
    loyalty: 0.5,
    service,
    rank: 1,
    securityConsciousness: 0,
    tradecraft: 0,
    status: 'at-large',
    seen: [{ posting, city }],
  };
}

function capSkill(value: number): number {
  const stepped = Math.round(value * 10) / 10;
  return Math.min(NEMESIS_SKILL_CAP, Math.max(0, stepped));
}

function isHostileOfficer(archetype: string): boolean {
  return OFFICER_ARCHETYPES.some((id) => sameId(archetype, id));
}

function sameId(left: string, right: string): boolean {
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}

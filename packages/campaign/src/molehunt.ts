/**
 * Mole Hunt (design, "Mole Hunt"; Requirements 16.2–16.6).
 *
 * Between postings, a mole who can see legends may burn the next legend into
 * the active service's dossier. That uses the same known-cover notoriety the
 * dossier already adds, so starting cover suspicion rises, and the burn stays
 * out of the officer's view. A mole who can see directives shifts that
 * service's doctrine toward the directive theme. The design does not number
 * the shift or the accusation rewards. The shift is 0.1, clamped to the
 * dossier cap. A correct accusation adds 2 Career Standing and 1 Security
 * reputation. A wrong one costs 1 Security reputation.
 *
 * `moleEvidence` counts distinct corroborated claims that name the figure.
 * That is the slice design's evidence count (distinct predicate, subject,
 * object and place) over player-held claims. It does not read Campaign Truth.
 * The accusation cable is the fixed accusation template and names only the
 * accused.
 */

import type { HostileDoctrine, Prng, Proposition } from '@tradecraft/engine';

import { activeArcThreads, type ArcFacts } from './arcs.js';
import type { ArcTemplate, ArcThreadTemplate, CampaignText } from './content/schemas.js';
import { NOTORIETY_KNOWN_COVER } from './dossier.js';
import { renderTemplate } from './review.js';
import type {
  CampaignPersonId,
  CampaignTruth,
  CarryClaim,
  HqCastView,
  HqFigure,
  HostileDossier,
  LegendId,
  Officer,
} from './state.js';

/** Doctrine moved toward a directive theme. The design names the shift and does not number it. */
export const MOLE_DOCTRINE_STEP = 0.1;

/** Career Standing added when the accusation names the mole. */
export const ACCUSATION_STANDING = 2;

/** Security reputation added on a correct accusation and removed on a wrong one. */
export const ACCUSATION_REPUTATION = 1;

/** The faction a mole accusation moves. */
export const SECURITY_FACTION = 'security';

/** Shown when the held claims do not reach the content threshold. */
export const ACCUSATION_REFUSAL = 'The archive does not yet hold enough on that officer.';

/** Shown when the named figure is not in the HQ cast. */
export const ACCUSATION_UNKNOWN = 'That officer is not at headquarters.';

/**
 * Which doctrine dimension a directive theme pushes. Themes are not authored
 * as doctrine, so this map is the campaign's reading of each theme.
 */
const THEME_DOCTRINE: Readonly<Record<string, keyof HostileDoctrine>> = {
  surveillance: 'securityConsciousness',
  recruitment: 'deceptionAppetite',
  sabotage: 'riskTolerance',
  exfiltration: 'deceptionAppetite',
};

export interface MoleLeakInput {
  readonly dossiers: Readonly<Record<string, HostileDossier>>;
  readonly service: string;
  /** Absent once a correct accusation has removed the mole. */
  readonly mole: HqFigure | undefined;
  /** The legend the next posting would use. */
  readonly legend?: LegendId;
  /** The directive theme of the next posting. */
  readonly theme?: string;
  /** Probability a legend leak lands. Directive access does not roll. */
  readonly leak: number;
  readonly maxDoctrineShift: number;
  readonly rng: Prng;
}

export interface MoleClueSpec {
  readonly id: string;
  readonly prop: Proposition;
}

export interface MoleThreadSpec {
  readonly arc: string;
  readonly template: string;
  readonly bindings: Readonly<Record<string, CampaignPersonId>>;
  readonly clues: readonly MoleClueSpec[];
  readonly priority: number;
  /** The HQ figure placed as a visitor while this thread runs. */
  readonly visitor?: CampaignPersonId;
}

export interface AccusationInput {
  readonly officer: Officer;
  readonly figure: CampaignPersonId;
  readonly figureName: string;
  readonly mole: CampaignPersonId;
  readonly hqFigures: readonly HqFigure[];
  readonly hqCast: readonly HqCastView[];
  readonly arcs: CampaignTruth['arcs'];
  readonly moleArc: ArcTemplate;
  readonly claims: readonly CarryClaim[];
  readonly threshold: number;
  readonly texts: readonly CampaignText[];
}

export interface AccusationApplied {
  readonly correct: boolean;
  readonly officer: Officer;
  readonly hqFigures: readonly HqFigure[];
  readonly hqCast: readonly HqCastView[];
  readonly arcs: CampaignTruth['arcs'];
  readonly cable: { readonly title: string; readonly body: string };
}

/**
 * Fold one between-posting leak into the active service's dossier.
 * An absent mole, or a mole with no relevant access, returns the same record.
 */
export function applyMoleLeaks(input: MoleLeakInput): Readonly<Record<string, HostileDossier>> {
  const { mole } = input;
  if (mole === undefined) {
    return input.dossiers;
  }
  const seesLegends = mole.access.includes('legends');
  const seesDirectives = mole.access.includes('directives');
  if (!seesLegends && !seesDirectives) {
    return input.dossiers;
  }
  let dossier = input.dossiers[input.service] ?? emptyDossier(input.service);
  let changed = false;
  if (seesLegends && input.rng.next() < input.leak && input.legend !== undefined) {
    const burned = burnLegend(dossier, input.legend);
    changed = changed || burned !== dossier;
    dossier = burned;
  }
  if (seesDirectives) {
    const shifted = shiftDoctrine(dossier, input.theme, input.maxDoctrineShift);
    changed = changed || shifted !== dossier;
    dossier = shifted;
  }
  if (!changed) {
    return input.dossiers;
  }
  return { ...input.dossiers, [input.service]: dossier };
}

/**
 * Mole Hunt threads for this posting. Each clue is a proposition in the
 * thread's own predicate, with the bound HQ figure as the subject and the
 * hostile service as the object.
 */
export function moleHuntThreads(
  arcs: CampaignTruth['arcs'],
  templates: readonly ArcTemplate[],
  threads: readonly ArcThreadTemplate[],
  facts: ArcFacts,
  service: string,
): readonly MoleThreadSpec[] {
  const specs: MoleThreadSpec[] = [];
  for (const active of activeArcThreads(arcs, templates, threads, facts)) {
    if (!sameId(active.arc, 'mole-hunt')) {
      continue;
    }
    const thread = threads.find((item) => sameId(item.id, active.template));
    const visitor = moleVisitor(thread, active.bindings);
    const clues: MoleClueSpec[] = [];
    if (thread !== undefined && visitor !== undefined) {
      for (const clue of thread.clues) {
        clues.push({ id: clue.id, prop: clueProp(clue.id, clue.prop, visitor, service) });
      }
    }
    specs.push({
      arc: active.arc,
      template: active.template,
      bindings: active.bindings,
      clues,
      priority: active.priority,
      ...(visitor === undefined ? {} : { visitor }),
    });
  }
  return specs;
}

/**
 * Distinct corroborated claims that name `figure`, alias-resolved inside the
 * claim set. Duplicate propositions count once. Truth is not an argument.
 */
export function moleEvidence(claims: readonly CarryClaim[], figure: CampaignPersonId): number {
  const canon = aliasCanon(claims);
  const target = canon(npcId(figure));
  const seen = new Set<string>();
  for (const claim of claims) {
    if (claim.relation !== 'corroborated' || !namesFigure(claim, target, canon)) {
      continue;
    }
    const predicate = localName(claim.prop.predicate);
    const subject = canon(claim.prop.subject);
    const object = objectKey(claim, canon);
    const place = claim.prop.place ?? '';
    seen.add(`${predicate}\u0000${subject}\u0000${object}\u0000${place}`);
  }
  return seen.size;
}

/** The gate. It compares held claims with the threshold and does not learn the mole. */
export function quoteAccusation(
  claims: readonly CarryClaim[],
  figure: CampaignPersonId,
  threshold: number,
): { readonly allowed: boolean; readonly evidence: number; readonly reason?: string } {
  const evidence = moleEvidence(claims, figure);
  if (evidence < threshold) {
    return { allowed: false, evidence, reason: ACCUSATION_REFUSAL };
  }
  return { allowed: true, evidence };
}

/**
 * Apply an accusation that has already cleared the evidence gate.
 * Correct: resolve the arc, reward standing and Security, and drop the mole
 * from the cast so later leaks stop. Wrong: one reprimand, lower Security,
 * and the same cable. The cable names only the accused.
 */
export function applyAccusation(
  input: AccusationInput,
): { readonly ok: true; readonly value: AccusationApplied } | { readonly ok: false; readonly reason: string } {
  const quote = quoteAccusation(input.claims, input.figure, input.threshold);
  if (!quote.allowed) {
    return { ok: false, reason: quote.reason ?? ACCUSATION_REFUSAL };
  }
  if (!input.hqCast.some((figure) => figure.id === input.figure)) {
    return { ok: false, reason: ACCUSATION_UNKNOWN };
  }
  const template = input.texts.find((text) => text.use === 'accusation');
  if (template === undefined) {
    return { ok: false, reason: 'no accusation cable template' };
  }
  const cable = renderTemplate(template, { name: input.figureName });
  const correct = input.figure === input.mole;
  const reputation = (input.officer.factions[SECURITY_FACTION] ?? 0) + (correct ? ACCUSATION_REPUTATION : -ACCUSATION_REPUTATION);
  const officer: Officer = {
    ...input.officer,
    careerStanding: input.officer.careerStanding + (correct ? ACCUSATION_STANDING : 0),
    reprimands: input.officer.reprimands + (correct ? 0 : 1),
    factions: { ...input.officer.factions, [SECURITY_FACTION]: reputation },
  };
  if (!correct) {
    return {
      ok: true,
      value: {
        correct: false,
        officer,
        hqFigures: input.hqFigures,
        hqCast: input.hqCast,
        arcs: input.arcs,
        cable,
      },
    };
  }
  return {
    ok: true,
    value: {
      correct: true,
      officer,
      hqFigures: input.hqFigures.filter((figure) => figure.id !== input.mole),
      hqCast: input.hqCast.filter((figure) => figure.id !== input.mole),
      arcs: resolveMole(input.arcs, input.moleArc),
      cable,
    },
  };
}

function burnLegend(dossier: HostileDossier, legend: LegendId): HostileDossier {
  if (dossier.burnedLegends.includes(legend)) {
    return dossier;
  }
  return {
    ...dossier,
    descriptorKnown: true,
    burnedLegends: [...dossier.burnedLegends, legend],
    notoriety: Math.min(1, dossier.notoriety + NOTORIETY_KNOWN_COVER),
  };
}

function shiftDoctrine(dossier: HostileDossier, theme: string | undefined, cap: number): HostileDossier {
  if (theme === undefined) {
    return dossier;
  }
  const key = THEME_DOCTRINE[theme];
  if (key === undefined) {
    return dossier;
  }
  const current = dossier.doctrineShift[key] ?? 0;
  const next = Math.min(cap, Math.max(-cap, Math.round((current + MOLE_DOCTRINE_STEP) * 10) / 10));
  if (next === current) {
    return dossier;
  }
  return { ...dossier, doctrineShift: { ...dossier.doctrineShift, [key]: next } };
}

function clueProp(id: string, predicate: string, figure: CampaignPersonId, service: string): Proposition {
  return {
    id: `prop:${id}`,
    subject: npcId(figure),
    predicate,
    object: orgId(service),
  };
}

function moleVisitor(
  thread: ArcThreadTemplate | undefined,
  bindings: Readonly<Record<string, CampaignPersonId>>,
): CampaignPersonId | undefined {
  const slot = thread?.slots.find((item) => sameId(item.binding, 'mole'));
  if (slot !== undefined) {
    return bindings[slot.id];
  }
  return undefined;
}

function resolveMole(arcs: CampaignTruth['arcs'], template: ArcTemplate): CampaignTruth['arcs'] {
  const current = lookup(arcs, template.id);
  if (current === undefined) {
    return arcs;
  }
  const clues: Record<string, boolean> = { ...current.clues };
  let added = false;
  for (const condition of template.resolve) {
    if (condition.kind === 'clue-held' && clues[condition.clue] !== true) {
      clues[condition.clue] = true;
      added = true;
    }
  }
  if (!added) {
    return arcs;
  }
  const id = Object.keys(arcs).find((key) => sameId(key, template.id)) ?? template.id;
  return { ...arcs, [id]: { ...current, clues } };
}

function namesFigure(claim: CarryClaim, target: string, canon: (id: string) => string): boolean {
  if (canon(claim.prop.subject) === target) {
    return true;
  }
  const { object } = claim.prop;
  return typeof object === 'string' && object.startsWith('npc:') && canon(object) === target;
}

function aliasCanon(claims: readonly CarryClaim[]): (id: string) => string {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const next = parent.get(id);
    if (next === undefined || next === id) {
      parent.set(id, id);
      return id;
    }
    const root = find(next);
    parent.set(id, root);
    return root;
  };
  const unite = (left: string, right: string): void => {
    const a = find(left);
    const b = find(right);
    if (a === b) {
      return;
    }
    if (a < b) {
      parent.set(b, a);
    } else {
      parent.set(a, b);
    }
  };
  for (const claim of claims) {
    if (!sameId(localName(claim.prop.predicate), 'IS_ALIAS_OF')) {
      continue;
    }
    const { object } = claim.prop;
    if (typeof object !== 'string' || !object.includes(':')) {
      continue;
    }
    unite(claim.prop.subject, object);
  }
  return (id: string) => find(id);
}

function objectKey(claim: CarryClaim, canon: (id: string) => string): string {
  const { object } = claim.prop;
  if (typeof object === 'string') {
    return object.includes(':') ? canon(object) : object;
  }
  return `${object.kind}:${JSON.stringify(object.value)}`;
}

function npcId(figure: CampaignPersonId): `npc:${string}` {
  return figure.startsWith('npc:') ? (figure as `npc:${string}`) : `npc:${figure}`;
}

function orgId(service: string): `org:${string}` {
  const local = service.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'service';
  return `org:${local}`;
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

function lookup(arcs: CampaignTruth['arcs'], id: string): CampaignTruth['arcs'][string] | undefined {
  if (arcs[id] !== undefined) {
    return arcs[id];
  }
  for (const [key, arc] of Object.entries(arcs)) {
    if (sameId(key, id)) {
      return arc;
    }
  }
  return undefined;
}

function localName(predicate: string): string {
  const slash = predicate.lastIndexOf('/');
  return slash === -1 ? predicate : predicate.slice(slash + 1);
}

function sameId(left: string, right: string): boolean {
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}

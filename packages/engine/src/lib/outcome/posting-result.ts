/**
 * Posting Result (design, "Posting Result"; Requirements 5.3, 6.5, 7.3, 7.5, 21.6).
 *
 * Stats come from the action log paired with each action's result. Carry comes
 * from the player view and the case file. The truth extract and the unidentified
 * map are the only places a carry ref is tied to an NPC. A protected debrief
 * item stays visible when the case file already corroborated that proposition.
 * A schema-1 outcome record becomes schema 2 with one primary plot; a `region`
 * block is dropped.
 */

import { ARREST_LINE } from '../action/arrest.js';
import type { ActionResult } from '../action/result.js';
import { MADE_FACT_LINE } from '../action/surveil.js';
import { TURN_ACCEPT_LINE } from '../action/turn-agent.js';
import {
  OUTCOME_RECORD_SCHEMA_V2,
  type OutcomePlotRecord,
  type OutcomeRecord,
} from '../endings/outcome-record.js';
import { asTruth, type Proposition, type Truth } from '../model/core.js';
import type { ActionLogEntry } from '../model/state.js';

export interface PostingStats {
  readonly decrypts: number;
  readonly recruits: number;
  readonly turned: number;
  readonly surveilObservations: number;
  readonly followsCompleted: number;
  readonly arrestsCorrect: number;
  readonly arrestsWrongful: number;
  readonly madeFactLines: number;
  readonly meetingsHeld: number;
  readonly dropsServiced: number;
}

export interface DebriefFact {
  readonly text: string;
  /** Entity ids this item names. An item with none is never protected. */
  readonly entities?: readonly string[];
  readonly prop?: Proposition;
}

export interface PostedDebrief {
  readonly outcome: string;
  readonly cause: string;
  readonly sections: readonly {
    readonly id: string;
    readonly items: readonly DebriefFact[];
  }[];
}

export type RedactedItem =
  | { readonly kind: 'shown'; readonly item: { readonly text: string } }
  | { readonly kind: 'redacted'; readonly ref: string };

export interface RedactedDebrief {
  readonly sections: readonly {
    readonly id: string;
    readonly items: readonly RedactedItem[];
  }[];
}

export interface CarryClaim {
  readonly id: string;
  readonly prop: Proposition;
  readonly text: string;
  readonly relation: 'none' | 'corroborated' | 'conflicted';
}

/** One person as the player view listed them at the end of the posting. */
export interface CarryPerson {
  readonly id: string;
  readonly carryEligible: boolean;
  readonly identified: boolean;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly descriptor: string;
  readonly apparentAffiliation?: string;
  readonly sightings: readonly { readonly city: string; readonly year: number }[];
}

export interface CarryView {
  readonly persons: readonly CarryPerson[];
  readonly observedBurns: readonly string[];
}

export interface CarryCaseFile {
  readonly claims: readonly CarryClaim[];
  readonly grades: readonly { readonly source: string; readonly grade: string }[];
  readonly notes: readonly {
    readonly seq: number;
    readonly at: { readonly day: number; readonly phase: number };
    readonly attachTo: number | string;
    readonly text: string;
  }[];
}

export interface PlayerCarry {
  readonly identified: readonly {
    readonly person: string;
    readonly name: string;
    readonly aliases: readonly string[];
    readonly apparentAffiliation?: string;
  }[];
  readonly unidentified: readonly {
    readonly person: string;
    readonly descriptor: string;
    readonly sightings: readonly { readonly city: string; readonly year: number }[];
  }[];
  readonly heldClaims: readonly CarryClaim[];
  readonly grades: CarryCaseFile['grades'];
  readonly notes: CarryCaseFile['notes'];
  readonly observedBurns: readonly string[];
}

export interface PostedHostile {
  readonly id: string;
  readonly status: 'at-large' | 'arrested' | 'dead' | 'turned';
}

export interface PostedAsset {
  readonly person: string;
  readonly npc: string;
  readonly rel: { readonly access?: readonly string[] };
}

export interface PostingTruthExtract {
  readonly survivingHostiles: readonly PostedHostile[];
  readonly assets: readonly PostedAsset[];
  readonly arcClues: readonly { readonly clue: string; readonly present: boolean }[];
  /** Campaign ref to the NPC the player only knew as an Unidentified Subject. */
  readonly unidentified: readonly { readonly ref: string; readonly npc: string }[];
  readonly service: string;
  readonly cityId: string;
}

export interface BuiltPostingResult {
  readonly schema: 1;
  readonly index: number;
  readonly outcome: OutcomeRecord;
  readonly plots: readonly OutcomePlotRecord[];
  readonly stats: PostingStats;
  readonly carry: PlayerCarry;
  readonly debrief: { readonly full: Truth<PostedDebrief>; readonly redacted: RedactedDebrief };
  readonly extract: Truth<PostingTruthExtract>;
  readonly plotTemplate: string;
}

export interface BuildPostingResultInput {
  readonly index: number;
  readonly plotTemplate: string;
  readonly outcome: OutcomeRecord & { readonly region?: unknown };
  readonly log: readonly ActionLogEntry[];
  readonly results: readonly ActionResult[];
  /**
   * Station standing after each action result, in result order. A drop marks
   * that arrest wrongful. The slice uses one sentence for both kinds of arrest.
   */
  readonly standingStart?: number;
  readonly standingAfter?: readonly (number | undefined)[];
  readonly view: CarryView;
  readonly caseFile: CarryCaseFile;
  readonly debrief: PostedDebrief;
  readonly protectedIds: ReadonlySet<string>;
  /** Player-facing id (usually `unk:N`) to the NPC id. Read for the extract only. */
  readonly identities: Readonly<Record<string, string>>;
  readonly hostiles: readonly PostedHostile[];
  readonly assets: readonly PostedAsset[];
  readonly arcClues: readonly { readonly clue: string; readonly present: boolean }[];
  readonly service: string;
  readonly cityId: string;
}

const EMPTY_STATS: PostingStats = {
  decrypts: 0,
  recruits: 0,
  turned: 0,
  surveilObservations: 0,
  followsCompleted: 0,
  arrestsCorrect: 0,
  arrestsWrongful: 0,
  madeFactLines: 0,
  meetingsHeld: 0,
  dropsServiced: 0,
};

/** Counts from the action log and the paired action results. Nothing else. */
export function postingStats(
  log: readonly ActionLogEntry[],
  results: readonly ActionResult[],
  standingStart = 0,
  standingAfter: readonly (number | undefined)[] = [],
): PostingStats {
  const stats = { ...EMPTY_STATS };
  let standing = standingStart;
  let resultIndex = 0;
  for (const entry of log) {
    if (entry.kind !== 'action') {
      continue;
    }
    const result = results[resultIndex];
    const after = standingAfter[resultIndex];
    resultIndex += 1;
    if (result === undefined) {
      continue;
    }
    const action = entry.action;
    if (action.kind === 'decrypt' && brokeIntercept(result)) {
      stats.decrypts += 1;
    }
    if (action.kind === 'surveil') {
      stats.surveilObservations += propositionCount(result);
    }
    if (action.kind === 'follow' && result.factLines.length > 0) {
      stats.followsCompleted += 1;
    }
    if (action.kind === 'turn-agent' && result.factLines.includes(TURN_ACCEPT_LINE)) {
      stats.turned += 1;
    }
    if (action.kind === 'arrest' && result.factLines.includes(ARREST_LINE)) {
      if (after !== undefined && after < standing) {
        stats.arrestsWrongful += 1;
      } else {
        stats.arrestsCorrect += 1;
      }
    }
    stats.madeFactLines += result.factLines.filter((line) => line === MADE_FACT_LINE).length;
    stats.meetingsHeld += result.events.filter((event) => event.kind === 'meeting-due').length;
    if (action.kind === 'service-drop' || action.kind === 'task') {
      stats.dropsServiced += result.events.filter(
        (event) => event.kind === 'drop-loaded' || event.kind === 'drop-emptied',
      ).length;
    }
    if (after !== undefined) {
      standing = after;
    }
  }
  return stats;
}

/**
 * Schema 2 is kept, aside from a dropped `region` block. Schema 1 gains one
 * primary `plots[]` entry from the posting's plot template.
 */
export function normaliseOutcome(
  record: OutcomeRecord & { readonly region?: unknown },
  plotTemplate: string,
): OutcomeRecord {
  const rest: OutcomeRecord = { ...record };
  delete (rest as { region?: unknown }).region;
  const plots =
    rest.schema === OUTCOME_RECORD_SCHEMA_V2 && rest.plots !== undefined
      ? rest.plots
      : [
          {
            templateId: plotTemplate,
            variantKey: plotTemplate,
            archetype: plotTemplate,
            role: 'primary' as const,
            outcome: rest.outcome,
          },
        ];
  return {
    ...rest,
    schema: OUTCOME_RECORD_SCHEMA_V2,
    plots,
    selection: rest.selection ?? { historyHash: '' },
  };
}

/**
 * The archive reveal after the campaign ends. Every item of every full debrief
 * is returned, including items the redacted view hid.
 */
export function revealDebriefs(debriefs: readonly PostedDebrief[]): readonly PostedDebrief[] {
  return debriefs.map((debrief) => ({
    outcome: debrief.outcome,
    cause: debrief.cause,
    sections: debrief.sections.map((section) => ({
      id: section.id,
      items: section.items.map((item) => ({ ...item })),
    })),
  }));
}

/** Show an item unless it names a protected entity the case file has not corroborated. */
export function redactDebrief(
  debrief: PostedDebrief,
  protectedIds: ReadonlySet<string>,
  claims: readonly CarryClaim[],
): RedactedDebrief {
  return {
    sections: debrief.sections.map((section) => ({
      id: section.id,
      items: section.items.map((item, index): RedactedItem => {
        const named = item.entities ?? [];
        const protectedItem = named.some((entity) => protectedIds.has(entity));
        if (!protectedItem || corroborated(item.prop, claims)) {
          return { kind: 'shown', item: { text: item.text } };
        }
        return { kind: 'redacted', ref: `redacted:${section.id}:${index}` };
      }),
    })),
  };
}

/** View and case file only. Unidentified persons get opaque `cu-` refs. */
export function buildPlayerCarry(view: CarryView, caseFile: CarryCaseFile): PlayerCarry {
  const eligible = view.persons.filter((person) => person.carryEligible);
  const identified = eligible.filter((person) => person.identified);
  const unidentified = eligible.filter((person) => !person.identified);
  const known = new Set<string>([
    ...identified.map((person) => person.id),
    ...unidentified.map((person) => person.id),
  ]);
  return {
    identified: identified.map((person) => ({
      person: person.id,
      name: person.name,
      aliases: person.aliases,
      ...(person.apparentAffiliation === undefined
        ? {}
        : { apparentAffiliation: person.apparentAffiliation }),
    })),
    unidentified: unidentified.map((person, index) => ({
      person: `cu-${index}`,
      descriptor: person.descriptor,
      sightings: person.sightings,
    })),
    heldClaims: caseFile.claims.filter((claim) => mentions(claim.prop, known)),
    grades: caseFile.grades,
    notes: caseFile.notes,
    observedBurns: view.observedBurns,
  };
}

export function buildPostingResult(input: BuildPostingResultInput): BuiltPostingResult {
  const outcome = normaliseOutcome(input.outcome, input.plotTemplate);
  const carry = buildPlayerCarry(input.view, input.caseFile);
  const unidentified = input.view.persons
    .filter((person) => person.carryEligible && !person.identified)
    .flatMap((person, index) => {
      const npc = input.identities[person.id];
      return npc === undefined ? [] : [{ ref: `cu-${index}`, npc }];
    });
  const extract: PostingTruthExtract = {
    survivingHostiles: input.hostiles.filter((hostile) => hostile.status === 'at-large'),
    assets: input.assets,
    arcClues: input.arcClues,
    unidentified,
    service: input.service,
    cityId: input.cityId,
  };
  return {
    schema: 1,
    index: input.index,
    outcome,
    plots: outcome.plots ?? [],
    stats: postingStats(
      input.log,
      input.results,
      input.standingStart ?? 0,
      input.standingAfter ?? [],
    ),
    carry,
    debrief: {
      full: asTruth(input.debrief),
      redacted: redactDebrief(input.debrief, input.protectedIds, input.caseFile.claims),
    },
    extract: asTruth(extract),
    plotTemplate: input.plotTemplate,
  };
}

function brokeIntercept(result: ActionResult): boolean {
  return result.observations.some(
    (observation) => observation.kind === 'proposition' && observation.source.kind === 'intercept',
  );
}

function propositionCount(result: ActionResult): number {
  return result.observations.filter((observation) => observation.kind === 'proposition').length;
}

function corroborated(prop: Proposition | undefined, claims: readonly CarryClaim[]): boolean {
  if (prop === undefined) {
    return false;
  }
  return claims.some((claim) => claim.relation === 'corroborated' && sameProposition(claim.prop, prop));
}

function sameProposition(left: Proposition, right: Proposition): boolean {
  return (
    left.id === right.id ||
    (left.predicate === right.predicate &&
      left.subject === right.subject &&
      left.object === right.object &&
      (left.place ?? '') === (right.place ?? ''))
  );
}

function mentions(prop: Proposition, known: ReadonlySet<string>): boolean {
  const object = typeof prop.object === 'string' ? prop.object : '';
  return known.has(prop.subject) || known.has(object) || (prop.place !== undefined && known.has(prop.place));
}

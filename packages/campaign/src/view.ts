/**
 * The only campaign module player-view may import.
 *
 * These functions read the renderable half of a campaign. They have no
 * field for Campaign Truth, so a caller cannot pass dossiers, the HQ mole,
 * or hostile control through this entry.
 */

import type {
  ArchiveReveal,
  ArchiveVisibleEntry,
  CampaignArchive,
  CampaignChoice,
  CampaignStep,
  CampaignView,
  HqStep,
  Officer,
  PlayerCarry,
  PlayerHistory,
  PostingOffer,
  PostingStats,
  RedactedDebrief,
} from './state.js';

export type {
  CampaignArchive,
  CampaignChoice,
  CampaignView,
  HqStep,
  Officer,
  PlayerCarry,
  PlayerHistory,
  PostingOffer,
  PostingStats,
  RedactedDebrief,
};

/** Officer, offers, step, and the staged HQ screens. */
export function campaignView(s: { readonly view: CampaignView }): CampaignView {
  return s.view;
}

export interface HqStepView {
  readonly kind: CampaignStep['kind'];
  readonly offers: readonly PostingOffer[];
  readonly staged: CampaignView['staged'];
  readonly pendingRequisitions: CampaignView['pendingRequisitions'];
  readonly arcs: CampaignView['arcs'];
  readonly trainingUsed: number;
  readonly chosen?: CampaignView['chosen'];
}

/** The current HQ step, from the view alone. */
export function hqStepView(s: {
  readonly step: CampaignStep;
  readonly view: CampaignView;
}): HqStepView {
  return {
    kind: s.step.kind,
    offers: s.view.offers,
    staged: s.view.staged,
    pendingRequisitions: s.view.pendingRequisitions,
    arcs: s.view.arcs,
    trainingUsed: s.view.trainingUsed ?? 0,
    ...(s.view.chosen === undefined ? {} : { chosen: s.view.chosen }),
  };
}

/** How an integer faction reputation is shown. */
export type ReputationBand = 'cold' | 'neutral' | 'warm' | 'trusted';

export function reputationBand(value: number): ReputationBand {
  if (value >= 2) {
    return 'trusted';
  }
  if (value >= 1) {
    return 'warm';
  }
  if (value <= -1) {
    return 'cold';
  }
  return 'neutral';
}

export interface OfficerLegendView {
  readonly id: Officer['legends'][number]['id'];
  readonly cover: Officer['legends'][number]['cover'];
  readonly name: string;
  readonly official: boolean;
  readonly posting: number;
  /** True only when some Player Carry lists this legend in `observedBurns`. */
  readonly burned: boolean;
}

export interface OfficerView {
  readonly name: string;
  readonly background: Officer['background'];
  readonly rank: Officer['rank'];
  readonly skills: Officer['skills'];
  readonly traits: Officer['traits'];
  readonly stress: number;
  readonly legends: readonly OfficerLegendView[];
  readonly careerStanding: number;
  readonly factions: readonly { readonly faction: string; readonly band: ReputationBand }[];
}

/**
 * Rank, skills, traits, stress, standing, and faction bands. A legend is
 * burned only when a Player Carry recorded that the player saw the burn.
 */
export function officerView(s: {
  readonly officer: Officer;
  readonly carries: readonly Pick<PlayerCarry, 'observedBurns'>[];
}): OfficerView {
  const burned = new Set(s.carries.flatMap((carry) => [...carry.observedBurns]));
  const factions = Object.entries(s.officer.factions)
    .map(([faction, value]) => ({ faction, band: reputationBand(value) }))
    .sort((left, right) => left.faction.localeCompare(right.faction));
  return {
    name: s.officer.name,
    background: s.officer.background,
    rank: s.officer.rank,
    skills: s.officer.skills,
    traits: s.officer.traits,
    stress: s.officer.stress,
    legends: s.officer.legends.map((legend) => ({
      id: legend.id,
      cover: legend.cover,
      name: legend.name,
      official: legend.official,
      posting: legend.posting,
      burned: burned.has(legend.id),
    })),
    careerStanding: s.officer.careerStanding,
    factions,
  };
}

export interface ArchiveCaseFileView {
  readonly ref: string;
  readonly identified: PlayerCarry['identified'];
  readonly unidentified: PlayerCarry['unidentified'];
  readonly heldClaims: PlayerCarry['heldClaims'];
  readonly grades: PlayerCarry['grades'];
  readonly notes: PlayerCarry['notes'];
}

export interface ArchiveTimelineEntry {
  readonly index: number;
  readonly city: string;
  readonly year: number;
  readonly legend: ArchiveVisibleEntry['legend'];
  readonly rank: ArchiveVisibleEntry['rankAtStart'];
  readonly outcome: ArchiveVisibleEntry['outcome'];
  readonly debrief: RedactedDebrief;
  readonly caseFile: ArchiveCaseFileView;
}

export interface ArchiveView {
  readonly revealed: boolean;
  readonly timeline: readonly ArchiveTimelineEntry[];
  /** Full debriefs, present only once the campaign has copied a reveal. */
  readonly debriefs?: ArchiveReveal['debriefs'];
  /** Arc state from that same reveal. Absent while the career is open. */
  readonly arcs?: ArchiveReveal['arcs'];
}

/**
 * The career timeline. Each posting keeps its redacted debrief and a
 * read-only case file. Full debriefs and arc state appear only when the
 * archive already carries a reveal.
 */
export function archiveView(s: { readonly archive: CampaignArchive }): ArchiveView {
  const timeline = s.archive.visible.map((entry) => ({
    index: entry.index,
    city: entry.city,
    year: entry.year,
    legend: entry.legend,
    rank: entry.rankAtStart,
    outcome: entry.outcome,
    debrief: entry.redacted,
    caseFile: caseFileOf(entry),
  }));
  const reveal = s.archive.reveal;
  if (reveal === undefined) {
    return { revealed: false, timeline };
  }
  return { revealed: true, timeline, debriefs: reveal.debriefs, arcs: reveal.arcs };
}

function caseFileOf(entry: ArchiveVisibleEntry): ArchiveCaseFileView {
  const carry = entry.carry;
  return {
    ref: entry.caseFileRef,
    identified: carry.identified,
    unidentified: carry.unidentified,
    heldClaims: carry.heldClaims,
    grades: carry.grades,
    notes: carry.notes,
  };
}

export interface KnownEnemyView {
  readonly person: string;
  readonly label: string;
  readonly kind: 'identified' | 'observed';
  readonly aliases: readonly string[];
  readonly apparentAffiliation?: string;
  readonly contacts: readonly { readonly city: string; readonly year: number }[];
}

/**
 * Hostile persons the player identified or observed. The list is built only
 * from Player Carry on the visible archive.
 */
export function knownEnemiesView(s: {
  readonly archive: { readonly visible: readonly ArchiveVisibleEntry[] };
}): readonly KnownEnemyView[] {
  const identified = new Map<string, KnownEnemyView>();
  const observed = new Map<string, KnownEnemyView>();
  for (const entry of s.archive.visible) {
    for (const person of entry.carry.identified) {
      const current = identified.get(person.person);
      const contact = { city: entry.city, year: entry.year };
      if (current === undefined) {
        identified.set(person.person, {
          person: person.person,
          label: person.name,
          kind: 'identified',
          aliases: person.aliases,
          ...(person.apparentAffiliation === undefined
            ? {}
            : { apparentAffiliation: person.apparentAffiliation }),
          contacts: [contact],
        });
        continue;
      }
      identified.set(person.person, {
        ...current,
        contacts: mergeContacts(current.contacts, contact),
      });
    }
    for (const person of entry.carry.unidentified) {
      const current = observed.get(person.person);
      if (current === undefined) {
        observed.set(person.person, {
          person: person.person,
          label: person.descriptor,
          kind: 'observed',
          aliases: [],
          contacts: dedupeContacts(person.sightings),
        });
        continue;
      }
      observed.set(person.person, {
        ...current,
        contacts: dedupeContacts([...current.contacts, ...person.sightings]),
      });
    }
  }
  return [...identified.values(), ...observed.values()].sort((left, right) => {
    const byLabel = left.label.localeCompare(right.label);
    return byLabel === 0 ? left.person.localeCompare(right.person) : byLabel;
  });
}

function mergeContacts(
  current: readonly { readonly city: string; readonly year: number }[],
  contact: { readonly city: string; readonly year: number },
): { readonly city: string; readonly year: number }[] {
  return dedupeContacts([...current, contact]);
}

function dedupeContacts(
  contacts: readonly { readonly city: string; readonly year: number }[],
): { readonly city: string; readonly year: number }[] {
  const seen = new Set<string>();
  const out: { city: string; year: number }[] = [];
  for (const contact of contacts) {
    const key = `${contact.city}\0${contact.year}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({ city: contact.city, year: contact.year });
  }
  out.sort((left, right) => left.year - right.year || left.city.localeCompare(right.city));
  return out;
}

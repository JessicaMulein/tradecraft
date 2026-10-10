/**
 * Tap transcripts filed at the Station.
 *
 * A meeting the plot holds is also overheard on a telephone tap. The liaison
 * sends a transcript: two voices, cover names, and the place and time in clear.
 * The voices are not identified. Reading it files a claim about that place, not
 * about the people, so the transcript is a lead to go and watch.
 *
 * Every transcript from this line shares one origin (`tap:silver` in the case
 * file). Two of them do not confirm each other.
 */

import { calendarLabel } from '../city/calendar.js';
import type { GameTime, LocId, NpcId, PropId, Proposition } from '../model/core.js';
import type { SimEvent, WorldState } from '../model/state.js';
import { STATION_LOCATION_TYPE } from '../action/intercept.js';
import { docId, type ComposedDocument } from './document.js';

const COVERS = ['the uncle', 'the niece', 'the porter', 'the cousin', 'the doctor', 'the widow'] as const;

const PHASES = ['morning', 'afternoon', 'evening', 'night'] as const;

/** A stable cover name for one voice. A second voice skips a name already taken. */
export function coverName(id: string, taken: ReadonlySet<string> = new Set()): string {
  let slot = 0;
  for (let i = 0; i < id.length; i += 1) {
    slot = (slot + id.charCodeAt(i)) % COVERS.length;
  }
  for (let step = 0; step < COVERS.length; step += 1) {
    const name = COVERS[(slot + step) % COVERS.length] ?? COVERS[0];
    if (!taken.has(name)) {
      return name;
    }
  }
  return COVERS[slot] ?? COVERS[0];
}

export interface TapMeeting {
  readonly id: string;
  readonly at: GameTime;
  readonly loc: LocId;
  readonly participants: readonly NpcId[];
}

/** The transcript for one overheard meeting, or undefined when it cannot be written. */
export function composeTapTranscript(
  state: WorldState,
  meeting: TapMeeting,
): ComposedDocument | undefined {
  const place = state.city.locations[meeting.loc];
  if (place === undefined || meeting.participants.length < 2) {
    return undefined;
  }
  const first = meeting.participants[0];
  const second = meeting.participants[1];
  if (first === undefined || second === undefined) {
    return undefined;
  }
  const taken = new Set<string>();
  const voiceA = coverName(first, taken);
  taken.add(voiceA);
  const voiceB = coverName(second, taken);
  const when = whenPhrase(state.meta.setting.startDate, meeting.at);
  const body = [
    'TAP TRANSCRIPT — Imperial cable',
    when,
    '',
    `First voice: ${voiceA} can bring the parcel.`,
    `Second voice: Not the usual place. ${place.name}, ${when}.`,
    'First voice: Tell no one the name.',
    '',
    'The liaison has not put a name to either voice.',
  ].join('\n');
  const propId = `prop:tap/${meeting.id}` as PropId;
  const prop: Proposition = {
    id: propId,
    subject: meeting.loc,
    predicate: 'SCHEDULED_FOR',
    object: { kind: 'text', value: `${voiceA} meets ${voiceB}` },
    place: meeting.loc,
    window: { from: meeting.at },
  };
  const stations = stationLocations(state);
  return {
    document: {
      id: docId('notice', `tap-${meeting.id}`),
      kind: 'notice',
      title: `Tap transcript — ${when}`,
      date: meeting.at,
      body,
      asserts: [propId],
      ...(stations.length > 0 ? { obtainableAt: stations } : {}),
    },
    propositions: [prop],
  };
}

/** File a transcript for each meeting event that does not already have one. */
export function fileTapTranscripts(state: WorldState, events: readonly SimEvent[]): WorldState {
  let documents = state.documents;
  let propositions = state.documentPropositions;
  let changed = false;
  for (const event of events) {
    if (event.kind !== 'meeting' || event.participants.length < 2) {
      continue;
    }
    const composed = composeTapTranscript(state, {
      id: event.id,
      at: event.at,
      loc: event.loc,
      participants: event.participants,
    });
    if (composed === undefined || documents[composed.document.id] !== undefined) {
      continue;
    }
    if (!changed) {
      documents = { ...documents };
      propositions = { ...propositions };
      changed = true;
    }
    documents[composed.document.id] = composed.document;
    for (const prop of composed.propositions) {
      propositions[prop.id] = prop;
    }
  }
  if (!changed) {
    return state;
  }
  return { ...state, documents, documentPropositions: propositions };
}

function stationLocations(state: WorldState): LocId[] {
  return Object.values(state.city.locations)
    .filter((loc) => loc.type === STATION_LOCATION_TYPE || loc.type.endsWith(`/${STATION_LOCATION_TYPE}`))
    .map((loc) => loc.id)
    .sort((a, b) => a.localeCompare(b));
}

function whenPhrase(startDate: string, at: GameTime): string {
  const phase = PHASES[at.phase] ?? 'morning';
  return `${calendarLabel(startDate, at.day)}, ${phase}`;
}

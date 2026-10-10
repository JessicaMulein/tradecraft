/**
 * A next-step suggestion for tutorial play.
 *
 * It reads only the Player View: the catalogue, the Case File, the map, the
 * people list, documents and intercepts. It never reads the Plot, a true
 * allegiance, or a cipher spec. Hints that are off (the hard preset) produce
 * no suggestion, so the line is absent when the player asked for none.
 *
 * The sentence names the rule that won. It is a sensible next step, not a
 * promise that the operation will be stopped.
 */

import type { Action, EntityId } from '@tradecraft/engine';

import type { EngineApi } from '../api/types.js';

/** One suggested action and the sentence that explains it. */
export interface TutorialSuggestion {
  readonly rule:
    | 'arrest'
    | 'break-off'
    | 'read'
    | 'decrypt'
    | 'duty'
    | 'sweep'
    | 'trace'
    | 'station'
    | 'claim-site'
    | 'follow'
    | 'talk'
    | 'drive'
    | 'turn'
    | 'park'
    | 'wait';
  readonly text: string;
  /** The fields a shell uses to highlight the matching catalogue row. */
  readonly action: {
    readonly kind: string;
    readonly npc?: string;
    readonly doc?: string;
    readonly intercept?: string;
    readonly duty?: string;
    readonly to?: string;
    readonly countersurveillance?: boolean;
    readonly phases?: number;
    readonly target?: string;
    readonly vehicle?: string;
    readonly breakOff?: boolean;
  };
}

const RISKY = 0.45;

/**
 * The suggestion for this moment, or `undefined` when hints are off or nothing
 * in the catalogue is worth pointing at.
 */
export function tutorialSuggestion(
  api: EngineApi,
): TutorialSuggestion | undefined {
  const hints = (api as { hints?: { readonly enabled: boolean } }).hints;
  if (hints?.enabled !== true) return undefined;

  const allowed = api.actions().filter((option) => option.quote.allowed);
  const here = api.views.here();
  const people = api.views.people().people;
  const docs = api.views.documents().documents;
  const intercepts = api.views.intercepts().intercepts;
  const claims = api.caseFile.list({});

  const evidenceOf = (id: string): number =>
    api.caseFile.evidence(id as EntityId);
  let bestId: string | undefined;
  let bestEvidence = 0;
  for (const person of people) {
    const score = evidenceOf(person.id);
    if (
      bestId === undefined ||
      score > bestEvidence ||
      (score === bestEvidence && person.id < bestId)
    ) {
      bestId = person.id;
      bestEvidence = score;
    }
  }
  const labelOf = (id: string | undefined): string =>
    people.find((person) => person.id === id)?.label ?? id ?? 'them';

  const places = new Map<
    string,
    { name: string; risk: number; station: boolean }
  >();
  for (const district of api.views.map().districts) {
    for (const loc of district.locations) {
      places.set(loc.id, {
        name: loc.name,
        risk: loc.risk,
        station: isStation(loc.type),
      });
    }
  }

  const mention = new Map<string, number>();
  for (const claim of claims) {
    for (const id of locationIds(claim.prop)) {
      mention.set(id, (mention.get(id) ?? 0) + 1);
    }
  }

  const atStation = isStation(here.location.type);

  const arrests = allowed.flatMap((option) =>
    option.action.kind === 'arrest' ? [option.action] : [],
  );
  arrests.sort(
    (a, b) => evidenceOf(b.npc) - evidenceOf(a.npc) || (a.npc < b.npc ? -1 : 1),
  );
  const arrest = arrests[0];
  if (arrest !== undefined) {
    return suggest(
      'arrest',
      `The case against ${labelOf(arrest.npc)} is strong enough to take to an arrest.`,
      { kind: 'arrest', npc: arrest.npc },
    );
  }

  const breakOff = allowed.find(
    (option) =>
      option.action.kind === 'talk' && option.action.breakOff === true,
  );
  if (breakOff !== undefined && breakOff.action.kind === 'talk') {
    return suggest(
      'break-off',
      `You may have been followed. Break off the meeting with ${labelOf(breakOff.action.npc)} before you walk into it.`,
      { kind: 'talk', npc: breakOff.action.npc, breakOff: true },
    );
  }

  const unread = docs.find(
    (doc) =>
      !doc.read &&
      allowed.some(
        (option) =>
          option.action.kind === 'read' && option.action.doc === doc.id,
      ),
  );
  if (unread !== undefined) {
    return suggest(
      'read',
      `Read “${unread.title}”. You have not opened it yet.`,
      {
        kind: 'read',
        doc: unread.id,
      },
    );
  }

  const broken = allowed.flatMap((option) => {
    if (option.action.kind !== 'decrypt') return [];
    const intercept = option.action.intercept;
    return intercepts.some(
      (row) => row.id === intercept && row.hasTradecraftError,
    )
      ? [option.action]
      : [];
  })[0];
  if (broken !== undefined) {
    const row = intercepts.find((entry) => entry.id === broken.intercept);
    const name = row?.callsign ?? broken.intercept;
    return suggest(
      'decrypt',
      `Open ${name} on the workbench. The operator made a mistake on that capture.`,
      { kind: 'decrypt', intercept: broken.intercept },
    );
  }

  const duty = allowed.find((option) => option.action.kind === 'attend-duty');
  if (duty !== undefined && duty.action.kind === 'attend-duty') {
    return suggest(
      'duty',
      'Attend your cover shift. Missing it costs standing with the employer.',
      {
        kind: 'attend-duty',
        duty: duty.action.duty,
      },
    );
  }

  if (atStation && intercepts.length === 0) {
    const sweep = allowed.find(
      (option) =>
        option.action.kind === 'intercept' &&
        option.action.channel === undefined,
    );
    if (sweep !== undefined) {
      return suggest(
        'sweep',
        'Sweep the air. You are at the Station and have not collected any traffic yet.',
        {
          kind: 'intercept',
        },
      );
    }
  }

  if (atStation && bestId !== undefined && bestEvidence > 0) {
    const trace = allowed.find(
      (option) =>
        option.action.kind === 'cable' &&
        option.action.body.kind === 'trace' &&
        option.action.body.target === bestId,
    );
    if (trace !== undefined) {
      return suggest(
        'trace',
        `Cable for the Station's file on ${labelOf(bestId)}.`,
        {
          kind: 'cable',
          target: bestId,
        },
      );
    }
  }

  const needsStation = intercepts.length === 0 || bestEvidence > 0;
  if (!atStation && needsStation) {
    const station = [...places.entries()].find(
      ([id, place]) => place.station && id !== here.location.id,
    );
    const trip =
      station === undefined
        ? undefined
        : travelTo(allowed, station[0], station[1].risk);
    if (trip !== undefined && station !== undefined) {
      const watched = trip.countersurveillance;
      const text = watched
        ? `Go to ${station[1].name} by the countersurveillance route. The direct way is watched.`
        : `Go to ${station[1].name}. The antenna and the cable desk are there.`;
      return suggest('station', text, {
        kind: 'travel',
        to: trip.to,
        countersurveillance: trip.countersurveillance,
      });
    }
  }

  let claimId: string | undefined;
  let claimCount = 0;
  for (const [id, count] of mention) {
    if (id === here.location.id) continue;
    if (claimId === undefined || count > claimCount) {
      claimId = id;
      claimCount = count;
    }
  }
  if (claimId !== undefined) {
    const place = places.get(claimId);
    const trip = travelTo(allowed, claimId, place?.risk ?? 0.5);
    if (trip !== undefined) {
      const name = place?.name ?? claimId;
      const text = trip.countersurveillance
        ? `Go to ${name} by the countersurveillance route. The case file mentions it, and the direct way is watched.`
        : `Go to ${name}. The case file mentions it.`;
      return suggest('claim-site', text, {
        kind: 'travel',
        to: trip.to,
        countersurveillance: trip.countersurveillance,
      });
    }
  }

  const visible = new Set(here.visible.map((person) => person.id));
  const follow = allowed.flatMap((option) => {
    if (option.action.kind !== 'follow') return [];
    const npc = option.action.target;
    if (!visible.has(npc)) return [];
    if (
      (people.find((person) => person.id === npc)?.claimsAsSubject ?? 0) === 0
    )
      return [];
    return [option.action];
  })[0];
  if (follow !== undefined) {
    return suggest(
      'follow',
      `Follow ${labelOf(follow.target)}. The case file already names them.`,
      {
        kind: 'follow',
        npc: follow.target,
      },
    );
  }

  const talk = allowed.flatMap((option) => {
    if (option.action.kind !== 'talk' && option.action.kind !== 'approach')
      return [];
    const npc = option.action.npc;
    if (!visible.has(npc)) return [];
    const person = people.find((entry) => entry.id === npc);
    if (person?.asset === true) return [];
    const affiliation = person?.apparentAffiliation;
    if (affiliation === 'hostile' || affiliation === 'cell') return [];
    return [option.action];
  })[0];
  if (talk !== undefined) {
    const verb = talk.kind === 'talk' ? 'Talk to' : 'Approach';
    return suggest('talk', `${verb} ${labelOf(talk.npc)}.`, {
      kind: talk.kind,
      npc: talk.npc,
    });
  }

  const drive = allowed.find((option) => option.action.kind === 'street-ops.drive');
  if (drive !== undefined && drive.action.kind === 'street-ops.drive') {
    const vehicle = drive.action['vehicle'];
    return suggest(
      'drive',
      'Take the car. Turn through the streets, then park when you are done.',
      {
        kind: 'street-ops.drive',
        ...(typeof vehicle === 'string' ? { vehicle } : {}),
      },
    );
  }

  const turn = allowed.find((option) => option.action.kind === 'street-ops.turn');
  if (turn !== undefined && turn.action.kind === 'street-ops.turn') {
    const street = turn.action['street'];
    const text = typeof street === 'string' ? `Turn onto ${street}.` : 'Carry on down the street.';
    return suggest('turn', text, { kind: 'street-ops.turn' });
  }

  const park = allowed.find((option) => option.action.kind === 'street-ops.park');
  if (park !== undefined) {
    return suggest('park', 'Park and get out.', { kind: 'street-ops.park' });
  }

  const wait = allowed.find(
    (option) => option.action.kind === 'wait' && option.action.phases === 1,
  );
  if (wait !== undefined) {
    return suggest('wait', 'Wait out this phase.', { kind: 'wait', phases: 1 });
  }
  return undefined;
}

/** The line to show while a talk scene is open. The catalogue's say-lines are not buttons. */
export const TALK_TUTORIAL =
  'Ask what they know, then leave. A long conversation spends the day.';

function suggest(
  rule: TutorialSuggestion['rule'],
  text: string,
  action: TutorialSuggestion['action'],
): TutorialSuggestion {
  return { rule, text, action };
}

function travelTo(
  allowed: readonly { readonly action: Action }[],
  to: string,
  risk: number,
): { readonly to: string; readonly countersurveillance: boolean } | undefined {
  const trips = allowed.flatMap((option) =>
    option.action.kind === 'travel' && option.action.to === to
      ? [option.action]
      : [],
  );
  if (trips.length === 0) return undefined;
  const preferred =
    risk >= RISKY
      ? (trips.find((trip) => trip.countersurveillance) ?? trips[0])
      : (trips.find((trip) => !trip.countersurveillance) ?? trips[0]);
  return preferred === undefined
    ? undefined
    : { to: preferred.to, countersurveillance: preferred.countersurveillance };
}

function locationIds(prop: {
  readonly place?: string;
  readonly object: unknown;
}): string[] {
  const ids: string[] = [];
  if (prop.place !== undefined) ids.push(prop.place);
  if (typeof prop.object === 'string' && prop.object.startsWith('loc:'))
    ids.push(prop.object);
  return ids;
}

function isStation(type: string): boolean {
  return type === 'station-hq' || type.endsWith('/station-hq');
}

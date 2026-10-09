/**
 * Travel documents (multi-city task 6.3; Requirement 4).
 *
 * A papers cable and a visa application are pure resolutions. Quality stays on
 * the document; the player-view projection never reads it.
 */

import { addPhases } from '../clock/clock.js';
import { asTruth } from '../model/core.js';
import type { Prng } from '../prng/prng.js';
import type { TravelDocId, TravelDocument } from '../region/world.js';
import { debit } from '../station/ledger.js';
import type { SimEvent, WorldState } from '../model/state.js';
import type { ActionQuote, ActionResult } from '../action/result.js';
import type { ApplyVisaAction, RequestPapersAction } from '../action/types.js';

function rules(state: WorldState) {
  return (
    state.region?.rules ?? {
      detentionPhases: 1,
      contrabandCashThreshold: 40,
      papersDelay: 1,
      papersCost: 10,
      watchListSensitivity: 0.5,
    }
  );
}

function standing(state: WorldState): number {
  const value = state.station.standing;
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function empty(state: WorldState): ActionResult {
  return {
    observations: [],
    factLines: [],
    scene: { loc: state.player.loc, description: '', atmosphere: [], risk: 0, visible: [] },
    events: [],
    claimsAdded: [],
  };
}

/** Station papers: delay, cost and quality follow the preset and Standing. */
export function quotePapers(state: WorldState, action: RequestPapersAction): ActionQuote {
  if (state.region === undefined) {
    return { allowed: false, reason: 'this game has no region', phases: 0, money: 0 };
  }
  if (action.doc.length === 0) {
    return { allowed: false, reason: 'name the document', phases: 0, money: 0 };
  }
  const table = rules(state);
  return {
    allowed: true,
    phases: table.papersDelay,
    money: table.papersCost * (1 - standing(state)),
  };
}

export function resolvePapers(
  state: WorldState,
  action: RequestPapersAction,
): { readonly next: WorldState; readonly result: ActionResult } {
  const quoted = quotePapers(state, action);
  if (!quoted.allowed) {
    return { next: state, result: empty(state) };
  }
  const ledger = quoted.money === 0
    ? state.station.ledger
    : debit(state.station.ledger, quoted.money, 'fare', state.time, action.doc);
  if (typeof ledger === 'string') {
    return { next: state, result: empty(state) };
  }
  const id = `paper:${action.doc}` as TravelDocId;
  const quality = 0.4 + 0.6 * standing(state);
  const valid = { from: state.time, to: addPhases(state.time, 30 * 4) };
  const document: TravelDocument = {
    id,
    kind: action.doc,
    holder: action.holder,
    quality: asTruth(quality),
    issuedBy: { kind: 'station', id: state.stations?.hub.org ?? 'station' },
    valid,
    satisfies: [],
  };
  const papers = action.holder === 'player' ? [...(state.player.papers ?? []), id] : state.player.papers;
  const event: SimEvent = {
    id: `papers-${id}`,
    at: addPhases(state.time, quoted.phases),
    visibility: 'player',
    kind: 'papers-issued',
    doc: id,
  };
  const next: WorldState = {
    ...state,
    time: addPhases(state.time, quoted.phases),
    travelDocs: { ...(state.travelDocs ?? {}), [id]: document },
    player: { ...state.player, papers },
    station: { ...state.station, ledger },
    scheduled: [...state.scheduled, event],
  };
  const line = action.holder === 'player'
    ? `The station issues ${action.doc}.`
    : `The station issues ${action.doc} to ${action.holder}.`;
  return {
    next,
    result: {
      observations: [{ kind: 'message', line }],
      factLines: [line],
      scene: { loc: next.player.loc, description: '', atmosphere: [], risk: 0, visible: [] },
      events: [event],
      claimsAdded: [],
    },
  };
}

function suspicion(state: WorldState, country: string): number {
  const services = Object.values(state.services ?? {});
  const local = services.find((service) => service.kind === 'local-security' && service.country === country);
  return local?.beliefs.coverSuspicion ?? 0;
}

/** A visa is granted when a single draw clears the local service's suspicion. */
export function decideVisa(suspicionScore: number, rng: Prng): boolean {
  return rng.next() > suspicionScore;
}

export function quoteVisa(state: WorldState, action: ApplyVisaAction): ActionQuote {
  if (state.region === undefined) {
    return { allowed: false, reason: 'this game has no region', phases: 0, money: 0 };
  }
  if (action.country.length === 0) {
    return { allowed: false, reason: 'name the country', phases: 0, money: 0 };
  }
  return { allowed: true, phases: rules(state).papersDelay, money: 0 };
}

export function resolveVisa(
  state: WorldState,
  action: ApplyVisaAction,
  rng: Prng,
): { readonly next: WorldState; readonly result: ActionResult } {
  const quoted = quoteVisa(state, action);
  if (!quoted.allowed) {
    return { next: state, result: empty(state) };
  }
  const granted = decideVisa(suspicion(state, action.country), rng);
  const at = addPhases(state.time, quoted.phases);
  const event: SimEvent = {
    id: `visa-${action.country}`,
    at,
    visibility: 'player',
    kind: 'visa-decision',
    country: action.country,
    granted,
  };
  let next: WorldState = {
    ...state,
    time: at,
    scheduled: [...state.scheduled, event],
  };
  const line = granted
    ? `The consulate grants a visa for ${action.country}.`
    : `The consulate refuses a visa for ${action.country}.`;
  if (granted) {
    const id = `paper:visa-${action.country}` as TravelDocId;
    const document: TravelDocument = {
      id,
      kind: 'visa',
      holder: 'player',
      quality: asTruth(0.7),
      issuedBy: { kind: 'consulate', id: action.country },
      valid: { from: at, to: addPhases(at, 30 * 4) },
      satisfies: [],
    };
    next = {
      ...next,
      travelDocs: { ...(state.travelDocs ?? {}), [id]: document },
      player: { ...state.player, papers: [...(state.player.papers ?? []), id] },
    };
  }
  return {
    next,
    result: {
      observations: [{ kind: 'message', line }],
      factLines: [line],
      scene: { loc: next.player.loc, description: '', atmosphere: [], risk: 0, visible: [] },
      events: [event],
      claimsAdded: [],
    },
  };
}

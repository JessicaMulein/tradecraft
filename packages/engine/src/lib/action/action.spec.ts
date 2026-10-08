/**
 * Tests for the Action Resolver framework (task 11.1; Requirements 13.2, 20.1,
 * 21.3, 21.4, 21.5).
 *
 * These load the real core pack and drive a generated {@link WorldState} end to
 * end through {@link quote} and {@link resolve}, exercising:
 *
 * - the Location gate: an action a Location Type does not allow, and an action
 *   at a closed Location, both quote `allowed: false` with a reason and leave
 *   the state unchanged (Requirement 21.5);
 * - the Budget gate: a money-costed action the ledger cannot cover quotes
 *   `allowed: false` and leaves the state unchanged (Requirement 28.3);
 * - Fact Line rendering: an Observation renders through the predicate
 *   third-person template with the player namer (Requirement 20.1);
 * - `wait`: quotes its phase cost and resolves to an empty, state-preserving
 *   result;
 * - the "disallowed `resolve` returns `next === state`" invariant;
 * - slice-integration task 2.4 (Req 11.1–11.4): every action kind is
 *   dispatched to its own quote and resolver, every refusal carries a reason,
 *   `decrypt`, `cable` and `task` run through `resolve`, the kinds that are not
 *   done at a Location skip the Location gate while `confront` and
 *   `turn-agent` keep it, and each of `arrest`, `turn-agent`, `pay`, `task`,
 *   `feed` and `confront` is allowed in a generated world with the real core
 *   pack, resolving at exactly its quoted cost.
 *
 * Travel's own mechanics live in `./travel.spec.ts`.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  loadCityData,
  loadContent,
  loadDescriptorData,
  loadPublicTexts,
  type CityData,
  type ContentSet,
  type DescriptorData,
  type DifficultyPreset,
  type PublicText,
} from '@tradecraft/content';

import { createPrng } from '../prng/prng.js';
import { ScenarioConfigSchema } from '../config/scenario-config.js';
import { generate, STARTING_ARREST_AUTHORITY, type GenerateInputs } from '../generate.js';
import type { WorldState } from '../model/state.js';
import {
  asTruth,
  revealTruth,
  type LocId,
  type NpcId,
  type OrgId,
  type Phase,
  type Proposition,
} from '../model/core.js';
import { balance } from '../station/ledger.js';
import { newRelationship, type AssetProfile, type Relationship } from '../recruit/asset.js';
import { TASKING_EXPOSURE } from '../recruit/tasking.js';
import { revealedSpec } from '../cipher/intercept.js';
import {
  quote,
  resolve,
  actionLocation,
  locationGate,
  locationTypeOf,
  isOpenAt,
  renderPropositionLine,
  renderFactLines,
  quoteWait,
  sceneAt,
  visibleNpcsAt,
  type ResolveResult,
} from './action.js';
import { ARREST_PHASE_COST } from './arrest.js';
import { CABLE_PHASE_COST, CABLE_SENT_LINES } from './cable.js';
import { CONFRONT_PHASE_COST } from './confront.js';
import {
  DECRYPT_NOT_COLLECTED_REASON,
  DECRYPT_PHASE_COST,
  DECRYPT_REJECTED_LINE,
} from './decrypt.js';
import { FEED_PHASE_COST } from './feed.js';
import { isAtStation } from './intercept.js';
import { PAY_PHASE_COST } from './pay.js';
import { TASK_PHASE_COST } from './task.js';
import { TURN_PHASE_COST } from './turn-agent.js';
import type { Action, ActionKind } from './types.js';
import type { ActionQuote, ResolverContext } from './result.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors generate.spec.ts)
// ---------------------------------------------------------------------------

const CORE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'content',
  'packs',
  'core',
);

function loadCore(): {
  content: ContentSet;
  cityData: CityData;
  descriptors: DescriptorData;
  publicTexts: readonly PublicText[];
} {
  const content = loadContent([CORE_DIR], ['core']);
  if (!content.ok) {
    throw new Error(
      `core pack failed to load:\n${content.errors
        .map((e) => `  ${e.pack}/${e.file} ${e.path}: ${e.message}`)
        .join('\n')}`,
    );
  }
  const cityData = loadCityData(CORE_DIR);
  if (!cityData.ok) {
    throw new Error('city.yaml failed to load');
  }
  const descriptors = loadDescriptorData(CORE_DIR);
  if (!descriptors.ok) {
    throw new Error('descriptors.yaml failed to load');
  }
  const publicTexts = loadPublicTexts(CORE_DIR);
  if (!publicTexts.ok) {
    throw new Error('public texts failed to load');
  }
  return {
    content: content.value,
    cityData: cityData.value,
    descriptors: descriptors.value,
    publicTexts: publicTexts.value,
  };
}

const { content, cityData, descriptors, publicTexts } = loadCore();

function preset(id: string): DifficultyPreset {
  for (const [key, value] of content.difficultyPresets) {
    if (key === id || key.endsWith(`/${id}`)) {
      return value;
    }
  }
  throw new Error(`no difficulty preset ${id}`);
}

const STANDARD = preset('standard');

function scenario() {
  return ScenarioConfigSchema.parse({
    difficulty: { preset: 'standard' },
    mole: false,
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
}

function inputs(): GenerateInputs {
  return { content, preset: STANDARD, scenario: scenario(), cityData, descriptors, publicTexts };
}

const CTX: ResolverContext = { content };

function world(seed = 'alpha'): WorldState {
  return generate(seed, inputs());
}

/** Set the clock phase on a world (a shallow, typed override for a test). */
function atPhase(state: WorldState, phase: Phase): WorldState {
  return { ...state, time: { ...state.time, phase } };
}

/**
 * Add entities to the player's known set. Fact Line rendering now goes through
 * the identity-aware namer (task 11.2; Requirement 23.4): an unidentified
 * person renders by their Unidentified Subject descriptor, an identified one by
 * name. The template-rendering tests below assert the by-name path, so they
 * mark the bound NPCs known first.
 */
function withKnown(state: WorldState, ...ids: readonly WorldState['player']['known']['entities'][number][]): WorldState {
  return {
    ...state,
    player: {
      ...state.player,
      known: {
        ...state.player.known,
        entities: [...state.player.known.entities, ...ids],
      },
    },
  };
}

/** Find a Location whose Type disallows a given action, with the open phase. */
function findDisallowing(
  state: WorldState,
  kind: string,
): { loc: string; openPhase: Phase } | undefined {
  for (const loc of Object.values(state.city.locations)) {
    const type = locationTypeOf(content, loc);
    if (type === undefined || type.allowedActions.includes(kind)) {
      continue;
    }
    const openPhase = ([0, 1, 2, 3] as Phase[]).find((p) => loc.hours[p]);
    if (openPhase !== undefined) {
      return { loc: loc.id, openPhase };
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Opening-hours and allowed-action gates (Req 21.5)
// ---------------------------------------------------------------------------

describe('locationGate — opening hours (Req 21.5)', () => {
  it('rejects an action at a Location closed in the current phase', () => {
    const base = world();
    // Find any Location with a closed phase and stand the player there.
    let found: { loc: string; closedPhase: Phase } | undefined;
    for (const loc of Object.values(base.city.locations)) {
      const closed = ([0, 1, 2, 3] as Phase[]).find((p) => !loc.hours[p]);
      if (closed !== undefined) {
        found = { loc: loc.id, closedPhase: closed };
        break;
      }
    }
    if (found === undefined) {
      // Every Location is always open in the core pack; nothing to assert.
      return;
    }
    const state = atPhase({ ...base, player: { ...base.player, loc: found.loc as never } }, found.closedPhase);
    const action: Action = { kind: 'surveil', at: found.loc as never, phases: 1 };
    const reason = locationGate(state, content, action);
    expect(reason).toBeDefined();
    expect(reason).toContain('closed');
  });
});

describe('locationGate — allowed actions (Req 21.5)', () => {
  it('rejects an action the Location Type does not allow, with a reason', () => {
    const base = world();
    const hit = findDisallowing(base, 'surveil');
    if (hit === undefined) {
      return; // no Location disallows surveil in this pack
    }
    const state = atPhase(
      { ...base, player: { ...base.player, loc: hit.loc as never } },
      hit.openPhase,
    );
    const action: Action = { kind: 'surveil', at: hit.loc as never, phases: 1 };
    const q = quote(state, action, CTX);
    expect(q.allowed).toBe(false);
    expect(q.reason).toBeDefined();
    expect(q.reason).toContain('allows only');
  });

  it('leaves state unchanged when a disallowed action is resolved', () => {
    const base = world();
    const hit = findDisallowing(base, 'surveil');
    if (hit === undefined) {
      return;
    }
    const state = atPhase(
      { ...base, player: { ...base.player, loc: hit.loc as never } },
      hit.openPhase,
    );
    const action: Action = { kind: 'surveil', at: hit.loc as never, phases: 1 };
    const { next, result } = resolve(state, action, createPrng('r'), CTX);
    expect(next).toBe(state); // next === state, by reference
    expect(result.observations).toEqual([]);
    expect(result.factLines).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Budget gate (Req 28.3)
// ---------------------------------------------------------------------------

describe('quote — Budget gate (Req 28.3)', () => {
  // Every *implemented* action (travel, wait) is money-free, so the Budget gate
  // cannot fire for them: a zero-balance Budget must not block them. The gate
  // itself (money > balance ⇒ not allowed) activates once a money-costed action
  // lands (task 11); its unaffordable-leaves-state-unchanged behaviour is the
  // ledger's own `debit` contract, tested in `station/ledger.spec.ts`.
  it('does not block a money-free action even on a drained Budget', () => {
    const base = world();
    const drained: WorldState = {
      ...base,
      station: { ...base.station, ledger: { start: 0, entries: [] } },
    };
    const wait: Action = { kind: 'wait', phases: 1 };
    expect(quote(drained, wait, CTX).allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fact Line rendering (Req 20.1)
// ---------------------------------------------------------------------------

describe('renderPropositionLine / renderFactLines (Req 20.1)', () => {
  it('renders a Proposition through the predicate third-person template', () => {
    const base = world();
    // Pick any predicate the core pack defines and two NPCs to bind.
    const predicate = content.predicates.predicates[0];
    const npcs = Object.values(base.npcs);
    expect(npcs.length).toBeGreaterThanOrEqual(2);
    const subject = npcs[0].id;
    const object = npcs[1].id;
    // Identify both bound NPCs so the namer renders them by name (Req 23.4).
    const state = withKnown(base, subject, object);
    const prop: Proposition = {
      id: 'p:test',
      subject,
      predicate: predicate.id,
      object,
    };
    const line = renderPropositionLine(content, state, prop);
    expect(typeof line).toBe('string');
    expect(line.length).toBeGreaterThan(0);
    // The player namer resolves the subject NPC to its persona name, so the
    // line names the person, not the raw id.
    expect(line).not.toContain(subject);
    expect(line).toContain(npcs[0].persona.name);
  });

  it('renders a message Observation verbatim and a proposition Observation via the template', () => {
    const state = world();
    const predicate = content.predicates.predicates[0];
    const npcs = Object.values(state.npcs);
    const prop: Proposition = {
      id: 'p:test',
      subject: npcs[0].id,
      predicate: predicate.id,
      object: npcs[1].id,
    };
    const lines = renderFactLines(content, state, [
      { kind: 'message', line: 'A plain line.' },
      {
        kind: 'proposition',
        prop,
        at: state.time,
        source: { kind: 'surveillance', loc: state.player.loc },
      },
    ]);
    expect(lines[0]).toBe('A plain line.');
    expect(lines[1]).toBe(renderPropositionLine(content, state, prop));
  });

  it('falls back readably for an unknown predicate rather than throwing', () => {
    const base = world();
    const npcs = Object.values(base.npcs);
    // Identify the subject NPC so the fallback names them (Req 23.4).
    const state = withKnown(base, npcs[0].id);
    const prop: Proposition = {
      id: 'p:test',
      subject: npcs[0].id,
      predicate: 'NO_SUCH_PREDICATE',
      object: { kind: 'text', value: 'something' },
    };
    expect(() => renderPropositionLine(content, state, prop)).not.toThrow();
    const line = renderPropositionLine(content, state, prop);
    expect(line).toContain(npcs[0].persona.name);
    expect(line).toContain('something');
  });
});

// ---------------------------------------------------------------------------
// Scene descriptor (Req 20.2 / 21.7)
// ---------------------------------------------------------------------------

describe('sceneAt', () => {
  it('builds a scene from the Location at the current time', () => {
    const state = world();
    const scene = sceneAt(state, state.player.loc);
    const loc = state.city.locations[state.player.loc];
    expect(scene.loc).toBe(state.player.loc);
    expect(scene.description).toBe(loc.description);
    expect(scene.risk).toBe(loc.risk);
    expect(Array.isArray(scene.visible)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Wait (trivial)
// ---------------------------------------------------------------------------

describe('wait', () => {
  it('quotes its phase cost and no money, always allowed', () => {
    expect(quoteWait({ kind: 'wait', phases: 3 })).toEqual({
      allowed: true,
      phases: 3,
      money: 0,
    });
  });

  it('resolves to an empty, state-preserving result', () => {
    const state = world();
    const action: Action = { kind: 'wait', phases: 2 };
    const q = quote(state, action, CTX);
    expect(q).toEqual({ allowed: true, phases: 2, money: 0 });
    const { next, result } = resolve(state, action, createPrng('w'), CTX);
    expect(next).toBe(state);
    expect(result.observations).toEqual([]);
    expect(result.scene.loc).toBe(state.player.loc);
  });
});

// ---------------------------------------------------------------------------
// Shared fixtures for the slice-integration task 2.4 tests
// ---------------------------------------------------------------------------

/** One action of each kind. A kind missing here fails to compile. */
type OneOfEachKind = { readonly [K in ActionKind]: Extract<Action, { kind: K }> };

/**
 * One action of every kind, with arguments that name nothing in the world (an
 * unknown person, Location, drop, Intercept, Document or Claim) or that are out
 * of range (a negative payment, a `NaN` offer).
 */
function nonsenseActions(state: WorldState): readonly Action[] {
  const sample: OneOfEachKind = {
    talk: { kind: 'talk', npc: 'npc:nobody' },
    approach: { kind: 'approach', npc: 'npc:nobody' },
    travel: { kind: 'travel', to: 'loc:nowhere', countersurveillance: false },
    'arrange-meeting': {
      kind: 'arrange-meeting',
      npc: 'npc:nobody',
      at: state.player.loc,
      slot: state.time,
    },
    surveil: { kind: 'surveil', at: state.player.loc, phases: 1 },
    follow: { kind: 'follow', target: 'npc:nobody' },
    'service-drop': { kind: 'service-drop', drop: 'drop:none', leave: [] },
    intercept: { kind: 'intercept', channel: 'chan:none' },
    decrypt: {
      kind: 'decrypt',
      intercept: 'int:none',
      submission: { kind: 'plaintext', text: '' },
    },
    read: { kind: 'read', doc: 'doc:none' },
    cable: { kind: 'cable', body: { kind: 'trace', target: 'npc:nobody' } },
    task: { kind: 'task', asset: 'npc:nobody', task: { kind: 'collect', target: 'npc:nobody' } },
    pay: { kind: 'pay', npc: 'npc:nobody', amount: -1 },
    confront: { kind: 'confront', npc: 'npc:nobody', claim: 'claim:none' },
    arrest: { kind: 'arrest', npc: 'npc:nobody' },
    'turn-agent': { kind: 'turn-agent', npc: 'npc:nobody', lever: 'money', offer: Number.NaN },
    feed: { kind: 'feed', asset: 'npc:nobody', items: [] },
    'attend-duty': { kind: 'attend-duty', duty: 'duty:none' },
    wait: { kind: 'wait', phases: 1 },
  };
  return Object.values(sample);
}

/** The world's NPC ids, sorted, leaving out the Cell leader (whose arrest ends the game). */
function npcIdsBesidesLeader(state: WorldState): NpcId[] {
  const leader = revealTruth(state.plot.leader);
  return (Object.keys(state.npcs) as NpcId[]).filter((id) => id !== leader).sort();
}

/** The Hostile Service's org id. */
function hostileOrg(state: WorldState): OrgId {
  const org = Object.values(state.orgs).find((o) => o.kind === 'hostile');
  if (org === undefined) {
    throw new Error('no hostile org in the generated world');
  }
  return org.id;
}

/** A running Asset with a Contact Channel, as a landed pitch or a turn leaves one. */
function runningAsset(npc: NpcId, turned = false): Relationship {
  const profile: AssetProfile = {
    access: asTruth({ locs: [], orgs: [], npcs: [] }),
    reliability: asTruth(1),
    turned,
    hostileControlled: asTruth(false),
  };
  return { ...newRelationship(npc), recruited: true, channel: true, trust: 0.6, asset: profile };
}

/** `state` with `rel` recorded and its NPC among the player's contacts. */
function withAsset(state: WorldState, rel: Relationship): WorldState {
  return {
    ...state,
    relationships: { ...state.relationships, [rel.npc]: rel },
    player: {
      ...state.player,
      contacts: [...new Set([...state.player.contacts, rel.npc])],
    },
  };
}

/**
 * The first time in the opening week, and the first Location, at which some
 * NPC is present while the Location is open: `state` with the clock and the
 * player moved there (a wait and a trip away), plus that NPC.
 */
function withSomeoneHere(state: WorldState): { state: WorldState; npc: NpcId } {
  const locs = (Object.keys(state.city.locations) as LocId[]).sort();
  for (let day = state.time.day; day < state.time.day + 7; day += 1) {
    for (const phase of [0, 1, 2, 3] as Phase[]) {
      const then: WorldState = { ...state, time: { day, phase } };
      for (const loc of locs) {
        const here = visibleNpcsAt(then, loc);
        if (isOpenAt(then.city.locations[loc], phase) && here.length > 0) {
          return { state: { ...then, player: { ...then.player, loc } }, npc: here[0] };
        }
      }
    }
  }
  throw new Error('no NPC is present at an open Location in the opening week');
}

/** `state` with the player at the Station (a trip away), which is open around the clock. */
function atStation(state: WorldState): WorldState {
  for (const loc of (Object.keys(state.city.locations) as LocId[]).sort()) {
    const there: WorldState = { ...state, player: { ...state.player, loc } };
    if (isAtStation(there)) {
      expect(isOpenAt(there.city.locations[loc], there.time.phase)).toBe(true);
      return there;
    }
  }
  throw new Error('the generated city has no Station');
}

/**
 * Quote and resolve an action that must be allowed, and check the cost
 * contract the Turn Pipeline relies on (slice Property 16, Req 11.4): `resolve`
 * changes the Budget by exactly the quoted money and leaves the clock for the
 * pipeline to advance by the quoted phases.
 */
function resolveAllowed(
  state: WorldState,
  action: Action,
  ctx: ResolverContext,
): ResolveResult & { readonly quote: ActionQuote } {
  const q = quote(state, action, ctx);
  expect(q.allowed, q.reason).toBe(true);
  const out = resolve(state, action, createPrng(`allowed-${action.kind}`), ctx);
  expect(balance(out.next.station.ledger)).toBe(balance(state.station.ledger) - q.money);
  expect(out.next.time).toEqual(state.time);
  return { ...out, quote: q };
}

// ---------------------------------------------------------------------------
// Every action kind is dispatched (slice-integration Req 11.1–11.4)
// ---------------------------------------------------------------------------

describe('quote and resolve — every action kind is dispatched (slice-integration Req 11.1–11.4)', () => {
  it('quotes and resolves an action of every kind without throwing', () => {
    const state = world();
    for (const action of nonsenseActions(state)) {
      const q = quote(state, action, CTX);
      expect(q.reason ?? '', action.kind).not.toContain('not yet implemented');
      const out = resolve(state, action, createPrng(`any-${action.kind}`), CTX);
      if (q.allowed) {
        expect(balance(out.next.station.ledger), action.kind).toBe(
          balance(state.station.ledger) - q.money,
        );
        expect(out.next.time, action.kind).toEqual(state.time);
      } else {
        // A refusal says why, and leaves the state as it was.
        expect(q.reason, action.kind).toBeTruthy();
        expect(out.next, action.kind).toBe(state);
        expect(out.ended, action.kind).toBeUndefined();
      }
    }
  });

  it('decrypt: refuses an Intercept the player has not collected', () => {
    const state = world();
    const action: Action = {
      kind: 'decrypt',
      intercept: 'int:none',
      submission: { kind: 'plaintext', text: '' },
    };
    expect(quote(state, action, CTX)).toEqual({
      allowed: false,
      reason: DECRYPT_NOT_COLLECTED_REASON,
      phases: 0,
      money: 0,
    });
    expect(resolve(state, action, createPrng('d'), CTX).next).toBe(state);
  });

  it('decrypt: breaks a collected Intercept with its key, and rejects a wrong one', () => {
    const base = world();
    const intercept = base.transmissions[0]?.intercept;
    if (intercept === undefined) {
      throw new Error('the generated world has no seeded traffic');
    }
    const state: WorldState = {
      ...base,
      intercepts: { ...base.intercepts, [intercept.id]: intercept },
    };

    const wrong: Action = {
      kind: 'decrypt',
      intercept: intercept.id,
      submission: { kind: 'plaintext', text: 'NOTHING TO SEE' },
    };
    const rejected = resolveAllowed(state, wrong, CTX);
    expect(rejected.quote).toEqual({ allowed: true, phases: DECRYPT_PHASE_COST, money: 0 });
    expect(rejected.next).toBe(state);
    expect(rejected.result.factLines).toEqual([DECRYPT_REJECTED_LINE]);

    const right: Action = {
      kind: 'decrypt',
      intercept: intercept.id,
      submission: { kind: 'key', spec: revealedSpec(intercept) },
    };
    const broken = resolveAllowed(state, right, CTX);
    expect(broken.next.intercepts[intercept.id]?.broken).toBe(true);
    for (const obs of broken.result.observations) {
      expect(obs.kind === 'proposition' && obs.source).toEqual({
        kind: 'intercept',
        id: intercept.id,
      });
    }
  });

  it('cable: sends a report from the Station and queues the pending Cable', () => {
    const state = atStation(world());
    const action: Action = { kind: 'cable', body: { kind: 'report', body: 'All quiet.' } };
    const out = resolveAllowed(state, action, CTX);
    expect(out.quote).toEqual({ allowed: true, phases: CABLE_PHASE_COST, money: 0 });
    expect(out.next.station.pendingCables).toHaveLength(state.station.pendingCables.length + 1);
    expect(out.result.factLines).toEqual([CABLE_SENT_LINES.report]);
  });
});

// ---------------------------------------------------------------------------
// Which kinds the Location gates (slice-integration Req 11; slice Req 21.5)
// ---------------------------------------------------------------------------

describe('actionLocation — Location-bound and Location-free kinds (slice-integration Req 11)', () => {
  it('gives task, pay, feed, arrest, decrypt, cable, read and wait no Location', () => {
    const state = world();
    const free = nonsenseActions(state).filter((a) =>
      ['task', 'pay', 'feed', 'arrest', 'decrypt', 'cable', 'read', 'wait'].includes(a.kind),
    );
    expect(free).toHaveLength(8);
    for (const action of free) {
      expect(actionLocation(state, action), action.kind).toBeUndefined();
    }
  });

  it('keeps confront and turn-agent at the player’s Location, refused there when it is closed', () => {
    const base = world();
    const closed = Object.values(base.city.locations).find((loc) =>
      ([0, 1, 2, 3] as Phase[]).some((p) => !loc.hours[p]),
    );
    if (closed === undefined) {
      throw new Error('every Location in the generated world is always open');
    }
    const phase = ([0, 1, 2, 3] as Phase[]).find((p) => !closed.hours[p]) as Phase;
    const state = atPhase({ ...base, player: { ...base.player, loc: closed.id } }, phase);
    for (const action of nonsenseActions(state)) {
      const reason = locationGate(state, content, action);
      if (action.kind === 'confront' || action.kind === 'turn-agent' || action.kind === 'talk') {
        expect(actionLocation(state, action), action.kind).toBe(closed.id);
        expect(reason, action.kind).toContain('closed');
      }
      if (['task', 'pay', 'feed', 'arrest'].includes(action.kind)) {
        expect(reason, action.kind).toBeUndefined();
      }
    }
  });

  it('lets every core Location Type that allows talk also allow confront and turn-agent', () => {
    for (const type of content.locationTypes.values()) {
      if (type.allowedActions.includes('talk')) {
        expect(type.allowedActions, type.id).toContain('confront');
        expect(type.allowedActions, type.id).toContain('turn-agent');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Each kind can be allowed with the real core pack (slice-integration Req 11.1)
// ---------------------------------------------------------------------------

describe('reachable with the core pack — arrest, turn-agent, pay, task, feed, confront (slice-integration Req 11.1)', () => {
  it('arrest: granted where the player starts, on enough evidence, with the starting authority', () => {
    const state = world();
    expect(state.player.arrestAuthority).toBe(STARTING_ARREST_AUTHORITY);
    const npc = npcIdsBesidesLeader(state)[0];
    const ctx: ResolverContext = {
      content,
      arrestEvidence: { [npc]: STANDARD.arrest.threshold },
    };
    const out = resolveAllowed(state, { kind: 'arrest', npc }, ctx);
    expect(out.quote).toEqual({ allowed: true, phases: ARREST_PHASE_COST, money: 0 });
    expect(out.next.player.arrests).toEqual([npc]);
  });

  it('turn-agent: pitched at the Station to the person an arrest put in Station Custody', () => {
    const base = atStation(world());
    const npc = npcIdsBesidesLeader(base)[0];
    const arrestCtx: ResolverContext = {
      content,
      arrestEvidence: { [npc]: STANDARD.arrest.threshold },
    };
    const held = resolve(base, { kind: 'arrest', npc }, createPrng('arrest'), arrestCtx);
    expect(held.ended).toBeUndefined();
    expect(held.next.relationships[npc]?.custody?.by).toBe('station');
    const out = resolveAllowed(held.next, { kind: 'turn-agent', npc, lever: 'coercion' }, CTX);
    expect(out.quote).toEqual({ allowed: true, phases: TURN_PHASE_COST, money: 0 });
  });

  it('pay: pays a running Asset, debiting exactly the amount', () => {
    const base = world();
    const npc = npcIdsBesidesLeader(base)[0];
    const state = withAsset(base, runningAsset(npc));
    const amount = 100;
    expect(balance(state.station.ledger)).toBeGreaterThanOrEqual(amount);
    const out = resolveAllowed(state, { kind: 'pay', npc, amount }, CTX);
    expect(out.quote).toEqual({ allowed: true, phases: PAY_PHASE_COST, money: amount });
  });

  it('task: tasks a running Asset over its Contact Channel, adding the tasking Exposure', () => {
    const base = world();
    const [asset, target] = npcIdsBesidesLeader(base);
    const rel = runningAsset(asset);
    const state = withAsset(base, rel);
    const action: Action = { kind: 'task', asset, task: { kind: 'collect', target } };
    const out = resolveAllowed(state, action, CTX);
    expect(out.quote).toEqual({ allowed: true, phases: TASK_PHASE_COST, money: 0 });
    expect(out.next.relationships[asset]?.exposure).toBeCloseTo(rel.exposure + TASKING_EXPOSURE);
  });

  it('feed: passes a composed item through a turned agent the player can reach', () => {
    const base = world();
    const [agent, subject] = npcIdsBesidesLeader(base);
    const org = hostileOrg(base);
    const state = withKnown(withAsset(base, runningAsset(agent, true)), subject, org);
    const action: Action = {
      kind: 'feed',
      asset: agent,
      items: [{ from: 'composed', prop: { predicate: 'MEMBER_OF', subject, object: org } }],
    };
    const out = resolveAllowed(state, action, { content, claims: {} });
    expect(out.quote).toEqual({ allowed: true, phases: FEED_PHASE_COST, money: 0 });
    expect(out.next.scheduled.some((e) => e.kind === 'feed-delivered')).toBe(true);
  });

  it('confront: presses a person present at an open Location with a Claim about them', () => {
    const { state, npc } = withSomeoneHere(world());
    const claim = 'claim:confront-reach';
    const prop: Proposition = {
      id: 'prop:confront-reach',
      subject: npc,
      predicate: 'MEMBER_OF',
      object: hostileOrg(state),
    };
    const out = resolveAllowed(state, { kind: 'confront', npc, claim }, {
      content,
      claims: { [claim]: prop },
    });
    expect(out.quote).toEqual({ allowed: true, phases: CONFRONT_PHASE_COST, money: 0 });
    expect(out.next.relationships[npc]?.coverState).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// isOpenAt helper
// ---------------------------------------------------------------------------

describe('isOpenAt', () => {
  it('reads the folded per-phase hours', () => {
    const state = world();
    const loc = state.city.locations[state.player.loc];
    for (const p of [0, 1, 2, 3] as Phase[]) {
      expect(isOpenAt(loc, p)).toBe(loc.hours[p] === true);
    }
  });
});

// ---------------------------------------------------------------------------
// The not-implemented stubs are gone (slice-integration Req 11.2; task 2.6)
// ---------------------------------------------------------------------------

describe('notImplementedQuote and OWNED_BY are removed (slice-integration Req 11.2)', () => {
  it('exports neither from the engine public index', async () => {
    const engine = await import('../../index.js');
    const keys = Object.keys(engine);
    expect(keys).not.toContain('notImplementedQuote');
    expect(keys).not.toContain('OWNED_BY');
    // No quote reason the dispatch produces mentions the old stub, for any kind.
    const state = world();
    for (const action of nonsenseActions(state)) {
      expect(quote(state, action, CTX).reason ?? '', action.kind).not.toContain(
        'not yet implemented',
      );
    }
  });
});

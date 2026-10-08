/**
 * Behaviour tests for the Player-View action catalogue (slice-integration task
 * 7.6; design, "Player View: actions catalogue"; Requirements 11.1, 19.3).
 *
 * These drive {@link buildActionCatalogue} over a generated core-pack
 * {@link WorldState} — one carrying real {@link Truth}-branded ground truth —
 * and assert that:
 *
 * - the catalogue always offers `wait` and `travel`, so the "here" panel is
 *   never empty;
 * - `talk`, `approach`, `surveil` and `follow` appear when a person is present
 *   at the current open Location;
 * - `intercept` and `cable` are offered at the Station;
 * - `read` is offered for a Document in hand;
 * - `decrypt` is offered for a collected, unbroken Intercept;
 * - `task`, `pay` and `turn-agent` are offered for a running Asset;
 * - every option carries a well-formed {@link ActionQuote} — allowed with
 *   finite non-negative costs, or disallowed with a reason; and
 * - the catalogue never throws, over every Location and phase of a generated
 *   world.
 *
 * The fixtures mirror `views.spec.ts`: the real core pack, generated worlds, and
 * shallow typed overrides to place the player and seed the Player-View fields
 * the catalogue reads.
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
import {
  asTruth,
  generate,
  newRelationship,
  visibleNpcsAt,
  ScenarioConfigSchema,
  type ChannelId,
  type DocId,
  type GenerateInputs,
  type Intercept,
  type InterceptId,
  type LocId,
  type NpcId,
  type OrgId,
  type Phase,
  type Proposition,
  type ResolverContext,
  type WorldState,
} from '@tradecraft/engine';

import { CaseFile } from '../casefile/casefile.js';
import { implicationRules, type BriefView } from '../casefile/evidence.js';
import { buildActionCatalogue } from './action-catalogue.js';
import { PlayerViewEngine } from './engine-api.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors views.spec.ts)
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
    throw new Error('core pack failed to load');
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
    mole: true,
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

function world(seed = 'alpha'): WorldState {
  return generate(seed, inputs());
}

const CTX: ResolverContext = { content };

// The Station Location Type (`isAtStation` matches it). Mirrors
// engine/action/intercept.spec.ts's `STATION_LOCATION_TYPE`.
const STATION_LOCATION_TYPE = 'station-hq';

/**
 * Find a Location, at some phase, that has at least one NPC scheduled there —
 * so the catalogue offers talk/approach/surveil/follow for a present person.
 * Returns the state with the clock set to that phase, the Location, and the
 * NPCs present.
 */
function findSceneWithPeople(
  state: WorldState,
): { state: WorldState; loc: LocId; npcs: readonly NpcId[] } | undefined {
  for (let phase = 0 as Phase; phase <= 3; phase = (phase + 1) as Phase) {
    const at = { ...state, time: { ...state.time, phase } };
    for (const loc of Object.keys(at.city.locations) as LocId[]) {
      const npcs = visibleNpcsAt(at, loc);
      if (npcs.length > 0) {
        return { state: at, loc, npcs };
      }
    }
  }
  return undefined;
}

/** Put the player at a Location (a shallow, typed override). */
function atLocation(state: WorldState, loc: LocId): WorldState {
  return { ...state, player: { ...state.player, loc } };
}

/**
 * Restamp the player's current Location to a Station HQ open in every phase, so
 * `isAtStation` holds and the Station actions quote as allowed. Mirrors
 * `atStation` in engine/action/intercept.spec.ts.
 */
function atStation(state: WorldState): WorldState {
  const locId = state.player.loc;
  const loc = state.city.locations[locId];
  return {
    ...state,
    city: {
      ...state.city,
      locations: {
        ...state.city.locations,
        [locId]: {
          ...loc,
          type: STATION_LOCATION_TYPE,
          public: false,
          hours: { 0: true, 1: true, 2: true, 3: true },
        },
      },
    },
  };
}

/** Add a recruited Asset Relationship for an NPC with a Contact Channel. */
function withAsset(state: WorldState, npc: NpcId): WorldState {
  const rel = { ...newRelationship(npc), recruited: true, channel: true, trust: 0.6 };
  return {
    ...state,
    relationships: { ...state.relationships, [npc]: rel },
  };
}

/** Add a collected, unbroken Intercept to the player's collected set. */
function withIntercept(state: WorldState, id: InterceptId): WorldState {
  const intercept: Intercept = {
    id,
    at: state.time,
    channel: 'chan:test/radio' as ChannelId,
    owner: 'org:hostile' as OrgId,
    direction: 'outbound',
    meta: { length: 12 },
    ciphertext: 'KHOORZRUOGDE',
    spec: asTruth({ kind: 'caesar', shift: 3 } as const),
    plaintextProps: asTruth<readonly string[]>([]),
    origin: asTruth('noise' as const),
  };
  return {
    ...state,
    intercepts: { ...state.intercepts, [id]: intercept },
  };
}

/** A pending cover duty at the player's current place and time. */
function withPendingDuty(state: WorldState, id: string): WorldState {
  const duty = {
    id,
    template: 'desk-work',
    loc: state.player.loc,
    slot: { day: state.time.day, phase: state.time.phase },
    phases: 1,
    mandatory: true,
    standingGain: 0.04,
    suspicionDelta: 0.02,
    attendees: [] as const,
    status: 'pending' as const,
  };
  const ambient = {
    ...(state.ambient ?? {}),
    duties: [...(state.ambient?.duties ?? []), duty],
  };
  return { ...state, ambient: ambient as WorldState['ambient'] };
}

/** The kinds the catalogue offered. */
function kindsOf(state: WorldState): Set<string> {
  return new Set(buildActionCatalogue(state, CTX).map((o) => o.action.kind));
}

/** Assert a quote is well-formed: allowed with finite costs, or disallowed with a reason. */
function expectWellFormedQuote(quote: {
  allowed: boolean;
  reason?: string;
  phases: number;
  money: number;
}): void {
  expect(Number.isFinite(quote.phases)).toBe(true);
  expect(Number.isFinite(quote.money)).toBe(true);
  expect(quote.phases).toBeGreaterThanOrEqual(0);
  expect(quote.money).toBeGreaterThanOrEqual(0);
  if (!quote.allowed) {
    expect(typeof quote.reason).toBe('string');
    expect(quote.reason).not.toBe('');
  }
}

// ---------------------------------------------------------------------------
// Always-available actions
// ---------------------------------------------------------------------------

describe('buildActionCatalogue — always available', () => {
  it('offers wait and travel in every situation, so the catalogue is never empty', () => {
    const w = world();
    const kinds = kindsOf(w);
    expect(kinds.has('wait')).toBe(true);
    expect(kinds.has('travel')).toBe(true);
    expect(buildActionCatalogue(w, CTX).length).toBeGreaterThan(0);
  });

  it('offers all four wait durations and both travel countersurveillance variants', () => {
    const w = world();
    const options = buildActionCatalogue(w, CTX);
    const waitPhases = options
      .filter((o) => o.action.kind === 'wait')
      .map((o) => (o.action as { phases: number }).phases)
      .sort();
    expect(waitPhases).toEqual([1, 2, 3, 4]);

    // Pick a travel target and check both the plain and countersurveillance
    // variants are present.
    const travels = options.filter((o) => o.action.kind === 'travel');
    expect(travels.length).toBeGreaterThan(0);
    const to = (travels[0].action as { to: LocId }).to;
    const variants = travels
      .filter((o) => (o.action as { to: LocId }).to === to)
      .map((o) => (o.action as { countersurveillance: boolean }).countersurveillance)
      .sort();
    expect(variants).toEqual([false, true]);
  });
});

// ---------------------------------------------------------------------------
// Situation-dependent actions
// ---------------------------------------------------------------------------

describe('buildActionCatalogue — people present', () => {
  it('offers talk, approach, surveil and follow when a person is present', () => {
    const w = world();
    const found = findSceneWithPeople(w);
    expect(found).toBeDefined();
    if (found === undefined) return;

    const state = atLocation(found.state, found.loc);
    const kinds = kindsOf(state);
    expect(kinds.has('talk')).toBe(true);
    expect(kinds.has('approach')).toBe(true);
    expect(kinds.has('surveil')).toBe(true);
    expect(kinds.has('follow')).toBe(true);
  });

  it('offers one talk and one follow per present person, by the id the player holds', () => {
    const w = world();
    const found = findSceneWithPeople(w);
    expect(found).toBeDefined();
    if (found === undefined) return;

    const state = atLocation(found.state, found.loc);
    const options = buildActionCatalogue(state, CTX);
    const talks = options.filter((o) => o.action.kind === 'talk');
    // One talk candidate per visible person.
    expect(talks.length).toBe(found.npcs.length);
    for (const t of talks) {
      const npc = (t.action as { npc: string }).npc;
      // The handle is the raw npc id or the player's allocated unk id.
      const handle = state.player.unkIds[npc as NpcId] ?? npc;
      expect(npc).toBe(handle);
    }
  });
});

describe('buildActionCatalogue — Station actions', () => {
  it("offers travel to the player's own Station, which is not public", () => {
    const base = world();
    const station = Object.values(base.city.locations).find(
      (loc) => loc.type === STATION_LOCATION_TYPE,
    );
    expect(station).toBeDefined();
    if (station === undefined) return;
    expect(station.public).toBe(false);
    expect(base.player.known.entities).not.toContain(station.id);

    // Stand somewhere public, away from the Station.
    const elsewhere = Object.values(base.city.locations).find(
      (loc) => loc.public && loc.id !== station.id,
    );
    expect(elsewhere).toBeDefined();
    if (elsewhere === undefined) return;
    const state = atLocation(base, elsewhere.id);

    const variants = buildActionCatalogue(state, CTX)
      .filter(
        (o) => o.action.kind === 'travel' && (o.action as { to: LocId }).to === station.id,
      )
      .map((o) => (o.action as { countersurveillance: boolean }).countersurveillance)
      .sort();
    expect(variants).toEqual([false, true]);
  });

  it('offers intercept and cable at the Station', () => {
    const w = atStation(world());
    const kinds = kindsOf(w);
    expect(kinds.has('intercept')).toBe(true);
    expect(kinds.has('cable')).toBe(true);
    // The funds and report cables are always offered; a Station is where they
    // are allowed, so at least one cable quote is allowed.
    const cables = buildActionCatalogue(w, CTX).filter((o) => o.action.kind === 'cable');
    expect(cables.some((o) => o.quote.allowed)).toBe(true);
  });
});

describe('buildActionCatalogue — Documents, Intercepts and Assets', () => {
  it('offers read for a Document in hand', () => {
    const w = world();
    // Every generated world has at least one Document obtainable somewhere; the
    // brief Cable is in hand from the start, so read is offered.
    const options = buildActionCatalogue(w, CTX);
    const reads = options.filter((o) => o.action.kind === 'read');
    expect(reads.length).toBeGreaterThan(0);
    for (const r of reads) {
      expectWellFormedQuote(r.quote);
    }
  });

  it('offers decrypt for a collected, unbroken Intercept', () => {
    const id = 'intercept:test-1' as InterceptId;
    const w = withIntercept(world(), id);
    const options = buildActionCatalogue(w, CTX);
    const decrypts = options.filter((o) => o.action.kind === 'decrypt');
    expect(decrypts.length).toBe(1);
    expect((decrypts[0].action as { intercept: string }).intercept).toBe(id);
    // The collected Intercept exists, so decrypt quotes as allowed.
    expect(decrypts[0].quote.allowed).toBe(true);
  });

  it('does not offer decrypt for a broken Intercept', () => {
    const id = 'intercept:test-broken' as InterceptId;
    const base = withIntercept(world(), id);
    const broken: WorldState = {
      ...base,
      intercepts: {
        ...base.intercepts,
        [id]: { ...base.intercepts[id], broken: true },
      },
    };
    const decrypts = buildActionCatalogue(broken, CTX).filter(
      (o) => o.action.kind === 'decrypt',
    );
    expect(decrypts).toEqual([]);
  });

  it('offers task, pay and turn-agent for a running Asset', () => {
    const w = world();
    // Pick any NPC and make them a running Asset.
    const npc = Object.keys(w.npcs)[0] as NpcId;
    const withAssetState = withAsset(w, npc);
    const kinds = kindsOf(withAssetState);
    expect(kinds.has('task')).toBe(true);
    expect(kinds.has('pay')).toBe(true);
    expect(kinds.has('turn-agent')).toBe(true);

    // pay names the Asset.
    const pays = buildActionCatalogue(withAssetState, CTX).filter(
      (o) => o.action.kind === 'pay',
    );
    expect(pays.some((o) => (o.action as { npc: string }).npc === npc)).toBe(true);
  });

  it('offers no task, pay or turn-agent when the player has no Assets', () => {
    const w = world();
    // A freshly generated world has no recruited Relationships.
    const recruited = Object.values(w.relationships).filter((r) => r.recruited);
    expect(recruited.length).toBe(0);
    const kinds = kindsOf(w);
    expect(kinds.has('task')).toBe(false);
    expect(kinds.has('pay')).toBe(false);
    expect(kinds.has('turn-agent')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Arrest candidates
// ---------------------------------------------------------------------------

/** A known NPC who is not at the player's current Location now. */
function absentKnownNpc(state: WorldState): NpcId {
  const here = new Set<string>(visibleNpcsAt(state, state.player.loc));
  const npc = state.player.known.entities.find(
    (id) => id.startsWith('npc:') && !here.has(id),
  );
  if (npc === undefined) {
    throw new Error('the fixture world has no known NPC away from the player');
  }
  return npc as NpcId;
}

/** Three distinct implicating Propositions against `npc`, for the arrest gate. */
function implicatingProps(state: WorldState, npc: NpcId): Proposition[] {
  const cell = Object.values(state.orgs).find((org) => org.kind === 'cell');
  if (cell === undefined) {
    throw new Error('the fixture world has no Cell org');
  }
  return [
    { id: 'prop:test/member', subject: npc, predicate: 'MEMBER_OF', object: cell.id },
    {
      id: 'prop:test/plan',
      subject: npc,
      predicate: 'PLANS',
      object: { kind: 'text', value: 'the operation' },
    },
    { id: 'prop:test/target', subject: npc, predicate: 'TARGETS', object: state.player.loc },
  ];
}

describe('buildActionCatalogue — arrest', () => {
  it('offers an arrest for a person the Case File holds evidence against, present or not', () => {
    const w = world();
    const target = absentKnownNpc(w);
    const threshold = w.meta.preset.arrest.threshold;
    const ctx: ResolverContext = { content, arrestEvidence: { [target]: threshold } };

    const arrests = buildActionCatalogue(w, ctx, (id) => (id === target ? threshold : 0)).filter(
      (o) => o.action.kind === 'arrest',
    );
    expect(arrests.map((o) => (o.action as { npc: string }).npc)).toEqual([target]);
    expect(arrests[0].quote.allowed).toBe(true);
  });

  it('offers no arrest when the Case File holds no evidence', () => {
    expect(kindsOf(world()).has('arrest')).toBe(false);
  });
});

describe('PlayerViewEngine — quotes read the Case File projection', () => {
  it('quotes and offers an arrest once the Case File case score reaches the threshold', () => {
    const w = world();
    const target = absentKnownNpc(w);
    const props = implicatingProps(w, target);

    // Two Documents assert each Proposition, so every Claim is corroborated.
    const caseFile = new CaseFile();
    for (const doc of ['doc:test/one', 'doc:test/two'] as DocId[]) {
      for (const prop of props) {
        caseFile.add({ source: { kind: 'document', id: doc }, prop, observedAt: w.time });
      }
    }
    const brief: BriefView = {
      hostileOrgs: Object.values(w.orgs)
        .filter((org) => org.kind === 'hostile' || org.kind === 'cell')
        .map((org) => org.id),
      hostileChannels: [],
      materiel: [],
    };
    const rules = implicationRules(
      content.predicates.predicates.map((p) => [p.id, p.definition.implication] as const),
    );
    const engine = new PlayerViewEngine({ state: w, caseFile, cityData, ctx: CTX, brief, rules });

    // The case score is the weighted sum of the confirmed facts, and it clears
    // the preset's arrest threshold.
    expect(engine.caseFile.evidence(target)).toBeGreaterThanOrEqual(
      w.meta.preset.arrest.threshold,
    );
    const arrest = { kind: 'arrest', npc: target } as const;
    expect(engine.quote(arrest).allowed).toBe(true);
    const offered = engine
      .actions()
      .find((o) => o.action.kind === 'arrest' && (o.action as { npc: string }).npc === target);
    expect(offered?.quote.allowed).toBe(true);
  });
});

describe('buildActionCatalogue — cover duties', () => {
  it('offers attend-duty for a pending cover duty and omits it when there is none', () => {
    const w = world();
    expect(kindsOf(w).has('attend-duty')).toBe(false);
    const dutyId = 'duty:desk-work:0:1';
    const offered = buildActionCatalogue(withPendingDuty(w, dutyId), CTX).filter(
      (option) => option.action.kind === 'attend-duty',
    );
    expect(offered.map((option) => (option.action as { duty: string }).duty)).toEqual([dutyId]);
    expectWellFormedQuote(offered[0]?.quote ?? { allowed: false, phases: 0, money: 0 });
  });
});

// ---------------------------------------------------------------------------
// Well-formedness and totality
// ---------------------------------------------------------------------------

describe('buildActionCatalogue — well-formed and total', () => {
  it('carries a well-formed quote on every option', () => {
    const w = world();
    for (const option of buildActionCatalogue(w, CTX)) {
      expectWellFormedQuote(option.quote);
    }
  });

  it('never throws over every Location and phase of a generated world', () => {
    for (const seed of ['alpha', 'bravo', 'charlie']) {
      const base = world(seed);
      for (let phase = 0 as Phase; phase <= 3; phase = (phase + 1) as Phase) {
        for (const loc of Object.keys(base.city.locations) as LocId[]) {
          const state = atLocation({ ...base, time: { ...base.time, phase } }, loc);
          expect(() => {
            const options = buildActionCatalogue(state, CTX);
            for (const o of options) {
              expectWellFormedQuote(o.quote);
            }
          }).not.toThrow();
        }
      }
    }
  });
});

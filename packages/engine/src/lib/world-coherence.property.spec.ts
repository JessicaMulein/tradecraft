/**
 * Feature: tradecraft, Property 33: World coherence.
 *
 * The capstone property for the group-26 world review (tasks 26.1–26.10). It
 * drives the *real* `generateGame(seed, inputs)` path over a seed sweep × the
 * three Difficulty Presets × the mole on/off, and asserts the five coherence
 * invariants the design fixes as **Property 33** (design, "Property 33: World
 * coherence"; Requirements 1.3, 1.5, 1.7, 1.8, 3.6, 30.5):
 *
 * For any seed, Difficulty Preset and mole setting, the generated world
 * satisfies all of:
 *
 * 1. **Mole (Req 1.5, 30.5).** With a mole enabled, the mole's true allegiance
 *    is the Hostile Service, its apparent allegiance is the Station, and the
 *    Truth Store holds its `REPORTS_TO` fact.
 * 2. **Apparent allegiance / Dossiers (Req 1.8, 30.5).** No Cell member presents
 *    as `cell`, and no Dossier states an allegiance the Station slice does not
 *    hold.
 * 3. **Descriptors (Req 1.3, 1.7).** Every descriptor entry an NPC wears fits
 *    its gender, and every two Principals' descriptors differ in at least two
 *    elements (the `MIN_DESCRIPTOR_DIFFERENCE` symmetric-difference rule).
 * 4. **Names (Req 1.7, 1.8).** No two NPCs share a full name or a surname
 *    across the whole roster. Principals also keep distinct given names.
 * 5. **Executed traces (Req 3.6).** Every executed trace event has the kind,
 *    participants, place, Channel and materiel its template trace names (the
 *    bound {@link StageTrace} fields task 26.1/26.2 resolved).
 *
 * The loader, `GenerateInputs` and `ScenarioConfig` construction mirror
 * `generate.truth.spec.ts` and `generate.solvability.spec.ts`; the descriptor /
 * name helpers mirror `principals.spec.ts`; the trace-event check runs the real
 * `executePlotDay` over every stage, exactly as `plot-execution.spec.ts` does,
 * and reads back each emitted hidden {@link SimEvent} against the stage's own
 * {@link StageTrace}s. The mole's `REPORTS_TO` fact is rebuilt from the same
 * core stream the gate verified (the `discoveryReports` pattern in
 * `generate.truth.spec.ts`).
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  fittingPhrases,
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

import { createPrng, derive } from './prng/prng.js';
import {
  revealTruth,
  type GameTime,
  type NpcId,
  type OrgId,
} from './model/core.js';
import type { SimEvent, WorldState } from './model/state.js';
import { generateCity } from './city/generate.js';
import {
  generateOrgs,
  generatePrincipals,
  STATION_SERVICES,
  STATION_SERVICE_STREAM,
} from './city/principals.js';
import { MIN_DESCRIPTOR_DIFFERENCE } from './city/principals.js';
import { generatePlot } from './city/plot.js';
import { generateComms } from './city/comms.js';
import { assignKnowledge, type GeneratedKnowledge } from './city/knowledge.js';
import { generateStartingBrief } from './city/starting-brief.js';
import {
  executePlotDay,
  type PlotWorld,
} from './clock/plot-execution.js';
import type { PlotState, StageTrace } from './city/plot.js';
import {
  ScenarioConfigSchema,
  type ScenarioConfig,
} from './config/scenario-config.js';
import { generateGame, type GenerateInputs } from './generate.js';
import { settingStreamSeed } from './setting/stream.js';
import { drawSetting } from './setting/setting.js';
import { type ContentSetV2 } from './setting/content-set-v2.js';
import { parseIsoDate } from '@tradecraft/content';

// ---------------------------------------------------------------------------
// Core pack loader (mirrors generate.truth.spec.ts)
// ---------------------------------------------------------------------------

const ENGINE_LIB = dirname(fileURLToPath(import.meta.url));
const CORE_DIR = join(ENGINE_LIB, '..', '..', '..', 'content', 'packs', 'core');

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
const locationTypes = [...content.locationTypes.values()];

function preset(id: string): DifficultyPreset {
  for (const [key, value] of content.difficultyPresets) {
    if (key === id || key.endsWith(`/${id}`)) {
      return value;
    }
  }
  throw new Error(`no difficulty preset ${id}`);
}

/** The three shipped presets, by local id. */
const PRESET_IDS = ['easy', 'standard', 'hard'] as const;
const START: GameTime = { day: 0, phase: 0 };

/** A minimal valid scenario config, with the mole flag the caller chooses. */
function scenario(presetId: string, mole: boolean): ScenarioConfig {
  return ScenarioConfigSchema.parse({
    difficulty: { preset: presetId },
    mole,
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: {
        trust: 1,
        riskAversion: 1,
        scheduleConflict: 1,
        agendaInterest: 1,
      },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
}

function inputs(presetId: string, mole: boolean): GenerateInputs {
  return {
    content,
    preset: preset(presetId),
    scenario: scenario(presetId, mole),
    cityData,
    descriptors,
    publicTexts,
  };
}

function cableTemplate() {
  for (const [key, value] of content.documentTemplates) {
    if (key === 'cable-hq-directive' || key.endsWith('/cable-hq-directive')) {
      return value;
    }
  }
  throw new Error('no cable template');
}

/**
 * Rebuild the step-1→8 core stream for a seed/preset/mole — the same stream
 * `generateGame` hands its discovery gate — so we can read the generated
 * {@link GeneratedKnowledge} (its mole facts) without re-deriving them. Mirrors
 * `generate.truth.spec.ts`'s `discoveryReports`.
 */
function coreKnowledge(
  seed: string,
  presetId: string,
  mole: boolean,
): GeneratedKnowledge {
  const p = preset(presetId);
  // Mirror `generate`'s setting step (content-expansion task 3.8): step 1 (the
  // Core City) runs on the setting stream, so the core stream starts at step 2.
  const settingPrng = createPrng(settingStreamSeed(seed, 0));
  const selection = drawSetting(
    content as ContentSetV2,
    scenario(presetId, mole).setting,
    settingPrng,
    0,
  );
  const startMonth = parseIsoDate(selection.startDate)?.month ?? 1;
  const { city } = generateCity(settingPrng, locationTypes, cityData, {
    startMonth,
  });

  const prng = createPrng(seed);
  const orgs = generateOrgs(prng);
  const service = createPrng(derive(seed, STATION_SERVICE_STREAM)).pick(STATION_SERVICES);
  const principals = generatePrincipals(prng, content, descriptors, city, orgs, { service });
  const { plot } = generatePlot(prng, content, p, city, orgs, principals, START);
  const comms = generateComms(prng, content, city, orgs, principals, plot, START);
  const knowledge = assignKnowledge(
    prng,
    orgs,
    principals,
    plot,
    comms,
    city,
    { hqFalseBeliefRate: p.hqFalseBeliefRate },
    { mole },
  );
  // Keep the stream aligned with generation (the brief draws on its own stream,
  // but running it mirrors the real path exactly).
  generateStartingBrief(
    seed,
    content,
    city,
    principals,
    comms,
    knowledge.station,
    cableTemplate(),
    { city, npcs: principals.npcs, orgs: orgs.orgs },
    { startingBudget: p.startingBudget },
  );
  return knowledge;
}

/**
 * The Principal NPC ids in a generated world: every NPC that is not a Background
 * NPC. The noise generator mints Background NPCs in the `npc:bg-<n>` id space
 * (see `noise/background.ts`), distinct from the Principal generator's
 * `npc:<name-slug>-<index>` ids, so a Principal is any NPC whose id is not a
 * `npc:bg-` id. Property 33's stricter clauses — the two-element descriptor
 * difference and the given/family name-uniqueness rule — are Principal-only; the
 * descriptor-fit and full-name-uniqueness clauses apply to every NPC.
 */
function principalIds(world: WorldState): NpcId[] {
  return (Object.keys(world.npcs) as NpcId[]).filter(
    (id) => !id.startsWith('npc:bg-'),
  );
}

/** The Hostile Service org id in a world (the org whose kind is `hostile`). */
function hostileOrgId(world: WorldState): OrgId {
  for (const org of Object.values(world.orgs)) {
    if (org.kind === 'hostile') {
      return org.id;
    }
  }
  throw new Error('no hostile org in the world');
}

/** The set of apparent-allegiance strings the Station slice holds for a subject. */
function sliceAllegiances(world: WorldState, subject: string): Set<string> {
  const out = new Set<string>();
  const slice = world.station.knowledge;
  const about = [...slice.known, ...slice.falseBeliefs].filter(
    (p) => p.subject === subject,
  );
  for (const p of about) {
    if (p.predicate === 'MEMBER_OF' && typeof p.object === 'string') {
      const org = world.orgs[p.object as OrgId];
      if (org !== undefined) {
        out.add(org.allegiance);
      }
    }
    if (
      p.predicate === 'WORKS_FOR' &&
      typeof p.object === 'object' &&
      p.object !== null &&
      'kind' in p.object &&
      p.object.kind === 'text'
    ) {
      out.add(`employed by ${p.object.value}`);
    }
  }
  return out;
}

/**
 * Build the {@link PlotWorld} slice `executePlotDay` reads from a generated
 * world: the city, NPCs, Channels and Dead Drops.
 */
function plotWorldOf(world: WorldState): PlotWorld {
  return {
    city: world.city,
    npcs: world.npcs,
    channels: world.channels,
    deadDrops: world.deadDrops,
  };
}

/**
 * Run the Plot to completion one day at a time (undisrupted), collecting every
 * emitted {@link SimEvent}. Mirrors `plot-execution.spec.ts`'s `runToCompletion`.
 */
function runPlot(world: WorldState): SimEvent[] {
  let plot: PlotState = world.plot;
  const pw = plotWorldOf(world);
  const events: SimEvent[] = [];
  const prng = createPrng('coherence-exec');
  const lastDay = plot.stages[plot.stages.length - 1].deadline.day + 5;
  for (let day = 0; day <= lastDay && plot.status === 'running'; day += 1) {
    const result = executePlotDay(plot, { day, phase: 0 }, pw, prng);
    plot = result.plot;
    events.push(...result.events);
  }
  return events;
}

/** The trace-kind SimEvent kinds (the hidden events a stage's traces render to). */
const TRACE_KINDS: ReadonlySet<string> = new Set([
  'meeting',
  'transmission',
  'drop-loaded',
  'drop-emptied',
  'npc-moved',
]);

// A varied, non-empty seed set to drive the sweep over.
const SEEDS = [
  'alpha',
  'bravo',
  'charlie',
  'delta',
  'echo-123',
  'z',
  'q1',
  'w2',
  'seed-99',
  'fox-trot',
];

// ---------------------------------------------------------------------------
// Property 33 — World coherence
// ---------------------------------------------------------------------------

describe('Property 33: World coherence (Req 1.3, 1.5, 1.7, 1.8, 3.6, 30.5)', () => {
  // (1) Mole: true allegiance Hostile, apparent Station, REPORTS_TO holds.
  it('places the mole: Hostile truth, Station cover, REPORTS_TO holds', () => {
    for (const presetId of PRESET_IDS) {
      for (const seed of SEEDS) {
        const { world, truth } = generateGame(seed, inputs(presetId, true));
        const moleId = world.station.mole;
        expect(moleId).toBeDefined();
        if (moleId === undefined) {
          throw new Error('expected a mole when enabled');
        }
        const mole = world.npcs[moleId];
        expect(mole).toBeDefined();
        // Cover: a Station staffer presenting as Station.
        expect(world.station.staff).toContain(moleId);
        expect(mole.apparentAllegiance).toBe('station');
        // Truth: it really serves the Hostile Service.
        expect(revealTruth(mole.trueAllegiance).org).toBe(hostileOrgId(world));
        // The Truth Store holds its REPORTS_TO fact (and every mole fact).
        const knowledge = coreKnowledge(seed, presetId, true);
        expect(knowledge.mole).toBeDefined();
        if (knowledge.mole === undefined) {
          throw new Error('expected a mole in the core stream');
        }
        const reportsTo = knowledge.mole.facts.find(
          (f) => f.predicate === 'REPORTS_TO',
        );
        expect(reportsTo).toBeDefined();
        if (reportsTo === undefined) {
          throw new Error('mole has no REPORTS_TO fact');
        }
        expect(truth.holds(reportsTo, START)).toBe(true);
      }
    }
  });

  // (2a) No Cell member presents as `cell`.
  it('never lets a Cell member present as `cell`', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SEEDS),
        fc.constantFrom(...PRESET_IDS),
        fc.boolean(),
        (seed, presetId, mole) => {
          const { world } = generateGame(seed, inputs(presetId, mole));
          const cellOrg = Object.values(world.orgs).find((o) => o.kind === 'cell');
          expect(cellOrg).toBeDefined();
          for (const npc of Object.values(world.npcs)) {
            if (revealTruth(npc.trueAllegiance).org === cellOrg?.id) {
              // A covert Cell member never presents the `cell` category.
              expect(npc.apparentAllegiance).not.toBe('cell');
            }
          }
        },
      ),
      { numRuns: 40 },
    );
  });

  // (2b) No Dossier states an allegiance the Station slice does not hold.
  it('never lets a Dossier state an allegiance the Station slice does not hold', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SEEDS),
        fc.constantFrom(...PRESET_IDS),
        fc.boolean(),
        (seed, presetId, mole) => {
          const { world } = generateGame(seed, inputs(presetId, mole));
          const dossiers = Object.values(world.documents).filter(
            (d) => d.kind === 'dossier',
          );
          // The core pack composes at least one Dossier for the brief package.
          expect(dossiers.length).toBeGreaterThan(0);
          for (const dossier of dossiers) {
            // Every Proposition a Dossier asserts belongs to the Station slice
            // (true lead or HQ false belief) — never a fact only the ground
            // truth holds. The composer draws its allegiance line only from
            // these, so the Dossier can state no allegiance the slice lacks.
            const sliceIds = new Set(
              [
                ...world.station.knowledge.known,
                ...world.station.knowledge.falseBeliefs,
              ].map((p) => p.id),
            );
            for (const propId of dossier.asserts) {
              expect(sliceIds.has(propId)).toBe(true);
            }
            // The asserted props all concern the Dossier's subject, and the
            // allegiance they imply is one the slice holds for that subject.
            for (const propId of dossier.asserts) {
              const prop = world.documentPropositions[propId];
              expect(prop).toBeDefined();
              if (prop === undefined) continue;
              const held = sliceAllegiances(world, prop.subject);
              if (
                prop.predicate === 'MEMBER_OF' &&
                typeof prop.object === 'string'
              ) {
                const org = world.orgs[prop.object as OrgId];
                if (org !== undefined) {
                  expect(held.has(org.allegiance)).toBe(true);
                }
              }
            }
          }
        },
      ),
      { numRuns: 40 },
    );
  });

  // (3) Descriptors fit gender; every two Principals differ in >= 2 elements.
  it('wears only gender-fitting descriptors and keeps Principals two apart', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SEEDS),
        fc.constantFrom(...PRESET_IDS),
        fc.boolean(),
        (seed, presetId, mole) => {
          const { world } = generateGame(seed, inputs(presetId, mole));

          // Gender fit (every NPC): every phrase an NPC wears is a fitting
          // phrase for its gender across the shared blocks and the pools it
          // draws from.
          for (const npc of Object.values(world.npcs)) {
            const gender = npc.persona.gender;
            const allowed = new Set<string>([
              ...fittingPhrases(descriptors.shared.build, gender),
              ...fittingPhrases(descriptors.shared.grooming, gender),
            ]);
            for (const poolId of npc.descriptor.pools) {
              const pool = descriptors.pools[poolId];
              if (pool === undefined) continue;
              for (const ph of fittingPhrases(pool.garments, gender)) {
                allowed.add(ph);
              }
              for (const ph of fittingPhrases(pool.accessories, gender)) {
                allowed.add(ph);
              }
            }
            for (const phrase of npc.descriptor.phrases) {
              expect(allowed.has(phrase)).toBe(true);
            }
          }

          // Distinguishability (Principals only): every two Principals'
          // descriptors differ in at least MIN_DESCRIPTOR_DIFFERENCE elements
          // (the symmetric-difference rule the Principal generator enforces by
          // redraw; Background NPCs are not held to it).
          const principals = principalIds(world).map((id) => world.npcs[id]);
          expect(principals.length).toBeGreaterThan(0);
          for (let i = 0; i < principals.length; i += 1) {
            for (let j = i + 1; j < principals.length; j += 1) {
              const a = new Set(principals[i].descriptor.phrases);
              const b = new Set(principals[j].descriptor.phrases);
              let diff = 0;
              for (const p of a) if (!b.has(p)) diff += 1;
              for (const p of b) if (!a.has(p)) diff += 1;
              expect(diff).toBeGreaterThanOrEqual(MIN_DESCRIPTOR_DIFFERENCE);
            }
          }
        },
      ),
      { numRuns: 30 },
    );
  });

  // (4) Name uniqueness: no two NPCs share a full name or a surname across the
  //     whole roster. A repeated surname would read as a family, and none is
  //     intended. Principals also keep distinct given names.
  it('never repeats a full name or a surname across the roster', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SEEDS),
        fc.constantFrom(...PRESET_IDS),
        fc.boolean(),
        (seed, presetId, mole) => {
          const { world } = generateGame(seed, inputs(presetId, mole));
          const principals = principalIds(world).map((id) => world.npcs[id]);

          // No two Principals share a given or family name (the stricter rule
          // the Principal generator enforces by redraw).
          const given = principals.map((n) => n.persona.given);
          const family = principals.map((n) => n.persona.family);
          expect(new Set(given).size).toBe(given.length);
          expect(new Set(family).size).toBe(family.length);

          // No two NPCs share a full name — across the WHOLE roster, Background
          // NPCs included. The Principal generator keeps Principal full names
          // unique by redraw, and the noise generator now redraws a Background
          // NPC's name until it is unique against the Principal full names and
          // every earlier Background NPC, so the full-name set has exactly one
          // entry per NPC.
          const npcs = Object.values(world.npcs);
          const fullNames = npcs.map((n) => n.persona.name);
          expect(new Set(fullNames).size).toBe(fullNames.length);
          const surnames = npcs.map((n) => n.persona.family);
          expect(new Set(surnames).size).toBe(surnames.length);

          // And Principals in particular stay uniquely named across the roster
          // (a direct corollary, kept explicit).
          const principalNames = new Set(principals.map((n) => n.persona.name));
          expect(principalNames.size).toBe(principals.length);
        },
      ),
      { numRuns: 40 },
    );
  });

  // (4b) Background-vs-Background full-name uniqueness (the formerly-known gap,
  //      now closed): Property 33's full strength is "no two NPCs share a full
  //      name" across the WHOLE roster, Background NPCs included. The gap used to
  //      be that the Background-NPC generator (noise/background.ts) drew persona
  //      names independently with no cross-Background uniqueness check, and once
  //      the easy preset's Background count was raised, two Background NPCs could
  //      collide — deterministically, seed `w2`, easy: `npc:bg-1` and `npc:bg-3`
  //      were both "Johann Hofbauer". The generator now redraws a Background
  //      NPC's name until it is unique against the Principal full names and every
  //      earlier Background NPC (preserving the count-independent `npc:bg-i`
  //      superset invariant that generate.noise-independence.spec.ts pins), so
  //      the collision no longer exists. This test holds that exact repro to
  //      zero full-name collisions across the roster.
  it('keeps every NPC full name unique across the roster (seed w2, easy)', () => {
    const { world } = generateGame('w2', inputs('easy', false));
    const byName = new Map<string, string[]>();
    for (const npc of Object.values(world.npcs)) {
      const ids = byName.get(npc.persona.name) ?? [];
      ids.push(npc.id);
      byName.set(npc.persona.name, ids);
    }
    const collisions = [...byName.values()].filter((ids) => ids.length > 1);
    // No two NPCs share a full name — Background names are now deduped against
    // Principals and against one another.
    expect(collisions).toHaveLength(0);
  });

  // (5) Executed trace events match the kind/participants/place/channel/materiel
  //     their template trace names.
  it('emits each executed trace event with the kind, participants, place, Channel and materiel its trace names', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SEEDS),
        fc.constantFrom(...PRESET_IDS),
        fc.boolean(),
        (seed, presetId, mole) => {
          const { world } = generateGame(seed, inputs(presetId, mole));
          const events = runPlot(world);

          // Index each stage's traces by stage id, in trace order.
          const tracesByStage = new Map<string, readonly StageTrace[]>();
          for (const stage of world.plot.stages) {
            tracesByStage.set(stage.id, stage.traces);
          }

          // Walk the hidden event stream: a `stage-executed` opens a stage, then
          // its trace events follow in trace order. Pair each trace event with
          // its StageTrace by advancing through the stage's traces in order and
          // matching kinds — a trace that renders to no event (a transmission
          // with no Channel of its kind, say) is skipped, so the pairing stays
          // aligned by consuming traces until one of the event's kind is found.
          let currentStage: string | undefined;
          let traceCursor = 0;
          let checkedTraceEvents = 0;
          for (const e of events) {
            if (e.kind === 'stage-executed') {
              currentStage = e.stage;
              traceCursor = 0;
              continue;
            }
            if (!TRACE_KINDS.has(e.kind)) {
              continue;
            }
            expect(currentStage).toBeDefined();
            if (currentStage === undefined) continue;
            const traces = tracesByStage.get(currentStage) ?? [];
            // Advance to the next trace whose declared kind matches this event's
            // kind; traces before it rendered to no event and are skipped.
            let trace: StageTrace | undefined;
            while (traceCursor < traces.length) {
              const candidate = traces[traceCursor];
              traceCursor += 1;
              if (candidate.kind === e.kind) {
                trace = candidate;
                break;
              }
            }
            expect(trace).toBeDefined();
            if (trace === undefined) continue;
            checkedTraceEvents += 1;

            // Kind: the event kind is exactly the trace's declared kind.
            expect(e.kind).toBe(trace.kind);

            // Participants: when the trace names bound participants, a
            // `meeting` lands on exactly them.
            if (e.kind === 'meeting' && trace.participants.length > 0) {
              expect([...e.participants].sort()).toEqual(
                [...trace.participants].sort(),
              );
            }

            // Place: when the trace names a concrete Location, the event lands
            // there (meetings and drops carry a `loc`/`drop` place).
            if (
              e.kind === 'meeting' &&
              trace.place !== undefined &&
              trace.place.kind === 'loc'
            ) {
              expect(e.loc).toBe(trace.place.loc);
            }

            // Channel: a transmission runs on a Channel of the trace's named
            // kind.
            if (e.kind === 'transmission' && trace.channelKind !== undefined) {
              const channel = world.channels[e.channel];
              expect(channel).toBeDefined();
              expect(channel?.kind).toBe(trace.channelKind);
            }

            // Materiel: a drop trace that names a materiel carries it.
            if (
              (e.kind === 'drop-loaded' || e.kind === 'drop-emptied') &&
              trace.materiel !== undefined
            ) {
              const carried = e.items.map((it) => it.item);
              expect(carried).toContain(trace.materiel);
            }
          }

          // The sweep must exercise at least some executed trace events.
          expect(checkedTraceEvents).toBeGreaterThan(0);
        },
      ),
      { numRuns: 30 },
    );
  });
});

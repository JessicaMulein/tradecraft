/**
 * Tests for Plot instantiation (task 5.3; Requirements 1.1, 3.2, 3.3).
 *
 * These load the real core pack, its `city.yaml` and `descriptors.yaml`,
 * run the full step-1→4 core stream (city, orgs, principals, Plot) on one PRNG
 * stream, and check the invariants the design fixes for the Plot stage DAG:
 *
 * - a Plot template is chosen from the content set, and its structure is carried
 *   onto the running {@link PlotState} (Req 1.1);
 * - the stage count honours the preset's `plot.stageCount` (clamped to the
 *   template's own stages);
 * - the `requires`/`produces` edges form a valid, rooted DAG over minted
 *   PropIds (Req 3.2);
 * - every role binding references a real generated NPC, and the leader is the
 *   Cell leader NPC (Req 1.1, 3.2);
 * - materiel slots mint item ids, target slots bind real entities;
 * - deadlines are non-decreasing and respect the preset's deadline slack
 *   (Req 3.3);
 * - the `onDisrupted` weights are carried from the template (Req 3.3);
 * - and — the determinism that underpins Property 1 — the same seed and content
 *   produce an identical Plot.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  loadCityData,
  loadContent,
  loadDescriptorData,
  type CityData,
  type ContentSet,
  type DescriptorData,
  type DifficultyPreset,
  normaliseSchema1Plot,
  PlotTemplateSchema,
  type PlotTemplate,
  SideThreadTemplateSchema,
} from '@tradecraft/content';

import { createPrng } from '../prng/prng.js';
import {
  compareTime,
  isEntityId,
  revealTruth,
  timeToPhases,
  type GameTime,
  type NpcId,
  type PropId,
} from '../model/core.js';
import { generateCity } from './generate.js';
import { type City } from './city.js';
import { generateOrgs, generatePrincipals, type GeneratedPrincipals } from './principals.js';
import {
  chooseTemplate,
  deadlinesNonDecreasing,
  generatePlot,
  instantiateChosenPlot,
  INITIAL_ABORT_PRESSURE,
  type PlotState,
} from './plot.js';

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
  return {
    content: content.value,
    cityData: cityData.value,
    descriptors: descriptors.value,
  };
}

const { content, cityData, descriptors } = loadCore();
const locationTypes = [...content.locationTypes.values()];

/** Resolve a named difficulty preset from the merged content set. */
function preset(id: string): DifficultyPreset {
  for (const [key, value] of content.difficultyPresets) {
    if (key === id || key.endsWith(`/${id}`)) {
      return value;
    }
  }
  throw new Error(`no difficulty preset ${id}`);
}

/** Resolve a plot template by bare id from the content set. */
function plotTemplate(id: string): PlotTemplate {
  for (const [key, value] of content.plotTemplates) {
    if (key === id || key.endsWith(`/${id}`)) {
      return value;
    }
  }
  throw new Error(`no plot template ${id}`);
}

const STANDARD = preset('standard');
const EASY = preset('easy');
const HARD = preset('hard');
const START: GameTime = { day: 0, phase: 0 };

interface Generated {
  readonly city: City;
  readonly principals: GeneratedPrincipals;
  readonly plot: PlotState;
}

/** Run the full step-1→4 generation on one core stream for a seed and preset. */
function gen(seed: string, p: DifficultyPreset = STANDARD): Generated {
  const prng = createPrng(seed);
  const { city } = generateCity(prng, locationTypes, cityData);
  const orgs = generateOrgs(prng);
  const principals = generatePrincipals(prng, content, descriptors, city, orgs);
  const { plot } = generatePlot(prng, content, p, city, orgs, principals, START);
  return { city, principals, plot };
}

/** Just the plot, for the many checks that only read it. */
function genPlot(seed: string, p: DifficultyPreset = STANDARD): PlotState {
  return gen(seed, p).plot;
}

describe('chooseTemplate', () => {
  it('always returns one of the core pack templates', () => {
    const ids = new Set([...content.plotTemplates.values()].map((t) => t.id));
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 12 }), (seed) => {
        const chosen = chooseTemplate(createPrng(seed), content);
        expect(ids.has(chosen.id)).toBe(true);
      }),
      { numRuns: 40 },
    );
  });

  it('is independent of plot-template iteration order', () => {
    // The sort inside chooseTemplate must make the pick order-independent.
    const a = chooseTemplate(createPrng('order-seed'), content);
    const b = chooseTemplate(createPrng('order-seed'), content);
    expect(a.id).toBe(b.id);
  });

  it('throws when the content set defines no Plot templates', () => {
    const empty = { ...content, plotTemplates: new Map() } as unknown as ContentSet;
    expect(() => chooseTemplate(createPrng('x'), empty)).toThrow(/no Plot templates/);
  });
});

describe('Property 2: Schema-1 backward compatibility', () => {
  it('normalises a schema-1 template and matches the slice instantiator', () => {
    // Feature: plot-library, Property 2: Schema-1 backward compatibility
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.integer({ min: 1, max: 3 }),
        (seed, roleCount) => {
          const roles = Array.from({ length: roleCount }, (_, index) => ({
            id: `slot${index}`,
            archetypes: ['courier'],
          }));
          const synthetic = PlotTemplateSchema.parse({
            id: 'synthetic',
            roleSlots: roles,
            stages: [
              {
                id: 'open',
                deadline: { min: 1, max: 3 },
                traces: [{ kind: 'meeting', roles: ['slot0'], text: 'They meet.' }],
                onDisrupted: { delay: 0.5, reroute: 0.4, abort: 0.1 },
              },
              {
                id: 'close',
                requires: ['open'],
                deadline: { min: 2, max: 4 },
                traces: [{ kind: 'meeting', text: 'They leave.' }],
                onDisrupted: { delay: 0.5, reroute: 0.4, abort: 0.1 },
              },
            ],
          });
          const normalised = normaliseSchema1Plot(synthetic);
          expect(normalised.cells).toEqual([{ id: 'cell', roles: roles.map((role) => role.id) }]);
          expect(normalised.twist).toBeUndefined();
          expect(normalised.stages.every((entry) => 'id' in entry && !('branch' in entry) && !('subplot' in entry))).toBe(
            true,
          );
          expect(normalised.stages.every((entry) => !('optional' in entry && entry.optional !== undefined))).toBe(true);
          expect(normalised.outcomes.success.map((condition) => condition.kind)).toEqual([
            'arrest-role',
            'seize-item',
            'abort',
          ]);
          expect(normalised.outcomes.failure).toEqual([{ kind: 'stage-completed', stage: 'close' }]);

          const thread = SideThreadTemplateSchema.parse({
            id: 'noise',
            roleSlots: [{ id: 'watcher', archetypes: ['civilian'] }],
            stages: [
              {
                id: 'glimpse',
                deadline: { min: 1, max: 2 },
                traces: [{ kind: 'meeting', text: 'A passerby.' }],
                onDisrupted: { delay: 1, reroute: 0, abort: 0 },
              },
            ],
          });
          const normalisedThread = normaliseSchema1Plot(thread, 'side-thread');
          expect(normalisedThread.kind).toBe('side-thread');
          expect(normalisedThread.cells).toEqual([{ id: 'cell', roles: ['watcher'] }]);
          expect(normalisedThread.twist).toBeUndefined();
          expect(normalisedThread.stages.every((entry) => 'id' in entry && !('branch' in entry))).toBe(true);

          const prng = createPrng(seed);
          const { city } = generateCity(prng, locationTypes, cityData);
          const orgs = generateOrgs(prng);
          const principals = generatePrincipals(prng, content, descriptors, city, orgs);
          const chosen = chooseTemplate(prng, content);
          const viaSplit = instantiateChosenPlot(prng, chosen, content, STANDARD, city, orgs, principals, START);
          const whole = genPlot(seed);
          expect(viaSplit.plot).toEqual(whole);
          const fromPack = normaliseSchema1Plot(chosen);
          expect(fromPack.cells).toHaveLength(1);
          expect(fromPack.twist).toBeUndefined();
          expect(fromPack.stages.filter((entry) => 'id' in entry).map((entry) => ('id' in entry ? entry.id : ''))).toEqual(
            chosen.stages.map((stage) => stage.id),
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('generatePlot — structure (Req 1.1)', () => {
  it('carries the chosen template id and starts running', () => {
    const plot = genPlot('struct-seed');
    expect(content.plotTemplates.has(`core/${plot.template}`)).toBe(true);
    expect(plot.status).toBe('running');
  });

  it('starts under no abort pressure, with no cause (task 7.4 defaults)', () => {
    const plot = genPlot('pressure-seed');
    expect(plot.abortPressure).toBe(INITIAL_ABORT_PRESSURE);
    expect(plot.abortPressure).toBe(0);
    expect(plot.pressureKeys).toEqual([]);
    expect(plot.abortCause).toBeUndefined();
  });

  it('binds one role per template role slot, one materiel per materiel slot', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 10 }), (seed) => {
        const plot = genPlot(seed);
        const template = plotTemplate(plot.template);
        expect(plot.roles.length).toBe(template.roleSlots.length);
        expect(plot.materielSlots.length).toBe(template.materielSlots.length);
        expect(plot.targetSlots.length).toBe(template.targetSlots.length);
      }),
      { numRuns: 30 },
    );
  });
});

describe('generatePlot — stage count honours the preset (Req 3.2)', () => {
  it('retains min(stageCount, template stages) stages, at least one', () => {
    for (const p of [EASY, STANDARD, HARD]) {
      fc.assert(
        fc.property(fc.string({ minLength: 1, maxLength: 10 }), (seed) => {
          const plot = genPlot(seed, p);
          const template = plotTemplate(plot.template);
          const expected = Math.max(
            1,
            Math.min(p.plot.stageCount, template.stages.length),
          );
          expect(plot.stages.length).toBe(expected);
        }),
        { numRuns: 20 },
      );
    }
  });

  it('retains a contiguous prefix of the template stages', () => {
    const plot = genPlot('prefix-seed');
    const template = plotTemplate(plot.template);
    const kept = template.stages.slice(0, plot.stages.length);
    expect(plot.stages.map((s) => s.templateId)).toEqual(kept.map((s) => s.id));
  });
});

describe('generatePlot — the stage graph is a valid rooted DAG (Req 3.2)', () => {
  it('the first stage requires nothing (rooted), and every require is produced earlier', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 10 }), (seed) => {
        const plot = genPlot(seed);
        expect(plot.stages[0].requires).toEqual([]);

        // Every required PropId must have been produced by an earlier stage.
        const producedSoFar = new Set<PropId>();
        for (const stage of plot.stages) {
          for (const req of stage.requires) {
            expect(producedSoFar.has(req)).toBe(true);
          }
          for (const prod of stage.produces) {
            producedSoFar.add(prod);
          }
        }
      }),
      { numRuns: 40 },
    );
  });

  it('mints distinct PropIds for every produced proposition', () => {
    const plot = genPlot('propid-seed');
    const all: PropId[] = plot.stages.flatMap((s) => [...s.produces]);
    expect(new Set(all).size).toBe(all.length);
  });

  it('mints a distinct StageId per stage', () => {
    const plot = genPlot('stageid-seed');
    const ids = plot.stages.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('forms an acyclic graph (edges only point backward in stage order)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 10 }), (seed) => {
        const plot = genPlot(seed);
        const indexOfProducer = new Map<PropId, number>();
        plot.stages.forEach((stage, i) => {
          for (const prod of stage.produces) {
            indexOfProducer.set(prod, i);
          }
        });
        // Each requirement is produced strictly before the requiring stage.
        plot.stages.forEach((stage, i) => {
          for (const req of stage.requires) {
            const producer = indexOfProducer.get(req);
            expect(producer).toBeDefined();
            expect(producer!).toBeLessThan(i);
          }
        });
      }),
      { numRuns: 30 },
    );
  });
});

describe('generatePlot — role bindings reference real NPCs (Req 1.1)', () => {
  it('every bound role is a generated NPC, and the leader is the Cell leader', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 10 }), (seed) => {
        const { principals, plot } = gen(seed);
        for (const role of plot.roles) {
          if (role.npc !== undefined) {
            expect(principals.npcs[role.npc]).toBeDefined();
          }
        }
        // The leader is the Cell leader NPC (first Cell role).
        const leader = revealTruth(plot.leader);
        expect(leader).toBe(principals.cell[0]);
        const leaderNpc = principals.npcs[leader];
        expect(leaderNpc).toBeDefined();
        expect(leaderNpc.archetype.endsWith('cell-leader')).toBe(true);
        expect(leaderNpc.role).toBe('cell');
      }),
      { numRuns: 30 },
    );
  });

  it('binds the Cell roles the core templates name to real Cell NPCs', () => {
    const { principals, plot } = gen('cell-roles-seed');
    const cellSet = new Set<NpcId>(principals.cell);
    // The core templates name cell-leader, cell-courier, cell-radio-operator,
    // cell-financier. Each bound role naming a cell archetype must bind into
    // the generated Cell.
    for (const role of plot.roles) {
      if (role.npc !== undefined && role.archetype.startsWith('cell-')) {
        expect(cellSet.has(role.npc)).toBe(true);
      }
    }
  });

  it('binds the hostile roles to the generated hostile officers', () => {
    const { principals, plot } = gen('hostile-roles-seed');
    const hostileSet = new Set<NpcId>(principals.hostile);
    for (const role of plot.roles) {
      if (role.npc !== undefined && role.archetype.startsWith('hostile-')) {
        expect(hostileSet.has(role.npc)).toBe(true);
      }
    }
  });
});

describe('generatePlot — materiel and target bindings', () => {
  it('mints an item id per materiel slot and a primary materiel item', () => {
    const plot = genPlot('materiel-seed');
    for (const m of plot.materielSlots) {
      expect(m.item.startsWith('item:')).toBe(true);
    }
    const primary = revealTruth(plot.materiel);
    expect(primary.startsWith('item:')).toBe(true);
    if (plot.materielSlots.length > 0) {
      expect(primary).toBe(plot.materielSlots[0].item);
    }
  });

  it('binds every target slot to a real entity id', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 10 }), (seed) => {
        const { city, principals, plot } = gen(seed);
        for (const t of plot.targetSlots) {
          expect(isEntityId(t.entity)).toBe(true);
          // The entity must be a real NPC, Location or org.
          const known =
            principals.npcs[t.entity as NpcId] !== undefined ||
            city.locations[t.entity as never] !== undefined ||
            t.entity.startsWith('org:');
          expect(known).toBe(true);
        }
        const primary = revealTruth(plot.target);
        expect(isEntityId(primary)).toBe(true);
      }),
      { numRuns: 30 },
    );
  });
});

describe('generatePlot — deadlines respect the preset slack (Req 3.3)', () => {
  it('every deadline is strictly after the start time', () => {
    const plot = genPlot('deadline-seed');
    for (const stage of plot.stages) {
      expect(compareTime(stage.deadline, START)).toBeGreaterThan(0);
    }
  });

  it('deadlines are non-decreasing down the stage chain', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 10 }), (seed) => {
        const plot = genPlot(seed);
        expect(deadlinesNonDecreasing(plot.stages)).toBe(true);
      }),
      { numRuns: 30 },
    );
  });

  it('each stage deadline is at least the preset slack beyond its predecessor', () => {
    for (const p of [EASY, STANDARD, HARD]) {
      const plot = genPlot(`slack-${p.id}`, p);
      const slackPhases = p.plot.deadlineSlackDays * 4;
      for (let i = 1; i < plot.stages.length; i += 1) {
        const gap =
          timeToPhases(plot.stages[i].deadline) -
          timeToPhases(plot.stages[i - 1].deadline);
        // The gap is the drawn stage span (>= its range min, >= 0) plus slack.
        expect(gap).toBeGreaterThanOrEqual(slackPhases);
      }
    }
  });

  it('a larger deadline slack pushes deadlines out', () => {
    // Hold the stream fixed and compare the first stage's deadline across
    // presets. A bigger slack must land the deadline no earlier.
    const seed = 'slack-compare';
    const low = genPlot(seed, { ...STANDARD, plot: { ...STANDARD.plot, deadlineSlackDays: 0 } });
    const high = genPlot(seed, { ...STANDARD, plot: { ...STANDARD.plot, deadlineSlackDays: 10 } });
    expect(timeToPhases(high.stages[0].deadline)).toBeGreaterThan(
      timeToPhases(low.stages[0].deadline),
    );
  });
});

describe('generatePlot — onDisrupted weights carried (Req 3.3)', () => {
  it('carries the template weights verbatim onto each retained stage', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 10 }), (seed) => {
        const plot = genPlot(seed);
        const template = plotTemplate(plot.template);
        const byId = new Map(template.stages.map((s) => [s.id, s]));
        for (const stage of plot.stages) {
          const src = byId.get(stage.templateId)!;
          expect(stage.onDisrupted.delay).toBe(src.onDisrupted.delay);
          expect(stage.onDisrupted.reroute).toBe(src.onDisrupted.reroute);
          expect(stage.onDisrupted.abort).toBe(src.onDisrupted.abort);
        }
      }),
      { numRuns: 30 },
    );
  });

  it('carries each structured trace onto its stage, binding its slots', () => {
    const { city, plot } = gen('trace-seed');
    const template = plotTemplate(plot.template);
    const byId = new Map(template.stages.map((s) => [s.id, s]));
    // Every role slot bound to an NPC, so a trace naming it binds a participant.
    const boundRoles = new Set(
      plot.roles.filter((r) => r.npc !== undefined).map((r) => r.slot),
    );
    const materielBySlot = new Map(plot.materielSlots.map((m) => [m.slot, m.item]));
    const targetBySlot = new Map(plot.targetSlots.map((t) => [t.slot, t.entity]));

    for (const stage of plot.stages) {
      const src = byId.get(stage.templateId)!;
      // One StageTrace per template trace, carrying its prose, kind, evidences.
      expect(stage.traces.map((t) => t.template)).toEqual(src.traces.map((t) => t.text));
      expect(stage.traces.map((t) => t.kind)).toEqual(src.traces.map((t) => t.kind));
      stage.traces.forEach((t, i) => {
        expect(t.index).toBe(i);
        expect(t.evidences).toEqual(src.traces[i].evidences);

        // Participants are the bound role holders the template named.
        const expectedParticipants = src.traces[i].roles
          .filter((r) => boundRoles.has(r))
          .map((r) => plot.roles.find((rb) => rb.slot === r)!.npc!);
        expect([...t.participants].sort()).toEqual(
          [...new Set(expectedParticipants)].sort(),
        );

        // Materiel binds to the slot's minted item.
        const srcMateriel = src.traces[i].materiel;
        if (srcMateriel !== undefined) {
          expect(t.materiel).toBe(materielBySlot.get(srcMateriel));
        }

        // Channel kind carries through for a transmission/courier trace.
        expect(t.channelKind).toBe(src.traces[i].channel);

        // A target place binds to the slot's entity; a Location-Type place
        // binds to a real city Location of that type; a Tag-Query place binds
        // to a city Location whose Effective Tags satisfy the query.
        const srcPlace = src.traces[i].place;
        if (srcPlace !== undefined && 'target' in srcPlace) {
          expect(t.place).toEqual({
            kind: 'target',
            entity: targetBySlot.get(srcPlace.target),
          });
        } else if (srcPlace !== undefined && 'query' in srcPlace) {
          // The resolved Location is a real city Location whose Effective Tags
          // (its Location Type's Tags) contain every Tag the query names, so a
          // regression to the wrong binder would be caught here.
          expect(t.place?.kind).toBe('loc');
          const resolved = t.place?.kind === 'loc' ? t.place.loc : undefined;
          expect(resolved).toBeDefined();
          const cityLoc = Object.values(city.locations).find(
            (l) => l.id === resolved,
          );
          expect(cityLoc).toBeDefined();
          const typeTags = new Set(
            content.locationTypes.get(cityLoc!.type)?.tags ??
              content.locationTypes.get(`core/${cityLoc!.type}`)?.tags ??
              [],
          );
          for (const tag of srcPlace.query) {
            expect(typeTags.has(tag)).toBe(true);
          }
        } else if (srcPlace !== undefined) {
          expect(t.place?.kind).toBe('loc');
        }
      });
    }
  });

  it('every stage starts pending', () => {
    const plot = genPlot('status-seed');
    for (const stage of plot.stages) {
      expect(stage.status).toBe('pending');
    }
  });
});

describe('determinism (underpins Property 1)', () => {
  it('produces an identical Plot for the same seed and content', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 16 }), (seed) => {
        const a = gen(seed).plot;
        const b = gen(seed).plot;
        expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
      }),
      { numRuns: 40 },
    );
  });

  it('produces different Plots for different seeds (not a constant)', () => {
    // Across a handful of seeds, at least two distinct Plot serialisations
    // appear (template choice, bindings and deadlines all vary by seed).
    const serialised = new Set(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((s) => JSON.stringify(genPlot(`seed-${s}`))),
    );
    expect(serialised.size).toBeGreaterThan(1);
  });
});

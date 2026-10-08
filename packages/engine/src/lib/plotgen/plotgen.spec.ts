import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { PlotTemplateV2Schema, type ContentSet, type PlotTemplateV2 } from '@tradecraft/content';
import type { City } from '../city/city.js';
import { createPrng } from '../prng/prng.js';
import { cityView } from '../setting/city-view.js';
import type { SettingSelection } from '../setting/setting.js';
import { custodyHolds } from '../truth/truth.js';
import type { EntityId, GameTime, Proposition } from '../model/core.js';
import { bind, bindable, type BindCity } from './bind.js';
import { expand, variantKey } from './expand.js';
import { libraryPreset } from './preset.js';
import { resolveBranch, rerouteAlternative, type RuntimeBranch } from './branches.js';
import { select } from './select.js';
import { evaluateOutcomes, countsTowardAbort } from './outcomes.js';
import { checkConsistency } from './consistency.js';
import {
  adaptCell,
  advanceLibrary,
  buildLibrarySession,
  identifyReport,
  projectLibraryFacts,
  slicePlotOf,
  syncPrimaryStages,
  libraryConflicts,
  reconcilePlots,
  renderDamageCable,
  verifyLibrary,
  LibrarySelectionError,
} from './library.js';
import { drawDisruption, executePlotDay } from '../clock/plot-execution.js';
import type { PlotStateV2 } from './types.js';
import { instantiate } from './instantiate.js';
import { fillLookalikeShare, instantiateSideThread, lookalikeCount } from './sidethread.js';

function stage(id: string, requires: string[] = [], optional?: number) {
  return {
    id,
    requires,
    ...(optional === undefined ? {} : { optional: { weight: optional } }),
    deadline: { min: 2, max: 4 },
    traces: [
      {
        kind: 'meeting' as const,
        roles: ['leader'],
        evidences: ['LOCATED_AT'],
        text: 'A watcher keeps a quiet note of who comes and goes.',
      },
      {
        kind: 'transmission' as const,
        roles: ['leader'],
        channel: 'radio' as const,
        evidences: ['LOCATED_AT'],
        text: 'A short signal leaves the set.',
      },
    ],
    onDisrupted: { delay: 0.5, reroute: 0.4, abort: 0.1 },
  };
}

function template(extra: Record<string, unknown> = {}): PlotTemplateV2 {
  return PlotTemplateV2Schema.parse({
    id: 'sample',
    templateSchema: 2,
    kind: 'plot',
    displayName: 'Sample',
    archetype: 'sabotage',
    era: { from: 1948, to: 1962 },
    concurrency: { tags: ['sabotage'], allowWith: ['kompromat', 'smuggling'] },
    params: { venue: { kind: 'loc', query: ['function:cafe'], group: 'venues' } },
    roleSlots: { leader: { query: ['role:cell'] } },
    cells: [{ id: 'action', roles: ['leader'] }],
    stages: [stage('open'), stage('close', ['open'])],
    stageCount: { min: 1, max: 4 },
    outcomes: {
      success: [{ kind: 'arrest-role', role: 'leader' }],
      failure: [{ kind: 'stage-completed', stage: 'close' }],
    },
    ...extra,
  });
}

function city(binders: Record<string, string[]> = {}): BindCity {
  return {
    binders(kind, query) {
      const key = `${kind}:${query.join('+')}`;
      return binders[key] ?? (kind === 'loc' ? ['loc:cafe-1', 'loc:cafe-2'] : ['npc:a']);
    },
    archetypesWithTags() {
      return ['core/cell-leader'];
    },
  };
}

const PRESET = libraryPreset({
  id: 'standard',
  plot: { stageCount: 2, deadlineSlackDays: 2 },
});

describe('Property 3: Binding soundness', () => {
  it('is deterministic and stays inside the query', () => {
    // Feature: plot-library, Property 3: Binding soundness
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 12 }), (seed) => {
        const plot = template();
        const view = city();
        const once = bind(plot, view, createPrng(seed));
        const twice = bind(plot, view, createPrng(seed));
        expect(twice).toEqual(once);
        expect(bindable(plot, view).ok).toBe(true);
        if (once.ok) {
          expect(['loc:cafe-1', 'loc:cafe-2']).toContain(once.bindings.venue);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('reports a parameter whose query has no candidate', () => {
    const plot = template();
    const view = city();
    view.binders = () => [];
    const result = bind(plot, view, createPrng('empty'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing[0]?.param).toBe('venue');
    }
  });
});

describe('Property 4: Expansion well-formedness', () => {
  it('keeps one static alternative and a stable variant key', () => {
    // Feature: plot-library, Property 4: Expansion well-formedness
    const plot = template({
      stages: [
        stage('open'),
        {
          branch: 'route',
          resolve: 'static',
          after: ['open'],
          alternatives: [
            { id: 'sea', weight: 1, stages: [stage('sail', ['open'])] },
            { id: 'land', weight: 1, stages: [stage('walk', ['open'])] },
          ],
        },
        stage('maybe', [], 0.5),
      ],
    });
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 8 }), (seed) => {
        const a = expand(plot, PRESET, new Map(), createPrng(seed), { twist: null });
        const b = expand(plot, PRESET, new Map(), createPrng(seed), { twist: null });
        expect(b.variantKey).toBe(a.variantKey);
        expect(Object.keys(a.staticChoices)).toEqual(['route']);
        const chosen = a.staticChoices.route;
        expect(chosen === 'sea' || chosen === 'land').toBe(true);
        const ids = a.stages.map((item) => item.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.includes('sail') && ids.includes('walk')).toBe(false);
        expect(a.variantKey).toBe(
          variantKey(plot.id, '1', a.staticChoices, a.optionalIncluded, null),
        );
      }),
      { numRuns: 100 },
    );
  });
});

describe('Property 5: Runtime branch determinism', () => {
  const branch: RuntimeBranch = {
    id: 'approach',
    after: ['open'],
    alternatives: [
      {
        id: 'night',
        when: [{ kind: 'alertness-at-least', value: 0.5, negate: true }],
        stageIds: ['plant-night'],
      },
      { id: 'inside', when: [{ kind: 'default' }], stageIds: ['plant-inside'] },
    ],
  };
  const world = {
    finishedStages: new Set(['open']),
    disruptedStages: new Set<string>(),
    roleStatus: {},
    alertness: 0.2,
    adoptedBeliefs: [],
  };

  it('repeats the same alternative', () => {
    // Feature: plot-library, Property 5: Runtime branch determinism
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 8 }), fc.double({ min: 0, max: 1 }), (seed, alertness) => {
        const facts = { ...world, alertness };
        const once = resolveBranch(branch, facts, createPrng(seed));
        const twice = resolveBranch(branch, facts, createPrng(seed));
        expect(twice).toEqual(once);
        expect(once.alt === 'night' || once.alt === 'inside').toBe(true);
        if (alertness >= 0.5) {
          expect(once.alt).toBe('inside');
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('Property 6: Reroute through Alternatives', () => {
  it('switches to an unused sibling and leaves exactly one alternative active', () => {
    // Feature: plot-library, Property 6: Reroute through Alternatives
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 8 }),
        fc.integer({ min: 2, max: 4 }),
        fc.integer({ min: 0, max: 3 }),
        fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }),
        (seed, count, activePick, shares) => {
          const activeIndex = activePick % count;
          const disrupted = `stage-${activeIndex}`;
          const alternatives = Array.from({ length: count }, (_, index) => ({
            id: `alt-${index}`,
            when: [],
            stageIds:
              index === activeIndex || shares[index] === true
                ? [disrupted, `own-${index}`]
                : [`own-${index}`],
          }));
          const active = alternatives[activeIndex];
          if (active === undefined) {
            return;
          }
          const branch: RuntimeBranch = {
            id: 'approach',
            after: [],
            resolved: { alt: active.id, cause: 'default' },
            alternatives,
          };
          const draw = drawDisruption(createPrng(seed), { delay: 0, reroute: 1, abort: 0 });
          expect(draw).toBe('reroute');
          const eligible = alternatives.filter(
            (alt) => alt.id !== active.id && !alt.stageIds.includes(disrupted),
          );
          const switched = rerouteAlternative(branch, disrupted);
          if (eligible.length > 0) {
            expect(switched?.cause).toBe('reroute');
            expect(eligible.map((alt) => alt.id)).toContain(switched?.alt);
          } else {
            expect(switched).toBeUndefined();
          }
          const activeId = switched?.alt ?? active.id;
          expect(alternatives.filter((alt) => alt.id === activeId)).toHaveLength(1);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Property 13: Custody chain', () => {
  it('folds handovers onto exactly one holder', () => {
    // Feature: plot-library, Property 13: Custody chain
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 4 }), { minLength: 0, maxLength: 6 }),
        (holders) => {
          const origin = 'npc:origin' as EntityId;
          const item = 'item:charge' as EntityId;
          const facts: Proposition[] = holders.map((holder, index) => ({
            id: `p:${index}`,
            subject: index === 0 ? origin : (`npc:h${holders[index - 1]}` as EntityId),
            predicate: 'HANDS_OVER',
            object: `npc:h${holder}` as EntityId,
            instrument: item,
            window: { from: { day: index, phase: 0 } },
          }));
          for (let day = 0; day <= holders.length; day += 1) {
            const at: GameTime = { day, phase: 0 };
            const expected =
              holders.length === 0
                ? origin
                : (facts[Math.min(day, holders.length - 1)]?.object as EntityId);
            const who = [
              ...new Set([origin, ...holders.map((holder) => `npc:h${holder}` as EntityId)]),
            ];
            const holding = who.filter((id) => custodyHolds(facts, id, item, at, origin));
            expect(holding).toEqual([expected]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Property 17: Selection soundness', () => {
  it('picks an eligible primary and concurrency-compatible secondaries', () => {
    // Feature: plot-library, Property 17: Selection soundness
    const primary = template({ id: 'rail', archetype: 'sabotage' });
    const other = template({
      id: 'papers',
      archetype: 'document-theft',
      concurrency: { tags: ['document-theft'], allowWith: ['sabotage'] },
    });
    const recent = template({
      id: 'old',
      archetype: 'forgery',
      concurrency: { tags: ['forgery'], allowWith: ['sabotage'] },
    });
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 8 }), (seed) => {
        const result = select(
          {
            templates: [primary, other, recent],
            city: city(),
            preset: { id: 'standard', plot: { stageCount: 4, deadlineSlackDays: 1 } },
            year: 1952,
            history: [
              { templateId: 'old', variantKey: 'old@1|s:|o:|t:-', archetype: 'forgery', outcome: 'success' },
            ],
            excluded: [],
          },
          createPrng(seed),
        );
        expect(result).not.toBe('no-eligible-template');
        if (result === 'no-eligible-template') {
          return;
        }
        expect(result.primary).not.toBe('old');
        expect(['rail', 'papers']).toContain(result.primary);
        for (const id of result.secondaries) {
          expect(id).not.toBe(result.primary);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('outcomes and consistency', () => {
  it('resolves success before failure', () => {
    const result = evaluateOutcomes(
      {
        success: [{ kind: 'arrest-role', role: 'leader' }],
        failure: [{ kind: 'stage-completed', stage: 'close' }],
      },
      {
        arrestedRoles: new Set(['leader']),
        seizedItems: new Set(),
        aborted: false,
        completedStages: new Set(['close']),
        identifiedRoles: new Set(),
        entityStatus: {},
        protectedEntities: new Set(),
      },
    );
    expect(result).toEqual({ result: 'disrupted', by: 'arrest-role' });
  });

  it('skips facade disruptions when counting abort pressure', () => {
    expect(countsTowardAbort('decoy', ['decoy'])).toBe(false);
    expect(countsTowardAbort('real', ['decoy'])).toBe(true);
  });

  it('flags overlapping functional facts', () => {
    const conflicts = checkConsistency(
      [
        { id: 'a', predicate: 'HOLDS', subject: 'npc:a', object: 'item:1', from: 0, to: 4 },
        { id: 'b', predicate: 'HOLDS', subject: 'npc:a', object: 'item:2', from: 2, to: 6 },
      ],
      new Set(['HOLDS']),
      [],
    );
    expect(conflicts).toHaveLength(1);
  });
});

const WORLD = {
  hostileOrg: 'org:hostile',
  contacts: ['npc:contact'],
  stationStaff: ['npc:staff'],
  orgsForQuery: () => ['org:decoy'],
  npcsForQuery: () => ['npc:a', 'npc:b'],
};

function sessionFor(extra: Record<string, unknown>, seed: string, twistProbability = 0) {
  return buildLibrarySession(
    {
      templates: [template(extra)],
      city: city(),
      preset: { id: 'standard', plot: { stageCount: 2, deadlineSlackDays: 1 }, twistProbability },
      year: 1952,
      world: WORLD,
    },
    createPrng(seed),
  );
}

describe('library session properties', () => {
  it('keeps cell knowledge compartmented', () => {
    // Feature: plot-library, Property 7: Cell compartmentation
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 8 }),
        fc.integer({ min: 2, max: 3 }),
        fc.boolean(),
        fc.double({ min: 0.05, max: 0.3, noNaN: true }),
        (seed, cellCount, withCutout, delta) => {
          const cells = Array.from({ length: cellCount }, (_, index) => ({
            id: `c${index}`,
            roles: [`r${index}`],
          }));
          const roleSlots = Object.fromEntries(cells.map((cell) => [cell.roles[0], { query: ['role:cell'] }]));
          const cutouts = withCutout ? [{ role: 'r0', links: ['c0', 'c1'] }] : [];
          const open = stage('open');
          const session = sessionFor(
            {
              roleSlots,
              cells,
              cutouts,
              stages: [{ ...open, traces: open.traces.map((trace) => ({ ...trace, roles: ['r0'] })) }],
            },
            seed,
          );
          const plot = session?.plots[0];
          expect(plot).toBeDefined();
          if (plot === undefined) {
            return;
          }
          expect(plot.cells).toHaveLength(cellCount);
          expect(new Set(plot.cells.map((cell) => cell.org)).size).toBe(cellCount);
          const cutout = withCutout ? plot.cutouts[0] : undefined;
          for (const cell of plot.cells) {
            for (const member of cell.members) {
              const known = plot.knowledge[member] ?? [];
              for (const colleague of cell.members) {
                expect(known).toContain(colleague);
              }
              for (const other of plot.cells) {
                if (other.spec === cell.spec) {
                  continue;
                }
                for (const foreign of other.members) {
                  if (known.includes(foreign)) {
                    expect(cutout).toBe(member);
                    expect(cutouts[0]?.links).toContain(other.spec);
                  }
                }
              }
            }
          }
          if (cutout !== undefined) {
            const known = plot.knowledge[cutout] ?? [];
            for (const spec of ['c0', 'c1']) {
              const linked = plot.cells.find((cell) => cell.spec === spec);
              for (const member of linked?.members ?? []) {
                expect(known).toContain(member);
              }
            }
          }
          const member = plot.cells[0]?.members[0];
          expect(member).toBeDefined();
          if (member === undefined) {
            return;
          }
          const adapted = adaptCell(plot, member, delta);
          expect(adapted.cells[0]?.security).toBeCloseTo(Math.min(1, (plot.cells[0]?.security ?? 0) + delta));
          for (let index = 1; index < plot.cells.length; index += 1) {
            expect(adapted.cells[index]?.security).toBe(plot.cells[index]?.security);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('mints a front organisation when the decoy query only names the hostile service', () => {
    const world = {
      hostileOrg: 'org:hostile',
      contacts: ['npc:contact'],
      stationStaff: ['npc:staff'],
      orgsForQuery: () => ['org:hostile'],
      npcsForQuery: () => ['npc:a'],
    };
    const plot = template({
      id: 'dockside-fire',
      twist: {
        kind: 'false-flag',
        mandatory: true,
        decoy: { kind: 'org', query: ['org:criminal'] },
        propositions: [{ predicate: 'MEMBER_OF', subject: 'leader', object: 'decoy' }],
      },
    });
    const expanded = expand(plot, PRESET, new Map(), createPrng('expand'));
    const made = instantiate(
      plot,
      expanded,
      libraryPreset({ id: 'standard', plot: { stageCount: 2, deadlineSlackDays: 1 }, twistProbability: 1 }),
      world,
      createPrng('twist'),
    );
    expect(made.twist?.decoy).toBe('org:front-dockside-fire');
    expect(made.twist?.decoy).not.toBe(world.hostileOrg);
    expect(made.twist?.plants?.map((plant) => plant.kind).sort()).toEqual(['document', 'rumour']);
  });

  it('draws a twist only when mandatory or the probability hits', () => {
    // Feature: plot-library, Property 8: Twist instantiation
    const world = {
      hostileOrg: 'org:hostile',
      contacts: ['npc:contact'],
      stationStaff: ['npc:staff'],
      mole: 'npc:mole',
      orgsForQuery: () => ['org:hostile', 'org:decoy'],
      npcsForQuery: () => ['npc:a', 'npc:b'],
    };
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 8 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.boolean(),
        fc.constantFrom('false-flag' as const, 'facade' as const, 'inside-man' as const),
        (seed, probability, mandatory, kind) => {
          const twist =
            kind === 'false-flag'
              ? {
                  kind,
                  mandatory,
                  decoy: { kind: 'org' as const, query: ['org:criminal'] },
                  propositions: [{ predicate: 'MEMBER_OF', subject: 'leader', object: 'decoy' }],
                }
              : kind === 'facade'
                ? {
                    kind,
                    mandatory,
                    facadeStages: ['open'],
                    propositions: [{ predicate: 'MEMBER_OF', subject: 'leader', object: 'decoy' }],
                  }
                : { kind, mandatory, insideRole: 'leader' };
          const plot = template({ twist });
          const expanded = expand(plot, PRESET, new Map(), createPrng('expand'));
          const knobs = libraryPreset({
            id: 'standard',
            plot: { stageCount: 2, deadlineSlackDays: 1 },
            twistProbability: probability,
          });
          const probe = createPrng(seed);
          const draw = probe.next();
          const made = instantiate(plot, expanded, knobs, world, createPrng(seed));
          const present = mandatory || draw < probability;
          expect(made.twist !== undefined).toBe(present);
          if (made.twist === undefined) {
            return;
          }
          expect(made.twist.kind).toBe(kind);
          if (kind === 'false-flag') {
            expect(made.twist.decoy).toBe('org:decoy');
            expect(made.twist.decoy).not.toBe(world.hostileOrg);
            const members = made.cells.flatMap((cell) => cell.members);
            expect(made.twist.cover?.map((story) => story.npc).sort()).toEqual([...members].sort());
            expect(made.twist.cover?.every((story) => story.org === made.twist?.decoy)).toBe(true);
            expect(made.twist.plants?.map((plant) => plant.kind).sort()).toEqual(['document', 'rumour']);
          }
          if (kind === 'inside-man') {
            expect(['npc:contact', 'npc:staff']).toContain(made.twist.inside);
            expect(made.twist.inside).not.toBe(world.mole);
            expect(made.twist.trueAllegiance).toBe('hostile');
            expect(made.twist.apparentAllegiance).toBe('station');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('announces an on-map secondary trace and leaves an off-map stage quiet', () => {
    const facts = {
      alertness: 0,
      adoptedBeliefs: [],
      roleStatus: {},
      arrestedRoles: new Set<string>(),
      seizedItems: new Set<string>(),
      identifiedRoles: new Set<string>(),
      protectedEntities: new Set<string>(),
      entityStatus: {},
      disrupted: new Set<string>(),
    };
    const trace = 'A courier pauses at the cafe counter and does not look up.';
    const base = {
      templateId: 'second',
      displayName: 'Second',
      archetype: 'sabotage',
      variantKey: 'a',
      cells: [],
      cutouts: [],
      bindings: {},
      roleHolders: {},
      knowledge: {},
      runtimeBranches: [],
      outcomes: { success: [{ kind: 'arrest-role', role: 'leader' }], failure: [] },
      subPlots: [],
      standingPenalty: 1,
      standingReward: 1,
    };
    const onMap: PlotStateV2 = {
      ...base,
      id: 'plot:second-on',
      role: 'secondary',
      offMap: [],
      stages: [
        {
          id: 'meet',
          status: 'pending',
          deadlineDay: 1,
          offMap: false,
          facade: false,
          roles: ['courier'],
          traces: [{ kind: 'meeting', roles: ['courier'], text: trace, evidences: ['LOCATED_AT'] }],
        },
      ],
    };
    const heard = advanceLibrary([onMap], facts, { day: 1, phase: 0 }, createPrng('on'));
    const announcement = heard.events.find((event) => event.kind === 'public-announcement');
    expect(announcement?.visibility).toBe('player');
    expect(announcement !== undefined && 'text' in announcement && announcement.text).toBe(trace);
    const quiet: PlotStateV2 = {
      ...base,
      id: 'plot:second-off',
      role: 'secondary',
      offMap: ['away'],
      stages: [
        {
          id: 'away',
          status: 'pending',
          deadlineDay: 1,
          offMap: true,
          facade: false,
          roles: [],
          traces: [{ kind: 'meeting', roles: [], text: trace, evidences: [] }],
        },
      ],
    };
    const hidden = advanceLibrary([quiet], facts, { day: 1, phase: 0 }, createPrng('off'));
    expect(hidden.events.some((event) => event.kind === 'public-announcement')).toBe(false);
    expect(hidden.events.some((event) => event.kind === 'stage-executed' && event.visibility === 'player')).toBe(false);
  });

  it('binds a materiel query to a loaded plot item', () => {
    const set = {
      locationTypes: new Map(),
      archetypes: new Map(),
      services: new Map(),
      cities: {},
      plotItems: new Map([
        [
          'coldwar-plots/listening-device',
          {
            id: 'listening-device',
            pool: 'devices',
            tags: ['materiel:device'],
            description: 'A microphone small enough to hide in a lamp.',
          },
        ],
      ]),
    } as unknown as ContentSet;
    const view = cityView({ locations: {}, districts: {} } as City, set, {
      city: 'core',
      year: 1952,
      startDate: '1952-03-01',
      attempt: 0,
    } as SettingSelection);
    expect(view.binders('item', ['materiel:device'])).toEqual(['coldwar-plots/listening-device']);
    expect(view.binders('item', ['materiel:explosive'])).toEqual([]);
  });

  it('keeps twist, facade, decoy, branch cause and resolution off the player surface', () => {
    // Feature: plot-library, Property 9: Twist and branch isolation
    const facts = {
      alertness: 0,
      adoptedBeliefs: [],
      roleStatus: {},
      arrestedRoles: new Set<string>(),
      seizedItems: new Set<string>(),
      identifiedRoles: new Set<string>(),
      protectedEntities: new Set<string>(),
      entityStatus: {},
      disrupted: new Set<string>(),
    };
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z]{6}$/),
        fc.constantFrom('false-flag' as const, 'facade' as const, 'inside-man' as const),
        (secret, kind) => {
          const stageId = `gone-${secret}`;
          const plot: PlotStateV2 = {
            id: 'plot:second',
            templateId: 'second',
            displayName: 'Second',
            archetype: 'sabotage',
            role: 'secondary',
            variantKey: 'a',
            cells: [],
            cutouts: [],
            bindings: {},
            roleHolders: {},
            knowledge: {},
            runtimeBranches: [
              {
                id: 'fork',
                after: [],
                alternatives: [
                  { id: 'a', when: [], stageIds: [] },
                  { id: 'b', when: [], stageIds: [] },
                ],
              },
            ],
            twist: {
              kind,
              facadeStages: [stageId],
              decoy: `org:${secret}`,
              propositions: [],
            },
            outcomes: {
              success: [{ kind: 'arrest-role', role: 'leader' }],
              failure: [{ kind: 'stage-completed', stage: stageId }],
            },
            offMap: [stageId],
            stages: [
              {
                id: stageId,
                status: 'pending',
                deadlineDay: 0,
                offMap: true,
                facade: true,
                roles: [],
              },
            ],
            subPlots: [],
            standingPenalty: 3,
            standingReward: 1,
          };
          const at = { day: 1, phase: 0 } as const;
          const stepped = advanceLibrary([plot], facts, at, createPrng(secret));
          const kept = stepped.plots[0];
          const ground = JSON.stringify({
            twist: kept?.twist,
            resolution: kept?.resolution,
            cause: kept?.runtimeBranches[0]?.resolved?.cause,
          });
          const cable = renderDamageCable(
            stepped.damageCables[0]?.text ?? '',
            at,
            plot.id,
            {
              id: 'cable-hq-directive',
              kind: 'cable',
              titlePattern: 'CABLE {cable-ref}',
              sections: [{ id: 'body', body: 'RE {subject} STOP {instruction} STOP' }],
              slots: ['cable-ref', 'subject', 'instruction'],
            },
            {
              city: { displayName: 'Vienna', districts: {}, locations: {}, routes: [], crowdModels: {}, startMonth: 1 },
              npcs: {},
              orgs: {},
            },
          );
          const surface = JSON.stringify({
            notifications: stepped.events.filter((event) => event.visibility === 'player'),
            documents: [cable.body],
          });
          expect(ground).toContain(secret);
          expect(ground).toContain(kind);
          expect(kept?.twist?.facadeStages).toContain(stageId);
          expect(kept?.twist?.decoy).toBe(`org:${secret}`);
          expect(kept?.resolution).toBeDefined();
          expect(stepped.events.some((event) => event.visibility === 'hidden' && 'cause' in event)).toBe(true);
          expect(stepped.primaryEnded).toBeUndefined();
          expect(surface).not.toContain(secret);
          expect(surface).not.toContain(kind);
          expect(surface).not.toContain('facadeStages');
          expect(surface).not.toContain('decoy');
          expect(surface).not.toContain('"cause"');
          expect(surface).not.toContain('"resolution"');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('resolves each plot when its conditions hold and accounts abort and standing', () => {
    // Feature: plot-library, Property 10: Outcome and abort accounting
    const plotOf = (
      id: string,
      role: 'primary' | 'secondary',
      penalty: number,
      reward: number,
      facade: boolean,
    ): PlotStateV2 => ({
      id,
      templateId: id,
      displayName: id,
      archetype: 'sabotage',
      role,
      variantKey: 'a',
      cells: [],
      cutouts: [],
      bindings: {},
      roleHolders: {},
      knowledge: {},
      runtimeBranches: [],
      outcomes: {
        success: [
          { kind: 'arrest-role', role: 'leader' },
          { kind: 'seize-item', item: 'plates' },
        ],
        failure: [
          { kind: 'stage-completed', stage: 'close' },
          { kind: 'abort' },
          { kind: 'entity-status', entity: 'leader', status: 'fled' },
        ],
      },
      offMap: ['close'],
      stages: [
        { id: 'open', status: 'pending', deadlineDay: 0, offMap: false, facade: false, roles: ['leader'] },
        { id: 'decoy', status: 'pending', deadlineDay: 0, offMap: false, facade, roles: [] },
        { id: 'close', status: 'pending', deadlineDay: 0, offMap: true, facade: false, roles: [] },
      ],
      subPlots: [],
      standingPenalty: penalty,
      standingReward: reward,
      ...(facade
        ? { twist: { kind: 'facade' as const, facadeStages: ['decoy'], propositions: [] } }
        : {}),
    });

    /** Reference accounting: success before failure, facade disruptions ignored. */
    const reference = (
      plot: PlotStateV2,
      disrupted: ReadonlySet<string>,
      arrested: ReadonlySet<string>,
      seized: ReadonlySet<string>,
      fled: boolean,
    ) => {
      if (plot.resolution !== undefined) {
        return { outcome: null, pressure: plot.abortCount ?? 0 };
      }
      const facade = new Set(plot.twist?.facadeStages ?? []);
      let pressure = plot.abortCount ?? 0;
      const executed = new Set(
        plot.stages.filter((stage) => stage.status === 'executed').map((stage) => stage.id),
      );
      for (const stage of plot.stages) {
        if (stage.status !== 'pending' || stage.deadlineDay > 1) {
          continue;
        }
        if (disrupted.has(stage.id)) {
          if (!facade.has(stage.id)) {
            pressure += 1;
          }
          continue;
        }
        if (stage.offMap) {
          executed.add(stage.id);
        }
      }
      const outcome = evaluateOutcomes(
        {
          success: plot.outcomes.success as Parameters<typeof evaluateOutcomes>[0]['success'],
          failure: plot.outcomes.failure as Parameters<typeof evaluateOutcomes>[0]['success'],
        },
        {
          arrestedRoles: arrested,
          seizedItems: seized,
          aborted: pressure >= 3,
          completedStages: executed,
          identifiedRoles: new Set<string>(),
          entityStatus: fled ? { leader: 'fled' } : {},
          protectedEntities: new Set<string>(),
        },
      );
      return { outcome, pressure };
    };

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4 }),
        fc.integer({ min: 0, max: 4 }),
        fc.boolean(),
        fc.integer({ min: 0, max: 2 }),
        fc.array(fc.boolean(), { minLength: 12, maxLength: 12 }),
        (penalty, reward, facade, secondaryCount, flags) => {
          let plots = [
            plotOf('plot:primary', 'primary', penalty, reward, facade),
            ...Array.from({ length: secondaryCount }, (_, index) =>
              plotOf(`plot:s${index}`, 'secondary', penalty + index, reward, facade),
            ),
          ];
          for (let step = 0; step < 2; step += 1) {
            const on = (index: number) => flags[index] === true || (step === 1 && flags[index + 6] === true);
            const disrupted = new Set<string>();
            if (on(0)) {
              disrupted.add('open');
            }
            if (on(1)) {
              disrupted.add('decoy');
            }
            if (on(2)) {
              disrupted.add('close');
            }
            const arrested = new Set<string>(on(3) ? ['leader'] : []);
            const seized = new Set<string>(on(4) ? ['plates'] : []);
            const fled = on(5);
            const before = plots;
            const stepped = advanceLibrary(
              plots,
              {
                alertness: 0,
                adoptedBeliefs: [],
                roleStatus: {},
                arrestedRoles: arrested,
                seizedItems: seized,
                identifiedRoles: new Set<string>(),
                protectedEntities: new Set<string>(),
                entityStatus: fled ? { leader: 'fled' } : {},
                disrupted,
              },
              { day: 1, phase: 0 },
              createPrng(`acct-${step}`),
            );
            let standing = 0;
            let primaryResolved = false;
            for (const plot of before) {
              const expected = reference(plot, disrupted, arrested, seized, fled);
              const actual = stepped.plots.find((item) => item.id === plot.id);
              expect(actual).toBeDefined();
              if (actual === undefined) {
                return;
              }
              expect(actual.abortCount ?? 0).toBe(expected.pressure);
              if (plot.resolution !== undefined) {
                expect(actual.resolution).toEqual(plot.resolution);
                continue;
              }
              if (expected.outcome === null) {
                expect(actual.resolution).toBeUndefined();
                continue;
              }
              expect(actual.resolution?.result).toBe(expected.outcome.result);
              expect(actual.resolution?.by).toBe(expected.outcome.by);
              if (plot.role === 'secondary') {
                standing += expected.outcome.result === 'succeeded' ? -plot.standingPenalty : plot.standingReward;
              } else {
                primaryResolved = true;
                expect(stepped.primaryEnded?.outcome).toBe(
                  expected.outcome.result === 'disrupted' ? 'success' : 'failure',
                );
              }
            }
            expect(stepped.standingDelta).toBe(standing);
            if (!primaryResolved) {
              expect(stepped.primaryEnded).toBeUndefined();
            }
            plots = [...stepped.plots];
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('delivers a damage-report cable when a secondary succeeds', () => {
    const report = 'Headquarters reports damage from a second operation.';
    const secondary: PlotStateV2 = {
      id: 'plot:second',
      templateId: 'second',
      displayName: 'Second',
      archetype: 'sabotage',
      role: 'secondary',
      variantKey: 'a',
      cells: [],
      cutouts: [],
      bindings: {},
      roleHolders: {},
      knowledge: {},
      runtimeBranches: [],
      outcomes: {
        success: [{ kind: 'arrest-role', role: 'leader' }],
        failure: [{ kind: 'stage-completed', stage: 'close' }],
      },
      offMap: ['close'],
      stages: [
        {
          id: 'close',
          status: 'pending',
          deadlineDay: 1,
          offMap: true,
          facade: false,
          roles: [],
        },
      ],
      subPlots: [],
      standingPenalty: 3,
      standingReward: 1,
      damageReport: report,
    };
    const at = { day: 1, phase: 0 } as const;
    const stepped = advanceLibrary(
      [secondary],
      {
        alertness: 0,
        adoptedBeliefs: [],
        roleStatus: {},
        arrestedRoles: new Set<string>(),
        seizedItems: new Set<string>(),
        identifiedRoles: new Set<string>(),
        protectedEntities: new Set<string>(),
        entityStatus: {},
        disrupted: new Set<string>(),
      },
      at,
      createPrng('damage'),
    );
    expect(stepped.plots[0]?.resolution).toEqual({ result: 'succeeded', at, by: 'stage-completed' });
    expect(stepped.standingDelta).toBe(-3);
    expect(stepped.primaryEnded).toBeUndefined();
    const cable = stepped.events.find((event) => event.kind === 'cable');
    expect(cable?.visibility).toBe('player');
    expect(stepped.damageCables).toEqual([{ doc: cable && 'doc' in cable ? cable.doc : '', text: report, plotId: 'plot:second' }]);
    const document = renderDamageCable(report, at, 'plot:second', {
      id: 'cable-hq-directive',
      kind: 'cable',
      titlePattern: 'CABLE {cable-ref}',
      sections: [{ id: 'body', body: 'RE {subject} STOP {instruction} STOP' }],
      slots: ['cable-ref', 'subject', 'instruction'],
    }, {
      city: { displayName: 'Vienna', districts: {}, locations: {}, routes: [], crowdModels: {}, startMonth: 1 },
      npcs: {},
      orgs: {},
    });
    expect(document.id).toBe(stepped.damageCables[0]?.doc);
    expect(document.body).toContain(report);
    expect(document.kind).toBe('cable');
  });

  it('acknowledges an identification the same way either way', () => {
    // Feature: plot-library, Property 11: Identification is truth-blind
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 8 }),
        fc.integer({ min: 1, max: 5 }),
        fc.string({ minLength: 1, maxLength: 6 }),
        (evidence, threshold, name) => {
          const right = identifyReport({ evidenceCount: evidence, threshold, reported: name, holder: name });
          const wrong = identifyReport({
            evidenceCount: evidence,
            threshold,
            reported: name,
            holder: `${name}-other`,
          });
          expect(right.allowed).toBe(wrong.allowed);
          expect(right.allowed).toBe(evidence >= threshold);
          expect(right.ack).toBe(wrong.ack);
          expect(right.ack).toBe('HQ acknowledges your report.');
          expect(wrong.penalty).toBe(right.allowed);
          expect(right.correct).toBe(right.allowed);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('keeps a generated session consistent across plots and side threads', () => {
    // Feature: plot-library, Property 12: Cross-plot consistency
    const places = ['cafe', 'park', 'square'] as const;
    const archetypes = ['sabotage', 'kompromat', 'smuggling'] as const;
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.boolean(),
        (seed, shareable) => {
          const plots = places.map((place, index) => {
            const archetype = archetypes[index] ?? 'sabotage';
            return template({
              id: place,
              archetype,
              concurrency: {
                tags: [archetype],
                allowWith: ['sabotage', 'kompromat', 'smuggling'],
              },
              params: {
                venue: { kind: 'loc', query: [`function:${place}`] },
                plates: { kind: 'item', query: [`materiel:${place}`], mandatory: false },
              },
              roleSlots: { leader: { query: ['role:cell'], shareable } },
            });
          });
          const thread = template({
            id: 'affair',
            kind: 'side-thread',
            cells: [],
            mimics: 'kompromat',
            spawn: ['worldgen'],
            roleSlots: { witness: { query: ['role:civilian'] } },
            params: { venue: { kind: 'loc', query: ['function:cafe'] } },
            stages: [stage('seen')],
          });
          let session: ReturnType<typeof buildLibrarySession>;
          try {
            session = buildLibrarySession(
              {
                templates: plots,
                sideThreads: [thread],
                sideThreadCount: 1,
                city: city({
                  'loc:function:cafe': ['loc:cafe'],
                  'loc:function:park': ['loc:park'],
                  'loc:function:square': ['loc:square'],
                  'item:materiel:cafe': ['item:cafe'],
                  'item:materiel:park': ['item:park'],
                  'item:materiel:square': ['item:square'],
                  'npc:role:civilian': ['npc:witness'],
                }),
                preset: {
                  id: 'standard',
                  plot: { stageCount: 2, deadlineSlackDays: 1 },
                  secondaryPlots: 1,
                  lookalikeShare: 1,
                  twistProbability: 0,
                },
                year: 1952,
                seed,
                world: {
                  ...WORLD,
                  npcsForQuery: () =>
                    shareable ? ['npc:shared'] : ['npc:0', 'npc:1', 'npc:2', 'npc:3'],
                },
              },
              createPrng(seed),
            );
          } catch (error) {
            if (error instanceof LibrarySelectionError) {
              fc.pre(false);
              return;
            }
            throw error;
          }
          fc.pre(session !== undefined);
          if (session === undefined) {
            return;
          }
          fc.pre(session.plots.some((plot) => plot.role === 'secondary'));
          const view = city({
            'loc:function:cafe': ['loc:cafe'],
            'loc:function:park': ['loc:park'],
            'loc:function:square': ['loc:square'],
            'item:materiel:cafe': ['item:cafe'],
            'item:materiel:park': ['item:park'],
            'item:materiel:square': ['item:square'],
            'npc:role:civilian': ['npc:witness'],
          });
          const threads = fillLookalikeShare(
            {
              threads: [thread],
              plots,
              city: view,
              preset: {
                id: 'standard',
                plot: { stageCount: 2, deadlineSlackDays: 1 },
                lookalikeShare: 1,
              },
              share: 1,
              sideThreadCount: 1,
              cellMembers: new Set(session.plots.flatMap((plot) => plot.cells.flatMap((cell) => cell.members))),
            },
            createPrng(`${seed}-noise`),
          );
          fc.pre(threads.length > 0);
          const placed = threads[0];
          expect(placed?.participants).toEqual(['npc:witness']);
          expect(placed?.place).toBe('loc:cafe');

          expect(libraryConflicts(session.plots, threads)).toEqual([]);
          const facts = session.plots.flatMap((plot) => Object.keys(plot.itemOrigins ?? {}));
          expect(facts.length).toBeGreaterThan(0);

          const templates = new Map(plots.map((item) => [item.id, item]));
          const holders = new Map<string, { templateId: string; slot: string }[]>();
          for (const plot of session.plots) {
            for (const [slot, npc] of Object.entries(plot.roleHolders)) {
              const list = holders.get(npc) ?? [];
              list.push({ templateId: plot.templateId, slot });
              holders.set(npc, list);
            }
          }
          for (const casts of holders.values()) {
            if (casts.length < 2) {
              continue;
            }
            for (const cast of casts) {
              expect(templates.get(cast.templateId)?.roleSlots[cast.slot]?.shareable).toBe(true);
            }
          }
          if (!shareable) {
            expect([...holders.values()].every((casts) => casts.length === 1)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('replaces a foreign stage with its fallback or lists it off-map', () => {
    // Feature: plot-library, Property 16: Off-map fallback
    const facts = {
      alertness: 0,
      adoptedBeliefs: [] as string[],
      roleStatus: {},
      arrestedRoles: new Set<string>(),
      seizedItems: new Set<string>(),
      identifiedRoles: new Set<string>(),
      protectedEntities: new Set<string>(),
      entityStatus: {},
      disrupted: new Set<string>(),
    };
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 8 }),
        fc.constantFrom('field', 'abroad', 'port'),
        (seed, foreign) => {
          const session = sessionFor(
            {
              cityRoles: { home: {}, [foreign]: {} },
              stages: [
                { ...stage('open'), handoff: { from: 'gone' } },
                { ...stage('next'), handoff: { from: 'open' } },
                {
                  id: 'gone',
                  city: foreign,
                  requires: [],
                  deadline: { min: 2, max: 4 },
                  traces: [],
                },
                {
                  id: 'swap',
                  city: foreign,
                  fallback: 'open',
                  requires: [],
                  deadline: { min: 2, max: 4 },
                  traces: [],
                },
              ],
              outcomes: {
                success: [{ kind: 'arrest-role', role: 'leader' }],
                failure: [
                  { kind: 'stage-completed', stage: 'open' },
                  { kind: 'stage-completed', stage: 'gone' },
                ],
              },
            },
            seed,
          );
          expect(session).toBeDefined();
          const plot = session?.plots[0];
          if (plot === undefined) {
            return;
          }
          expect(plot.offMap).toContain('gone');
          expect(plot.offMap).not.toContain('swap');
          expect(plot.offMap).not.toContain('open');
          expect(plot.stages.map((item) => item.id)).not.toContain('swap');
          expect(plot.stages.find((item) => item.id === 'gone')?.offMap).toBe(true);
          expect(plot.stages.find((item) => item.id === 'open')?.requires).toContain('gone');
          expect(plot.stages.find((item) => item.id === 'next')?.requires).toContain('open');
          expect(plot.cityRoles?.home).toEqual({});
          expect(plot.cityHooks?.some((hook) => hook.id === 'swap' && hook.fallback === 'open')).toBe(true);
          expect(plot.cityHooks?.some((hook) => hook.id === 'gone' && hook.city === foreign)).toBe(true);
          expect(plot.cityHooks?.some((hook) => hook.id === 'open' && hook.handoff?.from === 'gone')).toBe(true);
          expect(plot.outcomes.failure.some((condition) => condition.stage === 'gone')).toBe(false);
          expect(plot.outcomes.failure.some((condition) => condition.stage === 'open')).toBe(true);
          expect(verifyLibrary([plot]).ok).toBe(true);
          const stepped = advanceLibrary([plot], facts, { day: 5, phase: 0 }, createPrng(seed));
          const event = stepped.events.find((item) => item.kind === 'stage-executed');
          expect(event?.visibility).toBe('hidden');
          expect(event === undefined || !('traces' in event)).toBe(true);
          expect(stepped.events.some((item) => item.kind === 'stage-executed' && item.visibility === 'player')).toBe(
            false,
          );
          expect(stepped.plots[0]?.stages.find((item) => item.id === 'gone')?.status).toBe('executed');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('verifies every bound plot for any seed and preset', () => {
    // Feature: plot-library, Property 15: Library solvability
    const twist = {
      kind: 'false-flag' as const,
      mandatory: true,
      decoy: { kind: 'org' as const, query: ['org:criminal'] },
      propositions: [{ predicate: 'MEMBER_OF', subject: 'leader', object: 'decoy' }],
    };
    const secondary = template({
      id: 'sample-b',
      archetype: 'kompromat',
      concurrency: { tags: ['kompromat'], allowWith: ['sabotage', 'smuggling'] },
      twist,
    });
    const twisted = template({
      id: 'sample-twist',
      archetype: 'smuggling',
      concurrency: { tags: ['smuggling'], allowWith: ['sabotage', 'kompromat'] },
      twist,
    });
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 8 }),
        fc.constantFrom(
          { id: 'easy' as const, secondaryPlots: 0, twistProbability: 0 },
          { id: 'standard' as const, secondaryPlots: 1, twistProbability: 1 },
          { id: 'hard' as const, secondaryPlots: 2, twistProbability: 1 },
        ),
        (seed, knobs) => {
          const session = buildLibrarySession(
            {
              templates: [template({ twist }), secondary, twisted],
              city: city(),
              preset: {
                id: knobs.id,
                plot: { stageCount: 2, deadlineSlackDays: 1 },
                secondaryPlots: knobs.secondaryPlots,
                twistProbability: knobs.twistProbability,
              },
              year: 1952,
              world: WORLD,
            },
            createPrng(seed),
          );
          expect(session).toBeDefined();
          if (session === undefined) {
            return;
          }
          expect(session.plots.length).toBe(1 + knobs.secondaryPlots);
          const verified = verifyLibrary(session.plots, { mole: 'npc:mole' });
          expect(verified.ok).toBe(true);
          for (const plot of session.plots) {
            for (const stage of plot.stages) {
              if (stage.offMap) {
                continue;
              }
              const kinds = new Set((stage.traces ?? []).map((trace) => trace.kind));
              const human = kinds.has('meeting') || kinds.has('npc-moved');
              const signal =
                kinds.has('transmission') || kinds.has('drop-loaded') || kinds.has('drop-emptied');
              expect(human).toBe(true);
              expect(signal).toBe(true);
            }
            expect(plot.twist?.propositions.length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('requires a disjoint human and signal route and skips off-map stages', () => {
    const session = sessionFor({}, 'routes');
    const plot = session?.plots[0];
    expect(plot).toBeDefined();
    if (plot === undefined) {
      return;
    }
    const meetingOnly = {
      ...plot,
      stages: plot.stages.map((stage) => ({
        ...stage,
        traces: (stage.traces ?? []).filter((trace) => trace.kind === 'meeting'),
      })),
    };
    expect(verifyLibrary([meetingOnly]).failures[0]?.reason).toBe('no-signal');
    const signalOnly = {
      ...plot,
      stages: plot.stages.map((stage) => ({
        ...stage,
        traces: (stage.traces ?? []).filter((trace) => trace.kind === 'transmission'),
      })),
    };
    expect(verifyLibrary([signalOnly]).failures[0]?.reason).toBe('no-human');
    const shared = {
      ...plot,
      bindings: {},
      stages: [
        {
          ...plot.stages[0],
          id: 'drop',
          offMap: false,
          traces: [
            { kind: 'meeting' as const, roles: ['leader'], text: 'They meet.', evidences: [] },
            { kind: 'drop-loaded' as const, roles: ['leader'], text: 'A drop.', evidences: [] },
          ],
        },
      ],
    };
    expect(verifyLibrary([shared]).failures.some((failure) => failure.reason === 'not-disjoint')).toBe(true);
    const offMap = {
      ...plot,
      stages: plot.stages.map((stage) => ({ ...stage, offMap: true, traces: [] })),
    };
    expect(verifyLibrary([offMap]).ok).toBe(true);
    const twisted = {
      ...meetingOnly,
      twist: {
        kind: 'false-flag' as const,
        facadeStages: [],
        propositions: ['MEMBER_OF'],
      },
    };
    expect(verifyLibrary([twisted]).failures.some((failure) => failure.target === 'MEMBER_OF')).toBe(true);
    expect(verifyLibrary([meetingOnly], { mole: 'npc:mole' }).failures.some((failure) => failure.target === 'npc:mole')).toBe(
      true,
    );
  });

  it('drops a plot whose stages have no signal route', () => {
    expect(() =>
      sessionFor(
        {
          id: 'quiet',
          stages: [
            {
              id: 'open',
              requires: [],
              deadline: { min: 2, max: 4 },
              traces: [
                {
                  kind: 'meeting' as const,
                  roles: ['leader'],
                  evidences: ['LOCATED_AT'],
                  text: 'They meet.',
                },
              ],
              onDisrupted: { delay: 0.5, reroute: 0.4, abort: 0.1 },
            },
          ],
        },
        'quiet',
      ),
    ).toThrow(/verify /);
  });

  it('spawns a side thread only when it stays consistent, solvable and clear of the cell', () => {
    // Feature: plot-library, Property 19: Side Thread spawning
    const preset = { id: 'standard' as const, plot: { stageCount: 2, deadlineSlackDays: 1 } };
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 8 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.integer({ min: 0, max: 6 }),
        fc.integer({ min: 1, max: 4 }),
        (seed, share, sideThreadCount, available) => {
          const thread = template({
            id: 'affair',
            kind: 'side-thread',
            cells: [],
            roleSlots: { witness: { query: ['role:civilian'] } },
            spawn: ['midgame'],
            mimics: 'kompromat',
            stages: [stage('seen')],
          });
          const quiet = template({
            id: 'quiet-thread',
            kind: 'side-thread',
            cells: [],
            roleSlots: {},
            spawn: ['midgame'],
            stages: [
              {
                id: 'seen',
                requires: [],
                deadline: { min: 2, max: 4 },
                traces: [],
              },
            ],
          });
          const map = new Map([
            ['affair', thread],
            ['quiet-thread', quiet],
          ]);
          const view = city();
          const blocked = { threads: [] as const };
          const wrongMode = instantiateSideThread(
            blocked,
            { template: 'affair', mode: 'worldgen' },
            map,
            view,
            preset,
            createPrng(seed),
          );
          expect(wrongMode.ok).toBe(false);
          if (!wrongMode.ok) {
            expect(wrongMode.next).toBe(blocked);
          }
          const inCell = instantiateSideThread(
            blocked,
            { template: 'affair', mode: 'midgame', cellMembers: new Set(['npc:a']) },
            map,
            view,
            preset,
            createPrng(seed),
          );
          expect(inCell.ok).toBe(false);
          if (!inCell.ok) {
            expect(inCell.next).toBe(blocked);
          }
          const unsolvable = instantiateSideThread(
            blocked,
            { template: 'quiet-thread', mode: 'midgame' },
            map,
            view,
            preset,
            createPrng(seed),
          );
          expect(unsolvable.ok).toBe(false);
          if (!unsolvable.ok) {
            expect(unsolvable.reason).toBe('unsolvable');
            expect(unsolvable.next).toBe(blocked);
          }
          const booked = {
            threads: [
              {
                id: 'thread:booked',
                templateId: 'old',
                participants: ['npc:a'],
                place: 'loc:station',
                at: 16,
              },
            ],
          };
          const clash = instantiateSideThread(
            booked,
            { template: 'affair', mode: 'midgame' },
            map,
            view,
            preset,
            createPrng(seed),
          );
          expect(clash.ok).toBe(false);
          if (!clash.ok) {
            expect(clash.reason).toBe('inconsistent');
            expect(clash.next).toBe(booked);
          }
          const spawned = instantiateSideThread(
            blocked,
            { template: 'affair', mode: 'midgame', cellMembers: new Set(['npc:cell']) },
            map,
            view,
            preset,
            createPrng(seed),
          );
          expect(spawned.ok).toBe(true);
          if (spawned.ok) {
            expect(spawned.next.threads.slice(0, -1)).toEqual([...blocked.threads]);
            const added = spawned.next.threads.at(-1);
            expect(added?.participants ?? []).not.toContain('npc:cell');
            expect(libraryConflicts([], spawned.next.threads)).toEqual([]);
          }
          const lookalikes = Array.from({ length: available }, (_, index) =>
            template({
              id: `look-${index}`,
              kind: 'side-thread',
              cells: [],
              roleSlots: {},
              mimics: 'sabotage',
              stages: [stage('seen')],
            }),
          );
          const pool = template({
            id: 'pool-plot',
            stages: [
              {
                ...stage('open'),
                traces: [
                  {
                    kind: 'meeting' as const,
                    roles: ['leader'],
                    evidences: ['LOCATED_AT'],
                    text: 'The cell meets at the depot.',
                  },
                  {
                    kind: 'transmission' as const,
                    roles: ['leader'],
                    channel: 'radio' as const,
                    evidences: ['LOCATED_AT'],
                    text: 'A cell signal leaves the set.',
                  },
                ],
              },
            ],
          });
          const placed = fillLookalikeShare(
            {
              threads: lookalikes,
              plots: [pool],
              city: view,
              preset,
              share,
              sideThreadCount,
              cellMembers: new Set(['npc:cell']),
            },
            createPrng(seed),
          );
          expect(placed.length).toBe(lookalikeCount(share, sideThreadCount, available));
          for (const thread of placed) {
            expect(thread.traces?.some((trace) => trace.text === 'The cell meets at the depot.')).toBe(true);
            expect(thread.traces?.every((trace) => !trace.roles.includes('leader'))).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('maps an arrested role holder and a seized binding onto outcome names', () => {
    const facts = projectLibraryFacts({
      arrests: ['npc:leader'],
      identifications: [
        { roleTag: 'courier', correct: true },
        { roleTag: 'decoy', correct: false },
      ],
      plots: [
        {
          roleHolders: { leader: 'npc:leader' },
          bindings: { charge: 'item:charge' },
          stages: [{ id: 'plant', status: 'disrupted' }],
        },
      ],
      sliceRoles: [{ slot: 'resident', npc: 'npc:other' }],
      sliceDisruptedStageIds: ['slice-stage'],
      seizedItemIds: ['item:charge'],
    });
    expect(facts.arrestedRoles.has('leader')).toBe(true);
    expect(facts.arrestedRoles.has('resident')).toBe(false);
    expect(facts.identifiedRoles).toEqual(new Set(['courier']));
    expect(facts.seizedItems.has('charge')).toBe(true);
    expect(facts.seizedItems.has('item:charge')).toBe(true);
    expect(facts.disrupted.has('plant')).toBe(true);
    expect(facts.disrupted.has('slice-stage')).toBe(true);
    expect(facts.alertness).toBe(0);
    expect(facts.protectedEntities.size).toBe(0);
  });

  it('reads alertness and protects an active target only once the deadline has arrived', () => {
    const plot = {
      roleHolders: { target: 'npc:defector', hunter: 'npc:hunter' },
      bindings: {},
      stages: [{ id: 'wait', status: 'pending', deadlineDay: 4 }],
      outcomes: {
        success: [{ kind: 'protect-until', entity: 'target', until: 'final-deadline' as const }],
        failure: [],
      },
    };
    const people = [
      { id: 'npc:defector', status: 'active' },
      { id: 'npc:hunter', status: 'active', hostileCustody: true },
    ];
    const early = projectLibraryFacts({
      arrests: [],
      alertness: 0.2,
      adoptedBeliefs: ['MEMBER_OF'],
      nowDay: 3,
      people,
      plots: [plot],
      sliceRoles: [],
      sliceDisruptedStageIds: [],
      seizedItemIds: [],
    });
    expect(early.alertness).toBe(0.2);
    expect(early.adoptedBeliefs).toEqual(['MEMBER_OF']);
    expect(early.protectedEntities.has('target')).toBe(false);
    expect(early.roleStatus.hunter).toBe('hostile-custody');

    const due = projectLibraryFacts({
      arrests: [],
      alertness: 0.6,
      nowDay: 4,
      people,
      plots: [plot],
      sliceRoles: [],
      sliceDisruptedStageIds: [],
      seizedItemIds: [],
    });
    expect(due.protectedEntities.has('target')).toBe(true);
    expect(due.entityStatus.target).toBe('active');

    const fled = projectLibraryFacts({
      arrests: [],
      nowDay: 4,
      people: [{ id: 'npc:defector', status: 'fled' }],
      plots: [plot],
      sliceRoles: [],
      sliceDisruptedStageIds: [],
      seizedItemIds: [],
    });
    expect(fled.protectedEntities.has('target')).toBe(false);
    expect(fled.roleStatus.target).toBe('fled');
  });
});

describe('item origins at instantiation', () => {
  it('records the first cell member as the origin of each bound item', () => {
    const plot = template({
      params: {
        venue: { kind: 'loc', query: ['function:cafe'] },
        plates: { kind: 'item', query: ['materiel:plate'], mandatory: false },
      },
    });
    const expanded = expand(plot, PRESET, new Map(), createPrng('expand'));
    const made = instantiate(
      plot,
      expanded,
      PRESET,
      {
        hostileOrg: 'org:hostile',
        contacts: [],
        stationStaff: [],
        orgsForQuery: () => [],
        npcsForQuery: () => ['npc:forger'],
      },
      createPrng('make'),
      'primary',
      '1',
      { venue: 'loc:cafe', plates: 'item:plates' },
    );
    expect(made.itemOrigins).toEqual({ 'item:plates': 'npc:forger' });
  });
});

describe('library consistency', () => {
  function shell(id: string, place: string, role: 'primary' | 'secondary' = 'secondary'): PlotStateV2 {
    return {
      id: `plot:${id}`,
      templateId: id,
      displayName: id,
      archetype: id,
      role,
      variantKey: 'a',
      cells: [{ org: `org:cell-${id}`, spec: 'cell', security: 0.4, members: ['npc:shared'] }],
      cutouts: [],
      bindings: { venue: place },
      roleHolders: { leader: 'npc:shared' },
      knowledge: {},
      runtimeBranches: [],
      outcomes: { success: [], failure: [] },
      offMap: [],
      stages: [
        {
          id: 'open',
          status: 'pending',
          deadlineDay: 2,
          offMap: false,
          facade: false,
          roles: ['leader'],
        },
      ],
      subPlots: [],
      standingPenalty: 0,
      standingReward: 0,
    };
  }

  it('moves the later booking to a free phase on the same day', () => {
    const settled = reconcilePlots([
      shell('alpha', 'loc:cafe', 'primary'),
      shell('beta', 'loc:park'),
    ]);
    expect(settled.ok).toBe(true);
    if (!settled.ok) {
      return;
    }
    expect(settled.plots[1]?.stages[0]?.traceAt).toBe(2 * 4 + 1);
    expect(settled.plots[0]?.stages[0]?.traceAt).toBeUndefined();
  });

  it('fails when the deadline day has no free phase', () => {
    const plots = ['a', 'b', 'c', 'd', 'e'].map((id, index) => shell(id, `loc:${index}`));
    const settled = reconcilePlots(plots);
    expect(settled.ok).toBe(false);
  });

  it('logs a consistency failure and reselects when the day cannot be cleared', () => {
    const view = city({
      'loc:function:cafe': ['loc:cafe'],
      'loc:function:park': ['loc:park'],
      'loc:function:dock': ['loc:dock'],
      'loc:function:square': ['loc:square'],
      'loc:function:hotel': ['loc:hotel'],
    });
    const plots = ['cafe', 'park', 'dock', 'square', 'hotel'].map((place) =>
      template({
        id: place,
        archetype: place,
        concurrency: { tags: [place], allowWith: ['cafe', 'park', 'dock', 'square', 'hotel'] },
        params: { venue: { kind: 'loc', query: [`function:${place}`] } },
        roleSlots: { leader: { query: ['role:cell'], shareable: true } },
        // Zero windows plus slack put every opening trace on the same day, so
        // five plots cannot be cleared (a day has four phases).
        stages: [
          { ...stage('open'), deadline: { min: 0, max: 0 } },
          { ...stage('close', ['open']), deadline: { min: 0, max: 0 } },
        ],
      }),
    );
    const session = buildLibrarySession(
      {
        templates: plots,
        city: view,
        preset: { id: 'hard', plot: { stageCount: 2, deadlineSlackDays: 1 }, secondaryPlots: 4 },
        year: 1952,
        world: { ...WORLD, npcsForQuery: () => ['npc:shared'] },
        seed: 'packed-day',
      },
      createPrng('packed-day'),
    );
    expect(session?.log?.filter((line) => line === 'consistency cafe seed packed-day')).toHaveLength(8);
    expect(session?.log).toContain('reselect 0: cafe');
    expect(session?.selection.primary).toBe('hotel');
    expect(session?.selection.secondaries).toEqual(['dock', 'square', 'park']);
    expect(session?.plots.find((plot) => plot.templateId === 'square')?.stages.some((stage) => stage.traceAt !== undefined)).toBe(
      true,
    );
  });
});

describe('library primary on the slice clock', () => {
  it('executes an on-map stage and leaves the off-map stage for the library', () => {
    const primary: PlotStateV2 = {
      id: 'plot:sample',
      templateId: 'sample',
      displayName: 'Sample',
      archetype: 'surveillance',
      role: 'primary',
      variantKey: 'a',
      cells: [{ org: 'org:cell-sample-a', spec: 'cell-a', security: 1, members: ['npc:leader'] }],
      cutouts: [],
      bindings: { venue: 'loc:cafe' },
      roleHolders: { leader: 'npc:leader' },
      knowledge: {},
      runtimeBranches: [],
      outcomes: { success: [], failure: [] },
      offMap: ['abroad'],
      stages: [
        {
          id: 'meet',
          status: 'pending',
          deadlineDay: 1,
          offMap: false,
          facade: false,
          roles: ['leader'],
          traces: [{ kind: 'meeting', roles: ['leader'], text: 'They meet.', evidences: [] }],
        },
        {
          id: 'abroad',
          status: 'pending',
          deadlineDay: 1,
          offMap: true,
          facade: false,
          roles: [],
        },
      ],
      subPlots: [],
      standingPenalty: 0,
      standingReward: 0,
    };
    const slice = slicePlotOf(primary);
    expect(slice.template).toBe('sample');
    expect(slice.stages.map((item) => item.id)).toEqual(['meet']);
    const day = executePlotDay(
      slice,
      { day: 1, phase: 0 },
      { city: { locations: {} }, npcs: {}, channels: {}, deadDrops: {} } as never,
      createPrng('clock'),
    );
    expect(day.plot.stages[0]?.status).toBe('executed');
    expect(day.events.some((event) => event.kind === 'stage-executed')).toBe(true);
    const synced = syncPrimaryStages(day.plot, [primary]);
    expect(synced[0]?.stages.find((item) => item.id === 'meet')?.status).toBe('executed');
    expect(synced[0]?.stages.find((item) => item.id === 'abroad')?.status).toBe('pending');
  });
});

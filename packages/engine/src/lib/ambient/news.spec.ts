/**
 * News continuity, emergent threads, cover duties and the solvability gate.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { PlotTemplateV2Schema, type PlotTemplateV2 } from '@tradecraft/content';

import { asTruth, revealTruth, type LocId, type NpcId } from '../model/core.js';
import type { WorldState } from '../model/state.js';
import { createPrng } from '../prng/prng.js';
import type { BindCity } from '../plotgen/bind.js';

import {
  keepsAnchor,
  quoteAttendDuty,
  resolveAttendDuty,
  scaleHighRiskSuspicion,
  settleDuties,
  stepCover,
} from './cover.js';
import {
  addDevelopment,
  editionCandidates,
  noticeLines,
  noticeStillPosted,
  openStory,
  postNotice,
  printedArticles,
  stepNews,
} from './news.js';
import { dailyAgenda, emptyLife } from './life.js';
import { anchorKey, gate, type GateCache, type StructuralChange, type VerifierResult } from './solvability.js';
import { stepThreads, type ThreadCatalogue } from './threads.js';
import type { AmbientState, StoryState } from './state.js';

const CAFE = 'loc:cafe' as LocId;

function ambient(extra: Partial<AmbientState> = {}): AmbientState {
  return {
    schema: 1,
    cityId: 'core',
    enabled: true,
    density: 'standard',
    calendar: { startDate: '1948-01-01', holidays: [] },
    metrics: {
      exo: { unrest: 0.9, police: 0.3, shortage: 0.2, tension: 0.3, festivity: 0.1 },
      react: { unrest: 0, police: 0, shortage: 0, tension: 0, festivity: 0 },
    },
    events: {},
    history: {},
    triggers: [],
    overlays: [],
    dormant: [],
    life: {},
    ties: [],
    tier: {},
    townsfolk: {},
    civicOrgs: [],
    promotionQueue: [],
    lastInteraction: {},
    memory: asTruth({}),
    regard: asTruth({}),
    informants: asTruth({}),
    stories: {},
    outlets: [{ id: 'tagblatt', name: 'Tagblatt', slant: 'commercial', distortion: 1 }],
    duties: [],
    coverStanding: asTruth(0.5),
    hookLedger: asTruth([]),
    ambientDelayDays: 0,
    coverDeltaToday: { pos: 0, neg: 0 },
    channelOutages: [],
    informantReports: [],
    detectionBonuses: {},
    tieKnowledge: {},
    falseBeliefs: {},
    gate: { solvable: ['prop:meets'], anchors: [], slowRunsToday: 0 },
    counters: { starts: 0, incidents: 0, lifeEvents: 0, gossip: 0, promotions: 0, threads: 0 },
    ...extra,
  };
}

function world(extra: Partial<WorldState> = {}, amb: Partial<AmbientState> = {}): WorldState {
  return {
    time: { day: 0, phase: 1 },
    meta: { seed: 'news', preset: { id: 'standard' } },
    player: {
      loc: CAFE,
      coverSuspicion: asTruth(0.2),
      cover: { id: 'journalist' },
      readDocuments: [],
    },
    npcs: {},
    orgs: {},
    whereabouts: {},
    city: { locations: { [CAFE]: { type: 'cafe', name: 'Cafe', risk: 0.8 } } },
    documents: {},
    documentPropositions: {},
    sideThreads: [],
    channels: {},
    ambient: ambient(amb),
    ...extra,
  } as unknown as WorldState;
}

function stage(id: string) {
  return {
    id,
    requires: [],
    deadline: { min: 2, max: 4 },
    traces: [
      {
        kind: 'meeting' as const,
        roles: [] as string[],
        evidences: ['LOCATED_AT'],
        text: 'A watcher keeps a quiet note of who comes and goes.',
      },
    ],
    onDisrupted: { delay: 0.5, reroute: 0.4, abort: 0.1 },
  };
}

function threadTemplate(extra: Record<string, unknown> = {}): PlotTemplateV2 {
  return PlotTemplateV2Schema.parse({
    id: 'rumour',
    templateSchema: 2,
    kind: 'side-thread',
    displayName: 'A rumour',
    archetype: 'noise',
    era: { from: 1948, to: 1962 },
    concurrency: { tags: [], allowWith: [] },
    params: {},
    roleSlots: {},
    cells: [],
    stages: [stage('heard')],
    stageCount: { min: 1, max: 1 },
    outcomes: { success: [], failure: [] },
    spawn: ['midgame'],
    ambient: { spawn: { metric: 'unrest', above: 0.5, tags: ['rumour'] } },
    ...extra,
  });
}

function catalogue(template: PlotTemplateV2, binders: (kind: string) => readonly string[]): ThreadCatalogue {
  const city: BindCity = { binders };
  return { templates: new Map([[template.id, template]]), city };
}

describe('news', () => {
  it('ranks a new development ahead of a first report and filler', () => {
    let stories = openStory({}, { id: 'story:strike', key: 'strike', source: 'evt:strike', chain: ['announced', 'resolved'], day: 3, cap: 12 });
    stories = addDevelopment(stories, 'story:strike', 'resolved', 3);
    stories = openStory(stories, { id: 'story:fair', key: 'fair', source: 'evt:fair', chain: ['announced'], day: 3, cap: 12 });
    const ranked = editionCandidates(stories, ambient().outlets[0]!, 3, createPrng('rank'), [], {});
    expect(ranked.map((item) => item.rank)).toEqual(['development', 'first', 'filler']);
  });

  it('accepts the resolved beat of a catalogue story', () => {
    const opened = stepNews(
      world(
        {},
        { inbox: [{ op: 'news-development', story: 'curfew', beat: 'announced' }] },
      ),
    );
    expect(opened.ambient?.stories['story:curfew']?.chain).toEqual(['announced', 'resolved']);
    const ambientState = opened.ambient;
    const developed = stepNews({
      ...opened,
      time: { day: 1, phase: 1 },
      ambient: {
        ...ambientState,
        inbox: [{ op: 'news-development', story: 'curfew', beat: 'resolved' }],
      },
    } as WorldState);
    expect(developed.ambient?.stories['story:curfew']?.beats.map((beat) => beat.beat)).toEqual([
      'announced',
      'resolved',
    ]);
  });

  it('posts a notice and names it on arrival until it is read or expires', () => {
    const posted = postNotice(world(), {
      template: 'curfew-order',
      title: 'Curfew order',
      body: 'The streets close at night.',
      locs: [CAFE],
      day: 0,
      days: 2,
    });
    expect(noticeLines(posted, CAFE)).toEqual(['A notice is posted here: Curfew order.']);
    const doc = Object.values(posted.documents)[0];
    expect(doc?.kind).toBe('notice');
    expect(doc?.obtainableAt).toEqual([CAFE]);
    const read = {
      ...posted,
      player: { ...posted.player, readDocuments: doc === undefined ? [] : [doc.id] },
    } as WorldState;
    expect(noticeLines(read, CAFE)).toEqual([]);
    const later = { ...posted, time: { day: 2, phase: 1 } } as WorldState;
    expect(noticeStillPosted(later, doc!.id)).toBe(false);
  });

  it('keeps at most 12 active stories', () => {
    let stories: Record<string, StoryState> = {};
    for (let i = 0; i < 13; i += 1) {
      stories = openStory(stories, {
        id: `story:${i}`,
        key: 'city',
        source: `evt:${i}`,
        chain: ['announced'],
        day: 0,
        cap: 12,
      });
    }
    expect(Object.values(stories).filter((story) => story.status === 'active')).toHaveLength(12);
  });
});

describe('Property 18: News continuity', () => {
  // Feature: ambient-world, Property 18: News continuity
  it('prints beats in cause order and records every distorted assert', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.stringMatching(/^[a-z]{1,6}$/), { minLength: 2, maxLength: 4 }),
        (chain) => {
          let stories = openStory(
            {},
            { id: 'story:piece', key: 'piece', source: 'evt:piece', chain, day: 1, cap: 12 },
          );
          const illegal = chain.length > 2 ? (chain[chain.length - 1] ?? 'nope') : 'nope';
          const skipped = addDevelopment(stories, 'story:piece', illegal, 1);
          expect(skipped['story:piece']?.beats).toHaveLength(1);
          for (let i = 1; i < chain.length; i += 1) {
            stories = addDevelopment(stories, 'story:piece', chain[i] ?? '', 1 + i);
          }
          const story = stories['story:piece'];
          expect(story?.beats.map((beat) => beat.beat)).toEqual([...chain]);
          const lines = story === undefined ? [] : printedArticles(story);
          expect(lines[0]).toBe(chain[0]);
          for (let i = 1; i < lines.length; i += 1) {
            expect(lines[i]).toContain(chain[i - 1]);
          }
          const records: Record<string, { holds: boolean; distorted: boolean }> = {};
          const items = editionCandidates(
            stories,
            { id: 'tagblatt', name: 'Tagblatt', slant: 'opposition', distortion: 1 },
            chain.length,
            createPrng('slant'),
            ['npc:ada' as NpcId, 'npc:bo' as NpcId],
            records,
          );
          for (const item of items) {
            for (const fact of item.asserts) {
              if (fact.id.endsWith('~distort')) {
                expect(records[fact.id]).toEqual({ holds: false, distorted: true });
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('cover duties', () => {
  it('draws two to four duties at the start of a week', () => {
    const next = stepCover(world());
    expect(next.ambient?.duties.length).toBeGreaterThanOrEqual(2);
    expect(next.ambient?.duties.length).toBeLessThanOrEqual(4);
  });

  it('keeps a cover duty at the quietest fitting place in the player district', () => {
    const start = world({
      player: {
        loc: 'loc:desk' as LocId,
        coverSuspicion: asTruth(0.2),
        cover: { id: 'clerk', fitLocationTypes: ['office', 'cafe'] },
        readDocuments: [],
      },
      city: {
        locations: {
          'loc:far-cafe': { id: 'loc:far-cafe', type: 'cafe', name: 'Far', risk: 0.1, district: 'north' },
          'loc:desk': { id: 'loc:desk', type: 'office', name: 'Desk', risk: 0.4, district: 'south' },
          'loc:quiet': { id: 'loc:quiet', type: 'office', name: 'Quiet', risk: 0.05, district: 'south' },
        },
      },
    });
    const duties = stepCover(start).ambient?.duties ?? [];
    expect(duties.length).toBeGreaterThan(0);
    for (const duty of duties) {
      expect(duty.loc).toBe('loc:quiet');
    }
  });

  it('does not move an attendee off an anchor slot', () => {
    const anchors: string[] = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      anchors.push(`npc:ada|${weekday}|1|${CAFE}`, `npc:ada|${weekday}|2|${CAFE}`);
    }
    const start = world(
      { npcs: { 'npc:ada': { id: 'npc:ada', role: 'civilian' } } as unknown as WorldState['npcs'] },
      { gate: { solvable: [], anchors, slowRunsToday: 0 } },
    );
    const next = stepCover(start);
    expect(next.ambient?.life['npc:ada' as NpcId]).toBeUndefined();
    expect(keepsAnchor(anchors, 'npc:ada', 0, 1)).toBe(true);
  });

  it('raises standing and lowers suspicion when the player attends', () => {
    const duty = {
      id: 'duty:office-hours:0:1',
      template: 'office-hours',
      loc: CAFE,
      slot: { day: 0, phase: 1 as const },
      phases: 1 as const,
      mandatory: true,
      standingGain: 0.05,
      suspicionDelta: 0.02,
      attendees: ['npc:ada' as NpcId],
      status: 'pending' as const,
    };
    const start = world({}, { duties: [duty] });
    expect(quoteAttendDuty(start, duty.id).allowed).toBe(true);
    const attended = resolveAttendDuty(start, duty.id);
    expect(revealTruth(attended.next.ambient!.coverStanding)).toBeCloseTo(0.55);
    expect(revealTruth(attended.next.player.coverSuspicion)).toBeCloseTo(0.18);
    expect(attended.lines[0]).toContain('npc:ada');
    expect(attended.next.ambient?.duties[0]?.status).toBe('attended');
  });

  it('misses a mandatory duty, writes the employer message, and alerts the phase before', () => {
    const duty = {
      id: 'duty:office-hours:0:1',
      template: 'office-hours',
      loc: CAFE,
      slot: { day: 0, phase: 1 as const },
      phases: 1 as const,
      mandatory: true,
      standingGain: 0.05,
      suspicionDelta: 0.02,
      attendees: [],
      status: 'pending' as const,
    };
    const due = settleDuties(world({ time: { day: 0, phase: 0 } }, { duties: [duty] }));
    expect(due.ambient?.dutyAlerts?.some((alert) => alert.kind === 'due')).toBe(true);
    const grace = settleDuties(world({ time: { day: 0, phase: 2 } }, { duties: [duty] }));
    expect(grace.ambient?.duties[0]?.status).toBe('pending');
    const missed = settleDuties(world({ time: { day: 0, phase: 3 } }, { duties: [duty] }));
    expect(missed.ambient?.duties[0]?.status).toBe('missed');
    expect(revealTruth(missed.ambient!.coverStanding)).toBeCloseTo(0.45);
    expect(revealTruth(missed.player.coverSuspicion)).toBeCloseTo(0.22);
    expect(missed.ambient?.coverMessages?.[0]?.text).toContain('office-hours');
    expect(missed.ambient?.dutyAlerts?.some((alert) => alert.kind === 'missed')).toBe(true);
  });

  it('multiplies a high-risk suspicion rise while standing is low', () => {
    expect(scaleHighRiskSuspicion(0.4, 0.8, 0.2)).toBeCloseTo(0.6);
    expect(scaleHighRiskSuspicion(0.4, 0.8, 0.5)).toBe(0.4);
    expect(scaleHighRiskSuspicion(0.4, 0.8, undefined)).toBe(0.4);
  });
});

function keepsSolvable(next: readonly string[] | undefined, prior: readonly string[]): boolean {
  const have = new Set(next ?? []);
  return prior.every((id) => have.has(id));
}

describe('Property 19: Emergent thread soundness', () => {
  // Feature: ambient-world, Property 19: Emergent thread soundness
  it('spawns only non-cell participants and leaves a rejected spawn unchanged', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.uniqueArray(fc.stringMatching(/^[a-z]{1,4}$/), { minLength: 0, maxLength: 4 }),
        fc.integer({ min: 1, max: 3 }),
        (seed, solvable, civilians) => {
          const good = threadTemplate();
          const bad = threadTemplate({
            id: 'stuck',
            params: { venue: { kind: 'loc', query: ['function:missing'], mandatory: true } },
          });
          const meta = { seed: String(seed), preset: { id: 'standard' } };
          const gate = { solvable, anchors: [], slowRunsToday: 0 };
          const cellOnly = world(
            {
              meta,
              npcs: { 'npc:mole': { id: 'npc:mole', role: 'cell' } } as unknown as WorldState['npcs'],
            },
            { gate },
          );
          expect(stepThreads(cellOnly, catalogue(good, () => ['npc:mole']))).toBe(cellOnly);

          const people: Record<string, { id: string; role: string }> = {
            'npc:mole': { id: 'npc:mole', role: 'cell-leader' },
          };
          for (let i = 0; i < civilians; i += 1) {
            const id = `npc:c${i}`;
            people[id] = { id, role: 'civilian' };
          }
          const npcs = people as unknown as WorldState['npcs'];
          const unbindable = world({ meta, npcs }, { gate });
          const dropped = stepThreads(unbindable, catalogue(bad, () => []));
          expect(dropped).toBe(unbindable);
          expect(keepsSolvable(dropped.ambient?.gate.solvable, solvable)).toBe(true);

          const start = world({ meta, npcs }, { gate });
          const spawned = stepThreads(start, catalogue(good, () => ['npc:c0']));
          expect(spawned).not.toBe(start);
          expect(keepsSolvable(spawned.ambient?.gate.solvable, solvable)).toBe(true);
          const thread = spawned.sideThreads?.[0];
          expect(thread?.origin).toBe('emergent');
          expect(thread?.participants).not.toContain('npc:mole');
          for (const id of thread?.participants ?? []) {
            expect(start.npcs[id as NpcId]?.role.startsWith('cell')).toBe(false);
          }
          expect(stepThreads(spawned, catalogue(good, () => ['npc:c0']))).toBe(spawned);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Property 10: Solvability monotonicity and anchor protection', () => {
  // Feature: ambient-world, Property 10: Solvability monotonicity and anchor protection
  it('keeps the solvable set across accepted changes and refuses a shrinking one', () => {
    const result: VerifierResult = {
      solvable: new Set(['prop:meets']),
      witnesses: new Map([
        [
          'prop:meets',
          [
            { edge: 'meeting', node: 'npc:clerk' },
            { edge: 'surveillance', node: 'loc:cafe' },
          ],
        ],
      ]),
    };
    const quiet = { npcs: {}, plot: { stages: [] } };
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            kind: fc.constantFrom('route', 'detain', 'override'),
            loc: fc.stringMatching(/^loc:[a-z]{1,4}$/),
            npc: fc.constantFrom('npc:clerk', 'npc:ada', 'npc:bo'),
            shrink: fc.boolean(),
          }),
          { minLength: 1, maxLength: 5 },
        ),
        fc.integer({ min: 0, max: 6 }),
        fc.constantFrom(0, 1, 2, 3),
        (changes, weekday, phase) => {
          let current: GateCache = {
            result,
            anchors: new Set([anchorKey('npc:clerk', weekday, phase, 'loc:cafe')]),
            slowRunsToday: 0,
          };
          for (const item of changes) {
            const change: StructuralChange =
              item.kind === 'route'
                ? { kind: 'route-closure', a: item.loc, b: 'loc:zz' }
                : item.kind === 'detain'
                  ? { kind: 'detain-npc', npc: item.npc }
                  : { kind: 'schedule-override', npc: item.npc, phases: [phase], loc: item.loc };
            const before = new Set(current.result.solvable);
            const honest: VerifierResult = { solvable: new Set(before), witnesses: result.witnesses };
            const decision = gate({
              change,
              cache: current,
              slowCap: 6,
              world: quiet,
              verify: () =>
                item.shrink ? { solvable: new Set<string>(), witnesses: new Map() } : honest,
            });
            if (decision.decision === 'accept') {
              for (const id of before) {
                expect(decision.cache.result.solvable.has(id)).toBe(true);
              }
              if (decision.via === 'fast') {
                for (const id of before) {
                  expect(honest.solvable.has(id)).toBe(true);
                }
              }
            } else {
              for (const id of before) {
                expect(decision.cache.result.solvable.has(id)).toBe(true);
              }
            }
            current = decision.cache;
          }
          const anchor = anchorKey('npc:clerk', weekday, phase, 'loc:cafe');
          const entries = [];
          for (let day = 0; day < 7; day += 1) {
            for (let slot = 0; slot < 4; slot += 1) {
              entries.push({ weekday: day, phase: slot as 0 | 1 | 2 | 3, loc: 'loc:cafe' as LocId });
            }
          }
          const agenda = dailyAgenda(
            { id: 'npc:clerk', schedule: { entries } },
            {
              ...emptyLife(),
              deviations: [
                { untilDay: 99, weekday, phase: phase as 0 | 1 | 2 | 3, loc: 'loc:other' as LocId },
              ],
            },
            {},
            new Set([anchor]),
            weekday,
          );
          const kept = agenda.find((entry) => entry.weekday === weekday && entry.phase === phase);
          expect(kept?.loc).toBe('loc:cafe');
          expect(keepsAnchor([anchor], 'npc:clerk', weekday, phase)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('stepNews', () => {
  it('leaves a world without ambient untouched', () => {
    const quiet = { time: { day: 1, phase: 0 } } as WorldState;
    expect(stepNews(quiet)).toBe(quiet);
  });
});

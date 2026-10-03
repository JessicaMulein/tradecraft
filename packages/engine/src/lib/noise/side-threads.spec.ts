/**
 * Tests for Side Thread generation (task 6.2; Requirement 29.2; design, "Noise
 * Generator", step 2).
 *
 * These load the real core pack, its `city.yaml` and `descriptors.yaml`,
 * generate a city, the three orgs and the Principal NPCs on a core stream, then
 * run the Background-NPC generator (task 6.1) and the Side Thread generator on
 * an independent noise stream (`derive(seed, 0x10000)`) and check the invariants
 * the design and the requirement fix:
 *
 * - the generator produces exactly the requested count of Side Threads, each
 *   instantiated from a Side Thread template (Requirement 29.2);
 * - NO Cell member and NO hostile officer ever appears as a participant — only
 *   Background NPCs or non-Cell Principal NPCs do (design, step 2);
 * - each thread carries non-empty true Propositions, non-empty traces and at
 *   least one Channel (when the city and roster allow);
 * - every trace Location is a *public* Location of the generated city;
 * - ids (thread ids and channel ids) are unique and cannot collide with core
 *   entity/channel ids; and
 * - determinism: the same noise seed, city, roster and content produce an
 *   identical result (Requirement 29.5, underpinning Property 1).
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
} from '@tradecraft/content';

import { createPrng, derive } from '../prng/prng.js';
import { type GameTime, type NpcId } from '../model/core.js';
import { generateCity } from '../city/generate.js';
import { type City } from '../city/city.js';
import { type Npc } from '../city/npc.js';
import {
  generateOrgs,
  generatePrincipals,
  type GeneratedOrgs,
  type GeneratedPrincipals,
} from '../city/principals.js';
import { isWellFormedSchedule } from '../city/comms.js';
import { generateBackgroundNpcs } from './background.js';
import {
  DEFAULT_SIDE_THREADS,
  MAX_THREAD_PARTICIPANTS,
  MIN_THREAD_PARTICIPANTS,
  THREAD_ID_PREFIX,
  generateSideThreads,
  isSideThreadEligible,
  sideThreadParticipantPool,
  sideThreadTemplates,
  threadHasNoCellOrHostile,
  type GeneratedSideThreads,
} from './side-threads.js';

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

/** The noise stream base offset (design PRNG stream registry). */
const NOISE_STREAM_BASE = 0x10000;
/** The game start time generation uses as the schedule/window floor. */
const START: GameTime = { day: 0, phase: 0 };
/** How many Background NPCs to seed the participant pool with. */
const BACKGROUND_COUNT = 10;

interface Core {
  readonly city: City;
  readonly orgs: GeneratedOrgs;
  readonly principals: GeneratedPrincipals;
  readonly background: Readonly<Record<NpcId, Npc>>;
}

/** Build the core world and the Background NPCs for a seed. */
function world(seed: string): Core {
  const prng = createPrng(seed);
  const { city } = generateCity(prng, locationTypes, cityData);
  const orgs = generateOrgs(prng);
  const principals = generatePrincipals(prng, content, descriptors, city, orgs);
  const noise = createPrng(derive(seed, NOISE_STREAM_BASE));
  const bg = generateBackgroundNpcs(noise, content, descriptors, city, orgs, BACKGROUND_COUNT);
  return { city, orgs, principals, background: bg.npcs };
}

/**
 * Run Side Thread generation on a *fresh* noise stream for a seed and count.
 * (The Background NPCs are regenerated on their own fresh noise stream inside
 * `world`, so Side Thread draws start from a clean, repeatable stream.)
 */
function genThreads(seed: string, count: number): { c: Core; st: GeneratedSideThreads } {
  const c = world(seed);
  const noise = createPrng(derive(seed, NOISE_STREAM_BASE));
  const st = generateSideThreads(
    noise,
    content,
    c.city,
    c.principals,
    c.background,
    count,
    START,
  );
  return { c, st };
}

/** The set of public Location ids in a city. */
function publicLocIds(city: City): Set<string> {
  return new Set(
    Object.values(city.locations)
      .filter((l) => l.public)
      .map((l) => l.id),
  );
}

describe('sideThreadTemplates', () => {
  it('returns the content set side-thread templates, id-sorted', () => {
    const list = sideThreadTemplates(content);
    expect(list.length).toBeGreaterThanOrEqual(2); // Req 31.7
    const ids = list.map((t) => t.id);
    expect([...ids].sort()).toEqual(ids);
    // No template names a Cell role (the loader enforces this; re-assert).
    for (const t of list) {
      for (const slot of t.roleSlots) {
        expect(slot.id.includes('cell')).toBe(false);
      }
    }
  });
});

describe('sideThreadParticipantPool / isSideThreadEligible (Req 29.2)', () => {
  it('excludes every Cell member and hostile officer, includes civilians/contacts', () => {
    const c = world('pool-seed');
    const pool = sideThreadParticipantPool(c.principals, c.background);
    const forbidden = new Set<NpcId>([...c.principals.cell, ...c.principals.hostile]);
    expect(pool.length).toBeGreaterThan(0);
    const ids = pool.map((n) => n.id);
    // id-sorted and unique.
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
    for (const npc of pool) {
      expect(forbidden.has(npc.id)).toBe(false);
      expect(isSideThreadEligible(npc)).toBe(true);
      expect(npc.role).not.toBe('cell');
      expect(npc.role).not.toBe('hostile-officer');
    }
    // Every Cell/hostile NPC is rejected by the predicate.
    for (const id of forbidden) {
      const npc = c.principals.npcs[id];
      expect(isSideThreadEligible(npc)).toBe(false);
    }
    // Every Background NPC is eligible.
    for (const npc of Object.values(c.background)) {
      expect(isSideThreadEligible(npc)).toBe(true);
    }
  });
});

describe('generateSideThreads — count and provenance (Req 29.2)', () => {
  it('produces exactly the requested count, each from a side-thread template', () => {
    const templateIds = new Set(sideThreadTemplates(content).map((t) => t.id));
    for (const count of [0, 1, 2, 3, 5]) {
      const { st } = genThreads('count-seed', count);
      expect(st.sideThreads.length).toBe(count);
      for (const thread of st.sideThreads) {
        expect(templateIds.has(thread.template)).toBe(true);
      }
    }
  });

  it('rejects a negative or non-integer count', () => {
    const c = world('reject-seed');
    const noise = createPrng(derive('reject-seed', NOISE_STREAM_BASE));
    expect(() =>
      generateSideThreads(noise, content, c.city, c.principals, c.background, -1, START),
    ).toThrow();
    expect(() =>
      generateSideThreads(noise, content, c.city, c.principals, c.background, 2.5, START),
    ).toThrow();
  });
});

describe('generateSideThreads — no Cell or hostile participants (Req 29.2)', () => {
  it('never seats a Cell member or hostile officer in any thread', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.integer({ min: 1, max: 6 }),
        (seed, count) => {
          const { c, st } = genThreads(seed, count);
          const forbidden = new Set<NpcId>([
            ...c.principals.cell,
            ...c.principals.hostile,
          ]);
          const pool = new Set(
            sideThreadParticipantPool(c.principals, c.background).map((n) => n.id),
          );
          for (const thread of st.sideThreads) {
            expect(threadHasNoCellOrHostile(thread, c.principals)).toBe(true);
            // Cast is distinct and within the drawn size band (clamped to pool).
            expect(new Set(thread.participants).size).toBe(thread.participants.length);
            if (pool.size >= MIN_THREAD_PARTICIPANTS) {
              expect(thread.participants.length).toBeGreaterThanOrEqual(
                MIN_THREAD_PARTICIPANTS,
              );
            }
            expect(thread.participants.length).toBeLessThanOrEqual(
              MAX_THREAD_PARTICIPANTS,
            );
            for (const p of thread.participants) {
              expect(forbidden.has(p)).toBe(false);
              // Every participant is a real eligible NPC in the pool.
              expect(pool.has(p)).toBe(true);
            }
          }
        },
      ),
      { numRuns: 40 },
    );
  });
});

describe('generateSideThreads — propositions, traces and channels (Req 29.2)', () => {
  it('gives each thread non-empty true propositions, traces and at least one channel', () => {
    const { c, st } = genThreads('content-seed', DEFAULT_SIDE_THREADS);
    const publics = publicLocIds(c.city);
    const castPool = new Set(
      sideThreadParticipantPool(c.principals, c.background).map((n) => n.id),
    );
    expect(st.sideThreads.length).toBe(DEFAULT_SIDE_THREADS);

    for (const thread of st.sideThreads) {
      // With a non-empty cast and a public city, the thread is substantive.
      expect(thread.participants.length).toBeGreaterThan(0);
      expect(thread.traces.length).toBeGreaterThan(0);
      expect(thread.propositions.length).toBeGreaterThan(0);
      expect(thread.channels.length).toBeGreaterThanOrEqual(1);

      // Every trace sits at a public Location and names only cast participants.
      for (const trace of thread.traces) {
        expect(c.city.locations[trace.loc]).toBeDefined();
        expect(publics.has(trace.loc)).toBe(true);
        expect(trace.participants.length).toBeGreaterThan(0);
        for (const p of trace.participants) {
          expect(thread.participants).toContain(p);
        }
      }

      // Every proposition is a true city/local fact over the Predicate
      // Vocabulary, naming only cast members and public Locations — never an
      // org, a Cell/hostile actor or a non-public Location.
      for (const p of thread.propositions) {
        expect(['LOCATED_AT', 'MEETS_AT']).toContain(p.predicate);
        expect(castPool.has(p.subject as NpcId)).toBe(true);
        if (typeof p.object === 'string') {
          expect(castPool.has(p.object as NpcId)).toBe(true);
        }
        if (p.place !== undefined) {
          expect(publics.has(p.place)).toBe(true);
        }
        // MEETS_AT requires a place and a well-formed window (vocabulary).
        if (p.predicate === 'MEETS_AT') {
          expect(p.place).toBeDefined();
          expect(p.window).toBeDefined();
        }
      }

      // The channel is owned by a thread participant (noise traffic), never the
      // Cell/Station/Hostile, has a well-formed schedule, and is not a dead
      // drop (operational tradecraft, not civilian chatter).
      for (const channel of thread.channels) {
        expect(thread.participants).toContain(channel.owner as NpcId);
        expect(channel.kind).not.toBe('dead-drop');
        expect(isWellFormedSchedule(channel.schedule)).toBe(true);
        if (channel.kind === 'courier' && channel.route !== undefined) {
          expect(publics.has(channel.route)).toBe(true);
        }
      }
    }
  });
});

describe('generateSideThreads — ids are unique and non-colliding (Req 29.2)', () => {
  it('mints distinct thread ids and channel ids that cannot clash with core ids', () => {
    const { st } = genThreads('id-seed', 5);

    // Thread ids: distinct, in the thread: namespace.
    const threadIds = st.sideThreads.map((t) => t.id);
    expect(new Set(threadIds).size).toBe(threadIds.length);
    for (const id of threadIds) {
      expect(id.startsWith(`${THREAD_ID_PREFIX}:`)).toBe(true);
    }

    // Channel ids: distinct across threads, namespaced under chan:thread/ so
    // they never collide with a core comms channel (chan:<owner>/<tag>).
    const channelIds = Object.keys(st.channels);
    const fromThreads = st.sideThreads.flatMap((t) => t.channels.map((c) => c.id));
    expect(new Set(channelIds).size).toBe(channelIds.length);
    expect(new Set(fromThreads).size).toBe(fromThreads.length);
    expect(new Set(channelIds)).toEqual(new Set(fromThreads));
    for (const id of channelIds) {
      expect(id.startsWith('chan:thread/')).toBe(true);
    }

    // Proposition ids are distinct across all threads.
    const propIds = st.sideThreads.flatMap((t) => t.propositions.map((p) => p.id));
    expect(new Set(propIds).size).toBe(propIds.length);
  });
});

describe('generateSideThreads — determinism (Req 29.5, Property 1)', () => {
  it('produces an identical result for the same noise seed, city, roster and content', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.integer({ min: 0, max: 6 }),
        (seed, count) => {
          const a = genThreads(seed, count);
          const b = genThreads(seed, count);
          expect(JSON.stringify(b.st)).toBe(JSON.stringify(a.st));
        },
      ),
      { numRuns: 25 },
    );
  });

  it('guards numeric arbitraries so a count never degenerates', () => {
    // A property that exercises the generator against a bounded, finite count
    // derived from a guarded double, per the fast-check guidance.
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 10 }),
        fc.double({ min: 0, max: 6, noNaN: true, noDefaultInfinity: true }),
        (seed, raw) => {
          const count = Math.floor(raw);
          const { st } = genThreads(seed, count);
          expect(st.sideThreads.length).toBe(count);
        },
      ),
      { numRuns: 20 },
    );
  });
});

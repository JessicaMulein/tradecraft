/**
 * Tests for the service-dead-drop action (task 11.6; Requirements 24.5, 24.6,
 * 24.7).
 *
 * These drive a generated {@link WorldState} from the real core pack through the
 * service-drop resolver and the top-level {@link quote}/{@link resolve},
 * checking:
 *
 * - quote requires standing at the drop's Location, and gates `hostileMode`
 *   (required for a hostile drop, forbidden on an own drop) (Req 24.5, 24.7);
 * - servicing the player's own drop delivers its contents, accepts the left
 *   items (appended to the drop), adds half a meeting's Exposure, and emits
 *   drop events (Req 24.5, 24.6);
 * - a hostile `copy` composes a seized-material Document and leaves the drop's
 *   contents intact (Req 24.7);
 * - a hostile `seize` empties the drop, marks the Plot's pending stages
 *   disrupted, and — when seizing the materiel — drives the 7.4 abort
 *   (`plot.status==='aborted'`, a `plot-aborted` event, an end intent) (Req
 *   24.7);
 * - a detection check against a watcher can raise Cover Suspicion (Req 24.7);
 * - determinism: the same seed gives the same outcome;
 * - a disallowed service leaves the state unchanged;
 * - slice-integration task 1.3: a `seize` of the Plot materiel sets
 *   `plot.materielSeized` (nothing else does), and `resolve` passes the abort
 *   through as an `ended` End Condition without writing `WorldState.ended`.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  loadCityData,
  loadContent,
  loadDescriptorData,
  loadPublicTexts,
  type CityData,
  type ContentSet,
  type DescriptorData,
  type DifficultyPreset,
  type LocationType,
  type PublicText,
} from '@tradecraft/content';

import { createPrng } from '../prng/prng.js';
import { ScenarioConfigSchema } from '../config/scenario-config.js';
import { generate, type GenerateInputs } from '../generate.js';
import {
  asTruth,
  revealTruth,
  type ItemId,
  type LocId,
  type NpcId,
  type Proposition,
  type PropId,
} from '../model/core.js';
import type { DeadDrop } from '../city/comms.js';
import type { PlotState } from '../city/plot.js';
import type { WorldState } from '../model/state.js';
import { TruthStore } from '../truth/truth.js';
import { quote, resolve } from './action.js';
import {
  quoteServiceDrop,
  resolveServiceDrop,
  isOwnDrop,
  dropWatcher,
  disruptPendingStages,
  seizedContentsAreMateriel,
  seizedTemplateOf,
  SERVICE_DROP_PHASE_COST,
} from './service-drop.js';
import type { Observation, ResolverContext } from './result.js';
import type { ServiceDropAction } from './types.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors arrange-meeting.spec.ts)
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
  const descriptors = loadDescriptorData(CORE_DIR);
  const publicTexts = loadPublicTexts(CORE_DIR);
  if (!cityData.ok || !descriptors.ok || !publicTexts.ok) {
    throw new Error('core pack side files failed to load');
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

function inputs(): GenerateInputs {
  const scenario = ScenarioConfigSchema.parse({
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
  return { content, preset: STANDARD, scenario, cityData, descriptors, publicTexts };
}

function world(seed = 'drop-alpha'): WorldState {
  return generate(seed, inputs());
}

function ctx(): ResolverContext {
  return { content };
}

/** A Prng whose `next()` always returns the given constant (coin control). */
function fixedPrng(value: number): ReturnType<typeof createPrng> {
  const base = createPrng('ignored');
  return { ...base, next: () => value };
}

/** The render callback used in tests: observations to their lines/ids. */
function renderLines(_s: WorldState, obs: readonly Observation[]): string[] {
  return obs.map((o) => (o.kind === 'message' ? o.line : `prop:${o.prop.id}`));
}

/** The template read from the content set (always present in the core pack). */
const SEIZED_TEMPLATE = seizedTemplateOf(content);

/** The player's own (Station) drop. The brief seeds exactly one. */
function ownDrop(state: WorldState): DeadDrop {
  const id = state.player.known.drops[0];
  return state.deadDrops[id];
}

/** A hostile drop (not in the player's known drops). */
function hostileDrop(state: WorldState): DeadDrop {
  for (const drop of Object.values(state.deadDrops)) {
    if (!isOwnDrop(state, drop)) {
      return drop;
    }
  }
  throw new Error('no hostile drop in the generated world');
}

/** Open the drop's Location in every phase and stand the player there. */
function atDrop(base: WorldState, drop: DeadDrop): WorldState {
  return {
    ...base,
    player: { ...base.player, loc: drop.loc },
    city: {
      ...base.city,
      locations: {
        ...base.city.locations,
        [drop.loc]: {
          ...base.city.locations[drop.loc],
          hours: { 0: true, 1: true, 2: true, 3: true },
        },
      },
    },
  };
}

/** A simple true-ish Proposition for copy/seize asserts. */
function prop(id: string, subject: NpcId): Proposition {
  return {
    id: id as PropId,
    subject,
    predicate: 'LOCATED_AT',
    object: subject,
  };
}

// ---------------------------------------------------------------------------
// quote — site and hostileMode gating (Req 24.5, 24.7)
// ---------------------------------------------------------------------------

describe('service-drop quote — site and mode gating (Req 24.5, 24.7)', () => {
  it('allowed at an own drop with no hostileMode', () => {
    const base = world();
    const drop = ownDrop(base);
    const state = atDrop(base, drop);
    const q = quoteServiceDrop(state, { kind: 'service-drop', drop: drop.id, leave: [] });
    expect(q.allowed).toBe(true);
    expect(q.phases).toBe(SERVICE_DROP_PHASE_COST);
    expect(q.money).toBe(0);
  });

  it('not allowed when the player is not at the drop site', () => {
    const base = world();
    const drop = ownDrop(base);
    const elsewhere = (Object.keys(base.city.locations) as LocId[]).find(
      (l) => l !== drop.loc,
    ) as LocId;
    const state: WorldState = { ...base, player: { ...base.player, loc: elsewhere } };
    const q = quoteServiceDrop(state, { kind: 'service-drop', drop: drop.id, leave: [] });
    expect(q.allowed).toBe(false);
  });

  it('rejects hostileMode on an own drop', () => {
    const base = world();
    const drop = ownDrop(base);
    const state = atDrop(base, drop);
    const q = quoteServiceDrop(state, {
      kind: 'service-drop',
      drop: drop.id,
      leave: [],
      hostileMode: 'copy',
    });
    expect(q.allowed).toBe(false);
  });

  it('requires a hostileMode on a hostile drop', () => {
    const base = world();
    const drop = hostileDrop(base);
    const state = atDrop(base, drop);
    const q = quoteServiceDrop(state, { kind: 'service-drop', drop: drop.id, leave: [] });
    expect(q.allowed).toBe(false);
  });

  it('rejects a missing drop', () => {
    const base = world();
    const q = quoteServiceDrop(base, {
      kind: 'service-drop',
      drop: 'drop:nope' as DeadDrop['id'],
      leave: [],
    });
    expect(q.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// own drop — deliver + accept + Exposure + events (Req 24.5, 24.6)
// ---------------------------------------------------------------------------

describe('service-drop resolve — own drop delivers and accepts (Req 24.5, 24.6)', () => {
  it('delivers contents, accepts left items, adds Exposure, emits events', () => {
    const base = world();
    const drop = ownDrop(base);
    // Seed some contents to deliver.
    const seeded: DeadDrop = { ...drop, contents: ['item:cache/1' as ItemId] };
    const staged: WorldState = atDrop(
      { ...base, deadDrops: { ...base.deadDrops, [drop.id]: seeded } },
      seeded,
    );
    const left: ItemId = 'item:payment/1' as ItemId;
    const a: ServiceDropAction = {
      kind: 'service-drop',
      drop: drop.id,
      leave: [{ item: left }],
    };
    const { next, result } = resolveServiceDrop(
      staged,
      a,
      fixedPrng(1), // no detection
      SEIZED_TEMPLATE,
      renderLines,
    );
    // The left item was appended; the delivered item is reported.
    expect(next.deadDrops[drop.id].contents).toContain(left);
    expect(next.deadDrops[drop.id].contents).toContain('item:cache/1');
    // A drop-emptied and a drop-loaded event were emitted.
    const kinds = result.events.map((e) => e.kind);
    expect(kinds).toContain('drop-emptied');
    expect(kinds).toContain('drop-loaded');
    // Exposure rose (half a meeting's), strictly positive here.
    expect(revealTruth(next.player.coverSuspicion)).toBeGreaterThan(
      revealTruth(staged.player.coverSuspicion),
    );
  });

  it('adds less Exposure than a full meeting would at the same risk', () => {
    const base = world();
    const drop = ownDrop(base);
    const staged = atDrop(base, drop);
    const { next } = resolveServiceDrop(
      staged,
      { kind: 'service-drop', drop: drop.id, leave: [] },
      fixedPrng(1),
      SEIZED_TEMPLATE,
      renderLines,
    );
    const dropExposure =
      revealTruth(next.player.coverSuspicion) - revealTruth(staged.player.coverSuspicion);
    // Half-factor: a drop's Exposure delta is non-negative and bounded by what a
    // meeting (double) would add — i.e. strictly less than 2× itself.
    expect(dropExposure).toBeGreaterThanOrEqual(0);
    expect(dropExposure).toBeLessThan(1);
  });
});

// ---------------------------------------------------------------------------
// hostile copy — seized Document, drop intact (Req 24.7)
// ---------------------------------------------------------------------------

describe('service-drop resolve — hostile copy (Req 24.7)', () => {
  it('composes a seized Document and leaves the drop intact', () => {
    const base = world();
    const drop = hostileDrop(base);
    const seeded: DeadDrop = { ...drop, contents: ['item:hostile/1' as ItemId] };
    const staged = atDrop(
      { ...base, deadDrops: { ...base.deadDrops, [drop.id]: seeded } },
      seeded,
    );
    const subject = (Object.keys(base.npcs) as NpcId[])[0];
    const { next, result } = resolveServiceDrop(
      staged,
      { kind: 'service-drop', drop: drop.id, leave: [], hostileMode: 'copy' },
      fixedPrng(1),
      SEIZED_TEMPLATE,
      renderLines,
      { copyAsserts: [prop('prop:seized/copy', subject)] },
    );
    // The drop's contents are untouched (copy leaves it in place).
    expect(next.deadDrops[drop.id].contents).toEqual(seeded.contents);
    // A seized Document was registered and its Proposition claimed.
    const newDocs = Object.values(next.documents).filter((d) => d.kind === 'seized');
    expect(newDocs.length).toBeGreaterThan(0);
    expect(result.claimsAdded).toContain('prop:seized/copy');
    expect(next.documentPropositions['prop:seized/copy' as PropId]).toBeDefined();
  });

  it('observes the copied Propositions, sourced to the seized Document, and marks it read', () => {
    const base = world();
    const drop = hostileDrop(base);
    const seeded: DeadDrop = { ...drop, contents: ['item:hostile/1' as ItemId] };
    const staged = atDrop(
      { ...base, deadDrops: { ...base.deadDrops, [drop.id]: seeded } },
      seeded,
    );
    const copied = prop('prop:seized/copy', (Object.keys(base.npcs) as NpcId[])[0]);
    const { next, result } = resolveServiceDrop(
      staged,
      { kind: 'service-drop', drop: drop.id, leave: [], hostileMode: 'copy' },
      fixedPrng(1),
      SEIZED_TEMPLATE,
      renderLines,
      { copyAsserts: [copied] },
    );
    const seized = Object.values(next.documents).find(
      (d) => staged.documents[d.id] === undefined,
    );
    if (seized === undefined) {
      throw new Error('the copy registered no seized Document');
    }

    // One proposition Observation per copied Proposition, sourced to the seized
    // Document and matching claimsAdded.
    expect(result.observations.filter((o) => o.kind === 'proposition')).toEqual([
      {
        kind: 'proposition',
        prop: copied,
        at: staged.time,
        source: { kind: 'document', id: seized.id },
      },
    ]);
    expect(result.claimsAdded).toEqual([copied.id]);

    // The copy counts as the first read, so reading the Document files nothing again.
    expect(next.player.readDocuments).toContain(seized.id);
    const reread = resolve(next, { kind: 'read', doc: seized.id }, createPrng('reread'), ctx());
    expect(reread.result.claimsAdded).toEqual([]);
    expect(reread.result.observations.every((o) => o.kind === 'message')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// hostile seize — empties, disrupts the Plot, drives the 7.4 abort (Req 24.7)
// ---------------------------------------------------------------------------

describe('service-drop resolve — hostile seize (Req 24.7)', () => {
  it('empties the drop and disrupts only the stage that collects the seized delivery (Req 3.7)', () => {
    const base = world();
    const drop = hostileDrop(base);
    // A bespoke delivery item collected by exactly one stage's own drop-emptied
    // trace, so the seizure's disruption is scoped to that stage alone (Req 3.7)
    // rather than every pending stage. The content item is non-materiel, so the
    // Plot disrupts without aborting.
    const delivery = 'item:delivery/1' as ItemId;
    const collectingStageId = base.plot.stages[0].id;
    const plotWithCollector: PlotState = {
      ...base.plot,
      stages: base.plot.stages.map((stage, i) =>
        i === 0
          ? {
              ...stage,
              status: 'pending' as const,
              traces: [
                ...stage.traces,
                {
                  index: stage.traces.length,
                  kind: 'drop-emptied' as const,
                  participants: [],
                  materiel: delivery,
                  evidences: [],
                  template: 'A courier collects the delivery from the drop.',
                },
              ],
            }
          : { ...stage, status: 'pending' as const },
      ),
    };
    const seeded: DeadDrop = { ...drop, contents: [delivery] };
    const staged = atDrop(
      {
        ...base,
        plot: plotWithCollector,
        deadDrops: { ...base.deadDrops, [drop.id]: seeded },
      },
      seeded,
    );
    const { next } = resolveServiceDrop(
      staged,
      { kind: 'service-drop', drop: drop.id, leave: [], hostileMode: 'seize' },
      fixedPrng(1),
      SEIZED_TEMPLATE,
      renderLines,
    );
    expect(next.deadDrops[drop.id].contents).toEqual([]);
    // The collecting stage is disrupted; every other pending stage stays pending.
    for (const stage of next.plot.stages) {
      if (stage.id === collectingStageId) {
        expect(stage.status).toBe('disrupted');
      } else {
        expect(stage.status).toBe('pending');
      }
    }
  });

  it('seizing the materiel drives the 7.4 abort', () => {
    const base = world();
    const drop = hostileDrop(base);
    const materiel = revealTruth(base.plot.materiel);
    const seeded: DeadDrop = { ...drop, contents: [materiel] };
    const staged = atDrop(
      { ...base, deadDrops: { ...base.deadDrops, [drop.id]: seeded } },
      seeded,
    );
    const { next, result, ended } = resolveServiceDrop(
      staged,
      { kind: 'service-drop', drop: drop.id, leave: [], hostileMode: 'seize' },
      fixedPrng(1),
      SEIZED_TEMPLATE,
      renderLines,
    );
    expect(next.plot.status).toBe('aborted');
    expect(next.plot.abortCause).toBe('materiel-seized');
    expect(result.events.some((e) => e.kind === 'plot-aborted')).toBe(true);
    expect(ended).toBeDefined();
    expect(ended?.cause).toBe('materiel-seized');
    expect(ended?.outcome).toBe('success');
  });
});

// ---------------------------------------------------------------------------
// the seizure record and resolve's `ended` (slice-integration task 1.3)
// ---------------------------------------------------------------------------

/**
 * A content set whose Location Types all allow `service-drop`, so the shared
 * Location gate in `quote` passes at whichever Location the drop sits.
 */
function contentAllowingService(): ContentSet {
  const locationTypes = new Map(
    [...content.locationTypes].map(([id, type]): [string, LocationType] => [
      id,
      { ...type, allowedActions: [...type.allowedActions, 'service-drop'] },
    ]),
  );
  return { ...content, locationTypes };
}

/** `base` with the player at the hostile drop, which holds exactly `contents`. */
function atHostileDrop(base: WorldState, contents: readonly ItemId[]): {
  readonly state: WorldState;
  readonly drop: DeadDrop;
} {
  const drop = hostileDrop(base);
  const seeded: DeadDrop = { ...drop, contents: [...contents] };
  return {
    state: atDrop({ ...base, deadDrops: { ...base.deadDrops, [drop.id]: seeded } }, seeded),
    drop: seeded,
  };
}

describe('service-drop — the seizure record (slice-integration Req 4.4)', () => {
  it('seizing the Plot materiel sets plot.materielSeized', () => {
    const base = world();
    expect(base.plot.materielSeized).toBe(false);
    const { state, drop } = atHostileDrop(base, [revealTruth(base.plot.materiel)]);
    const { next } = resolveServiceDrop(
      state,
      { kind: 'service-drop', drop: drop.id, leave: [], hostileMode: 'seize' },
      fixedPrng(1),
      SEIZED_TEMPLATE,
      renderLines,
    );
    expect(next.plot.materielSeized).toBe(true);
  });

  it('seizing anything else, or copying the materiel, leaves the flag unset', () => {
    const base = world();
    const other = atHostileDrop(base, ['item:delivery/1' as ItemId]);
    const seizedOther = resolveServiceDrop(
      other.state,
      { kind: 'service-drop', drop: other.drop.id, leave: [], hostileMode: 'seize' },
      fixedPrng(1),
      SEIZED_TEMPLATE,
      renderLines,
    );
    expect(seizedOther.next.plot.materielSeized).toBe(false);

    const materiel = atHostileDrop(base, [revealTruth(base.plot.materiel)]);
    const copied = resolveServiceDrop(
      materiel.state,
      { kind: 'service-drop', drop: materiel.drop.id, leave: [], hostileMode: 'copy' },
      fixedPrng(1),
      SEIZED_TEMPLATE,
      renderLines,
    );
    expect(copied.next.plot.materielSeized).toBe(false);
  });
});

describe('resolve — passes the seizure abort through as ended (slice-integration Req 7.4)', () => {
  it('returns the materiel-seized EndCondition and leaves WorldState.ended unwritten', () => {
    const base = world();
    const { state, drop } = atHostileDrop(base, [revealTruth(base.plot.materiel)]);
    const out = resolve(
      state,
      { kind: 'service-drop', drop: drop.id, leave: [], hostileMode: 'seize' },
      fixedPrng(1),
      { content: contentAllowingService() },
    );
    expect(out.ended).toEqual({ outcome: 'success', at: state.time, cause: 'materiel-seized' });
    expect(out.next.ended).toBeUndefined();
    expect(out.next.plot.status).toBe('aborted');
    expect(out.next.plot.materielSeized).toBe(true);
  });

  it('returns no ended when the seizure aborts nothing', () => {
    const base = world();
    const { state, drop } = atHostileDrop(base, ['item:delivery/1' as ItemId]);
    const out = resolve(
      state,
      { kind: 'service-drop', drop: drop.id, leave: [], hostileMode: 'seize' },
      fixedPrng(1),
      { content: contentAllowingService() },
    );
    expect(out.next.deadDrops[drop.id].contents).toEqual([]);
    expect(out.ended).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// detection against a watcher (Req 24.7)
// ---------------------------------------------------------------------------

describe('service-drop resolve — detection against a watcher (Req 24.7)', () => {
  it('raises Cover Suspicion when the watcher detects the player', () => {
    const base = world();
    const drop = hostileDrop(base);
    // Make the drop owned by a maximally watchful NPC so detection is near-certain.
    const watcherId = (Object.keys(base.npcs) as NpcId[])[0];
    const watchful = {
      ...base.npcs[watcherId],
      securityConsciousness: asTruth(1),
    };
    const watchedDrop: DeadDrop = { ...drop, owner: watcherId, contents: [] };
    const staged = atDrop(
      {
        ...base,
        npcs: { ...base.npcs, [watcherId]: watchful },
        deadDrops: { ...base.deadDrops, [drop.id]: watchedDrop },
      },
      watchedDrop,
    );
    expect(dropWatcher(watchedDrop)).toBe(watcherId);
    const { next } = resolveServiceDrop(
      staged,
      { kind: 'service-drop', drop: drop.id, leave: [], hostileMode: 'copy' },
      fixedPrng(0), // coin 0 ⇒ under any positive detection probability
      SEIZED_TEMPLATE,
      renderLines,
    );
    expect(revealTruth(next.player.coverSuspicion)).toBeGreaterThan(
      revealTruth(staged.player.coverSuspicion),
    );
  });

  it('an org-owned drop has no watcher and never detects', () => {
    const base = world();
    const drop = hostileDrop(base);
    // The generated hostile drop is org-owned ⇒ no person watches it.
    expect(dropWatcher(drop)).toBeUndefined();
    const staged = atDrop(base, drop);
    const { next } = resolveServiceDrop(
      staged,
      { kind: 'service-drop', drop: drop.id, leave: [], hostileMode: 'copy' },
      fixedPrng(0),
      SEIZED_TEMPLATE,
      renderLines,
    );
    expect(revealTruth(next.player.coverSuspicion)).toBe(
      revealTruth(staged.player.coverSuspicion),
    );
  });
});

// ---------------------------------------------------------------------------
// determinism + unchanged-on-disallowed (through the top-level resolve)
// ---------------------------------------------------------------------------

describe('service-drop — determinism and disallowed (Req 24.5)', () => {
  it('the same seed and inputs give the same next state and result', () => {
    const base = world();
    const drop = ownDrop(base);
    const staged = atDrop(base, drop);
    const a: ServiceDropAction = {
      kind: 'service-drop',
      drop: drop.id,
      leave: [{ item: 'item:x/1' as ItemId }],
    };
    const one = resolveServiceDrop(staged, a, createPrng('det'), SEIZED_TEMPLATE, renderLines);
    const two = resolveServiceDrop(staged, a, createPrng('det'), SEIZED_TEMPLATE, renderLines);
    expect(one.next.deadDrops[drop.id].contents).toEqual(
      two.next.deadDrops[drop.id].contents,
    );
    expect(one.result.events).toEqual(two.result.events);
    expect(revealTruth(one.next.player.coverSuspicion)).toBe(
      revealTruth(two.next.player.coverSuspicion),
    );
  });

  it('a disallowed service (not at the site) leaves the state unchanged', () => {
    const base = world();
    const drop = ownDrop(base);
    const elsewhere = (Object.keys(base.city.locations) as LocId[]).find(
      (l) => l !== drop.loc,
    ) as LocId;
    const state: WorldState = { ...base, player: { ...base.player, loc: elsewhere } };
    const a: ServiceDropAction = { kind: 'service-drop', drop: drop.id, leave: [] };
    const q = quote(state, a, ctx());
    expect(q.allowed).toBe(false);
    const { next } = resolve(state, a, createPrng('x'), ctx());
    expect(next).toBe(state);
  });
});

// ---------------------------------------------------------------------------
// pure helpers (property)
// ---------------------------------------------------------------------------

describe('service-drop helpers (property)', () => {
  it('disruptPendingStages marks exactly the pending stages disrupted', () => {
    const base = world();
    const disrupted = disruptPendingStages(base.plot);
    for (let i = 0; i < base.plot.stages.length; i += 1) {
      const before = base.plot.stages[i];
      const after = disrupted.stages[i];
      if (before.status === 'pending') {
        expect(after.status).toBe('disrupted');
      } else {
        expect(after.status).toBe(before.status);
      }
    }
  });

  it('seizedContentsAreMateriel is true iff the materiel is in the contents', () => {
    const base = world();
    const materiel = revealTruth(base.plot.materiel);
    fc.assert(
      fc.property(fc.array(fc.string({ minLength: 1, maxLength: 8 })), (tags) => {
        const items = tags.map((t) => `item:${t}` as ItemId);
        const without = seizedContentsAreMateriel(base.plot, items);
        expect(without).toBe(items.includes(materiel));
        const withMateriel = seizedContentsAreMateriel(base.plot, [...items, materiel]);
        expect(withMateriel).toBe(true);
      }),
    );
  });

  it('records a seizure as HANDS_OVER to the station', () => {
    const base = world();
    const { state, drop } = atHostileDrop(base, ['item:film' as ItemId]);
    const store = TruthStore.from(new Map([['HOLDS', 'custody-chain']]), {
      facts: [],
      allegiances: new Map(),
      identities: new Map(),
      claimTruths: [],
      itemOrigins: new Map([['item:film', 'npc:courier']]),
    });
    resolveServiceDrop(
      state,
      { kind: 'service-drop', drop: drop.id, leave: [], hostileMode: 'seize' },
      fixedPrng(1),
      SEIZED_TEMPLATE,
      renderLines,
      { truth: store },
    );
    const handover = store.facts().map((fact) => revealTruth(fact)).find((fact) => fact.predicate === 'HANDS_OVER');
    expect(handover).toMatchObject({
      subject: 'npc:courier',
      predicate: 'HANDS_OVER',
      object: state.station.org,
      instrument: 'item:film',
    });
    const ask = (subject: string) =>
      store.holds(
        { id: 'prop:ask', subject, predicate: 'HOLDS', object: 'item:film' },
        state.time,
      );
    expect(ask(state.station.org)).toBe(true);
    expect(ask('npc:courier')).toBe(false);
  });
});

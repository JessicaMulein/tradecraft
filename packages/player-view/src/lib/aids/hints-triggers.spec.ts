/**
 * Tests for the view-side hint trigger definitions (slice-integration task 8.4;
 * design, "Hints"; Requirement 19.10).
 *
 * The {@link HintStore} (tested in `aids.spec.ts`) owns the seen flags and the
 * first-occurrence rule. {@link hintTriggers} is the *other* half the design
 * pins to the Player View: given a committed turn's player-visible snapshot, it
 * reports which hint triggers' situations hold — reading only view-safe state,
 * the Case File, the turn's Fact Lines and the action catalogue, never the Truth
 * Store. These tests pin each trigger's definition, and especially the two the
 * design redefines to stay truth-free:
 *
 * - `cover-suspicion-high` fires on the "you may have been made" Fact Line
 *   ({@link MADE_FACT_LINE}), not the hidden `player.coverSuspicion`; and
 * - `plot-deadline-near` fires on a brief lead's stated deadline within one day,
 *   not the Plot's hidden schedule.
 *
 * The tests drive a real generated {@link WorldState} as the base, then apply
 * narrow, typed overrides for the field each trigger reads, so the snapshot is
 * realistic and the assertions stay about one trigger at a time.
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
  generate,
  MADE_FACT_LINE,
  ScenarioConfigSchema,
  type Action,
  type DeadDropId,
  type Directive,
  type DocId,
  type GameTime,
  type GenerateInputs,
  type Meeting,
  type MeetingId,
  type NpcId,
  type Proposition,
  type ResolverContext,
  type WorldState,
} from '@tradecraft/engine';

import { CaseFile } from '../casefile/casefile.js';
import { buildActionCatalogue } from '../api/action-catalogue.js';
import { hintTriggers, type HintTriggerInput } from './hints.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors aids.spec.ts)
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
const CTX: ResolverContext = { content };

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

function world(seed = 'hint-alpha'): WorldState {
  return generate(seed, inputs());
}

/** A snapshot over a (possibly overridden) state, with sensible empty defaults. */
function snapshot(over: Partial<HintTriggerInput> & { state: WorldState }): HintTriggerInput {
  return {
    caseFile: new CaseFile(),
    factLines: [],
    actions: [],
    ...over,
  };
}

/** A predicate id for a plain Proposition. The Case File stores but never
 * renders a Proposition, so any id works; a non-alias one keeps the unk: tests
 * about the subject, not alias resolution. */
function somePredicate(): string {
  const first = content.predicates.predicates.find((p) => p.id !== 'IS_ALIAS_OF');
  if (first === undefined) {
    throw new Error('core pack defines no non-alias predicate');
  }
  return first.id;
}

// ---------------------------------------------------------------------------
// cover-suspicion-high — the redefined, truth-free trigger
// ---------------------------------------------------------------------------

describe('hintTriggers — cover-suspicion-high (truth-free redefinition)', () => {
  it('fires on the "you may have been made" Fact Line, not the hidden suspicion', () => {
    const state = world();
    const fired = hintTriggers(snapshot({ state, factLines: [MADE_FACT_LINE] }));
    expect(fired).toContain('cover-suspicion-high');
  });

  it('does not fire when that Fact Line is absent, whatever the hidden suspicion is', () => {
    const state = world();
    const fired = hintTriggers(
      snapshot({ state, factLines: ['You arrive at the café.', 'You wait.'] }),
    );
    expect(fired).not.toContain('cover-suspicion-high');
  });
});

// ---------------------------------------------------------------------------
// plot-deadline-near — the redefined, truth-free trigger
// ---------------------------------------------------------------------------

describe('hintTriggers — plot-deadline-near (truth-free redefinition)', () => {
  const BRIEF_DOC = 'doc:brief-cable' as DocId;

  function leadClaim(caseFile: CaseFile, now: GameTime, to: GameTime): void {
    const prop: Proposition = {
      id: 'p:lead:0',
      subject: 'npc:target',
      predicate: somePredicate(),
      object: 'loc:depot',
      window: { from: now, to },
    };
    caseFile.add({ source: { kind: 'document', id: BRIEF_DOC }, prop, observedAt: now });
  }

  it('fires when a brief lead states a deadline within one day', () => {
    const state = world();
    const now = state.time;
    const caseFile = new CaseFile();
    // Deadline one day out (same phase next day) → near.
    leadClaim(caseFile, now, { day: now.day + 1, phase: now.phase });
    const fired = hintTriggers(
      snapshot({ state, caseFile, briefLeadDocs: new Set([BRIEF_DOC]) }),
    );
    expect(fired).toContain('plot-deadline-near');
  });

  it('does not fire when the stated deadline is more than a day away', () => {
    const state = world();
    const now = state.time;
    const caseFile = new CaseFile();
    leadClaim(caseFile, now, { day: now.day + 3, phase: now.phase });
    const fired = hintTriggers(
      snapshot({ state, caseFile, briefLeadDocs: new Set([BRIEF_DOC]) }),
    );
    expect(fired).not.toContain('plot-deadline-near');
  });

  it('does not fire for a non-lead Document claim (source not a brief lead)', () => {
    const state = world();
    const now = state.time;
    const caseFile = new CaseFile();
    const prop: Proposition = {
      id: 'p:other:0',
      subject: 'npc:target',
      predicate: somePredicate(),
      object: 'loc:depot',
      window: { from: now, to: { day: now.day + 1, phase: now.phase } },
    };
    caseFile.add({
      source: { kind: 'document', id: 'doc:newspaper' as DocId },
      prop,
      observedAt: now,
    });
    const fired = hintTriggers(
      snapshot({ state, caseFile, briefLeadDocs: new Set([BRIEF_DOC]) }),
    );
    expect(fired).not.toContain('plot-deadline-near');
  });

  it('never fires when no brief lead Documents are supplied', () => {
    const state = world();
    const now = state.time;
    const caseFile = new CaseFile();
    leadClaim(caseFile, now, { day: now.day + 1, phase: now.phase });
    const fired = hintTriggers(snapshot({ state, caseFile }));
    expect(fired).not.toContain('plot-deadline-near');
  });
});

// ---------------------------------------------------------------------------
// The remaining view-side triggers
// ---------------------------------------------------------------------------

describe('hintTriggers — first-unidentified-subject', () => {
  it('fires when the Case File holds a Claim referencing an unk: subject', () => {
    const state = world();
    const now = state.time;
    const caseFile = new CaseFile();
    const prop: Proposition = {
      id: 'p:unk:0',
      subject: 'unk:3',
      predicate: somePredicate(),
      object: 'loc:cafe',
    };
    caseFile.add({ source: { kind: 'surveillance', loc: 'loc:cafe' }, prop, observedAt: now });
    expect(hintTriggers(snapshot({ state, caseFile }))).toContain(
      'first-unidentified-subject',
    );
  });

  it('does not fire for an all-identified Case File', () => {
    const state = world();
    const now = state.time;
    const caseFile = new CaseFile();
    const prop: Proposition = {
      id: 'p:id:0',
      subject: 'npc:ana',
      predicate: somePredicate(),
      object: 'npc:boris',
    };
    caseFile.add({ source: { kind: 'surveillance', loc: 'loc:cafe' }, prop, observedAt: now });
    expect(hintTriggers(snapshot({ state, caseFile }))).not.toContain(
      'first-unidentified-subject',
    );
  });
});

describe('hintTriggers — first-dead-drop reads the committed action', () => {
  it('fires only when the committed action serviced a drop', () => {
    const state = world();
    const service: Action = {
      kind: 'service-drop',
      drop: 'drop:x' as DeadDropId,
      leave: [],
    };
    expect(hintTriggers(snapshot({ state, action: service }))).toContain('first-dead-drop');
    const wait: Action = { kind: 'wait', phases: 1 };
    expect(hintTriggers(snapshot({ state, action: wait }))).not.toContain('first-dead-drop');
    // No action (a dialogue/boundary turn) never fires it.
    expect(hintTriggers(snapshot({ state }))).not.toContain('first-dead-drop');
  });
});

describe('hintTriggers — first-meeting, first-recruitment, first-document', () => {
  it('first-meeting fires once the player has an arranged meeting on record', () => {
    const base = world();
    expect(hintTriggers(snapshot({ state: base }))).not.toContain('first-meeting');
    const meeting = {
      id: 'meeting:m1' as MeetingId,
      npc: 'npc:ana',
      at: base.player.loc,
      slot: { day: base.time.day + 1, phase: 1 },
      status: 'accepted',
    } as unknown as Meeting;
    const state: WorldState = { ...base, meetings: { 'meeting:m1': meeting } };
    expect(hintTriggers(snapshot({ state }))).toContain('first-meeting');
  });

  it('first-recruitment fires once any Relationship is recruited', () => {
    const base = world();
    expect(hintTriggers(snapshot({ state: base }))).not.toContain('first-recruitment');
    const npc = (Object.keys(base.relationships) as NpcId[])[0];
    if (npc === undefined) {
      return;
    }
    const rel = { ...base.relationships[npc], recruited: true };
    const state: WorldState = {
      ...base,
      relationships: { ...base.relationships, [npc]: rel },
    };
    expect(hintTriggers(snapshot({ state }))).toContain('first-recruitment');
  });

  it('first-document fires once the player has read a Document', () => {
    const base = world();
    expect(hintTriggers(snapshot({ state: base }))).not.toContain('first-document');
    const state: WorldState = {
      ...base,
      player: { ...base.player, readDocuments: ['doc:leaflet' as DocId] },
    };
    expect(hintTriggers(snapshot({ state }))).toContain('first-document');
  });
});

describe('hintTriggers — budget-low and standing-low', () => {
  it('budget-low fires below 20% of the starting Budget, not at or above it', () => {
    const base = world();
    const start = base.station.ledger.start;
    // Drain to just under 20% with one ledger entry.
    const low: WorldState = {
      ...base,
      station: {
        ...base.station,
        ledger: {
          ...base.station.ledger,
          entries: [
            {
              at: base.time,
              amount: -(start - Math.floor(0.2 * start) + 1),
              reason: 'pay',
            },
          ],
        },
      },
    };
    expect(hintTriggers(snapshot({ state: low }))).toContain('budget-low');
    // Full starting Budget is not low.
    expect(hintTriggers(snapshot({ state: base }))).not.toContain('budget-low');
  });

  it('standing-low fires only when Standing is below zero', () => {
    const base = world();
    const negative: WorldState = {
      ...base,
      station: { ...base.station, standing: -1 },
    };
    expect(hintTriggers(snapshot({ state: negative }))).toContain('standing-low');
    const nonNegative: WorldState = {
      ...base,
      station: { ...base.station, standing: 0 },
    };
    expect(hintTriggers(snapshot({ state: nonNegative }))).not.toContain('standing-low');
  });
});

describe('hintTriggers — directive-near-deadline', () => {
  function directive(status: Directive['status'], deadline: GameTime): Directive {
    return {
      id: 'dir:1',
      text: 'Identify the resident.',
      objective: { kind: 'recruit', count: 1 },
      deadline,
      reward: 1,
      status,
    };
  }

  it('fires for an open Directive due within one day', () => {
    const base = world();
    const now = base.time;
    const state: WorldState = {
      ...base,
      station: {
        ...base.station,
        directives: [directive('open', { day: now.day + 1, phase: now.phase })],
      },
    };
    expect(hintTriggers(snapshot({ state }))).toContain('directive-near-deadline');
  });

  it('does not fire for a met Directive, or one due far off', () => {
    const base = world();
    const now = base.time;
    const met: WorldState = {
      ...base,
      station: {
        ...base.station,
        directives: [directive('met', { day: now.day + 1, phase: now.phase })],
      },
    };
    expect(hintTriggers(snapshot({ state: met }))).not.toContain('directive-near-deadline');
    const farOff: WorldState = {
      ...base,
      station: {
        ...base.station,
        directives: [directive('open', { day: now.day + 5, phase: now.phase })],
      },
    };
    expect(hintTriggers(snapshot({ state: farOff }))).not.toContain(
      'directive-near-deadline',
    );
  });
});

describe('hintTriggers — first-arrest-available reads the action catalogue', () => {
  it('fires when the catalogue offers an allowed arrest, not otherwise', () => {
    const state = world();
    // No evidence anywhere → no allowed arrest in the real catalogue.
    const noEvidence = buildActionCatalogue(state, CTX, () => 0);
    expect(hintTriggers(snapshot({ state, actions: noEvidence }))).not.toContain(
      'first-arrest-available',
    );
    // An allowed arrest option fires it (synthetic option; the function reads
    // only kind + quote.allowed).
    const withArrest = [
      ...noEvidence,
      {
        action: { kind: 'arrest', npc: 'npc:ana' } as Action,
        quote: { allowed: true, phases: 1, money: 0 },
      },
    ];
    expect(hintTriggers(snapshot({ state, actions: withArrest }))).toContain(
      'first-arrest-available',
    );
    // A disallowed arrest option does not.
    const disallowed = [
      ...noEvidence,
      {
        action: { kind: 'arrest', npc: 'npc:ana' } as Action,
        quote: { allowed: false, phases: 1, money: 0, reason: 'no evidence' },
      },
    ];
    expect(hintTriggers(snapshot({ state, actions: disallowed }))).not.toContain(
      'first-arrest-available',
    );
  });
});

describe('hintTriggers — order and truth-freedom', () => {
  it('reports triggers in the fixed design order', () => {
    const base = world();
    const now = base.time;
    const caseFile = new CaseFile();
    caseFile.add({
      source: { kind: 'surveillance', loc: 'loc:cafe' },
      prop: { id: 'p:unk:0', subject: 'unk:1', predicate: somePredicate(), object: 'loc:cafe' },
      observedAt: now,
    });
    const state: WorldState = {
      ...base,
      station: { ...base.station, standing: -1 },
    };
    const fired = hintTriggers(
      snapshot({ state, caseFile, factLines: [MADE_FACT_LINE] }),
    );
    // first-unidentified-subject precedes standing-low precedes cover-suspicion-high.
    expect(fired.indexOf('first-unidentified-subject')).toBeLessThan(
      fired.indexOf('standing-low'),
    );
    expect(fired.indexOf('standing-low')).toBeLessThan(
      fired.indexOf('cover-suspicion-high'),
    );
  });
});

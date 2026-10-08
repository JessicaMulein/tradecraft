/**
 * Mole Hunt: leaks, thread clues, the evidence gate, and both accusation outcomes.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type EntityId, type Prng } from '@tradecraft/engine';
import { describe, expect, it } from 'vitest';

import type { ArcFacts } from './arcs.js';
import { campaignContent } from './content/library.js';
import { campaignSources, loadCampaignContent } from './content/load.js';
import { dossierCarry, NOTORIETY_KNOWN_COVER } from './dossier.js';
import {
  ACCUSATION_REFUSAL,
  ACCUSATION_REPUTATION,
  ACCUSATION_STANDING,
  ACCUSATION_UNKNOWN,
  applyAccusation,
  applyMoleLeaks,
  moleEvidence,
  moleHuntThreads,
  quoteAccusation,
} from './molehunt.js';
import { step } from './reducer.js';
import type { CampaignChoice, CampaignTruth, CarryClaim, HqCastView, HqFigure, HostileDossier, Officer } from './state.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CORE = join(ROOT, 'packages', 'content', 'packs', 'core');

const loaded = loadCampaignContent([CORE], ['core']);
if (!loaded.ok) {
  throw new Error(loaded.errors.map((error) => error.message).join('; '));
}
const content = campaignContent(loaded.value, campaignSources([CORE], new Set(['core'])).sources);

function officer(): Officer {
  const choice: Extract<CampaignChoice, { kind: 'create' }> = {
    kind: 'create',
    seed: 'mole',
    preset: 'standard',
    officerName: 'Ada',
    background: 'analyst',
    startYear: 1948,
  };
  const result = step(undefined, { kind: 'choice', choice }, content);
  if (!result.ok) {
    throw new Error(result.error.kind);
  }
  return result.value.view.officer;
}

function rolls(values: readonly number[]): Prng {
  let index = 0;
  const next = (): number => {
    const value = values[index] ?? 0;
    index += 1;
    return value;
  };
  return {
    nextUint32: () => 0,
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    bool: (probability = 0.5) => next() < probability,
    pick: (items) => {
      const item = items[0];
      if (item === undefined) {
        throw new Error('empty pick');
      }
      return item;
    },
    shuffle: (items) => [...items],
    state: () => [0, 0, 0, 0],
  };
}

function throwing(): Prng {
  const fail = (): never => {
    throw new Error('drew');
  };
  return {
    nextUint32: fail,
    next: fail,
    int: fail,
    bool: fail,
    pick: fail,
    shuffle: fail,
    state: () => [0, 0, 0, 0],
  };
}

function emptyDossier(): HostileDossier {
  return {
    service: 'svc-east',
    notoriety: 0,
    descriptorKnown: false,
    burnedLegends: [],
    patterns: [],
    channelKinds: [],
    suspectedAssets: [],
    doctrineShift: {},
  };
}

function claim(
  id: string,
  subject: EntityId,
  predicate: string,
  object: EntityId,
  relation: CarryClaim['relation'] = 'corroborated',
  place?: `loc:${string}`,
): CarryClaim {
  return {
    id,
    prop: { id: `prop:${id}`, subject, predicate, object, ...(place === undefined ? {} : { place }) },
    text: id,
    relation,
  };
}

function facts(): ArcFacts {
  return {
    postingIndex: 0,
    year: 1948,
    service: 'svc-east',
    rank: 'case-officer',
    notoriety: 0,
    heldClaims: [],
    presentClues: [],
    roster: {},
  };
}

function cast(): { readonly figures: readonly HqFigure[]; readonly view: readonly HqCastView[] } {
  const figures: HqFigure[] = [
    { id: 'cp-1', template: 'registry-clerk', access: ['legends', 'directives'] },
    { id: 'cp-2', template: 'cable-clerk', access: ['cables'] },
  ];
  const view: HqCastView[] = [
    { id: 'cp-1', name: 'Ivan', faction: 'security', role: 'clerk' },
    { id: 'cp-2', name: 'Helen', faction: 'operations', role: 'clerk' },
  ];
  return { figures, view };
}

describe('mole hunt', () => {
  it('burns the next legend and shifts doctrine, and raises starting cover suspicion', () => {
    const quiet = { 'svc-east': emptyDossier() };
    const mole: HqFigure = { id: 'cp-1', template: 'registry-clerk', access: ['legends', 'directives'] };
    const leaked = applyMoleLeaks({
      dossiers: quiet,
      service: 'svc-east',
      mole,
      legend: 'lg-1',
      theme: 'surveillance',
      leak: 1,
      maxDoctrineShift: 0.2,
      rng: rolls([0]),
    });
    const dossier = leaked['svc-east'];
    expect(dossier?.burnedLegends).toEqual(['lg-1']);
    expect(dossier?.descriptorKnown).toBe(true);
    expect(dossier?.notoriety).toBe(NOTORIETY_KNOWN_COVER);
    expect(dossier?.doctrineShift.securityConsciousness).toBe(0.1);

    const carry = { coverSuspicionK: 0.5, tailFrom: 0.6, patternCap: 0.4 };
    const preset = { coverSuspicionBurnThreshold: 0.8 };
    expect(dossierCarry(dossier ?? emptyDossier(), preset, carry).coverSuspicion).toBeGreaterThan(
      dossierCarry(quiet['svc-east'] ?? emptyDossier(), preset, carry).coverSuspicion,
    );

    expect(
      applyMoleLeaks({
        ...leakInput(quiet, { ...mole, access: ['legends'] }),
        leak: 0,
        rng: rolls([0.5]),
      }),
    ).toBe(quiet);
    expect(applyMoleLeaks({ ...leakInput(quiet, undefined), rng: throwing() })).toBe(quiet);
    expect(applyMoleLeaks({ ...leakInput(quiet, { ...mole, access: ['personnel'] }), rng: throwing() })).toBe(quiet);

    const directives = applyMoleLeaks({
      ...leakInput(quiet, { ...mole, access: ['directives'] }),
      theme: 'sabotage',
      rng: throwing(),
    });
    expect(directives['svc-east']?.doctrineShift.riskTolerance).toBe(0.1);
    expect(directives['svc-east']?.burnedLegends).toEqual([]);
  });

  it('builds mole-hunt clues as predicates over the bound HQ figure', () => {
    const arcs: CampaignTruth['arcs'] = {
      nemesis: { bindings: { nemesis: 'cp-9' }, stage: 'shadow', clues: {} },
      'mole-hunt': { bindings: { mole: 'cp-1' }, stage: 'rumour', clues: {} },
    };
    const specs = moleHuntThreads(arcs, content.arcs, content.arcThreads, facts(), 'svc-east');
    expect(specs.map((spec) => spec.template)).toEqual(['mole-rumour']);
    expect(specs[0]?.visitor).toBe('cp-1');
    expect(specs[0]?.clues).toEqual([
      {
        id: 'mole-access',
        prop: { id: 'prop:mole-access', subject: 'npc:cp-1', predicate: 'KNOWS', object: 'org:svc-east' },
      },
    ]);
  });

  it('counts distinct corroborated claims that name the figure', () => {
    const claims = [
      claim('a', 'npc:cp-2', 'KNOWS', 'org:svc-east'),
      claim('a-again', 'npc:cp-2', 'KNOWS', 'org:svc-east'),
      claim('b', 'npc:cp-2', 'MEETS_AT', 'org:svc-east'),
      claim('c', 'npc:cp-2', 'KNOWS', 'org:svc-east', 'corroborated', 'loc:cafe'),
      claim('open', 'npc:cp-2', 'KNOWS', 'org:other', 'none'),
      claim('alias', 'unk:1', 'IS_ALIAS_OF', 'npc:cp-2', 'none'),
      claim('via-alias', 'unk:1', 'KNOWS', 'org:svc-east'),
    ];
    expect(moleEvidence(claims, 'cp-2')).toBe(3);
    expect(moleEvidence(claims, 'cp-9')).toBe(0);
    expect(quoteAccusation(claims.slice(0, 2), 'cp-2', 3)).toEqual({
      allowed: false,
      evidence: 1,
      reason: ACCUSATION_REFUSAL,
    });
  });

  it('rewards a correct accusation, reprimands a wrong one, and uses one cable', () => {
    const { figures, view } = cast();
    const arcs: CampaignTruth['arcs'] = {
      'mole-hunt': { bindings: { mole: 'cp-1' }, stage: 'rumour', clues: {} },
    };
    const template = content.arcs.find((arc) => arc.id === 'mole-hunt');
    if (template === undefined) {
      throw new Error('missing mole-hunt arc');
    }
    const claims = [
      claim('a', 'npc:cp-2', 'KNOWS', 'org:svc-east'),
      claim('b', 'npc:cp-2', 'MEETS_AT', 'org:svc-east'),
      claim('c', 'npc:cp-2', 'KNOWS', 'org:svc-east', 'corroborated', 'loc:cafe'),
    ];
    const base = {
      officer: officer(),
      hqFigures: figures,
      hqCast: view,
      arcs,
      moleArc: template,
      claims,
      threshold: 3,
      texts: content.texts,
      mole: 'cp-1' as const,
    };
    const refused = applyAccusation({ ...base, figure: 'cp-2', figureName: 'Helen', claims: claims.slice(0, 1) });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.reason).toBe(ACCUSATION_REFUSAL);
    }

    const wrong = applyAccusation({ ...base, figure: 'cp-2', figureName: 'Helen' });
    expect(wrong.ok).toBe(true);
    if (!wrong.ok) {
      return;
    }
    expect(wrong.value.correct).toBe(false);
    expect(wrong.value.officer.reprimands).toBe(base.officer.reprimands + 1);
    expect(wrong.value.officer.careerStanding).toBe(base.officer.careerStanding);
    expect(wrong.value.officer.factions.security).toBe((base.officer.factions.security ?? 0) - ACCUSATION_REPUTATION);
    expect(wrong.value.arcs).toBe(arcs);
    expect(wrong.value.hqFigures).toBe(figures);
    expect(wrong.value.cable.body).toContain('Helen');
    expect(wrong.value.cable.body).not.toContain('Ivan');

    const rightClaims = [
      claim('a', 'npc:cp-1', 'KNOWS', 'org:svc-east'),
      claim('b', 'npc:cp-1', 'MEETS_AT', 'org:svc-east'),
      claim('c', 'npc:cp-1', 'KNOWS', 'org:svc-east', 'corroborated', 'loc:cafe'),
    ];
    const right = applyAccusation({ ...base, figure: 'cp-1', figureName: 'Helen', claims: rightClaims });
    expect(right.ok).toBe(true);
    if (!right.ok) {
      return;
    }
    expect(right.value.correct).toBe(true);
    expect(right.value.officer.careerStanding).toBe(base.officer.careerStanding + ACCUSATION_STANDING);
    expect(right.value.officer.reprimands).toBe(base.officer.reprimands);
    expect(right.value.officer.factions.security).toBe((base.officer.factions.security ?? 0) + ACCUSATION_REPUTATION);
    expect(right.value.hqFigures.map((figure) => figure.id)).toEqual(['cp-2']);
    expect(right.value.hqCast.map((figure) => figure.id)).toEqual(['cp-2']);
    expect(right.value.arcs['mole-hunt']?.clues['mole-named']).toBe(true);
    expect(right.value.cable).toEqual(wrong.value.cable);
    expect(moleHuntThreads(right.value.arcs, content.arcs, content.arcThreads, facts(), 'svc-east')).toEqual([]);

    const stopped = applyMoleLeaks({
      ...leakInput({ 'svc-east': emptyDossier() }, undefined),
      legend: 'lg-2',
      leak: 1,
      rng: rolls([0]),
    });
    expect(stopped['svc-east']?.burnedLegends).toEqual([]);

    const unknownClaims = [
      claim('a', 'npc:cp-9', 'KNOWS', 'org:svc-east'),
      claim('b', 'npc:cp-9', 'MEETS_AT', 'org:svc-east'),
      claim('c', 'npc:cp-9', 'KNOWS', 'org:svc-east', 'corroborated', 'loc:cafe'),
    ];
    const unknown = applyAccusation({ ...base, figure: 'cp-9', figureName: 'Nora', claims: unknownClaims });
    expect(unknown).toEqual({ ok: false, reason: ACCUSATION_UNKNOWN });
  });
});

function leakInput(
  dossiers: Readonly<Record<string, HostileDossier>>,
  mole: HqFigure | undefined,
): Parameters<typeof applyMoleLeaks>[0] {
  return {
    dossiers,
    service: 'svc-east',
    mole,
    legend: 'lg-1',
    theme: 'surveillance',
    leak: 1,
    maxDoctrineShift: 0.2,
    rng: rolls([0]),
  };
}

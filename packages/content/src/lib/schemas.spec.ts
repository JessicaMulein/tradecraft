import { describe, expect, it } from 'vitest';

import {
  ArchetypeSchema,
  CONTENT_KIND_NAMES,
  contentKindJsonSchema,
  contentKindJsonSchemas,
  contentKindSchemas,
  CoverIdentitySchema,
  DifficultyPresetSchema,
  DocumentTemplateSchema,
  HintSchema,
  HINT_TRIGGERS,
  LocationTypeSchema,
  PACK_ROLES,
  PackManifestSchema,
  PersonaLibrarySchema,
  effectivePackRole,
  PlotTemplateSchema,
  PredicateDefinitionSchema,
  RumourTemplateSchema,
  SideThreadTemplateSchema,
  TraceTemplateSchema,
} from '../index.js';

// --- pack.yaml -------------------------------------------------------------

describe('PackManifestSchema', () => {
  const base = {
    id: 'core',
    version: '1.0.0',
    contentSchema: 1,
  };

  it('accepts a minimal manifest and defaults requires/overrides to empty', () => {
    const parsed = PackManifestSchema.parse(base);
    expect(parsed.requires).toEqual([]);
    expect(parsed.overrides).toEqual([]);
  });

  it('accepts requires and overrides', () => {
    const parsed = PackManifestSchema.parse({
      ...base,
      requires: [{ id: 'core', range: '^1.0.0' }],
      overrides: ['core/bartender'],
    });
    expect(parsed.requires[0].range).toBe('^1.0.0');
    expect(parsed.overrides[0]).toBe('core/bartender');
  });

  it('rejects a non-semver version', () => {
    expect(() => PackManifestSchema.parse({ ...base, version: '1.0' })).toThrow();
  });

  it('rejects an unknown field', () => {
    expect(() =>
      PackManifestSchema.parse({ ...base, extra: true }),
    ).toThrow();
  });

  it('rejects an upper-case id', () => {
    expect(() => PackManifestSchema.parse({ ...base, id: 'Core' })).toThrow();
  });

  it('accepts contentSchema 1 or 2 (Requirement 1.3)', () => {
    expect(PackManifestSchema.parse({ ...base, contentSchema: 1 }).contentSchema).toBe(1);
    expect(PackManifestSchema.parse({ ...base, contentSchema: 2 }).contentSchema).toBe(2);
  });

  it('accepts each declared role (Requirement 1.1)', () => {
    for (const role of PACK_ROLES) {
      const parsed = PackManifestSchema.parse({ ...base, contentSchema: 2, role });
      expect(parsed.role).toBe(role);
    }
  });

  it('rejects an unknown role', () => {
    expect(() =>
      PackManifestSchema.parse({ ...base, contentSchema: 2, role: 'map' }),
    ).toThrow();
  });

  it('treats a schema-1 pack with no role as core (Requirement 1.2)', () => {
    const parsed = PackManifestSchema.parse(base);
    expect(parsed.role).toBeUndefined();
    expect(effectivePackRole(parsed)).toBe('core');
  });

  it('uses a declared role over the core default', () => {
    const parsed = PackManifestSchema.parse({ ...base, contentSchema: 2, role: 'city' });
    expect(effectivePackRole(parsed)).toBe('city');
  });
});

// --- predicate definitions -------------------------------------------------

describe('PredicateDefinitionSchema', () => {
  const meetsAt = {
    id: 'MEETS_AT',
    subject: ['npc', 'unk'],
    object: { entity: ['npc', 'unk'] },
    place: 'required',
    window: 'required',
    evaluator: 'fact-match',
    fieldCode: 'MT',
    render: {
      second: 'You meet {object} at {place} {when}.',
      third: '{subject} meets {object} at {place} {when}.',
    },
    extractorHint: 'Two people meet at a place.',
  };

  it('accepts the design example', () => {
    expect(PredicateDefinitionSchema.parse(meetsAt).id).toBe('MEETS_AT');
  });

  it('accepts a literal object and an implication', () => {
    const parsed = PredicateDefinitionSchema.parse({
      ...meetsAt,
      id: 'PAYS',
      object: { literal: 'amount' },
      implication: { role: 'either', other: ['hostile-person'] },
    });
    expect(parsed.object).toEqual({ literal: 'amount' });
    expect(parsed.implication?.role).toBe('either');
  });

  it('rejects an unknown evaluator kind', () => {
    expect(() =>
      PredicateDefinitionSchema.parse({ ...meetsAt, evaluator: 'magic' }),
    ).toThrow();
  });

  it('rejects a definition missing a render template', () => {
    expect(() =>
      PredicateDefinitionSchema.parse({
        ...meetsAt,
        render: { third: '{subject} meets.' },
      }),
    ).toThrow();
  });

  it('rejects an object that is both entity and literal', () => {
    expect(() =>
      PredicateDefinitionSchema.parse({
        ...meetsAt,
        object: { entity: ['npc'], literal: 'text' },
      }),
    ).toThrow();
  });

  it('rejects a lower-case predicate id', () => {
    expect(() =>
      PredicateDefinitionSchema.parse({ ...meetsAt, id: 'meets_at' }),
    ).toThrow();
  });
});

// --- difficulty presets ----------------------------------------------------

describe('DifficultyPresetSchema', () => {
  const standard = {
    id: 'standard',
    plot: { stageCount: 5, deadlineSlackDays: 2 },
    noiseCounts: { backgroundNpcs: 10, sideThreads: 2, rumours: 6 },
    noiseTrafficRatio: { noise: 2, plot: 1 },
    hqFalseBeliefRate: 0.15,
    doctrine: {
      risk: { min: 0.3, max: 0.6 },
      security: { min: 0.3, max: 0.6 },
      deception: { min: 0.3, max: 0.6 },
    },
    detectionBase: { surveil: 0.1, meeting: 0.06, drop: 0.04 },
    madeRevealProbability: 0.6,
    tradecraftErrorProbability: 0.3,
    allowedCiphers: ['caesar', 'vigenere', 'columnar', 'book', 'otp'],
    arrest: {
      threshold: 3,
      wrongfulAuthorityPenalty: -1,
      wrongfulRaisesAlertness: false,
    },
    startingBudget: 3000,
    traceRequestDelayPhases: 2,
    coverSuspicionBurnThreshold: 0.8,
    hintsDefault: true,
  };

  it('accepts the standard preset from the design table', () => {
    expect(DifficultyPresetSchema.parse(standard).id).toBe('standard');
  });

  it('rejects a probability above 1', () => {
    expect(() =>
      DifficultyPresetSchema.parse({ ...standard, hqFalseBeliefRate: 1.5 }),
    ).toThrow();
  });

  it('rejects an inverted doctrine range', () => {
    expect(() =>
      DifficultyPresetSchema.parse({
        ...standard,
        doctrine: {
          ...standard.doctrine,
          risk: { min: 0.6, max: 0.3 },
        },
      }),
    ).toThrow();
  });

  it('rejects an empty allowed-cipher list', () => {
    expect(() =>
      DifficultyPresetSchema.parse({ ...standard, allowedCiphers: [] }),
    ).toThrow();
  });

  it('rejects a positive wrongful-arrest penalty', () => {
    expect(() =>
      DifficultyPresetSchema.parse({
        ...standard,
        arrest: { ...standard.arrest, wrongfulAuthorityPenalty: 1 },
      }),
    ).toThrow();
  });
});

// --- hints -----------------------------------------------------------------

describe('HintSchema', () => {
  it('accepts a hint whose trigger is in the enum', () => {
    const parsed = HintSchema.parse({
      id: 'spot-unknown',
      trigger: 'first-unidentified-subject',
      text: 'You can surveil {subject} to learn who they are.',
    });
    expect(parsed.trigger).toBe('first-unidentified-subject');
  });

  it('exposes a non-empty trigger enum including budget-low', () => {
    expect(HINT_TRIGGERS).toContain('budget-low');
    expect(HINT_TRIGGERS).toContain('first-unidentified-subject');
  });

  it('rejects a trigger outside the enum', () => {
    expect(() =>
      HintSchema.parse({ id: 'x', trigger: 'made-up', text: 'hi' }),
    ).toThrow();
  });
});

// --- trace templates -------------------------------------------------------

describe('TraceTemplateSchema', () => {
  const meeting = {
    kind: 'meeting',
    roles: ['handling-officer', 'inside-fixer'],
    place: { locationType: 'hotel-bar' },
    evidences: ['MEETS_AT', 'REPORTS_TO'],
    text: 'The two meet at a hotel bar.',
  };

  it('accepts a meeting trace and defaults roles/evidences to empty', () => {
    const parsed = TraceTemplateSchema.parse({ kind: 'meeting', text: 'A sighting.' });
    expect(parsed.roles).toEqual([]);
    expect(parsed.evidences).toEqual([]);
  });

  it('accepts a full meeting trace', () => {
    expect(() => TraceTemplateSchema.parse(meeting)).not.toThrow();
  });

  it('accepts a transmission trace on a channel', () => {
    expect(() =>
      TraceTemplateSchema.parse({
        kind: 'transmission',
        roles: ['wireless-operator'],
        channel: 'radio',
        evidences: ['USES_CHANNEL'],
        text: 'A night transmission.',
      }),
    ).not.toThrow();
  });

  it('accepts a target place and a materiel slot', () => {
    expect(() =>
      TraceTemplateSchema.parse({
        kind: 'drop-emptied',
        roles: ['street-courier'],
        place: { target: 'liaison-office' },
        materiel: 'courier-pouch',
        evidences: ['CARRIES'],
        text: 'A courier empties the drop.',
      }),
    ).not.toThrow();
  });

  it('rejects an unknown kind', () => {
    expect(() =>
      TraceTemplateSchema.parse({ kind: 'bribe', text: 'x' }),
    ).toThrow();
  });

  it('rejects an unknown channel kind (dead-drop is not a transmission channel)', () => {
    expect(() =>
      TraceTemplateSchema.parse({ kind: 'transmission', channel: 'dead-drop', text: 'x' }),
    ).toThrow();
  });

  it('rejects a place that names both a Location Type and a target', () => {
    expect(() =>
      TraceTemplateSchema.parse({
        kind: 'meeting',
        place: { locationType: 'park', target: 'bench' },
        text: 'x',
      }),
    ).toThrow();
  });

  it('rejects a lower-case evidence (not an UPPER_SNAKE predicate id)', () => {
    expect(() =>
      TraceTemplateSchema.parse({ kind: 'meeting', evidences: ['meets_at'], text: 'x' }),
    ).toThrow();
  });

  it('rejects an empty text', () => {
    expect(() => TraceTemplateSchema.parse({ kind: 'meeting', text: '' })).toThrow();
  });

  it('rejects an unknown field', () => {
    expect(() =>
      TraceTemplateSchema.parse({ kind: 'meeting', text: 'x', extra: 1 }),
    ).toThrow();
  });
});

// --- the other content kinds ----------------------------------------------

describe('content-kind schemas accept representative data', () => {
  it('Archetype', () => {
    expect(() =>
      ArchetypeSchema.parse({
        id: 'waiter',
        role: 'civilian',
        allowedAllegiances: ['neutral'],
        mice: {
          money: { min: 0.2, max: 0.6 },
          ideology: { min: 0, max: 0.2 },
          coercion: { min: 0, max: 0.3 },
          ego: { min: 0.1, max: 0.4 },
        },
        wariness: { min: 0.2, max: 0.5 },
        personaPools: ['viennese'],
        descriptorPools: ['fifties-civilian'],
        schedule: [
          { weekday: 'monday', phase: 'evening', at: ['function:cafe'] },
        ],
        fallback: ['function:cafe'],
      }),
    ).not.toThrow();
  });

  it('Location Type', () => {
    expect(() =>
      LocationTypeSchema.parse({
        id: 'kaffeehaus',
        public: true,
        allowedActions: ['talk', 'surveil', 'read'],
        openingHours: [
          { weekday: 'monday', openPhase: 'morning', closePhase: 'night' },
        ],
        crowdCurve: [{ weekday: 'monday', phase: 'evening', level: 0.7 }],
        weatherModifiers: [{ weather: 'rain', crowdMultiplier: 1.2 }],
        baseRisk: 0.2,
        allowsDeadDrops: false,
        namePatterns: ['Café {pick:cafe-names}'],
        descriptionPool: ['A warm room thick with coffee and smoke.'],
        atmosphereTags: ['smoky', 'genteel'],
      }),
    ).not.toThrow();
  });

  it('Plot template', () => {
    expect(() =>
      PlotTemplateSchema.parse({
        id: 'courier-ring',
        roleSlots: [{ id: 'cell-courier', archetypes: ['cell-member'] }],
        stages: [
          {
            id: 'rendezvous',
            deadline: { min: 2, max: 4 },
            traces: [
              {
                kind: 'meeting',
                roles: ['cell-courier'],
                evidences: ['MEETS_AT'],
                text: 'The courier meets a contact.',
              },
            ],
            onDisrupted: { delay: 0.6, reroute: 0.3, abort: 0.1 },
          },
        ],
      }),
    ).not.toThrow();
  });

  it('Side Thread template rejects a Cell role', () => {
    const good = {
      id: 'penicillin',
      roleSlots: [{ id: 'trader', archetypes: ['black-marketeer'] }],
      stages: [
        {
          id: 'deal',
          deadline: { min: 3, max: 7 },
          onDisrupted: { delay: 1, reroute: 0, abort: 0 },
        },
      ],
    };
    expect(() => SideThreadTemplateSchema.parse(good)).not.toThrow();
    expect(() =>
      SideThreadTemplateSchema.parse({
        ...good,
        roleSlots: [{ id: 'cell-lead', archetypes: ['cell-member'] }],
      }),
    ).toThrow();
  });

  it('Document template', () => {
    expect(() =>
      DocumentTemplateSchema.parse({
        id: 'morning-edition',
        kind: 'newspaper',
        titlePattern: '{pick:mastheads}',
        sections: [{ id: 'lead', body: '{pick:lead-stories}' }],
      }),
    ).not.toThrow();
  });

  it('Persona library', () => {
    expect(() =>
      PersonaLibrarySchema.parse({
        id: 'viennese',
        namePools: [
          { culture: 'austrian', gender: 'male', given: ['Franz'], family: ['Huber'] },
        ],
        backgrounds: ['Grew up in the Second District.'],
      }),
    ).not.toThrow();
  });

  it('Cover Identity', () => {
    expect(() =>
      CoverIdentitySchema.parse({
        id: 'trade-attache',
        title: 'Trade Attaché',
        employerOrg: 'Allied Trade Mission',
        fitLocationTypes: ['embassy', 'hotel-bar'],
        suspicionModifiers: { atFit: -0.1, elsewhere: 0.2 },
      }),
    ).not.toThrow();
  });

  it('Rumour template', () => {
    expect(() =>
      RumourTemplateSchema.parse({
        id: 'swapped-meeting',
        predicate: 'MEETS_AT',
        distortions: ['swap-subject', 'shift-day'],
        shiftDays: 2,
      }),
    ).not.toThrow();
  });
});

// --- JSON Schema export ----------------------------------------------------

describe('JSON Schema exports', () => {
  it('exposes one Zod schema per content-kind name', () => {
    for (const name of CONTENT_KIND_NAMES) {
      expect(contentKindSchemas[name]).toBeDefined();
    }
  });

  it('covers pack, predicate, every table kind, hint and difficulty preset', () => {
    expect(new Set(CONTENT_KIND_NAMES)).toEqual(
      new Set([
        'pack',
        'predicate',
        'archetype',
        'location-type',
        'plot-template',
        'side-thread-template',
        'document-template',
        'persona-library',
        'cover-identity',
        'rumour-template',
        'hint',
        'difficulty-preset',
      ]),
    );
  });

  it('produces a draft 2020-12 JSON Schema object for each kind', () => {
    for (const name of CONTENT_KIND_NAMES) {
      const schema = contentKindJsonSchema(name) as Record<string, unknown>;
      expect(schema.$schema).toContain('2020-12');
      expect(schema.type).toBe('object');
    }
  });

  it('builds a map of every kind in one call', () => {
    const all = contentKindJsonSchemas();
    expect(Object.keys(all).sort()).toEqual([...CONTENT_KIND_NAMES].sort());
  });

  it('memoises: the same kind returns the identical object', () => {
    expect(contentKindJsonSchema('hint')).toBe(contentKindJsonSchema('hint'));
  });
});

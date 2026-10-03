/**
 * Unit tests for the Live Seams over a FAKE Gateway (slice-integration task
 * 11.5; Requirements 15.9, 16.4, 17.1, 17.3).
 *
 * `buildLiveSeams` composes the four model-touching seams the Turn Pipeline
 * drives — classify, voice, narrate and the two-phase extraction runner —
 * behind the {@link Gateway} interface, so the whole composition can be driven
 * offline with a scripted fake (no live model, no endpoint). These tests pin
 * the behaviours the design makes observable at the seam boundary:
 *
 *   - **Role routing (Req 15.9).** The voice seam routes the NPC reply to the
 *     `voice` role when the scene is high-stakes — one of the three high-stakes
 *     scene kinds (interrogation, recruitment pitch, Double-Agent confront) or a
 *     turn whose Intent is a pitch or a confrontation — and to `fast` otherwise.
 *     The fake records the role each `stream` call arrives on.
 *   - **Leak Guard retry then deflection (Req 16.4).** A reply that names a
 *     registered entity outside the NPC's known set is regenerated under a
 *     stricter instruction up to the configured limit; once the retries are
 *     exhausted the seam substitutes the persona deflection line. The fake
 *     scripts a leaking first reply and a clean regeneration, then a wholly
 *     leaking stream, to exercise both the recovered and the deflected paths.
 *   - **Extraction start/ready and the unparsed fallback (Req 17.1, 17.3).**
 *     The extraction runner `buildLiveSeams` wires runs `extractClaims` on the
 *     `bookkeeping` role and reports `parsed` / `unparsed` / `pending`. The
 *     dedicated edge cases live in `extraction-runner.spec.ts` (task 11.3); this
 *     file only confirms the bundle wires the same runner (start → ready) and
 *     maps the unparsed fallback, so the two files do not duplicate.
 *
 * This is a spec file: it is the only kind that may import vitest. The library
 * (`live-seams.ts`) imports none and performs no I/O of its own.
 */

import {
  compilePredicateRegistry,
  type EvaluatorKind,
  type PredicateDefinition,
  type PredicateRegistry,
} from '@tradecraft/content';
import {
  TruthStore,
  type EntityId,
  type GameTime,
  type Intent,
  type NpcId,
  type Persona,
  type SceneKind,
  type TalkScene,
  type WorldState,
} from '@tradecraft/engine';
import {
  type CallInput,
  type CallKind,
  type CallRequest,
  type Gateway,
  type NarrationStream,
  type Role,
  type StreamOptions,
} from '@tradecraft/llm';
import type { ZodType } from 'zod';
import { describe, expect, it } from 'vitest';

import {
  buildClassifySeam,
  buildExtractionRunner,
  buildLiveSeams,
  buildVoiceSeam,
  DEFLECTION_LINE,
  type LiveSeamDeps,
  type QueuedExtraction,
} from './live-seams.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ANA: NpcId = 'npc:ana';
/** A secret NPC the scene NPC does not know — naming them trips the Leak Guard. */
const COURIER: NpcId = 'npc:courier';
const AT: GameTime = { day: 1, phase: 0 };

const worksFor: PredicateDefinition = {
  id: 'WORKS_FOR',
  subject: ['npc', 'unk'],
  object: { entity: ['org'] },
  place: 'none',
  window: 'none',
  evaluator: 'fact-match',
  fieldCode: 'WF',
  render: {
    second: 'You work for {object}.',
    third: '{subject} works for {object}.',
  },
  extractorHint: 'A person works for an organisation.',
};

function registry(): PredicateRegistry {
  const result = compilePredicateRegistry([worksFor]);
  if (!result.ok) throw new Error('test predicate must compile');
  return result.registry;
}

function truthStore(): TruthStore {
  const kinds = new Map<string, EvaluatorKind>([['WORKS_FOR', 'fact-match']]);
  return TruthStore.create(kinds);
}

/** A persona carrying only the four fields the voice prompt reads. */
function persona(name: string): Persona {
  return {
    name,
    given: name,
    family: '',
    library: 'test',
    culture: 'test',
    gender: 'female',
    voiceTraits: ['measured'],
    mannerisms: ['keeps her hands still'],
    background: 'A contact in the old quarter.',
    openness: 0.5,
  };
}

/**
 * Build a minimal {@link WorldState} carrying only what the voice seam reads:
 * the open Talk Scene, the scene NPC's persona, the registered entities (so the
 * Leak Guard has surface forms), the player's known set (the fallback allowed
 * set), the Told List, the clock and the current Location. Everything else the
 * seam never touches, so a structural cast keeps the fixture small.
 *
 * `known` lists the entity ids the player (and, with the knowledge gap unfilled,
 * the NPC) may name; a registered entity outside it gates the stream. The secret
 * {@link COURIER} is registered but never in `known`, so a reply naming them
 * leaks.
 */
function worldWithScene(opts: {
  readonly sceneKind: SceneKind;
  readonly known?: readonly EntityId[];
}): WorldState {
  const scene: TalkScene = {
    npc: ANA,
    kind: opts.sceneKind,
    openedAt: AT,
    via: 'talk',
    recent: [],
  };
  const npcs = {
    [ANA]: { id: ANA, persona: persona('Ana Weiss') },
    [COURIER]: { id: COURIER, persona: persona('Dieter Falk') },
  };
  const state = {
    time: AT,
    city: { locations: { 'loc:cafe': { id: 'loc:cafe', name: 'The Café' } } },
    orgs: {},
    npcs,
    told: {},
    player: {
      loc: 'loc:cafe',
      known: { entities: new Set<EntityId>(opts.known ?? []) },
      unkIds: {},
      scene,
    },
  };
  return state as unknown as WorldState;
}

function deps(gateway: Gateway, state: WorldState, overrides?: Partial<LiveSeamDeps>): LiveSeamDeps {
  return {
    getState: () => state,
    predicates: registry(),
    ...overrides,
  };
}

const SCENE = { npc: ANA, speakerName: 'Ana Weiss' } as const;

// ---------------------------------------------------------------------------
// A scripted fake Gateway
// ---------------------------------------------------------------------------

/**
 * A {@link Gateway} fake for the voice seam: `stream` records the role it is
 * called on and yields the next scripted reply (so a regeneration gets a fresh
 * line), while `structured` serves the extraction runner a canned value or a
 * rejection. The replies are plain strings split into a couple of chunks so the
 * seam's token collection runs as it does live.
 */
class VoiceFakeGateway implements Gateway {
  /** Every role a `stream` call arrived on, in order. */
  readonly streamRoles: Role[] = [];
  private attempt = 0;

  constructor(
    private readonly replies: readonly string[],
    private readonly structuredBehaviour: { readonly value?: unknown; readonly reject?: boolean } = {},
  ) {}

  async *stream(role: Role, _input: CallInput, _options?: StreamOptions): AsyncIterable<string> {
    this.streamRoles.push(role);
    const i = Math.min(this.attempt, this.replies.length - 1);
    this.attempt += 1;
    const text = this.replies[i] ?? '';
    yield text.slice(0, Math.ceil(text.length / 2));
    yield text.slice(Math.ceil(text.length / 2));
  }

  structured<T>(_role: Role, _input: CallInput, schema: ZodType<T>): Promise<T> {
    if (this.structuredBehaviour.reject === true) {
      return Promise.reject(new Error('endpoint unreachable'));
    }
    return Promise.resolve().then(() => schema.parse(this.structuredBehaviour.value));
  }

  streamNarration(): NarrationStream {
    throw new Error('streamNarration not used by these tests');
  }
  describeCall<T>(
    kind: CallKind,
    role: Role,
    input: CallInput,
    _schema?: ZodType<T>,
  ): CallRequest {
    const messages = typeof input === 'string' ? [{ role: 'user' as const, content: input }] : input;
    return { kind, role, model: `fake-${role}`, messages, temperature: 0, maxTokens: 128 };
  }
}

/** Let the microtasks of a started extraction call drain. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function queuedJob(turnId: string): QueuedExtraction {
  return {
    turnId,
    speaker: ANA,
    utterance: 'I work for the collective.',
    at: AT,
    speakerKnowledgeAtTurn: { known: [], falseBeliefs: [], promote: [] },
    toldList: [],
    coverIntact: true,
  };
}

const validExtraction = {
  claims: [{ predicate: 'WORKS_FOR', subject: 'npc:ana', object: 'org:cell', hedged: false }],
};

// ---------------------------------------------------------------------------
// Role routing (Req 15.9)
// ---------------------------------------------------------------------------

describe('buildVoiceSeam role routing by scene stakes (Req 15.9)', () => {
  const cleanReply = 'I keep my voice low. Walk with me.';

  it.each<SceneKind>(['interrogation', 'recruitment-pitch', 'confront-double-agent'])(
    'routes a %s scene to the voice role',
    async (sceneKind) => {
      const gateway = new VoiceFakeGateway([cleanReply]);
      const voice = buildVoiceSeam(gateway, deps(gateway, worldWithScene({ sceneKind })));

      await voice('What do you know?', 'ask', SCENE);

      expect(gateway.streamRoles).toEqual(['voice']);
    },
  );

  it('routes a routine scene with a routine Intent to the fast role', async () => {
    const gateway = new VoiceFakeGateway([cleanReply]);
    const voice = buildVoiceSeam(gateway, deps(gateway, worldWithScene({ sceneKind: 'routine' })));

    await voice('Nice weather.', 'small-talk', SCENE);

    expect(gateway.streamRoles).toEqual(['fast']);
  });

  it.each<Intent>(['pitch-money', 'pitch-ideology', 'pitch-coercion', 'pitch-ego', 'confront'])(
    'routes a routine scene to voice when this turn is %s',
    async (intent) => {
      const gateway = new VoiceFakeGateway([cleanReply]);
      const voice = buildVoiceSeam(gateway, deps(gateway, worldWithScene({ sceneKind: 'routine' })));

      await voice('Work for us.', intent, SCENE);

      expect(gateway.streamRoles).toEqual(['voice']);
    },
  );

  it.each<Intent>(['ask', 'probe', 'reassure', 'threaten', 'task', 'small-talk', 'end'])(
    'keeps a routine scene on fast for the non-escalating Intent %s',
    async (intent) => {
      const gateway = new VoiceFakeGateway([cleanReply]);
      const voice = buildVoiceSeam(gateway, deps(gateway, worldWithScene({ sceneKind: 'routine' })));

      await voice('A line.', intent, SCENE);

      expect(gateway.streamRoles).toEqual(['fast']);
    },
  );
});

// ---------------------------------------------------------------------------
// Leak Guard retry then deflection (Req 16.4)
// ---------------------------------------------------------------------------

describe('buildVoiceSeam Leak Guard retry and deflection (Req 16.4)', () => {
  it('releases a clean first reply without regenerating', async () => {
    const gateway = new VoiceFakeGateway(['I know nothing of such people.']);
    const state = worldWithScene({ sceneKind: 'routine' });
    const voice = buildVoiceSeam(gateway, deps(gateway, state));

    const out = await voice('Who is the courier?', 'ask', SCENE);

    expect(out.released).toEqual(['I know nothing of such people.']);
    expect(out.speaker).toBe('Ana Weiss');
    // One generation only: no regeneration was needed.
    expect(gateway.streamRoles).toHaveLength(1);
  });

  it('regenerates under a stricter instruction and releases the clean retry', async () => {
    // The first reply names the secret courier (a leak); the regeneration is
    // clean, so the seam releases the recovered reply and never deflects.
    const gateway = new VoiceFakeGateway([
      'You mean Dieter Falk? I saw him last night.',
      'I keep to myself. Ask me nothing of others.',
    ]);
    const state = worldWithScene({ sceneKind: 'routine' });
    const voice = buildVoiceSeam(gateway, deps(gateway, state, { leakGuardRetries: 2 }));

    const out = await voice('Who did you meet?', 'ask', SCENE);

    expect(out.released).toEqual(['I keep to myself.', 'Ask me nothing of others.']);
    expect(out.released).not.toContain(DEFLECTION_LINE);
    // Two generations: the leaking first attempt plus one regeneration.
    expect(gateway.streamRoles).toHaveLength(2);
  });

  it('deflects to the persona line once the retries are exhausted', async () => {
    // Every attempt leaks the secret courier, so after the retry budget the
    // seam substitutes the deflection line (Sim-authored, released as-is).
    const leaking = 'Dieter Falk was there.';
    const gateway = new VoiceFakeGateway([leaking, leaking, leaking]);
    const state = worldWithScene({ sceneKind: 'routine' });
    const voice = buildVoiceSeam(gateway, deps(gateway, state, { leakGuardRetries: 2 }));

    const out = await voice('Who was there?', 'ask', SCENE);

    expect(out.released).toEqual([DEFLECTION_LINE]);
    // The first attempt plus the two allowed regenerations: three in all.
    expect(gateway.streamRoles).toHaveLength(3);
  });

  it('deflects on the first leak when no retries are allowed', async () => {
    const gateway = new VoiceFakeGateway(['Dieter Falk was there.']);
    const state = worldWithScene({ sceneKind: 'routine' });
    const voice = buildVoiceSeam(gateway, deps(gateway, state, { leakGuardRetries: 0 }));

    const out = await voice('Who was there?', 'ask', SCENE);

    expect(out.released).toEqual([DEFLECTION_LINE]);
    expect(gateway.streamRoles).toHaveLength(1);
  });

  it('lets the NPC name an entity in the allowed known set freely', async () => {
    // The courier is now in the player's (and so the NPC's fallback) known set,
    // so naming them is no longer a leak and the reply is released clean.
    const gateway = new VoiceFakeGateway(['Dieter Falk was there, as always.']);
    const state = worldWithScene({ sceneKind: 'routine', known: [COURIER as EntityId] });
    const voice = buildVoiceSeam(gateway, deps(gateway, state));

    const out = await voice('Who was there?', 'ask', SCENE);

    expect(out.released).toEqual(['Dieter Falk was there, as always.']);
    expect(gateway.streamRoles).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// classify seam (Req 15.9 companion — routing's input)
// ---------------------------------------------------------------------------

describe('buildClassifySeam', () => {
  it('classifies a line through the structured fast path to a legal Intent', async () => {
    const gateway = new VoiceFakeGateway([], { value: { intent: 'probe' } });
    const classify = buildClassifySeam(gateway);

    await expect(classify('Where were you on Tuesday?')).resolves.toBe('probe');
  });
});

// ---------------------------------------------------------------------------
// Extraction start/ready through the bundle (Req 17.1, 17.3)
// ---------------------------------------------------------------------------

describe('buildLiveSeams bundle', () => {
  it('exposes all four seams and the deflection line', () => {
    const gateway = new VoiceFakeGateway([]);
    const bundle = buildLiveSeams(gateway, deps(gateway, worldWithScene({ sceneKind: 'routine' })));

    expect(typeof bundle.classify).toBe('function');
    expect(typeof bundle.voice).toBe('function');
    expect(typeof bundle.narrate).toBe('function');
    expect(typeof bundle.extraction.start).toBe('function');
    expect(typeof bundle.extraction.ready).toBe('function');
    expect(bundle.deflectionLine).toBe(DEFLECTION_LINE);
  });

  it('wires an extraction runner that runs bookkeeping and reports parsed (Req 17.1)', async () => {
    const gateway = new VoiceFakeGateway([], { value: validExtraction });
    const bundle = buildLiveSeams(
      gateway,
      deps(gateway, worldWithScene({ sceneKind: 'routine' }), { truth: truthStore() }),
    );
    const job = queuedJob('turn:0');

    bundle.extraction.start(job);
    expect(bundle.extraction.ready(job)).toBe('pending');

    await flush();

    const ready = bundle.extraction.ready(job);
    if (typeof ready === 'string' || ready.kind !== 'parsed') {
      throw new Error('expected a parsed result');
    }
    expect(ready.result.claims).toEqual([
      { predicate: 'WORKS_FOR', subject: 'npc:ana', object: 'org:cell', hedged: false },
    ]);
  });
});

describe('buildExtractionRunner unparsed fallback (Req 17.3)', () => {
  it('reports an unparsed note carrying the utterance when the reply fails the schema', async () => {
    const gateway = new VoiceFakeGateway([], { value: { not: 'valid' } });
    const state = worldWithScene({ sceneKind: 'routine' });
    const runner = buildExtractionRunner(gateway, deps(gateway, state, { truth: truthStore() }));
    const job = queuedJob('turn:0');

    runner.start(job);
    await flush();

    const ready = runner.ready(job);
    if (typeof ready === 'string' || ready.kind !== 'unparsed') {
      throw new Error('expected an unparsed note');
    }
    expect(ready.excerpt).toBe('I work for the collective.');
  });
});

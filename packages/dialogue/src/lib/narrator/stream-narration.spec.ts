import { EntityRegistry, type EntityEntry, type EntityId } from '@tradecraft/engine';

import {
  checkLeak,
  type LeakContext,
} from '../leak-guard/leak-guard.js';
import type { SpecificsContext } from '../specifics-guard/specifics-guard.js';
import {
  DEFAULT_MAX_SENTENCES,
  specificsPhaseFromOrdinal,
  streamNarration,
  type NarrationMode,
  type NarrationOptions,
  type StreamRequest,
  type StreamSource,
} from './stream-narration.js';

/**
 * A small world: the mole and the safehouse are secrets the Leak Guard must
 * protect; the Pier carries a generic alias that never gates. Mira is the
 * unknown person the Narrator must never name.
 */
const entries: EntityEntry[] = [
  {
    id: 'npc:viktor',
    canonicalName: 'Viktor Lang',
    aliases: [{ text: 'Herr Lang', distinctive: true }],
  },
  { id: 'npc:mira', canonicalName: 'Mira', aliases: [] },
  {
    id: 'loc:safehouse',
    canonicalName: 'The Lindengasse flat',
    aliases: [{ text: 'the safehouse', distinctive: true }],
  },
];

const registry = EntityRegistry.from(entries);

/** A Leak Guard context allowing exactly the ids passed. */
function leak(allowed: EntityId[] = []): LeakContext {
  return { registry, allowed };
}

/** A Specifics Guard context allowing only its given Fact Lines/descriptor. */
function specifics(overrides: Partial<SpecificsContext> = {}): SpecificsContext {
  return {
    factLines: [],
    sceneDescriptor: '',
    phase: 'afternoon',
    ...overrides,
  };
}

/** Build narration options from a mode plus optional guard-context overrides. */
function options(
  mode: NarrationMode,
  overrides: Partial<NarrationOptions> = {},
): NarrationOptions {
  return {
    mode,
    leak: leak(['npc:viktor']),
    specifics: specifics(),
    ...overrides,
  };
}

/**
 * A faked stream source. Each call returns the next scripted candidate as a
 * token stream (chunked a few characters at a time, to prove the loop
 * reassembles tokens before splitting). It records the requests it received so
 * tests can assert attempts and the reinforced violation class.
 */
function scriptedSource(candidates: string[]): {
  source: StreamSource;
  readonly requests: StreamRequest[];
  readonly calls: () => number;
} {
  const requests: StreamRequest[] = [];
  let index = 0;
  const source: StreamSource = (request) => {
    requests.push(request);
    const text = candidates[Math.min(index, candidates.length - 1)];
    index += 1;
    return (async function* chunk(): AsyncGenerator<string> {
      for (let i = 0; i < text.length; i += 3) {
        yield text.slice(i, i + 3);
      }
    })();
  };
  return { source, requests, calls: () => requests.length };
}

describe('streamNarration — off mode (Req 20.8)', () => {
  it('returns Fact Lines only and never calls the source', async () => {
    let called = false;
    const source: StreamSource = () => {
      called = true;
      return (async function* () {
        yield 'The room is warm.';
      })();
    };

    const result = await streamNarration(
      ['You enter the café.', 'You order coffee.'],
      source,
      options('off'),
    );

    expect(called).toBe(false);
    expect(result.status).toBe('off');
    expect(result.flavour).toEqual([]);
    expect(result.factLines).toEqual(['You enter the café.', 'You order coffee.']);
    expect(result.regenerations).toBe(0);
  });
});

describe('streamNarration — full mode clean release (Req 15.5, 20.3)', () => {
  it('prints Fact Lines first, then releases clean Flavour', async () => {
    const { source, calls } = scriptedSource([
      'The café is warm. Rain streaks the glass. A kettle hisses somewhere.',
    ]);

    const result = await streamNarration(['You enter the café.'], source, options('full'));

    expect(result.factLines).toEqual(['You enter the café.']);
    expect(result.status).toBe('flavour');
    expect(result.flavour).toEqual([
      'The café is warm.',
      'Rain streaks the glass.',
      'A kettle hisses somewhere.',
    ]);
    expect(result.regenerations).toBe(0);
    expect(calls()).toBe(1);
  });

  it('may name an allowed entity freely', async () => {
    const { source } = scriptedSource(['Herr Lang stands by the window.']);
    // The real pipeline threads the known-entity aliases into the Specifics
    // Guard's allowed-name set, so a known name is not read as an invented one.
    const result = await streamNarration(
      [],
      source,
      options('full', { specifics: specifics({ allowedWords: ['Herr', 'Lang'] }) }),
    );
    expect(result.status).toBe('flavour');
    expect(result.flavour).toEqual(['Herr Lang stands by the window.']);
  });

  it('caps full mode at three sentences by default', async () => {
    const { source } = scriptedSource([
      'The air is still. The light is low. The floor creaks. The door is shut.',
    ]);

    const result = await streamNarration([], source, options('full'));
    expect(result.flavour).toHaveLength(DEFAULT_MAX_SENTENCES);
    expect(result.flavour).toEqual([
      'The air is still.',
      'The light is low.',
      'The floor creaks.',
    ]);
    expect(result.status).toBe('flavour');
  });

  it('honours a custom maxSentences cap', async () => {
    const { source } = scriptedSource([
      'The air is still. The light is low. The floor creaks.',
    ]);
    const result = await streamNarration([], source, options('full', { maxSentences: 2 }));
    expect(result.flavour).toEqual(['The air is still.', 'The light is low.']);
  });
});

describe('streamNarration — brief mode', () => {
  it('caps released Flavour at one sentence', async () => {
    const { source } = scriptedSource([
      'The café is warm. Rain streaks the glass. A kettle hisses.',
    ]);
    const result = await streamNarration([], source, options('brief'));
    expect(result.status).toBe('flavour');
    expect(result.flavour).toEqual(['The café is warm.']);
  });
});

describe('streamNarration — Leak Guard gating and regenerate-once (Req 20.5)', () => {
  it('regenerates once naming the class, then releases the clean retry', async () => {
    const { source, requests } = scriptedSource([
      'Mira waits in the corner.', // names an unknown entity -> leak trip
      'A woman waits in the corner.', // clean
    ]);

    const result = await streamNarration([], source, options('full'));

    expect(result.status).toBe('flavour');
    expect(result.flavour).toEqual(['A woman waits in the corner.']);
    expect(result.regenerations).toBe(1);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual({ attempt: 0, violationClass: undefined });
    expect(requests[1]).toEqual({ attempt: 1, violationClass: 'unknown-entity' });
  });

  it('discards the rest of the Flavour after a mid-stream leak', async () => {
    const { source } = scriptedSource([
      'The hall is quiet. The safehouse door is ajar. A clock ticks.',
      'The hall is quiet. A door is ajar.',
    ]);
    const result = await streamNarration([], source, options('full'));
    // First attempt releases nothing past the leaking second sentence; the
    // clean retry is what reaches the player.
    expect(result.status).toBe('flavour');
    expect(result.flavour).toEqual(['The hall is quiet.', 'A door is ajar.']);
    expect(result.regenerations).toBe(1);
  });

  it('falls back to fact-only when the regeneration also leaks', async () => {
    const { source, requests } = scriptedSource([
      'Mira waits by the door.',
      'The safehouse is nearby.',
    ]);
    const result = await streamNarration(
      ['You arrive at the corner.'],
      source,
      options('full'),
    );
    expect(result.status).toBe('fact-only');
    expect(result.flavour).toEqual([]);
    expect(result.factLines).toEqual(['You arrive at the corner.']);
    expect(result.regenerations).toBe(1);
    expect(requests).toHaveLength(2);
  });
});

describe('streamNarration — Specifics Guard gating (Req 20.5)', () => {
  it('regenerates on an invented numeral, naming the specifics class', async () => {
    const { source, requests } = scriptedSource([
      'You count 3 figures by the wall.', // numeral -> specifics trip
      'You count the figures by the wall.',
    ]);
    const result = await streamNarration([], source, options('full'));
    expect(result.status).toBe('flavour');
    expect(result.flavour).toEqual(['You count the figures by the wall.']);
    expect(requests[1]).toEqual({ attempt: 1, violationClass: 'numeral' });
  });

  it('allows a numeral that appears verbatim in the Fact Lines', async () => {
    const { source } = scriptedSource(['You see 3 crates stacked by the door.']);
    const result = await streamNarration(
      ['3 crates sit by the door.'],
      source,
      options('full', { specifics: specifics({ factLines: ['3 crates sit by the door.'] }) }),
    );
    expect(result.status).toBe('flavour');
    expect(result.flavour).toEqual(['You see 3 crates stacked by the door.']);
  });

  it('goes fact-only when both attempts invent specifics', async () => {
    const { source } = scriptedSource([
      'It is Tuesday morning.',
      'You arrive at 9:15.',
    ]);
    const result = await streamNarration(['You arrive.'], source, options('full'));
    expect(result.status).toBe('fact-only');
    expect(result.flavour).toEqual([]);
    expect(result.factLines).toEqual(['You arrive.']);
  });
});

describe('streamNarration — Narrator failure and timeout (Req 16.5)', () => {
  it('goes fact-only without pausing when the source throws', async () => {
    const source: StreamSource = () => {
      throw new Error('endpoint unreachable');
    };
    const result = await streamNarration(['You enter the room.'], source, options('full'));
    expect(result.status).toBe('failed');
    expect(result.flavour).toEqual([]);
    expect(result.factLines).toEqual(['You enter the room.']);
    expect(result.regenerations).toBe(0);
  });

  it('goes fact-only when the source rejects (e.g. a timeout)', async () => {
    const source: StreamSource = () => Promise.reject(new Error('timeout'));
    const result = await streamNarration(['You enter the room.'], source, options('full'));
    expect(result.status).toBe('failed');
    expect(result.factLines).toEqual(['You enter the room.']);
  });

  it('goes fact-only when the stream errors mid-iteration', async () => {
    const source: StreamSource = () =>
      (async function* () {
        yield 'The room is ';
        throw new Error('stream broke');
      })();
    const result = await streamNarration(['You enter the room.'], source, options('full'));
    expect(result.status).toBe('failed');
    expect(result.factLines).toEqual(['You enter the room.']);
  });
});

describe('streamNarration — containment groundwork (Property 15)', () => {
  it('every released sentence passes the Leak Guard against the known set', async () => {
    const { source } = scriptedSource([
      'The café is warm. Herr Lang nods. Rain falls on the glass.',
    ]);
    const opts = options('full', {
      specifics: specifics({ allowedWords: ['Herr', 'Lang'] }),
    });
    const result = await streamNarration([], source, opts);
    expect(result.status).toBe('flavour');
    for (const sentence of result.flavour) {
      expect(checkLeak(sentence, opts.leak).ok).toBe(true);
    }
  });
});

describe('specificsPhaseFromOrdinal', () => {
  it('maps phase ordinals to the Specifics Guard phase names', () => {
    expect(specificsPhaseFromOrdinal(0)).toBe('morning');
    expect(specificsPhaseFromOrdinal(1)).toBe('afternoon');
    expect(specificsPhaseFromOrdinal(2)).toBe('evening');
    expect(specificsPhaseFromOrdinal(3)).toBe('night');
  });
});

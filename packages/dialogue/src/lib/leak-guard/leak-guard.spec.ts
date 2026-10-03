import { EntityRegistry, type EntityEntry, type EntityId } from '@tradecraft/engine';

import {
  checkLeak,
  guardStream,
  splitSentences,
  type LeakContext,
  type RegenerateRequest,
} from './leak-guard.js';

/**
 * A small world of registered entities. Viktor and the Pier carry generic
 * aliases ("the man", "pier") that must never gate; the Safehouse and the mole
 * are the secrets the guard protects.
 */
const entries: EntityEntry[] = [
  {
    id: 'npc:viktor',
    canonicalName: 'Viktor Lang',
    aliases: [
      { text: 'Herr Lang', distinctive: true },
      { text: 'the man', distinctive: false },
    ],
  },
  {
    id: 'npc:mira',
    canonicalName: 'Mira',
    aliases: [],
  },
  {
    id: 'loc:pier',
    canonicalName: 'The Pier',
    aliases: [{ text: 'pier', distinctive: false }],
  },
  {
    id: 'loc:safehouse',
    canonicalName: 'The Lindengasse flat',
    aliases: [{ text: 'the safehouse', distinctive: true }],
  },
  {
    id: 'org:raven',
    canonicalName: 'Raven',
    aliases: [],
  },
];

const registry = EntityRegistry.from(entries);

/** A context allowing exactly the ids passed (nothing by default). */
function context(allowed: EntityId[] = []): LeakContext {
  return { registry, allowed };
}

describe('checkLeak — membership', () => {
  it('passes a sentence naming only allowed entities', () => {
    const result = checkLeak('Viktor Lang waited by the door.', context(['npc:viktor']));
    expect(result.ok).toBe(true);
    expect(result.hits).toEqual([]);
  });

  it('flags an entity outside the allowed set by its canonical name', () => {
    const result = checkLeak('He mentioned Mira once.', context([]));
    expect(result.ok).toBe(false);
    expect(result.hits).toEqual([{ entity: 'npc:mira', alias: 'Mira' }]);
  });

  it('flags an entity by a distinctive alias', () => {
    const result = checkLeak('Ask Herr Lang about it.', context([]));
    expect(result.ok).toBe(false);
    expect(result.hits).toEqual([{ entity: 'npc:viktor', alias: 'Herr Lang' }]);
  });

  it('does not flag an allowed entity named by its alias', () => {
    expect(checkLeak('Herr Lang nodded.', context(['npc:viktor'])).ok).toBe(true);
  });
});

describe('checkLeak — distinctive vs generic', () => {
  it('never flags a generic alias even for an unknown entity', () => {
    // "the man" is generic for npc:viktor; the bare word "pier" is generic for
    // loc:pier (its distinctive form is the canonical "The Pier").
    const result = checkLeak('The man leaned on a pier post.', context([]));
    expect(result.ok).toBe(true);
  });

  it('flags the distinctive canonical name of the same location', () => {
    const result = checkLeak('They met at the Pier.', context([]));
    expect(result.hits).toEqual([{ entity: 'loc:pier', alias: 'The Pier' }]);
  });
});

describe('checkLeak — whole-word, case-insensitive matching', () => {
  it('matches regardless of case', () => {
    expect(checkLeak('mira was there.', context([])).hits).toEqual([
      { entity: 'npc:mira', alias: 'Mira' },
    ]);
  });

  it('does not match an alias embedded in a larger word', () => {
    // "Mira" must not fire inside "admiral".
    expect(checkLeak('The admiral left early.', context([])).ok).toBe(true);
  });

  it('matches a name touching punctuation', () => {
    expect(checkLeak('And then, Mira?', context([])).hits).toEqual([
      { entity: 'npc:mira', alias: 'Mira' },
    ]);
  });

  it('matches a multi-word distinctive alias', () => {
    expect(checkLeak('They used the safehouse.', context([])).hits).toEqual([
      { entity: 'loc:safehouse', alias: 'the safehouse' },
    ]);
  });
});

describe('checkLeak — multiple hits', () => {
  it('reports every out-of-set entity named, in registry order', () => {
    const result = checkLeak('Mira and Raven both knew.', context([]));
    expect(result.hits).toEqual([
      { entity: 'npc:mira', alias: 'Mira' },
      { entity: 'org:raven', alias: 'Raven' },
    ]);
  });

  it('reports one hit per entity even if two of its aliases match', () => {
    const result = checkLeak('Viktor Lang, that is, Herr Lang.', context([]));
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].entity).toBe('npc:viktor');
  });
});

describe('splitSentences', () => {
  it('splits on sentence terminators', () => {
    expect(splitSentences('One. Two! Three?')).toEqual(['One.', 'Two!', 'Three?']);
  });

  it('splits on newlines', () => {
    expect(splitSentences('Line one\nLine two')).toEqual(['Line one', 'Line two']);
  });

  it('keeps a final fragment with no terminator', () => {
    expect(splitSentences('A finished one. And a trailing bit')).toEqual([
      'A finished one.',
      'And a trailing bit',
    ]);
  });

  it('keeps a trailing closing quote with its sentence', () => {
    expect(splitSentences('"Go now."')).toEqual(['"Go now."']);
  });

  it('discards empty pieces and trims whitespace', () => {
    expect(splitSentences('  Hello.   \n\n ')).toEqual(['Hello.']);
  });
});

// ---------------------------------------------------------------------------
// guardStream — the regenerate / deflection loop
// ---------------------------------------------------------------------------

/** A regenerate function that returns one canned string per attempt. */
function scripted(...attempts: string[]) {
  const calls: RegenerateRequest[] = [];
  const fn = (request: RegenerateRequest): string => {
    calls.push(request);
    return attempts[request.attempt] ?? '';
  };
  return { fn, calls };
}

const DEFLECTION = 'I have nothing to say about that.';

describe('guardStream — clean first attempt', () => {
  it('releases every sentence when the first reply is clean', async () => {
    const { fn, calls } = scripted('Herr Lang shrugged. He said little.');
    const outcome = await guardStream(context(['npc:viktor']), fn, {
      deflectionLine: DEFLECTION,
      retryLimit: 2,
    });
    expect(outcome.outcome).toBe('clean');
    expect(outcome.released).toEqual(['Herr Lang shrugged.', 'He said little.']);
    expect(outcome.regenerations).toBe(0);
    expect(outcome.hits).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0].violationClass).toBeUndefined();
  });
});

describe('guardStream — regeneration on a hit', () => {
  it('discards the rest of the turn on a hit and regenerates', async () => {
    // First reply leaks Mira in the second sentence; the retry is clean.
    const { fn, calls } = scripted(
      'He was quiet. Then he named Mira.',
      'He was quiet. He named no one.',
    );
    const outcome = await guardStream(context([]), fn, {
      deflectionLine: DEFLECTION,
      retryLimit: 2,
    });
    expect(outcome.outcome).toBe('clean');
    expect(outcome.released).toEqual(['He was quiet.', 'He named no one.']);
    expect(outcome.regenerations).toBe(1);
    // The hit from the first attempt is reported for logging.
    expect(outcome.hits).toEqual([{ entity: 'npc:mira', alias: 'Mira' }]);
    expect(calls).toHaveLength(2);
    // The regeneration names the violation class, not the entity.
    expect(calls[1].violationClass).toBe('unknown-entity');
  });
});

describe('guardStream — deflection when retries exhausted', () => {
  it('deflects after the retry limit and reports every hit', async () => {
    const { fn, calls } = scripted(
      'Mira knew.',
      'Mira still.',
      'Raven then.',
    );
    const outcome = await guardStream(context([]), fn, {
      deflectionLine: DEFLECTION,
      retryLimit: 2,
    });
    expect(outcome.outcome).toBe('deflected');
    expect(outcome.released).toEqual([DEFLECTION]);
    expect(outcome.regenerations).toBe(2);
    expect(outcome.hits).toEqual([
      { entity: 'npc:mira', alias: 'Mira' },
      { entity: 'npc:mira', alias: 'Mira' },
      { entity: 'org:raven', alias: 'Raven' },
    ]);
    // 1 first attempt + 2 regenerations.
    expect(calls).toHaveLength(3);
  });

  it('deflects immediately with a retry limit of 0', async () => {
    const { fn, calls } = scripted('Mira knew.', 'clean but never reached');
    const outcome = await guardStream(context([]), fn, {
      deflectionLine: DEFLECTION,
      retryLimit: 0,
    });
    expect(outcome.outcome).toBe('deflected');
    expect(outcome.released).toEqual([DEFLECTION]);
    expect(outcome.regenerations).toBe(0);
    expect(calls).toHaveLength(1);
  });
});

describe('guardStream — configurable allowed set', () => {
  it('does not trip when the leaked entity is in the allowed set', async () => {
    const { fn } = scripted('Mira knew everything.');
    const outcome = await guardStream(context(['npc:mira']), fn, {
      deflectionLine: DEFLECTION,
      retryLimit: 2,
    });
    expect(outcome.outcome).toBe('clean');
    expect(outcome.released).toEqual(['Mira knew everything.']);
  });

  it('defaults the retry limit to 2 when unspecified', async () => {
    const { fn, calls } = scripted(
      'Mira one.',
      'Mira two.',
      'Mira three.',
      'clean never reached',
    );
    const outcome = await guardStream(context([]), fn, {
      deflectionLine: DEFLECTION,
    });
    expect(outcome.outcome).toBe('deflected');
    // 1 first attempt + 2 default regenerations.
    expect(calls).toHaveLength(3);
  });
});

describe('guardStream — async regenerate', () => {
  it('awaits a promise-returning regenerate function', async () => {
    const outcome = await guardStream(
      context(['npc:viktor']),
      () => Promise.resolve('Herr Lang said nothing.'),
      { deflectionLine: DEFLECTION, retryLimit: 2 },
    );
    expect(outcome.outcome).toBe('clean');
    expect(outcome.released).toEqual(['Herr Lang said nothing.']);
  });
});

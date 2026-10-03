import {
  classifyReply,
  guardReply,
  DEFAULT_REFUSAL_RETRY_LIMIT,
  type RegenerateReplyRequest,
  type ReplyVerdict,
} from './refusal-guard.js';

// ---------------------------------------------------------------------------
// classifyReply — the pure heuristic
// ---------------------------------------------------------------------------

describe('classifyReply — in-character replies', () => {
  it('passes ordinary in-character speech', () => {
    expect(classifyReply('You again. Sit down and keep your voice low.')).toBe(
      'in-character',
    );
  });

  it('does not flag an in-fiction refusal of a request', () => {
    // The character declining inside the fiction is not a model refusal: it
    // speaks in the second person about the world, not about helping.
    expect(classifyReply("I won't tell you where he is. Not for that price.")).toBe(
      'in-character',
    );
  });

  it('does not flag the word "ai" inside an ordinary word', () => {
    expect(classifyReply('The waiter brought the bill and waited.')).toBe(
      'in-character',
    );
  });
});

describe('classifyReply — refusals', () => {
  it.each([
    "I can't help with that.",
    'I cannot assist with that request.',
    "I'm sorry, but I can't continue with this.",
    'I must decline.',
    "I won't roleplay this.",
    'I cannot comply with that.',
  ])('classifies %j as a refusal', (reply) => {
    expect(classifyReply(reply)).toBe('refusal');
  });

  it('treats an empty reply as a refusal', () => {
    expect(classifyReply('')).toBe('refusal');
    expect(classifyReply('   \n  ')).toBe('refusal');
  });

  it('matches regardless of case and curly apostrophes', () => {
    expect(classifyReply('I CAN\u2019T HELP WITH THAT.')).toBe('refusal');
  });
});

describe('classifyReply — meta-responses', () => {
  it.each([
    'As an AI language model, I cannot have opinions.',
    "I'm an AI and I don't have feelings or opinions.",
    'In this roleplay, you are asking me to play a spy.',
    'Remember, this is a game, so none of it is real.',
    'Is there anything else I can help you with?',
    'My training data does not cover that.',
  ])('classifies %j as meta', (reply) => {
    expect(classifyReply(reply)).toBe('meta');
  });

  it('prefers refusal when a reply both refuses and goes meta', () => {
    // "I can't help with that" (refusal) also contains "as an ai" (meta); the
    // more specific refusal wins so the logged reason is the decline.
    expect(
      classifyReply("I can't help with that. As an AI, I must decline."),
    ).toBe('refusal');
  });
});

describe('classifyReply — uncertain replies', () => {
  it.each([
    "I'm sorry, but the streets are quiet tonight.",
    "I'm not sure I should be the one to say.",
    'It would not be appropriate to meet there.',
  ])('classifies %j as uncertain', (reply) => {
    expect(classifyReply(reply)).toBe('uncertain');
  });
});

// ---------------------------------------------------------------------------
// guardReply — the retry-under-reinforced-frame / deflection loop
// ---------------------------------------------------------------------------

/** A regenerate function returning one canned string per attempt. */
function scripted(...attempts: string[]) {
  const calls: RegenerateReplyRequest[] = [];
  const fn = (request: RegenerateReplyRequest): string => {
    calls.push(request);
    return attempts[request.attempt] ?? '';
  };
  return { fn, calls };
}

const DEFLECTION = 'He studies you a moment, then says nothing.';

describe('guardReply — clean first attempt', () => {
  it('releases a reply that reads in character on the first attempt', async () => {
    const { fn, calls } = scripted('You again. What do you want?');
    const outcome = await guardReply(fn, {
      deflectionLine: DEFLECTION,
      retryLimit: 1,
    });
    expect(outcome.outcome).toBe('clean');
    expect(outcome.released).toBe('You again. What do you want?');
    expect(outcome.regenerations).toBe(0);
    expect(outcome.breaks).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0].breakClass).toBeUndefined();
  });
});

describe('guardReply — retry under a reinforced frame', () => {
  it('retries once on a refusal and releases the clean retry', async () => {
    const { fn, calls } = scripted(
      "I can't help with that.",
      'You again. Keep your voice down.',
    );
    const outcome = await guardReply(fn, {
      deflectionLine: DEFLECTION,
      retryLimit: 1,
    });
    expect(outcome.outcome).toBe('clean');
    expect(outcome.released).toBe('You again. Keep your voice down.');
    expect(outcome.regenerations).toBe(1);
    expect(outcome.breaks).toEqual(['refusal']);
    expect(calls).toHaveLength(2);
    // The regeneration names the break class so the caller can reinforce the
    // fiction frame — never the model's text.
    expect(calls[1].breakClass).toBe('refusal');
  });

  it('retries once on a meta-response and reports the meta class', async () => {
    const { fn, calls } = scripted(
      'As an AI, I cannot pretend to be a person.',
      'The Kaffeehaus is half empty. Sit.',
    );
    const outcome = await guardReply(fn, {
      deflectionLine: DEFLECTION,
      retryLimit: 1,
    });
    expect(outcome.outcome).toBe('clean');
    expect(outcome.breaks).toEqual(['meta']);
    expect(calls[1].breakClass).toBe('meta');
  });
});

describe('guardReply — deflection when retries exhausted', () => {
  it('deflects when the retry still breaks character', async () => {
    const { fn, calls } = scripted(
      "I can't help with that.",
      'As an AI language model I must decline.',
    );
    const outcome = await guardReply(fn, {
      deflectionLine: DEFLECTION,
      retryLimit: 1,
    });
    expect(outcome.outcome).toBe('deflected');
    expect(outcome.released).toBe(DEFLECTION);
    expect(outcome.regenerations).toBe(1);
    // The second attempt matches the refusal "i must decline" before the meta
    // phrase is checked, so both logged breaks are refusals.
    expect(outcome.breaks).toEqual(['refusal', 'refusal']);
    expect(calls).toHaveLength(2);
  });

  it('deflects immediately with a retry limit of 0', async () => {
    const { fn, calls } = scripted(
      "I can't help with that.",
      'clean but never reached',
    );
    const outcome = await guardReply(fn, {
      deflectionLine: DEFLECTION,
      retryLimit: 0,
    });
    expect(outcome.outcome).toBe('deflected');
    expect(outcome.released).toBe(DEFLECTION);
    expect(outcome.regenerations).toBe(0);
    expect(outcome.breaks).toEqual(['refusal']);
    expect(calls).toHaveLength(1);
  });

  it('defaults the retry limit to 1 when unspecified', async () => {
    const { fn, calls } = scripted(
      "I can't help with that.",
      'I must decline.',
      'clean never reached',
    );
    const outcome = await guardReply(fn, { deflectionLine: DEFLECTION });
    expect(DEFAULT_REFUSAL_RETRY_LIMIT).toBe(1);
    expect(outcome.outcome).toBe('deflected');
    // 1 first attempt + 1 default regeneration.
    expect(calls).toHaveLength(2);
  });
});

describe('guardReply — confirmer consulted only on uncertain', () => {
  it('does not call the confirmer when the heuristic is decisive', async () => {
    const confirm = vi.fn<(reply: string) => ReplyVerdict>(() => 'in-character');
    const { fn } = scripted('You again. Sit down.');
    const outcome = await guardReply(fn, {
      deflectionLine: DEFLECTION,
      retryLimit: 1,
      confirm,
    });
    expect(outcome.outcome).toBe('clean');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('releases an uncertain reply the confirmer calls in character', async () => {
    const confirm = vi.fn<(reply: string) => ReplyVerdict>(() => 'in-character');
    const { fn } = scripted("I'm sorry, but the streets are quiet tonight.");
    const outcome = await guardReply(fn, {
      deflectionLine: DEFLECTION,
      retryLimit: 1,
      confirm,
    });
    expect(outcome.outcome).toBe('clean');
    expect(outcome.released).toBe("I'm sorry, but the streets are quiet tonight.");
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(outcome.breaks).toEqual([]);
  });

  it('retries an uncertain reply the confirmer calls a break', async () => {
    const confirm = vi.fn<(reply: string) => ReplyVerdict>(() => 'refusal');
    const { fn, calls } = scripted(
      "I'm sorry, but I don't think I should.",
      'You again. What do you want?',
    );
    const outcome = await guardReply(fn, {
      deflectionLine: DEFLECTION,
      retryLimit: 1,
      confirm,
    });
    expect(outcome.outcome).toBe('clean');
    expect(outcome.released).toBe('You again. What do you want?');
    expect(outcome.breaks).toEqual(['refusal']);
    expect(calls[1].breakClass).toBe('refusal');
  });

  it('treats an uncertain reply as in character when no confirmer is given', async () => {
    const { fn } = scripted("I'm sorry, but the tram was late.");
    const outcome = await guardReply(fn, {
      deflectionLine: DEFLECTION,
      retryLimit: 1,
    });
    expect(outcome.outcome).toBe('clean');
    expect(outcome.released).toBe("I'm sorry, but the tram was late.");
  });
});

describe('guardReply — async injections', () => {
  it('awaits promise-returning regenerate and confirm functions', async () => {
    const outcome = await guardReply(
      () => Promise.resolve("I'm sorry, but it is late."),
      {
        deflectionLine: DEFLECTION,
        retryLimit: 1,
        confirm: () => Promise.resolve('in-character'),
      },
    );
    expect(outcome.outcome).toBe('clean');
    expect(outcome.released).toBe("I'm sorry, but it is late.");
  });
});

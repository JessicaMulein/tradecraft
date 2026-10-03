import fc from 'fast-check';

import {
  checkSpecifics,
  type Phase,
  type SpecificsContext,
  type ViolationClass,
} from './specifics-guard.js';

/**
 * A context that allows nothing by default: empty Fact Lines and descriptor,
 * phase fixed to afternoon. Tests opt in to the allowance by overriding.
 */
function context(overrides: Partial<SpecificsContext> = {}): SpecificsContext {
  return {
    factLines: [],
    sceneDescriptor: '',
    phase: 'afternoon',
    ...overrides,
  };
}

/** The classes reported for a sentence, in order. */
function classes(sentence: string, ctx = context()): ViolationClass[] {
  return checkSpecifics(sentence, ctx).violations.map((v) => v.class);
}

describe('checkSpecifics — numerals', () => {
  it('rejects a bare digit', () => {
    expect(classes('He counted 3 crates.')).toEqual(['numeral']);
  });

  it('rejects a multi-digit number and an ordinal', () => {
    expect(classes('The 1945 ledger sat on the 12th shelf.')).toEqual([
      'numeral',
      'numeral',
    ]);
  });

  it('passes a sentence with no numbers at all', () => {
    expect(checkSpecifics('The room smelled of damp wool.', context()).ok).toBe(
      true,
    );
  });
});

describe('checkSpecifics — number words', () => {
  it('rejects a spelled-out count', () => {
    expect(classes('Three men waited by the door.')).toEqual(['number-word']);
  });

  it('rejects larger magnitude words', () => {
    expect(classes('A dozen gulls and a hundred crates.')).toEqual([
      'number-word',
      'number-word',
    ]);
  });

  it('rejects "one" used as a genuine count', () => {
    expect(classes('one coat hung by the door.')).toEqual(['number-word']);
  });

  it('allows "one" in pronoun idioms', () => {
    expect(checkSpecifics('No one answered the door.', context()).ok).toBe(
      true,
    );
    expect(checkSpecifics('Someone had been here.', context()).ok).toBe(true);
    expect(checkSpecifics('Every one of them left.', context()).ok).toBe(true);
  });
});

describe('checkSpecifics — weekdays', () => {
  it('rejects a weekday name', () => {
    expect(classes('The market was quiet on Tuesday.')).toEqual(['weekday']);
  });

  it('matches regardless of case', () => {
    expect(classes('rain fell all friday.')).toEqual(['weekday']);
  });
});

describe('checkSpecifics — months', () => {
  it('rejects a month name', () => {
    expect(classes('The fog of November hung low.')).toEqual(['month']);
  });

  it('does not flag "May" when it appears verbatim in the context', () => {
    const ctx = context({ factLines: ['Report filed in May.'] });
    expect(checkSpecifics('The May report lay open.', ctx).ok).toBe(true);
  });
});

describe('checkSpecifics — clock patterns', () => {
  it('rejects a 12-hour digit clock', () => {
    expect(classes('The clock read 3:15 in the gloom.')).toEqual(['clock']);
  });

  it('rejects a 24-hour digit clock', () => {
    expect(classes('The train left at 15:00 sharp.')).toEqual(['clock']);
  });

  it('rejects a clock with an am/pm suffix', () => {
    expect(classes('It was 9:05pm when the lights died.')).toEqual(['clock']);
  });

  it('rejects "o\'clock" as a clock, with the hour word as a number', () => {
    expect(classes("It struck three o'clock.")).toEqual([
      'number-word',
      'clock',
    ]);
  });
});

describe('checkSpecifics — time-of-day contradiction', () => {
  it('rejects a time word naming a different phase', () => {
    const ctx = context({ phase: 'night' });
    expect(classes('The morning light caught the dust.', ctx)).toEqual([
      'time-of-day',
    ]);
  });

  it('allows a time word that names the current phase', () => {
    const ctx = context({ phase: 'night' });
    expect(checkSpecifics('The night pressed on the glass.', ctx).ok).toBe(
      true,
    );
  });

  it('treats synonyms as their phase', () => {
    const morning = context({ phase: 'morning' });
    // dusk names evening, which contradicts a morning scene.
    expect(classes('A dusk chill lingered.', morning)).toEqual([
      'time-of-day',
    ]);
    // dawn names morning, which matches.
    expect(checkSpecifics('The dawn was grey.', morning).ok).toBe(true);
  });

  it.each<[Phase, string]>([
    ['morning', 'The afternoon heat built slowly.'],
    ['afternoon', 'The evening drew in.'],
    ['evening', 'The night was still.'],
    ['night', 'The morning never seemed to come.'],
  ])('flags a mismatch for the %s phase', (phase, sentence) => {
    expect(classes(sentence, context({ phase }))).toEqual(['time-of-day']);
  });
});

describe('checkSpecifics — proper names', () => {
  it('rejects a capitalized name that is not supplied', () => {
    expect(classes('He thought of Viktor and said nothing.')).toEqual([
      'proper-name',
    ]);
  });

  it('does not flag a capitalized first word of the sentence', () => {
    expect(checkSpecifics('Rain streaked the window.', context()).ok).toBe(
      true,
    );
  });

  it('flags each unsupplied capitalized token', () => {
    expect(classes('They met near Vokzal and the Embassy.')).toEqual([
      'proper-name',
      'proper-name',
    ]);
  });
});

describe('checkSpecifics — verbatim-token allowance', () => {
  it('allows a numeral present in a Fact Line', () => {
    const ctx = context({ factLines: ['You hand over 3 roubles.'] });
    expect(checkSpecifics('He pocketed the 3 coins.', ctx).ok).toBe(true);
  });

  it('allows a name present in the scene descriptor', () => {
    const ctx = context({ sceneDescriptor: 'Viktor leans on the bar.' });
    expect(checkSpecifics('Viktor watched the door.', ctx).ok).toBe(true);
  });

  it('allows a weekday present in a Fact Line', () => {
    const ctx = context({ factLines: ['The drop is set for Tuesday.'] });
    expect(checkSpecifics('Tuesday would decide everything.', ctx).ok).toBe(
      true,
    );
  });

  it('honours the explicit allowedWords list case-insensitively', () => {
    const ctx = context({ allowedWords: ['Prospekt'] });
    expect(checkSpecifics('The prospekt ran north.', ctx).ok).toBe(true);
  });

  it('still rejects specifics the context never supplied', () => {
    const ctx = context({ factLines: ['You hand over 3 roubles.'] });
    expect(classes('He counted 7 coins by Friday.', ctx)).toEqual([
      'numeral',
      'weekday',
    ]);
  });
});

describe('checkSpecifics — clean sentences', () => {
  it('passes ordinary atmospheric prose', () => {
    const sentences = [
      'The rain had not let up, and the gutters ran brown.',
      'Somewhere a tram bell rang and faded.',
      'He turned his collar up against the wind.',
    ];
    for (const sentence of sentences) {
      expect(checkSpecifics(sentence, context()).ok).toBe(true);
    }
  });
});

/**
 * Property checks over the whole token space, each tagged to the acceptance
 * criterion it exercises (Requirement 20.4).
 */
describe('checkSpecifics — randomised checks', () => {
  it('a token copied verbatim from a Fact Line is never a violation', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('7', 'Tuesday', 'November', 'Viktor', 'three'),
        (token) => {
          const ctx = context({ factLines: [`The record names ${token}.`] });
          const result = checkSpecifics(`And then ${token} again.`, ctx);
          expect(result.violations.some((v) => v.token === token)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('any bare integer is reported as a numeral when unsupplied', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 999999 }), (n) => {
        const result = checkSpecifics(`There were ${n} of them.`, context());
        expect(result.violations).toContainEqual({
          class: 'numeral',
          token: String(n),
        });
      }),
      { numRuns: 100 },
    );
  });
});

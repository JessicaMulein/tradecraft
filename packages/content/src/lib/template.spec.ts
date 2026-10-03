import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  compileTemplate,
  parseTemplate,
  render,
  TemplateParseError,
  TemplateRenderError,
  TemplateValidationError,
  validateTemplate,
  type Namer,
  type TemplateRng,
} from './template.js';

// --- test helpers ----------------------------------------------------------

/** A namer that renders a string value and reads `.title` for the `.attr` form. */
const defaultNamer: Namer = (value, attr) => {
  if (attr !== undefined) {
    const record = value as Record<string, unknown>;
    return String(record[attr]);
  }
  return String(value);
};

/**
 * A deterministic rng standing in for the engine's PRNG. It walks a fixed index
 * sequence so a test can assert the exact draw order without depending on the
 * real PRNG's arithmetic.
 */
function scriptedRng(indices: readonly number[]): TemplateRng {
  let call = 0;
  return {
    pick<T>(items: readonly T[]): T {
      const index = indices[call % indices.length];
      call += 1;
      return items[index % items.length];
    },
  };
}

/** An rng that always draws the first entry, for render-shape assertions. */
const firstRng: TemplateRng = {
  pick: <T>(items: readonly T[]): T => items[0],
};

// --- parsing: shape --------------------------------------------------------

describe('parseTemplate', () => {
  it('parses plain text into a single text node', () => {
    const ast = parseTemplate('a quiet street in the rain');
    expect(ast.nodes).toEqual([
      { kind: 'text', text: 'a quiet street in the rain' },
    ]);
  });

  it('parses a bare slot', () => {
    const ast = parseTemplate('{subject} waits');
    expect(ast.nodes).toEqual([
      { kind: 'slot', slot: 'subject' },
      { kind: 'text', text: ' waits' },
    ]);
  });

  it('parses a slot with an attribute', () => {
    const ast = parseTemplate('{subject.title}');
    expect(ast.nodes).toEqual([
      { kind: 'slot', slot: 'subject', attr: 'title' },
    ]);
  });

  it('parses the reserved when and place slots like any other slot', () => {
    const ast = parseTemplate('meets {object} at {place} {when}');
    expect(ast.nodes).toEqual([
      { kind: 'text', text: 'meets ' },
      { kind: 'slot', slot: 'object' },
      { kind: 'text', text: ' at ' },
      { kind: 'slot', slot: 'place' },
      { kind: 'text', text: ' ' },
      { kind: 'slot', slot: 'when' },
    ]);
  });

  it('parses a pick with a bare pool id and a namespaced pool id', () => {
    expect(parseTemplate('{pick:atmosphere}').nodes).toEqual([
      { kind: 'pick', pool: 'atmosphere' },
    ]);
    expect(parseTemplate('{pick:core/atmosphere}').nodes).toEqual([
      { kind: 'pick', pool: 'core/atmosphere' },
    ]);
  });

  it('parses an optional section with nested markup', () => {
    const ast = parseTemplate('You meet {object}{?place} at {place}{/place}.');
    expect(ast.nodes).toEqual([
      { kind: 'text', text: 'You meet ' },
      { kind: 'slot', slot: 'object' },
      {
        kind: 'optional',
        slot: 'place',
        body: [
          { kind: 'text', text: ' at ' },
          { kind: 'slot', slot: 'place' },
        ],
      },
      { kind: 'text', text: '.' },
    ]);
  });

  it('treats doubled braces as literal braces', () => {
    const ast = parseTemplate('use {{braces}} literally');
    expect(ast.nodes).toEqual([
      { kind: 'text', text: 'use {braces} literally' },
    ]);
  });

  it('keeps the original source on the ast', () => {
    expect(parseTemplate('{subject} waits').source).toBe('{subject} waits');
  });
});

// --- parsing: error cases --------------------------------------------------

describe('parseTemplate error cases', () => {
  it('rejects an unterminated tag', () => {
    expect(() => parseTemplate('{subject')).toThrow(TemplateParseError);
  });

  it('rejects an empty tag', () => {
    expect(() => parseTemplate('a {} b')).toThrow(TemplateParseError);
  });

  it('rejects a stray close brace', () => {
    expect(() => parseTemplate('a } b')).toThrow(TemplateParseError);
  });

  it('rejects an unmatched optional close tag', () => {
    expect(() => parseTemplate('text {/place} more')).toThrow(
      TemplateParseError,
    );
  });

  it('rejects an unclosed optional section', () => {
    expect(() => parseTemplate('{?place} at {place}')).toThrow(
      TemplateParseError,
    );
  });

  it('rejects a mismatched optional close tag', () => {
    expect(() => parseTemplate('{?place} at {place}{/when}')).toThrow(
      TemplateParseError,
    );
  });

  it('rejects an invalid slot name', () => {
    expect(() => parseTemplate('{Subject}')).toThrow(TemplateParseError);
    expect(() => parseTemplate('{sub ject}')).toThrow(TemplateParseError);
  });

  it('rejects an invalid pool reference', () => {
    expect(() => parseTemplate('{pick:Bad Pool}')).toThrow(TemplateParseError);
  });

  it('names the offending template in the error message', () => {
    expect(() => parseTemplate('{bad')).toThrow(/\{bad/);
  });
});

// --- validation ------------------------------------------------------------

describe('validateTemplate', () => {
  const decls = { slots: ['subject', 'object', 'place'], pools: ['atmosphere'] };

  it('accepts a template whose slots and pools are all declared', () => {
    const ast = parseTemplate('{subject} at {place} {pick:atmosphere}');
    expect(() => validateTemplate(ast, decls)).not.toThrow();
  });

  it('rejects an undeclared slot', () => {
    const ast = parseTemplate('{subject} meets {stranger}');
    expect(() => validateTemplate(ast, decls)).toThrow(
      TemplateValidationError,
    );
  });

  it('rejects an unknown pool', () => {
    const ast = parseTemplate('{pick:missing}');
    expect(() => validateTemplate(ast, decls)).toThrow(
      TemplateValidationError,
    );
  });

  it('rejects an undeclared slot used only in an optional section', () => {
    const ast = parseTemplate('{?note}({note}){/note}');
    expect(() => validateTemplate(ast, decls)).toThrow(
      TemplateValidationError,
    );
  });

  it('validates a slot attribute by its base slot name', () => {
    const ast = parseTemplate('{subject.title}');
    expect(() => validateTemplate(ast, decls)).not.toThrow();
  });

  it('compileTemplate parses and validates together', () => {
    expect(() => compileTemplate('{subject}', decls)).not.toThrow();
    expect(() => compileTemplate('{ghost}', decls)).toThrow(
      TemplateValidationError,
    );
    expect(() => compileTemplate('{bad', decls)).toThrow(TemplateParseError);
  });
});

// --- rendering -------------------------------------------------------------

describe('render', () => {
  it('substitutes a bare slot through the namer', () => {
    const ast = parseTemplate('{subject} waits');
    const out = render(ast, { subject: 'Herr Brandt' }, defaultNamer, firstRng);
    expect(out).toBe('Herr Brandt waits');
  });

  it('passes the attribute to the namer for a slot.attr form', () => {
    const ast = parseTemplate('{subject.title}');
    const out = render(
      ast,
      { subject: { title: 'the attaché' } },
      defaultNamer,
      firstRng,
    );
    expect(out).toBe('the attaché');
  });

  it('lets the namer decide how an unidentified subject appears', () => {
    // The namer renders a known person by name and an unknown one by descriptor,
    // exactly as a Fact Line must (design, "Template language").
    const namer: Namer = (value) => {
      const person = value as { name?: string; descriptor: string };
      return person.name ?? person.descriptor;
    };
    const ast = parseTemplate('{subject} meets {object}');
    const out = render(
      ast,
      {
        subject: { name: 'Herr Brandt' },
        object: { descriptor: 'a man in a grey hat' },
      },
      namer,
      firstRng,
    );
    expect(out).toBe('Herr Brandt meets a man in a grey hat');
  });

  it('renders an optional section only when the slot is bound', () => {
    const ast = parseTemplate('You meet {object}{?place} at {place}{/place}.');
    const withPlace = render(
      ast,
      { object: 'the courier', place: 'the Kaffeehaus' },
      defaultNamer,
      firstRng,
    );
    expect(withPlace).toBe('You meet the courier at the Kaffeehaus.');

    const withoutPlace = render(
      ast,
      { object: 'the courier' },
      defaultNamer,
      firstRng,
    );
    expect(withoutPlace).toBe('You meet the courier.');
  });

  it('treats a null or undefined binding as unbound in an optional section', () => {
    const ast = parseTemplate('{?note}note: {note}{/note}done');
    expect(render(ast, { note: null }, defaultNamer, firstRng)).toBe('done');
    expect(render(ast, { note: undefined }, defaultNamer, firstRng)).toBe(
      'done',
    );
  });

  it('draws a pick from the supplied pool', () => {
    const ast = parseTemplate('a {pick:mood} evening');
    const out = render(ast, {}, defaultNamer, scriptedRng([1]), {
      pools: { mood: ['bright', 'bleak', 'tense'] },
    });
    expect(out).toBe('a bleak evening');
  });

  it('draws picks in AST order', () => {
    const ast = parseTemplate('{pick:a}-{pick:b}-{pick:a}');
    const out = render(ast, {}, defaultNamer, scriptedRng([0, 1, 2]), {
      pools: {
        a: ['a0', 'a1', 'a2'],
        b: ['b0', 'b1', 'b2'],
      },
    });
    // draws index 0 from a, then 1 from b, then 2 from a.
    expect(out).toBe('a0-b1-a2');
  });

  it('renders literal braces from escapes', () => {
    const ast = parseTemplate('{{not a slot}}');
    expect(render(ast, {}, defaultNamer, firstRng)).toBe('{not a slot}');
  });
});

// --- rendering: error cases ------------------------------------------------

describe('render error cases', () => {
  it('throws when a required slot has no binding', () => {
    const ast = parseTemplate('{subject} waits');
    expect(() => render(ast, {}, defaultNamer, firstRng)).toThrow(
      TemplateRenderError,
    );
  });

  it('throws when a slot binding is null', () => {
    const ast = parseTemplate('{subject} waits');
    expect(() => render(ast, { subject: null }, defaultNamer, firstRng)).toThrow(
      TemplateRenderError,
    );
  });

  it('throws when a pick has no pool supplied', () => {
    const ast = parseTemplate('{pick:mood}');
    expect(() => render(ast, {}, defaultNamer, firstRng)).toThrow(
      TemplateRenderError,
    );
  });

  it('throws when a pick pool is empty', () => {
    const ast = parseTemplate('{pick:mood}');
    expect(() =>
      render(ast, {}, defaultNamer, firstRng, { pools: { mood: [] } }),
    ).toThrow(TemplateRenderError);
  });
});

// --- determinism -----------------------------------------------------------

describe('render determinism', () => {
  it('is a pure function of ast, bindings, namer and rng draws', () => {
    const ast = parseTemplate('{subject} at {pick:mood} {place}');
    const bindings = { subject: 'Brandt', place: 'the port' };
    const pools = { mood: ['dawn', 'dusk', 'noon'] };

    const first = render(ast, bindings, defaultNamer, scriptedRng([2]), {
      pools,
    });
    const second = render(ast, bindings, defaultNamer, scriptedRng([2]), {
      pools,
    });
    expect(first).toBe(second);
    expect(first).toBe('Brandt at noon the port');
  });

  it('produces identical output for equivalent rng draw sequences (property)', () => {
    const ast = parseTemplate(
      'You meet {object} at {pick:spot}{?when} {when}{/when}.',
    );
    const pools = { spot: ['the kiosk', 'the library', 'the bar'] };

    fc.assert(
      fc.property(
        fc.record({
          object: fc.string({ minLength: 1 }),
          when: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
          draws: fc.array(fc.integer({ min: 0, max: 1000 }), {
            minLength: 1,
            maxLength: 8,
          }),
        }),
        ({ object, when, draws }) => {
          const bindings = { object, when };
          const a = render(ast, bindings, defaultNamer, scriptedRng(draws), {
            pools,
          });
          const b = render(ast, bindings, defaultNamer, scriptedRng(draws), {
            pools,
          });
          expect(a).toBe(b);
        },
      ),
    );
  });

  it('parse then render matches across repeated parses of the same source', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          '{subject} meets {object} at {place} {when}',
          'a {pick:mood} day{?note}, {note}{/note}',
          'plain text with {{braces}}',
        ),
        fc.integer({ min: 0, max: 100 }),
        (source, draw) => {
          const bindings = {
            subject: 'S',
            object: 'O',
            place: 'P',
            when: 'W',
            note: 'N',
          };
          const pools = { mood: ['x', 'y', 'z'] };
          const out1 = render(
            parseTemplate(source),
            bindings,
            defaultNamer,
            scriptedRng([draw]),
            { pools },
          );
          const out2 = render(
            parseTemplate(source),
            bindings,
            defaultNamer,
            scriptedRng([draw]),
            { pools },
          );
          expect(out1).toBe(out2);
        },
      ),
    );
  });
});

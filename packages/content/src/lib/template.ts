/**
 * The content template language.
 *
 * Every piece of Fact text in the game — Fact Lines, Documents, hints and the
 * predicate renderers — is written with one small template language and
 * rendered by one deterministic engine (design, "Template language"). A
 * template is parsed into an AST once, at load, so slot and pool references can
 * be checked against their declarations before anything is rendered
 * (Requirements 30.1, 32.3). Rendering is a pure function of the AST, the
 * bindings, a {@link Namer} and an {@link TemplateRng}; given the same inputs it
 * always produces the same string (Requirement 20.1).
 *
 * The grammar is:
 *
 * - `{slot}` — substitute the binding for `slot`.
 * - `{slot.attr}` — substitute attribute `attr` of the binding for `slot`.
 * - `{when}` / `{place}` — the two reserved slots a predicate render carries.
 *   They behave exactly like `{slot}` with the names `when` and `place`; naming
 *   them in the grammar keeps the design's wording and lets a validator insist
 *   a predicate that needs a window or a place actually binds one.
 * - `{pick:pool-id}` — draw one entry from the named flavour pool using the rng.
 * - `{?slot}…{/slot}` — an optional section rendered only when `slot` is bound.
 *
 * The engine owns a minimal {@link TemplateRng} interface rather than importing
 * the engine's PRNG: the `content` package may depend only on `zod` and `yaml`
 * (enforced by dependency-cruiser). The engine's `Prng` is structurally
 * assignable to it, so a caller passes its PRNG straight through.
 */

/** Reserved slot names that the grammar spells out explicitly. */
export const RESERVED_SLOTS = ['when', 'place'] as const;

// --- AST -------------------------------------------------------------------

/** Literal text between the markup. */
export interface TextNode {
  readonly kind: 'text';
  readonly text: string;
}

/** `{slot}` or `{slot.attr}`: a substitution from the bindings. */
export interface SlotNode {
  readonly kind: 'slot';
  readonly slot: string;
  /** The attribute for `{slot.attr}`, or `undefined` for a bare `{slot}`. */
  readonly attr?: string;
}

/** `{pick:pool-id}`: a seeded draw from a named flavour pool. */
export interface PickNode {
  readonly kind: 'pick';
  readonly pool: string;
}

/** `{?slot}…{/slot}`: a section rendered only when `slot` is bound. */
export interface OptionalNode {
  readonly kind: 'optional';
  readonly slot: string;
  readonly body: readonly TemplateNode[];
}

/** A node in a parsed template. */
export type TemplateNode = TextNode | SlotNode | PickNode | OptionalNode;

/**
 * A parsed template. Carries the original source so error messages and the
 * manifest hash can refer back to what was written.
 */
export interface TemplateAst {
  readonly source: string;
  readonly nodes: readonly TemplateNode[];
}

// --- rng + namer -----------------------------------------------------------

/**
 * The slice of a seeded random source the template engine needs. Deliberately
 * minimal so `content` need not depend on the engine; the engine's `Prng` is a
 * structural supertype and passes through unchanged.
 */
export interface TemplateRng {
  /** Uniform choice from a non-empty array; must be deterministic per draw. */
  pick<T>(items: readonly T[]): T;
}

/**
 * How a bound value appears in rendered text. The {@link Namer} is what lets a
 * Fact Line name a person the player has not identified by their Unidentified
 * Subject descriptor rather than by their true name (design, "Template
 * language"): the engine never stringifies a binding itself, it asks the namer.
 *
 * `attr` is set for `{slot.attr}` so a namer can surface, say, a persona's
 * title or a Location's short name.
 */
export type Namer = (value: unknown, attr?: string) => string;

// --- errors ----------------------------------------------------------------

/**
 * A template that cannot be parsed. Thrown at load, where it is caught and
 * reported with the pack, file and path by the loader (task 2.4).
 */
export class TemplateParseError extends Error {
  constructor(message: string, source: string) {
    super(`${message} (in template: ${JSON.stringify(source)})`);
    this.name = 'TemplateParseError';
  }
}

/**
 * A template whose slots or pools do not match the declarations it was
 * validated against. Also a load-time error.
 */
export class TemplateValidationError extends Error {
  constructor(message: string, source: string) {
    super(`${message} (in template: ${JSON.stringify(source)})`);
    this.name = 'TemplateValidationError';
  }
}

/** A render that was given bindings or pools inconsistent with the AST. */
export class TemplateRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateRenderError';
  }
}

// --- parsing ---------------------------------------------------------------

const SLOT_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const ATTR_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
// A pool id is a content ref: an optional `<pack>/` prefix then a content id.
const POOL_REF = /^(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)?[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface Tag {
  readonly raw: string;
  readonly start: number;
  readonly end: number;
}

/**
 * Parse a template string into an AST, or throw {@link TemplateParseError}.
 *
 * The parser is a single left-to-right pass. `{{` and `}}` are escapes for
 * literal braces so a template can contain a brace that is not markup.
 */
export function parseTemplate(source: string): TemplateAst {
  const { nodes, next } = parseNodes(source, 0, undefined);
  if (next !== source.length) {
    // parseNodes only stops early at a `{/slot}`; reaching here means a close
    // tag with no matching `{?slot}` open.
    throw new TemplateParseError(
      `unexpected close tag at index ${next}`,
      source,
    );
  }
  return { source, nodes };
}

/**
 * Parse nodes until the end of the string, or until the `{/closer}` that ends
 * the enclosing optional section. Returns the nodes and the index just past the
 * stopping point (end of string, or just past the close tag).
 */
function parseNodes(
  source: string,
  from: number,
  closer: string | undefined,
): { nodes: TemplateNode[]; next: number } {
  const nodes: TemplateNode[] = [];
  let text = '';
  let i = from;

  const flushText = (): void => {
    if (text.length > 0) {
      nodes.push({ kind: 'text', text });
      text = '';
    }
  };

  while (i < source.length) {
    const ch = source[i];

    if (ch === '}' && source[i + 1] === '}') {
      text += '}';
      i += 2;
      continue;
    }
    if (ch === '{' && source[i + 1] === '{') {
      text += '{';
      i += 2;
      continue;
    }
    if (ch === '}') {
      throw new TemplateParseError(
        `unexpected "}" at index ${i}; write "}}" for a literal brace`,
        source,
      );
    }
    if (ch !== '{') {
      text += ch;
      i += 1;
      continue;
    }

    // A tag starts here. Read up to the matching single `}`.
    const tag = readTag(source, i);

    // Close tag: only legal when it matches the current optional section.
    if (tag.raw.startsWith('/')) {
      const name = tag.raw.slice(1);
      if (closer === undefined) {
        throw new TemplateParseError(
          `close tag {${tag.raw}} has no matching {?${name}}`,
          source,
        );
      }
      if (name !== closer) {
        throw new TemplateParseError(
          `close tag {${tag.raw}} does not match open {?${closer}}`,
          source,
        );
      }
      flushText();
      return { nodes, next: tag.end };
    }

    flushText();

    if (tag.raw.startsWith('?')) {
      const slot = tag.raw.slice(1);
      if (!SLOT_NAME.test(slot)) {
        throw new TemplateParseError(
          `invalid optional-section slot name "${slot}"`,
          source,
        );
      }
      const inner = parseNodes(source, tag.end, slot);
      nodes.push({ kind: 'optional', slot, body: inner.nodes });
      i = inner.next;
      continue;
    }

    nodes.push(parseTag(tag, source));
    i = tag.end;
  }

  if (closer !== undefined) {
    throw new TemplateParseError(
      `optional section {?${closer}} is never closed`,
      source,
    );
  }

  flushText();
  return { nodes, next: i };
}

/** Read the single-brace tag that opens at `source[open] === '{'`. */
function readTag(source: string, open: number): Tag {
  const close = source.indexOf('}', open + 1);
  if (close === -1) {
    throw new TemplateParseError(
      `unterminated "{" at index ${open}`,
      source,
    );
  }
  const raw = source.slice(open + 1, close);
  if (raw.length === 0) {
    throw new TemplateParseError(`empty tag "{}" at index ${open}`, source);
  }
  if (raw.includes('{')) {
    throw new TemplateParseError(
      `nested "{" inside a tag at index ${open}`,
      source,
    );
  }
  return { raw, start: open, end: close + 1 };
}

/** Turn a non-section, non-close tag into a slot or pick node. */
function parseTag(tag: Tag, source: string): SlotNode | PickNode {
  const { raw } = tag;

  if (raw.startsWith('pick:')) {
    const pool = raw.slice('pick:'.length);
    if (!POOL_REF.test(pool)) {
      throw new TemplateParseError(
        `invalid pool reference "{${raw}}"`,
        source,
      );
    }
    return { kind: 'pick', pool };
  }

  const dot = raw.indexOf('.');
  if (dot === -1) {
    if (!SLOT_NAME.test(raw)) {
      throw new TemplateParseError(`invalid slot "{${raw}}"`, source);
    }
    return { kind: 'slot', slot: raw };
  }

  const slot = raw.slice(0, dot);
  const attr = raw.slice(dot + 1);
  if (!SLOT_NAME.test(slot) || !ATTR_NAME.test(attr)) {
    throw new TemplateParseError(
      `invalid slot/attribute "{${raw}}"`,
      source,
    );
  }
  return { kind: 'slot', slot, attr };
}

// --- validation ------------------------------------------------------------

/** What a template is allowed to reference, supplied at load. */
export interface TemplateDeclarations {
  /** Slot names the template may bind, e.g. a predicate's `subject`/`object`. */
  readonly slots: Iterable<string>;
  /** Pool ids that exist in the Content Set, for `{pick:…}` references. */
  readonly pools: Iterable<string>;
}

/**
 * Check that every slot and pool a template references is declared, throwing
 * {@link TemplateValidationError} on the first undeclared reference. Reserved
 * slots (`when`, `place`) must still be declared by the caller when the
 * template uses them, so a predicate that renders `{when}` is forced to declare
 * a window.
 */
export function validateTemplate(
  ast: TemplateAst,
  declarations: TemplateDeclarations,
): void {
  const slots = new Set(declarations.slots);
  const pools = new Set(declarations.pools);

  const visit = (nodes: readonly TemplateNode[]): void => {
    for (const node of nodes) {
      switch (node.kind) {
        case 'text':
          break;
        case 'slot':
          if (!slots.has(node.slot)) {
            throw new TemplateValidationError(
              `template references undeclared slot "${node.slot}"`,
              ast.source,
            );
          }
          break;
        case 'pick':
          if (!pools.has(node.pool)) {
            throw new TemplateValidationError(
              `template references unknown pool "${node.pool}"`,
              ast.source,
            );
          }
          break;
        case 'optional':
          if (!slots.has(node.slot)) {
            throw new TemplateValidationError(
              `optional section references undeclared slot "${node.slot}"`,
              ast.source,
            );
          }
          visit(node.body);
          break;
      }
    }
  };

  visit(ast.nodes);
}

/**
 * Parse and validate in one step, the shape the loader uses: a template is only
 * ever stored as an AST that has already been checked against its declarations.
 */
export function compileTemplate(
  source: string,
  declarations: TemplateDeclarations,
): TemplateAst {
  const ast = parseTemplate(source);
  validateTemplate(ast, declarations);
  return ast;
}

/**
 * The set of slot names a parsed template references — every `{slot}`,
 * `{slot.attr}` and `{?slot}…{/slot}` name, with `{slot.attr}` and `{slot}`
 * counted as the one slot `slot` (an attribute is a view of a bound value, not
 * a separate slot). The two reserved slots (`when`, `place`) appear here when a
 * template names them, exactly like any other slot.
 *
 * This is the slot set the Template Variant check compares (content-expansion
 * Req 8.3): a variant conforms iff its template references the same set of
 * slots as its base. `{pick:…}` pools are a draw source, not a binding, so they
 * do not count as slots and are excluded. The result is a plain `Set` so a
 * caller can take differences for the missing/extra lists directly.
 */
export function templateSlots(ast: TemplateAst): Set<string> {
  const slots = new Set<string>();
  const visit = (nodes: readonly TemplateNode[]): void => {
    for (const node of nodes) {
      switch (node.kind) {
        case 'text':
        case 'pick':
          break;
        case 'slot':
          slots.add(node.slot);
          break;
        case 'optional':
          slots.add(node.slot);
          visit(node.body);
          break;
      }
    }
  };
  visit(ast.nodes);
  return slots;
}

/** The bindings passed to {@link render}: a slot name to the value it names. */
export type TemplateBindings = Readonly<Record<string, unknown>>;

/** A flavour pool: the named list a `{pick:…}` draws from. */
export type TemplatePools = Readonly<Record<string, readonly string[]>>;

/** Options for {@link render}. `pools` is only needed when the AST uses `pick`. */
export interface RenderOptions {
  readonly pools?: TemplatePools;
}

/**
 * Render a parsed template to a string. Pure: the result is a function of the
 * AST, the bindings, the namer and the rng's draw sequence, with no hidden
 * state (Requirement 20.1).
 *
 * - A `{slot}` whose binding is absent is a {@link TemplateRenderError}; use an
 *   optional section for text that may be omitted.
 * - A `{slot}` bound to `null` or `undefined` is treated as unbound.
 * - An optional section renders its body iff the slot is bound to a non-nullish
 *   value; the slot does not need to be referenced inside the body.
 * - A `{pick:pool}` draws from `pools[pool]` via `rng.pick`. Draw order follows
 *   AST order, so two renders with equivalent rngs pick identically.
 */
export function render(
  ast: TemplateAst,
  bindings: TemplateBindings,
  namer: Namer,
  rng: TemplateRng,
  options: RenderOptions = {},
): string {
  const pools = options.pools ?? {};

  const isBound = (slot: string): boolean => {
    const value = bindings[slot];
    return value !== undefined && value !== null;
  };

  const visit = (nodes: readonly TemplateNode[]): string => {
    let out = '';
    for (const node of nodes) {
      switch (node.kind) {
        case 'text':
          out += node.text;
          break;
        case 'slot': {
          if (!isBound(node.slot)) {
            throw new TemplateRenderError(
              `no binding for slot "${node.slot}"`,
            );
          }
          out += namer(bindings[node.slot], node.attr);
          break;
        }
        case 'pick': {
          const pool = pools[node.pool];
          if (pool === undefined) {
            throw new TemplateRenderError(
              `no pool supplied for "{pick:${node.pool}}"`,
            );
          }
          if (pool.length === 0) {
            throw new TemplateRenderError(
              `pool "${node.pool}" is empty`,
            );
          }
          out += rng.pick(pool);
          break;
        }
        case 'optional':
          if (isBound(node.slot)) {
            out += visit(node.body);
          }
          break;
      }
    }
    return out;
  };

  return visit(ast.nodes);
}

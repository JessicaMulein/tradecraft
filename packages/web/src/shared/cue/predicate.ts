import {
  INPUT_KEYS,
  LIST_KEYS,
  NUMBER_KEYS,
  STATE_KEY,
  type CueInputs,
  type InputKey,
  type Operator,
  type Predicate,
  type Scalar,
} from './types.js';

/** The values a predicate may read: the inputs plus the Director's current cue. */
export type Context = CueInputs & { readonly current: string | undefined };

export function isInputKey(key: string): key is InputKey {
  return (INPUT_KEYS as readonly string[]).includes(key);
}

export function isListKey(key: string): boolean {
  return (LIST_KEYS as readonly string[]).includes(key);
}

export function isNumberKey(key: string): boolean {
  return (NUMBER_KEYS as readonly string[]).includes(key);
}

export const PREDICATE_KEYS = new Set<string>([...INPUT_KEYS, STATE_KEY]);

function isOperator(v: unknown): v is Operator {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Evaluate a validated predicate over a context. Pure. */
export function evaluate(p: Predicate, ctx: Context): boolean {
  const entries = Object.entries(p);
  if (entries.length !== 1) {
    return false;
  }
  const [key, value] = entries[0] as [string, unknown];
  if (key === 'all') {
    return (value as readonly Predicate[]).every((q) => evaluate(q, ctx));
  }
  if (key === 'any') {
    return (value as readonly Predicate[]).some((q) => evaluate(q, ctx));
  }
  if (key === 'not') {
    return !evaluate(value as Predicate, ctx);
  }
  const actual = (ctx as unknown as Record<string, unknown>)[key];
  if (!isOperator(value)) {
    return actual === (value as Scalar);
  }
  const op = value as Record<string, unknown>;
  if ('has' in op) {
    return Array.isArray(actual) && actual.includes(op['has']);
  }
  if ('hasPrefix' in op) {
    return (
      Array.isArray(actual) &&
      actual.some((x) => typeof x === 'string' && x.startsWith(String(op['hasPrefix'])))
    );
  }
  if ('in' in op) {
    return (op['in'] as readonly unknown[]).includes(actual);
  }
  if (typeof actual !== 'number') {
    return false;
  }
  if ('gt' in op) return actual > (op['gt'] as number);
  if ('gte' in op) return actual >= (op['gte'] as number);
  if ('lt' in op) return actual < (op['lt'] as number);
  if ('lte' in op) return actual <= (op['lte'] as number);
  return false;
}

/**
 * Structural validation of a predicate: returns problems, or none. A predicate
 * may read only `CueInputs` fields (and `current`); an unknown key is a problem
 * (Requirement 15.2; Property 12).
 */
export function validatePredicate(p: unknown, path = 'when'): string[] {
  if (typeof p !== 'object' || p === null || Array.isArray(p)) {
    return [`${path}: a predicate is an object`];
  }
  const entries = Object.entries(p as Record<string, unknown>);
  if (entries.length !== 1) {
    return [`${path}: a predicate has exactly one key (use \`all\` to combine)`];
  }
  const [key, value] = entries[0] as [string, unknown];
  if (key === 'all' || key === 'any') {
    if (!Array.isArray(value) || value.length === 0) {
      return [`${path}.${key}: needs a non-empty list`];
    }
    return value.flatMap((q, i) => validatePredicate(q, `${path}.${key}[${i}]`));
  }
  if (key === 'not') {
    return validatePredicate(value, `${path}.not`);
  }
  if (!PREDICATE_KEYS.has(key)) {
    return [`${path}: unknown input \`${key}\` (a rule may read only CueInputs fields)`];
  }
  if (!isOperator(value)) {
    if (isListKey(key)) {
      return [`${path}.${key}: a list input needs \`has\`, \`hasPrefix\` or \`in\``];
    }
    const t = typeof value;
    if (t !== 'string' && t !== 'number' && t !== 'boolean') {
      return [`${path}.${key}: expected a scalar or an operator`];
    }
    return [];
  }
  const ops = Object.keys(value as object);
  if (ops.length !== 1) {
    return [`${path}.${key}: exactly one operator`];
  }
  const op = ops[0] as string;
  const arg = (value as Record<string, unknown>)[op];
  switch (op) {
    case 'has':
    case 'hasPrefix':
      if (!isListKey(key)) return [`${path}.${key}: \`${op}\` applies to list inputs`];
      return typeof arg === 'string' ? [] : [`${path}.${key}.${op}: expected a string`];
    case 'in':
      if (isListKey(key)) return [`${path}.${key}: \`in\` does not apply to list inputs`];
      return Array.isArray(arg) ? [] : [`${path}.${key}.in: expected a list`];
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      if (!isNumberKey(key)) return [`${path}.${key}: \`${op}\` applies to numeric inputs`];
      return typeof arg === 'number' ? [] : [`${path}.${key}.${op}: expected a number`];
    default:
      return [`${path}.${key}: unknown operator \`${op}\``];
  }
}

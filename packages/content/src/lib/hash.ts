/**
 * Canonical JSON and the per-pack content hash.
 *
 * The Content Manifest pins each pack by a hash so a save, recording or Outcome
 * Record can prove it was produced against exactly this content (design,
 * "Content Packs", load step 7). The hash must be stable across machines and
 * across the order the loader happened to read keys in, so a pack is hashed as
 * SHA-256 over its files' *canonical* JSON — object keys sorted — concatenated
 * in path order.
 *
 * Canonicalisation here is deliberately small: it sorts object keys and emits
 * JSON with no incidental whitespace. It assumes the value is already
 * JSON-shaped (the parsed-and-validated YAML always is): plain objects, arrays,
 * strings, finite numbers, booleans and null. `undefined` is dropped from
 * objects, matching `JSON.stringify`, so an optional field that was absent and
 * one that was explicitly undefined hash the same.
 */

import { createHash } from 'node:crypto';

/**
 * Serialise a JSON-shaped value with object keys sorted, so two values that are
 * deeply equal produce byte-identical output regardless of key insertion order.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'number') {
    // Non-finite numbers are not valid JSON; mirror JSON.stringify's `null`.
    return Number.isFinite(value) ? String(value) : 'null';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(normalise(v))).join(',')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    const members = keys.map(
      (k) => `${JSON.stringify(k)}:${canonicalJson(normalise(obj[k]))}`,
    );
    return `{${members.join(',')}}`;
  }
  // Functions, symbols and undefined are not JSON; mirror JSON.stringify by
  // emitting null so hashing never throws on an unexpected value.
  return 'null';
}

/** `undefined` becomes `null` only inside arrays, as `JSON.stringify` does. */
function normalise(value: unknown): unknown {
  return value === undefined ? null : value;
}

/**
 * Hash a pack's files. Each entry is the already-parsed content of one file;
 * the entries are given in path order (the loader sorts by relative path). The
 * returned digest is a lower-case hex SHA-256 string.
 */
export function hashPack(
  files: ReadonlyArray<{ readonly path: string; readonly content: unknown }>,
): string {
  const hash = createHash('sha256');
  for (const file of files) {
    // Include the path so moving content between files changes the hash, and
    // so two files with identical content stay distinguishable.
    hash.update(file.path);
    hash.update('\0');
    hash.update(canonicalJson(file.content));
    hash.update('\n');
  }
  return hash.digest('hex');
}

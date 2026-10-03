/**
 * The small slice of semantic-version matching the pack loader needs.
 *
 * A pack declares its own `version` as `major.minor.patch` and its
 * dependencies as ranges (`requires`), and the loader must decide whether a
 * resolved pack version satisfies a dependency's range (design, "Content
 * Packs", load step 1). The content package may depend only on `zod` and
 * `yaml`, so rather than pull in a semver library this module implements just
 * the comparator grammar the packs use:
 *
 * - an exact version, optionally with a leading `=`, e.g. `1.2.3` / `=1.2.3`;
 * - a caret range `^1.2.3`, compatible within the same left-most non-zero
 *   component (`^1.2.3` is `>=1.2.3 <2.0.0`, `^0.2.3` is `>=0.2.3 <0.3.0`,
 *   `^0.0.3` is `>=0.0.3 <0.0.4`);
 * - comparator ranges built from `>`, `>=`, `<`, `<=` and `=`, several joined
 *   by whitespace to form a conjunction, e.g. `>=1.2.0 <2.0.0`;
 * - `*` or an empty string, which match any version.
 *
 * Everything is pure. A malformed range or version is reported through
 * {@link parseRange} / {@link parseVersion} returning `null`, so the loader can
 * raise a located {@link import('./pack.js').ContentError} rather than throw.
 */

/** A parsed `major.minor.patch` version. */
export interface SemVer {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;

/** Parse `major.minor.patch`, or `null` if it is not a well-formed version. */
export function parseVersion(text: string): SemVer | null {
  const m = VERSION_RE.exec(text.trim());
  if (m === null) {
    return null;
  }
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/** Order two versions: negative if `a < b`, zero if equal, positive if `a > b`. */
export function compareVersions(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/** A single comparator: an operator and the version it compares against. */
interface Comparator {
  readonly op: '<' | '<=' | '>' | '>=' | '=';
  readonly version: SemVer;
}

/**
 * A parsed range: a conjunction of comparators. The empty list matches every
 * version (`*` or an empty range string).
 */
export interface SemVerRange {
  readonly comparators: readonly Comparator[];
}

const COMPARATOR_RE = /^(<=|>=|<|>|=)?(\d+)\.(\d+)\.(\d+)$/;

/** Expand a caret token (`^1.2.3`) into its two bounding comparators. */
function caretComparators(v: SemVer): Comparator[] {
  const lower: Comparator = { op: '>=', version: v };
  let upper: SemVer;
  if (v.major > 0) {
    upper = { major: v.major + 1, minor: 0, patch: 0 };
  } else if (v.minor > 0) {
    upper = { major: 0, minor: v.minor + 1, patch: 0 };
  } else {
    upper = { major: 0, minor: 0, patch: v.patch + 1 };
  }
  return [lower, { op: '<', version: upper }];
}

/**
 * Parse a range string into comparators, or `null` if any token is malformed.
 * Tokens are whitespace-separated and AND-ed together.
 */
export function parseRange(text: string): SemVerRange | null {
  const trimmed = text.trim();
  if (trimmed === '' || trimmed === '*') {
    return { comparators: [] };
  }

  const tokens = trimmed.split(/\s+/);
  const comparators: Comparator[] = [];

  for (const token of tokens) {
    if (token.startsWith('^')) {
      const v = parseVersion(token.slice(1));
      if (v === null) return null;
      comparators.push(...caretComparators(v));
      continue;
    }

    const m = COMPARATOR_RE.exec(token);
    if (m === null) return null;
    const op = (m[1] ?? '=') as Comparator['op'];
    const version: SemVer = {
      major: Number(m[2]),
      minor: Number(m[3]),
      patch: Number(m[4]),
    };
    comparators.push({ op, version });
  }

  return { comparators };
}

/** True when `version` satisfies a single comparator. */
function satisfiesComparator(version: SemVer, c: Comparator): boolean {
  const cmp = compareVersions(version, c.version);
  switch (c.op) {
    case '<':
      return cmp < 0;
    case '<=':
      return cmp <= 0;
    case '>':
      return cmp > 0;
    case '>=':
      return cmp >= 0;
    case '=':
      return cmp === 0;
  }
}

/** True when `version` satisfies every comparator in `range`. */
export function satisfies(version: SemVer, range: SemVerRange): boolean {
  return range.comparators.every((c) => satisfiesComparator(version, c));
}

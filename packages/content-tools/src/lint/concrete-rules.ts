/**
 * The reference, identity and text-safety Lint Rules (content-expansion task
 * 5.3; design, "Pack Linter"; Requirements 3.1, 3.4, 3.8, 13.2).
 *
 * Task 5.2 built the framework: the rule table ({@link ../rules}), the loader
 * `ContentError` → rule mapping ({@link ../error-map}), the parsed-file walk
 * and the generic Field-Declaration plumbing ({@link ../generic-rules}). This
 * module fills in the concrete rules of this task's Defect Classes.
 *
 * The *loader-backed* reference and conformance rules — CE-SCHEMA, CE-REF,
 * CE-DUPID, CE-SLOT, CE-TAG, CE-CONFORM and CE-VARIANT — need no body here:
 * they draw their findings from the loader's errors through the error map, so
 * their rule-table `check` stays empty. CE-PROVENANCE is loader-backed too (the
 * Provenance gate reports a generated-but-unreviewed file as a load error);
 * task 5.3 routes that error to CE-PROVENANCE in {@link ../error-map}.
 *
 * The remaining rules are implemented here, as {@link GenericFieldRule}s over
 * the {@link FieldHit} stream (and the parsed packs the stream was built from,
 * for the Name Pools and Locations that are not declared text fields):
 *
 * - **CE-DUPTEXT** — exact duplicate text within a `(kind, field)` group.
 * - **CE-NEARDUP** — near-duplicate text within a `(kind, field)` group, by
 *   exact word 3-shingle Jaccard (≥ 0.8 similarity over texts of ≥ 12 words).
 * - **CE-NAMEDUP** — a duplicate entry within a single Name Pool of a Culture
 *   Group (given-by-gender and family pools).
 * - **CE-REALPERSON** — a Real-Person Blocklist name occurring in a name or
 *   text field.
 * - **CE-SENSITIVE** — a Sensitivity Term occurring in any scanned text field.
 * - **CE-SOURCE** — a `real-landmark` Location that cites no Sources List entry.
 *
 * Text is tokenised with diacritic and case folding, and template slots
 * (`{...}`) are skipped, not scanned (design, "Text scanning"; Req 13.2). A
 * pattern matches as a contiguous whole-word token sequence.
 */

import type { LintFinding, LintSeverity } from './rules.js';
import { RULES_BY_ID } from './rules.js';
import { itemsOf, type ParsedPack } from './parsed-files.js';
import type { FieldHit, GenericFieldRule } from './generic-rules.js';

// --- tokenisation ----------------------------------------------------------

/**
 * The near-duplicate shingle size (design, "Near-duplicate detection"): exact
 * word 3-shingles.
 */
const SHINGLE_SIZE = 3;

/** The near-duplicate Jaccard threshold and the minimum text length in words. */
const NEARDUP_JACCARD = 0.8;
const NEARDUP_MIN_WORDS = 12;

/**
 * Fold a token to its diacritic- and case-insensitive form: lower-case,
 * decompose with NFKD and drop the combining marks, matching the normalisation
 * the engine's slugging and the NPC namer use (so "Müller" and "muller",
 * "café" and "cafe" tokenise alike). Requirement 13.2; design, "Text scanning".
 */
function fold(token: string): string {
  return token
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Strip template slots from a text before tokenising. A slot is `{...}` (the
 * template engine's slot syntax); the design says slots are skipped, not
 * scanned, so the whole `{...}` run — including nested-looking content — is
 * removed and replaced by a space so the tokens either side do not fuse into a
 * spurious whole-word sequence. Non-greedy so adjacent slots stay separate.
 */
function stripSlots(text: string): string {
  return text.replace(/\{[^}]*\}/g, ' ');
}

/**
 * Tokenise a text into folded words after removing template slots. A "word" is
 * a maximal run of letters or digits (Unicode-aware), so punctuation and
 * whitespace separate tokens and an empty text yields no tokens. The folded
 * tokens are what the duplicate, blocklist and sensitivity rules compare.
 */
export function tokenise(text: string): string[] {
  const withoutSlots = stripSlots(text);
  const matches = withoutSlots.match(/[\p{L}\p{N}]+/gu);
  if (matches === null) {
    return [];
  }
  return matches.map(fold);
}

/**
 * Whether the folded token sequence `pattern` occurs as a contiguous whole-word
 * run inside `tokens` (design, "Text scanning": "A pattern matches as a
 * contiguous whole-word token sequence"). An empty pattern never matches.
 */
export function containsSequence(
  tokens: readonly string[],
  pattern: readonly string[],
): boolean {
  if (pattern.length === 0 || pattern.length > tokens.length) {
    return false;
  }
  for (let i = 0; i + pattern.length <= tokens.length; i += 1) {
    let hit = true;
    for (let j = 0; j < pattern.length; j += 1) {
      if (tokens[i + j] !== pattern[j]) {
        hit = false;
        break;
      }
    }
    if (hit) {
      return true;
    }
  }
  return false;
}

/** The set of exact word {@link SHINGLE_SIZE}-shingles of a token list. */
function shingles(tokens: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + SHINGLE_SIZE <= tokens.length; i += 1) {
    out.add(tokens.slice(i, i + SHINGLE_SIZE).join('\u0000'));
  }
  return out;
}

/** The Jaccard similarity of two sets: |A ∩ B| / |A ∪ B|; 0 for two empties. */
function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const s of a) {
    if (b.has(s)) {
      intersection += 1;
    }
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// --- finding helpers -------------------------------------------------------

/** The default severity of a rule, read from the single-source rule table. */
function severityOf(ruleId: string): LintSeverity {
  return RULES_BY_ID.get(ruleId)?.severity ?? 'error';
}

/** Build a located finding for a rule at its default severity. */
function finding(
  ruleId: string,
  pack: string,
  file: string,
  path: string,
  message: string,
): LintFinding {
  return { rule: ruleId, severity: severityOf(ruleId), pack, file, path, message };
}

/**
 * The text-bearing hits: the `text`, `templates` and `names` categories carry
 * prose or template strings the text rules scan (design, "Text scanning": "Text
 * fields come from Field Declarations (`text`, `templates`, `names`)"). Tag,
 * Tag Query and Year Range hits are not text, so they are excluded.
 */
function isTextHit(hit: FieldHit): boolean {
  return (
    (hit.category === 'text' ||
      hit.category === 'templates' ||
      hit.category === 'names') &&
    typeof hit.value === 'string'
  );
}

// --- CE-DUPTEXT and CE-NEARDUP ---------------------------------------------

/** A scanned text with its location and folded tokens, for the duplicate rules. */
interface ScannedText {
  readonly hit: FieldHit;
  readonly folded: string;
  readonly tokens: string[];
}

/** The grouping key for duplicate detection: the kind and the declared field. */
function groupKey(hit: FieldHit): string {
  return `${hit.kind}\u0000${fieldOf(hit.path)}`;
}

/**
 * The declared-field name of a located path, with the per-item list indices
 * removed (`items[2].backgrounds[0].text` → `items.backgrounds.text`). Two hits
 * from the same declaration on different items share a field name, so they fall
 * into one `(kind, field)` group (design, CE-DUPTEXT "within (kind, field)").
 */
function fieldOf(path: string): string {
  return path.replace(/\[\d+\]/g, '');
}

/** Group text hits by `(kind, field)`, keeping input (deterministic) order. */
function groupTexts(hits: readonly FieldHit[]): Map<string, ScannedText[]> {
  const groups = new Map<string, ScannedText[]>();
  for (const hit of hits) {
    if (!isTextHit(hit)) {
      continue;
    }
    const tokens = tokenise(hit.value as string);
    const scanned: ScannedText = { hit, folded: tokens.join(' '), tokens };
    const key = groupKey(hit);
    const bucket = groups.get(key);
    if (bucket === undefined) {
      groups.set(key, [scanned]);
    } else {
      bucket.push(scanned);
    }
  }
  return groups;
}

/**
 * CE-DUPTEXT — exact duplicate text within a `(kind, field)` group. Two texts
 * are exact duplicates when their folded token streams are identical (so the
 * comparison ignores case, diacritics and template slots, like every other text
 * rule). The first occurrence in each group is the canonical one; every later
 * occurrence is reported, pointing back at the first it duplicates.
 */
export const duptextRule: GenericFieldRule = {
  id: 'CE-DUPTEXT',
  run(hits) {
    const findings: LintFinding[] = [];
    for (const group of groupTexts(hits).values()) {
      const firstByText = new Map<string, ScannedText>();
      for (const text of group) {
        if (text.folded === '') {
          continue;
        }
        const first = firstByText.get(text.folded);
        if (first === undefined) {
          firstByText.set(text.folded, text);
          continue;
        }
        findings.push(
          finding(
            'CE-DUPTEXT',
            text.hit.pack,
            text.hit.file,
            text.hit.path,
            `exact duplicate text; first seen at ${first.hit.pack}/${first.hit.file}:${first.hit.path}`,
          ),
        );
      }
    }
    return findings;
  },
};

/**
 * CE-NEARDUP — near-duplicate text within a `(kind, field)` group, by exact
 * word 3-shingle Jaccard. Within each group, every pair of texts of at least
 * {@link NEARDUP_MIN_WORDS} words whose 3-shingle sets have Jaccard similarity
 * at least {@link NEARDUP_JACCARD} is a near-duplicate; the later text of the
 * pair is reported, naming the earlier and the similarity (design,
 * "Near-duplicate detection"; the pairs are produced in index order so the
 * output is deterministic).
 *
 * Exact duplicates (Jaccard 1) are left to CE-DUPTEXT; CE-NEARDUP reports a
 * pair only when it is a near — but not exact — duplicate, so the two rules do
 * not both fire on one pair.
 */
export const neardupRule: GenericFieldRule = {
  id: 'CE-NEARDUP',
  run(hits) {
    const findings: LintFinding[] = [];
    for (const group of groupTexts(hits).values()) {
      const long = group.filter((t) => t.tokens.length >= NEARDUP_MIN_WORDS);
      const sets = long.map((t) => shingles(t.tokens));
      for (let j = 1; j < long.length; j += 1) {
        for (let i = 0; i < j; i += 1) {
          if (long[i].folded === long[j].folded) {
            continue; // exact duplicate — CE-DUPTEXT owns it
          }
          const sim = jaccard(sets[i], sets[j]);
          if (sim >= NEARDUP_JACCARD) {
            findings.push(
              finding(
                'CE-NEARDUP',
                long[j].hit.pack,
                long[j].hit.file,
                long[j].hit.path,
                `near-duplicate of ${long[i].hit.pack}/${long[i].hit.file}:${long[i].hit.path} (Jaccard ${sim.toFixed(2)})`,
              ),
            );
            break; // one finding per text is enough; it names its nearest earlier match
          }
        }
      }
    }
    return findings;
  },
};

// --- CE-NAMEDUP ------------------------------------------------------------

/** The directory the `culture-group` kind is written under (content registry). */
const CULTURE_GROUP_DIR = 'culture-groups';

/** Whether a pack-relative path belongs to the culture-group kind. */
function isCultureGroupFile(relPath: string): boolean {
  return (
    relPath === `${CULTURE_GROUP_DIR}.yaml` ||
    relPath === `${CULTURE_GROUP_DIR}.yml` ||
    relPath.startsWith(`${CULTURE_GROUP_DIR}/`)
  );
}

/** One Name Pool of a Culture Group, located for a finding. */
interface NamePool {
  readonly pack: string;
  readonly file: string;
  /** The item + sub-path to the pool, e.g. `items[0].given.m` or `items[0].family`. */
  readonly path: string;
  readonly names: readonly unknown[];
}

/** Read every Culture Group's given-by-gender and family Name Pools. */
function namePoolsOf(packs: readonly ParsedPack[]): NamePool[] {
  const pools: NamePool[] = [];
  for (const pack of packs) {
    for (const file of pack.files) {
      if (!file.parsed || !isCultureGroupFile(file.relPath)) {
        continue;
      }
      const { items, pathAt } = itemsOf(file.content);
      items.forEach((item, index) => {
        if (typeof item !== 'object' || item === null) {
          return;
        }
        const base = pathAt(index);
        const record = item as Record<string, unknown>;
        const given = record.given;
        if (typeof given === 'object' && given !== null) {
          for (const gender of ['f', 'm'] as const) {
            const list = (given as Record<string, unknown>)[gender];
            if (Array.isArray(list)) {
              pools.push({ pack: pack.id, file: file.relPath, path: `${base}.given.${gender}`, names: list });
            }
          }
        }
        if (Array.isArray(record.family)) {
          pools.push({ pack: pack.id, file: file.relPath, path: `${base}.family`, names: record.family });
        }
      });
    }
  }
  return pools;
}

/**
 * The folded comparison key of a name-pool entry. A given name is a string; a
 * family name may be a `{ m, f }` gendered pair, whose two forms are keyed
 * separately so "Novák"/"Nováková" are distinct entries but a repeated identical
 * pair is caught. A non-string, non-pair entry yields no key (the loader's
 * schema check reports its shape).
 */
function nameKeys(entry: unknown): string[] {
  if (typeof entry === 'string') {
    return [fold(entry)];
  }
  if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) {
    const record = entry as Record<string, unknown>;
    const keys: string[] = [];
    for (const form of ['m', 'f'] as const) {
      if (typeof record[form] === 'string') {
        keys.push(`${form}:${fold(record[form] as string)}`);
      }
    }
    return keys;
  }
  return [];
}

/**
 * CE-NAMEDUP — a duplicate entry within a single Name Pool of a Culture Group.
 * Each given-by-gender pool and each family pool is checked independently
 * (duplicates across pools, or across Culture Groups, are not reported — a name
 * may legitimately recur in different cultures). Comparison is diacritic- and
 * case-folded, so "Müller" twice is a duplicate. The later index is reported.
 */
export const namedupRule: GenericFieldRule = {
  id: 'CE-NAMEDUP',
  run(_hits, ctx) {
    const findings: LintFinding[] = [];
    for (const pool of namePoolsOf(ctx.packs)) {
      const seen = new Map<string, number>();
      pool.names.forEach((entry, index) => {
        // A gendered pair contributes two keys; report the entry once, at the
        // earliest form that collides, so a repeated pair is one finding.
        let firstCollision: number | undefined;
        for (const key of nameKeys(entry)) {
          const firstIndex = seen.get(key);
          if (firstIndex === undefined) {
            seen.set(key, index);
          } else if (firstCollision === undefined || firstIndex < firstCollision) {
            firstCollision = firstIndex;
          }
        }
        if (firstCollision !== undefined) {
          findings.push(
            finding(
              'CE-NAMEDUP',
              pool.pack,
              pool.file,
              `${pool.path}[${index}]`,
              `duplicate name within the pool ${pool.path}; first at index ${firstCollision}`,
            ),
          );
        }
      });
    }
    return findings;
  },
};

// --- CE-REALPERSON ---------------------------------------------------------

/** The directory the `blocklist` kind is written under (content registry). */
const BLOCKLIST_DIR = 'blocklist';

/** One compiled Real-Person Blocklist entry: the folded name tokens to match. */
interface BlockEntry {
  readonly tokens: string[];
  readonly familyOnly: boolean;
  readonly display: string;
}

/** Whether a pack-relative path belongs to the blocklist kind. */
function isBlocklistFile(relPath: string): boolean {
  return (
    relPath === `${BLOCKLIST_DIR}.yaml` ||
    relPath === `${BLOCKLIST_DIR}.yml` ||
    relPath.startsWith(`${BLOCKLIST_DIR}/`)
  );
}

/**
 * Read and compile the Real-Person Blocklist from the parsed packs. A
 * `familyOnly` entry matches on its family name alone: the last
 * whitespace-separated word, the same token the namer stores. A hyphen stays
 * inside that word, so "Douglas-Home" is the surname and the English word
 * "home" is not. Every other entry matches on its full folded token sequence
 * (design, blocklist; Req 12.4). Reading from the parsed packs means the rule
 * still runs when the load otherwise failed (Req 13.1).
 */
function blocklistOf(packs: readonly ParsedPack[]): BlockEntry[] {
  const entries: BlockEntry[] = [];
  for (const pack of packs) {
    for (const file of pack.files) {
      if (!file.parsed || !isBlocklistFile(file.relPath)) {
        continue;
      }
      for (const item of itemsOf(file.content).items) {
        if (typeof item !== 'object' || item === null) {
          continue;
        }
        const record = item as Record<string, unknown>;
        if (typeof record.name !== 'string') {
          continue;
        }
        const tokens = tokenise(record.name);
        if (tokens.length === 0) {
          continue;
        }
        const familyOnly = record.familyOnly === true;
        const words = record.name.trim().split(/\s+/u);
        const family = tokenise(words[words.length - 1] ?? record.name);
        entries.push({
          tokens: familyOnly && family.length > 0 ? family : tokens,
          familyOnly,
          display: record.name,
        });
      }
    }
  }
  return entries;
}

/**
 * CE-REALPERSON — a Real-Person Blocklist name occurring in a name or text
 * field (Req 3.3 redraw at generation time has the authoring-side mirror here:
 * no authored name or text may use a blocklisted individual). Every text,
 * template and name hit is tokenised and tested against each blocklist entry's
 * folded token sequence as a contiguous whole-word match.
 */
export const realPersonRule: GenericFieldRule = {
  id: 'CE-REALPERSON',
  run(hits, ctx) {
    const blocklist = blocklistOf(ctx.packs);
    if (blocklist.length === 0) {
      return [];
    }
    const findings: LintFinding[] = [];
    for (const hit of hits) {
      if (!isTextHit(hit)) {
        continue;
      }
      // A blocklist name field is itself a name hit; do not report the
      // blocklist entry against its own listing.
      if (isBlocklistFile(hit.file) && hit.category === 'names') {
        continue;
      }
      const tokens = tokenise(hit.value as string);
      for (const entry of blocklist) {
        if (containsSequence(tokens, entry.tokens)) {
          findings.push(
            finding(
              'CE-REALPERSON',
              hit.pack,
              hit.file,
              hit.path,
              `text matches Real-Person Blocklist entry "${entry.display}"${entry.familyOnly ? ' (family name)' : ''}`,
            ),
          );
        }
      }
    }
    return findings;
  },
};

// --- CE-SENSITIVE ----------------------------------------------------------

/** The directory the `sensitivity` kind is written under (content registry). */
const SENSITIVITY_DIR = 'sensitivity';

/** One compiled Sensitivity Term: the folded pattern tokens to match. */
interface SensitivePattern {
  readonly tokens: string[];
  readonly display: string;
}

/** Whether a pack-relative path belongs to the sensitivity kind. */
function isSensitivityFile(relPath: string): boolean {
  return (
    relPath === `${SENSITIVITY_DIR}.yaml` ||
    relPath === `${SENSITIVITY_DIR}.yml` ||
    relPath.startsWith(`${SENSITIVITY_DIR}/`)
  );
}

/**
 * Read and compile the Sensitivity Term List from the parsed packs. Each term's
 * `pattern` is tokenised to the folded token sequence the matcher looks for
 * (design, SensitivityTerm; Req 12.1). Read from parsed packs so the rule runs
 * even when the load otherwise failed.
 */
function sensitivityOf(packs: readonly ParsedPack[]): SensitivePattern[] {
  const patterns: SensitivePattern[] = [];
  for (const pack of packs) {
    for (const file of pack.files) {
      if (!file.parsed || !isSensitivityFile(file.relPath)) {
        continue;
      }
      for (const item of itemsOf(file.content).items) {
        if (typeof item !== 'object' || item === null) {
          continue;
        }
        const record = item as Record<string, unknown>;
        const source = typeof record.pattern === 'string' ? record.pattern : record.term;
        if (typeof source !== 'string') {
          continue;
        }
        const tokens = tokenise(source);
        if (tokens.length === 0) {
          continue;
        }
        const display = typeof record.term === 'string' ? record.term : source;
        patterns.push({ tokens, display });
      }
    }
  }
  return patterns;
}

/**
 * CE-SENSITIVE — a Sensitivity Term occurring in any scanned text field (Req
 * 3.8, 12.1). Every text, template and name hit is tokenised and tested against
 * each term's folded pattern as a contiguous whole-word match. The term list
 * itself is not scanned against its own patterns.
 */
export const sensitiveRule: GenericFieldRule = {
  id: 'CE-SENSITIVE',
  run(hits, ctx) {
    const patterns = sensitivityOf(ctx.packs);
    if (patterns.length === 0) {
      return [];
    }
    const findings: LintFinding[] = [];
    for (const hit of hits) {
      if (!isTextHit(hit) || isSensitivityFile(hit.file)) {
        continue;
      }
      const tokens = tokenise(hit.value as string);
      for (const pattern of patterns) {
        if (containsSequence(tokens, pattern.tokens)) {
          findings.push(
            finding(
              'CE-SENSITIVE',
              hit.pack,
              hit.file,
              hit.path,
              `text matches Sensitivity Term "${pattern.display}"`,
            ),
          );
        }
      }
    }
    return findings;
  },
};

// --- CE-SOURCE -------------------------------------------------------------

/** The directory the `location` kind is written under (content registry). */
const LOCATION_DIR = 'locations';

/** Whether a pack-relative path belongs to the location kind. */
function isLocationFile(relPath: string): boolean {
  return (
    relPath === `${LOCATION_DIR}.yaml` ||
    relPath === `${LOCATION_DIR}.yml` ||
    relPath.startsWith(`${LOCATION_DIR}/`)
  );
}

/**
 * CE-SOURCE — a `real-landmark` Location that cites no Sources List entry (Req
 * 3.1; design, CE-SOURCE). The Location's `basis` and `sources` are ordinary
 * schema fields, not declared text, so the rule reads the parsed Location items
 * directly rather than the FieldHit stream. A Location whose `basis` is
 * `real-landmark` and whose `sources` list is missing or empty is reported;
 * `real-inspired` and `fictional` Locations need no citation.
 */
export const sourceRule: GenericFieldRule = {
  id: 'CE-SOURCE',
  run(_hits, ctx) {
    const findings: LintFinding[] = [];
    for (const pack of ctx.packs) {
      for (const file of pack.files) {
        if (!file.parsed || !isLocationFile(file.relPath)) {
          continue;
        }
        const { items, pathAt } = itemsOf(file.content);
        items.forEach((item, index) => {
          if (typeof item !== 'object' || item === null) {
            return;
          }
          const record = item as Record<string, unknown>;
          if (record.basis !== 'real-landmark') {
            return;
          }
          const sources = record.sources;
          const cited = Array.isArray(sources) && sources.length > 0;
          if (!cited) {
            findings.push(
              finding(
                'CE-SOURCE',
                pack.id,
                file.relPath,
                pathAt(index),
                'a real-landmark Location must cite at least one Sources List entry',
              ),
            );
          }
        });
      }
    }
    return findings;
  },
};

// --- registration ----------------------------------------------------------

/**
 * The task 5.3 Lint Rules that run over the FieldHit stream and the parsed
 * packs. {@link ../generic-rules} folds these into `GENERIC_FIELD_RULES`, which
 * the orchestrator runs after the loader-backed and own-check rules. Task 5.4
 * appends the period, style, quantity and stability rules.
 */
export const TEXT_SAFETY_AND_IDENTITY_RULES: readonly GenericFieldRule[] = [
  duptextRule,
  neardupRule,
  namedupRule,
  realPersonRule,
  sensitiveRule,
  sourceRule,
];

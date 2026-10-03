/**
 * The Pack Linter (`content-tools/lint`).
 *
 * The framework (content-expansion task 5.2): the {@link lint} orchestrator,
 * the rule table and framework types ({@link LintRule}, {@link LintFinding},
 * {@link LintContext}), the ContentError→rule mapping, the `draft`/`release`
 * profiles, `lint.yaml` Suppressions and the generic Field-Declaration rule
 * plumbing. The concrete rule bodies land in tasks 5.3–5.4.
 *
 * This module also owns the `lint` subcommand's CLI: it parses argv, calls
 * {@link lint}, renders the report as text (default) or JSON (`--json`) and
 * returns the exit code — 0 when no finding has error severity, non-zero
 * otherwise (Req 13.4).
 *
 * CLI: `pnpm content lint [--packs a,b] [--profile draft|release] [--baseline path] [--json]`.
 */

import { lint, type LintOptions } from './lint.js';
import { loadBaseline } from './baseline.js';
import { formatJson, formatText, exitCodeFor } from './output.js';
import type { LintProfile } from './rules.js';

export { lint, type LintOptions } from './lint.js';
export {
  LINT_RULES,
  RULES_BY_ID,
  NON_SUPPRESSIBLE_RULES,
  effectiveSeverity,
  ruleRunsInProfile,
  type BaselineManifest,
  type LintContext,
  type LintFinding,
  type LintProfile,
  type LintRule,
  type LintSeverity,
} from './rules.js';
export {
  readParsedPacks,
  fieldValues,
  itemsOf,
  type FieldLeaf,
  type ItemList,
  type ParsedFile,
  type ParsedPack,
} from './parsed-files.js';
export { ruleForError, findingForError } from './error-map.js';
export {
  collectSuppressions,
  applySuppressions,
  type CollectedSuppressions,
  type OwnedSuppression,
  type Suppression,
} from './suppressions.js';
export {
  collectFieldHits,
  runGenericRules,
  GENERIC_FIELD_RULES,
  type FieldCategory,
  type FieldHit,
  type GenericFieldRule,
} from './generic-rules.js';
export {
  TEXT_SAFETY_AND_IDENTITY_RULES,
  tokenise,
  containsSequence,
  duptextRule,
  neardupRule,
  namedupRule,
  realPersonRule,
  sensitiveRule,
  sourceRule,
} from './concrete-rules.js';
export {
  PERIOD_AND_STYLE_RULES,
  anachRule,
  periodRule,
  styleRule,
  allowlistRule,
} from './period-rules.js';
export {
  FEASIBLE_SEED_COUNT,
  quantityCheck,
  feasibleCheck,
  idStableCheck,
} from './stability-rules.js';
export {
  buildReport,
  sortFindings,
  summarise,
  exitCodeFor,
  formatText,
  formatJson,
  type LintReport,
} from './output.js';

/** Options parsed from the `lint` subcommand's argv. */
export interface LintCliOptions {
  readonly argv: readonly string[];
}

/** The default pack directory the CLI loads from when `--dirs` is omitted. */
const DEFAULT_PACK_DIR = 'packages/content/packs';

/** The `lint` subcommand's parsed flags. */
interface ParsedArgs {
  readonly dirs: readonly string[];
  readonly selected: readonly string[];
  readonly profile: LintProfile;
  readonly baseline?: string;
  readonly json: boolean;
}

/** The usage shown for `pnpm content lint --help`. */
const LINT_USAGE = `Usage: pnpm content lint [options]

Options:
  --packs a,b           pack ids to lint (default: every pack found under --dirs)
  --dirs path[,path]    pack directories to search (default: ${DEFAULT_PACK_DIR})
  --profile draft|release   lint profile (default: draft)
  --baseline <path>     a Baseline Manifest for the id-stability check
  --json                emit JSON instead of text
  --help                show this help`;

/**
 * Parse the `lint` argv. Comma-separated `--packs` and `--dirs` lists are
 * split; `--profile` must be `draft` or `release`; `--json` is a flag. An
 * unknown flag or a bad profile throws, so the CLI shell reports it and exits
 * non-zero.
 */
function parseArgs(argv: readonly string[]): ParsedArgs | 'help' {
  let dirs: string[] = [DEFAULT_PACK_DIR];
  let selected: string[] = [];
  let profile: LintProfile = 'draft';
  let baseline: string | undefined;
  let json = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const takeValue = (): string => {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new Error(`content lint: ${arg} needs a value`);
      }
      i += 1;
      return value;
    };
    switch (arg) {
      case '--help':
      case '-h':
        return 'help';
      case '--packs':
        selected = splitList(takeValue());
        break;
      case '--dirs':
        dirs = splitList(takeValue());
        break;
      case '--profile': {
        const value = takeValue();
        if (value !== 'draft' && value !== 'release') {
          throw new Error(`content lint: --profile must be "draft" or "release", got "${value}"`);
        }
        profile = value;
        break;
      }
      case '--baseline':
        baseline = takeValue();
        break;
      case '--json':
        json = true;
        break;
      default:
        throw new Error(`content lint: unknown option "${arg}"`);
    }
  }

  return { dirs, selected, profile, baseline, json };
}

/** Split a comma-separated list flag, trimming blanks. */
function splitList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * The `lint` subcommand. Parses argv, runs {@link lint}, writes the report as
 * text or JSON and returns the exit code (0 iff no error-severity finding,
 * Req 13.4). A usage or option error throws for the CLI shell to report; a
 * baseline that cannot be read is reported and exits non-zero.
 */
export function runLint(options: LintCliOptions): number {
  const parsed = parseArgs(options.argv);
  if (parsed === 'help') {
    process.stdout.write(`${LINT_USAGE}\n`);
    return 0;
  }

  const lintOptions: LintOptions = { profile: parsed.profile };
  if (parsed.baseline !== undefined) {
    const result = loadBaseline(parsed.baseline);
    if (!result.ok) {
      process.stderr.write(`${result.message}\n`);
      return 1;
    }
    (lintOptions as { baseline?: unknown }).baseline = result.baseline;
  }

  const report = lint(parsed.dirs, parsed.selected, lintOptions);
  process.stdout.write(parsed.json ? formatJson(report) : formatText(report));
  return exitCodeFor(report);
}

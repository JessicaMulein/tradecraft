/**
 * The Preview CLI (`content-tools/preview`).
 *
 * `pnpm content preview --packs <ids> --city <id> --seed <s> --preset <p>
 *   --kind <k> [--count n] [--reveal] [--out file]`
 *
 * The Preview CLI (content-expansion task 5.9; design, "Preview CLI") generates
 * a world with the engine's pure `generate`/`generateGame` and renders a chosen
 * slice of it through the `player-view` projections (content-tools may import
 * `engine` and `player-view` but no runtime package may import content-tools).
 * It renders one of the kinds `city`, `locations`, `npcs`, `newspaper`,
 * `documents`, `dossiers`, `cables`, `fact-lines` and `intercepts` (Req 14.1,
 * 14.2).
 *
 * Output is plain UTF-8 with `\n` line endings, so it is byte-stable for a given
 * `(packs, city, seed, preset, kind, reveal, count)` (Req 14.3) — the design's
 * golden previews rest on this. Without `--reveal` the preview prints only
 * projection output; `--reveal` prepends a one-line warning header and lets the
 * renderers show the ground truth they otherwise hide (Req 14.6). `--count`
 * caps how many items a list kind prints, and `--out` writes to a file instead
 * of stdout. A loader failure (a bad pack set, an unknown city/preset, an
 * infeasible generation) is reported to stderr and the command exits non-zero
 * (Req 14.4, 14.5).
 *
 * This module owns the subcommand's CLI only: argv parsing, loading the packs
 * and the Core City side files from disk, and the stdout/file IO. The pure
 * world build ({@link ./world}) and the pure renderers ({@link ./render}) carry
 * the logic and are unit-tested without the filesystem.
 */

import { readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  loadContent,
  loadCityData,
  loadDescriptorData,
  loadPublicTexts,
  SLICE_KIND_REGISTRATIONS,
  CONTENT_EXPANSION_KIND_REGISTRATIONS,
  type ContentKindRegistration,
} from '@tradecraft/content';

import {
  buildPreviewWorld,
  PreviewWorldError,
  type PreviewContent,
  type PreviewWorldRequest,
} from './world.js';
import {
  isPreviewKind,
  needsAdvance,
  PREVIEW_KINDS,
  REVEAL_WARNING,
  renderPreview,
  type PreviewKind,
} from './render.js';

export {
  buildPreviewWorld,
  PreviewWorldError,
  PREVIEW_DAYS,
  type PreviewContent,
  type PreviewWorld,
  type PreviewWorldRequest,
} from './world.js';
export {
  isPreviewKind,
  needsAdvance,
  renderPreview,
  PREVIEW_KINDS,
  REVEAL_WARNING,
  type PreviewKind,
  type RenderOptions,
} from './render.js';

/** The default pack directory the CLI searches for packs when `--dirs` is omitted. */
const DEFAULT_PACK_DIR = 'packages/content/packs';
/** The default Difficulty Preset a preview runs under. */
const DEFAULT_PRESET = 'standard';
/** The default city a preview is placed in (the Core City). */
const DEFAULT_CITY = 'core';
/** The default number of items a list kind prints. */
const DEFAULT_COUNT = 10;

/** Options parsed from the `preview` subcommand's argv (the CLI shell's input). */
export interface PreviewCliOptions {
  readonly argv: readonly string[];
}

/** The `preview` subcommand's parsed flags. */
interface ParsedArgs {
  readonly dirs: readonly string[];
  readonly selected: readonly string[];
  readonly city: string;
  readonly preset: string;
  readonly seed: string;
  readonly kind: PreviewKind;
  readonly count: number;
  readonly reveal: boolean;
  readonly out?: string;
}

/** The usage shown for `pnpm content preview --help`. */
const PREVIEW_USAGE = `Usage: pnpm content preview [options]

Options:
  --packs a,b           pack ids to load (default: every pack found under --dirs)
  --dirs path[,path]    pack directories (or parents of them) to search (default: ${DEFAULT_PACK_DIR})
  --city <id>           the city to place the game in (default: ${DEFAULT_CITY})
  --seed <s>            the game seed (required)
  --preset <p>          the Difficulty Preset (default: ${DEFAULT_PRESET})
  --kind <k>            what to render: ${PREVIEW_KINDS.join(', ')} (required)
  --count <n>           items to print for a list kind (default: ${DEFAULT_COUNT})
  --reveal              also print ground truth, behind a warning header
  --out <file>          write to a file instead of stdout
  --help                show this help`;

/** Parse the `preview` argv, or `'help'`. Throws on a bad or missing option. */
function parseArgs(argv: readonly string[]): ParsedArgs | 'help' {
  let dirs: string[] = [DEFAULT_PACK_DIR];
  let selected: string[] = [];
  let city = DEFAULT_CITY;
  let preset = DEFAULT_PRESET;
  let seed: string | undefined;
  let kind: PreviewKind | undefined;
  let count = DEFAULT_COUNT;
  let reveal = false;
  let out: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const takeValue = (): string => {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new Error(`content preview: ${arg} needs a value`);
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
      case '--city':
        city = takeValue();
        break;
      case '--preset':
        preset = takeValue();
        break;
      case '--seed':
        seed = takeValue();
        break;
      case '--kind': {
        const value = takeValue();
        if (!isPreviewKind(value)) {
          throw new Error(
            `content preview: unknown kind "${value}" (expected one of ${PREVIEW_KINDS.join(', ')})`,
          );
        }
        kind = value;
        break;
      }
      case '--count': {
        const value = Number(takeValue());
        if (!Number.isInteger(value) || value < 1) {
          throw new Error('content preview: --count must be a positive integer');
        }
        count = value;
        break;
      }
      case '--reveal':
        reveal = true;
        break;
      case '--out':
        out = takeValue();
        break;
      default:
        throw new Error(`content preview: unknown option "${arg}"`);
    }
  }

  if (seed === undefined) {
    throw new Error('content preview: --seed is required');
  }
  if (kind === undefined) {
    throw new Error('content preview: --kind is required');
  }
  return {
    dirs,
    selected,
    city,
    preset,
    seed,
    kind,
    count,
    reveal,
    ...(out === undefined ? {} : { out }),
  };
}

/** Split a comma-separated list flag, trimming blanks. */
function splitList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Whether a directory holds a `pack.yaml` (and so is itself a pack directory). */
function isPackDir(dir: string): boolean {
  try {
    return statSync(join(dir, 'pack.yaml')).isFile();
  } catch {
    return false;
  }
}

/**
 * Expand each `--dirs` entry to the pack directories the loader reads: the
 * entry itself when it is a pack, else its immediate subdirectories that are
 * packs. This lets `--dirs packages/content/packs` name the parent of the
 * shipped packs while the loader still receives one directory per pack
 * (matching the Coverage Report's expansion).
 */
function expandPackDirs(dirs: readonly string[]): string[] {
  const out: string[] = [];
  for (const dir of dirs) {
    if (isPackDir(dir)) {
      out.push(dir);
      continue;
    }
    let entries: string[];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = join(dir, name);
      if (isPackDir(full)) {
        out.push(full);
      }
    }
  }
  return out;
}

/** The effective Content Kind Registry: slice kinds plus this spec's kinds. */
function effectiveRegistry(): ContentKindRegistration[] {
  const byKind = new Map<string, ContentKindRegistration>();
  for (const reg of [...SLICE_KIND_REGISTRATIONS, ...CONTENT_EXPANSION_KIND_REGISTRATIONS]) {
    if (!byKind.has(reg.kind)) {
      byKind.set(reg.kind, reg);
    }
  }
  return [...byKind.values()];
}

/** Find the core pack directory among the expanded pack dirs (the `core` pack). */
function findCorePackDir(packDirs: readonly string[]): string | undefined {
  for (const dir of packDirs) {
    if (dir.endsWith('/core') || dir.endsWith('\\core') || dir === 'core') {
      return dir;
    }
  }
  return undefined;
}

/**
 * Load the Content Set and the Core City side files from disk for a preview
 * (content-tools may import the loaders through `engine`). The Content Set is
 * loaded from the chosen pack set; the `city.yaml`, `descriptors.yaml` and
 * public-text side files come from the core pack, which the generator needs for
 * its types (and, on the Core City Path, its geometry) — exactly as the
 * Coverage Report loads them. Throws a {@link PreviewWorldError} on any located
 * failure, which the CLI reports with a non-zero exit (Req 14.5).
 */
export function loadPreviewContent(
  dirs: readonly string[],
  selected: readonly string[],
): PreviewContent {
  const packDirs = expandPackDirs(dirs);
  const loaded = loadContent(packDirs, [...selected], { kinds: effectiveRegistry() });
  if (!loaded.ok) {
    const detail = loaded.errors
      .map((e) => `  ${e.pack}/${e.file} ${e.path}: ${e.message}`)
      .join('\n');
    throw new PreviewWorldError(`the pack set failed to load:\n${detail}`);
  }

  const corePackDir = findCorePackDir(packDirs);
  if (corePackDir === undefined) {
    throw new PreviewWorldError('no core pack found among the loaded packs');
  }
  const cityData = loadCityData(corePackDir);
  if (!cityData.ok) {
    throw new PreviewWorldError('core city.yaml failed to load');
  }
  const descriptors = loadDescriptorData(corePackDir);
  if (!descriptors.ok) {
    throw new PreviewWorldError('core descriptors.yaml failed to load');
  }
  const publicTexts = loadPublicTexts(corePackDir);
  if (!publicTexts.ok) {
    throw new PreviewWorldError('core public texts failed to load');
  }

  return {
    content: loaded.value,
    cityData: cityData.value,
    descriptors: descriptors.value,
    publicTexts: publicTexts.value,
  };
}

/** The selection {@link previewText} renders: the city/preset/seed, the kind,
 * and the two display flags. The CLI's parsed flags are a superset of this. */
export interface PreviewTextOptions {
  readonly city: string;
  readonly preset: string;
  readonly seed: string;
  readonly kind: PreviewKind;
  readonly count: number;
  readonly reveal: boolean;
}

/**
 * Build the full preview output text for a selection: the rendered kind, with
 * the {@link REVEAL_WARNING} header prepended when `reveal` is set. Pure given
 * the loaded content, so a test asserts the exact bytes.
 */
export function previewText(
  loaded: PreviewContent,
  options: PreviewTextOptions,
): string {
  const request: PreviewWorldRequest = {
    city: options.city,
    preset: options.preset,
    seed: options.seed,
    advanceDays: needsAdvance(options.kind),
  };
  const preview = buildPreviewWorld(loaded, request);
  const body = renderPreview(options.kind, preview, {
    reveal: options.reveal,
    count: options.count,
  });
  return options.reveal ? `${REVEAL_WARNING}\n${body}` : body;
}

/**
 * The `preview` subcommand. Parses the argv, loads the packs and Core City side
 * files, generates the world, renders the chosen kind, and writes the output to
 * `--out` or stdout. A located failure throws a {@link PreviewWorldError} (or a
 * parse error) for the CLI shell to report with a non-zero exit (Req 14.4,
 * 14.5). Output ends with a trailing newline so a redirected file is a complete
 * line-terminated text; the body itself uses `\n` line endings, so the bytes are
 * stable (Req 14.3).
 */
export function runPreview(options: PreviewCliOptions): void {
  const parsed = parseArgs(options.argv);
  if (parsed === 'help') {
    process.stdout.write(`${PREVIEW_USAGE}\n`);
    return;
  }

  const loaded = loadPreviewContent(parsed.dirs, parsed.selected);
  const text = previewText(loaded, parsed);

  if (parsed.out !== undefined) {
    mkdirSync(dirname(parsed.out), { recursive: true });
    writeFileSync(parsed.out, `${text}\n`, 'utf8');
    process.stdout.write(`wrote ${parsed.kind} preview to ${parsed.out}\n`);
    return;
  }
  process.stdout.write(`${text}\n`);
}

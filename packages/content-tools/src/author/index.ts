/**
 * The offline Authoring Aid and promotion (`content-tools/author`).
 *
 * The Authoring Aid drafts candidate content with a local LLM and writes it to
 * the Draft Area, where it waits for human review; `promote` merges a reviewed
 * draft into a real pack only when the whole set lints clean (content-expansion
 * task 5.13; design, "Authoring Aid"; Req 16.2, 16.5, 16.6, 16.7, 16.8).
 *
 * This module owns the two subcommands' CLIs — argv parsing, reading
 * `config/authoring.yaml` and the packs from disk, and the thin `node:fs`/
 * OpenAI-client adapters — and delegates every decision to the pure cores in
 * {@link ./author-core} and {@link ./promote-core}, which take injected
 * clients and filesystems so the whole flow is unit-tested with a mocked model
 * (task 5.14) and no network.
 *
 * CLI:
 *   pnpm content author --pack <id> --kind <kind> --count <n> [--brief "<text>"]
 *                       [--dirs a,b] [--config path] [--remote]
 *   pnpm content promote <draft-file> --into <pack-file> --reviewer <name>
 *                       [--dirs a,b] [--profile draft|release]
 */

import { readFileSync, writeFileSync, rmSync, mkdirSync, cpSync, mkdtempSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';

import { parse as parseYaml } from 'yaml';
import {
  SLICE_KIND_REGISTRATIONS,
  CONTENT_EXPANSION_KIND_REGISTRATIONS,
  type ContentKindRegistration,
} from '@tradecraft/content';

import { readParsedPacks } from '../lint/parsed-files.js';
import { lint } from '../lint/lint.js';
import type { LintOptions } from '../lint/lint.js';
import { parseAuthoringConfig, type AuthoringConfig } from './config.js';
import {
  runAuthorCore,
  type AuthorClient,
  type AuthorCallOptions,
  type AuthorMessage,
  type AuthorRequest,
  type DraftSink,
} from './author-core.js';
import { runPromoteCore, type PromoteFs } from './promote-core.js';

export {
  AuthoringConfigSchema,
  endpointDecision,
  isLocalEndpoint,
  parseAuthoringConfig,
  type AuthoringConfig,
  type EndpointDecision,
} from './config.js';
export {
  buildPrompt,
  collectPromptInputs,
  periodOf,
  schemaForKind,
  type PromptInputs,
  type PromptMessages,
  type PromptRequest,
} from './prompt.js';
export {
  runAuthorCore,
  draftPathFor,
  draftStamp,
  hashPrompt,
  systemAuthorClock,
  type AuthorCallOptions,
  type AuthorClient,
  type AuthorClock,
  type AuthorMessage,
  type AuthorRequest,
  type AuthorResult,
  type DraftSink,
} from './author-core.js';
export {
  runPromoteCore,
  buildPromotedFile,
  systemPromoteClock,
  type PromoteClock,
  type PromoteFs,
  type PromoteRequest,
  type PromoteResult,
} from './promote-core.js';

/** Options parsed from the `author`/`promote` subcommands' argv. */
export interface AuthorCliOptions {
  readonly argv: readonly string[];
}

/** The default pack directory the CLIs load from when `--dirs` is omitted. */
const DEFAULT_PACK_DIR = 'packages/content/packs';

/** The default authoring config path. */
const DEFAULT_CONFIG_PATH = 'config/authoring.yaml';

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

/** Split a comma-separated list flag, trimming blanks. */
function splitList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// --- author ---------------------------------------------------------------

const AUTHOR_USAGE = `Usage: pnpm content author [options]

Options:
  --pack <id>           the pack id the draft is for (required)
  --kind <kind>         the content kind to draft (required)
  --count <n>           how many items to draft (default: 1)
  --brief "<text>"      a free-text brief to steer the draft
  --dirs path[,path]    pack directories to read context from (default: ${DEFAULT_PACK_DIR})
  --config <path>       the authoring config (default: ${DEFAULT_CONFIG_PATH})
  --remote              allow a non-local endpoint (needs allowRemote in the config)
  --help                show this help`;

/** The `author` subcommand's parsed flags. */
interface AuthorArgs {
  readonly pack: string;
  readonly kind: string;
  readonly count: number;
  readonly brief?: string;
  readonly dirs: readonly string[];
  readonly configPath: string;
  readonly remote: boolean;
}

/** Parse the `author` argv, or `'help'`. Throws on a bad or missing option. */
function parseAuthorArgs(argv: readonly string[]): AuthorArgs | 'help' {
  let pack: string | undefined;
  let kind: string | undefined;
  let count = 1;
  let brief: string | undefined;
  let dirs: string[] = [DEFAULT_PACK_DIR];
  let configPath = DEFAULT_CONFIG_PATH;
  let remote = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const takeValue = (): string => {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new Error(`content author: ${arg} needs a value`);
      }
      i += 1;
      return value;
    };
    switch (arg) {
      case '--help':
      case '-h':
        return 'help';
      case '--pack':
        pack = takeValue();
        break;
      case '--kind':
        kind = takeValue();
        break;
      case '--count': {
        const value = Number(takeValue());
        if (!Number.isInteger(value) || value < 1) {
          throw new Error('content author: --count must be a positive integer');
        }
        count = value;
        break;
      }
      case '--brief':
        brief = takeValue();
        break;
      case '--dirs':
        dirs = splitList(takeValue());
        break;
      case '--config':
        configPath = takeValue();
        break;
      case '--remote':
        remote = true;
        break;
      default:
        throw new Error(`content author: unknown option "${arg}"`);
    }
  }

  if (pack === undefined) {
    throw new Error('content author: --pack is required');
  }
  if (kind === undefined) {
    throw new Error('content author: --kind is required');
  }
  return { pack, kind, count, brief, dirs, configPath, remote };
}

/** Read and validate `config/authoring.yaml` from disk. */
function readConfig(path: string): AuthoringConfig {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`content author: cannot read authoring config "${path}"`);
  }
  return parseAuthoringConfig(parseYaml(text));
}

/**
 * The production OpenAI-compatible client, built against the config endpoint.
 * The `openai` client is loaded lazily so a unit test (which injects its own
 * {@link AuthorClient}) never pulls it in, and the Authoring Aid stays off the
 * game Gateway's role-routed surface (it uses no Model Role).
 */
function createOpenAiAuthorClient(config: AuthoringConfig): AuthorClient {
  return {
    async complete(
      messages: readonly AuthorMessage[],
      options: AuthorCallOptions,
    ): Promise<string> {
      const { default: OpenAI } = await import('openai');
      const client = new OpenAI({ baseURL: config.endpoint, apiKey: 'lm-studio' });
      const completion = await client.chat.completions.create({
        model: options.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'content_items', schema: options.jsonSchema, strict: true },
        },
      });
      return completion.choices[0]?.message?.content ?? '';
    },
  };
}

/** The real draft sink: write to disk, creating parent directories. */
const diskDraftSink: DraftSink = {
  write(path: string, contents: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents, 'utf8');
  },
};

/**
 * The `author` subcommand. Reads the config and the context packs, draws a
 * draft through the local LLM and writes it (with provenance) to the Draft
 * Area, plus a `.rejected.json` sidecar for any invalid output. Returns 0 on a
 * completed run; a refused endpoint or a non-JSON response throws for the CLI
 * shell to report.
 */
export async function runAuthor(options: AuthorCliOptions): Promise<number> {
  const parsed = parseAuthorArgs(options.argv);
  if (parsed === 'help') {
    process.stdout.write(`${AUTHOR_USAGE}\n`);
    return 0;
  }

  const config = readConfig(parsed.configPath);
  const packs = readParsedPacks(parsed.dirs);
  const registry = effectiveRegistry();
  const request: AuthorRequest = {
    pack: parsed.pack,
    kind: parsed.kind,
    count: parsed.count,
    ...(parsed.brief === undefined ? {} : { brief: parsed.brief }),
  };

  const result = await runAuthorCore({
    config,
    remoteFlag: parsed.remote,
    packs,
    registry,
    request,
    client: createOpenAiAuthorClient(config),
    sink: diskDraftSink,
  });

  if (result.draftPath !== undefined) {
    process.stdout.write(
      `wrote ${result.accepted} item(s) to ${result.draftPath}\n`,
    );
  }
  if (result.rejectedPath !== undefined) {
    process.stdout.write(
      `wrote ${result.rejected} rejected item(s) to ${result.rejectedPath}\n`,
    );
  }
  if (result.draftPath === undefined && result.rejectedPath === undefined) {
    process.stdout.write('the model returned no items\n');
  }
  return 0;
}

// --- promote ---------------------------------------------------------------

const PROMOTE_USAGE = `Usage: pnpm content promote <draft-file> --into <pack-file> --reviewer <name> [options]

Options:
  <draft-file>              the draft to promote (positional, required)
  --into <pack-file>        the real pack file to merge the draft into (required)
  --reviewer <name>         the reviewer's name, stamped into provenance (required)
  --dirs path[,path]        pack directories to lint with the draft merged (default: ${DEFAULT_PACK_DIR})
  --profile draft|release   the lint profile to gate on (default: draft)
  --help                    show this help`;

/** The `promote` subcommand's parsed flags. */
interface PromoteArgs {
  readonly draftFile: string;
  readonly targetFile: string;
  readonly reviewer: string;
  readonly dirs: readonly string[];
  readonly profile: LintOptions['profile'];
}

/** Parse the `promote` argv, or `'help'`. Throws on a bad or missing option. */
function parsePromoteArgs(argv: readonly string[]): PromoteArgs | 'help' {
  let draftFile: string | undefined;
  let targetFile: string | undefined;
  let reviewer: string | undefined;
  let dirs: string[] = [DEFAULT_PACK_DIR];
  let profile: LintOptions['profile'] = 'draft';

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const takeValue = (): string => {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new Error(`content promote: ${arg} needs a value`);
      }
      i += 1;
      return value;
    };
    switch (arg) {
      case '--help':
      case '-h':
        return 'help';
      case '--into':
        targetFile = takeValue();
        break;
      case '--reviewer':
        reviewer = takeValue();
        break;
      case '--dirs':
        dirs = splitList(takeValue());
        break;
      case '--profile': {
        const value = takeValue();
        if (value !== 'draft' && value !== 'release') {
          throw new Error(`content promote: --profile must be "draft" or "release", got "${value}"`);
        }
        profile = value;
        break;
      }
      default:
        if (arg.startsWith('--')) {
          throw new Error(`content promote: unknown option "${arg}"`);
        }
        if (draftFile !== undefined) {
          throw new Error(`content promote: unexpected extra argument "${arg}"`);
        }
        draftFile = arg;
        break;
    }
  }

  if (draftFile === undefined) {
    throw new Error('content promote: a draft file is required');
  }
  if (targetFile === undefined) {
    throw new Error('content promote: --into is required');
  }
  if (reviewer === undefined) {
    throw new Error('content promote: --reviewer is required');
  }
  return { draftFile, targetFile, reviewer, dirs, profile };
}

/**
 * Build the production {@link PromoteFs}. `lintWithMerged` copies every pack
 * directory into a fresh temp root, overwrites the target file with the merged
 * contents there, and lints that copy — so the real tree is untouched while the
 * promote decision is made (Req 16.5). The target file must lie under one of
 * the given `--dirs` so it maps into the temp copy.
 */
function diskPromoteFs(dirs: readonly string[]): PromoteFs {
  return {
    readFile: (path: string) => readFileSync(path, 'utf8'),
    writeFile: (path: string, contents: string) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, contents, 'utf8');
    },
    deleteFile: (path: string) => rmSync(path, { force: true }),
    lintWithMerged(targetFile: string, mergedContents: string, opts: LintOptions) {
      const root = mkdtempSync(join(tmpdir(), 'tc-promote-'));
      try {
        const tempDirs: string[] = [];
        for (const dir of dirs) {
          const base = dir.split(sep).filter((s) => s.length > 0).at(-1) ?? 'pack';
          const dest = join(root, base);
          cpSync(dir, dest, { recursive: true });
          tempDirs.push(dest);

          // Mirror the merged target file into this copy if it belongs to it.
          const rel = relative(dir, targetFile);
          if (!rel.startsWith('..') && !rel.startsWith(sep) && rel !== '') {
            const mergedPath = join(dest, rel);
            mkdirSync(dirname(mergedPath), { recursive: true });
            writeFileSync(mergedPath, mergedContents, 'utf8');
          }
        }
        return lint(tempDirs, [], opts);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  };
}

/**
 * The `promote` subcommand. Lints the pack set with the draft merged into the
 * target file and, only if there are no errors, writes the merged file (stamped
 * with the reviewer and review time) and deletes the draft (Req 16.5). On any
 * error finding it changes nothing and prints the findings, returning a
 * non-zero exit code (Req 16.8).
 */
export function runPromote(options: AuthorCliOptions): number {
  const parsed = parsePromoteArgs(options.argv);
  if (parsed === 'help') {
    process.stdout.write(`${PROMOTE_USAGE}\n`);
    return 0;
  }

  const result = runPromoteCore(
    {
      draftFile: parsed.draftFile,
      targetFile: parsed.targetFile,
      reviewer: parsed.reviewer,
      profile: parsed.profile,
    },
    diskPromoteFs(parsed.dirs),
  );

  if (result.promoted) {
    process.stdout.write(
      `promoted ${result.count} item(s) into ${result.targetFile}\n`,
    );
    return 0;
  }

  process.stderr.write(
    'promotion refused: the pack set does not lint clean with the draft merged\n',
  );
  for (const f of result.report.findings) {
    if (f.severity !== 'error') {
      continue;
    }
    const location = f.path === '' ? `${f.pack}/${f.file}` : `${f.pack}/${f.file}:${f.path}`;
    process.stderr.write(`  ${f.rule} ${location} ${f.message}\n`);
  }
  return 1;
}

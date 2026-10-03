/**
 * The `pnpm content` command dispatcher (`content-tools/cli`).
 *
 * This is the single entry point behind the root `pnpm content` script, which
 * runs it through `tsx` (the same pattern as `pnpm play`/`pnpm world`). It
 * reads the first positional argument as the subcommand and hands the rest of
 * argv to the matching tool:
 *
 *   pnpm content lint     [options]   — the Pack Linter      (tasks 5.2–5.4)
 *   pnpm content preview  [options]   — the Preview CLI      (task 5.9)
 *   pnpm content coverage [options]   — the Coverage Report  (task 5.11)
 *   pnpm content author   [options]   — the Authoring Aid    (task 5.13)
 *   pnpm content promote  [options]   — draft promotion      (task 5.13)
 *
 * This task (5.1) wires the package, the CLI shell and the `pnpm content`
 * script. The subcommands are stubs that later tasks flesh out, so dispatching
 * to one that is not implemented yet exits non-zero with a clear message rather
 * than doing nothing.
 */

import { runCoverage } from './coverage/index.js';
import { runLint } from './lint/index.js';
import { runAuthor, runPromote } from './author/index.js';
import { runPreview } from './preview/index.js';

/** The subcommands the CLI dispatches to. */
export const CONTENT_COMMANDS = [
  'lint',
  'preview',
  'coverage',
  'author',
  'promote',
] as const;

/** A single `pnpm content` subcommand name. */
export type ContentCommand = (typeof CONTENT_COMMANDS)[number];

export const USAGE = `Usage: pnpm content <command> [options]

Commands:
  lint       lint content packs (--packs, --profile draft|release, --baseline, --json)
  preview    render a preview for a city/seed/preset/kind (--reveal, --count, --out)
  coverage   write a coverage report for the content set (--seeds, --out)
  author     draft new content with the offline Authoring Aid
  promote    promote a reviewed draft into its pack

Run "pnpm content <command> --help" for command-specific options.`;

/** A command's effect on the process: an exit code. */
export interface CliResult {
  readonly exitCode: number;
}

/**
 * Dispatch a parsed argv to its subcommand. Returns the exit code so the thin
 * IO wrapper ({@link main}) owns `process.exit` and this stays testable.
 *
 * The result is awaited: most subcommands are synchronous, but `author` makes a
 * model call and so returns a promise ({@link runAuthor}). Awaiting a plain
 * value is a no-op, so the sync subcommands behave exactly as before.
 */
export async function runCli(argv: readonly string[]): Promise<CliResult> {
  const [command, ...rest] = argv;

  if (command === undefined || command === '--help' || command === '-h') {
    process.stdout.write(`${USAGE}\n`);
    return { exitCode: command === undefined ? 1 : 0 };
  }

  if (!(CONTENT_COMMANDS as readonly string[]).includes(command)) {
    process.stderr.write(`error: unknown command "${command}"\n\n${USAGE}\n`);
    return { exitCode: 1 };
  }

  const options = { argv: rest };

  try {
    switch (command as ContentCommand) {
      case 'lint':
        // The linter sets its own exit code: non-zero when any finding has
        // error severity (Req 13.4), zero otherwise.
        return { exitCode: runLint(options) };
      case 'preview':
        runPreview(options);
        break;
      case 'coverage':
        runCoverage(options);
        break;
      case 'author':
        // The Authoring Aid makes a model call, so its CLI entry is async and
        // returns the exit code once the draft is written (0) — a refused
        // endpoint or a non-JSON response throws and is reported below.
        return { exitCode: await runAuthor(options) };
      case 'promote':
        // Promotion is synchronous (the merged-set lint is sync). It returns 0
        // when the draft was promoted and non-zero when the merged set did not
        // lint clean (Req 16.8).
        return { exitCode: runPromote(options) };
    }
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return { exitCode: 1 };
  }

  return { exitCode: 0 };
}

/** The IO shell: read argv, run the CLI and set the exit code. */
export async function main(): Promise<void> {
  const { exitCode } = await runCli(process.argv.slice(2));
  process.exitCode = exitCode;
}

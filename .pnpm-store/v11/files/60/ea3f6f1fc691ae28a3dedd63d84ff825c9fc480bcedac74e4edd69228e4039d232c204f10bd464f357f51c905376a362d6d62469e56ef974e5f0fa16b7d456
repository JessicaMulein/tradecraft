import type { NxMigrateConfiguration } from '../../config/nx-json';
import { type MigrateArgs } from './command-object';
/**
 * Overlays `nx.json` `migrate` defaults onto the raw CLI args: a CLI flag wins,
 * then `nx.json`, then the built-in default. Returns a new args object; the
 * input is not mutated.
 *
 * Phase-aware so each option is only filled where it is consumed, and so a
 * config value never trips the mutually-exclusive-flag guards in
 * `parseMigrationsOptions`: `include` and `multiMajorMode` in the generate
 * phase only; `createCommits` / `commitPrefix` and `agentic` / `validate` when
 * running the whole migrations file or a standalone single migration. A
 * `--run-id` invocation takes none of them: a recorded run takes its commit
 * config from run.json and is driven by the outer agent.
 *
 * `include` is carried as `includeFromConfig` so it is never mistaken for an
 * explicit `--include`: `resolveInclude` applies it only when the resolved
 * target supports optional updates.
 */
export declare function applyNxJsonMigrateDefaults(args: MigrateArgs, migrateConfig: NxMigrateConfiguration | undefined, env?: NodeJS.ProcessEnv): MigrateArgs;
/**
 * The single authority for the "a custom commit prefix needs commits enabled"
 * invariant. Run it against the final merged args (after
 * `applyNxJsonMigrateDefaults`): the yargs `.check()` only sees the CLI args,
 * but nx.json may enable commits via `createCommits` or `agentic`. The CLI
 * `.check()` only fast-fails the unrescuable explicit `--no-create-commits`
 * case; everything else is decided here.
 */
export declare function assertCommitPrefixHasCommits(merged: MigrateArgs): void;

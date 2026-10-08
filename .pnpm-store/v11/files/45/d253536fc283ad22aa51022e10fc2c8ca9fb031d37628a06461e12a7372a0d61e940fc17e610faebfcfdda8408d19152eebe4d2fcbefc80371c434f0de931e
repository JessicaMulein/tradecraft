import { CommandModule } from 'yargs';
import type { AgenticArg } from './agentic/select';
import { type StepAction } from './step-actions';
export declare const yargsMigrateCommand: CommandModule;
export declare const yargsInternalMigrateCommand: CommandModule;
export declare const DEFAULT_MIGRATION_COMMIT_PREFIX = "chore: [nx migration] ";
/** Allowed values for `--include` / `migrate.include`. */
export declare const MIGRATE_INCLUDE_VALUES: readonly ['required', 'optional', 'all'];
export type MigrateInclude = (typeof MIGRATE_INCLUDE_VALUES)[number];
/** Allowed values for `--multi-major-mode` / `migrate.multiMajorMode`. */
export declare const MULTI_MAJOR_MODES: readonly ['direct', 'gradual'];
export type MultiMajorMode = (typeof MULTI_MAJOR_MODES)[number];
/**
 * The `nx migrate` args bag. Types the keys the nx.json overlay and the
 * commit-prefix invariant read/write; the index signature keeps the rest of
 * the yargs args flowing through untouched.
 */
export interface MigrateArgs {
    packageAndVersion?: string;
    runMigrations?: string;
    runMigration?: string;
    runId?: string;
    stepAction?: StepAction;
    include?: MigrateInclude;
    /**
     * nx.json `migrate.include` default. Consumed by `resolveInclude` only when the
     * resolved target supports optional updates; kept separate from `include` so it is never
     * mistaken for an explicit `--include` (which hard-fails when the target does
     * not support optional updates).
     */
    includeFromConfig?: MigrateInclude;
    multiMajorMode?: MultiMajorMode;
    createCommits?: boolean;
    commitPrefix?: string;
    agentic?: AgenticArg;
    validate?: boolean;
    ifExists?: boolean;
    interactive?: boolean;
    [key: string]: any;
}
/**
 * Whether a custom commit prefix would be silently ignored: commits aren't
 * enabled and the agentic flow can't enable them either. Shared by the yargs
 * `.check()` (CLI args) and the nx.json overlay (merged args) so the rule lives
 * in one place. `agentic` may flip commits on by default, so a configured
 * agentic value (other than `false`, and not paired with `--no-create-commits`)
 * keeps the prefix in play.
 */
export declare function customCommitPrefixHasNoEffect(args: {
    createCommits: boolean | undefined;
    commitPrefix: string | undefined;
    agentic: unknown;
}): boolean;

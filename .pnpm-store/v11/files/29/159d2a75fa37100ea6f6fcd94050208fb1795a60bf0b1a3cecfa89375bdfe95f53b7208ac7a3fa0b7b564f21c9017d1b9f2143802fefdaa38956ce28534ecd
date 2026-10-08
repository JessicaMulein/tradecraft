import type { MigrateInclude } from './command-object';
export type MigrateIncludeSource = 'flag' | 'nx-json' | 'prompt' | 'default';
export type MigrateMultiMajorChoice = 'gradual' | 'direct';
export type MigrateFetchFallbackReason = 'env-skip' | 'unsupported-registry' | 'provenance' | 'registry-error';
export type MigrateFetchStats = {
    registryCount: number;
    installCount: number;
    fallbackReason?: MigrateFetchFallbackReason;
};
export type MigrateAgenticOutcome = 'enabled' | 'disabled' | 'inside-agent';
export type MigratePromptChoices = {
    include: MigrateInclude;
    multi_major: 'direct' | 'latest-in-current' | 'latest-in-next';
    agentic: 'yes-once' | 'yes-flex' | 'yes-pin' | 'no-once' | 'no-never';
    agent_select: string;
    ambiguous_agent_outcome: 'abort' | 'continue';
};
export type MigratePromptName = keyof MigratePromptChoices;
export type MigrateGenerateErrorCode = 'resolve_version' | 'fetch_migrations' | 'package_updates';
export type MigrateRunErrorCode = 'npm_install' | 'migration_exec' | 'agentic' | 'other';
export declare function setMigrateInclude(include: MigrateInclude): void;
export declare function setMigrateIncludeSource(source: MigrateIncludeSource): void;
export declare function classifyMigrateFetchFallback(error: unknown): MigrateFetchFallbackReason;
/**
 * Records an interactive migrate prompt and the user's selection.
 *
 * The prompt identity is encoded in the event name (`migrate_prompt_<prompt>`)
 * so it doesn't cost a GA custom dimension; `choice` is one dimension
 * multiplexed across all prompts, read conditioned on the event name. The
 * per-prompt value-spaces are typed in {@link MigratePromptChoices}.
 */
export declare function reportMigratePrompt<P extends MigratePromptName>(prompt: P, choice: MigratePromptChoices[P]): void;
export declare function reportMigrateGenerateStart(opts: {
    targetPackage: string;
    interactive?: boolean;
    excludeAppliedMigrations?: boolean;
}): void;
export declare function reportMigrateGenerateComplete(opts: {
    targetVersion: string;
    requestedTargetVersion: string;
    installedTargetVersion: string | null | undefined;
    include: MigrateInclude;
    multiMajorChoice?: MigrateMultiMajorChoice;
    fetchStats?: MigrateFetchStats;
}): void;
export declare function reportMigrateGenerateError(code: MigrateGenerateErrorCode, error: unknown): void;
export declare function reportMigrateRunStart(opts: {
    createCommits: boolean;
    migrationCount: number;
}): void;
/**
 * Whether the current process recorded a `migrate_run_start` event. Lets
 * shared code paths (e.g. `executeMigrations`, reused by `nx repair`) skip
 * migrate events when not running inside a migrate run.
 */
export declare function hasMigrateRunStarted(): boolean;
export declare function reportMigrateRunComplete(opts: {
    agenticOutcome: MigrateAgenticOutcome;
    agentUsed?: string;
    migrationCount: number;
    appliedCount: number;
}): void;
export declare function reportMigrateRunError(opts: {
    code: MigrateRunErrorCode;
    migrationPackage?: string;
    migrationName?: string;
    migrationCount?: number;
    error?: unknown;
}): void;
export declare function reportMigrateOrchestratorInit(opts: {
    migrationCount: number;
    createCommits: boolean;
}): void;
/**
 * One event per orchestrator dispense. The `action` (dispense case) is a
 * closed enum carried on a reused dimension, read conditioned on the event
 * name (the same multiplexing pattern as {@link reportMigratePrompt});
 * `attempt` rides the migration-count dimension.
 */
export declare function reportMigrateOrchestratorDispense(opts: {
    action: string;
    attempt: number;
}): void;
/**
 * Terminal funnel event. The two step tallies and the total dispense count
 * ride reused numeric dimensions, read conditioned on the event name.
 */
export declare function reportMigrateOrchestratorComplete(opts: {
    completed: number;
    skipped: number;
    dispenseCount: number;
}): void;
/**
 * Counts invocations, not completions: emitted as soon as the migration id
 * resolves, while the worker can still stop before running anything.
 *
 * An invocation recorded into an orchestrated run (`--run-id`) gets its own
 * event name. Every other one keeps the name `--run-migration` shipped with,
 * so that series stays continuous for users who never enable the orchestrator.
 */
export declare function reportMigrateSingleMigrationInvocation(opts: {
    migrationType: 'generator' | 'prompt' | 'hybrid';
    orchestrated: boolean;
}): void;
export declare function computeMajorsCrossed(installed: string | null | undefined, target: string | null | undefined): number | undefined;
export declare function safeReport(emit: () => void): void;

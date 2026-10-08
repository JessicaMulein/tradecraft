import { MigrationsJson, PackageJsonUpdateForPackage as PackageUpdate } from '../../config/misc-interfaces';
import { NxJsonConfiguration } from '../../config/nx-json';
import { ArrayPackageGroup, PackageJson } from '../../utils/package-json';
import { PackageManagerCommands } from '../../utils/package-manager';
import { type MigrateFetchStats, type MigrateMultiMajorChoice } from './migrate-analytics';
import { type MultiMajorMode } from './multi-major';
import type { AgenticArg } from './agentic/select';
import { MigrateArgs } from './command-object';
import type { ResolvedAgentic } from './agentic/types';
import { isHybridMigration, isPromptOnlyMigration, type PlannedMigration } from './migration-shape';
import { filterDowngradedUpdates } from './update-filters';
import { normalizeVersion } from './version-utils';
import { type StepAction } from './step-actions';
export * from './execute-migration';
export { normalizeVersion };
export interface ResolvedMigrationConfiguration extends MigrationsJson {
    packageGroup?: ArrayPackageGroup;
    /** Mirrors the package's `nx-migrations`/`ng-update` `supportsOptionalMigrations` flag. */
    supportsOptionalMigrations?: boolean;
    /** Prompt file contents keyed by the `prompt` value as it appears on the migration entry. */
    resolvedPromptFiles?: Record<string, string>;
}
type CommandFailure = {
    message?: string;
    stderr?: string | Buffer;
    stdout?: string | Buffer;
};
export declare function formatCommandFailure(command: string, error: CommandFailure): string;
export type MigrateInclude = 'required' | 'optional' | 'all';
export interface MigratorOptions {
    packageJson?: PackageJson;
    nxInstallation?: NxJsonConfiguration['installation'];
    getInstalledPackageVersion: (pkg: string, overrides?: Record<string, string>) => string;
    fetch: ((pkg: string, version: string) => Promise<ResolvedMigrationConfiguration>) & {
        stats?: MigrateFetchStats;
    };
    from: {
        [pkg: string]: string;
    };
    to: {
        [pkg: string]: string;
    };
    interactive?: boolean;
    excludeAppliedMigrations?: boolean;
    /**
     * Restricts `packageJsonUpdates` filtering based on the value:
     * - 'required' keeps only packages in `requiredPackages`
     * - 'optional' keeps only packages NOT in `requiredPackages`
     * - 'all' / undefined keeps all packages (no filtering)
     */
    include?: MigrateInclude;
    /** Packages in the `required` partition; `include` filters against this set. */
    requiredPackages?: ReadonlySet<string>;
}
export declare class Migrator {
    private readonly packageJson?;
    private readonly getInstalledPackageVersion;
    private readonly fetch;
    private readonly installedPkgVersionOverrides;
    private readonly to;
    private readonly interactive;
    private readonly excludeAppliedMigrations;
    private readonly include;
    private readonly requiredPackages;
    private readonly packageUpdates;
    private readonly collectedVersions;
    private readonly promptAnswers;
    private readonly pendingPackageJsonUpdates;
    private readonly appliedPackageJsonUpdates;
    private readonly nxInstallation;
    private minVersionWithSkippedUpdates;
    constructor(opts: MigratorOptions);
    private fetchMigrationConfig;
    migrate(targetPackage: string, targetVersion: string): Promise<{
        packageUpdates: Record<string, PackageUpdate>;
        migrations: {
            version: string;
            description?: string;
            implementation?: string;
            factory?: string;
            prompt?: string;
            requires?: Record<string, string>;
            documentation?: string;
            package: string;
            name: string;
        }[];
        promptContents?: Record<string, string>;
        minVersionWithSkippedUpdates: string;
    }>;
    private createMigrateJson;
    private buildPackageJsonUpdates;
    private applyPackageJsonUpdate;
    private applyPendingPackageJsonUpdates;
    private resolveVersionForCascade;
    private populatePackageJsonUpdatesAndGetPackagesToCheck;
    private getPackageJsonUpdatesFromMigrationConfig;
    /**
     * Mutates migrationConfig, adding package group updates into packageJsonUpdates section
     *
     * @param packageName Package which is being migrated
     * @param targetVersion Version which is being migrated to
     * @param migrationConfig Configuration which is mutated to contain package json updates
     * @returns Order of package groups
     */
    private getPackageJsonUpdatesFromPackageGroup;
    private filterPackageJsonUpdates;
    private shouldExcludePackage;
    private applyIncludeFilter;
    private shouldApplyPackageUpdate;
    private validatePackageUpdateVersion;
    private addPackageUpdate;
    private areRequirementsMet;
    private areIncompatiblePackagesPresent;
    private areMigrationRequirementsMet;
    private isMigrationForHigherVersionThanWhatIsInstalled;
    private wasMigrationSkipped;
    private runPackageJsonUpdatesConfirmationPrompt;
    private getPackageUpdatePromptKey;
    private getPkgVersion;
    private gt;
    private lt;
    private lte;
}
/**
 * The canonical Nx package for a given target version: `@nrwl/workspace` for
 * legacy (`< 14.0.0-beta.0`), `nx` otherwise. Non-semver inputs (e.g. the
 * literal `'latest'` sentinel before tag resolution) resolve to modern era.
 */
export declare function resolveCanonicalNxPackage(targetVersion: string): 'nx' | '@nrwl/workspace';
export declare function resolveInclude(include: MigrateInclude | undefined, context: {
    hasFrom: boolean;
    hasExcludeAppliedMigrations: boolean;
    interactive?: boolean;
    targetSupportsOptionalUpdates: boolean;
}, configuredInclude?: MigrateInclude): Promise<MigrateInclude>;
type GenerateMigrations = {
    type: 'generateMigrations';
    targetPackage: string;
    targetVersion: string;
    from: {
        [k: string]: string;
    };
    to: {
        [k: string]: string;
    };
    interactive?: boolean;
    excludeAppliedMigrations?: boolean;
    include: MigrateInclude;
    /**
     * Set when multi-major redirected `targetVersion` to an incremental step
     * (gradual mode or the interactive prompt picking a smaller jump). Holds
     * the concrete resolved target so Next Steps can suggest re-running toward
     * it.
     */
    originalTargetVersion?: string;
    /**
     * The `--multi-major-mode` value to propagate to a continuation command,
     * or undefined to omit it. See `MultiMajorResult.gradual` for when it's set.
     */
    multiMajorMode?: MultiMajorMode;
    /**
     * Collapsed multi-major outcome for the generate completion analytics
     * event. See `MultiMajorResult.decision` for when it's set.
     */
    multiMajorChoice?: MigrateMultiMajorChoice;
};
type RunMigrations = {
    type: 'runMigrations';
    runMigrations: string;
    ifExists: boolean;
    agentic: AgenticArg;
    validate?: boolean;
    interactive?: boolean;
};
type RunSingleMigration = {
    type: 'runSingleMigration';
    runMigration: string;
    runId?: string;
    agentic: AgenticArg;
    validate?: boolean;
    interactive?: boolean;
};
type OrchestratorReconcile = {
    type: 'orchestratorReconcile';
    runId: string;
    stepAction?: StepAction;
};
export declare function parseMigrationsOptions(options: MigrateArgs, fetch?: MigratorOptions['fetch']): Promise<GenerateMigrations | RunMigrations | RunSingleMigration | OrchestratorReconcile>;
export declare function createFetcher(pmc: PackageManagerCommands): ((pkg: string, version: string) => Promise<ResolvedMigrationConfiguration>) & {
    stats?: MigrateFetchStats;
};
export { filterDowngradedUpdates };
export declare function generateMigrationsJsonAndUpdatePackageJson(root: string, opts: GenerateMigrations, fetch?: MigratorOptions['fetch']): Promise<void>;
export { isPromptOnlyMigration, isHybridMigration };
export declare function formatSkippedPromptsNextStep(skipped: PlannedMigration[]): string;
export declare function executeMigrations(root: string, migrations: PlannedMigration[], isVerbose: boolean, shouldCreateCommits: boolean, commitPrefix: string, shouldSkipInstall?: boolean, agentic?: ResolvedAgentic, agenticHasDiffContext?: boolean, shouldRunValidation?: boolean): Promise<{
    migrationsWithNoChanges: PlannedMigration[];
    skippedPromptsCount: number;
    notRunMigrationsCount: number;
    nextSteps: string[];
    skippedPrompts: PlannedMigration[];
    migrationEmittedNextSteps: string[];
    committedShasCount: number;
    waivedAgenticStepsCount: number;
    retainedAtSuccess: string[];
}>;
export declare function isRunPhaseInvocation(args: Pick<MigrateArgs, 'runMigration' | 'runId' | 'stepAction'>): boolean;
export declare function migrate(root: string, args: {
    [k: string]: any;
}, rawArgs: string[]): Promise<number>;
export declare function readLocalNxVersion(root: string): string | undefined;
export declare function runMigration(): Promise<number>;
/**
 * Resolves a migration's collection once and derives everything the run loop
 * needs from that single read: the implementation context (`collection` +
 * `collectionPath`, handed to `runNxOrAngularMigration`) and, for agentic runs,
 * the workspace-relative documentation path handed to the agent.
 *
 * Read fresh per migration (not cached across the loop) so a prior migration's
 * reinstall is reflected, exactly as before. Error handling matches each field's
 * role:
 * - Migrations that run an implementation REQUIRE the collection; an unreadable
 *   collection throws and aborts that migration (caught by the run loop).
 * - Prompt-only migrations don't run an implementation, so the collection is
 *   read only to resolve documentation - a failure there is non-fatal: the
 *   prompt still runs and the supplementary doc is skipped with a warning.
 */
export declare function resolveMigrationForRun(root: string, migration: {
    package: string;
    name: string;
    documentation?: string;
    implementation?: string;
    factory?: string;
    prompt?: string;
}, resolveDocumentation: boolean): {
    resolvedCollection?: {
        collection: MigrationsJson;
        collectionPath: string;
    };
    documentationPath?: string;
};
export declare function nxCliPath(nxWorkspaceRoot?: string): Promise<string>;

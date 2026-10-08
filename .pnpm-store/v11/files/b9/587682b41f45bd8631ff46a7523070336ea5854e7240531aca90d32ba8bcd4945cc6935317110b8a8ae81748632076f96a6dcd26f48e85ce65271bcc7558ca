"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setMigrateInclude = setMigrateInclude;
exports.setMigrateIncludeSource = setMigrateIncludeSource;
exports.classifyMigrateFetchFallback = classifyMigrateFetchFallback;
exports.reportMigratePrompt = reportMigratePrompt;
exports.reportMigrateGenerateStart = reportMigrateGenerateStart;
exports.reportMigrateGenerateComplete = reportMigrateGenerateComplete;
exports.reportMigrateGenerateError = reportMigrateGenerateError;
exports.reportMigrateRunStart = reportMigrateRunStart;
exports.hasMigrateRunStarted = hasMigrateRunStarted;
exports.reportMigrateRunComplete = reportMigrateRunComplete;
exports.reportMigrateRunError = reportMigrateRunError;
exports.reportMigrateOrchestratorInit = reportMigrateOrchestratorInit;
exports.reportMigrateOrchestratorDispense = reportMigrateOrchestratorDispense;
exports.reportMigrateOrchestratorComplete = reportMigrateOrchestratorComplete;
exports.reportMigrateSingleMigrationInvocation = reportMigrateSingleMigrationInvocation;
exports.computeMajorsCrossed = computeMajorsCrossed;
exports.safeReport = safeReport;
const semver_1 = require("semver");
const analytics_1 = require("../../analytics");
const provenance_1 = require("../../utils/provenance");
const workspace_root_1 = require("../../utils/workspace-root");
// Identifier-shaped tokens only (Node codes like ENOENT, class names like
// TypeError). Rejects anything with a slash, space, or punctuation so a
// settable `.code`/`.name` can't smuggle a path or message into GA.
const IDENTIFIER_SHAPE = /^[A-Za-z][A-Za-z0-9_]*$/;
// Context collected across the flow and folded into the completion/error
// events. `_migrate` executes a single migrate invocation per process, so
// module state is safe.
let resolvedInclude;
let includeSource;
let generateErrorRecorded = false;
let runErrorRecorded = false;
let runStarted = false;
function setMigrateInclude(include) {
    resolvedInclude = include;
}
function setMigrateIncludeSource(source) {
    includeSource = source;
}
function classifyMigrateFetchFallback(error) {
    if (error instanceof provenance_1.ProvenanceError) {
        return 'provenance';
    }
    if (error instanceof Error &&
        error.message.includes('is not supported from')) {
        return 'unsupported-registry';
    }
    return 'registry-error';
}
/**
 * Records an interactive migrate prompt and the user's selection.
 *
 * The prompt identity is encoded in the event name (`migrate_prompt_<prompt>`)
 * so it doesn't cost a GA custom dimension; `choice` is one dimension
 * multiplexed across all prompts, read conditioned on the event name. The
 * per-prompt value-spaces are typed in {@link MigratePromptChoices}.
 */
function reportMigratePrompt(prompt, choice) {
    safeReport(() => {
        if (!analytics_1.customDimensions)
            return;
        (0, analytics_1.reportEvent)(`migrate_prompt_${prompt}`, {
            [analytics_1.customDimensions.promptChoice]: choice,
        });
    });
}
function reportMigrateGenerateStart(opts) {
    safeReport(() => {
        if (!analytics_1.customDimensions)
            return;
        (0, analytics_1.reportEvent)('migrate_generate_start', {
            // Resolved migration target (defaults to `nx`; only an explicit
            // non-first-party target is third-party). Reported raw per the `nx add`
            // precedent - it's the chosen target, not a transitive dep like
            // `run_error`'s `migration_name`, so there's no dependency-graph leak.
            [analytics_1.customDimensions.packageName]: opts.targetPackage,
            [analytics_1.customDimensions.cliSource]: cliSource(),
            [analytics_1.customDimensions.interactive]: opts.interactive,
            [analytics_1.customDimensions.excludeAppliedMigrations]: opts.excludeAppliedMigrations,
        });
    });
}
function reportMigrateGenerateComplete(opts) {
    safeReport(() => {
        if (!analytics_1.customDimensions)
            return;
        const majorsCrossed = computeMajorsCrossed(opts.installedTargetVersion, opts.requestedTargetVersion);
        const { registryCount = 0, installCount = 0 } = opts.fetchStats ?? {};
        const fetchMethod = registryCount > 0 && installCount > 0
            ? 'mixed'
            : installCount > 0
                ? 'install'
                : registryCount > 0
                    ? 'registry'
                    : undefined;
        (0, analytics_1.reportEvent)('migrate_generate_complete', {
            [analytics_1.customDimensions.packageVersion]: opts.targetVersion,
            [analytics_1.customDimensions.include]: opts.include,
            [analytics_1.customDimensions.includeSource]: includeSource,
            [analytics_1.customDimensions.majorsCrossed]: majorsCrossed,
            // Only meaningful when the multi-major gate (2+ majors) applied.
            ...(majorsCrossed !== undefined &&
                majorsCrossed >= 2 &&
                opts.multiMajorChoice
                ? { [analytics_1.customDimensions.multiMajorChoice]: opts.multiMajorChoice }
                : {}),
            [analytics_1.customDimensions.fetchMethod]: fetchMethod,
            [analytics_1.customDimensions.fetchFallbackReason]: opts.fetchStats?.fallbackReason,
        });
    });
}
function reportMigrateGenerateError(code, error) {
    safeReport(() => {
        if (!analytics_1.customDimensions || generateErrorRecorded)
            return;
        generateErrorRecorded = true;
        // The failing phase is encoded in the event name so it doesn't cost a GA
        // custom dimension.
        (0, analytics_1.reportEvent)(`migrate_generate_error_${code}`, {
            // Populated only when include resolution had already happened when the
            // failure occurred; earlier failures leave these undefined.
            [analytics_1.customDimensions.include]: resolvedInclude,
            [analytics_1.customDimensions.includeSource]: includeSource,
            [analytics_1.customDimensions.errorName]: errorName(error),
            [analytics_1.customDimensions.errorLocation]: errorLocation(error),
        });
    });
}
function reportMigrateRunStart(opts) {
    safeReport(() => {
        if (!analytics_1.customDimensions)
            return;
        runStarted = true;
        // No cli_source here: the run phase always executes from the local
        // installation (the temp-install process re-dispatches before this point).
        (0, analytics_1.reportEvent)('migrate_run_start', {
            [analytics_1.customDimensions.createCommits]: opts.createCommits,
            [analytics_1.customDimensions.migrationCount]: opts.migrationCount,
        });
    });
}
/**
 * Whether the current process recorded a `migrate_run_start` event. Lets
 * shared code paths (e.g. `executeMigrations`, reused by `nx repair`) skip
 * migrate events when not running inside a migrate run.
 */
function hasMigrateRunStarted() {
    return runStarted;
}
function reportMigrateRunComplete(opts) {
    safeReport(() => {
        if (!analytics_1.customDimensions)
            return;
        (0, analytics_1.reportEvent)('migrate_run_complete', {
            [analytics_1.customDimensions.agenticOutcome]: opts.agenticOutcome,
            [analytics_1.customDimensions.agentUsed]: opts.agentUsed,
            [analytics_1.customDimensions.migrationCount]: opts.migrationCount,
            [analytics_1.customDimensions.appliedCount]: opts.appliedCount,
        });
    });
}
function reportMigrateRunError(opts) {
    safeReport(() => {
        if (!analytics_1.customDimensions || runErrorRecorded)
            return;
        runErrorRecorded = true;
        // The failing step is encoded in the event name so it doesn't cost a GA
        // custom dimension.
        (0, analytics_1.reportEvent)(`migrate_run_error_${opts.code}`, {
            // Third-party migration names can reveal private packages; only report
            // first-party ones.
            ...(opts.migrationPackage &&
                opts.migrationName &&
                isFirstPartyMigrationPackage(opts.migrationPackage)
                ? {
                    [analytics_1.customDimensions.migrationName]: `${opts.migrationPackage}:${opts.migrationName}`,
                }
                : {}),
            [analytics_1.customDimensions.migrationCount]: opts.migrationCount,
            [analytics_1.customDimensions.errorName]: opts.error !== undefined ? errorName(opts.error) : undefined,
            [analytics_1.customDimensions.errorLocation]: opts.error !== undefined ? errorLocation(opts.error) : undefined,
        });
    });
}
function reportMigrateOrchestratorInit(opts) {
    safeReport(() => {
        if (!analytics_1.customDimensions)
            return;
        (0, analytics_1.reportEvent)('migrate_orchestrator_init', {
            [analytics_1.customDimensions.createCommits]: opts.createCommits,
            [analytics_1.customDimensions.migrationCount]: opts.migrationCount,
        });
    });
}
/**
 * One event per orchestrator dispense. The `action` (dispense case) is a
 * closed enum carried on a reused dimension, read conditioned on the event
 * name (the same multiplexing pattern as {@link reportMigratePrompt});
 * `attempt` rides the migration-count dimension.
 */
function reportMigrateOrchestratorDispense(opts) {
    safeReport(() => {
        if (!analytics_1.customDimensions)
            return;
        (0, analytics_1.reportEvent)('migrate_orchestrator_dispense', {
            [analytics_1.customDimensions.promptChoice]: opts.action,
            [analytics_1.customDimensions.migrationCount]: opts.attempt,
        });
    });
}
/**
 * Terminal funnel event. The two step tallies and the total dispense count
 * ride reused numeric dimensions, read conditioned on the event name.
 */
function reportMigrateOrchestratorComplete(opts) {
    safeReport(() => {
        if (!analytics_1.customDimensions)
            return;
        (0, analytics_1.reportEvent)('migrate_orchestrator_complete', {
            [analytics_1.customDimensions.appliedCount]: opts.completed,
            [analytics_1.customDimensions.taskCount]: opts.skipped,
            [analytics_1.customDimensions.migrationCount]: opts.dispenseCount,
        });
    });
}
/**
 * Counts invocations, not completions: emitted as soon as the migration id
 * resolves, while the worker can still stop before running anything.
 *
 * An invocation recorded into an orchestrated run (`--run-id`) gets its own
 * event name. Every other one keeps the name `--run-migration` shipped with,
 * so that series stays continuous for users who never enable the orchestrator.
 */
function reportMigrateSingleMigrationInvocation(opts) {
    safeReport(() => {
        if (!analytics_1.customDimensions)
            return;
        (0, analytics_1.reportEvent)(opts.orchestrated
            ? 'migrate_single_migration_recorded'
            : 'migrate_single_migration_invocation', {
            [analytics_1.customDimensions.promptChoice]: opts.migrationType,
        });
    });
}
// `_migrate` runs either from a temp install of the latest CLI or from the
// workspace-local installation; same signal as the run-phase re-dispatch
// check in migrate.ts.
function cliSource() {
    return __dirname.startsWith(workspace_root_1.workspaceRoot) ? 'local' : 'temp-latest';
}
// `coerce` tolerates ranges and partial versions from package.json entries
// (e.g. `^21.0.0`); dist-tags that never resolved coerce to null.
function computeMajorsCrossed(installed, target) {
    const installedVersion = installed ? (0, semver_1.coerce)(installed) : null;
    const targetVersion = target ? (0, semver_1.coerce)(target) : null;
    if (!installedVersion || !targetVersion) {
        return undefined;
    }
    return Math.max(0, targetVersion.major - installedVersion.major);
}
function isFirstPartyMigrationPackage(packageName) {
    return (packageName === 'nx' ||
        packageName.startsWith('@nx/') ||
        packageName.startsWith('@nrwl/'));
}
// Structured error identity instead of the raw message: a Node system `code`
// (ENOENT, ETIMEDOUT), else the constructor name (TypeError, ProvenanceError),
// else the bare type. `.code`/`.name` are settable, so a migration could stuff
// a path or message into them - only accept identifier-shaped tokens and fall
// back to the bare type, so no free text reaches GA.
function errorName(error) {
    const code = error?.code;
    if (typeof code === 'string' && IDENTIFIER_SHAPE.test(code)) {
        return code;
    }
    if (error instanceof Error && IDENTIFIER_SHAPE.test(error.name)) {
        return error.name;
    }
    return typeof error;
}
// Topmost stack frame inside a first-party package (nx, @nx/*, @nrwl/*),
// package-qualified and relative to the package root (e.g.
// `nx/src/command-line/migrate/migrate.js:1830:18`). The absolute prefix and
// `dist/` are stripped so no user path leaks, and non-first-party frames are
// skipped so a failing third-party migration can't surface a private package
// path. Caveats: the topmost first-party frame may be a dispatcher rather than
// the exact throw site, and (no shipped sourcemaps) the line:col is in the
// compiled JS - so this locates against `nx_version`, not the TS source.
function errorLocation(error) {
    if (!(error instanceof Error) || !error.stack)
        return undefined;
    for (const line of error.stack.split('\n')) {
        const match = line
            .replace(/\\/g, '/')
            .match(/\/node_modules\/((?:@(?:nx|nrwl)\/[^/]+|nx))\/(?:dist\/)?(src\/.+?:\d+:\d+)/);
        if (match)
            return `${match[1]}/${match[2]}`;
    }
    return undefined;
}
// Analytics is a secondary concern and must never interfere with the migrate
// run. Swallow any failure while building params or emitting the event
// (surfaced only under verbose logging), mirroring `trackEvent`/`flushAnalytics`
// in `../../analytics`. Exported for callers whose param-building expressions
// evaluate before the report function is entered.
function safeReport(emit) {
    try {
        emit();
    }
    catch (e) {
        if (process.env.NX_VERBOSE_LOGGING === 'true') {
            console.log(`Failed to record migrate analytics event: ${e instanceof Error ? e.message : e}`);
        }
    }
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runSingleMigrationWorker = runSingleMigrationWorker;
const fs_1 = require("fs");
const path_1 = require("path");
const git_utils_1 = require("../../../utils/git-utils");
const fileutils_1 = require("../../../utils/fileutils");
const installation_directory_1 = require("../../../utils/installation-directory");
const package_json_1 = require("../../../utils/package-json");
const inception_1 = require("../agentic/inception");
const print_dropped_agent_context_1 = require("../agentic/print-dropped-agent-context");
const select_1 = require("../agentic/select");
const types_1 = require("../agentic/types");
const command_object_1 = require("../command-object");
const execute_migration_1 = require("../execute-migration");
const migrate_analytics_1 = require("../migrate-analytics");
const migrate_commits_1 = require("../migrate-commits");
const migrate_output_1 = require("../migrate-output");
const migration_shape_1 = require("../migration-shape");
const safe_prompt_1 = require("../safe-prompt");
const run_state_1 = require("./run-state");
const run_id_1 = require("./run-id");
const state_machine_1 = require("./state-machine");
const state_lock_1 = require("./state-lock");
const util_1 = require("./util");
const text_1 = require("../text");
const agent_output_1 = require("./agent-output");
async function runSingleMigrationWorker(input) {
    const { root, runMigration, runId, commitPrefix, interactive, skipInstall, isVerbose, } = input;
    // The worker is a second CLI entry point: the run id reaches runDir() (where
    // join resolves '..'), so validate it up front exactly as the orchestrator
    // does before it trusts a run id.
    if (runId !== undefined && !run_id_1.RUN_ID_SAFE.test(runId)) {
        throw new Error(`Invalid run id '${runId}'.`);
    }
    const { migrations, source } = readMigrationsSource(root, runId);
    const migration = resolveMigration(migrations, runMigration, source);
    (0, migrate_analytics_1.reportMigrateSingleMigrationInvocation)({
        migrationType: (0, migration_shape_1.isPromptOnlyMigration)(migration)
            ? 'prompt'
            : (0, migration_shape_1.isHybridMigration)(migration)
                ? 'hybrid'
                : 'generator',
        orchestrated: !!runId,
    });
    if (runId) {
        // A recorded run takes its commit config from run.json and is driven by
        // the outer agent, so the standalone resolution below doesn't apply. That
        // includes the default-branch confirmation: the run decided once, at init,
        // whether to commit, and asking again would re-prompt on every step.
        await runRecorded(root, runId, migration, skipInstall, isVerbose);
        return;
    }
    let agentic;
    try {
        agentic = await (0, select_1.resolveAgentic)({
            agentic: input.agentic,
            migrations: [migration],
            interactive,
        });
    }
    catch (e) {
        (0, migrate_analytics_1.reportMigrateRunError)({ code: 'agentic', error: e });
        throw e;
    }
    const resolved = (0, migrate_commits_1.resolveCreateCommits)({
        createCommits: input.createCommits,
        mode: agentic.kind,
        isGitRepo: (0, git_utils_1.isGitRepository)(root),
        commitPrefixIsCustom: commitPrefix !== command_object_1.DEFAULT_MIGRATION_COMMIT_PREFIX,
    });
    if (resolved.error) {
        throw new Error(resolved.error);
    }
    if (resolved.warning) {
        (0, agent_output_1.warnToAgent)({ title: resolved.warning });
    }
    const createCommits = resolved.effective;
    if (createCommits &&
        (0, safe_prompt_1.canPrompt)(interactive) &&
        !(await (0, migrate_commits_1.confirmMigrationCommitsOnDefaultBranch)(root, 'running the migration'))) {
        return;
    }
    await runStandalone(root, migration, {
        agentic,
        createCommits,
        agenticHasDiffContext: resolved.agenticHasDiffContext,
        shouldRunValidation: (0, select_1.resolveShouldRunValidation)({
            validate: input.validate,
            agenticKind: agentic.kind,
        }),
        commitPrefix,
        skipInstall,
        isVerbose,
    });
}
function readMigrationsSource(root, runId) {
    if (runId) {
        const dir = (0, run_state_1.runDir)(root, runId);
        // A missing run.json would surface a raw ENOENT from readRunState's
        // readFileSync; report it the way the orchestrator does instead, down to
        // carrying no remediation: starting a run is a separate, gated entry point,
        // and `--run-migrations` would run the whole plan in process instead.
        if (!(0, run_state_1.hasRunState)(dir)) {
            throw new Error(`No migrate run '${runId}' was found under ${types_1.MIGRATE_RUNS_RELATIVE_DIR}.`);
        }
        // Version refusal (NewerRunStateFormatError) propagates.
        const state = (0, run_state_1.readRunState)(dir);
        const round = (0, state_machine_1.latestRound)(state);
        if (!round) {
            throw new Error(`The migrate run '${runId}' has no recorded plan, so there is no migration to run.`);
        }
        // Safe to join and to name in the error below only because the read
        // refuses any planSnapshot that is not a bare `plan-<round>.json`.
        const planPath = (0, path_1.join)(dir, round.planSnapshot);
        if (!(0, fs_1.existsSync)(planPath)) {
            throw new Error(`The plan snapshot '${round.planSnapshot}' for migrate run '${runId}' doesn't exist, can't run the migration.`);
        }
        return {
            migrations: readPlanMigrations(planPath),
            source: round.planSnapshot,
        };
    }
    const migrationsPath = (0, path_1.join)(root, 'migrations.json');
    if (!(0, fs_1.existsSync)(migrationsPath)) {
        throw new Error(`File 'migrations.json' doesn't exist, can't run the migration. Run \`${(0, util_1.pmExecPrefix)(root)} nx migrate\` to generate it first.`);
    }
    return {
        migrations: readPlanMigrations(migrationsPath),
        source: 'migrations.json',
    };
}
function readPlanMigrations(path) {
    return ((0, fileutils_1.readJsonFile)(path).migrations ?? []);
}
function resolveMigration(migrations, id, source) {
    // Split on the first ':' only, so a name that itself contains one survives.
    const colon = id.indexOf(':');
    const matches = colon === -1
        ? migrations.filter((m) => m.name === id)
        : migrations.filter((m) => m.package === id.slice(0, colon) && m.name === id.slice(colon + 1));
    if (matches.length === 0) {
        throw new Error(`No migration matching '${id}' was found in ${source}.`);
    }
    if (matches.length > 1) {
        throw new Error([
            `More than one migration matches '${id}' in ${source}. Re-run with the full '<package>:<name>' id:`,
            ...matches.map((m) => `  - ${m.package}:${m.name}`),
        ].join('\n'));
    }
    return matches[0];
}
async function runStandalone(root, migration, opts) {
    const { agentic, createCommits, commitPrefix, skipInstall, isVerbose } = opts;
    // Standalone never writes run state. Warn (don't block) when an orchestrated
    // run is active so the user knows this execution won't be recorded into it.
    // A newer-nx run dir must not hard-block this stateless path (the fail-closed
    // refusal in run-state.ts targets run-starting callers); tolerate it and skip
    // the warning. A failed scan can't block it either, but gets a warning of its
    // own: an active run may exist that this execution silently won't record into.
    let active;
    try {
        active = (0, run_state_1.findActiveRun)(root).active;
    }
    catch (e) {
        if (!(e instanceof run_state_1.NewerRunStateFormatError)) {
            (0, agent_output_1.warnToAgent)({
                title: `Could not check for an active migrate run: ${e instanceof Error ? e.message : e}`,
            });
        }
        active = null;
    }
    if (active) {
        (0, agent_output_1.warnToAgent)({
            title: `This migration won't be recorded into the active migrate run '${active.runId}'.`,
            bodyLines: [
                `Pass --run-id=${active.runId} to record it into that run instead.`,
            ],
        });
    }
    if ((0, migration_shape_1.isPromptOnlyMigration)(migration)) {
        if (agentic.kind !== 'enabled') {
            // No agent to apply the prompt, so nothing runs: no checkpoint, no
            // commit.
            emitOrPrintPrompt(root, migration, agentic.kind);
            return;
        }
        // Checkpoint pre-existing working-tree state first, or the migration
        // commit's `git add -A` folds it in.
        if (createCommits) {
            (0, migrate_commits_1.commitCheckpointBeforeMigrations)(root, commitPrefix);
        }
        const agenticRun = await prepareAgenticRun(root, migration, agentic, createCommits, commitPrefix);
        const installer = new execute_migration_1.ChangedDepInstaller(root, skipInstall, (0, execute_migration_1.formatSingleMigrationRerunCommand)(`${migration.package}:${migration.name}`));
        const installDepsIfChanged = () => installer.installDepsIfChanged();
        const stepResult = await runAgenticStep(agenticRun, {
            root,
            migration,
            installDepsIfChanged,
            documentationPath: resolveDocumentationPath(root, migration),
        });
        await commitAndLogAgenticOutcome({
            root,
            migration,
            createCommits,
            commitPrefix,
            installDepsIfChanged,
            successLabel: 'Applied',
            stepResult,
        });
        if (installer.skippedInstall) {
            (0, execute_migration_1.logSkippedPostMigrationInstall)(root);
        }
        return;
    }
    if (createCommits) {
        (0, migrate_commits_1.commitCheckpointBeforeMigrations)(root, commitPrefix);
    }
    const agenticRun = agentic.kind === 'enabled'
        ? await prepareAgenticRun(root, migration, agentic, createCommits, commitPrefix)
        : undefined;
    const installer = new execute_migration_1.ChangedDepInstaller(root, skipInstall, (0, execute_migration_1.formatSingleMigrationRerunCommand)(`${migration.package}:${migration.name}`));
    const installDepsIfChanged = () => installer.installDepsIfChanged();
    const validationRun = agenticRun && opts.shouldRunValidation ? agenticRun : undefined;
    const resolvedCollection = (0, execute_migration_1.readMigrationCollection)(migration.package, root);
    const { changes, nextSteps, agentContext, skipAgentic, logs, madeChanges } = await (0, execute_migration_1.runNxOrAngularMigration)(root, migration, isVerbose, (0, migration_shape_1.isHybridMigration)(migration) || !!validationRun, resolvedCollection);
    // Whether an AI step was on the table for `skipAgentic` to waive. A hybrid
    // owes its prompt in every agentic mode; a generator-only migration owes
    // only the validation pass, and only where one would have run.
    const validationApplies = !!validationRun && changes.length > 0;
    const waivedAgenticStep = skipAgentic && ((0, migration_shape_1.isHybridMigration)(migration) || validationApplies);
    if ((0, migration_shape_1.isHybridMigration)(migration) && agenticRun && !skipAgentic) {
        // The prompt half may need the deps the generator half added, so install
        // before the agent runs.
        await installDepsIfChanged();
        const stepResult = await runAgenticStep(agenticRun, {
            root,
            migration,
            installDepsIfChanged,
            documentationPath: resolveDocumentationPath(root, migration, resolvedCollection),
            implContext: {
                logs,
                changes,
                agentContext,
                // No prior migrations run here, so unlike the classic loop there is no
                // pending-commit debt to suppress the git-inspect context for.
                hasDiffContext: opts.agenticHasDiffContext,
            },
        });
        await commitAndLogAgenticOutcome({
            root,
            migration,
            createCommits,
            commitPrefix,
            installDepsIfChanged,
            successLabel: 'Applied',
            stepResult,
        });
        if (installer.skippedInstall) {
            (0, execute_migration_1.logSkippedPostMigrationInstall)(root);
        }
        printNextSteps(migration, nextSteps);
        return;
    }
    if (validationApplies && !skipAgentic) {
        // Commit after validation: a failed validation throws, leaving the changes
        // in the working tree for review.
        await installDepsIfChanged();
        const stepResult = await runAgenticStep(validationRun, {
            root,
            migration,
            installDepsIfChanged,
            documentationPath: resolveDocumentationPath(root, migration, resolvedCollection),
            implContext: {
                logs,
                changes,
                agentContext,
                hasDiffContext: opts.agenticHasDiffContext,
            },
            mode: 'generic-validation',
        });
        await commitAndLogAgenticOutcome({
            root,
            migration,
            createCommits,
            commitPrefix,
            installDepsIfChanged,
            successLabel: 'Validation passed',
            stepResult,
        });
        if (installer.skippedInstall) {
            (0, execute_migration_1.logSkippedPostMigrationInstall)(root);
        }
        printNextSteps(migration, nextSteps);
        return;
    }
    if (waivedAgenticStep) {
        (0, migrate_output_1.logWaivedAgenticStep)(migration, agentContext);
    }
    else if (!(0, migration_shape_1.isHybridMigration)(migration)) {
        forwardDroppedAgentContext(migration, agentContext, agentic.kind);
    }
    // A no-op migration must not build a commit whose `git add -A` absorbs
    // unrelated pending diffs under its name. The commit path installs deps
    // itself, so the else branch does it here instead.
    if (createCommits && madeChanges) {
        await attemptStandaloneCommit(root, migration, createCommits, commitPrefix, installDepsIfChanged);
    }
    else {
        await installer.installDepsIfChanged();
    }
    if (installer.skippedInstall) {
        (0, execute_migration_1.logSkippedPostMigrationInstall)(root);
    }
    printNextSteps(migration, nextSteps);
    // A waived prompt is not deferred, so it gets no hand-off to an outer agent
    // and no "apply this manually" block for the user either.
    if ((0, migration_shape_1.isHybridMigration)(migration) && !skipAgentic) {
        emitOrPrintPrompt(root, migration, agentic.kind, {
            logs,
            changes,
            agentContext,
        }, resolvedCollection);
    }
}
async function runRecorded(root, runId, migration, skipInstall, isVerbose) {
    const dir = (0, run_state_1.runDir)(root, runId);
    // Version refusal (NewerRunStateFormatError) propagates.
    let state = (0, run_state_1.readRunState)(dir);
    // A recorded run never resolves the agentic flow (the outer agent drives
    // it); prompts are emitted for that agent or printed for a user hand-running
    // the dispensed command.
    const agenticKind = (0, inception_1.isInsideAgent)()
        ? 'inside-agent'
        : 'disabled';
    const migrationId = `${migration.package}:${migration.name}`;
    // The plan was read from the latest round's snapshot, so only that round's
    // step may match; a same-id step from an older round must not.
    const latest = (0, state_machine_1.latestRound)(state);
    const step = state.steps.find((s) => s.migrationId === migrationId && s.roundIndex === latest?.index);
    if (!step) {
        throw new Error(`The migrate run '${runId}' has no step for migration '${migrationId}'.`);
    }
    // Validated against the fresh disk state: a second worker racing the same
    // dispensed step reads 'running' here and aborts before the engine runs.
    state = transition(dir, {
        type: 'start',
        stepId: step.id,
        pid: process.pid,
        startedAt: (0, util_1.nowIso)(),
    });
    // A prior attempt's generator half already ran, so this attempt must not
    // reapply it against a tree that already holds its changes: a hybrid
    // re-emits only its prompt, and a plain generator step has nothing left to
    // do but the install and commit its previous attempt failed on.
    // Read from the state the start transition returned: a delayed invocation
    // may have claimed a later attempt whose flag its entry snapshot predates.
    const startedStep = state.steps.find((s) => s.id === step.id);
    const generatorAlreadyCompleted = startedStep.generatorCompleted === true;
    // The run records its own install policy because dispensed worker commands
    // are re-invoked by the loop and never carry the user's flags; an explicit
    // --skip-install on this invocation still applies on top of it.
    const effectiveSkipInstall = state.skipInstall === true || skipInstall;
    let outcome;
    try {
        if ((0, migration_shape_1.isPromptOnlyMigration)(migration) ||
            (generatorAlreadyCompleted && (0, migration_shape_1.isHybridMigration)(migration))) {
            emitOrPrintPrompt(root, migration, agenticKind);
        }
        else if (generatorAlreadyCompleted) {
            state = await finishCompletedGenerator(dir, root, state, startedStep, migration, effectiveSkipInstall, runId);
            outcome = buildOutcome([], [], 'The generator ran in an earlier attempt; this attempt completed its install and commit.', root);
        }
        else {
            const installer = new execute_migration_1.ChangedDepInstaller(root, effectiveSkipInstall, `${(0, execute_migration_1.formatSingleMigrationRerunCommand)(migrationId)} --run-id=${runId}`);
            // Read once; the run and the hybrid documentation resolution share it.
            const resolvedCollection = (0, execute_migration_1.readMigrationCollection)(migration.package, root);
            const { changes, nextSteps, agentContext, logs, madeChanges } = await (0, execute_migration_1.runNxOrAngularMigration)(root, migration, isVerbose, (0, migration_shape_1.isHybridMigration)(migration), resolvedCollection);
            // Recorded before the commit is attempted: from here on the changes are
            // in the tree, so a failed install or commit must leave a retry with
            // only those left to do rather than running the generator again.
            state = transition(dir, {
                type: 'markGeneratorCompleted',
                stepId: step.id,
            });
            if (!(0, migration_shape_1.isHybridMigration)(migration)) {
                forwardDroppedAgentContext(migration, agentContext, agenticKind);
            }
            const install = () => recordingInstallFailure(dir, step.id, () => installer.installDepsIfChanged());
            // Commits follow the run config, not CLI flags, and only when the
            // generator changed something: a no-op step must not create a commit (nor
            // a ledger entry) that absorbs prior pending diffs under its name.
            if (state.createCommits && madeChanges) {
                state = await commitStepChanges(dir, root, state, step, migration, install);
            }
            else {
                await install();
            }
            if (installer.skippedInstall) {
                (0, execute_migration_1.logSkippedPostMigrationInstall)(root);
            }
            else if (installer.installed) {
                (0, util_1.recordInstallLanded)(root, dir, step.id);
            }
            printNextSteps(migration, nextSteps);
            if ((0, migration_shape_1.isHybridMigration)(migration)) {
                emitOrPrintPrompt(root, migration, agenticKind, {
                    logs,
                    changes,
                    agentContext,
                }, resolvedCollection);
            }
            else {
                outcome = buildOutcome(changes, nextSteps, migration.description, root);
            }
        }
    }
    catch (e) {
        // The failed-step dispense surfaces this so the agent can decide
        // retry-vs-skip; carry the error's first line, not a full stack.
        transition(dir, {
            type: 'fail',
            stepId: step.id,
            finishedAt: (0, util_1.nowIso)(),
            outcome: { summary: (0, util_1.summarizeError)(e) },
        });
        throw e;
    }
    // A prompt half (prompt-only, or the prompt phase of a hybrid) is applied by
    // a separate actor, so the step parks in awaiting-prompt-outcome and this
    // process exits successfully.
    if ((0, migration_shape_1.isPromptOnlyMigration)(migration) || (0, migration_shape_1.isHybridMigration)(migration)) {
        transition(dir, {
            type: 'awaitPromptOutcome',
            stepId: step.id,
            finishedAt: (0, util_1.nowIso)(),
        });
        return;
    }
    transition(dir, {
        type: 'succeed',
        stepId: step.id,
        finishedAt: (0, util_1.nowIso)(),
        ...(outcome ? { outcome } : {}),
    });
}
// Applies a step event to the freshest on-disk state under the lock, writes it,
// and returns it. Reading fresh is what makes a racing worker's 'start' see the
// step already 'running' and abort. An illegal transition (e.g. a step that was
// never dispensed) fails with the state machine's own reason.
function transition(dir, event) {
    return (0, state_lock_1.updateRunState)(dir, (fresh) => {
        const result = (0, state_machine_1.applyStepEvent)(fresh, event);
        if (result.kind === 'error') {
            throw new Error(`Cannot record this migration into the run: ${result.reason}`);
        }
        return result.state;
    });
}
// Records a dependency install failure on the step before letting it fail the
// attempt. The 'failed' status says this attempt did not finish, not that the
// workspace's dependencies are missing, and the two part ways as soon as the
// agent skips the step or a later step's commit absorbs its diff: either one
// completes the run with node_modules stale and nothing left to warn about.
async function recordingInstallFailure(dir, stepId, install) {
    try {
        return await install();
    }
    catch (e) {
        (0, state_lock_1.updateRunState)(dir, (fresh) => (0, state_machine_1.markInstallFailed)(fresh, stepId));
        throw e;
    }
}
// Finishes a step whose generator ran in an earlier attempt that then failed
// on the install or the commit. The generator's changes are already in the
// tree, so only those two are left, and the install compares against the
// step's persisted baseline rather than against what that generator wrote.
async function finishCompletedGenerator(dir, root, state, step, migration, skipInstall, runId) {
    const migrationId = `${migration.package}:${migration.name}`;
    const installDeps = () => recordingInstallFailure(dir, step.id, () => (0, util_1.installDepsChangedSinceDispense)(root, dir, step, skipInstall, `${(0, execute_migration_1.formatSingleMigrationRerunCommand)(migrationId)} --run-id=${runId}`));
    if (!state.createCommits) {
        await installDeps();
        return state;
    }
    return commitStepChanges(dir, root, state, step, migration, installDeps);
}
// Installs what the step changed, commits it, and records the result in the
// ledger, shared by a step's first attempt and by one that only has the commit
// left to do. The absorbed step ids are computed before the commit so the
// ledger entry and the commit body name the same ones.
async function commitStepChanges(dir, root, state, step, migration, installDeps) {
    const absorbedStepIds = (0, state_machine_1.uncoveredFailedStepIds)(state).filter((id) => id !== step.id);
    let result;
    try {
        result = await (0, migrate_commits_1.commitMigrationIfRequested)(root, migration, true, state.commitPrefix, installDeps, (0, state_machine_1.stepsToPendingMigrations)(state, absorbedStepIds));
    }
    catch (commitError) {
        // A post-migration install failure leaves the diff uncommitted; record the
        // debt so only a landed entry can cover it.
        appendCommit(dir, { kind: 'failed', stepIds: [step.id] });
        throw commitError;
    }
    if (result.status === 'failed') {
        (0, util_1.warnCommitFailed)(migration.name);
    }
    const entry = (0, state_machine_1.commitResultToLedgerEntry)(result, step.id, absorbedStepIds);
    return entry ? appendCommit(dir, entry) : state;
}
// Appends a ledger entry to the freshest on-disk state under the lock. The git
// commit itself already ran outside the lock; only this pure append is locked.
function appendCommit(dir, entry) {
    return (0, state_lock_1.updateRunState)(dir, (fresh) => ({
        ...fresh,
        commits: [...fresh.commits, entry],
    }));
}
function buildOutcome(changes, nextSteps, description, root) {
    const outcome = {};
    if (changes.length > 0) {
        outcome.fileChanges = changes.map((c) => c.path);
    }
    // Non-git repos have no HEAD; omit rather than record a placeholder.
    const gitRefAfter = (0, git_utils_1.getLatestCommitSha)(root);
    if (gitRefAfter) {
        outcome.gitRefAfter = gitRefAfter;
    }
    if (nextSteps.length > 0) {
        outcome.nextSteps = nextSteps;
    }
    if (description) {
        outcome.summary = description;
    }
    return outcome;
}
// Only `run-step` is actually deferred by these requires, and it is the one
// worth deferring: it pulls in the prompt builders, which nothing but an
// enabled agentic flow needs. The other two are loaded either way, since the
// `run/` barrel every caller comes through re-exports `orchestrator.ts`, which
// imports both statically.
async function prepareAgenticRun(root, migration, agentic, effectiveCreateCommits, commitPrefix) {
    const { applyAgenticHandoffGitignoreFallback } = require('../agentic/handoff-gitignore');
    const { packageJson: nxPackageJson } = (0, package_json_1.readModulePackageJson)('nx', (0, installation_directory_1.getNxRequirePaths)(root));
    await applyAgenticHandoffGitignoreFallback({
        migrations: [migration],
        installedNxVersion: nxPackageJson.version,
        effectiveCreateCommits,
        commitPrefix,
        root,
    });
    const { initRunDir, resolveAgenticRunId } = require('../agentic/handoff');
    const { runAgenticPromptStep } = require('../agentic/run-step');
    return {
        agentic,
        runDir: initRunDir(root, resolveAgenticRunId([migration])),
        runStep: runAgenticPromptStep,
    };
}
async function runAgenticStep(agenticRun, input) {
    try {
        return await agenticRun.runStep({
            ...input,
            agentic: agenticRun.agentic,
            runDir: agenticRun.runDir,
        });
    }
    catch (e) {
        (0, migrate_analytics_1.reportMigrateRunError)({
            code: 'agentic',
            migrationPackage: input.migration.package,
            migrationName: input.migration.name,
            error: e,
        });
        throw e;
    }
}
// A standalone run has no later commit or end-of-run recap to absorb a failed
// commit's diff, so it passes its own guidance instead of the default.
// `commitMigrationIfRequested` logs a failed commit itself with that guidance.
function attemptStandaloneCommit(root, migration, createCommits, commitPrefix, installDepsIfChanged) {
    return (0, migrate_commits_1.commitMigrationIfRequested)(root, migration, createCommits, commitPrefix, installDepsIfChanged, [], 'Commit or revert the changes manually.');
}
async function commitAndLogAgenticOutcome(args) {
    const commit = await attemptStandaloneCommit(args.root, args.migration, args.createCommits, args.commitPrefix, args.installDepsIfChanged);
    (0, migrate_output_1.logAgenticSuccessOutcome)(args.stepResult.ambiguous ? 'Marked complete by user' : args.successLabel, commit.status === 'committed' ? commit.sha : null, args.stepResult.summary);
}
// Hybrids are excluded by the caller: their `agentContext` rides in the
// prompt payload instead.
function forwardDroppedAgentContext(migration, agentContext, agenticKind) {
    if (agentContext.length > 0 && agenticKind === 'inside-agent') {
        (0, print_dropped_agent_context_1.printDroppedAgentContextForOuterAgent)({ migration, agentContext });
    }
}
function printNextSteps(migration, nextSteps) {
    if (nextSteps.length === 0)
        return;
    (0, agent_output_1.logToAgent)({
        title: `Next steps for ${migration.package}: ${migration.name}`,
        bodyLines: nextSteps.map((line) => `- ${(0, text_1.singleLine)(line)}`),
    });
}
function emitOrPrintPrompt(root, migration, agenticKind, impl, resolvedCollection) {
    const migrationId = `${migration.package}:${migration.name}`;
    const promptPath = migration.prompt;
    const documentationPath = resolveDocumentationPath(root, migration, resolvedCollection);
    if (agenticKind === 'inside-agent') {
        emitPromptForOuterAgent(migrationId, promptPath, documentationPath, impl);
    }
    else {
        printPromptForUser(root, migration, promptPath, documentationPath);
    }
}
function emitPromptForOuterAgent(migrationId, promptPath, documentationPath, impl) {
    const payload = { migrationId, prompt: promptPath };
    if (documentationPath)
        payload.documentationPath = documentationPath;
    if (impl) {
        payload.impl = {
            logs: impl.logs,
            changes: impl.changes.map((c) => ({ type: c.type, path: c.path })),
            ...(impl.agentContext.length > 0
                ? { agentContext: impl.agentContext }
                : {}),
        };
    }
    (0, agent_output_1.logToAgent)({
        title: `The following prompt-based migration was not applied automatically. Apply it to this workspace, then continue.`,
    });
    (0, agent_output_1.emitPromptBlock)(migrationId, payload);
}
function printPromptForUser(root, migration, promptPath, documentationPath) {
    const bodyLines = [];
    if (promptPath)
        bodyLines.push(`Instructions file: ${promptPath}`);
    if (documentationPath)
        bodyLines.push(`Documentation: ${documentationPath}`);
    let content = '';
    let readErrorCode;
    if (promptPath) {
        try {
            content = (0, fs_1.readFileSync)((0, path_1.join)(root, promptPath), 'utf-8');
        }
        catch (e) {
            const err = e;
            readErrorCode = err.code ?? err.message;
        }
    }
    if (readErrorCode) {
        // Point at the file and error code: the generic "review the instructions
        // above" copy would sit under an empty body.
        bodyLines.push('', `The instructions file '${promptPath}' could not be read (${readErrorCode}). Open it manually and apply the instructions.`);
    }
    else {
        if (content) {
            bodyLines.push('', ...content.split('\n'));
        }
        bodyLines.push('', 'Review the instructions above and apply them manually.');
    }
    (0, agent_output_1.logToAgent)({
        title: `Prompt-based migration ${migration.package}: ${migration.name} must be applied manually`,
        bodyLines,
    });
}
// Non-fatal: documentation is supplementary, so a failure warns and the
// prompt still runs without it.
function resolveDocumentationPath(root, migration, resolvedCollection) {
    if (!migration.documentation)
        return undefined;
    let documentationPath;
    try {
        const { collectionPath } = resolvedCollection ?? (0, execute_migration_1.readMigrationCollection)(migration.package, root);
        documentationPath = (0, execute_migration_1.resolveDocumentationFileToWorkspacePath)(root, (0, path_1.dirname)(collectionPath), migration.documentation);
    }
    catch {
        // An unreadable collection is reported through the warning below.
    }
    if (!documentationPath) {
        (0, agent_output_1.warnToAgent)({
            title: `Could not resolve the "documentation" file "${migration.documentation}" declared for migration "${migration.package}: ${migration.name}". It will be skipped.`,
        });
    }
    return documentationPath;
}

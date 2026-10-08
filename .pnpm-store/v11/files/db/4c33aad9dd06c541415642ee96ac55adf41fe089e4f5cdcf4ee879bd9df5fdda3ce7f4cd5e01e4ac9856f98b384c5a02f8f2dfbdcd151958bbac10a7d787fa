"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NewerRunStateFormatError = exports.SHELL_SAFE_VALUE = exports.RUN_STATE_FILE_NAME = exports.CURRENT_RUN_STATE_FORMAT_VERSION = void 0;
exports.migrateRunsDir = migrateRunsDir;
exports.runDir = runDir;
exports.runHandoffsDir = runHandoffsDir;
exports.readRunState = readRunState;
exports.writeRunState = writeRunState;
exports.hasRunState = hasRunState;
exports.findActiveRun = findActiveRun;
exports.createRun = createRun;
const fs_1 = require("fs");
const crypto_1 = require("crypto");
const path_1 = require("path");
const fileutils_1 = require("../../../utils/fileutils");
const git_utils_1 = require("../../../utils/git-utils");
const versions_1 = require("../../../utils/versions");
const types_1 = require("../agentic/types");
const run_id_1 = require("./run-id");
const text_1 = require("../text");
exports.CURRENT_RUN_STATE_FORMAT_VERSION = 1;
exports.RUN_STATE_FILE_NAME = 'run.json';
/**
 * The charset a migration id must stay inside to be interpolated into a
 * dispensed command. The outer agent executes those verbatim, so hostile ids
 * are refused rather than quoted per-platform (POSIX quoting is no defense in
 * cmd.exe). Enforced twice: on the incoming plan at init, so a bad id never
 * starts a run, and here on read, so a run whose persisted ids were tampered
 * with fails closed as corrupt instead of being dispensed.
 */
exports.SHELL_SAFE_VALUE = /^[A-Za-z0-9@/:._-]+$/;
// `new Date().toISOString()`, the only shape Nx writes. Retention and active-run
// selection compare these lexicographically, and the value is rendered into the
// stdout the agent scans for blocks, so neither a different notation nor an
// embedded newline can be tolerated.
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/**
 * A round's snapshot is a file Nx writes next to `run.json`, so the recorded
 * name is a bare `plan-<round>.json`. Pinning the whole name is what keeps a
 * tampered value from resolving outside the run directory when the worker
 * joins it, and from reaching stdout with a line break in it when the worker
 * reports the snapshot missing.
 */
const PLAN_SNAPSHOT_NAME = /^plan-\d+\.json$/;
/**
 * Nx numbers its steps off the plan, so a recorded id is a bare `step-<n>`.
 * The state machine names the id back in the reason it rejects an illegal
 * transition with, and the worker throws that reason, which puts it in front
 * of the agent without passing the block-safe writer.
 */
const STEP_ID = /^step-\d+$/;
// Keeps `.nx/migrate-runs` from growing unbounded across many `nx migrate`
// invocations over the life of a workspace.
const MAX_RETAINED_COMPLETED_RUNS = 5;
// Closed sets are declared as const arrays so the derived types and the
// runtime validation in `readRunState` cannot drift apart (same pattern as
// STEP_ACTIONS in step-actions.ts).
const MIGRATE_RUN_STATUSES = ['active', 'completed'];
const MIGRATE_STEP_STATUSES = [
    'pending',
    'dispensed',
    'running',
    'awaiting-prompt-outcome',
    'succeeded',
    'failed',
    'skipped',
    'died',
];
const PROMPT_OUTCOME_STATUSES = ['completed', 'skipped', 'failed'];
const MIGRATE_COMMIT_KINDS = ['checkpoint', 'landed', 'failed'];
const REQUIRED_TOP_LEVEL_FIELDS = [
    'formatVersion',
    'runId',
    'createdAt',
    'nxVersion',
    'status',
    'createCommits',
    'commitPrefix',
    'rounds',
    'steps',
    'commits',
    'analytics',
];
function migrateRunsDir(root) {
    return (0, path_1.join)(root, types_1.MIGRATE_RUNS_RELATIVE_DIR);
}
function runDir(root, runId) {
    return (0, path_1.join)(migrateRunsDir(root), runId);
}
/** See `HANDOFFS_DIR_NAME` for why the subtree exists. */
function runHandoffsDir(runDirPath) {
    return (0, path_1.join)(runDirPath, types_1.HANDOFFS_DIR_NAME);
}
function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const REQUIRED_ARRAY_FIELDS = [
    'rounds',
    'steps',
    'commits',
];
const REQUIRED_STRING_FIELDS = [
    'runId',
    'createdAt',
    'nxVersion',
    'status',
    'commitPrefix',
];
function isOneOf(values, value) {
    return (typeof value === 'string' && values.includes(value));
}
function isOptionalString(value) {
    return value === undefined || typeof value === 'string';
}
function isOptionalNumber(value) {
    return value === undefined || typeof value === 'number';
}
function isOptionalBoolean(value) {
    return value === undefined || typeof value === 'boolean';
}
// A recorded `git rev-parse` output. `RegExp.test` stringifies its argument,
// so a numeric 1234 would pass the hex test without the type check.
function isOptionalSha(value) {
    return (value === undefined || (typeof value === 'string' && git_utils_1.GIT_SHA.test(value)));
}
function isOptionalStringArray(value) {
    return (value === undefined ||
        (Array.isArray(value) && value.every((item) => typeof item === 'string')));
}
function isRoundShape(value) {
    return (isPlainObject(value) &&
        typeof value.index === 'number' &&
        typeof value.planHash === 'string' &&
        typeof value.planSnapshot === 'string' &&
        PLAN_SNAPSHOT_NAME.test(value.planSnapshot));
}
function isStepOutcomeShape(value) {
    return (value === undefined ||
        (isPlainObject(value) &&
            isOptionalStringArray(value.fileChanges) &&
            isOptionalSha(value.gitRefAfter) &&
            isOptionalStringArray(value.nextSteps) &&
            isOptionalString(value.summary)));
}
function isPromptOutcomeShape(value) {
    return (value === undefined ||
        (isPlainObject(value) &&
            isOneOf(PROMPT_OUTCOME_STATUSES, value.status) &&
            isOptionalString(value.summary)));
}
function isStepShape(value) {
    return (isPlainObject(value) &&
        typeof value.id === 'string' &&
        STEP_ID.test(value.id) &&
        typeof value.roundIndex === 'number' &&
        typeof value.migrationId === 'string' &&
        exports.SHELL_SAFE_VALUE.test(value.migrationId) &&
        isOneOf(MIGRATE_STEP_STATUSES, value.status) &&
        typeof value.attempt === 'number' &&
        typeof value.dispenseCount === 'number' &&
        isOptionalBoolean(value.hasGenerator) &&
        isOptionalNumber(value.pid) &&
        isOptionalString(value.startedAt) &&
        isOptionalString(value.finishedAt) &&
        isOptionalSha(value.gitRefBefore) &&
        isOptionalBoolean(value.treeCleanAtDispense) &&
        isOptionalString(value.depsHashAtDispense) &&
        isStepOutcomeShape(value.outcome) &&
        isPromptOutcomeShape(value.promptOutcome) &&
        isOptionalBoolean(value.generatorCompleted) &&
        isOptionalBoolean(value.installFailed) &&
        // A cross-field invariant the rest of the loop relies on: a running step
        // without a pid is never reclassified as died and no step action targets
        // it, so it stalls the run forever.
        (value.status === 'running' ? typeof value.pid === 'number' : true));
}
function isCommitLedgerEntryShape(value) {
    return (isPlainObject(value) &&
        isOneOf(MIGRATE_COMMIT_KINDS, value.kind) &&
        Array.isArray(value.stepIds) &&
        value.stepIds.every((id) => typeof id === 'string' && STEP_ID.test(id)) &&
        isOptionalSha(value.sha));
}
function isAnalyticsShape(value) {
    return (isPlainObject(value) &&
        typeof value.startEmitted === 'boolean' &&
        typeof value.completeEmitted === 'boolean');
}
// A field present with the wrong type must fail here, not reach a
// `.find`/iteration deep in the worker or orchestrator as a raw TypeError.
// That includes array elements (`steps: [null]`) and closed-set values: a
// mangled `status` would otherwise read as neither active nor completed and
// let a competing run start on top of this one.
function hasValidRunStateShape(parsed) {
    return (REQUIRED_ARRAY_FIELDS.every((field) => Array.isArray(parsed[field])) &&
        REQUIRED_STRING_FIELDS.every((field) => typeof parsed[field] === 'string') &&
        ISO_TIMESTAMP.test(parsed.createdAt) &&
        typeof parsed.formatVersion === 'number' &&
        typeof parsed.createCommits === 'boolean' &&
        isOneOf(MIGRATE_RUN_STATUSES, parsed.status) &&
        isOptionalBoolean(parsed.checkpointFailed) &&
        isOptionalBoolean(parsed.skipInstall) &&
        parsed.rounds.every(isRoundShape) &&
        parsed.steps.every(isStepShape) &&
        parsed.commits.every(isCommitLedgerEntryShape) &&
        isAnalyticsShape(parsed.analytics));
}
function corruptRunStateError(filePath, reason) {
    return new Error(`Corrupt run state at ${filePath}: ${reason}`);
}
/**
 * Thrown when a run.json declares a `formatVersion` newer than this Nx
 * understands. Callers must not treat such a run as absent: an older Nx
 * ignoring a newer active run would start a competing run on top of it.
 *
 * Adding a member to any persisted closed set (run status, step status,
 * prompt-outcome status, commit kind) needs a
 * `CURRENT_RUN_STATE_FORMAT_VERSION` bump: without it, an older Nx reading
 * the new value would reject the run as corrupt (the closed-set validation
 * fails) instead of refusing with this error's ask for a newer Nx.
 */
class NewerRunStateFormatError extends Error {
    constructor(message) {
        super(message);
        this.name = 'NewerRunStateFormatError';
    }
}
exports.NewerRunStateFormatError = NewerRunStateFormatError;
/**
 * Reads and validates `run.json` from a run directory.
 *
 * A `formatVersion` newer than {@link CURRENT_RUN_STATE_FORMAT_VERSION} means
 * the run was created by a newer Nx than the one currently running, so the
 * shape may not be interpretable here; this throws rather than attempting a
 * best-effort read. An older `formatVersion` is returned as-is: only v1
 * exists today, so there is nothing to migrate yet.
 */
function readRunState(runDirPath) {
    const filePath = (0, path_1.join)(runDirPath, exports.RUN_STATE_FILE_NAME);
    const content = (0, fs_1.readFileSync)(filePath, 'utf-8');
    let parsed;
    try {
        parsed = JSON.parse(content);
    }
    catch {
        throw corruptRunStateError(filePath, 'not valid JSON.');
    }
    if (!isPlainObject(parsed)) {
        throw corruptRunStateError(filePath, 'is missing required fields or has fields of an unexpected type.');
    }
    // Version refusal must precede shape validation: a newer format may change a
    // field's type on purpose, and classifying that as corruption would surface
    // it as a corrupt run to fix or remove, when the real remediation is
    // re-running with the newer Nx that owns it.
    if (typeof parsed.formatVersion === 'number' &&
        parsed.formatVersion > exports.CURRENT_RUN_STATE_FORMAT_VERSION) {
        // This refusal runs before the shape check, so `nxVersion` has not been
        // validated yet and the error carrying it leaves through handleErrors,
        // which prints the message's own lines rather than the block-safe writer.
        const createdBy = typeof parsed.nxVersion === 'string'
            ? `Nx ${(0, text_1.singleLine)(parsed.nxVersion)}`
            : 'a newer version of Nx';
        throw new NewerRunStateFormatError(`This migrate run was created with ${createdBy} (run state format v${parsed.formatVersion}), which is newer than the Nx version currently running, ${versions_1.nxVersion} (run state format v${exports.CURRENT_RUN_STATE_FORMAT_VERSION}). Re-run your migrate command with ${createdBy} or later to resume this run.`);
    }
    if (REQUIRED_TOP_LEVEL_FIELDS.some((field) => !(field in parsed)) ||
        !hasValidRunStateShape(parsed)) {
        throw corruptRunStateError(filePath, 'is missing required fields or has fields of an unexpected type.');
    }
    // The directory name is the run id every caller reached this state through,
    // so a run.json naming a different one is not this run: the commands built
    // from the persisted copy would send the agent somewhere else.
    if (parsed.runId !== (0, path_1.basename)(runDirPath)) {
        // Collapsed, then quoted: the rejected value is the untrusted one and this
        // reason reaches the stdout the agent scans for blocks. Quoting alone
        // would not do it, since JSON.stringify leaves the Unicode line separators
        // literal.
        throw corruptRunStateError(filePath, `declares run id ${JSON.stringify((0, text_1.singleLine)(parsed.runId))} but sits in a directory named ${JSON.stringify((0, text_1.singleLine)((0, path_1.basename)(runDirPath)))}.`);
    }
    return parsed;
}
/**
 * Writes `run.json` atomically: serializes to a temp file in the same
 * directory, then renames over the real path. A crash mid-write can only
 * ever leave the stale temp file behind, never a half-written run.json.
 *
 * Rename gives per-write atomicity only. Serializing the read-modify-write
 * sequences that concurrent nx migrate processes run is state-lock.ts's job.
 */
function writeRunState(runDirPath, state) {
    const filePath = (0, path_1.join)(runDirPath, exports.RUN_STATE_FILE_NAME);
    const tmpPath = `${filePath}~${(0, crypto_1.randomBytes)(4).toString('hex')}`;
    (0, fileutils_1.writeJsonFile)(tmpPath, state);
    (0, fs_1.renameSync)(tmpPath, filePath);
}
// ENOENT is the ordinary "no runs yet" answer. Any other failure (EACCES,
// ENOTDIR) hides runs that may exist, so it propagates rather than reading
// as an empty directory.
function readDirEntries(dir) {
    try {
        return (0, fs_1.readdirSync)(dir, { withFileTypes: true });
    }
    catch (e) {
        if (e?.code === 'ENOENT')
            return [];
        throw e;
    }
}
// Whether a directory holds a run at all. False for a path that doesn't exist
// (a run id the user made up) and for one that does but holds no run.json (a
// legacy per-version agentic scratch dir).
function hasRunState(runDirPath) {
    return (0, fs_1.existsSync)((0, path_1.join)(runDirPath, exports.RUN_STATE_FILE_NAME));
}
// Corrupt run.json reads as null; a newer-format run.json propagates so
// callers can't mistake an incompatible run for an absent one.
function readRunDirState(candidateDir) {
    if (!hasRunState(candidateDir))
        return null;
    try {
        return readRunState(candidateDir);
    }
    catch (e) {
        if (e instanceof NewerRunStateFormatError)
            throw e;
        return null;
    }
}
/**
 * Scans for the newest active run. A dir that holds a run.json but could be an
 * active run this caller cannot use is returned as `uninterpretable` instead
 * of being silently skipped: treating it as absent would let a run-starting
 * caller create a competing run that re-applies migrations the first run
 * already applied. That covers unreadable or corrupt content, where whether
 * the run is active cannot be determined, and an active run in a dir whose
 * name fails {@link RUN_ID_SAFE}, which cannot be resumed either.
 *
 * A dir that reads cleanly as a finished run is skipped whatever its name is:
 * it competes with nothing, and reporting it would block every future run
 * with no way for retention to ever clear it.
 *
 * Throws {@link NewerRunStateFormatError} when any run dir holds a
 * newer-format run.json: whether that run is active can't be determined
 * here, and its remediation (a newer Nx) differs from the uninterpretable
 * one (fix or remove).
 */
function findActiveRun(root) {
    let newest = null;
    const uninterpretable = [];
    for (const entry of readDirEntries(migrateRunsDir(root))) {
        if (!entry.isDirectory())
            continue;
        const dir = (0, path_1.join)(migrateRunsDir(root), entry.name);
        if (!hasRunState(dir))
            continue;
        let state;
        try {
            // Safe for any dir name: the path comes from the directory entry, never
            // from a value interpolated into a command.
            state = readRunState(dir);
        }
        catch (e) {
            if (e instanceof NewerRunStateFormatError)
                throw e;
            uninterpretable.push({
                dirName: entry.name,
                reason: e instanceof Error ? e.message : String(e),
            });
            continue;
        }
        if (state.status !== 'active')
            continue;
        // Run ids are joined into paths and interpolated into dispensed commands,
        // so a dir whose name fails the gate is never trusted as a resumable run.
        if (!run_id_1.RUN_ID_SAFE.test(entry.name)) {
            uninterpretable.push({
                dirName: entry.name,
                reason: 'its name is not a valid run id',
            });
            continue;
        }
        if (!newest || state.createdAt > newest.state.createdAt) {
            newest = { runId: entry.name, state };
        }
    }
    return { active: newest, uninterpretable };
}
/**
 * Creates a new run directory and writes its initial state, then prunes old
 * completed runs so `.nx/migrate-runs` doesn't grow unbounded: only the
 * newest {@link MAX_RETAINED_COMPLETED_RUNS} completed runs are kept. Active
 * runs, the run just created, and legacy per-version runner dirs (no
 * run.json) are never pruned.
 *
 * Retention is best effort. A dir it cannot interpret or cannot remove is
 * left in place: the run's state is already written by then, so failing here
 * would abort a run that exists, and every retry would abort the same way.
 */
function createRun(root, state) {
    const dir = runDir(root, state.runId);
    // Created up front, and each step's package directory at dispense, so the
    // agent never has to `mkdir -p`: that costs a workspace-permission prompt in
    // agents like Claude Code, on every step.
    (0, fs_1.mkdirSync)(runHandoffsDir(dir), { recursive: true });
    writeRunState(dir, state);
    pruneCompletedRuns(root, state.runId);
}
function pruneCompletedRuns(root, justCreatedRunId) {
    const dir = migrateRunsDir(root);
    const completed = [];
    for (const entry of readDirEntries(dir)) {
        if (!entry.isDirectory() || entry.name === justCreatedRunId)
            continue;
        let state;
        try {
            state = readRunDirState((0, path_1.join)(dir, entry.name));
        }
        catch {
            // A newer-format run belongs to a newer Nx; leave it for that Nx to
            // manage rather than pruning what can't be interpreted here.
            continue;
        }
        if (state?.status === 'completed') {
            completed.push({ runId: entry.name, createdAt: state.createdAt });
        }
    }
    completed
        .sort((a, b) => a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)
        .slice(MAX_RETAINED_COMPLETED_RUNS)
        .forEach((stale) => {
        try {
            (0, fs_1.rmSync)((0, path_1.join)(dir, stale.runId), { recursive: true, force: true });
        }
        catch {
            // Guarded per dir so one that cannot be removed (permissions, a file
            // still held open) neither aborts the run nor stops the others.
        }
    });
}

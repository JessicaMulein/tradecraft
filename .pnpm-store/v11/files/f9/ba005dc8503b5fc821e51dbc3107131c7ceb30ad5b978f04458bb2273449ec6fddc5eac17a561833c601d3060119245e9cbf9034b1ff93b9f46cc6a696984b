"use strict";
// Internal to run/: deliberately not re-exported from ./index.
Object.defineProperty(exports, "__esModule", { value: true });
exports.nowIso = nowIso;
exports.depsHash = depsHash;
exports.installDepsChangedSinceDispense = installDepsChangedSinceDispense;
exports.recordInstallLanded = recordInstallLanded;
exports.isPidAlive = isPidAlive;
exports.summarizeError = summarizeError;
exports.warnCommitFailed = warnCommitFailed;
exports.pmExecPrefix = pmExecPrefix;
exports.pmInstallCommand = pmInstallCommand;
const crypto_1 = require("crypto");
const package_manager_1 = require("../../../utils/package-manager");
const execute_migration_1 = require("../execute-migration");
const state_lock_1 = require("./state-lock");
const agent_output_1 = require("./agent-output");
function nowIso() {
    return new Date().toISOString();
}
/**
 * Fingerprints the workspace dependencies so a step can persist what they
 * looked like and a later actor can still tell whether the migration changed
 * them. Hashed rather than stored verbatim to keep run.json small; the value
 * is only ever compared for equality.
 *
 * `null` means the probe itself failed. Callers must not read that as
 * "unchanged": the value is persisted and compared across processes, so a
 * failed read on either end would otherwise silently skip an install that was
 * needed.
 */
function depsHash(root) {
    const deps = (0, execute_migration_1.readPackageJsonDeps)(root);
    return deps === null ? null : (0, crypto_1.createHash)('sha256').update(deps).digest('hex');
}
/**
 * Installs when the workspace dependencies differ from the step's recorded
 * baseline, so a prompt applied by another actor, or a retry that only has the
 * commit left to do, still installs what the changes need. Comparing against
 * the persisted baseline is what makes that possible: by the time either runs,
 * the edits are already on disk, so a snapshot taken here would see them as
 * the starting point and never detect a change.
 *
 * The baseline is re-pointed at the current dependencies once the install
 * lands, so the next actor to compare does not install the same change again.
 *
 * Every probe failure installs, on either end of the comparison. A step whose
 * dispense-time probe failed has no baseline, which says the dependencies it
 * started from are unknown rather than unchanged, and skipping there would
 * strand the change with nothing left to detect it.
 */
async function installDepsChangedSinceDispense(root, dir, step, skipInstall, rerunCommand) {
    const current = depsHash(root);
    if (current !== null && current === step.depsHashAtDispense)
        return;
    if (skipInstall) {
        (0, execute_migration_1.logSkippedPostMigrationInstall)(root);
        return;
    }
    await (0, execute_migration_1.runInstall)(root, 'post-migration', rerunCommand);
    recordInstallLanded(root, dir, step.id);
}
/**
 * Records what an install that just landed means for the run: the installing
 * step's dependency baseline moves to what is now on disk, and every step's
 * install-failure mark clears.
 *
 * The baseline has to move, or the next actor to compare (the prompt fold, a
 * retry, the step's own commit) reads the step's own edits as an unapplied
 * change and pays a second full install. The marks clear because the package
 * manager installs the whole workspace package.json, so this install also
 * covers the dependency edits of every earlier step that failed to install its
 * own.
 *
 * A failed probe leaves the baseline alone: an install that runs twice costs
 * time, one that never runs leaves the workspace inconsistent with its
 * package.json.
 *
 * Never throws. It runs inside callers that treat a throw as "the install
 * failed", and the install has already succeeded by then. A run state this
 * cannot read or write is a real problem, but it is reported by the next
 * mandatory write rather than misattributed here, and the only cost of losing
 * this one is a redundant install later.
 */
function recordInstallLanded(root, dir, stepId) {
    const hash = depsHash(root);
    try {
        (0, state_lock_1.updateRunState)(dir, (fresh) => {
            const baselineMoves = fresh.steps.some((s) => s.id === stepId && hash !== null && s.depsHashAtDispense !== hash);
            if (!baselineMoves && !fresh.steps.some((s) => s.installFailed)) {
                return null;
            }
            return {
                ...fresh,
                steps: fresh.steps.map(({ installFailed, ...s }) => s.id === stepId && baselineMoves
                    ? { ...s, depsHashAtDispense: hash }
                    : s),
            };
        });
    }
    catch {
        // See above: the install already succeeded, so a state failure here must
        // not be reported as an install failure.
    }
}
// ESRCH means the process is gone; EPERM means it exists but isn't ours (alive).
function isPidAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (e) {
        return e.code === 'EPERM';
    }
}
// The agent reads this to decide retry-vs-skip, so keep it to the error's
// first line and bound the length rather than dumping a multi-line stack.
function summarizeError(e) {
    const message = e instanceof Error ? e.message : String(e);
    const firstLine = message.split('\n')[0].trim();
    return firstLine.length > 200 ? `${firstLine.slice(0, 197)}...` : firstLine;
}
// The commit helper reports its own failures via the result status and logs
// the details itself; `cause` is set only when the attempt threw instead
// (the pre-commit dependency install), which nothing else has logged.
function warnCommitFailed(name, cause) {
    const causeText = cause === undefined ? '' : ` (${summarizeError(cause)})`;
    (0, agent_output_1.warnToAgent)({
        title: `The commit for ${name} could not be created${causeText}; its changes remain in the working tree for a later commit to absorb.`,
    });
}
const cachedPmCommands = new Map();
// getPackageManagerCommand can shell out to detect a version, so cache the
// result per root.
function pmCommands(root) {
    let commands = cachedPmCommands.get(root);
    if (commands === undefined) {
        commands = (0, package_manager_1.getPackageManagerCommand)((0, package_manager_1.detectPackageManager)(root), root);
        cachedPmCommands.set(root, commands);
    }
    return commands;
}
function pmExecPrefix(root) {
    return pmCommands(root).exec;
}
function pmInstallCommand(root) {
    return pmCommands(root).install;
}

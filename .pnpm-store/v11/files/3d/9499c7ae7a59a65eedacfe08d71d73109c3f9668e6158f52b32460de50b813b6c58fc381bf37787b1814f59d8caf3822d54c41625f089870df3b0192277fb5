"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.commitMigrationIfRequested = commitMigrationIfRequested;
exports.commitCheckpointBeforeMigrations = commitCheckpointBeforeMigrations;
exports.resolveCreateCommits = resolveCreateCommits;
exports.confirmMigrationCommitsOnDefaultBranch = confirmMigrationCommitsOnDefaultBranch;
exports.confirmCommitsOnDefaultBranch = confirmCommitsOnDefaultBranch;
const tslib_1 = require("tslib");
const pc = tslib_1.__importStar(require("picocolors"));
const configuration_1 = require("../../config/configuration");
const command_line_utils_1 = require("../../utils/command-line-utils");
const git_utils_1 = require("../../utils/git-utils");
const logger_1 = require("../../utils/logger");
const output_1 = require("../../utils/output");
const types_1 = require("./agentic/types");
const safe_prompt_1 = require("./safe-prompt");
// `git add -A` captures an orchestrated run's scratch state whenever the
// ignore rule that normally hides it goes missing mid-run (a checkout, a
// .gitignore edit, or the migration's own changes).
const MIGRATE_COMMIT_EXCLUDES = [types_1.MIGRATE_RUNS_RELATIVE_DIR];
/**
 * `pendingMigrations` are listed in the commit body so a `git log -p` reader
 * can see which earlier migrations' diffs this commit absorbed (their own
 * commits failed and `git add -A` picked their working-tree state up too).
 *
 * The default `failureGuidance` describes the classic loop's absorb-and-recap
 * behavior; a caller with no later commit or recap to absorb the diff (the
 * standalone single-migration worker) passes its own.
 */
async function commitMigrationIfRequested(root, migration, shouldCreateCommits, commitPrefix, installDepsIfChanged, pendingMigrations = [], failureGuidance = 'The next successful commit will absorb it and reference this migration in its body; if no later commit lands, the end-of-run output will list this migration so you can commit or revert manually.') {
    if (!shouldCreateCommits)
        return { status: 'disabled' };
    await installDepsIfChanged();
    // Generator may have only touched gitignored paths or the excluded scratch
    // dir, or the prompt half made no change: log neutrally, not as an error.
    // The probe excludes what the commit excludes, else the commit fails empty.
    if (!(0, git_utils_1.hasUncommittedChanges)(root, MIGRATE_COMMIT_EXCLUDES)) {
        logger_1.logger.info(pc.dim(`- No changes to commit for ${migration.name}.`));
        return { status: 'no-changes' };
    }
    const commitMessage = buildCommitMessage(`${commitPrefix}${migration.name}`, pendingMigrations);
    try {
        const sha = (0, git_utils_1.tryCommitChanges)(commitMessage, root, MIGRATE_COMMIT_EXCLUDES);
        if (sha)
            return { status: 'committed', sha };
        // null = commit landed but `git rev-parse HEAD` failed (see
        // `tryCommitChanges`). Degraded-but-correct — log yellow, not red.
        logger_1.logger.info(pc.yellow(`The commit for ${migration.name} was created, but its sha could not be resolved (\`git rev-parse HEAD\` failed transiently). Continuing without recording the sha for this step.`));
        return { status: 'committed', sha: null };
    }
    catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        logger_1.logger.info(pc.red(`Could not create a commit for ${migration.name}:\n${reason}\nThe migration's diff remains in the working tree; inspect with \`git status\` / \`git diff\` to review. ${failureGuidance}`));
        return { status: 'failed', reason };
    }
}
// Migration names come from migrations.json (third-party plugin authored);
// they cannot be trusted to be single-line. Strip CR/LF so a hostile name
// cannot inject body lines or fake `Co-Authored-By:` / similar trailers.
function sanitizeMigrationLine(value) {
    return value.replace(/[\r\n]+/g, ' ').trim();
}
function buildCommitMessage(subject, pendingMigrations) {
    if (pendingMigrations.length === 0)
        return subject;
    // Two newlines separate the subject from the body per the
    // conventional-commits convention.
    const lines = [
        subject,
        '',
        'Includes changes from prior migrations whose own commits failed:',
        ...pendingMigrations.map((p) => `  - ${sanitizeMigrationLine(p.package)}: ${sanitizeMigrationLine(p.name)}`),
    ];
    return lines.join('\n');
}
/**
 * Commits any pre-existing working-tree state into a dedicated "checkpoint"
 * commit before the first migration runs. Without this, the first migration's
 * commit would absorb whatever was already pending — most commonly the
 * package.json edit `nx migrate latest` produces and the lockfile churn from
 * the orchestrator's `npm install --ignore-scripts` step — and migration 1's
 * validation would see that mixed in with the generator output. No-op when
 * the working tree is already clean.
 */
function commitCheckpointBeforeMigrations(root, commitPrefix) {
    if (!(0, git_utils_1.hasUncommittedChanges)(root, MIGRATE_COMMIT_EXCLUDES))
        return;
    try {
        const sha = (0, git_utils_1.tryCommitChanges)(`${commitPrefix}checkpoint before running migrations`, root, MIGRATE_COMMIT_EXCLUDES);
        if (sha) {
            logger_1.logger.info(pc.dim(`- Checkpoint commit created: ${sha}`));
            return;
        }
        // null = commit landed but `git rev-parse HEAD` failed (see
        // `tryCommitChanges`). State is captured, just unanchored.
        output_1.output.warn({
            title: 'Could not resolve checkpoint commit sha',
            bodyLines: [
                'The checkpoint commit was created, but its sha could not be resolved (`git rev-parse HEAD` failed transiently).',
            ],
        });
    }
    catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        output_1.output.warn({
            title: 'Could not create checkpoint commit before migrations',
            bodyLines: [
                reason,
                `Migration 1's commit will absorb any pre-existing working-tree state.`,
            ],
        });
    }
}
/**
 * `agenticHasDiffContext` gates the agent prompt: without per-migration commits
 * to isolate a migration's diff, the prompt embeds a file list instead of
 * pointing at git.
 */
function resolveCreateCommits(args) {
    const { createCommits, mode, isGitRepo, commitPrefixIsCustom } = args;
    // The orchestrator forces the agentic defaults without the `--agentic` flag,
    // so its warnings must not name a flag the user never passed.
    const orchestrated = mode === 'orchestrated';
    const agenticKind = orchestrated ? 'enabled' : mode;
    if (createCommits === true && !isGitRepo) {
        return {
            effective: false,
            agenticHasDiffContext: false,
            error: '`--create-commits` requires a git repository. Run `git init` first, or omit the flag.',
        };
    }
    if (agenticKind === 'enabled') {
        if (createCommits === false) {
            return {
                effective: false,
                agenticHasDiffContext: false,
                warning: (orchestrated
                    ? "--no-create-commits was passed, but orchestrated migrate runs create per-migration commits by default. Without them, the agent can't isolate the current migration's changes from earlier migrations in this run. Drop --no-create-commits for accurate per-migration review."
                    : "--no-create-commits was passed alongside --agentic. Without per-migration commits, the agent can't isolate the current migration's changes from earlier migrations in this run. Drop --no-create-commits for accurate per-migration review.") +
                    (commitPrefixIsCustom
                        ? ' Note: the custom --commit-prefix value will have no effect because commits are disabled.'
                        : ''),
            };
        }
        // Not an error like the explicit `--create-commits` branch above: the
        // agentic default was never asked for, so degrade instead.
        if (!isGitRepo) {
            return {
                effective: false,
                agenticHasDiffContext: false,
                warning: (orchestrated
                    ? 'Orchestrated migrate runs create per-migration commits by default, but the workspace is not a git repository. Continuing without commits, so the agent will not receive per-file diff context. Run `git init` to enable.'
                    : '`--agentic` enables per-migration commits by default, but the workspace is not a git repository. Continuing without commits, so the agent will not receive per-file diff context. Run `git init` to enable.') +
                    (commitPrefixIsCustom
                        ? ' The custom --commit-prefix value will have no effect.'
                        : ''),
            };
        }
        return { effective: true, agenticHasDiffContext: true };
    }
    return {
        effective: createCommits === true,
        agenticHasDiffContext: false,
        warning: commitPrefixIsCustom && createCommits !== true
            ? 'A custom migrate commit prefix is configured, but commits are not enabled for this run, so it has no effect. Set `migrate.createCommits` to `true` (or pass `--create-commits`) to create a commit per migration.'
            : undefined,
    };
}
// The branch to hold `getBaseRef`'s value against. It may name a remote-tracking
// ref whose local counterpart drops the remote (the CI-workflow generator writes
// `origin/<branch>`), yet a local branch can be named `up/feature` while `up` is
// a remote, so an exact match wins before any stripping and the longest matching
// remote wins after. `origin` counts even undeclared: the generator assumes it.
function defaultBranchToCompare(baseRef, currentBranch, root) {
    if (currentBranch === baseRef) {
        return baseRef;
    }
    const remote = [...(0, git_utils_1.getGitRemoteNames)(root), 'origin']
        .filter((name) => baseRef.startsWith(`${name}/`))
        .sort((a, b) => b.length - a.length)[0];
    return remote ? baseRef.slice(remote.length + 1) : baseRef;
}
/**
 * Asks before a run starts committing on the workspace's default branch, and
 * reports the decision when the answer is no. Returns whether to proceed.
 *
 * Callers gate this on commits being effective and on prompting being
 * possible, so non-interactive runs (CI, `--no-interactive`) never reach here;
 * `confirmCommitsOnDefaultBranch` has no guard of its own and would block on a
 * prompt nobody can answer.
 */
async function confirmMigrationCommitsOnDefaultBranch(root, whatWouldRun) {
    const currentBranch = (0, git_utils_1.getGitCurrentBranch)(root);
    const proceed = await confirmCommitsOnDefaultBranch({
        currentBranch,
        defaultBranch: defaultBranchToCompare((0, command_line_utils_1.getBaseRef)((0, configuration_1.readNxJson)(root)), currentBranch, root),
    });
    if (!proceed) {
        output_1.output.log({
            title: `Skipped ${whatWouldRun} to avoid committing to the default branch '${currentBranch}'.`,
            bodyLines: [
                'Switch to a different branch and re-run, or re-run and confirm to proceed.',
            ],
        });
    }
    return proceed;
}
async function confirmCommitsOnDefaultBranch(args) {
    const { currentBranch, defaultBranch } = args;
    if (!currentBranch || !defaultBranch || currentBranch !== defaultBranch) {
        return true;
    }
    return (0, safe_prompt_1.migrateConfirm)({
        message: `You're on the default branch '${currentBranch}'. nx migrate will create a commit for each migration on this branch. Continue?`,
        initial: false,
    });
}

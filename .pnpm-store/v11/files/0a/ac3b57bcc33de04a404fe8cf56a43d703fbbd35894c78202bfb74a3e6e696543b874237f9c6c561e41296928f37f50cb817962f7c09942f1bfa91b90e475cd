"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyAgenticHandoffGitignoreFallback = applyAgenticHandoffGitignoreFallback;
const tslib_1 = require("tslib");
const semver_1 = require("semver");
const pc = tslib_1.__importStar(require("picocolors"));
const add_migrate_runs_to_git_ignore_1 = tslib_1.__importDefault(require("../../../migrations/update-23-0-0/add-migrate-runs-to-git-ignore"));
const tree_1 = require("../../../generators/tree");
const git_utils_1 = require("../../../utils/git-utils");
const logger_1 = require("../../../utils/logger");
const types_1 = require("./types");
/**
 * Both the agentic runner and the orchestrator write per-run scratch under
 * `.nx/migrate-runs/<run-id>/`: handoff files in both cases, plus the durable
 * run state and its plan snapshots for the orchestrator. The v23 migration
 * `23-0-0-add-migrate-runs-to-git-ignore` adds `.nx/migrate-runs` to
 * `.gitignore`; in its declared slot (typically late) earlier per-migration
 * commits would absorb the scratch into the user-visible diff.
 *
 * Two paths cover the leak, with no overlap:
 *
 *   1. HOIST: `sortMigrations`, which `executeMigrations` applies, sorts the
 *      v23 migration to position 0 when it is in the queue, so it runs first
 *      through the normal runner with its own log line and commit. A
 *      single-migration worker run needs no hoisting: the requested migration
 *      is the entire queue.
 *
 *   2. INLINE FALLBACK, this function. When the migration is NOT in the queue
 *      AND the highest target version is < v23 (intra-pre-v23 `--agentic`
 *      run) it will never run, so apply its body inline against an `FsTree`
 *      and commit it as a standalone preflight commit (or leave it in the
 *      working tree under `--no-create-commits`).
 *
 * Not in the queue AND target >= v23 means the user is already past v23. They
 * had the entry historically; if it is gone, that is a conscious removal we
 * respect.
 */
async function applyAgenticHandoffGitignoreFallback({ migrations, installedNxVersion, effectiveCreateCommits, commitPrefix, root, applyWhenPlanned = false, commitStandalone = true, }) {
    if (migrations.some(types_1.isHandoffGitignoreMigration)) {
        if (!applyWhenPlanned) {
            // The queue runs it itself: hoisted to the front by the sort comparator
            // in a full run, or as the single requested migration in a worker run.
            return;
        }
    }
    else if ((0, semver_1.major)(installedNxVersion) >= 23) {
        // User is past v23. Respect their `.gitignore` state — if the entry
        // is missing, that's a conscious removal.
        return;
    }
    const tree = new tree_1.FsTree(root, false);
    await (0, add_migrate_runs_to_git_ignore_1.default)(tree);
    const changes = tree.listChanges();
    if (changes.length === 0) {
        // Migration body short-circuited (no `.gitignore`, Lerna without nx.json,
        // or the entry is already covered by an existing pattern).
        return;
    }
    (0, tree_1.flushChanges)(root, changes);
    logger_1.logger.info(pc.dim(`- Added ${types_1.MIGRATE_RUNS_RELATIVE_DIR} to .gitignore so this run's scratch state is ignored.`));
    if (!effectiveCreateCommits || !commitStandalone)
        return;
    if (!(0, git_utils_1.hasUncommittedChanges)(root))
        return;
    try {
        const sha = (0, git_utils_1.tryCommitChanges)(`${commitPrefix}add ${types_1.MIGRATE_RUNS_RELATIVE_DIR} to .gitignore`, root, [types_1.MIGRATE_RUNS_RELATIVE_DIR]);
        if (sha) {
            logger_1.logger.info(pc.dim(`  Commit: ${sha}`));
        }
        // `null` return = commit landed but `git rev-parse HEAD` raced. The
        // diff cleared from the working tree; nothing more to say.
    }
    catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        logger_1.logger.info(pc.yellow(`Could not create the agentic preflight commit:\n${reason}\n` +
            `The .gitignore change remains in the working tree; commit it manually or it will be absorbed into the first per-migration commit.`));
    }
}

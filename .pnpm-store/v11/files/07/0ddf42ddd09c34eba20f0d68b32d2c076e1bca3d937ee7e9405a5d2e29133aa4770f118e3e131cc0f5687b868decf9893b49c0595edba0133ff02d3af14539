"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HANDOFFS_DIR_NAME = exports.MIGRATE_RUNS_RELATIVE_DIR = void 0;
exports.isHandoffGitignoreMigration = isHandoffGitignoreMigration;
/**
 * Workspace-relative directory holding all migrate-run scratch: a run
 * directory per run id. Shared by the run-dir layout in `handoff.ts` and the
 * agent permission rules in `definitions.ts` so the pre-authorized write scope
 * can't drift from the actual layout. It lives here so `definitions.ts`,
 * loaded whenever the agentic flow is resolved, doesn't pull in the handoff
 * runtime for the path alone.
 */
exports.MIGRATE_RUNS_RELATIVE_DIR = '.nx/migrate-runs';
/**
 * The one subtree of a run directory an agent writes: its handoff files.
 * Everything beside it is state Nx owns and reads back, the orchestrator's
 * run state and plan snapshots included, so the pre-authorized write scope
 * stops at this segment. Package names make up the rest of a handoff path,
 * so without it they would occupy the run directory's top level and leave Nx
 * no name it could add there safely.
 */
exports.HANDOFFS_DIR_NAME = 'handoffs';
/**
 * Composite identity of the v23 migration that adds `.nx/migrate-runs` to
 * `.gitignore`. Hard-coded because the agentic preflight is a deliberate
 * one-off coupling: this exact migration owns the entry that keeps
 * `.nx/migrate-runs/<run-id>/...` scratch out of per-migration commits. If
 * the migration is ever renamed, this entry must move with it. It lives here
 * rather than in `handoff-gitignore.ts` so `sortMigrations`' hoist check
 * doesn't load that module's migration-execution machinery.
 */
const HANDOFF_GITIGNORE_MIGRATION_PACKAGE = 'nx';
const HANDOFF_GITIGNORE_MIGRATION_NAME = '23-0-0-add-migrate-runs-to-git-ignore';
function isHandoffGitignoreMigration(m) {
    return (m.package === HANDOFF_GITIGNORE_MIGRATION_PACKAGE &&
        m.name === HANDOFF_GITIGNORE_MIGRATION_NAME);
}

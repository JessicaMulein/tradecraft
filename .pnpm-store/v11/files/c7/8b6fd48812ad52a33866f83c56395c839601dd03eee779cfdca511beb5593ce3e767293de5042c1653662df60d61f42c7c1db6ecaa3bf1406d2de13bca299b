interface SortableMigration {
    package: string;
    name: string;
    version: string;
}
/**
 * Sorts in place (like `Array.prototype.sort`) and returns the same array.
 *
 * `hoistHandoffGitignore` is set for agentic runs, which write scratch under
 * `.nx/migrate-runs`; see `agentic/handoff-gitignore.ts` for why the v23
 * gitignore migration must run first there.
 */
export declare function sortMigrations<T extends SortableMigration>(migrations: T[], opts: {
    hoistHandoffGitignore: boolean;
}): T[];
export {};

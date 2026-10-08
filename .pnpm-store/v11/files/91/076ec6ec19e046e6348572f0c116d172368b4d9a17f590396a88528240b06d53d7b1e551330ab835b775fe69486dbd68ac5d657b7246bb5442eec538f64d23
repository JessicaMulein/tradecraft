/**
 * Roots of the git linked worktrees that live inside `workspaceRoot`,
 * relative to it and separator-normalized.
 *
 * Reads git's own registry rather than probing the workspace, so it costs one
 * `readdir` plus a small file per worktree. Worktrees outside the workspace
 * are dropped - nothing walks them. Submodules use the same gitfile mechanism
 * but register under `<git-dir>/modules`, so they never appear here.
 */
export declare function nestedWorktreeRoots(workspaceRoot: string): string[];
/**
 * Whether `path` sits inside `root`, comparing whole path segments so that
 * `wt-other` is not read as living inside `wt`.
 */
export declare function isInside(path: string, root: string): boolean;
/** Advice for duplicate project names that come from nested git worktrees. */
export interface WorktreeConflictAdvice {
    /** Paths to add to `.gitignore`. */
    ignoreTargets: string[];
    /**
     * Whether ignoring them settles every duplicate. When false the caller still
     * owes the reader the ordinary advice for the ones left over.
     */
    explainsAllConflicts: boolean;
}
/**
 * What to tell someone whose duplicate project names come from git worktrees
 * nested in the workspace, or null when none of them do.
 */
export declare function analyzeWorktreeConflicts(workspaceRoot: string, conflicts: Map<string, string[]>): WorktreeConflictAdvice | null;

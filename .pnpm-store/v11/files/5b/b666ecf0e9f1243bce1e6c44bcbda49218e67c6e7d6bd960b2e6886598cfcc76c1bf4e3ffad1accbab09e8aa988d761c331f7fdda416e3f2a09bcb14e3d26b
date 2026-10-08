/**
 * Digest of the client-controlled portion of the daemon env: the vars
 * `getDaemonEnv` would send, minus the required settings the daemon pins
 * itself. Skipping those yields the same digest whether the process is a
 * daemon plugin worker (which has them set) or a daemonless one (which
 * typically does not).
 */
export declare function hashDaemonClientEnv(): string;
export declare function getDaemonEnv(): NodeJS.ProcessEnv & {
    NX_PROJECT_GLOB_CACHE: string;
    NX_CACHE_PROJECTS_CONFIG: string;
};
/**
 * Count of client env applications that changed at least one variable, in
 * `process.env` or against the previously applied client env. Digest equality
 * alone cannot guard a cache write: an env that changed and changed back
 * mid-pass yields the pass-start digest again, while the count still moves.
 */
export declare function getDaemonClientEnvGeneration(): number;
/**
 * Env for spawning the daemon process. On top of the reflected env, it must
 * keep excluded vars the daemon needs to start correctly:
 * - ELECTRON_RUN_AS_NODE (matched by the ELECTRON_ prefix exclusion): when
 *   the spawning client runs inside an Electron host, process.execPath is
 *   the Electron binary and only this var makes it run the daemon's Node
 *   entry point.
 * - NX_WORKSPACE_ROOT_PATH: the daemon resolves its workspace root at
 *   startup by walking up from cwd looking for workspace markers; without
 *   the pin, a root without markers under an ancestor that has them
 *   resolves to the ancestor and the daemon publishes its socket under the
 *   wrong workspace.
 * - NX_MAX_MESSAGE_SIZE: excluded from reflection (see above), so the value
 *   here holds for the daemon's whole lifetime. Changing it therefore needs a
 *   daemon restart (`nx reset`).
 */
export declare function getDaemonSpawnEnv(): NodeJS.ProcessEnv & {
    NX_PROJECT_GLOB_CACHE: string;
    NX_CACHE_PROJECTS_CONFIG: string;
};
/**
 * A copy of the env the last `applyDaemonEnvFromClient` call applied, with a
 * sequence that advances on every call, or `undefined` before the first. For a
 * caller that let code it ran (a user config, say) write over `process.env`
 * and has to put the client's env back: the generation cannot tell it an apply
 * happened, since an apply whose values the config had already written changes
 * nothing.
 */
export declare function getAppliedDaemonClientEnv(): {
    sequence: number;
    env: NodeJS.ProcessEnv;
} | undefined;
/**
 * Without the deletion step, a var set by one client (e.g.
 * `NX_PREFER_NODE_STRIP_TYPES=true` or `JAVA_TOOL_OPTIONS=...` for a single
 * command) would persist in the daemon and leak into every subsequent
 * client's project-graph computation. Deletion skips excluded vars and
 * required settings, which the daemon owns and clients should not control.
 *
 * The returned keys are those `process.env` moved on plus those the client's
 * env moved on since the last applied one: a value a config wrote mid-load can
 * already match what the next client sends, and the graph computed under the
 * previous client is stale all the same.
 */
export declare function applyDaemonEnvFromClient(newEnv: NodeJS.ProcessEnv): string[];
/**
 * Yarn Berry creates a fresh BERRY_BIN_FOLDER for every invocation and puts it
 * first on PATH. The wrappers inside are runtime state the daemon and workers
 * must receive, but the folder's random name is not project-graph identity:
 * two invocations whose environments differ only by it would compute the same
 * graph. Strips the folder from PATH and pins the var to a sentinel so such
 * environments compare equal. Returns a copy; never mutates runtime env.
 */
export declare function normalizeDaemonEnvironmentForGraph(env: NodeJS.ProcessEnv, platform?: NodeJS.Platform): NodeJS.ProcessEnv;
export declare function getChangedEnvKeys(before: NodeJS.ProcessEnv, after: NodeJS.ProcessEnv): string[];

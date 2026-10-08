import { type MigrateRunState } from './run-state';
/**
 * Runs `fn` while holding the run's state lock, releasing it afterwards even
 * if `fn` throws. writeRunState's tmp+rename gives per-write atomicity, but a
 * writer that reads state, applies an event, then writes still races a second
 * nx migrate process that read the same state first; this lock serializes
 * those sequences so the event always applies to the freshest on-disk state.
 */
export declare function withRunStateLock<T>(runDirPath: string, fn: () => T): T;
/**
 * Serializes active-run discovery and run creation across nx migrate
 * processes. Two concurrent inits could otherwise both observe "no active
 * run" and create competing runs against the same workspace; the per-run
 * state lock cannot cover that window because the run directory does not
 * exist yet. Callers must redo their active-run check inside `fn`: a check
 * done before acquiring the lock may predate a concurrent creation.
 */
export declare function withRunCreationLock<T>(root: string, fn: () => T): T;
/**
 * Reads the run state fresh under the lock, hands it to `apply`, and writes the
 * result back. `apply` returning null means "no change" and skips the write.
 * `apply` must be pure and synchronous; a corrupt or newer-format run.json
 * propagates from the read.
 */
export declare function updateRunState(runDirPath: string, apply: (fresh: MigrateRunState) => MigrateRunState | null): MigrateRunState;

"use strict";
// Cross-process mutual exclusion for the migrate run flow, built on the
// native flock-based FileLock (the same primitive the project graph uses to
// serialize nx processes): acquisition blocks until the holder releases, and
// the kernel releases a dead holder's lock automatically, so there is no
// stale-lock state to detect or clean up. Under WASM the native lock is
// unavailable and sections run unserialized, matching the project graph's
// IS_WASM guard for this lock. Not part of run/'s public surface (not
// re-exported via ./index): import directly within run/.
//
// Locked sections must stay synchronous. lock() blocks the whole thread, so
// if a holder parked on an await while a second in-process caller reached
// lock(), the holder's continuation could never run to release it. Git and
// child-process side effects belong outside the lock for the same reason.
Object.defineProperty(exports, "__esModule", { value: true });
exports.withRunStateLock = withRunStateLock;
exports.withRunCreationLock = withRunCreationLock;
exports.updateRunState = updateRunState;
const fs_1 = require("fs");
const path_1 = require("path");
const native_1 = require("../../../native");
const run_state_1 = require("./run-state");
const STATE_LOCK_FILE_NAME = 'run.json.lock';
const CREATION_LOCK_FILE_NAME = 'init.lock';
function withFileLock(lockPath, fn) {
    if (native_1.IS_WASM) {
        return fn();
    }
    const lock = new native_1.FileLock(lockPath);
    lock.lock();
    try {
        return fn();
    }
    finally {
        lock.unlock();
    }
}
/**
 * Runs `fn` while holding the run's state lock, releasing it afterwards even
 * if `fn` throws. writeRunState's tmp+rename gives per-write atomicity, but a
 * writer that reads state, applies an event, then writes still races a second
 * nx migrate process that read the same state first; this lock serializes
 * those sequences so the event always applies to the freshest on-disk state.
 */
function withRunStateLock(runDirPath, fn) {
    return withFileLock((0, path_1.join)(runDirPath, STATE_LOCK_FILE_NAME), fn);
}
/**
 * Serializes active-run discovery and run creation across nx migrate
 * processes. Two concurrent inits could otherwise both observe "no active
 * run" and create competing runs against the same workspace; the per-run
 * state lock cannot cover that window because the run directory does not
 * exist yet. Callers must redo their active-run check inside `fn`: a check
 * done before acquiring the lock may predate a concurrent creation.
 */
function withRunCreationLock(root, fn) {
    const dir = (0, run_state_1.migrateRunsDir)(root);
    (0, fs_1.mkdirSync)(dir, { recursive: true });
    return withFileLock((0, path_1.join)(dir, CREATION_LOCK_FILE_NAME), fn);
}
/**
 * Reads the run state fresh under the lock, hands it to `apply`, and writes the
 * result back. `apply` returning null means "no change" and skips the write.
 * `apply` must be pure and synchronous; a corrupt or newer-format run.json
 * propagates from the read.
 */
function updateRunState(runDirPath, apply) {
    return withRunStateLock(runDirPath, () => {
        const fresh = (0, run_state_1.readRunState)(runDirPath);
        const next = apply(fresh);
        if (next === null)
            return fresh;
        (0, run_state_1.writeRunState)(runDirPath, next);
        return next;
    });
}

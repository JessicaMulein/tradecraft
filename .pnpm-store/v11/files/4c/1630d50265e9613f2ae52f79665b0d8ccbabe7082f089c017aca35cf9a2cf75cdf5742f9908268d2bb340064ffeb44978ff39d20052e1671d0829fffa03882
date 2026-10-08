import { HandoffFile } from './types';
/** Returns the run directory for a given workspace + run id (target version). */
export declare function runDirPath(workspaceRoot: string, runId: string): string;
/** The version-derived run id: the highest target version in the plan. */
export declare function resolveAgenticRunId(migrations: ReadonlyArray<{
    version: string;
}>): string;
/**
 * `mkdir -p` with a contextual error wrapper. Without this, the raw
 * ENOSPC/EACCES/EROFS surfaces with no indication of which directory the
 * migrate orchestrator was trying to create.
 */
export declare function mkdirSafely(dir: string, purpose: string): void;
/**
 * Wipes any prior contents for this run id and recreates an empty directory.
 *
 * Scope of the wipe is intentionally narrow (only `<run-id>/`) so that handoff
 * artifacts from prior runs targeting different versions remain on disk for
 * inspection.
 */
export declare function initRunDir(workspaceRoot: string, runId: string): string;
/**
 * Absolute path of the handoff file for a migration step within a run, under
 * the run directory's `handoffs/` subtree: the pre-authorized write scope
 * stops there, so a handoff placed anywhere else costs an approval prompt.
 * The package's scope (if any) becomes a real subdirectory so the package name
 * stays readable; two packages can ship a migration with the same name without
 * colliding because they land in different package subdirectories. Each
 * segment is sanitized so the path is always writable on every platform.
 */
export declare function stepHandoffPath(runDir: string, migration: {
    package: string;
    name: string;
}): string;
export type HandoffReadFailureReason = 'missing' | 'read-error' | 'parse-error' | 'shape-mismatch';
export type HandoffReadResult = {
    ok: true;
    handoff: HandoffFile;
} | {
    ok: false;
    reason: HandoffReadFailureReason;
    detail?: string;
};
/**
 * Reads and validates a handoff file written by an agent. Returns a tagged
 * result so callers (the in-loop poller and the post-exit resolver) can
 * distinguish "file not yet written" from "file written but garbage" — the
 * latter is surfaced to the user instead of being collapsed into the same
 * generic ambiguous-outcome prompt.
 */
export declare function readHandoffWithReason(filePath: string): HandoffReadResult;
/**
 * Convenience wrapper preserving the original null-on-any-failure contract.
 * Used by the polling loop (`waitForValidHandoff`) where every failure mode
 * is "keep waiting" — the file may be missing, mid-write, or being rewritten.
 */
export declare function readHandoff(filePath: string): HandoffFile | null;
/**
 * Polls for a valid handoff file. Resolves once `readHandoff` accepts the
 * file's contents. Used to detect when the agent has finished its work so the
 * orchestrator can close the agent's session without depending on the agent
 * exiting on its own.
 *
 * Rejects with the abort reason when `options.signal` is aborted.
 */
export declare function waitForValidHandoff(handoffFilePath: string, options?: {
    intervalMs?: number;
    signal?: AbortSignal;
}): Promise<void>;

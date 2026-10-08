import type { MigrateStep } from './run-state';
export declare function nowIso(): string;
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
export declare function depsHash(root: string): string | null;
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
export declare function installDepsChangedSinceDispense(root: string, dir: string, step: MigrateStep, skipInstall: boolean, rerunCommand?: string): Promise<void>;
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
export declare function recordInstallLanded(root: string, dir: string, stepId: string): void;
export declare function isPidAlive(pid: number): boolean;
export declare function summarizeError(e: unknown): string;
export declare function warnCommitFailed(name: string, cause?: unknown): void;
export declare function pmExecPrefix(root: string): string;
export declare function pmInstallCommand(root: string): string;

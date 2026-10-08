import type { ProjectGraph } from '../../config/project-graph';
import { type WatchEvent } from '../../native';
export interface DotEnvChangeClassification {
    invalidating: string[];
    unclassified: WatchEvent[];
}
/**
 * Splits the change events into `invalidating`: the paths with the dotenv name
 * shape getEnvPathsForTask loads (`.env[.<id>]` / `.<id>.env` variants), under
 * the workspace root or a project root, whose content actually changed; and
 * `unclassified`: the dotenv-shaped events under no known root. The
 * invalidating names are a superset of what any task loads: target and
 * configuration names are unknown here, so `.env.staging` is reported whether
 * or not a task loads it. The daemon uses this to refresh its graph cache so
 * createNodes re-resolves config that reads process.env.
 *
 * Only the workspace root and project roots invalidate: getEnvPathsForTask
 * loads dotenv files from those, never from an arbitrary subdirectory (e.g. one
 * under node_modules), and the outputs watcher spans the whole workspace root.
 * An unclassified event is not necessarily irrelevant, though: the graph it was
 * classified against can predate the file's project root (none is committed
 * during the initial computation, and a replaced graph lacks a project that
 * computation is adding), so the caller queues it for replay against the next
 * graph a computation is about to serve rather than dropping it.
 *
 * Known limitation: a `.nxignore`d dotenv file never reaches this watcher (the
 * native watcher applies `.nxignore` even with `use_ignore: false`), so a warm
 * edit of one does not invalidate the graph. The cold path still resolves it:
 * getGraphTimeDotEnvForTask reads dotenv from disk directly.
 */
export declare function classifyDotEnvChanges(changeEvents: WatchEvent[], projectGraph: ProjectGraph | undefined): DotEnvChangeClassification;
/**
 * `generation` is the recomputation generation current at queue time; the
 * drain compares it against the serving computation's generation to prove
 * whether that computation started before the event arrived.
 */
export declare function queuePendingDotEnvEvents(paths: string[], generation: number): void;
/**
 * Takes and clears the queued unclassified events, returning the paths that
 * are dotenv files under a root of `projectGraph` and were queued at or after
 * `sinceGeneration` (the serving computation's generation). A path queued
 * earlier is dropped safely: the computation claimed its generation after the
 * event was queued, so it read the file after the edit landed. Content hashes
 * are neither consulted nor recorded here, and any hash recorded for a
 * drained path is dropped: a hash taken mid-computation is not proof any
 * served graph observed those bytes (the computation may read intermediate
 * content), so suppressing a later event on it could leave the graph stale.
 * `overflowed` means events were lost at or after `sinceGeneration`, so the
 * caller cannot prove its graph fresh and must invalidate; an overflow
 * recorded earlier is dropped by the same rule as a queued entry. A relevant
 * overflow also drops every recorded hash: with events lost, a retained hash
 * (even for a path that invalidated directly and never entered the queue)
 * could suppress a later event over intermediate bytes read by the successor
 * this drain forces. That successor is already being forced, so clearing
 * adds no recomputation.
 *
 * A stamp records callback time, not edit time, so an event whose edit a
 * workspace-watcher-triggered computation already observed can still
 * invalidate it: one redundant recompute, accepted because the callback
 * cannot prove which side of that computation's file read the edit landed on.
 */
export declare function drainPendingDotEnvEvents(projectGraph: ProjectGraph | undefined, sinceGeneration: number): {
    invalidating: string[];
    overflowed: boolean;
};
/**
 * Whether the queue holds evidence that a computation at `sinceGeneration`
 * may have read a dotenv file before a reported edit landed: an entry or an
 * overflow stamped at or after that generation. Consumes nothing and
 * classifies against no roots: the error paths use this to decide on a retry,
 * where there may be no graph to classify against, and a spurious retry costs
 * one recompute on an already failing path. A persistent error retries once,
 * because the retry's successor claims a generation above every stamp
 * recorded so far.
 */
export declare function hasPendingDotEnvEvidence(sinceGeneration: number): boolean;
/**
 * Like hasPendingDotEnvEvidence, but classifies each entry against the roots
 * of `projectGraph`: evidence is an overflow stamped at or after
 * `sinceGeneration`, or an entry so stamped whose path is a dotenv file under
 * one of the graph's roots. The warm-reuse check uses this, where the graph
 * the cache serves exists and is exactly what a recompute would refresh;
 * skipping paths under none of its roots avoids recomputing for events only
 * a future graph could classify, and consuming nothing leaves those entries
 * queued for that computation's drain.
 */
export declare function hasRelevantPendingDotEnvEvidence(projectGraph: ProjectGraph | undefined, sinceGeneration: number): boolean;
/**
 * Drops every recorded content hash. Each computation clears on claiming its
 * generation, bounding every hash to the window since the last claim: an
 * older hash is not proof the graph a successor serves observed those bytes,
 * and kept, it could suppress a callback that lands while the successor
 * reads. The error-path retry and the warm-reuse check also clear when they
 * force a successor while preserving the queue for its drain.
 */
export declare function clearDotEnvFileHashes(): void;
export declare function _resetPendingDotEnvEvents(): void;

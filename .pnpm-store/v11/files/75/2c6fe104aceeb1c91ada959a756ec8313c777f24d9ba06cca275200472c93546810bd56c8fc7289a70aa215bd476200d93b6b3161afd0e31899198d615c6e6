"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.currentSourceMaps = exports.currentProjectGraph = exports.currentProjectFileMapCache = exports.fileMapWithFiles = void 0;
exports.getCachedSerializedProjectGraphPromise = getCachedSerializedProjectGraphPromise;
exports.scheduleProjectGraphRecomputation = scheduleProjectGraphRecomputation;
exports.registerProjectGraphRecomputationListener = registerProjectGraphRecomputationListener;
exports.invalidateGraphCache = invalidateGraphCache;
exports.getRecomputationGeneration = getRecomputationGeneration;
exports.isKnownWorkspaceFile = isKnownWorkspaceFile;
const perf_hooks_1 = require("perf_hooks");
const nx_json_1 = require("../../config/nx-json");
const file_hasher_1 = require("../../hasher/file-hasher");
const build_project_graph_1 = require("../../project-graph/build-project-graph");
const error_types_1 = require("../../project-graph/error-types");
const file_map_utils_1 = require("../../project-graph/file-map-utils");
const nx_deps_cache_1 = require("../../project-graph/nx-deps-cache");
const get_plugins_1 = require("../../project-graph/plugins/get-plugins");
const retrieve_workspace_files_1 = require("../../project-graph/utils/retrieve-workspace-files");
const fileutils_1 = require("../../utils/fileutils");
const workspace_context_1 = require("../../utils/workspace-context");
const workspace_root_1 = require("../../utils/workspace-root");
const progress_topics_1 = require("../../utils/progress-topics");
const client_socket_context_1 = require("./client-socket-context");
const dotenv_graph_changes_1 = require("./dotenv-graph-changes");
const file_change_events_1 = require("./file-watching/file-change-events");
const file_watcher_sockets_1 = require("./file-watching/file-watcher-sockets");
const project_graph_listener_sockets_1 = require("./project-graph-listener-sockets");
const watcher_1 = require("./watcher");
const logger_1 = require("../logger");
let cachedSerializedProjectGraphPromise;
// Maps file path to a version counter that increments on each modification.
// This lets us detect mid-flight re-modifications when clearing processed files.
const collectedUpdatedFiles = new Map();
const collectedDeletedFiles = new Map();
const projectGraphRecomputationListeners = new Set();
let storedWorkspaceConfigHash;
let knownExternalNodes = {};
let fileChangeCounter = 0;
let recomputationGeneration = 0;
// The graph the settled cached promise serves, with the generation its
// computation claimed. Set only when a computation's own success becomes the
// cached result; any newer kickoff or invalidation clears it, so non-null
// means the cached promise is settled and this is exactly what it serves. The
// warm-reuse dotenv check classifies against this, never against
// `currentProjectGraph`: a slow stale computation overwrites that after the
// winner settles and only then chains away. The candidate is written by the
// computation itself (which knows its generation) and promoted by
// kickOffRecompute after the outer plugin-hash and cached-pointer identity
// checks, which can still reject the result.
let servedGraphState = null;
let servedGraphCandidate = null;
// True after the first successful persistProjectGraphToDisk call. Until
// that happens, "project-graph.json missing on disk" is the expected
// state (we just haven't written it yet) and must not trigger a reset.
let cacheHasBeenPersisted = false;
/**
 * Freshness-gated recompute. Each IIFE snapshots the nx.json `plugins`
 * hash at kickoff and re-reads at commit; if it changed mid-flight, bail
 * and kick a successor instead of clobbering the winner. Without this,
 * `cachedSerializedProjectGraphPromise` is last-kickoff-wins and can
 * return a graph built against a stale plugin set
 * (see spread.test.ts "middle plugin" flake).
 */
function kickOffRecompute() {
    // The cached pointer is about to hold an unsettled promise, so whatever the
    // previous state described is no longer what the cache serves.
    servedGraphState = null;
    let myPromise;
    myPromise = (async () => {
        // Must resolve, never reject: kickOffRecompute() runs fire-and-forget, so
        // a rejected myPromise crashes the daemon (unhandled rejection). A throwing
        // prologue (e.g. plugin load fails) becomes an errorResult the next requester surfaces.
        try {
            // Single read shared with getPluginsSeparated below. This collapses
            // what would otherwise be two independent nx.json reads (our snap +
            // the plugin loader's) into one, so the snap hash and the plugin
            // set the compute uses always reflect the same disk state.
            const nxJson = (0, nx_json_1.readNxJson)(workspace_root_1.workspaceRoot);
            const myPluginsHash = (0, file_hasher_1.hashObject)(nxJson.plugins ?? []);
            const plugins = await (0, get_plugins_1.getPluginsSeparated)(nxJson, workspace_root_1.workspaceRoot);
            // Plugin set we just loaded may already be stale vs disk.
            if (isStale(myPluginsHash))
                return chainToSuccessor(myPromise);
            const result = await processFilesAndCreateAndSerializeProjectGraph(plugins);
            // Compute may have run against plugins that are now stale.
            if (isStale(myPluginsHash))
                return chainToSuccessor(myPromise);
            if (cachedSerializedProjectGraphPromise === myPromise &&
                result.projectGraph) {
                // The graph identity ties the candidate's generation to exactly this
                // result; a chained result never matches (its computation's kickoff
                // replaced the cached pointer, failing the identity check above).
                if (servedGraphCandidate?.graph === result.projectGraph) {
                    servedGraphState = servedGraphCandidate;
                }
                notifyProjectGraphRecomputationListeners(result.projectGraph, result.sourceMaps, result.error);
                persistProjectGraphToDisk(result);
            }
            return result;
        }
        catch (e) {
            return errorResult(e);
        }
    })();
    cachedSerializedProjectGraphPromise = myPromise;
}
function isStale(expectedHash) {
    return readNxJsonPluginsHash() !== expectedHash;
}
/**
 * Starts a successor recompute only when this IIFE is still the cached one.
 * If a newer recompute already replaced the cached pointer, that newer
 * recompute will produce the fresh result and we just need to return the
 * pointer so awaiters chain onto it.
 */
function chainToSuccessor(myPromise) {
    logger_1.serverLogger.log('Discarding stale recompute result (nx.json plugins changed mid-compute).');
    if (cachedSerializedProjectGraphPromise === myPromise)
        kickOffRecompute();
    return cachedSerializedProjectGraphPromise;
}
function readNxJsonPluginsHash() {
    return (0, file_hasher_1.hashObject)((0, nx_json_1.readNxJson)(workspace_root_1.workspaceRoot).plugins ?? []);
}
async function getCachedSerializedProjectGraphPromise(socket) {
    // Subscribe the requesting client to the graph-construction topic
    // for the duration of the await, so in-flight progress/log messages
    // — including those produced by a recomputation that was already
    // started before this caller arrived — are broadcast to them.
    if (socket) {
        (0, client_socket_context_1.subscribeClientToTopic)(socket, progress_topics_1.ProgressTopics.GraphConstruction);
    }
    try {
        // Drain anything the native watcher has buffered before deciding
        // whether the cached graph is fresh. Without this, a file change
        // that already arrived in the watcher's accumulator but hasn't
        // flushed past IDLE_WINDOW yet would be invisible to the staleness
        // check below — the daemon would return a stale graph.
        await (0, watcher_1.flushPendingWorkspaceChanges)();
        await resetInternalStateIfNxDepsMissing();
        // Yield one macrotask boundary so any TSFN-queued watcher callbacks
        // run before we read collected*. Without this, an event that left
        // the native side but is still queued in libuv's I/O queue (behind
        // our request handler) would be invisible here and we'd serve a
        // stale graph. Placed right before the read so no microtask gap
        // separates them.
        await new Promise(setImmediate);
        // The queue can hold evidence against the settled cached graph itself: a
        // tracked dotenv edit only the outputs watcher has delivered yet queues
        // without invalidating, and the workspace watcher's recomputation may lag
        // this request. Classified against the exact graph the cache serves; an
        // in-flight computation needs no check here because its own pre-serve
        // replay consumes the queue. Content hashes are dropped before the
        // successor can read, as in the error retry: one recorded when the edit
        // was classified could suppress a revert landing mid-read. Fails toward
        // recomputing, since a stale graph on a dotenv edit is the bug this
        // prevents.
        try {
            if (servedGraphState &&
                (0, dotenv_graph_changes_1.hasRelevantPendingDotEnvEvidence)(servedGraphState.graph, servedGraphState.generation)) {
                (0, dotenv_graph_changes_1.clearDotEnvFileHashes)();
                invalidateGraphCache();
            }
        }
        catch (e) {
            logger_1.serverLogger.log(`Failed to check pending dotenv changes against the cached graph; recomputing to be safe: ${e instanceof Error ? e.message : e}`);
            (0, dotenv_graph_changes_1.clearDotEnvFileHashes)();
            invalidateGraphCache();
        }
        // If no compute exists or events are still in collected*, kick one off.
        // Otherwise reuse whatever is already in flight or cached.
        const needsRecompute = !cachedSerializedProjectGraphPromise ||
            collectedUpdatedFiles.size > 0 ||
            collectedDeletedFiles.size > 0;
        if (needsRecompute) {
            logger_1.serverLogger.log(cachedSerializedProjectGraphPromise
                ? `Recomputing project graph because of ${collectedUpdatedFiles.size} updated and ${collectedDeletedFiles.size} deleted files.`
                : 'No in-memory cached project graph found. Recomputing it...');
            kickOffRecompute();
        }
        else {
            logger_1.serverLogger.log('Reusing in-memory cached project graph because no files changed.');
        }
        // A stale compute returns cachedSerializedProjectGraphPromise (the
        // newer compute that replaced it); promise unwrapping flattens the
        // chain so we always end up with the latest real result.
        const result = await cachedSerializedProjectGraphPromise;
        // Even when the loop didn't recompute, write the cache if it's stale on
        // disk relative to the in-memory result. This protects against
        // non-daemon processes overwriting the daemon's valid graph with a
        // stale/errored one.
        if (!needsRecompute &&
            result.projectGraph &&
            result.projectFileMapCache &&
            result.sourceMaps) {
            (0, nx_deps_cache_1.writeCacheIfStale)(result.projectFileMapCache, result.projectGraph, result.sourceMaps, extractErrors(result.error));
        }
        const errors = extractErrors(result.error);
        if (errors?.length) {
            cachedSerializedProjectGraphPromise = null;
        }
        return result;
    }
    catch (e) {
        // We return the project graph, but we don't want to persist the cache to
        // serve the same state, as it could cause issues if the error is caused by something
        // transient
        cachedSerializedProjectGraphPromise = null;
        return {
            error: e,
            serializedProjectGraph: null,
            serializedSourceMaps: null,
            sourceMaps: null,
            projectGraph: null,
            projectFileMapCache: null,
            rustReferences: null,
        };
    }
    finally {
        if (socket) {
            (0, client_socket_context_1.unsubscribeClientFromTopic)(socket, progress_topics_1.ProgressTopics.GraphConstruction);
        }
    }
}
function scheduleProjectGraphRecomputation(createdFiles, updatedFiles, deletedFiles) {
    ++fileChangeCounter;
    // Hash the changed files up front and drop no-op rewrites before they can
    // trigger an expensive recompute. Restoring a cached task output, a
    // `git checkout` back to the same content, or a formatter that changes
    // nothing all rewrite a file (new inode) the watcher reports as changed
    // even though the bytes are identical. updateFilesInContext updates the
    // workspace context and returns only the files whose content actually
    // changed. Hashing here — once per watcher batch — rather than inside the
    // recompute keeps it off the stale-retry path, which would otherwise see
    // "no change" after the first pass already updated the context hashes.
    perf_hooks_1.performance.mark('hash-watched-changes-start');
    const changedFileHashes = createdFiles.length > 0 ||
        updatedFiles.length > 0 ||
        deletedFiles.length > 0
        ? ((0, workspace_context_1.updateFilesInContext)(workspace_root_1.workspaceRoot, [...createdFiles, ...updatedFiles], deletedFiles) ?? {})
        : {};
    perf_hooks_1.performance.mark('hash-watched-changes-end');
    perf_hooks_1.performance.measure('hash changed files from watcher', 'hash-watched-changes-start', 'hash-watched-changes-end');
    for (const [f, hash] of Object.entries(changedFileHashes)) {
        collectedDeletedFiles.delete(f);
        collectedUpdatedFiles.set(f, { version: fileChangeCounter, hash });
    }
    for (let f of deletedFiles) {
        collectedUpdatedFiles.delete(f);
        collectedDeletedFiles.set(f, fileChangeCounter);
    }
    // The native watcher already coalesces a burst of events into one batch,
    // so socket + listener notifications dispatch immediately.
    if (Object.keys(changedFileHashes).length > 0 || deletedFiles.length > 0) {
        (0, file_change_events_1.notifyFileChangeListeners)({ createdFiles, updatedFiles, deletedFiles });
        (0, file_watcher_sockets_1.notifyFileWatcherSockets)(createdFiles, updatedFiles, deletedFiles);
        // Bump generation synchronously so any in-flight compute fails its
        // next isStale() check and chains to the newer one. kickOffRecompute
        // would also bump on first resume, but only after its first await —
        // a window during which the old compute could falsely pass.
        ++recomputationGeneration;
        kickOffRecompute();
    }
    else {
        // First call (initial startup) — no events but we still need a graph.
        if (!cachedSerializedProjectGraphPromise) {
            kickOffRecompute();
        }
    }
}
function registerProjectGraphRecomputationListener(listener) {
    projectGraphRecomputationListeners.add(listener);
}
function computeWorkspaceConfigHash(projectsConfigurations) {
    const projectConfigurationStrings = Object.entries(projectsConfigurations)
        .sort(([projectNameA], [projectNameB]) => projectNameA.localeCompare(projectNameB))
        .map(([projectName, projectConfig]) => `${projectName}:${JSON.stringify(projectConfig)}`);
    return (0, file_hasher_1.hashArray)(projectConfigurationStrings);
}
async function processCollectedUpdatedAndDeletedFiles({ projects, externalNodes, projectRootMap }, updatedFileHashes, deletedFiles) {
    try {
        const configHash = computeWorkspaceConfigHash(projects);
        // Config changed → can't incrementally update; refetch the file map
        // from disk. Returning instead of mutating module state lets the caller
        // gate the commit on its staleness check, so a slower stale compute
        // can't clobber a faster newer one's already-committed state.
        if (configHash !== storedWorkspaceConfigHash) {
            const fresh = await (0, retrieve_workspace_files_1.retrieveWorkspaceFiles)(workspace_root_1.workspaceRoot, projectRootMap);
            return { fileMap: fresh, configHash, knownExternalNodes: externalNodes };
        }
        // Config unchanged → patch the existing file map in place.
        if (exports.fileMapWithFiles) {
            return {
                fileMap: (0, file_map_utils_1.updateFileMap)(projects, exports.fileMapWithFiles.rustReferences, updatedFileHashes, deletedFiles),
                configHash,
            };
        }
        // No prior map (first compute on this daemon).
        const fresh = await (0, retrieve_workspace_files_1.retrieveWorkspaceFiles)(workspace_root_1.workspaceRoot, projectRootMap);
        return { fileMap: fresh, configHash };
    }
    catch (e) {
        // this is expected
        // for instance, project.json can be incorrect or a file we are trying to has
        // has been deleted
        // we are resetting internal state to start from scratch next time a file changes
        // given the user the opportunity to fix the error
        // if Nx requests the project graph prior to the error being fixed,
        // the error will be propagated
        logger_1.serverLogger.log(`Error detected when recomputing project file map: ${e.message}`);
        resetInternalState();
        throw e;
    }
}
/**
 * Discards the cached graph when a graph input outside the file watcher's view
 * (e.g. the daemon env) changes. Clearing the cached promise makes the next
 * request trigger a fresh computation; the generation bump marks any in-flight
 * compute stale so it chains to that successor instead of committing, because
 * a compute passing its chainToLatest checks would serve a graph built under
 * the old input to whoever already awaits it.
 */
function invalidateGraphCache() {
    // We intentionally do NOT call getCachedSerializedProjectGraphPromise() here
    // because assigning its return Promise to the module-level variable causes a
    // deadlock: the async function resumes, sees the variable is non-null (pointing
    // at its own Promise), takes the "reuse" branch, and awaits itself forever.
    cachedSerializedProjectGraphPromise = null;
    ++recomputationGeneration;
    servedGraphState = null;
}
/**
 * The current recomputation generation, stamped on queued dotenv events so
 * the pre-serve drain can prove whether a computation started before an
 * event arrived.
 */
function getRecomputationGeneration() {
    return recomputationGeneration;
}
// isKnownWorkspaceFile's membership set, derived lazily from the map object it
// was built from; every `fileMapWithFiles` write clears it, so a replaced map
// generation is not retained through the memo.
let knownWorkspaceFiles;
let knownWorkspaceFilesSource;
/**
 * Whether the ignore-filtered workspace file map knows `path`. The workspace
 * watcher applies the same ignore rules, so a change to a known file also
 * reaches scheduleProjectGraphRecomputation; an unknown file is either
 * ignored, or created since the last recompute committed.
 */
function isKnownWorkspaceFile(path) {
    if (!exports.fileMapWithFiles) {
        return false;
    }
    if (knownWorkspaceFilesSource !== exports.fileMapWithFiles) {
        const { projectFileMap, nonProjectFiles } = exports.fileMapWithFiles.fileMap;
        knownWorkspaceFiles = new Set();
        for (const { file } of nonProjectFiles) {
            knownWorkspaceFiles.add(file);
        }
        for (const files of Object.values(projectFileMap)) {
            for (const { file } of files) {
                knownWorkspaceFiles.add(file);
            }
        }
        knownWorkspaceFilesSource = exports.fileMapWithFiles;
    }
    return knownWorkspaceFiles.has(path);
}
async function processFilesAndCreateAndSerializeProjectGraph(separatedPlugins) {
    const plugins = [
        ...separatedPlugins.specifiedPlugins,
        ...separatedPlugins.defaultPlugins,
    ];
    const myGeneration = ++recomputationGeneration;
    // A hash recorded before this claim can describe bytes this computation
    // never reads (a callback classified between a forced invalidation and this
    // claim records one no handler-side clear has seen), and retained it could
    // suppress a coalesced revert landing mid-read. Bounding every hash to the
    // window since the last claim closes that for any successor, however it was
    // forced. A callback landing after this claim re-records and re-queues, and
    // its stamp then marks this computation stale at the drain.
    (0, dotenv_graph_changes_1.clearDotEnvFileHashes)();
    // A newer kickOffRecompute has already replaced
    // cachedSerializedProjectGraphPromise. Returning it lets the async
    // unwrap chain our caller onto the newer compute's result; pass
    // notifyAbort=true when the graph-phase counters still need balancing.
    const chainToLatest = (notifyAbort) => {
        if (myGeneration === recomputationGeneration)
            return null;
        if (notifyAbort)
            notifyPluginsGraphAborted(plugins);
        // Defensive: if the cache was cleared (e.g. resetInternalState ran)
        // there is nothing to chain to. Returning undefined lets `if (stale)
        // return stale` fall through and the compute commits stale data.
        // Kick off a successor so we always have a real promise to chain to.
        if (!cachedSerializedProjectGraphPromise) {
            kickOffRecompute();
        }
        return cachedSerializedProjectGraphPromise;
    };
    try {
        const updatedFilesSnapshot = new Map(collectedUpdatedFiles);
        const deletedFilesSnapshot = new Map(collectedDeletedFiles);
        const updatedFiles = [...updatedFilesSnapshot.keys()];
        const deletedFiles = [...deletedFilesSnapshot.keys()];
        // Hashes were already computed (and the workspace context updated) in
        // scheduleProjectGraphRecomputation, which also dropped no-op rewrites.
        // Reuse them so the context isn't re-hashed on every (possibly stale)
        // recompute attempt.
        const updatedFileHashes = {};
        for (const [f, { hash }] of updatedFilesSnapshot) {
            updatedFileHashes[f] = hash;
        }
        logger_1.serverLogger.requestLog(`Updated workspace context based on watched changes, recomputing project graph...`);
        logger_1.serverLogger.requestLog(updatedFiles);
        logger_1.serverLogger.requestLog(deletedFiles);
        const nxJson = (0, nx_json_1.readNxJson)(workspace_root_1.workspaceRoot);
        global.NX_GRAPH_CREATION = true;
        let projectConfigurationsResult;
        let projectConfigurationsError;
        try {
            projectConfigurationsResult = await (0, retrieve_workspace_files_1.retrieveProjectConfigurations)(separatedPlugins, workspace_root_1.workspaceRoot, nxJson);
        }
        catch (e) {
            if (e instanceof error_types_1.ProjectConfigurationsError) {
                projectConfigurationsResult = e.partialProjectConfigurationsResult;
                projectConfigurationsError = e;
            }
            else {
                throw e;
            }
        }
        const stalePostCreateNodes = chainToLatest(true);
        if (stalePostCreateNodes)
            return stalePostCreateNodes;
        const fileMapUpdate = await processCollectedUpdatedAndDeletedFiles(projectConfigurationsResult, updatedFileHashes, deletedFiles);
        const stalePreCreateDependencies = chainToLatest(true);
        if (stalePreCreateDependencies)
            return stalePreCreateDependencies;
        // Latest writer commits to module state. Stale computes returned via
        // chainToLatest above without touching `fileMapWithFiles`, so they
        // can't clobber a newer compute's write.
        exports.fileMapWithFiles = fileMapUpdate.fileMap;
        knownWorkspaceFiles = undefined;
        knownWorkspaceFilesSource = undefined;
        storedWorkspaceConfigHash = fileMapUpdate.configHash;
        if (fileMapUpdate.knownExternalNodes) {
            knownExternalNodes = fileMapUpdate.knownExternalNodes;
        }
        // Drain only after committing — a stale compute that returns at the
        // staleness check above must leave its snapshot in `collected*` so the
        // newer compute still sees those files. Removing them earlier would
        // make the next compute snapshot empty and the file changes vanish
        // from the daemon's view (project graph misses recently added files).
        // Match version-stamps so a file modified mid-flight (higher version)
        // stays in the queue for reprocessing.
        for (const [f, { version }] of updatedFilesSnapshot) {
            if (collectedUpdatedFiles.get(f)?.version === version) {
                collectedUpdatedFiles.delete(f);
            }
        }
        for (const [f, version] of deletedFilesSnapshot) {
            if (collectedDeletedFiles.get(f) === version) {
                collectedDeletedFiles.delete(f);
            }
        }
        const g = await createAndSerializeProjectGraph(projectConfigurationsResult);
        delete global.NX_GRAPH_CREATION;
        // createDependencies/createMetadata already ran via wrapped hooks, so
        // graph-phase counters are balanced — no notifyAbort needed.
        const stalePostBuild = chainToLatest(false);
        if (stalePostBuild)
            return stalePostBuild;
        const errors = [...(projectConfigurationsError?.errors ?? [])];
        const aggregate = g.error && (0, error_types_1.isAggregateProjectGraphError)(g.error) && g.error.errors?.length
            ? g.error
            : null;
        // An error result is never cached, notified, or persisted, so a queued
        // dotenv edit that may already have fixed the failing input earns one
        // retry instead of surfacing the error. The peek consumes nothing (a
        // successful successor's drain classifies the entries against a real
        // graph, which these branches may lack: `g.projectGraph` can be null
        // here) and a persistent error retries once, because the successor
        // claims a generation above every recorded stamp. Content hashes are
        // dropped, though: one recorded during this failed computation could
        // suppress a callback landing while the successor reads. The catch at
        // the end of this function stays excluded: a throw there can predate
        // projectConfigurationsResult and the plugin hooks' balancing, and the
        // next request recomputes at a fresh generation anyway.
        const retryForPendingDotEnv = () => {
            if (!(0, dotenv_graph_changes_1.hasPendingDotEnvEvidence)(myGeneration))
                return null;
            (0, dotenv_graph_changes_1.clearDotEnvFileHashes)();
            invalidateGraphCache();
            return chainToLatest(false);
        };
        if (g.error && !aggregate) {
            return retryForPendingDotEnv() ?? errorResult(g.error);
        }
        if (aggregate)
            errors.push(...aggregate.errors);
        if (errors.length > 0) {
            return (retryForPendingDotEnv() ??
                errorResult(new error_types_1.DaemonProjectGraphError(errors, g.projectGraph, projectConfigurationsResult.sourceMaps)));
        }
        // Replay the dotenv events no committed root could classify on arrival
        // against the graph about to be served. Runs after the last staleness
        // gate so a stale compute leaves the queue for its successor, and only
        // on the success path: an error result is never notified or persisted.
        // Queue evidence is decisive here even for files the workspace watcher
        // tracks: the two watchers deliver independently, so tracking alone does
        // not prove that watcher's recomputation was already scheduled.
        let staleDotEnv;
        try {
            const pending = (0, dotenv_graph_changes_1.drainPendingDotEnvEvents)(g.projectGraph, myGeneration);
            staleDotEnv = pending.overflowed || pending.invalidating.length > 0;
        }
        catch (e) {
            logger_1.serverLogger.log(`Failed to re-check pending dotenv changes; recomputing to be safe: ${e instanceof Error ? e.message : e}`);
            staleDotEnv = true;
        }
        if (staleDotEnv) {
            // This graph read the file before the queued edit landed. The bump plus
            // chain hands every awaiting caller the successor's result and keeps
            // this one from being notified or persisted.
            invalidateGraphCache();
            return chainToLatest(false);
        }
        servedGraphCandidate = { graph: g.projectGraph, generation: myGeneration };
        return g;
    }
    catch (err) {
        return errorResult(err);
    }
}
function errorResult(error) {
    return {
        error,
        projectGraph: null,
        projectFileMapCache: null,
        rustReferences: null,
        serializedProjectGraph: null,
        serializedSourceMaps: null,
        sourceMaps: null,
    };
}
function extractErrors(error) {
    if (!error)
        return [];
    return error instanceof error_types_1.DaemonProjectGraphError ? error.errors : [error];
}
function persistProjectGraphToDisk(result) {
    if (!result.projectGraph ||
        !result.projectFileMapCache ||
        !result.sourceMaps) {
        return;
    }
    (0, nx_deps_cache_1.writeCache)(result.projectFileMapCache, result.projectGraph, result.sourceMaps, extractErrors(result.error));
    cacheHasBeenPersisted = true;
}
function copyFileData(d) {
    return d.map((t) => ({ ...t }));
}
function copyFileMap(m) {
    const c = {
        nonProjectFiles: copyFileData(m.nonProjectFiles),
        projectFileMap: {},
    };
    for (let p of Object.keys(m.projectFileMap)) {
        c.projectFileMap[p] = copyFileData(m.projectFileMap[p]);
    }
    return c;
}
async function createAndSerializeProjectGraph({ projects, sourceMaps, }) {
    try {
        perf_hooks_1.performance.mark('create-project-graph-start');
        const fileMap = copyFileMap(exports.fileMapWithFiles.fileMap);
        const rustReferences = exports.fileMapWithFiles.rustReferences;
        const { projectGraph, projectFileMapCache } = await (0, build_project_graph_1.buildProjectGraphUsingProjectFileMap)(projects, knownExternalNodes, fileMap, rustReferences, exports.currentProjectFileMapCache || (0, nx_deps_cache_1.readFileMapCache)(), await (0, get_plugins_1.getPlugins)((0, nx_json_1.readNxJson)(workspace_root_1.workspaceRoot)), sourceMaps);
        exports.currentProjectFileMapCache = projectFileMapCache;
        exports.currentProjectGraph = projectGraph;
        exports.currentSourceMaps = sourceMaps;
        perf_hooks_1.performance.mark('create-project-graph-end');
        perf_hooks_1.performance.measure('total execution time for createProjectGraph()', 'create-project-graph-start', 'create-project-graph-end');
        perf_hooks_1.performance.mark('json-stringify-start');
        const serializedProjectGraph = JSON.stringify(projectGraph);
        const serializedSourceMaps = JSON.stringify(sourceMaps);
        perf_hooks_1.performance.mark('json-stringify-end');
        perf_hooks_1.performance.measure('serialize graph', 'json-stringify-start', 'json-stringify-end');
        return {
            error: null,
            projectGraph,
            projectFileMapCache,
            serializedProjectGraph,
            serializedSourceMaps,
            sourceMaps,
            rustReferences,
        };
    }
    catch (e) {
        logger_1.serverLogger.log(`Error detected when creating a project graph: ${e.message}`);
        return {
            error: e,
            projectGraph: null,
            projectFileMapCache: null,
            serializedProjectGraph: null,
            serializedSourceMaps: null,
            sourceMaps: null,
            rustReferences: null,
        };
    }
}
async function resetInternalState() {
    cachedSerializedProjectGraphPromise = undefined;
    servedGraphState = null;
    servedGraphCandidate = null;
    exports.fileMapWithFiles = undefined;
    knownWorkspaceFiles = undefined;
    knownWorkspaceFilesSource = undefined;
    exports.currentProjectFileMapCache = undefined;
    exports.currentProjectGraph = undefined;
    exports.currentSourceMaps = undefined;
    collectedUpdatedFiles.clear();
    collectedDeletedFiles.clear();
    cacheHasBeenPersisted = false;
    (0, workspace_context_1.resetWorkspaceContext)();
}
async function resetInternalStateIfNxDepsMissing() {
    // Only meaningful AFTER we've persisted the cache at least once.
    // Before then, "file missing" is the expected state — an in-flight
    // first compute hasn't written yet, and resetting would tear down its
    // promise mid-await and force a redundant recompute.
    if (!cacheHasBeenPersisted) {
        return;
    }
    try {
        if (!(0, fileutils_1.fileExists)(nx_deps_cache_1.nxProjectGraph) && cachedSerializedProjectGraphPromise) {
            await resetInternalState();
        }
    }
    catch {
        // A transient stat error shouldn't nuke state — the next request
        // will retry.
    }
}
function notifyPluginsGraphAborted(plugins) {
    // At both abort sites, only createNodes has been called.
    // createDependencies and createMetadata are called later in
    // createAndSerializeProjectGraph, which hasn't run yet.
    for (const plugin of plugins) {
        plugin.notifyPhaseAborted?.('graph', 'createNodes');
    }
}
function notifyProjectGraphRecomputationListeners(projectGraph, sourceMaps, error) {
    for (const listener of projectGraphRecomputationListeners) {
        listener(projectGraph, sourceMaps, error);
    }
    (0, project_graph_listener_sockets_1.notifyProjectGraphListenerSockets)(projectGraph, sourceMaps, error);
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDbConnection = getDbConnection;
exports.getLocalDbConnection = getLocalDbConnection;
const native_1 = require("../native");
const cache_directory_1 = require("./cache-directory");
const workspace_root_1 = require("./workspace-root");
const dbConnectionMap = new Map();
/**
 * Where the shared DB lives, resolved once per process.
 *
 * The DB is the only thing that uses the shared `workspace-data` directory --
 * daemon logs and the `disabled` marker stay in the checkout's own, because
 * they describe that checkout. Sharing is not decided here: this DB indexes the
 * cache directory's contents, so the two have to land in the same scope or a
 * cache hit resolves to artifacts that were never written here.
 */
let _sharedDir;
function sharedWorkspaceDataDirectory(root) {
    _sharedDir ??= (0, cache_directory_1.sharedDataDirectory)(root, 'workspace-data');
    return _sharedDir;
}
function getDbConnection(opts = {}) {
    opts.directory ??= sharedWorkspaceDataDirectory(workspace_root_1.workspaceRoot);
    const key = `${opts.directory}:${opts.dbName ?? 'default'}`;
    const connection = getEntryOrSet(dbConnectionMap, key, () => (0, native_1.connectToNxDb)(opts.directory, opts.dbName));
    return connection;
}
/**
 * Returns a DB connection scoped to the local worktree (not shared).
 * Use this for data that is inherently local to a worktree, such as
 * running task tracking, where sharing across worktrees would cause
 * false conflicts.
 */
function getLocalDbConnection(opts = {}) {
    const directory = (0, cache_directory_1.workspaceDataDirectoryForWorkspace)(workspace_root_1.workspaceRoot);
    const key = `${directory}:${opts.dbName ?? 'default'}`;
    const connection = getEntryOrSet(dbConnectionMap, key, () => (0, native_1.connectToNxDb)(directory, opts.dbName));
    return connection;
}
function removeDbConnections() {
    for (const connection of dbConnectionMap.values()) {
        (0, native_1.closeDbConnection)(connection);
    }
    dbConnectionMap.clear();
}
process.on('exit', removeDbConnections);
function getEntryOrSet(map, key, defaultValue) {
    const existing = map.get(key);
    if (existing) {
        return existing;
    }
    const val = defaultValue();
    map.set(key, val);
    return val;
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPluginOsSocketPath = exports.getForkedProcessOsSocketPath = exports.getFullOsSocketPath = exports.isWindows = void 0;
exports.getPluginSocketFileName = getPluginSocketFileName;
exports.killSocketOrPath = killSocketOrPath;
exports.serializeResult = serializeResult;
exports.serializeWithFallback = serializeWithFallback;
exports.serialize = serialize;
exports.sendMessage = sendMessage;
const fs_1 = require("fs");
const os_1 = require("os");
const path_1 = require("path");
const tmp_dir_1 = require("./tmp-dir");
const serializable_error_1 = require("../utils/serializable-error");
const is_v8_serializer_enabled_1 = require("./is-v8-serializer-enabled");
const v8_1 = require("v8");
const consume_messages_from_socket_1 = require("../utils/consume-messages-from-socket");
exports.isWindows = (0, os_1.platform)() === 'win32';
/**
 * For IPC with the daemon server we use unix sockets or windows named pipes, depending on the user's operating system.
 *
 * See https://nodejs.org/dist/latest-v14.x/docs/api/net.html#net_identifying_paths_for_ipc_connections for a full breakdown
 * of OS differences between Unix domain sockets and named pipes.
 */
const getFullOsSocketPath = () => {
    const path = (0, path_1.resolve)((0, tmp_dir_1.getDaemonSocketDir)());
    assertValidSocketPath(path);
    return exports.isWindows ? '\\\\.\\pipe\\nx\\' + path : path;
};
exports.getFullOsSocketPath = getFullOsSocketPath;
const getForkedProcessOsSocketPath = (id) => {
    let path = (0, path_1.resolve)((0, path_1.join)((0, tmp_dir_1.getSocketDir)(), 'fp' + id + '.sock'));
    assertValidSocketPath(path);
    return exports.isWindows ? '\\\\.\\pipe\\nx\\' + path : path;
};
exports.getForkedProcessOsSocketPath = getForkedProcessOsSocketPath;
const getPluginOsSocketPath = (id) => {
    let path = (0, path_1.resolve)((0, path_1.join)((0, tmp_dir_1.getPluginSocketDir)(), getPluginSocketFileName(id)));
    assertValidSocketPath(path);
    return exports.isWindows ? '\\\\.\\pipe\\nx\\' + path : path;
};
exports.getPluginOsSocketPath = getPluginOsSocketPath;
function getPluginSocketFileName(id) {
    return `p${id}.sock`;
}
function assertValidSocketPath(path) {
    if (path.length > 95) {
        const fallbackCause = (0, tmp_dir_1.getSocketDirFallbackCause)();
        const refusedConfiguredSocketDir = (0, tmp_dir_1.getRefusedConfiguredSocketDir)();
        throw new Error([
            'Attempted to open socket that exceeds the maximum socket length.',
            ...(fallbackCause === undefined
                ? []
                : [
                    `Nx fell back to ${(0, path_1.dirname)(path)} because the default socket directory could not be used.`,
                    'Run the command with --verbose to see why the default directory was rejected.',
                ]),
            '',
            ...(refusedConfiguredSocketDir === undefined
                ? [
                    `Set NX_SOCKET_DIR to a shorter path (e.g. ${exports.isWindows ? '%TMP%/nx-tmp' : '/tmp/nx-tmp'}) to avoid this issue.`,
                ]
                : [
                    // Saying "set a shorter path" here would be advice they already
                    // followed: they set one, and it was refused for another reason.
                    `The directory set in NX_SOCKET_DIR (${refusedConfiguredSocketDir}) could not be used — see the warning above — so Nx fell back to a longer path.`,
                    'Point NX_SOCKET_DIR at a short directory your user owns.',
                ]),
        ].join('\n'), fallbackCause === undefined ? undefined : { cause: fallbackCause });
    }
}
function killSocketOrPath() {
    try {
        (0, fs_1.unlinkSync)((0, exports.getFullOsSocketPath)());
    }
    catch { }
}
// Prepare a serialized project graph result for sending over IPC from the server to the client
function serializeResult(error, serializedProjectGraph, serializedSourceMaps) {
    // We do not want to repeat work `JSON.stringify`ing an object containing the potentially large project graph so merge as strings
    return `{ "error": ${JSON.stringify(error ? (0, serializable_error_1.createSerializableError)(error) : error)}, "projectGraph": ${serializedProjectGraph}, "sourceMaps": ${serializedSourceMaps} }`;
}
function serializeAs(data, format) {
    return format === 'v8'
        ? (0, v8_1.serialize)(data)
        : Buffer.from(JSON.stringify(data), 'utf8');
}
/**
 * Serialize using `preferred`, falling back to the other format when it throws.
 * Neither format subsumes the other: JSON cannot represent a BigInt and hits the
 * max string length far sooner, while v8 cannot clone a function.
 *
 * @param data Data to serialize
 * @param preferred Format to attempt first
 * @returns Serialized data as bytes ready to be framed onto a socket
 */
function serializeWithFallback(data, preferred) {
    try {
        return serializeAs(data, preferred);
    }
    catch (e) {
        const fallback = preferred === 'v8' ? 'json' : 'v8';
        console.warn(`Data could not be serialized using ${preferred} serialization: ${e}. Falling back to ${fallback} serialization.`);
        return serializeAs(data, fallback);
    }
}
/**
 * Serialize data for IPC using the format the user configured.
 *
 * @param data Data to serialize
 * @param force Use this format without falling back. For callers whose data is
 *              known to be unrepresentable in the other format, where a fallback
 *              would only swap one failure for a less obvious one.
 * @returns Serialized data as bytes ready to be framed onto a socket
 */
function serialize(data, force) {
    return force
        ? serializeAs(data, force)
        : serializeWithFallback(data, (0, is_v8_serializer_enabled_1.isV8SerializerEnabled)() ? 'v8' : 'json');
}
/**
 * Serialize `data` and write it as one framed message.
 *
 * Lives here rather than in `writeMessage` so the framing stays a byte-level
 * primitive: `utils/consume-messages-from-socket` is shared by callers that
 * already hold bytes, and having it reach back into the daemon's serializer
 * would invert the dependency.
 */
function sendMessage(socket, data, force, callback) {
    (0, consume_messages_from_socket_1.writeMessage)(socket, serialize(data, force), callback);
}

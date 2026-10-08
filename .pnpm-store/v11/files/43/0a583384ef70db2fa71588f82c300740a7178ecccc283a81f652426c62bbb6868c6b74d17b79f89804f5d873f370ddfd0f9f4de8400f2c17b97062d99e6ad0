"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isDaemonMessage = isDaemonMessage;
exports.isForeignWorkspaceMessage = isForeignWorkspaceMessage;
exports.assertNotForeignWorkspaceMessage = assertNotForeignWorkspaceMessage;
const node_path_1 = require("node:path");
function isDaemonMessage(msg) {
    return typeof msg === 'object' && msg && 'type' in msg;
}
/**
 * Puts a workspace root into a form two independently-resolved spellings of the
 * same directory agree on.
 *
 * The sender's root and the receiver's root do not always come out of the same
 * branch of `workspaceRootInner`: one side can be handed `NX_WORKSPACE_ROOT_PATH`
 * verbatim while the other walks up from `process.cwd()`. On Windows those two
 * sources routinely disagree on the case of the drive letter — an editor or
 * agent may export `d:\repo` while `process.cwd()` reports `D:\repo` — and on
 * separators. Both address the same directory: Windows paths are
 * case-insensitive, and a drive letter is case-insensitive without exception.
 *
 * POSIX roots keep their case, where `/repo` and `/REPO` really can be two
 * directories.
 */
function normalizeWorkspaceRoot(workspaceRoot) {
    return process.platform === 'win32'
        ? node_path_1.win32.normalize(workspaceRoot).toLowerCase()
        : node_path_1.posix.normalize(workspaceRoot);
}
/**
 * A message from a different workspace — two sharing an NX_SOCKET_DIR — must not
 * be processed. Roots are normalized first so that a workspace does not look
 * foreign to itself; see {@link normalizeWorkspaceRoot}.
 */
function isForeignWorkspaceMessage(msg, receiverWorkspaceRoot) {
    if (msg.workspaceRoot === undefined) {
        return false;
    }
    return (normalizeWorkspaceRoot(msg.workspaceRoot) !==
        normalizeWorkspaceRoot(receiverWorkspaceRoot));
}
/**
 * Throws on a message this receiver must not act on. The daemon catches it and
 * responds with the mismatch; the plugin worker catches it and drops the
 * message. `receiverDescription` names whichever raised it.
 *
 * An unstamped message is deliberately accepted: this is accident detection,
 * not a control.
 */
function assertNotForeignWorkspaceMessage(msg, receiverWorkspaceRoot, receiverDescription = `The Nx Daemon for '${receiverWorkspaceRoot}'`) {
    if (isForeignWorkspaceMessage(msg, receiverWorkspaceRoot)) {
        throw new Error(`${receiverDescription} received a message from a different workspace ('${msg.workspaceRoot}') and refused to process it. This usually means multiple workspaces are sharing a socket directory; ensure NX_SOCKET_DIR (or NX_DAEMON_SOCKET_DIR) is not set to a shared location.`);
    }
}

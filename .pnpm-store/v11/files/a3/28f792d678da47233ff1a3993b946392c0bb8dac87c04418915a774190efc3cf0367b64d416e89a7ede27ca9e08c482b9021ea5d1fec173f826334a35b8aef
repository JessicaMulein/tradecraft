"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DaemonSocketMessenger = exports.VersionMismatchError = void 0;
const perf_hooks_1 = require("perf_hooks");
const consume_messages_from_socket_1 = require("../../utils/consume-messages-from-socket");
const workspace_root_1 = require("../../utils/workspace-root");
const logger_1 = require("../logger");
const socket_utils_1 = require("../socket-utils");
class VersionMismatchError extends Error {
    constructor() {
        super('Version mismatch with daemon server');
        this.name = 'VersionMismatchError';
        Object.setPrototypeOf(this, VersionMismatchError.prototype);
    }
}
exports.VersionMismatchError = VersionMismatchError;
class DaemonSocketMessenger {
    constructor(socket) {
        this.socket = socket;
    }
    sendMessage(messageToDaemon, force) {
        if (!this.socket) {
            throw new Error('Socket not initialized.');
        }
        // Stamp every message with the sending workspace's root so the daemon can
        // reject messages from a different workspace (e.g. a shared NX_SOCKET_DIR).
        messageToDaemon.workspaceRoot = workspace_root_1.workspaceRoot;
        logger_1.clientLogger.log('[Messenger] Sending message type:', messageToDaemon.type);
        perf_hooks_1.performance.mark('daemon-message-serialization-start-' + messageToDaemon.type);
        const serialized = (0, socket_utils_1.serialize)(messageToDaemon, force);
        perf_hooks_1.performance.mark('daemon-message-serialization-end-' + messageToDaemon.type);
        perf_hooks_1.performance.measure('daemon-message-serialization-' + messageToDaemon.type, 'daemon-message-serialization-start-' + messageToDaemon.type, 'daemon-message-serialization-end-' + messageToDaemon.type);
        (0, consume_messages_from_socket_1.writeMessage)(this.socket, serialized);
        logger_1.clientLogger.log('[Messenger] Message sent');
    }
    listen(onData, onClose = () => { }, onError = () => { }) {
        logger_1.clientLogger.log('[Messenger] Setting up socket listeners');
        this.socket.on('close', onClose);
        this.socket.on('error', (err) => {
            logger_1.clientLogger.log('[Messenger] Socket error:', err.message);
            onError(err);
        });
        this.socket.on('data', (0, consume_messages_from_socket_1.consumeMessagesFromSocket)(async (message) => {
            logger_1.clientLogger.log('[Messenger] Received message, length:', message.length);
            onData(message);
        }, 
        // A framing failure leaves the socket open and writable, so nothing
        // else settles the in-flight request. Route it to the same handler as
        // a socket error rather than waiting for the keep-alive timeout.
        (err) => {
            logger_1.clientLogger.log('[Messenger] Framing error:', err.message);
            onError(err);
        }));
        logger_1.clientLogger.log('[Messenger] listen() complete');
        return this;
    }
    close() {
        if (this.socket) {
            this.socket.destroy();
        }
    }
}
exports.DaemonSocketMessenger = DaemonSocketMessenger;

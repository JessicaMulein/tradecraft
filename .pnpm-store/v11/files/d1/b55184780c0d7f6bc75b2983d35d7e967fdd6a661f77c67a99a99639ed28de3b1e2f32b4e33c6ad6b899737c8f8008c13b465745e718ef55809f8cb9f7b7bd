"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isV8SerializerEnabled = isV8SerializerEnabled;
/**
 * Off by default; set `NX_USE_V8_SERIALIZER=true` to opt in. Governs every Nx
 * socket channel: the daemon client and server, plugin workers, and pseudo-IPC.
 */
function isV8SerializerEnabled() {
    return process.env.NX_USE_V8_SERIALIZER === 'true';
}

"use strict";
// Shell detection via NX_COMPLETE env var (set by the wrappers).
Object.defineProperty(exports, "__esModule", { value: true });
exports.isCompletionRequest = isCompletionRequest;
exports.getCompletionShell = getCompletionShell;
const KNOWN_SHELLS = new Set([
    'bash',
    'zsh',
    'fish',
    'powershell',
]);
function isCompletionRequest() {
    return Boolean(process.env.NX_COMPLETE);
}
function getCompletionShell() {
    const raw = process.env.NX_COMPLETE;
    if (raw && KNOWN_SHELLS.has(raw)) {
        return raw;
    }
    return null;
}

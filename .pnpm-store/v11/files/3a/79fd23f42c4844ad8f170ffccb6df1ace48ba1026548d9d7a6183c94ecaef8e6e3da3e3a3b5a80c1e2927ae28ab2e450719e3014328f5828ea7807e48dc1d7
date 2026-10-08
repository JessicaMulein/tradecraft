"use strict";
// Zero-dep helpers for --agentic — keeps the agentic chain out of every
// nx CLI startup.
Object.defineProperty(exports, "__esModule", { value: true });
exports.AGENT_IDS = void 0;
exports.coerceAgenticArg = coerceAgenticArg;
/**
 * Canonical list of agent ids for the migrate agentic flow. Used by the yargs
 * layer for `--agentic` validation and by the runtime as the source of truth
 * for the {@link AgentId} union.
 */
exports.AGENT_IDS = ['claude-code', 'codex', 'opencode'];
/**
 * Shape-only normalization of `--agentic`; validation of agent-id strings is
 * done upstream in the yargs `.check()` chain.
 */
function coerceAgenticArg(value) {
    if (value === undefined)
        return undefined;
    // yargs collects repeated occurrences into an array; error rather than
    // silently picking last/first. `--agentic` is single-value by intent.
    if (Array.isArray(value)) {
        const received = value
            .map((v) => (typeof v === 'string' ? `--agentic=${v}` : '--agentic'))
            .join(' ');
        throw new Error(`Error: --agentic was passed more than once (received: ${received}). Specify --agentic at most one time.`);
    }
    if (value === true || value === '' || value === 'true' || value === 'yes') {
        return true;
    }
    if (value === false || value === 'false' || value === 'no') {
        return false;
    }
    if (typeof value === 'string') {
        return value;
    }
    return undefined;
}

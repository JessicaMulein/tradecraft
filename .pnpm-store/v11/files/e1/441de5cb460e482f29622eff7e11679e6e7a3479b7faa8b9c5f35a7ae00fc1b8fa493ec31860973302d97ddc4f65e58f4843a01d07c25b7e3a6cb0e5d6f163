"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isInsideAgent = isInsideAgent;
const native_1 = require("../../../native");
/**
 * Returns true when `nx migrate` is itself being run from inside another AI
 * agent's terminal session. Used to short-circuit the agentic flow so we never
 * spawn an inner agent inside an outer agent.
 *
 * Native `isAiAgent()` covers all supported agents (Claude Code, Cursor,
 * OpenCode, Codex, Gemini, Replit) via parent-process env-var sniffing.
 */
function isInsideAgent() {
    return (0, native_1.isAiAgent)();
}

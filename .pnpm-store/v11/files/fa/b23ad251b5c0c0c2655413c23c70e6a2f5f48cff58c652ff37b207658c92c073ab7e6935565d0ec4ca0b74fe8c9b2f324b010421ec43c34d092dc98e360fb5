"use strict";
// Internal to run/: deliberately not re-exported from ./index.
//
// The single writer for everything an orchestrated run puts on stdout. Human
// lines and the `<nx_migrate_*>` blocks the driving agent parses share that one
// stream, so a value carrying its own line break could open a forged block.
//
// Two boundaries: a thrown error leaves through handleErrors, which prints it
// outside this guarantee; and migration code is not contained at all (nx
// `require`s and runs it in process), so the guarantee is that data cannot
// corrupt the framing, nothing more.
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeLines = safeLines;
exports.logToAgent = logToAgent;
exports.warnToAgent = warnToAgent;
exports.emitStepBlock = emitStepBlock;
exports.emitPromptBlock = emitPromptBlock;
const output_1 = require("../../../utils/output");
const print_dropped_agent_context_1 = require("../agentic/print-dropped-agent-context");
const text_1 = require("../text");
/**
 * The safe form of a set of lines. Exported so a caller that needs the same
 * text twice, once for a human and once inside a block payload, derives both
 * from one array instead of sanitizing one copy and not the other.
 */
function safeLines(lines) {
    return lines.map(text_1.singleLine);
}
function safe(message) {
    return {
        title: (0, text_1.singleLine)(message.title),
        bodyLines: safeLines(message.bodyLines ?? []),
    };
}
function logToAgent(message) {
    output_1.output.log(safe(message));
}
function warnToAgent(message) {
    output_1.output.warn(safe(message));
}
/**
 * Serializes a block payload. `<` becomes its JSON unicode escape so a raw one
 * in a value cannot forge the closing tag, and the result stays valid JSON for
 * the agent to parse.
 */
function blockPayload(payload) {
    return JSON.stringify(payload, null, 2).replace(/</g, '\\u003c');
}
// A bare newline pair frames the block so adjacent stdout cannot run into it.
function writeBlock(tag, attrs, json) {
    const attrText = attrs
        .map(([name, value]) => ` ${name}="${(0, print_dropped_agent_context_1.escapeXmlAttr)((0, text_1.singleLine)(value))}"`)
        .join('');
    process.stdout.write(`\n<${tag}${attrText}>\n${json}\n</${tag}>\n\n`);
}
function emitStepBlock(runId, stepId, action, payload) {
    writeBlock('nx_migrate_step', [
        ['run-id', runId],
        ['step', stepId],
        ['action', action],
    ], blockPayload(payload));
}
function emitPromptBlock(migrationId, payload) {
    writeBlock('nx_migrate_prompt', [['migration', migrationId]], blockPayload(payload));
}

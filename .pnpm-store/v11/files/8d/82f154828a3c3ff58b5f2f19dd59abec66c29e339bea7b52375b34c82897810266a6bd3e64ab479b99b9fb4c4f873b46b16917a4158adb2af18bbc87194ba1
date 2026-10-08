"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatDroppedAgentContextForOuterAgent = formatDroppedAgentContextForOuterAgent;
exports.escapeXmlAttr = escapeXmlAttr;
exports.printDroppedAgentContextForOuterAgent = printDroppedAgentContextForOuterAgent;
const shared_rendering_1 = require("./prompts/shared-rendering");
function formatDroppedAgentContextForOuterAgent(input) {
    const entries = (0, shared_rendering_1.filterNonEmptyStrings)(input.agentContext);
    if (entries.length === 0) {
        return '';
    }
    const id = `${input.migration.package}:${input.migration.name}`;
    // Migration metadata and agentContext entries are user-authored (migrations
    // are published by third-party packages); escape any `<` / `&` so a hostile
    // value can't break out of the surrounding XML-framed block. The agent
    // reads `&lt;/agent_context&gt;` as literal text, not a closing tag.
    const safeName = (0, shared_rendering_1.escapeXmlBody)(input.migration.name);
    const safePrompt = input.migration.prompt
        ? (0, shared_rendering_1.escapeXmlBody)(input.migration.prompt)
        : undefined;
    const preamble = safePrompt
        ? `ℹ Hints from the ${safeName} generator for the AI agent driving this run, when applying ${safePrompt}:`
        : `ℹ Hints from the ${safeName} generator for the AI agent driving this run:`;
    return [
        preamble,
        ``,
        `<agent_context migration="${escapeXmlAttr(id)}">`,
        ...entries.map((entry) => (0, shared_rendering_1.renderListItem)((0, shared_rendering_1.escapeXmlBody)(entry))),
        `</agent_context>`,
    ].join('\n');
}
// Migration package/name come from arbitrary user-authored package.json /
// migrations.json — a name with `"` / `<` / `>` / `&` would produce malformed
// XML the outer agent can't parse. `'` is not strictly required for
// double-quoted attribute values but is included for defense.
function escapeXmlAttr(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}
/**
 * Both the classic loop and the single-migration worker call this only under
 * `agentic.kind === 'inside-agent'`. Under `enabled` the inner agent step
 * consumes `agentContext` through the prompt builders; under `disabled` the
 * run is human-driven and agent-targeted context is only noise.
 */
function printDroppedAgentContextForOuterAgent(input) {
    const block = formatDroppedAgentContextForOuterAgent(input);
    if (block) {
        // Bare newline pair frames the block so adjacent stdout (logger output,
        // migration progress) doesn't run into the opening or closing tag.
        process.stdout.write(`\n${block}\n\n`);
    }
}

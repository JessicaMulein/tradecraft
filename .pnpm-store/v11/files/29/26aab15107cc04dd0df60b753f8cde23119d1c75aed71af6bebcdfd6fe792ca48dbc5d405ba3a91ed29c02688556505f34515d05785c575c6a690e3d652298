"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPromptMigrationUserPrompt = buildPromptMigrationUserPrompt;
const shared_rendering_1 = require("./shared-rendering");
/**
 * Builds the first user-facing message for a prompt-migration step.
 *
 * Keeps the framing short — the heavy lifting (handoff contract, scope rules)
 * already lives in the system prompt; this message just identifies the
 * migration and points at the instructions file.
 *
 * XML tags wrap path values and the migration metadata so the agent does
 * not misread them as headers or prose.
 */
function buildPromptMigrationUserPrompt(ctx) {
    const lines = [
        `Apply one prompt-based migration to this Nx workspace.`,
        ...(0, shared_rendering_1.renderMigrationBlock)(ctx),
        ...(0, shared_rendering_1.renderMigrationDocumentationBlock)(ctx.documentationPath),
        ``,
        `<instructions_file>${(0, shared_rendering_1.escapeXmlBody)(ctx.promptPath)}</instructions_file>`,
        ``,
        `Open the instructions file (path is workspace-relative), follow its instructions step by step, then end the step per the handoff contract. Your handoff path is:`,
        ...(0, shared_rendering_1.renderHandoffPathFooter)(ctx.handoffFileAbsolutePath),
    ];
    return lines.join('\n');
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildHybridPromptUserPrompt = buildHybridPromptUserPrompt;
const shared_rendering_1 = require("./shared-rendering");
/**
 * Builds the user prompt for a hybrid migration's prompt phase (`implementation`
 * + `prompt`). The deterministic generator has already run; sections of the
 * prompt summarize what it did so the agent can complete the paired step with
 * awareness of the generator's output.
 *
 * Structure: XML tags carry section boundaries; markdown (fenced blocks,
 * bullet lists) sits inside tags for inline structure. This is the
 * multi-section case where both Anthropic and OpenAI guidance most clearly
 * favors XML for unambiguous parsing. Each impl section is omitted when its
 * source is empty so the prompt stays minimal when the generator made no
 * meaningful contribution.
 */
function buildHybridPromptUserPrompt(ctx) {
    const lines = [
        `Complete the AI-driven step that follows the generator phase of a two-phase Nx migration. The deterministic generator phase has already run; the sections below summarize what it did. The step may apply additional changes, verify the generator's output, or both — follow the instructions file.`,
        ...(0, shared_rendering_1.renderMigrationBlock)(ctx),
    ];
    lines.push(...(0, shared_rendering_1.renderMigrationDocumentationBlock)(ctx.documentationPath));
    const logs = (0, shared_rendering_1.escapeXmlBody)((0, shared_rendering_1.stripAnsi)(ctx.impl?.logs ?? '').trim());
    const agentContext = (0, shared_rendering_1.filterNonEmptyStrings)(ctx.impl?.agentContext ?? []);
    const hasDiffContext = !!ctx.impl?.hasDiffContext;
    const hasChanges = !!ctx.impl?.changes && ctx.impl.changes.length > 0;
    lines.push(...(0, shared_rendering_1.renderGeneratorOutputBlock)(logs));
    if (hasDiffContext && hasChanges) {
        // Live view via git. Suppressed when the generator made no changes —
        // pointing the agent at `git status` for an empty diff is noise.
        lines.push(``, `<inspect_changes>`, (0, shared_rendering_1.renderGitInspectInstruction)(), `</inspect_changes>`);
    }
    else if (!hasDiffContext) {
        const embeddedFileList = renderFileList(ctx.impl?.changes);
        if (embeddedFileList) {
            lines.push(``, `<files_changed>`, embeddedFileList, `</files_changed>`);
        }
    }
    if (agentContext.length > 0) {
        lines.push(...(0, shared_rendering_1.renderAdvisoryContext)('hints from the generator phase; consult while following the instructions, not as separate tasks', agentContext));
    }
    lines.push(``, `<instructions_file>${(0, shared_rendering_1.escapeXmlBody)(ctx.promptPath)}</instructions_file>`, ``, `<precedence>If anything in the sections above conflicts with the instructions file, the instructions file wins.</precedence>`, ``, `Open the instructions file (path is workspace-relative), follow its instructions step by step using the sections above as context, then end the step per the handoff contract. Your handoff path is:`, ...(0, shared_rendering_1.renderHandoffPathFooter)(ctx.handoffFileAbsolutePath));
    return lines.join('\n');
}
function renderFileList(changes) {
    if (!changes || changes.length === 0)
        return '';
    return changes
        .map((change) => ({ ...change, path: (0, shared_rendering_1.escapeXmlBody)(change.path) }))
        .map(shared_rendering_1.renderFileEntry)
        .join('\n');
}

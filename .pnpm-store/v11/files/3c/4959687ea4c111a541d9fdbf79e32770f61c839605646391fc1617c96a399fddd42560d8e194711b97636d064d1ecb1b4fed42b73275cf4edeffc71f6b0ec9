"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GENERIC_VALIDATION_FILE_LIST_CAP = void 0;
exports.buildGenericValidationUserPrompt = buildGenericValidationUserPrompt;
const shared_rendering_1 = require("./shared-rendering");
/**
 * Cap on the number of file entries rendered verbatim inside `<files_changed>`
 * when the embedded-list path is used (no per-migration commits / no git).
 * Excess entries collapse into a `… and N more files.` line.
 */
exports.GENERIC_VALIDATION_FILE_LIST_CAP = 50;
/**
 * Builds the user prompt for the framework-owned generic-validation agent step
 * that runs after a generator-only migration produces changes (when `--validate`
 * is enabled and `--agentic` resolves to an enabled agent).
 *
 * Differences from `buildHybridPromptUserPrompt`:
 * - No `<instructions_file>` block — the framework owns the instructions, and
 *   they live inline in `<validation_instructions>` below.
 * - No `<precedence>` block — there's no external instructions file to defer
 *   to.
 * - File-list cap: when the diff exceeds `GENERIC_VALIDATION_FILE_LIST_CAP`,
 *   the first N entries render verbatim and the remainder collapses into a
 *   `… and N more files.` count line.
 * - The lead sentence frames the agent as a validator, not an applier.
 */
function buildGenericValidationUserPrompt(ctx) {
    const lines = [
        `You are validating the output of an Nx migration's deterministic generator phase. The generator has already run; inspect what it produced, verify the workspace is in a consistent state for what this migration intended to accomplish, apply any minor in-scope fixes the generator should have produced cleanly, and report findings.`,
        ...(0, shared_rendering_1.renderMigrationBlock)(ctx),
    ];
    lines.push(...(0, shared_rendering_1.renderMigrationDocumentationBlock)(ctx.documentationPath));
    const logs = (0, shared_rendering_1.escapeXmlBody)((0, shared_rendering_1.stripAnsi)(ctx.impl.logs ?? '').trim());
    lines.push(...(0, shared_rendering_1.renderGeneratorOutputBlock)(logs));
    if (!ctx.impl.hasDiffContext && ctx.impl.changes.length > 0) {
        lines.push(``, `<files_changed>`, ...renderFileListBody(ctx.impl.changes), `</files_changed>`);
    }
    const agentContext = (0, shared_rendering_1.filterNonEmptyStrings)(ctx.impl.agentContext ?? []);
    if (agentContext.length > 0) {
        lines.push(...(0, shared_rendering_1.renderAdvisoryContext)('hints emitted by the generator; treat as supplementary context, not separate tasks', agentContext));
    }
    const firstStep = ctx.impl.hasDiffContext
        ? `1. Inspect this migration's changes. ${(0, shared_rendering_1.renderGitInspectInstruction)()} Resolve each affected path to its owning Nx project via \`nx show project <name>\` (or by reading the project's \`project.json\` / \`package.json\`) to discover which targets each project actually defines — do not assume \`typecheck\` / \`test\` / \`lint\` exist. If no typecheck-equivalent exists, \`build\` is an acceptable substitute.`
        : `1. Resolve each path in <files_changed> to its owning Nx project. Use \`nx show project <name>\` (or read the project's \`project.json\` / \`package.json\`) to discover which targets each project actually defines — do not assume \`typecheck\` / \`test\` / \`lint\` exist. If no typecheck-equivalent exists, \`build\` is an acceptable substitute.`;
    lines.push(``, `<validation_instructions>`, firstStep, `2. Pick the smallest relevant subset of available targets to verify the change. Prefer \`nx affected -t <target>\` (or \`nx run <project>:<target>\` for a single project). When many small projects are affected, you may use \`nx run-many -t <target> -p <project1>,<project2>\` with the project list derived from the changed files. Unscoped \`nx run-many\` (no \`-p\`) is forbidden.`, `3. If a verification surfaces an issue the migration should have produced cleanly (e.g. a missing import, a type annotation the generator's template missed), you may apply a minor in-scope fix. The boundary is "what this migration intended to accomplish" — do not refactor, do not modify functionality unrelated to the migration, do not extend the migration's scope, do not touch code the migration was not concerned with. If you are unsure whether a fix is in scope, report it in \`summary\` instead of applying.`, `4. Apply every fix you can within scope, then end the step per the handoff contract. If everything is resolved, write your handoff with \`status: "success"\`, summarizing what you verified and any fixes you applied. If unresolved findings remain, report them to the user and ask how to proceed before writing any handoff; on a \`status: "failed"\` handoff, enumerate the findings in \`summary\` so the user can address them — no commit will be created from a failed run, so the generator's changes and your partial fixes will sit uncommitted in the working tree for the user to review.`, `</validation_instructions>`, ``, `When you end the step per the handoff contract, your handoff path is:`, ...(0, shared_rendering_1.renderHandoffPathFooter)(ctx.handoffFileAbsolutePath));
    return lines.join('\n');
}
function renderFileListBody(changes) {
    // File paths from `tree.write` are user-authored; escape `<` / `&` so a
    // hostile path can't break out of `<files_changed>`. `change.type` is an
    // nx-controlled enum (CREATE/UPDATE/DELETE) and needs no escape.
    const safe = changes.map((change) => ({
        ...change,
        path: (0, shared_rendering_1.escapeXmlBody)(change.path),
    }));
    if (safe.length <= exports.GENERIC_VALIDATION_FILE_LIST_CAP) {
        return safe.map(shared_rendering_1.renderFileEntry);
    }
    const shown = safe.slice(0, exports.GENERIC_VALIDATION_FILE_LIST_CAP);
    const remaining = safe.length - exports.GENERIC_VALIDATION_FILE_LIST_CAP;
    return [
        ...shown.map(shared_rendering_1.renderFileEntry),
        ``,
        `… and ${remaining} more file${remaining === 1 ? '' : 's'}.`,
    ];
}

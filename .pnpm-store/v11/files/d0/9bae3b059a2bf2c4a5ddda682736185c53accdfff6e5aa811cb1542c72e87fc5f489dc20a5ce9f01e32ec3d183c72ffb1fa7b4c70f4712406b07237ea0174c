"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAgenticPromptStep = runAgenticPromptStep;
const tslib_1 = require("tslib");
const path_1 = require("path");
const pc = tslib_1.__importStar(require("picocolors"));
const child_process_1 = require("../../../utils/child-process");
const logger_1 = require("../../../utils/logger");
const package_manager_1 = require("../../../utils/package-manager");
const migrate_output_1 = require("../migrate-output");
const handoff_1 = require("./handoff");
const generic_validation_1 = require("./prompts/generic-validation");
const hybrid_prompt_migration_1 = require("./prompts/hybrid-prompt-migration");
const prompt_migration_1 = require("./prompts/prompt-migration");
const system_prompt_1 = require("./prompts/system-prompt");
const definitions_1 = require("./definitions");
const runner_1 = require("./runner");
/**
 * Spawns the configured AI agent against a migration step, awaits its handoff,
 * and translates the outcome into a structured result the executor can branch
 * on. Throws on failure / abort; returns a result with `ambiguous` set when
 * the agent exited without writing a handoff and the user chose to continue.
 *
 * `installDepsIfChanged` is a callback rather than a `ChangedDepInstaller`
 * instance so this module stays decoupled from the executor's internal state.
 * The structural `migration` type captures only the fields read here, keeping
 * the file free of cross-imports with the orchestrator.
 */
async function runAgenticPromptStep(input) {
    const { root, migration, agentic, runDir, installDepsIfChanged, implContext, documentationPath, mode = 'author', } = input;
    const handoffFilePath = (0, handoff_1.stepHandoffPath)(runDir, migration);
    // The system prompt tells the agent the parent dir exists, so the agent
    // doesn't defensively `mkdir -p` (which triggers a workspace-permission
    // prompt in agents like Claude Code every run).
    (0, handoff_1.mkdirSafely)((0, path_1.dirname)(handoffFilePath), `handoff directory for ${migration.name}`);
    const pm = (0, package_manager_1.detectPackageManager)(root);
    const systemContext = (0, system_prompt_1.buildSystemPrompt)({
        workspaceRoot: root,
        handoffFileAbsolutePath: handoffFilePath,
        packageManager: pm,
        nxInvocation: (0, child_process_1.getRunNxBaseCommand)((0, package_manager_1.getPackageManagerCommand)(pm, root), root),
        mode,
    });
    let userPrompt;
    if (mode === 'generic-validation') {
        if (!implContext) {
            throw new Error(`Internal error: generic-validation mode requires impl context (logs, changes, agentContext, hasDiffContext) but none was provided.`);
        }
        userPrompt = (0, generic_validation_1.buildGenericValidationUserPrompt)({
            package: migration.package,
            name: migration.name,
            version: migration.version,
            description: migration.description,
            handoffFileAbsolutePath: handoffFilePath,
            documentationPath,
            impl: implContext,
        });
    }
    else {
        const promptCtx = {
            package: migration.package,
            name: migration.name,
            version: migration.version,
            description: migration.description,
            promptPath: migration.prompt,
            handoffFileAbsolutePath: handoffFilePath,
            documentationPath,
        };
        userPrompt = implContext
            ? (0, hybrid_prompt_migration_1.buildHybridPromptUserPrompt)({ ...promptCtx, impl: implContext })
            : (0, prompt_migration_1.buildPromptMigrationUserPrompt)(promptCtx);
    }
    const definition = (0, definitions_1.getAgentDefinition)(agentic.selectedAgent.id);
    if (!definition) {
        throw new Error(`No agent definition registered for "${agentic.selectedAgent.id}".`);
    }
    const phase = mode === 'generic-validation' ? 'Validating' : 'Running prompt';
    logger_1.logger.info(pc.dim(`→ ${phase} with ${agentic.selectedAgent.displayName}…`));
    const outcome = await (0, runner_1.runAgentic)({
        detected: agentic.selectedAgent,
        definition,
        invocationContext: {
            systemContext,
            userPrompt,
            workspaceRoot: root,
            runDirName: (0, path_1.basename)(runDir),
        },
        handoffFilePath,
    });
    // Some agent TUIs leave cursor/SGR state behind on exit. Reset before our
    // own log lines so the outcome line lands clean instead of overlaid on the
    // agent's trailing status bar.
    (0, migrate_output_1.resetSgrAfterAgent)();
    switch (outcome.kind) {
        case 'success':
            await installDepsIfChanged();
            return { summary: outcome.summary, ambiguous: false };
        case 'ambiguous-continue':
            await installDepsIfChanged();
            return {
                summary: 'No handoff file was written; marked complete by user.',
                ambiguous: true,
            };
        case 'failed': {
            const failLabel = mode === 'generic-validation' ? 'Validation failed' : 'Failed';
            logger_1.logger.info(`${pc.red('✗')} ${failLabel}: ${outcome.summary}`);
            throw new Error(`Prompt migration ${migration.package}: ${migration.name} failed.`);
        }
        case 'ambiguous-abort':
            // When Ctrl+C masked an underlying crash, the runner forwards the
            // pre-rendered cause lines so we surface them before "Aborted by
            // user" — otherwise the user sees only "aborted" with no signal that
            // anything also crashed. When the abort came from the user picking
            // "abort" at the prompt, the cause was already shown there.
            if (outcome.causeSummary && outcome.causeSummary.length > 0) {
                logger_1.logger.info(pc.dim('The agent run ended without a usable handoff:'));
                for (const line of outcome.causeSummary) {
                    logger_1.logger.info(pc.dim(`  ${line}`));
                }
            }
            logger_1.logger.info(`${pc.red('✗')} Aborted by user.`);
            throw new Error(`Prompt migration ${migration.package}: ${migration.name} was aborted by user.`);
    }
}

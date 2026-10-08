"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.showTargetOutputsHandler = showTargetOutputsHandler;
const check_task_files_1 = require("../../../hasher/check-task-files");
const utils_1 = require("../../../tasks-runner/utils");
const utils_2 = require("./utils");
// ── Handler ─────────────────────────────────────────────────────────
async function showTargetOutputsHandler(args) {
    const t = await (0, utils_2.resolveTarget)(args);
    const { projectName, targetName, configuration } = t;
    const taskId = (0, utils_1.createTaskId)(projectName, targetName, configuration);
    const outputs = await (0, check_task_files_1.getTaskOutputs)(taskId, {
        projectGraph: t.graph,
        nxJson: t.nxJson,
    });
    if (args.check !== undefined) {
        const results = await checkOutputs(taskId, args.check, outputs);
        (0, utils_2.renderCheckResults)(results, projectName, targetName, 'output');
        (0, utils_2.setCheckExitCode)(results);
        return;
    }
    renderOutputs(projectName, targetName, outputs, args);
}
// ── Data resolution ─────────────────────────────────────────────────
async function checkOutputs(taskId, check, { resolved, expanded }) {
    const checkItems = (0, utils_2.deduplicateFolderEntries)(check);
    const paths = checkItems.map(utils_2.normalizePath);
    // checkFilesAreOutputs handles exact, directory-prefix and glob matching (and
    // `!` exclusions) through the same native engine the task runner uses.
    const { matched } = await (0, check_task_files_1.checkFilesAreOutputs)(taskId, paths);
    const matchedPaths = new Set(matched);
    return checkItems.map((value, i) => {
        const path = paths[i];
        const isMatch = matchedPaths.has(path);
        return {
            value,
            file: path,
            matched: isMatch,
            contained: isMatch
                ? []
                : [
                    ...new Set([
                        ...(0, utils_2.pathsUnder)(path, resolved),
                        ...(0, utils_2.pathsUnder)(path, expanded),
                    ]),
                ],
        };
    });
}
// ── Render ──────────────────────────────────────────────────────────
function renderOutputs(project, target, { resolved, expanded, unresolved }, args) {
    if (args.json) {
        (0, utils_2.printJson)({
            project,
            target,
            outputPaths: resolved,
            expandedOutputs: expanded,
            unresolvedOutputs: unresolved,
        });
        return;
    }
    const c = (0, utils_2.pc)();
    console.log(`${c.bold('Output paths for')} ${c.cyan(project)}:${c.green(target)}`);
    (0, utils_2.printList)('Configured outputs', resolved);
    (0, utils_2.printList)('Resolved outputs', expanded);
    (0, utils_2.printList)(`${c.yellow('Unresolved outputs')} (option not set)`, unresolved);
    if (resolved.length === 0 && unresolved.length === 0) {
        console.log(`\n  No outputs configured for this target.`);
    }
}

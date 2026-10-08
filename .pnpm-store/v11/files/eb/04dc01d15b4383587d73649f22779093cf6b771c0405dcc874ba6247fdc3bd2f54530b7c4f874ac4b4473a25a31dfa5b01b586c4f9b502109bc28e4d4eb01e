"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.showTargetInputsHandler = showTargetInputsHandler;
const check_task_files_1 = require("../../../hasher/check-task-files");
const utils_1 = require("../../../tasks-runner/utils");
const utils_2 = require("./utils");
// ── Handler ─────────────────────────────────────────────────────────
async function showTargetInputsHandler(args) {
    const t = await (0, utils_2.resolveTarget)(args);
    const { projectName, targetName, configuration } = t;
    if ((0, utils_2.hasCustomHasher)(projectName, targetName, t.graph)) {
        renderCustomHasherWarning(projectName, targetName, args);
        process.exitCode = 1;
        return;
    }
    const taskId = (0, utils_1.createTaskId)(projectName, targetName, configuration);
    const hashInputs = await (0, check_task_files_1.getTaskRawInputs)(taskId, {
        projectGraph: t.graph,
        nxJson: t.nxJson,
    });
    if (!hashInputs) {
        throw new Error(`Could not find hash plan for task "${taskId}".`);
    }
    if (args.check !== undefined) {
        const results = await checkInputs(taskId, args.check, hashInputs);
        (0, utils_2.renderCheckResults)(results, projectName, targetName, 'input');
        (0, utils_2.setCheckExitCode)(results);
        return;
    }
    renderInputs({ project: projectName, target: targetName, ...hashInputs }, t.node.data.targets[targetName].inputs, args);
}
// ── Data resolution ─────────────────────────────────────────────────
async function checkInputs(taskId, check, hashInputs) {
    // checkFilesAreInputs matches environment/runtime/external names against the
    // raw argument and paths against the workspace-relative form, so both are
    // passed through — it has no cwd of its own.
    const candidates = (0, utils_2.deduplicateFolderEntries)(check).map((value) => ({
        value,
        path: (0, utils_2.normalizePath)(value),
    }));
    const { categories } = await (0, check_task_files_1.checkFilesAreInputs)(taskId, candidates);
    return candidates.map(({ value, path }) => {
        const category = categories.get(value);
        return {
            value,
            file: path,
            matched: !!category,
            category,
            contained: category ? [] : (0, utils_2.pathsUnder)(path, hashInputs.files),
        };
    });
}
// ── Render ──────────────────────────────────────────────────────────
function renderInputs(data, configuredInputs, args) {
    if (args.json) {
        (0, utils_2.printJson)(data);
        return;
    }
    const c = (0, utils_2.pc)();
    console.log(`${c.bold('Inputs for')} ${c.cyan(data.project)}:${c.green(data.target)}`);
    if (configuredInputs?.length) {
        (0, utils_2.printList)('Configured inputs', configuredInputs.map((i) => typeof i === 'string' ? i : JSON.stringify(i)));
    }
    (0, utils_2.printList)('External dependencies', [...data.external].sort());
    (0, utils_2.printList)('Runtime inputs', [...data.runtime].sort());
    (0, utils_2.printList)('Environment variables', [...data.environment].sort());
    (0, utils_2.printList)(`Files (${data.files.length})`, [...data.files, ...data.depOutputs].sort());
}
function renderCustomHasherWarning(projectName, targetName, args) {
    const c = (0, utils_2.pc)();
    if (args.json) {
        (0, utils_2.printJson)({
            project: projectName,
            target: targetName,
            warning: 'This target uses a custom hasher. Configured inputs do not affect the cache hash.',
        });
        return;
    }
    const label = `${c.cyan(projectName)}:${c.green(targetName)}`;
    console.log(`\n${c.yellow('⚠')} ${label} uses a ${c.yellow('custom hasher')}.`);
    console.log(`  Configured inputs do not affect the cache hash for this target.`);
    console.log(`  The executor's hasher determines what is included in the hash.`);
}

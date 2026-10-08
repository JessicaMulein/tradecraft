"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeLinterOption = normalizeLinterOption;
exports.normalizeUnitTestRunnerOption = normalizeUnitTestRunnerOption;
const internal_1 = require("@nx/devkit/internal");
const ts_solution_setup_1 = require("./typescript/ts-solution-setup");
const linter_1 = require("./linter");
async function normalizeLinterOption(tree, linter) {
    if (linter) {
        return linter;
    }
    // Following the workspace is not a question. When it already has a linter,
    // use it — including in a hybrid workspace, where `detectLinters` puts the
    // one being migrated *to* first. Pass `--linter` to choose something else.
    const [detected] = (0, linter_1.detectLinters)(tree);
    if (detected) {
        return detected;
    }
    // Nothing to follow, so this is a real choice. `none` is the non-interactive
    // answer, and leads the list so the interactive default matches it.
    return (0, internal_1.isInteractive)()
        ? (0, internal_1.selectPrompt)({
            message: `Which linter would you like to use?`,
            choices: [{ value: 'none' }, { value: 'eslint' }, { value: 'oxlint' }],
        })
        : 'none';
}
async function normalizeUnitTestRunnerOption(tree, unitTestRunner, testRunners = ['jest', 'vitest']) {
    if (unitTestRunner) {
        return unitTestRunner;
    }
    const isTsSolutionSetup = (0, ts_solution_setup_1.isUsingTsSolutionSetup)(tree);
    const choices = (isTsSolutionSetup ? ['none', ...testRunners] : [...testRunners, 'none']).map((value) => ({ value: value }));
    const defaultValue = (isTsSolutionSetup ? 'none' : testRunners[0]);
    return (0, internal_1.isInteractive)()
        ? (0, internal_1.selectPrompt)({
            message: `Which unit test runner would you like to use?`,
            choices,
        })
        : defaultValue;
}

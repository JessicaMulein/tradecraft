"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEslintTargets = getEslintTargets;
const internal_1 = require("@nx/devkit/internal");
function getEslintTargets(tree) {
    const eslintTargetNames = new Set();
    (0, internal_1.forEachExecutorOptions)(tree, '@nx/eslint:lint', (_, __, target) => {
        eslintTargetNames.add(target);
    });
    (0, internal_1.forEachExecutorOptions)(tree, '@nx/linter:eslint', (_, __, target) => {
        eslintTargetNames.add(target);
    });
    (0, internal_1.forEachExecutorOptions)(tree, '@nrwl/linter:eslint', (_, __, target) => {
        eslintTargetNames.add(target);
    });
    return eslintTargetNames;
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ESLINT_EXECUTOR_DEPRECATION_MESSAGE = void 0;
exports.warnEslintExecutorDeprecation = warnEslintExecutorDeprecation;
exports.warnEslintExecutorGenerating = warnEslintExecutorGenerating;
const devkit_1 = require("@nx/devkit");
// TODO(v24): Remove the @nx/eslint:lint executor. The inferred plugin
// (@nx/eslint/plugin) and the convert-to-inferred generator stay supported.
exports.ESLINT_EXECUTOR_DEPRECATION_MESSAGE = 'The `@nx/eslint:lint` executor is deprecated and will be removed in Nx v24. Run `nx g @nx/eslint:convert-to-inferred` to migrate to the `@nx/eslint/plugin` inferred targets. See https://nx.dev/docs/guides/tasks--caching/convert-to-inferred for details.';
function warnEslintExecutorDeprecation() {
    devkit_1.logger.warn(exports.ESLINT_EXECUTOR_DEPRECATION_MESSAGE);
}
function warnEslintExecutorGenerating() {
    devkit_1.logger.warn('Generating a target that uses the deprecated `@nx/eslint:lint` executor. The executor will be removed in Nx v24. Run `nx g @nx/eslint:convert-to-inferred` next to migrate this target to the `@nx/eslint/plugin` inferred plugin and prevent future generators from emitting executor targets. See https://nx.dev/docs/guides/tasks--caching/convert-to-inferred for details.');
}

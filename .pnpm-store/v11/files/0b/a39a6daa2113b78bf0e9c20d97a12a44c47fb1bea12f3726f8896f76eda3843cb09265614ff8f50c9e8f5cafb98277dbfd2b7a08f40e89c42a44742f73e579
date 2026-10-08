"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertToInferred = convertToInferred;
const devkit_1 = require("@nx/devkit");
const internal_1 = require("@nx/devkit/internal");
const plugin_1 = require("../../plugins/plugin");
const test_post_target_transformer_1 = require("./lib/test-post-target-transformer");
const assert_supported_vitest_version_1 = require("../../utils/assert-supported-vitest-version");
async function convertToInferred(tree, options) {
    (0, assert_supported_vitest_version_1.assertSupportedVitestVersion)(tree);
    const projectGraph = await (0, devkit_1.createProjectGraphAsync)();
    const migratedProjects = await (0, internal_1.migrateProjectExecutorsToPlugin)(tree, projectGraph, '@nx/vitest', plugin_1.createNodesV2, { testTargetName: 'test' }, [
        {
            executors: ['@nx/vitest:test'],
            postTargetTransformer: test_post_target_transformer_1.testPostTargetTransformer,
            targetPluginOptionMapper: (target) => ({ testTargetName: target }),
        },
    ], options.project);
    if (migratedProjects.size === 0) {
        throw new internal_1.NoTargetsToMigrateError();
    }
    if (!options.skipFormat) {
        await (0, devkit_1.formatFiles)(tree);
    }
}
exports.default = convertToInferred;

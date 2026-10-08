"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initGenerator = initGenerator;
exports.initGeneratorInternal = initGeneratorInternal;
const internal_1 = require("@nx/devkit/internal");
const devkit_1 = require("@nx/devkit");
const path_1 = require("path");
const plugin_1 = require("../../plugins/typescript/plugin");
const assert_supported_typescript_version_1 = require("../../utils/assert-supported-typescript-version");
const formatter_setup_1 = require("../../utils/formatter-setup");
const nx_formatter_internals_1 = require("../../utils/nx-formatter-internals");
const create_ts_config_1 = require("../../utils/typescript/create-ts-config");
const ts_config_1 = require("../../utils/typescript/ts-config");
const ts_solution_setup_1 = require("../../utils/typescript/ts-solution-setup");
const versions_1 = require("../../utils/versions");
async function initGenerator(tree, schema) {
    schema.addTsPlugin ??= false;
    // Detection is the only thing here that needs the nx-side helpers, so the
    // assert belongs with it: `'none'` must still work on an older peer-compatible
    // nx, and it reaches no formatter code at all. An explicit `'prettier'` or
    // `'oxfmt'` does not - both setups assert for themselves.
    if (schema.formatter == null) {
        (0, nx_formatter_internals_1.assertNxSupportsFormatters)();
        // Defer to `detectFormatterInTree` rather than re-deriving: it encodes the
        // oxfmt-over-prettier precedence, which a prettier-first check gets
        // backwards for a workspace configured with both. Falling back to "none"
        // rather than a formatter keeps this from installing one the caller never
        // asked for.
        schema.formatter = (0, internal_1.detectFormatterInTree)(tree) ?? 'none';
    }
    return initGeneratorInternal(tree, {
        addTsConfigBase: true,
        ...schema,
    });
}
async function initGeneratorInternal(tree, schema) {
    (0, assert_supported_typescript_version_1.assertSupportedTypescriptVersion)(tree);
    const tasks = [];
    const nxJson = (0, devkit_1.readNxJson)(tree);
    schema.addPlugin ??=
        process.env.NX_ADD_PLUGINS !== 'false' &&
            nxJson.useInferencePlugins !== false;
    schema.addTsPlugin ??= schema.addPlugin;
    if (schema.addTsPlugin) {
        await (0, internal_1.addPlugin)(tree, await (0, devkit_1.createProjectGraphAsync)(), '@nx/js/typescript', plugin_1.createNodesV2, {
            typecheck: [
                { targetName: 'typecheck' },
                { targetName: 'tsc:typecheck' },
                { targetName: 'tsc-typecheck' },
            ],
            build: [
                {
                    targetName: 'build',
                    configName: 'tsconfig.lib.json',
                    buildDepsName: 'build-deps',
                    watchDepsName: 'watch-deps',
                },
                {
                    targetName: 'tsc:build',
                    configName: 'tsconfig.lib.json',
                    buildDepsName: 'tsc:build-deps',
                    watchDepsName: 'tsc:watch-deps',
                },
                {
                    targetName: 'tsc-build',
                    configName: 'tsconfig.lib.json',
                    buildDepsName: 'tsc-build-deps',
                    watchDepsName: 'tsc-watch-deps',
                },
            ],
        }, schema.updatePackageScripts);
    }
    if (schema.addTsConfigBase && !(0, ts_config_1.getRootTsConfigFileName)(tree)) {
        if (schema.addTsPlugin) {
            const platform = schema.platform ?? 'node';
            const customCondition = (0, ts_solution_setup_1.getCustomConditionName)(tree);
            (0, devkit_1.generateFiles)(tree, (0, path_1.join)(__dirname, './files/ts-solution'), '.', {
                platform,
                customCondition,
                tmpl: '',
            });
        }
        else {
            (0, devkit_1.generateFiles)(tree, (0, path_1.join)(__dirname, './files/non-ts-solution'), '.', {
                fileName: schema.tsConfigName ?? 'tsconfig.base.json',
                moduleResolution: (0, create_ts_config_1.getTsConfigBaseOptions)(tree).moduleResolution,
            });
        }
    }
    const devDependencies = {
        '@nx/js': versions_1.nxVersion,
        // Required by SWC-compiled output (decorators -> @swc/helpers/_/_ts_decorate
        // imports). The default @nx/jest setup transforms with @swc/jest, so any
        // workspace using decorators (NestJS, Angular, etc.) needs @swc/helpers
        // resolvable at test time. Cheap to ship and avoids per-generator install.
        '@swc/helpers': versions_1.swcHelpersVersion,
    };
    // @swc-node/register and @swc/core are no longer installed by init - native
    // Node.js type stripping handles .ts config loading on Node 23+ (or 22.6+
    // with --experimental-strip-types). loadTsFile registers swc/ts-node lazily
    // when a config uses syntax native strip can't handle.
    if (!schema.js) {
        devDependencies['typescript'] = versions_1.typescriptVersion;
    }
    // One table drives both halves of formatter setup - writing the config and
    // making the package resolvable further down. They were separate `if` chains
    // over the same union, forty lines apart, so a third formatter meant finding
    // both.
    const formatterSetup = (0, formatter_setup_1.getFormatterSetup)(schema.formatter);
    if (formatterSetup) {
        tasks.push(formatterSetup.setUp(tree, { skipPackageJson: schema.skipPackageJson }));
    }
    const rootTsConfigFileName = (0, ts_config_1.getRootTsConfigFileName)(tree);
    // If the root tsconfig file uses `importHelpers` then we must install tslib
    // in order to run tsc for build and typecheck.
    if (rootTsConfigFileName) {
        const rootTsConfig = (0, devkit_1.readJson)(tree, rootTsConfigFileName);
        if (rootTsConfig.compilerOptions?.importHelpers) {
            devDependencies['tslib'] = versions_1.tsLibVersion;
        }
    }
    const installTask = !schema.skipPackageJson
        ? (0, devkit_1.addDependenciesToPackageJson)(tree, {}, devDependencies, undefined, schema.keepExistingVersions ?? true)
        : () => { };
    tasks.push(installTask);
    // `installTask` is queued, not run, so the formatter just added to
    // package.json is not on disk yet; ensurePackage installs it out of band.
    // Not gated on `skipFormat` - callers that pass it format later in this same
    // process.
    const isDryRun = !!process.env.NX_DRY_RUN && process.env.NX_DRY_RUN !== 'false';
    if (formatterSetup &&
        !schema.skipPackageJson &&
        !isDryRun &&
        process.env.NX_SKIP_FORMAT !== 'true') {
        (0, devkit_1.ensurePackage)(schema.formatter, formatterSetup.version);
    }
    if (!schema.skipFormat) {
        await (0, devkit_1.formatFiles)(tree);
    }
    return (0, devkit_1.runTasksInSerial)(...tasks);
}
exports.default = initGenerator;

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.presetGenerator = presetGenerator;
const devkit_1 = require("@nx/devkit");
const presets_1 = require("../utils/presets");
const path_1 = require("path");
async function presetGenerator(tree, options) {
    const presetTask = await createPreset(tree, options);
    return async () => {
        (0, devkit_1.installPackagesTask)(tree);
        if (presetTask)
            await presetTask();
    };
}
exports.default = presetGenerator;
async function createPreset(tree, options) {
    const nxJson = (0, devkit_1.readNxJson)(tree);
    const addPlugin = process.env.NX_ADD_PLUGINS !== 'false' &&
        nxJson.useInferencePlugins !== false;
    if (options.preset === presets_1.Preset.Apps || options.preset === presets_1.Preset.NPM) {
        // These presets generate no project, so nothing downstream would set the
        // formatter up and the choice would be dropped. Only the formatter is
        // configured here - `@nx/js:init` would also add TypeScript and register
        // its plugin, which both presets deliberately leave out.
        //
        // `@nx/js` is only in the new workspace's package.json, not necessarily on
        // disk. `validateOptions` allows `skipInstall` with these presets, so the
        // require has to be reached only when there is a formatter to set up AND
        // the install that puts `@nx/js` there actually ran.
        if (!options.formatter || options.formatter === 'none') {
            return;
        }
        if (options.skipInstall) {
            // No follow-up command to name: `@nx/js:init` is what sets a formatter
            // up, and running it here is what the comment above rules out for these
            // presets.
            devkit_1.logger.warn(`Skipped ${options.formatter} setup: it lives in @nx/js, which --skipInstall leaves uninstalled.`);
            return;
        }
        const { setUpFormatter } = require('@nx' + '/js');
        return setUpFormatter(tree, options.formatter);
    }
    else if (options.preset === presets_1.Preset.AngularMonorepo) {
        const { applicationGenerator: angularApplicationGenerator } = require('@nx' + '/angular/generators');
        if (options.bundler &&
            !['webpack', 'rspack', 'esbuild'].includes(options.bundler)) {
            throw new Error(`Invalid bundler: ${options.bundler}. Please use one of the following: 'esbuild', 'webpack', 'rspack'.`);
        }
        return angularApplicationGenerator(tree, {
            name: options.name,
            directory: (0, path_1.join)('apps', options.name),
            style: options.style,
            linter: options.linter,
            standalone: options.standaloneApi,
            routing: options.routing,
            e2eTestRunner: options.e2eTestRunner ?? 'playwright',
            unitTestRunner: options.unitTestRunner,
            bundler: options.bundler,
            ssr: options.ssr,
            prefix: options.prefix,
            zoneless: options.zoneless,
            formatter: options.formatter,
            nxCloudToken: options.nxCloudToken,
        });
    }
    else if (options.preset === presets_1.Preset.AngularStandalone) {
        const { applicationGenerator: angularApplicationGenerator } = require('@nx' + '/angular/generators');
        if (options.bundler &&
            !['webpack', 'rspack', 'esbuild'].includes(options.bundler)) {
            throw new Error(`Invalid bundler: ${options.bundler}. Please use one of the following: 'esbuild', 'webpack', 'rspack'.`);
        }
        return angularApplicationGenerator(tree, {
            name: options.name,
            directory: '.',
            style: options.style,
            linter: options.linter,
            routing: options.routing,
            rootProject: true,
            standalone: options.standaloneApi,
            e2eTestRunner: options.e2eTestRunner ?? 'playwright',
            unitTestRunner: options.unitTestRunner,
            bundler: options.bundler,
            ssr: options.ssr,
            prefix: options.prefix,
            zoneless: options.zoneless,
            formatter: options.formatter,
            nxCloudToken: options.nxCloudToken,
        });
    }
    else if (options.preset === presets_1.Preset.ReactMonorepo) {
        const { applicationGenerator: reactApplicationGenerator } = require('@nx' + '/react');
        return reactApplicationGenerator(tree, {
            name: options.workspaces ? undefined : options.name,
            directory: (0, path_1.join)('apps', options.name),
            style: options.style,
            linter: options.linter,
            bundler: options.bundler ?? 'webpack',
            e2eTestRunner: options.e2eTestRunner ?? 'playwright',
            unitTestRunner: options.unitTestRunner ??
                (options.bundler === 'vite' ? 'vitest' : 'jest'),
            addPlugin,
            routing: options.routing,
            useReactRouter: options.useReactRouter,
            nxCloudToken: options.nxCloudToken,
            useTsSolution: options.workspaces,
            formatter: options.formatter,
            useProjectJson: options.useProjectJson,
        });
    }
    else if (options.preset === presets_1.Preset.ReactStandalone) {
        const { applicationGenerator: reactApplicationGenerator } = require('@nx' + '/react');
        const bundler = options.bundler ?? 'vite';
        return reactApplicationGenerator(tree, {
            name: options.name,
            directory: '.',
            style: options.style,
            linter: options.linter,
            rootProject: true,
            bundler,
            routing: options.routing,
            useReactRouter: options.useReactRouter,
            e2eTestRunner: options.e2eTestRunner ?? 'playwright',
            unitTestRunner: options.unitTestRunner ?? (bundler === 'vite' ? 'vitest' : 'jest'),
            addPlugin,
            nxCloudToken: options.nxCloudToken,
            formatter: options.formatter,
        });
    }
    else if (options.preset === presets_1.Preset.VueMonorepo) {
        const { applicationGenerator: vueApplicationGenerator } = require('@nx' + '/vue');
        return vueApplicationGenerator(tree, {
            name: options.workspaces ? undefined : options.name,
            directory: (0, path_1.join)('apps', options.name),
            style: options.style,
            linter: options.linter,
            e2eTestRunner: options.e2eTestRunner ?? 'playwright',
            unitTestRunner: options.unitTestRunner,
            addPlugin,
            nxCloudToken: options.nxCloudToken,
            useTsSolution: options.workspaces,
            formatter: options.formatter,
            useProjectJson: options.useProjectJson,
        });
    }
    else if (options.preset === presets_1.Preset.VueStandalone) {
        const { applicationGenerator: vueApplicationGenerator } = require('@nx' + '/vue');
        return vueApplicationGenerator(tree, {
            name: options.name,
            directory: '.',
            style: options.style,
            linter: options.linter,
            rootProject: true,
            e2eTestRunner: options.e2eTestRunner ?? 'playwright',
            unitTestRunner: options.unitTestRunner ?? 'vitest',
            addPlugin,
            nxCloudToken: options.nxCloudToken,
            formatter: options.formatter,
        });
    }
    else if (options.preset === presets_1.Preset.Nuxt) {
        const { applicationGenerator: nuxtApplicationGenerator } = require('@nx' + '/nuxt');
        return nuxtApplicationGenerator(tree, {
            name: options.workspaces ? undefined : options.name,
            directory: (0, path_1.join)('apps', options.name),
            style: options.style,
            linter: options.linter,
            e2eTestRunner: options.e2eTestRunner ?? 'playwright',
            unitTestRunner: options.unitTestRunner,
            addPlugin,
            nxCloudToken: options.nxCloudToken,
            useTsSolution: options.workspaces,
            formatter: options.formatter,
            useProjectJson: options.useProjectJson,
        });
    }
    else if (options.preset === presets_1.Preset.NuxtStandalone) {
        const { applicationGenerator: nuxtApplicationGenerator } = require('@nx' + '/nuxt');
        return nuxtApplicationGenerator(tree, {
            name: options.name,
            directory: '.',
            style: options.style,
            linter: options.linter,
            rootProject: true,
            e2eTestRunner: options.e2eTestRunner ?? 'playwright',
            unitTestRunner: options.unitTestRunner ?? 'vitest',
            addPlugin,
            nxCloudToken: options.nxCloudToken,
            formatter: options.formatter,
        });
    }
    else if (options.preset === presets_1.Preset.NextJs) {
        const { applicationGenerator: nextApplicationGenerator } = require('@nx' + '/next');
        return nextApplicationGenerator(tree, {
            name: options.workspaces ? undefined : options.name,
            directory: (0, path_1.join)('apps', options.name),
            style: options.style,
            linter: options.linter,
            appDir: options.nextAppDir,
            src: options.nextSrcDir,
            e2eTestRunner: options.e2eTestRunner ?? 'playwright',
            unitTestRunner: options.unitTestRunner,
            addPlugin,
            useTsSolution: options.workspaces,
            formatter: options.formatter,
            useProjectJson: options.useProjectJson,
        });
    }
    else if (options.preset === presets_1.Preset.NextJsStandalone) {
        const { applicationGenerator: nextApplicationGenerator } = require('@nx' + '/next');
        return nextApplicationGenerator(tree, {
            name: options.name,
            directory: '.',
            style: options.style,
            linter: options.linter,
            appDir: options.nextAppDir,
            src: options.nextSrcDir,
            e2eTestRunner: options.e2eTestRunner ?? 'playwright',
            unitTestRunner: options.unitTestRunner,
            rootProject: true,
            addPlugin,
            formatter: options.formatter,
        });
    }
    else if (options.preset === presets_1.Preset.WebComponents) {
        const { applicationGenerator: webApplicationGenerator } = require('@nx' + '/web');
        return webApplicationGenerator(tree, {
            name: options.workspaces ? undefined : options.name,
            directory: (0, path_1.join)('apps', options.name),
            style: options.style,
            linter: options.linter,
            bundler: 'vite',
            e2eTestRunner: options.e2eTestRunner ?? 'playwright',
            addPlugin,
            nxCloudToken: options.nxCloudToken,
            formatter: options.formatter,
        });
    }
    else if (options.preset === presets_1.Preset.Nest) {
        const { applicationGenerator: nestApplicationGenerator } = require('@nx' + '/nest');
        return nestApplicationGenerator(tree, {
            name: options.workspaces ? undefined : options.name,
            directory: (0, path_1.join)('apps', options.name),
            linter: options.linter,
            e2eTestRunner: options.e2eTestRunner ?? 'jest',
            unitTestRunner: options.unitTestRunner,
            addPlugin,
            useTsSolution: options.workspaces,
            formatter: options.formatter,
            useProjectJson: options.useProjectJson,
        });
    }
    else if (options.preset === presets_1.Preset.Express) {
        const { applicationGenerator: expressApplicationGenerator } = require('@nx' + '/express');
        return expressApplicationGenerator(tree, {
            name: options.workspaces ? undefined : options.name,
            directory: (0, path_1.join)('apps', options.name),
            linter: options.linter,
            e2eTestRunner: options.e2eTestRunner ?? 'jest',
            unitTestRunner: options.unitTestRunner,
            addPlugin,
            useTsSolution: options.workspaces,
            formatter: options.formatter,
            useProjectJson: options.useProjectJson,
        });
    }
    else if (options.preset === presets_1.Preset.ReactNative) {
        const { reactNativeApplicationGenerator } = require('@nx' + '/react-native');
        return reactNativeApplicationGenerator(tree, {
            name: options.workspaces ? undefined : options.name,
            directory: (0, path_1.join)('apps', options.name),
            linter: options.linter,
            e2eTestRunner: options.e2eTestRunner ?? 'detox',
            unitTestRunner: options.unitTestRunner,
            addPlugin,
            nxCloudToken: options.nxCloudToken,
            bundler: options.bundler ?? 'webpack',
            useTsSolution: options.workspaces,
            formatter: options.formatter,
            useProjectJson: options.useProjectJson,
        });
    }
    else if (options.preset === presets_1.Preset.Expo) {
        const { expoApplicationGenerator } = require('@nx' + '/expo');
        return expoApplicationGenerator(tree, {
            name: options.workspaces ? undefined : options.name,
            directory: (0, path_1.join)('apps', options.name),
            linter: options.linter,
            e2eTestRunner: options.e2eTestRunner ?? 'detox',
            unitTestRunner: options.unitTestRunner,
            addPlugin,
            nxCloudToken: options.nxCloudToken,
            useTsSolution: options.workspaces,
            formatter: options.formatter,
            useProjectJson: options.useProjectJson,
        });
    }
    else if (options.preset === presets_1.Preset.TS) {
        const { initGenerator } = require('@nx' + '/js');
        // `validateOptions` allows `skipInstall` here, and this run must then stay
        // install-free: `skipPackageJson` gates both `ensurePackage` and the
        // package.json write that would make `installPackagesTask` install, and
        // `skipFormat` keeps `formatFiles` from loading the formatter. The
        // formatter config is still written, so detection restores the dependency
        // on the next `@nx/js:init`-running generator.
        return initGenerator(tree, {
            formatter: options.formatter,
            addTsPlugin: process.env.NX_ADD_PLUGINS !== 'false' && options.workspaces,
            skipPackageJson: options.skipInstall,
            skipFormat: options.skipInstall,
        });
    }
    else if (options.preset === presets_1.Preset.TsStandalone) {
        const { libraryGenerator } = require('@nx' + '/js');
        return libraryGenerator(tree, {
            name: options.name,
            directory: '.',
            bundler: 'tsc',
            // Forwarded so the library generator's own resolution short-circuits;
            // without it the user is asked which linter to use a second time.
            linter: options.linter,
            unitTestRunner: 'vitest',
            testEnvironment: 'node',
            js: options.js,
            rootProject: true,
            addPlugin,
            formatter: options.formatter,
        });
    }
    else if (options.preset === presets_1.Preset.NodeStandalone) {
        const { applicationGenerator: nodeApplicationGenerator } = require('@nx' + '/node');
        const bundler = options.bundler === 'webpack' ? 'webpack' : 'esbuild';
        return nodeApplicationGenerator(tree, {
            bundler,
            name: options.workspaces ? undefined : options.name,
            directory: '.',
            linter: options.linter,
            framework: options.framework,
            docker: options.docker,
            rootProject: true,
            e2eTestRunner: options.e2eTestRunner ?? 'jest',
            unitTestRunner: options.unitTestRunner,
            addPlugin,
            formatter: options.formatter,
        });
    }
    else if (options.preset === presets_1.Preset.NodeMonorepo) {
        const { applicationGenerator: nodeApplicationGenerator } = require('@nx' + '/node');
        const bundler = options.bundler === 'webpack' ? 'webpack' : 'esbuild';
        return nodeApplicationGenerator(tree, {
            bundler,
            name: options.workspaces ? undefined : options.name,
            directory: (0, path_1.join)('apps', options.name),
            linter: options.linter,
            framework: options.framework,
            docker: options.docker,
            rootProject: false,
            e2eTestRunner: options.e2eTestRunner ?? 'jest',
            unitTestRunner: options.unitTestRunner,
            addPlugin,
            useTsSolution: options.workspaces,
            formatter: options.formatter,
            useProjectJson: options.useProjectJson,
        });
    }
    else {
        throw new Error(`Invalid preset ${options.preset}`);
    }
}

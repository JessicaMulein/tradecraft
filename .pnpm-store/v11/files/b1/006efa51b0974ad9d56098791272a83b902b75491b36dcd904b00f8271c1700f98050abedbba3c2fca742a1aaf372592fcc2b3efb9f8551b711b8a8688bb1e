"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tsConfigBaseOptions = void 0;
exports.getTsConfigBaseOptions = getTsConfigBaseOptions;
exports.extractTsConfigBase = extractTsConfigBase;
const is_typescript_version_at_least_1 = require("../is-typescript-version-at-least");
const devkit_1 = require("@nx/devkit");
exports.tsConfigBaseOptions = {
    rootDir: '.',
    sourceMap: true,
    declaration: false,
    moduleResolution: 'node',
    emitDecoratorMetadata: true,
    experimentalDecorators: true,
    importHelpers: true,
    target: 'es2015',
    module: 'esnext',
    lib: ['es2020', 'dom'],
    skipLibCheck: true,
    skipDefaultLibCheck: true,
    // TS 6.0 flips the `strict` default to true; pin false to keep this base
    // config's behavior identical on TS 5.8 and 6.0.
    strict: false,
    paths: {},
};
function getTsConfigBaseOptions(tree) {
    return {
        ...exports.tsConfigBaseOptions,
        moduleResolution: (0, is_typescript_version_at_least_1.getTsConfigModuleResolution)(tree),
    };
}
function extractTsConfigBase(host) {
    if (host.exists('tsconfig.base.json'))
        return;
    const tsconfig = (0, devkit_1.readJson)(host, 'tsconfig.json');
    const baseCompilerOptions = {};
    if (tsconfig.compilerOptions) {
        for (let compilerOption of Object.keys(exports.tsConfigBaseOptions)) {
            baseCompilerOptions[compilerOption] =
                tsconfig.compilerOptions[compilerOption];
            delete tsconfig.compilerOptions[compilerOption];
        }
    }
    (0, devkit_1.writeJson)(host, 'tsconfig.base.json', {
        compileOnSave: false,
        compilerOptions: baseCompilerOptions,
        exclude: tsconfig.exclude,
    });
    tsconfig.extends = './tsconfig.base.json';
    delete tsconfig.compileOnSave;
    delete tsconfig.exclude;
    (0, devkit_1.writeJson)(host, 'tsconfig.json', tsconfig);
    // special case for updating e2e tests.
    if (host.exists('e2e/tsconfig.json')) {
        (0, devkit_1.updateJson)(host, 'e2e/tsconfig.json', (json) => {
            json.extends = '../tsconfig.base.json';
            return json;
        });
    }
}

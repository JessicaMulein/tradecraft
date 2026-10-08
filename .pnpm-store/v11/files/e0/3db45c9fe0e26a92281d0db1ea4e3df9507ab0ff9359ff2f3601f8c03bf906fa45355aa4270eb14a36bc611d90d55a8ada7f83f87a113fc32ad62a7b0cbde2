"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectModuleFormat = detectModuleFormat;
const devkit_1 = require("@nx/devkit");
const fs_1 = require("fs");
const path_1 = require("path");
const ts_config_1 = require("../../../utils/typescript/ts-config");
const module_format_1 = require("../../../utils/module-format/module-format");
function detectModuleFormat(options) {
    if (options.buildOptions?.format) {
        const formats = Array.isArray(options.buildOptions.format)
            ? options.buildOptions.format
            : [options.buildOptions.format];
        if (formats.includes('esm')) {
            return 'esm';
        }
        if (formats.includes('cjs')) {
            return 'cjs';
        }
    }
    if (options.main.endsWith('.mjs')) {
        return 'esm';
    }
    if (options.main.endsWith('.cjs')) {
        return 'cjs';
    }
    const packageJsonPath = (0, path_1.join)(options.workspaceRoot, options.projectRoot, 'package.json');
    if ((0, fs_1.existsSync)(packageJsonPath)) {
        try {
            const fmt = (0, module_format_1.getPackageJsonModuleFormat)((0, devkit_1.readJsonFile)(packageJsonPath));
            if (fmt)
                return fmt;
        }
        catch {
            // Continue to next detection method
        }
    }
    if (options.tsConfig && (0, fs_1.existsSync)(options.tsConfig)) {
        try {
            const fmt = (0, module_format_1.getTsConfigModuleFormat)((0, ts_config_1.readTsConfig)(options.tsConfig).options);
            if (fmt)
                return fmt;
        }
        catch {
            // Continue to default
        }
    }
    return 'cjs';
}

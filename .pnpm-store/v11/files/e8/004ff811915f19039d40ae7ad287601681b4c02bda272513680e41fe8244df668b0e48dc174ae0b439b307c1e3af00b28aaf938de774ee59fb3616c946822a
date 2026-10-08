"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOutputFileName = getOutputFileName;
const path_1 = require("path");
const get_main_file_dir_1 = require("../../../utils/get-main-file-dir");
const devkit_1 = require("@nx/devkit");
function getOutputFileName({ buildTargetExecutor, main, outputPath, rootDir, }) {
    const fileName = `${(0, path_1.parse)(main).name}.js`;
    if (buildTargetExecutor !== '@nx/js:tsc' &&
        buildTargetExecutor !== '@nx/js:swc') {
        return fileName;
    }
    const mainDirectory = (0, devkit_1.normalizePath)((0, path_1.dirname)(main));
    const normalizedOutputPath = (0, devkit_1.normalizePath)(outputPath);
    const isMainInsideOutputPath = mainDirectory === normalizedOutputPath ||
        mainDirectory.startsWith(`${normalizedOutputPath}/`);
    const base = isMainInsideOutputPath ? normalizedOutputPath : rootDir;
    return (0, devkit_1.joinPathFragments)((0, get_main_file_dir_1.getRelativeDirectoryToProjectRoot)(main, base), fileName);
}

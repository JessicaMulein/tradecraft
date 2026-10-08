"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRelativeDirectoryToProjectRoot = getRelativeDirectoryToProjectRoot;
const path_1 = require("path");
const devkit_1 = require("@nx/devkit");
function getRelativeDirectoryToProjectRoot(file, projectRoot) {
    const dir = (0, path_1.dirname)(file);
    const relativeDir = (0, devkit_1.normalizePath)((0, path_1.relative)(projectRoot, dir));
    return relativeDir === '' ? `./` : `./${relativeDir}/`;
}

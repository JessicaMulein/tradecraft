"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.angularCliVersion = exports.typescriptVersion = exports.nxVersion = void 0;
const path_1 = require("path");
// Dynamic join() form bypasses the eslint self-circular-import check while
// still resolving to the package's own package.json in both source and built
// (local-dist) contexts.
exports.nxVersion = require((0, path_1.join)('@nx/workspace', 'package.json')).version;
exports.typescriptVersion = '~6.0.3';
// TODO: remove when preset generation is reworked and
// deps are not installed from workspace
exports.angularCliVersion = '~22.1.0';

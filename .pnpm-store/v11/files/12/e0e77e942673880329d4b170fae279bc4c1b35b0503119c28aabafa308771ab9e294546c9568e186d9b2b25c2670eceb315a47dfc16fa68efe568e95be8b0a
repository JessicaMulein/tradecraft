"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadViteDynamicImport = loadViteDynamicImport;
exports.loadVitestDynamicImport = loadVitestDynamicImport;
exports.loadVitestConfigDynamicImport = loadVitestConfigDynamicImport;
function loadViteDynamicImport() {
    return Function('return import("vite")')();
}
function loadVitestDynamicImport() {
    return Function('return import("vitest/node")')();
}
function loadVitestConfigDynamicImport() {
    return Function('return import("vitest/config")')();
}

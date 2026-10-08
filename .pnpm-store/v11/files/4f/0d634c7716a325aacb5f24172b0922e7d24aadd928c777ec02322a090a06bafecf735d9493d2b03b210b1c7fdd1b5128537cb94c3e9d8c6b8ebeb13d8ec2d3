"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPromptOnlyMigration = isPromptOnlyMigration;
exports.isHybridMigration = isHybridMigration;
function hasDeterministicImplementation(m) {
    return !!(m.implementation || m.factory);
}
function isPromptOnlyMigration(m) {
    return !!m.prompt && !hasDeterministicImplementation(m);
}
function isHybridMigration(m) {
    return !!m.prompt && hasDeterministicImplementation(m);
}

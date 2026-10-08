"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readNxPackageGroup = readNxPackageGroup;
const fileutils_1 = require("./fileutils");
/**
 * The first-party Nx package set declared in nx's own
 * `nx-migrations.packageGroup`. Used by `nx report` (to know which
 * package versions to print) and by `nx add` shell completion (to
 * suggest first-party plugins). Auto-updates as new plugins land in
 * the package group — no hand-maintained list.
 */
function readNxPackageGroup() {
    const nxPkg = (0, fileutils_1.readJsonFile)(require.resolve('nx/package.json'));
    return (nxPkg['nx-migrations']?.packageGroup ?? []).map((e) => typeof e === 'string' ? e : e.package);
}

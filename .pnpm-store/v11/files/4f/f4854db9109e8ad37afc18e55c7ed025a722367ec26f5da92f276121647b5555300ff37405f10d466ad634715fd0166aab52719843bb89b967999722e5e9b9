"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const metadata_1 = require("../completion/metadata");
const nx_package_group_1 = require("../../utils/nx-package-group");
// Same list `nx report` uses. Filter to first-party plugins and sort.
const FIRST_PARTY_PLUGINS = (0, nx_package_group_1.readNxPackageGroup)()
    .filter((p) => p.startsWith('@nx/'))
    .sort();
(0, metadata_1.registerCompletion)('add', {
    positionals: [
        {
            complete: (current) => FIRST_PARTY_PLUGINS.filter((p) => p.startsWith(current)),
        },
    ],
});

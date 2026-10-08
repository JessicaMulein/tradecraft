"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.yargsStartNxAgentsCommand = void 0;
const handle_import_1 = require("../../../utils/handle-import");
const shared_options_1 = require("../../yargs-utils/shared-options");
exports.yargsStartNxAgentsCommand = {
    command: 'start-nx-agents [options]',
    describe: 'Provisions Nx Agents for distributed task execution, reading configuration from `.nx/ci-config.yaml`. This command is an alias for [`nx-cloud start-nx-agents`](/docs/reference/nx-cloud-cli#nx-cloud-start-nx-agents).',
    builder: (yargs) => (0, shared_options_1.withVerbose)(yargs)
        .help(false)
        .showHelpOnFail(false)
        .option('help', { describe: 'Show help.', type: 'boolean' }),
    handler: async (args) => {
        process.exit(await (await (0, handle_import_1.handleImport)('./start-nx-agents.js', __dirname)).startNxAgentsHandler(args));
    },
};

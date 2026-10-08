"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertToInferredGenerator = convertToInferredGenerator;
const internal_1 = require("@nx/devkit/internal");
const devkit_1 = require("@nx/devkit");
async function convertToInferredGenerator(tree, options) {
    const generatorCollectionChoices = await getPossibleConvertToInferredGenerators();
    if (generatorCollectionChoices.size === 0) {
        devkit_1.output.error({
            title: 'No inference plugin found. For information on this migration, see https://nx.dev/recipes/running-tasks/convert-to-inferred',
        });
        return;
    }
    let generatorsToRun;
    if (options.plugins && options.plugins.filter((p) => !!p).length > 0) {
        generatorsToRun = Array.from(generatorCollectionChoices.values())
            .filter((generator) => options.plugins.includes(generator.resolvedCollectionName))
            .map((generator) => generator.resolvedCollectionName);
    }
    else if (process.argv.includes('--no-interactive')) {
        generatorsToRun = Array.from(generatorCollectionChoices.keys());
    }
    else {
        const allChoices = Array.from(generatorCollectionChoices.keys());
        generatorsToRun = await (0, internal_1.multiselectPrompt)({
            message: 'Which inference plugin do you want to use?',
            choices: allChoices,
            initialValues: allChoices,
            required: true,
        });
    }
    if (generatorsToRun.length === 0) {
        devkit_1.output.error({
            title: 'Please select at least one plugin.',
        });
        return;
    }
    const tasks = [];
    // Each conversion checks nx.json's plugins array to decide whether it can
    // centralize shared configuration, but every later conversion in this loop
    // appends its own plugin registration afterwards. A batch session defers
    // centralization to a single finalize pass that observes the finished array,
    // so every conversion in the batch can centralize; a lone conversion already
    // sees the finished array and takes the inline path.
    const session = generatorsToRun.length > 1 ? (0, internal_1.openBatchConversionSession)(tree) : undefined;
    try {
        for (const generatorCollection of generatorsToRun) {
            try {
                const generator = generatorCollectionChoices.get(generatorCollection);
                if (generator) {
                    const generatorFactory = generator.implementationFactory();
                    const runGenerator = () => generatorFactory(tree, {
                        project: options.project,
                        skipFormat: options.skipFormat,
                    });
                    const callback = session
                        ? await session.runChild(runGenerator)
                        : await runGenerator();
                    if (callback) {
                        tasks.push(async () => {
                            try {
                                const task = await callback();
                                if (typeof task === 'function')
                                    await task();
                            }
                            catch (e) {
                                devkit_1.output.error({
                                    title: `${generatorCollection}:convert-to-inferred - Failed`,
                                });
                                throw e;
                            }
                        });
                    }
                    devkit_1.output.success({
                        title: `${generatorCollection}:convert-to-inferred - Success`,
                    });
                }
            }
            catch (e) {
                if (e instanceof internal_1.NoTargetsToMigrateError) {
                    devkit_1.output.note({
                        title: `${generatorCollection}:convert-to-inferred - Skipped (No targets to migrate)`,
                    });
                }
                else {
                    devkit_1.output.error({
                        title: `${generatorCollection}:convert-to-inferred - Failed`,
                    });
                    throw e;
                }
            }
        }
        if (session) {
            // Never throws: a failed finalize downgrades to a warning and leaves the
            // conservative per-project configuration, so the queued callbacks below
            // still run.
            await (0, internal_1.finalizeBatchConversion)(tree, session);
        }
    }
    finally {
        session?.close();
    }
    if (!options.skipFormat) {
        await (0, devkit_1.formatFiles)(tree);
    }
    return (0, devkit_1.runTasksInSerial)(...tasks);
}
async function getPossibleConvertToInferredGenerators() {
    const installedCollections = Array.from(new Set((0, internal_1.findInstalledPlugins)().map((x) => x.name)));
    const projectGraph = await (0, devkit_1.createProjectGraphAsync)();
    const projectsConfigurations = (0, devkit_1.readProjectsConfigurationFromProjectGraph)(projectGraph);
    const choices = new Map();
    for (const collectionName of installedCollections) {
        try {
            const generator = (0, internal_1.getGeneratorInformation)(collectionName, 'convert-to-inferred', devkit_1.workspaceRoot, projectsConfigurations.projects);
            if (generator.generatorConfiguration.hidden ||
                generator.generatorConfiguration['x-deprecated']) {
                continue;
            }
            choices.set(generator.resolvedCollectionName, generator);
        }
        catch {
            // this just means that no convert-to-inferred generator exists for a given collection, ignore
        }
    }
    return choices;
}
exports.default = convertToInferredGenerator;

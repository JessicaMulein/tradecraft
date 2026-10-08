"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lintWorkspaceRuleGenerator = lintWorkspaceRuleGenerator;
const tslib_1 = require("tslib");
const internal_1 = require("@nx/devkit/internal");
const devkit_1 = require("@nx/devkit");
const path_1 = require("path");
const ts = tslib_1.__importStar(require("typescript"));
const workspace_lint_rules_1 = require("../../utils/workspace-lint-rules");
const workspace_rules_project_1 = require("../workspace-rules-project/workspace-rules-project");
const assert_supported_eslint_version_1 = require("../../utils/assert-supported-eslint-version");
const versions_1 = require("../../utils/versions");
async function lintWorkspaceRuleGenerator(tree, options) {
    (0, assert_supported_eslint_version_1.assertSupportedEslintVersion)(tree);
    const tasks = [];
    // ESLint v9 dropped the eslintrc-style `RuleTester` API. typescript-eslint's
    // recommended replacement is the separate `@typescript-eslint/rule-tester`
    // package, whose flat-style API works for both flat and eslintrc workspaces.
    const { typescriptESLintVersion } = (0, versions_1.versions)(tree);
    const nxJson = (0, devkit_1.readNxJson)(tree);
    // Ensure that the workspace rules project has been created
    tasks.push(await (0, workspace_rules_project_1.lintWorkspaceRulesProjectGenerator)(tree, {
        skipFormat: true,
        addPlugin: process.env.NX_ADD_PLUGINS !== 'false' &&
            nxJson.useInferencePlugins !== false,
    }));
    tasks.push((0, devkit_1.addDependenciesToPackageJson)(tree, {}, { '@typescript-eslint/rule-tester': typescriptESLintVersion }, undefined, true));
    const ruleDir = (0, devkit_1.joinPathFragments)(workspace_lint_rules_1.workspaceLintPluginDir, options.directory ?? '');
    // Generate the required files for the new rule
    (0, devkit_1.generateFiles)(tree, (0, path_1.join)(__dirname, 'files'), ruleDir, {
        tmpl: '',
        name: options.name,
    });
    const nameCamelCase = (0, internal_1.camelize)(options.name);
    /**
     * Import the new rule into the workspace plugin index.ts and
     * register it ready for use in lint configs.
     */
    const pluginIndexPath = (0, devkit_1.joinPathFragments)(workspace_lint_rules_1.workspaceLintPluginDir, 'index.ts');
    const existingPluginIndexContents = tree.read(pluginIndexPath, 'utf-8');
    const pluginIndexSourceFile = ts.createSourceFile(pluginIndexPath, existingPluginIndexContents, ts.ScriptTarget.Latest, true);
    function findRulesObject(node) {
        if (ts.isPropertyAssignment(node) &&
            ts.isIdentifier(node.name) &&
            node.name.text === 'rules' &&
            ts.isObjectLiteralExpression(node.initializer)) {
            return node.initializer;
        }
        return node.forEachChild(findRulesObject);
    }
    const rulesObject = pluginIndexSourceFile.forEachChild((node) => findRulesObject(node));
    if (rulesObject) {
        const ruleNameSymbol = `${nameCamelCase}Name`;
        const ruleConfigSymbol = nameCamelCase;
        /**
         * If the rules object already has entries, we need to make sure our insertion
         * takes commas into account.
         */
        let leadingComma = '';
        if (rulesObject.properties.length > 0) {
            if (!rulesObject.properties.hasTrailingComma) {
                leadingComma = ',';
            }
        }
        const newContents = (0, devkit_1.applyChangesToString)(existingPluginIndexContents, [
            {
                type: devkit_1.ChangeType.Insert,
                index: 0,
                text: `import { RULE_NAME as ${ruleNameSymbol}, rule as ${ruleConfigSymbol} } from './${options.directory ? `${options.directory}/` : ''}${options.name}';\n`,
            },
            {
                type: devkit_1.ChangeType.Insert,
                index: rulesObject.getEnd() - 1,
                text: `${leadingComma}[${ruleNameSymbol}]: ${ruleConfigSymbol}\n`,
            },
        ]);
        tree.write(pluginIndexPath, newContents);
    }
    await (0, devkit_1.formatFiles)(tree);
    devkit_1.logger.info(`NX Reminder: Once you have finished writing your rule logic, you need to actually enable the rule within an appropriate ESLint config in your workspace, for example:

       "rules": {
         "@nx/workspace-${options.name}": "error"
       }
`);
    return (0, devkit_1.runTasksInSerial)(...tasks);
}

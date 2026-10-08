"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFormatterSetup = getFormatterSetup;
exports.setUpFormatter = setUpFormatter;
const oxfmt_1 = require("./oxfmt");
const prettier_1 = require("./prettier");
const versions_1 = require("./versions");
/**
 * Not `Partial`, so a new `FormatterType` member fails to compile here until it
 * is set up - but only after `packages/nx` is rebuilt, since the type comes
 * from its emitted declarations. The guard must stay structural: under
 * `strict: false` an untyped lookup yields `any` instead of an error.
 *
 * The key doubles as the npm package name; callers install by it.
 */
const formatterSetups = {
    prettier: { setUp: prettier_1.generatePrettierSetup, version: versions_1.prettierVersion },
    oxfmt: { setUp: oxfmt_1.generateOxfmtSetup, version: versions_1.oxfmtVersion },
};
/**
 * The setup for a formatter name that came from a schema, or `undefined` for
 * `'none'` and anything unrecognised.
 *
 * `hasOwnProperty` rather than `in`, which would answer `true` for inherited
 * members like `'constructor'` and hand back an `Object.prototype` function.
 */
function getFormatterSetup(formatter) {
    return formatter !== undefined &&
        Object.prototype.hasOwnProperty.call(formatterSetups, formatter)
        ? formatterSetups[formatter]
        : undefined;
}
/**
 * Writes the chosen formatter's config and queues its install.
 *
 * For callers that only need the formatter configured - a preset that creates
 * an empty workspace, say - rather than the whole of `@nx/js:init`. Does
 * nothing for `'none'` or an unrecognised value.
 */
function setUpFormatter(tree, formatter, options = {}) {
    const setup = getFormatterSetup(formatter);
    return setup ? setup.setUp(tree, options) : () => { };
}

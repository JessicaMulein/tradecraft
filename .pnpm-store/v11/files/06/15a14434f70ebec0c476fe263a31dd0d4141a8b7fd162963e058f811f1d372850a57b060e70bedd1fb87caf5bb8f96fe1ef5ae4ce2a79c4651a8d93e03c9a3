import type { Tree } from '../tree';
import type { FormatterType } from '../../utils/formatters';
/**
 * A formatter choice rather than a dispatch target, so `'none'` is composed in
 * here instead of living in `FormatterType`.
 */
type TestFormatter = FormatterType | 'none';
/**
 * Creates a host for testing.
 *
 * Defaults to oxfmt deliberately, so generator tests exercise the oxfmt path
 * rather than the create-nx-workspace default. oxfmt formats
 * JS, TS, JSON, YAML and Markdown - nothing filters by extension on the way in
 * - so any spec asserting on generated file *content* is affected. Pass `none`
 * to assert exactly what the generator wrote, or `prettier` only for a test
 * that is about prettier itself.
 */
export declare function createTreeWithEmptyWorkspace(opts?: {
    layout?: 'apps-libs';
    formatter?: TestFormatter;
}): Tree;
/**
 * @deprecated use createTreeWithEmptyWorkspace instead
 */
export declare function createTreeWithEmptyV1Workspace(): Tree;
export {};

import { type CreateDependencies, type CreateNodes } from '@nx/devkit';
export interface TscPluginOptions {
    compiler?: 'tsc' | 'tsgo';
    typecheck?: boolean | {
        targetName?: string;
        configName?: string;
    };
    build?: boolean | {
        targetName?: string;
        configName?: string;
        buildDepsName?: string;
        watchDepsName?: string;
        skipBuildCheck?: boolean;
    };
    verboseOutput?: boolean;
}
/**
 * @deprecated The 'createDependencies' function is now a no-op. This functionality is included in 'createNodesV2'.
 */
export declare const createDependencies: CreateDependencies;
export declare const PLUGIN_NAME = "@nx/js/typescript";
export declare const createNodesV2: CreateNodes<TscPluginOptions>;
export declare const createNodes: CreateNodes<TscPluginOptions>;

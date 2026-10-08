import type { ProjectConfiguration } from '../../config/workspace-json-project-json';
type LocalPluginMatch = {
    path: string;
    projectConfig: ProjectConfiguration;
    resolvedFile?: string;
};
export declare function resolveNxPlugin(moduleName: string, root: string, paths: string[]): Promise<{
    pluginPath: string;
    name: any;
    shouldRegisterTSTranspiler: boolean;
}>;
export declare function resolveLocalNxPlugin(importPath: string, projects: Record<string, ProjectConfiguration>, root?: string): LocalPluginMatch | null;
export declare function getPluginPathAndName(moduleName: string, paths: string[], projects: Record<string, ProjectConfiguration>, root: string): {
    pluginPath: string;
    name: any;
    shouldRegisterTSTranspiler: boolean;
};
/**
 * Drops the cached workspace-layout snapshot local-plugin resolution relies on
 * (project configs, tsconfig paths, package entry points). Kept for the life
 * of the process, it goes stale when a new local plugin is added — the plugin
 * then resolves to the workspace root (a directory) and fails to import.
 */
export declare function resetResolvePluginCache(): void;
export {};

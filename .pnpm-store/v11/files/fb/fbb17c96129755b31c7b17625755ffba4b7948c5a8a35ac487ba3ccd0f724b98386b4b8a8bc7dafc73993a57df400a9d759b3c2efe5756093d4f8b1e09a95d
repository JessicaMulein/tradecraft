import { ProjectGraph, Tree } from '@nx/devkit';
import { VersionActions } from 'nx/release';
import type { ResolveVersionForDependency } from 'nx/release';
import type { AfterAllProjectsVersioned, NxReleaseVersionConfiguration } from '@nx/devkit/internal';
export declare const afterAllProjectsVersioned: AfterAllProjectsVersioned;
export default class JsVersionActions extends VersionActions {
    validManifestFilenames: string[];
    excludeManifestsFromFormatting: boolean;
    readCurrentVersionFromSourceManifest(tree: Tree): Promise<{
        currentVersion: string;
        manifestPath: string;
    }>;
    readCurrentVersionFromRegistry(tree: Tree, currentVersionResolverMetadata: NxReleaseVersionConfiguration['currentVersionResolverMetadata']): Promise<{
        currentVersion: string;
        logText: string;
    }>;
    readCurrentVersionOfDependency(tree: Tree, projectGraph: ProjectGraph, dependencyProjectName: string): Promise<{
        currentVersion: string | null;
        dependencyCollection: string | null;
    }>;
    updateProjectVersion(tree: Tree, newVersion: string): Promise<string[]>;
    updateProjectDependencies(tree: Tree, projectGraph: ProjectGraph, dependenciesToUpdate: Record<string, string>, resolveVersionForDependency?: ResolveVersionForDependency): Promise<string[]>;
    private getLocalDependencyProjectLookup;
    private resolveLocalDependencySpecifier;
    private applyVersionPrefix;
    private updateManifestValues;
    private readAndValidateManifest;
    private validateManifestUpdates;
    private detectFormattingOptions;
    private isLocalDependencyProtocol;
}

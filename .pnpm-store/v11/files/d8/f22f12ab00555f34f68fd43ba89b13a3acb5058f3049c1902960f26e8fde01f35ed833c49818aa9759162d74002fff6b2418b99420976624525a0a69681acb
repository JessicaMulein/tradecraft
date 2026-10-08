import { NxReleaseConfiguration } from '../../config/nx-json';
import { ChangelogOptions } from './command-object';
import { NxReleaseConfig } from './config/config';
import { ReleaseVersion } from './utils/shared';
export interface NxReleaseChangelogResult {
    workspaceChangelog?: {
        releaseVersion: ReleaseVersion;
        contents: string;
        postGitTask: PostGitTask | null;
    };
    projectChangelogs?: {
        [projectName: string]: {
            releaseVersion: ReleaseVersion;
            contents: string;
            postGitTask: PostGitTask | null;
        };
    };
}
export type { ChangelogChange } from './changelog/version-plan-utils';
export type PostGitTask = (latestCommit: string) => Promise<void>;
/**
 * Determines whether a changelog configuration will actually produce any output.
 * A changelog config is effectively enabled when it would produce a changelog file
 * or create a remote release.
 */
export declare function isChangelogEffectivelyEnabled(config?: NxReleaseConfig['changelog']['workspaceChangelog'] | NxReleaseConfig['groups'][string]['changelog']): boolean | undefined;
export declare const releaseChangelogCLIHandler: (args: ChangelogOptions) => Promise<number>;
export declare function createAPI(overrideReleaseConfig: NxReleaseConfiguration, ignoreNxJsonConfig: boolean): (args: ChangelogOptions) => Promise<NxReleaseChangelogResult>;

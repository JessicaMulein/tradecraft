import { NxJsonConfiguration } from '../../config/nx-json';
import { ProjectsConfigurations } from '../../config/workspace-json-project-json';
import { PluginCapabilities } from './plugin-capabilities';
/** A workspace-local plugin discovered cheaply (no JS load). */
export interface LocalPluginWithGenerators {
    /** Absolute path to the project root that hosts the plugin. */
    dir: string;
    /** The `generators` or `schematics` field value from the plugin's
     *  package.json (a relative path to the collection JSON). */
    field: string;
}
/**
 * Sync, lightweight scan: for each given project root, read its package.json
 * and yield it as a plugin if it declares a `generators`/`schematics`
 * collection. Used by tab completion which cannot afford the heavier
 * {@link getLocalWorkspacePlugins} (that one loads each plugin's JS to
 * walk its capabilities).
 *
 * `projectRoots` are paths relative to `workspaceRoot`.
 */
export declare function findLocalPluginsWithGenerators(projectRoots: Iterable<string>): Map<string, LocalPluginWithGenerators>;
export declare function getLocalWorkspacePlugins(projectsConfiguration: ProjectsConfigurations, nxJson: NxJsonConfiguration): Promise<Map<string, PluginCapabilities>>;

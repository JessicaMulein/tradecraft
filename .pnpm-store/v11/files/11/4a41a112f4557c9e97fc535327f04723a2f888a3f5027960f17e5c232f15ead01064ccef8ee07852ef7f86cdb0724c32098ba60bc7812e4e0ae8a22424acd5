import { ProjectGraph } from '../config/project-graph';
import { Task } from '../config/task-graph';
/**
 * Resolves the FORCE_COLOR value for forked child processes.
 *
 * When the user sets FORCE_COLOR=0, bin/nx.ts deletes it from process.env
 * (workaround for picocolors treating "0" as truthy) and saves the original
 * value in NX_ORIGINAL_FORCE_COLOR. Without this check, the undefined
 * FORCE_COLOR would default to 'true', re-enabling colors in all children.
 */
export declare function getForceColorForChild(): string;
export declare function getEnvVariablesForBatchProcess(skipNxCache: boolean, captureStderr: boolean): NodeJS.ProcessEnv;
export declare function getTaskSpecificEnv(task: Task, graph: ProjectGraph): NodeJS.ProcessEnv;
/**
 * Reconstructs, at graph-construction time, the env a task would see: the
 * root dotenv files Nx loaded at init are unloaded from the ambient env, then
 * the dotenv files the task would load (`.env.<target>`, project-scoped
 * `.env`, ...) are applied, so a task-scoped file wins over an init-time root
 * load. The unload compares values, not provenance: a variable whose value
 * differs from the root file's is kept and wins over the task files, while a
 * shell-set value equal to the root file's is unloaded like the file's own.
 *
 * `createNodes` runs before any task, so the per-task dotenv files that
 * `getTaskSpecificEnv` loads at run time are not in `process.env` yet. A plugin
 * inferring targets from a config that reads `process.env` needs those values
 * to resolve the config the way the task will. This mirrors
 * `loadDotEnvFilesForTask` but takes the target coordinates directly (there is
 * no `Task`/graph yet) and gates on `!== 'false'` rather than `=== 'true'`: the
 * `'true'` marker is only stamped once the graph exists (`run-command.ts`),
 * which is after this runs. Only the dotenv overlay is reconstructed: run-time
 * env like `NX_TASK_TARGET_*` or `NX_TASK_HASH` is not included.
 *
 * `baseEnv` is the ambient env the overlay applies to, defaulting to the live
 * `process.env`. A caller that runs config files in-process passes a snapshot
 * taken under its load lock instead: a concurrent load's transient env writes
 * would otherwise be read as ambient and mask the task files' values.
 */
export declare function getGraphTimeDotEnvForTask(projectRoot: string, target: string, configuration?: string, nonAtomizedTarget?: string, baseEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export declare function getEnvVariablesForTask(task: Task, taskSpecificEnv: NodeJS.ProcessEnv, forceColor: string, skipNxCache: boolean, captureStderr: boolean, outputPath: string, streamOutput: boolean): NodeJS.ProcessEnv;
/**
 * This function loads one or more .env files and expands the variables in them.
 * When multiple files are provided, all files are loaded first, then variable
 * expansion happens once with the complete set of variables. This ensures
 * cross-file variable references resolve correctly.
 * @param filename the .env file(s) to load
 * @param environmentVariables the object to load environment variables into
 * @param override whether to override existing environment variables
 */
export declare function loadAndExpandDotEnvFile(filename: string | string[], environmentVariables: NodeJS.ProcessEnv, override?: boolean): import("dotenv-expand").DotenvExpandOutput;
/**
 * This function unloads a .env file and removes the variables in it from the environmentVariables.
 * @param filename
 * @param environmentVariables
 */
export declare function unloadDotEnvFile(filename: string, environmentVariables: NodeJS.ProcessEnv, override?: boolean): void;
export declare function getEnvFilesForTask(task: Task, graph: ProjectGraph): string[];

import { CreateNodesContext, CreateNodesResult } from './public-api';
export declare function createNodesFromFiles<T = unknown>(createNodes: (projectConfigurationFile: string, options: T | undefined, context: CreateNodesContext & {
    configFiles: readonly string[];
}, idx: number) => CreateNodesResult | Promise<CreateNodesResult>, configFiles: readonly string[], options: T, context: CreateNodesContext): Promise<[file: string, value: CreateNodesResult][]>;

import { ExecutorContext } from '@nx/devkit';
import { NormalizedSwcExecutorOptions } from '../schema';
export declare function getSwcCmd({ swcCliOptions: { swcrcPath, destPath, stripLeadingPaths }, root, projectRoot, sourceRoot, main, }: NormalizedSwcExecutorOptions, watch?: boolean): string;
export declare function compileSwc(context: ExecutorContext, normalizedOptions: NormalizedSwcExecutorOptions, postCompilationCallback: () => Promise<void>): Promise<{
    success: boolean;
    outfile?: undefined;
} | {
    success: boolean;
    outfile: string;
}>;
export declare function compileSwcWatch(context: ExecutorContext, normalizedOptions: NormalizedSwcExecutorOptions, postCompilationCallback: () => Promise<void>): AsyncGenerator<{
    success: boolean;
    outfile: string;
}, any, any>;

import type * as typescript from 'typescript';
import * as webpack from 'webpack';
import type { LoaderOptions, TSInstance } from './interfaces';
/**
 * The loader is executed once for each file seen by webpack. However, we need to keep
 * a persistent instance of TypeScript that contains all of the files in the program
 * along with definition files and options. This function either creates an instance
 * or returns the existing one. Multiple instances are possible by using the
 * `instance` property.
 */
export declare function getTypeScriptInstance(loaderOptions: LoaderOptions, loader: webpack.LoaderContext<LoaderOptions>): {
    instance?: TSInstance;
    error?: webpack.WebpackError;
};
export declare function initializeInstance(loader: webpack.LoaderContext<LoaderOptions>, instance: TSInstance): void;
export declare function getCustomTransformers(loaderOptions: LoaderOptions, program: typescript.Program | undefined, getProgram: (() => typescript.Program | undefined) | undefined): any;
export declare function reportTranspileErrors(instance: TSInstance, loader: webpack.LoaderContext<LoaderOptions>): void;
export declare function buildSolutionReferences(instance: TSInstance, loader: webpack.LoaderContext<LoaderOptions>): void;
export declare function forEachResolvedProjectReference<T>(resolvedProjectReferences: readonly (typescript.ResolvedProjectReference | undefined)[] | undefined, cb: (resolvedProjectReference: typescript.ResolvedProjectReference) => T | undefined): T | undefined;
export declare function getOutputFileNames(instance: TSInstance, configFile: typescript.ParsedCommandLine, inputFileName: string): string[];
export declare function getInputFileNameFromOutput(instance: TSInstance, filePath: string): string | undefined;
export declare function getEmitFromWatchHost(instance: TSInstance, filePath?: string): typescript.OutputFile[] | undefined;
export declare function getEmitOutput(instance: TSInstance, filePath: string): typescript.OutputFile[];
//# sourceMappingURL=instances.d.ts.map
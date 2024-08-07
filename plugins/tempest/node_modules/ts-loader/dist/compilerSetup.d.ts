import type * as typescript from 'typescript';
import type { LoaderOptions } from './interfaces';
import type * as logger from './logger';
export declare function getCompiler(loaderOptions: LoaderOptions, log: logger.Logger): {
    compiler: typeof typescript | undefined;
    compilerCompatible: boolean;
    compilerDetailsLogMessage: string | undefined;
    errorMessage: string | undefined;
};
export declare function getCompilerOptions(configParseResult: typescript.ParsedCommandLine, compiler: typeof typescript): {
    skipLibCheck: boolean;
} & typescript.CompilerOptions;
//# sourceMappingURL=compilerSetup.d.ts.map
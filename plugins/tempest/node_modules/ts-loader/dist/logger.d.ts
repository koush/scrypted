import type { Chalk } from 'chalk';
import type { LoaderOptions } from './interfaces';
type LoggerFunc = (message: string) => void;
export interface Logger {
    log: LoggerFunc;
    logInfo: LoggerFunc;
    logWarning: LoggerFunc;
    logError: LoggerFunc;
}
export declare enum LogLevel {
    INFO = 1,
    WARN = 2,
    ERROR = 3
}
export declare function makeLogger(loaderOptions: LoaderOptions, colors: Chalk): Logger;
export {};
//# sourceMappingURL=logger.d.ts.map
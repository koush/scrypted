import type * as webpack from 'webpack';
import type { LoaderOptions } from './interfaces';
/**
 * The entry point for ts-loader
 */
declare function loader(this: webpack.LoaderContext<LoaderOptions>, contents: string, inputSourceMap?: Record<string, any>): void;
export = loader;
/**
 * expose public types via declaration merging
 */
declare namespace loader {
    interface Options extends LoaderOptions {
    }
}
//# sourceMappingURL=index.d.ts.map
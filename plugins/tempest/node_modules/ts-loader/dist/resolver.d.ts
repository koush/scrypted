import type * as webpack from 'webpack';
export declare function makeResolver(_options: webpack.WebpackOptionsNormalized): ResolveSync;
export type ResolveSync = {
    (context: any, path: string, moduleName: string): string | false;
    (path: string, moduleName: string): string | false;
};
//# sourceMappingURL=resolver.d.ts.map
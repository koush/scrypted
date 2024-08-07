import type * as webpack from 'webpack';
import type { TSInstance } from './interfaces';
export declare function getTSInstanceFromCache(key: webpack.Compiler, name: string): TSInstance | undefined;
export declare function setTSInstanceInCache(key: webpack.Compiler | undefined, name: string, instance: TSInstance): void;
//# sourceMappingURL=instance-cache.d.ts.map
declare module "simple-plist" {

  import { WriteFileOptions } from "fs";

  export function parse(content: Buffer | string, path: string): any;

  export function readFileSync(path: string): any;

  export function readFile(path: string, callback: (err: Error | null, result: any) => void): void;

  export function writeFileSync(path: string, object: any, options?: WriteFileOptions): void

  export function writeFile(path: string, object: any, callback: (err: NodeJS.ErrnoException | null) => void): void;

  export function writeFile(path: string, object: any, options: WriteFileOptions, callback: (err: NodeJS.ErrnoException | null) => void): void;

  export function writeBinaryFileSync(path: string, object: any, options?: WriteFileOptions): void

  export function writeBinaryFile(path: string, object: any, callback: (err: NodeJS.ErrnoException | null) => void): void;

  export function writeBinaryFile(path: string, object: any, options: WriteFileOptions, callback: (err: NodeJS.ErrnoException | null) => void): void;

}

import module from 'module';

globalThis.denoConsole = console;
const require = module.createRequire(import.meta.url);
require("../dist/scrypted-main.js");

import module from 'module';

const require = module.createRequire(import.meta.url);
require("../dist/scrypted-main.js");

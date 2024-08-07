"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeResolver = void 0;
function makeResolver(_options) {
    /* Currently, `enhanced-resolve` does not work properly alongside `ts-loader`.
     * This feature is disabled until a proper worflow has been worked out. */
    return (_context, _path, _moduleName) => {
        throw new Error();
    };
}
exports.makeResolver = makeResolver;
//# sourceMappingURL=resolver.js.map
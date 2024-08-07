"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _default = {
  TSEnumDeclaration(path) {
    if (path.node.const) {
      path.node.const = false;
    }
  }

};
exports.default = _default;
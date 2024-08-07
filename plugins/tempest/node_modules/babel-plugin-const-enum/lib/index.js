"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _helperPluginUtils = require("@babel/helper-plugin-utils");

var _pluginSyntaxTypescript = _interopRequireDefault(require("@babel/plugin-syntax-typescript"));

var _removeConst = _interopRequireDefault(require("./remove-const"));

var _constObject = _interopRequireDefault(require("./const-object"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var _default = (0, _helperPluginUtils.declare)((api, {
  transform = 'removeConst'
}) => {
  api.assertVersion(7);
  let visitor;

  if (transform === 'removeConst') {
    visitor = _removeConst.default;
  } else if (transform === 'constObject') {
    visitor = _constObject.default;
  } else {
    throw Error('transform option must be removeConst|constObject');
  }

  return {
    name: 'const-enum',
    inherits: _pluginSyntaxTypescript.default,
    visitor
  };
});

exports.default = _default;
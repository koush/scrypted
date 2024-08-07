"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.NON_NUMERIC_EXPRESSION_ERROR_MESSAGE = exports.DISALLOWED_NAN_ERROR_MESSAGE = exports.DISALLOWED_INFINITY_ERROR_MESSAGE = void 0;

var _core = require("@babel/core");

var _traverse = _interopRequireDefault(require("@babel/traverse"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const DISALLOWED_NAN_ERROR_MESSAGE = "'const' enum member initializer was evaluated to disallowed value 'NaN'.";
exports.DISALLOWED_NAN_ERROR_MESSAGE = DISALLOWED_NAN_ERROR_MESSAGE;
const DISALLOWED_INFINITY_ERROR_MESSAGE = "'const' enum member initializer was evaluated to a non-finite value.";
exports.DISALLOWED_INFINITY_ERROR_MESSAGE = DISALLOWED_INFINITY_ERROR_MESSAGE;
const NON_NUMERIC_EXPRESSION_ERROR_MESSAGE = 'Must be numeric expression.';
exports.NON_NUMERIC_EXPRESSION_ERROR_MESSAGE = NON_NUMERIC_EXPRESSION_ERROR_MESSAGE;
var _default = {
  TSEnumDeclaration(path) {
    if (path.node.const) {
      // `path === constObjectPath` for `replaceWith`.
      const [constObjectPath] = path.replaceWith(_core.types.variableDeclaration('const', [_core.types.variableDeclarator(_core.types.identifier(path.node.id.name), _core.types.objectExpression(TSEnumMembersToObjectProperties(path.get('members'))))]));
      path.scope.registerDeclaration(constObjectPath);
    }
  }

};
exports.default = _default;

const TSEnumMembersToObjectProperties = memberPaths => {
  const isStringEnum = memberPaths.some(memberPath => _core.types.isStringLiteral(memberPath.node.initializer));
  const constEnum = {};
  let currentValue = 0;
  return memberPaths.map(tsEnumMemberPath => {
    const keyNode = computeKeyNodeFromIdPath(tsEnumMemberPath.get('id'));
    const key = getKeyFromKeyNode(keyNode);
    const valueNode = computeValueNodeFromEnumMemberPath(tsEnumMemberPath, isStringEnum, constEnum, currentValue);
    const value = getValueFromValueNode(valueNode);
    constEnum[key] = value;

    if (_core.types.isNumericLiteral(valueNode)) {
      currentValue = value + 1;
    } else if (_core.types.isStringLiteral(valueNode)) {
      currentValue = null;
    }

    return _core.types.objectProperty(keyNode, valueNode);
  });
};

const computeKeyNodeFromIdPath = idPath => {
  const id = idPath.node;
  let keyNode;

  if (_core.types.isIdentifier(id)) {
    const key = id.name;
    keyNode = _core.types.identifier(key);
  } else if (_core.types.isStringLiteral(id)) {
    const key = id.value;
    keyNode = _core.types.stringLiteral(key);
  } else if (_core.types.isNumericLiteral(id)) {
    throw idPath.buildCodeFrameError('An enum member cannot have a numeric name.');
  } else {
    throw idPath.buildCodeFrameError('Enum member expected.');
  }

  return keyNode;
};

const getKeyFromKeyNode = keyNode => {
  let key;

  if (_core.types.isIdentifier(keyNode)) {
    key = keyNode.name;
  } else if (_core.types.isStringLiteral(keyNode)) {
    key = keyNode.value;
  }

  return key;
};

const computeValueNodeFromEnumMemberPath = (tsEnumMemberPath, isStringEnum, constEnum, currentValue) => {
  const initializerPath = tsEnumMemberPath.get('initializer');
  const initializer = initializerPath.node;
  let value;

  if (initializer) {
    if (_core.types.isNumericLiteral(initializer) || _core.types.isStringLiteral(initializer)) {
      value = initializer.value;
    } else if (_core.types.isIdentifier(initializer)) {
      validateIdentifierName(initializerPath);
      value = constEnum[initializer.name];
      validateConstEnumMemberAccess(tsEnumMemberPath, value);
    } else if (_core.types.isUnaryExpression(initializer) || _core.types.isBinaryExpression(initializer)) {
      if (isStringEnum) {
        throw initializerPath.buildCodeFrameError('Computed values are not permitted in an enum with string valued members.');
      }

      traverseFromRoot(initializerPath, accessConstEnumMemberVisitor, {
        constEnum
      });
      value = evaluateInitializer(initializerPath);
    } else {
      throw initializerPath.buildCodeFrameError('const enum member initializers can only contain literal values and other computed enum values.');
    }
  } else {
    if (currentValue === null) {
      throw tsEnumMemberPath.buildCodeFrameError('Enum member must have initializer.');
    }

    value = currentValue;
  }

  let valueNode;

  if (Number.isFinite(value)) {
    valueNode = _core.types.numericLiteral(value);
  } else if (typeof value === 'string') {
    valueNode = _core.types.stringLiteral(value);
  } else if (Number.isNaN(value)) {
    throw tsEnumMemberPath.buildCodeFrameError(DISALLOWED_NAN_ERROR_MESSAGE);
  } else if (value === Infinity || value === -Infinity) {
    throw tsEnumMemberPath.buildCodeFrameError(DISALLOWED_INFINITY_ERROR_MESSAGE);
  } else {
    // Should not get here.
    throw new Error('`value` is not a number or string');
  }

  return valueNode;
};

const getValueFromValueNode = valueNode => {
  let value;

  if (_core.types.isNumericLiteral(valueNode) || _core.types.isStringLiteral(valueNode)) {
    value = valueNode.value;
  }

  return value;
};

const UNARY_OPERATORS = {
  '+': a => +a,
  '-': a => -a,
  '~': a => ~a
};
const BINARY_OPERATORS = {
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '/': (a, b) => a / b,
  '%': (a, b) => a % b,
  '*': (a, b) => a * b,
  '**': (a, b) => a ** b,
  '&': (a, b) => a & b,
  '|': (a, b) => a | b,
  '>>': (a, b) => a >> b,
  '>>>': (a, b) => a >>> b,
  '<<': (a, b) => a << b,
  '^': (a, b) => a ^ b
};

const isNumericUnaryExpression = node => _core.types.isUnaryExpression(node) && Object.prototype.hasOwnProperty.call(UNARY_OPERATORS, node.operator);

const isNumericBinaryExpression = node => _core.types.isBinaryExpression(node) && Object.prototype.hasOwnProperty.call(BINARY_OPERATORS, node.operator);

const validateIdentifierName = identifierPath => {
  switch (identifierPath.node.name) {
    case 'NaN':
      throw identifierPath.buildCodeFrameError(DISALLOWED_NAN_ERROR_MESSAGE);

    case 'Infinity':
      throw identifierPath.buildCodeFrameError(DISALLOWED_INFINITY_ERROR_MESSAGE);
  }
};

const validateConstEnumMemberAccess = (path, value) => {
  if (value === undefined) {
    throw path.buildCodeFrameError('Enum initializer identifier must reference a previously defined enum member.');
  }
};

const traverseFromRoot = (path, visitor, state) => {
  visitor = _traverse.default.visitors.explode(visitor);

  if (visitor.enter) {
    visitor.enter[0].call(state, path, state);
  }

  if (visitor[path.type] && visitor[path.type].enter) {
    visitor[path.type].enter[0].call(state, path, state);
  }

  path.traverse(visitor, state);

  if (visitor.exit) {
    visitor.exit[0].call(state, path, state);
  }

  if (visitor[path.type] && visitor[path.type].exit) {
    visitor[path.type].exit[0].call(state, path, state);
  }
};

const accessConstEnumMemberVisitor = {
  enter(path) {
    if (_core.types.isIdentifier(path.node)) {
      validateIdentifierName(path);
      const constEnum = this.constEnum;
      const value = constEnum[path.node.name];
      validateConstEnumMemberAccess(path, value);
      path.replaceWith(_core.types.numericLiteral(value));
      path.skip();
    } else if (!(_core.types.isNumericLiteral(path.node) || isNumericUnaryExpression(path.node) || isNumericBinaryExpression(path.node))) {
      throw path.buildCodeFrameError(NON_NUMERIC_EXPRESSION_ERROR_MESSAGE);
    }
  }

};

const evaluateInitializer = initializerPath => {
  traverseFromRoot(initializerPath, evaluateInitializerVisitor);
  return initializerPath.node.value;
};

const evaluateInitializerVisitor = {
  UnaryExpression: {
    exit(path) {
      const {
        node
      } = path;
      path.replaceWith(_core.types.numericLiteral(UNARY_OPERATORS[node.operator](node.argument.value)));
    }

  },
  BinaryExpression: {
    exit(path) {
      const {
        node
      } = path;
      path.replaceWith(_core.types.numericLiteral(BINARY_OPERATORS[node.operator](node.left.value, node.right.value)));
    }

  }
};
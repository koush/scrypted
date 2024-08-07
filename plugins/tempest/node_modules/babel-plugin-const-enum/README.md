# babel-plugin-const-enum &middot; [![npm version](https://img.shields.io/npm/v/babel-plugin-const-enum.svg?style=flat)](https://www.npmjs.com/package/babel-plugin-const-enum) [![npm downloads](https://img.shields.io/npm/dm/babel-plugin-const-enum.svg?style=flat)](https://www.npmjs.com/package/babel-plugin-const-enum)

> Transform TypeScript `const` enums

## Install

Using npm:

```sh
npm install --save-dev babel-plugin-const-enum
```

or using yarn:

```sh
yarn add babel-plugin-const-enum --dev
```

## Usage

You are most likely using
[`@babel/preset-typescript`](https://babeljs.io/docs/en/babel-preset-typescript)
or
[`@babel/plugin-transform-typescript`](https://babeljs.io/docs/en/babel-plugin-transform-typescript)
along with this plugin.

If you are using `@babel/preset-typescript`, then nothing special needs to be
done since
[plugins run before presets](https://babeljs.io/docs/en/plugins/#plugin-ordering).

If you are using `@babel/plugin-transform-typescript`, then make sure that
`babel-plugin-const-enum` comes before
`@babel/plugin-transform-typescript` in the plugin array so that
`babel-plugin-const-enum` [runs first](https://babeljs.io/docs/en/plugins/#plugin-ordering).
This plugin needs to run first to transform the `const enum`s into code that
`@babel/plugin-transform-typescript` allows.

`.babelrc`

```json
{
  "plugins": ["const-enum", "@babel/transform-typescript"]
}
```

### `transform: removeConst` (default)

Removes the `const` keyword to use regular `enum`.
Can be used in a slower dev build to allow `const`, while prod still uses `tsc`.
See [babel#6476](https://github.com/babel/babel/issues/6476).

```ts
// Before:
const enum MyEnum {
  A = 1,
  B = A,
  C,
  D = C,
  E = 1,
  F,
  G = A * E,
  H = A ** B ** C,
  I = A << 20
}

// After:
enum MyEnum {
  A = 1,
  B = A,
  C,
  D = C,
  E = 1,
  F,
  G = A * E,
  H = A ** B ** C,
  I = A << 20
}
```

`.babelrc`
```json
{
  "plugins": [
    "const-enum"
  ]
}
```

Or Explicitly:

`.babelrc`
```json
{
  "plugins": [
    [
      "const-enum",
      {
        "transform": "removeConst"
      }
    ]
  ]
}
```

### `transform: constObject`

Transforms into a `const` object literal.
Can be further compressed using Uglify/Terser to inline `enum` access.
See [babel#8741](https://github.com/babel/babel/issues/8741).

```ts
// Before:
const enum MyEnum {
  A = 1,
  B = A,
  C,
  D = C,
  E = 1,
  F,
  G = A * E,
  H = A ** B ** C,
  I = A << 20
}

// After:
const MyEnum = {
  A: 1,
  B: 1,
  C: 2,
  D: 2,
  E: 1,
  F: 2,
  G: 1,
  H: 1,
  I: 1048576
};
```

`.babelrc`
```json
{
  "plugins": [
    [
      "const-enum",
      {
        "transform": "constObject"
      }
    ]
  ]
}
```

## Troubleshooting

### `SyntaxError`

You may be getting a `SyntaxError` because you are running this plugin on
non-TypeScript source. You might have run into this problem in `react-native`,
see:<br>
[babel-plugin-const-enum#2](https://github.com/dosentmatter/babel-plugin-const-enum/issues/2)<br>
[babel-plugin-const-enum#3](https://github.com/dosentmatter/babel-plugin-const-enum/issues/3)

This seems to be caused by `react-native` transpiling
[`flow`](https://flow.org/) code in `node_modules`.
To fix this issue, please use
[`babel-preset-const-enum`](https://github.com/dosentmatter/babel-preset-const-enum)
to only run `babel-plugin-const-enum` on TypeScript files.
If you wish to fix the issue manually, check out the
[solution in babel-plugin-const-enum#2](https://github.com/dosentmatter/babel-plugin-const-enum/issues/2#issuecomment-542859348).

module.exports = {
  plugins: [
    ["transform-imports", {
      "@fortawesome/free-solid-svg-icons": {
        "transform": "@fortawesome/free-solid-svg-icons/${member}",
        "skipDefaultConversion": true
      },
      "@fortawesome/free-brands-svg-icons": {
        "transform": "@fortawesome/free-brands-svg-icons/${member}",
        "skipDefaultConversion": true
      }

    }],
    "@babel/plugin-transform-typescript",
    "@babel/plugin-proposal-class-properties",
    "@babel/plugin-transform-modules-commonjs",
    "@babel/plugin-proposal-optional-chaining",
  ],
  presets: [
    '@vue/app',
    '@babel/preset-typescript'
  ]
}

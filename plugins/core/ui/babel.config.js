module.exports = {
  presets: [
    ['@babel/preset-env', {
      "targets": "last 1 chrome versions"
    }]
  ],
  plugins: [
    "@babel/plugin-proposal-optional-chaining",
    "@babel/plugin-proposal-object-rest-spread",
    "@babel/plugin-proposal-optional-catch-binding",
  ]
}

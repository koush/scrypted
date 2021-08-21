module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  coverageReporters: ["lcov"],
  collectCoverageFrom: [
    "src/**",
    "!src/accessories/**",
    "!src/lib/definitions/generate-definitions.ts",
    "!src/lib/definitions/generator-configuration.ts"
  ],
};

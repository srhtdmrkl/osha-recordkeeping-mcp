/**
 * Jest configuration for running ES Module TypeScript tests.
 *
 * Configures the ts-jest preset for ESM mode, treats .ts extensions as ESM,
 * maps relative ESM module paths to matching target files, and compiles TS source.
 *
 * @type {import('jest').Config}
 */
export default {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      { useESM: true, tsconfig: { module: "ESNext", moduleResolution: "bundler" } },
    ],
  },
  testMatch: ["**/test/**/*.test.ts"],
};

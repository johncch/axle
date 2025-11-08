/** @type {import('ts-jest').JestConfigWithTsJest} **/
export default {
  preset: "ts-jest/presets/default-esm",
  extensionsToTreatAsEsm: [".ts"],
  testEnvironment: "node",
  roots: ["<rootDir>/src", "<rootDir>/tests"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
      },
    ],
  },
  moduleNameMapper: {
    // Only map our own .js imports to .ts files, not node_modules
    "^(\\.\\.?/.*)\\.js$": "$1",
  },
  transformIgnorePatterns: [
    // Don't transform node_modules except for ESM-only packages that need it
    "node_modules/(?!(chalk|serialize-error)/)",
  ],
  testMatch: ["**/__tests__/**/*.(ts|tsx|js)", "**/*.(test|spec).(ts|tsx|js)"],
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.d.ts",
    "!src/**/*.test.{ts,tsx}",
    "!src/**/*.spec.{ts,tsx}",
  ],
  // Handle JSON imports
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],
  // Increase timeout for async operations
  testTimeout: 10000,
};

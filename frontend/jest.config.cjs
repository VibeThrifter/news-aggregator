const nextJest = require("next/jest");

const createJestConfig = nextJest({ dir: "./" });

const customJestConfig = {
  testEnvironment: "jest-environment-jsdom",
  clearMocks: true,
  setupFilesAfterEnv: ["<rootDir>/tests/setupTests.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
    // d3 packages are ESM-only; map them to their UMD builds for Jest
    "^d3-(force|dispatch|quadtree|timer)$": "<rootDir>/node_modules/d3-$1/dist/d3-$1.js",
  },
  testMatch: ["<rootDir>/__tests__/**/*.(test|spec).[tj]s?(x)"],
};

module.exports = createJestConfig(customJestConfig);

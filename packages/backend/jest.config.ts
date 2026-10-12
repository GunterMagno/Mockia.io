import type { Config } from 'jest';

// @faker-js/faker >= 10 is published as ESM only and these tests run as CommonJS: its files are the only ones in
// node_modules that Jest compiles (ts-jest), everything else stays as it is.
const tsconfig = {
  module: 'commonjs',
  target: 'ES2020',
  lib: ['ES2020'],
  esModuleInterop: true,
  skipLibCheck: true,
  forceConsistentCasingInFileNames: true,
  strict: true,
  moduleResolution: 'node',
  resolveJsonModule: true,
  types: ['node', 'jest'],
} as const;
const tsJestOptions = { tsconfig };
// allowJs only for the faker transform: with it on for the whole project TypeScript starts reading the project's own .cjs files
const fakerJestOptions = { tsconfig: { ...tsconfig, allowJs: true } };

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: './',
  testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/src/**/*.spec.ts'],
  collectCoverage: true,
  collectCoverageFrom: [
    'src/modules/ai/prompt.service.ts',
    'src/modules/mock/routeResolution.service.ts',
    'src/modules/mock/swaggerGenerator.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@mockia/shared$': '<rootDir>/../shared/src/index.ts',
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  // "." stands for the path separator: Windows paths have backslashes
  transform: {
    '^.+\\.ts$': ['ts-jest', tsJestOptions],
    'node_modules.@faker-js.+\\.js$': ['ts-jest', fakerJestOptions],
  },
  transformIgnorePatterns: ['node_modules.(?!@faker-js.)'],
  setupFilesAfterEnv: ['<rootDir>/src/tests/setup.ts'],
  testTimeout: 60000,
  maxWorkers: 1,
};

export default config;

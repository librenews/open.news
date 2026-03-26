import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      BASE_URL: 'http://localhost',
    },
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/db/migrations/**',
        'src/web/index.tsx',       // server entrypoint
        'src/worker/index.ts',     // worker entrypoint
        'src/firehose/index.ts',   // firehose entrypoint (tested via unit)
      ],
      thresholds: {
        branches: 80,
        functions: 85,
        lines: 85,
        statements: 85,
      },
    },
  },
});

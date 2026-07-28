import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // tests/harper is excluded: it loads the real 18 MB WASM engine and runs
    // only via `npm run test:harper` (see vitest.harper.config.ts).
    include: [
      'tests/unit/**/*.test.ts',
      'tests/unit/**/*.test.mjs',
      'tests/integration/**/*.test.ts',
      'tests/browser/**/*.test.ts',
    ],
    environmentMatchGlobs: [
      ['tests/integration/**', 'jsdom'],
      ['tests/browser/**', 'jsdom'],
    ],
    environment: 'node',
    restoreMocks: true,
  },
});

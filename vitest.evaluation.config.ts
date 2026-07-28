import { defineConfig } from 'vitest/config';

/**
 * Development-only evaluation runs.
 *
 * Separate from the main config because these parse a 14 MB corpus and produce
 * measurements rather than assertions. `npm run check` must stay fast, and a
 * corpus that is absent must not fail the build.
 */
export default defineConfig({
  test: {
    include: ['tests/evaluation/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
    testTimeout: 180_000,
  },
});

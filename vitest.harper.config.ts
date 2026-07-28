import { defineConfig } from 'vitest/config';

/**
 * Opt-in conformance run against the real Harper WASM engine (~18 MB, several
 * seconds of setup). Kept out of the default suite on purpose:
 *   npm run test:harper
 */
export default defineConfig({
  test: {
    include: ['tests/harper/**/*.test.ts'],
    environment: 'node',
    testTimeout: 180_000,
    hookTimeout: 180_000,
    restoreMocks: true,
  },
});

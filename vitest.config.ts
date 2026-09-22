import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

/**
 * `WxtVitest()` is what makes `@/` paths, WXT's auto-imports and the `browser`
 * global resolve inside tests. Without it every test file fails at import time.
 */
export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'jsdom',
    // Also what enables Testing Library's automatic cleanup between tests.
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});

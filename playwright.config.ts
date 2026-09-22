import { defineConfig } from '@playwright/test';

/**
 * End-to-end checks against the REAL built extension. Separate from `npm test`
 * on purpose: this needs `wxt build` and a real browser, so it stays a
 * deliberate command rather than something that runs on every edit.
 *
 * Note `channel: 'chromium'` in the spec — Chrome and Edge removed the
 * command-line flags for side-loading an unpacked extension, so only the
 * Chromium that ships with Playwright can load one.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 60_000,
  webServer: {
    // Serves `dev/plain.html` over http, which is what the content script needs
    // — `file://` never matches `http://*/*`.
    command: 'npx vite --config dev/vite.config.ts --port 5200 --strictPort',
    url: 'http://localhost:5200/plain.html',
    reuseExistingServer: true,
    timeout: 30_000,
  },
  use: { baseURL: 'http://localhost:5200' },
});

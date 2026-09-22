import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');

/**
 * The dev harness: the real content-script UI, mounted on a realistic page, in
 * a real browser, so the spotlight's geometry can be checked against actual
 * layout — which the jsdom suite cannot do.
 *
 * `@/lib/messaging` is aliased to a stand-in so the harness needs no API key
 * and no network. Everything else, including `lib/snapshot` and `lib/refs`, is
 * the real thing.
 */
export default defineConfig({
  root: here,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: /^@\/lib\/messaging$/, replacement: resolve(here, 'fake-background.ts') },
      { find: /^@\//, replacement: `${repo}/` },
    ],
  },
  server: { port: 5199, strictPort: true },
});

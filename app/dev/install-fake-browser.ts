import { fakeBrowser } from 'wxt/testing/fake-browser';

/**
 * Must run before anything that touches extension storage.
 *
 * `lib/settings.ts` calls `storage.defineItem` at module scope, and
 * `@wxt-dev/storage` reads `globalThis.browser` when it first resolves a
 * storage area — which happens during the import graph, not later. ES module
 * imports are evaluated before the importing module's body, so doing this
 * inline in `main.tsx` would be too late. Hence a separate module, imported
 * first: import order for side effects is the one ordering guarantee we get.
 */
Object.assign(globalThis, { browser: fakeBrowser, chrome: fakeBrowser });

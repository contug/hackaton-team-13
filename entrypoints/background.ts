import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import type { BgRequest } from '@/lib/messaging';
import { handle } from '@/lib/handlers';
import { friendlyError } from '@/lib/openrouter';

/**
 * All OpenRouter traffic goes through here, for two reasons:
 *
 * 1. Host-page CSP. A fetch from a content script is subject to the page's
 *    `connect-src`, and the dense pages this extension targets (banks,
 *    dashboards, checkouts) routinely block third-party origins. The service
 *    worker is not subject to page CSP.
 * 2. Key containment. The API key is read here and nowhere else. The content
 *    script sends a snapshot and receives an answer; it never sees the key.
 *
 * Do not move a call into the content script for convenience. The router itself
 * lives in `lib/handlers.ts` so it stays directly testable.
 */
export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    handle(message as BgRequest)
      .then(sendResponse)
      .catch((err: unknown) => sendResponse({ ok: false, error: friendlyError(err) }));

    // Keep the message channel open for the async reply.
    return true;
  });
});

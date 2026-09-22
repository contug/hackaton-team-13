import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import type { BgRequest, BgResponse } from '@/lib/messaging';
import { apiKeyItem, modelItem } from '@/lib/settings';
import {
  askAboutPage,
  friendlyError,
  listModels,
  summarizePage,
  validateKey,
} from '@/lib/openrouter';

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
 * Do not move a call into the content script for convenience.
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

async function requireKey(): Promise<string> {
  const key = await apiKeyItem.getValue();
  if (!key) throw new Error('No API key set yet.');
  return key;
}

async function handle(request: BgRequest): Promise<BgResponse<unknown>> {
  try {
    switch (request.type) {
      case 'getSettings': {
        const [key, model] = await Promise.all([apiKeyItem.getValue(), modelItem.getValue()]);
        return { ok: true, data: { hasApiKey: Boolean(key), model } };
      }

      case 'saveSettings': {
        const trimmed = request.apiKey.trim();
        if (!trimmed) return { ok: false, error: 'Enter an API key.' };

        const check = await validateKey(trimmed);
        if (!check.valid) return { ok: false, error: 'That API key was rejected by OpenRouter.' };

        await Promise.all([
          apiKeyItem.setValue(trimmed),
          modelItem.setValue(request.model.trim() || (await modelItem.getValue())),
        ]);
        return { ok: true, data: { saved: true, note: check.note } };
      }

      case 'listModels': {
        return { ok: true, data: await listModels(await requireKey()) };
      }

      case 'summarize': {
        const [key, model] = await Promise.all([requireKey(), modelItem.getValue()]);
        return { ok: true, data: await summarizePage(key, model, request.snapshot) };
      }

      case 'ask': {
        const [key, model] = await Promise.all([requireKey(), modelItem.getValue()]);
        return {
          ok: true,
          data: await askAboutPage(key, model, request.snapshot, request.question, request.history),
        };
      }
    }
  } catch (err) {
    return { ok: false, error: friendlyError(err) };
  }
}

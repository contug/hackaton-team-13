import type { BgRequest, BgResponse } from './messaging';
import { apiKeyItem, modelItem } from './settings';
import { askAboutPage, friendlyError, listModels, summarizePage, validateKey } from './openrouter';

/**
 * The background message router, kept out of `entrypoints/background.ts` so it
 * can be called directly — by the service worker's `onMessage` listener in
 * production, and by tests without going through listener plumbing.
 *
 * Nothing conversational is stored here. `history` arrives on every `ask` and is
 * dropped again with the response; that is what keeps tabs independent.
 */
export async function handle(request: BgRequest): Promise<BgResponse<unknown>> {
  try {
    switch (request.type) {
      case 'getSettings': {
        const [key, model] = await Promise.all([apiKeyItem.getValue(), modelItem.getValue()]);
        // Boolean, never the key itself — this boundary is the containment rule.
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

async function requireKey(): Promise<string> {
  const key = await apiKeyItem.getValue();
  if (!key) throw new Error('No API key set yet.');
  return key;
}

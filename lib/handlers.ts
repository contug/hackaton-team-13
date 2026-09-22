import type { BgRequest, BgResponse, BgSender } from './messaging';
import {
  apiKeyItem,
  deleteJourney,
  modelItem,
  readJourney,
  writeJourney,
} from './settings';
import {
  askAboutPage,
  friendlyError,
  listModels,
  nextSteps,
  summarizePage,
  validateKey,
} from './openrouter';

/**
 * The background message router, kept out of `entrypoints/background.ts` so it
 * can be called directly — by the service worker's `onMessage` listener in
 * production, and by tests without going through listener plumbing.
 *
 * The transcript is still not stored here: `history` arrives on every `ask` and
 * is dropped again with the response. One journey per tab *is* stored, keyed by
 * the tab id the browser puts on `sender` — see the comment in `messaging.ts`
 * for why that is the one thing allowed to outlive the content script.
 *
 * `sender` is optional so the direct-call tests keep working. A journey request
 * without one is answered with a friendly error rather than a throw: there is
 * no such thing as a tab-less journey.
 */
export async function handle(
  request: BgRequest,
  sender?: BgSender,
): Promise<BgResponse<unknown>> {
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

      case 'nextSteps': {
        const [key, model] = await Promise.all([requireKey(), modelItem.getValue()]);
        return {
          ok: true,
          data: await nextSteps(key, model, request.snapshot, request.goal, request.done),
        };
      }

      case 'saveJourney': {
        await writeJourney(requireTabId(sender), request.journey);
        return { ok: true, data: { saved: true } };
      }

      case 'getJourney': {
        return { ok: true, data: await readJourney(requireTabId(sender)) };
      }

      case 'clearJourney': {
        await deleteJourney(requireTabId(sender));
        return { ok: true, data: { cleared: true } };
      }
    }
  } catch (err) {
    return { ok: false, error: friendlyError(err) };
  }
}

/**
 * The tab id comes from the browser, never from the message. That is what makes
 * the per-tab isolation an invariant instead of a convention — a content script
 * has no way to name a tab that is not its own.
 */
function requireTabId(sender?: BgSender): number {
  const id = sender?.tab?.id;
  if (id === undefined) throw new Error('This page has no tab, so it cannot be guided.');
  return id;
}

async function requireKey(): Promise<string> {
  const key = await apiKeyItem.getValue();
  if (!key) throw new Error('No API key set yet.');
  return key;
}

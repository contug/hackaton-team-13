import { browser } from 'wxt/browser';
import type { PageSnapshot } from './snapshot';
import type { Answer, ModelOption, Summary, Turn } from './openrouter';

/**
 * Typed content-script <-> background protocol.
 *
 * Note what is NOT here: there is no session id and no "get my conversation".
 * `history` travels up from the content script on every `ask` and is never
 * retained in the background. That is the mechanism that keeps tabs
 * independent — do not add a background-side conversation map.
 */
export type BgRequest =
  | { type: 'summarize'; snapshot: PageSnapshot }
  | { type: 'ask'; snapshot: PageSnapshot; question: string; history: Turn[] }
  | { type: 'getSettings' }
  | { type: 'saveSettings'; apiKey: string; model: string }
  | { type: 'listModels' };

export interface SettingsView {
  /** Whether a key is stored. The key itself never crosses this boundary. */
  hasApiKey: boolean;
  model: string;
}

export interface BgResponseMap {
  summarize: Summary;
  ask: Answer;
  getSettings: SettingsView;
  saveSettings: { saved: boolean; note?: string };
  listModels: ModelOption[];
}

export type BgResponse<T> = { ok: true; data: T } | { ok: false; error: string };

export async function sendToBackground<K extends BgRequest['type']>(
  request: Extract<BgRequest, { type: K }>,
): Promise<BgResponse<BgResponseMap[K]>> {
  try {
    return (await browser.runtime.sendMessage(request)) as BgResponse<BgResponseMap[K]>;
  } catch (err) {
    // Thrown when the service worker is gone mid-flight (extension reload).
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'The extension background is unavailable.',
    };
  }
}

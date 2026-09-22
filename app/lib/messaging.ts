import { browser } from 'wxt/browser';
import type { PageSnapshot } from './snapshot';
import type { Answer, ModelOption, Summary, Turn } from './openrouter';
import type { Journey } from './journey';

/**
 * Typed content-script <-> background protocol.
 *
 * What is stored in the background, and what is not:
 *
 * - **The transcript is not.** `history` travels up from the content script on
 *   every `ask` and is dropped again with the response. There is no session id
 *   and no "get my conversation". Do not add one.
 * - **One journey per tab is**, under `saveJourney`/`getJourney`/
 *   `clearJourney`. That is a deliberate change of rule, not a leak: a journey
 *   is the only thing that has to survive a cross-origin page load, which
 *   destroys the content script and everything in its React state. It holds the
 *   goal, the current steps and the progress — never the transcript, and never
 *   anything from another tab.
 *
 * Isolation is now enforced rather than documented: the tab id comes from the
 * `sender` the browser attaches, so a content script cannot ask for another
 * tab's journey by claiming its id. `tests/handlers.test.ts` asserts that two
 * tab ids never see each other's journey.
 *
 * The background relays instead of letting the content script read session
 * storage itself because that would need
 * `setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })` — a
 * single global switch exposing *every* session key to *every* content script
 * on *every* page, in both directions.
 */
export type BgRequest =
  | { type: 'summarize'; snapshot: PageSnapshot }
  | { type: 'ask'; snapshot: PageSnapshot; question: string; history: Turn[] }
  | { type: 'nextSteps'; snapshot: PageSnapshot; goal: string; done: string[] }
  | { type: 'getSettings' }
  | { type: 'saveSettings'; apiKey: string; model: string }
  | { type: 'listModels' }
  | { type: 'saveJourney'; journey: Journey }
  | { type: 'getJourney' }
  | { type: 'clearJourney' };

/**
 * The only part of `browser.runtime.MessageSender` a journey needs. Structural,
 * so the real sender satisfies it and a test can hand in `{ tab: { id: 7 } }`.
 */
export interface BgSender {
  tab?: { id?: number | undefined } | undefined;
}

export interface SettingsView {
  /** Whether a key is stored. The key itself never crosses this boundary. */
  hasApiKey: boolean;
  model: string;
}

export interface BgResponseMap {
  summarize: Summary;
  ask: Answer;
  nextSteps: Answer;
  getSettings: SettingsView;
  saveSettings: { saved: boolean; note?: string };
  listModels: ModelOption[];
  saveJourney: { saved: true };
  /** `null` when this tab has no walkthrough in flight — the common case. */
  getJourney: Journey | null;
  clearJourney: { cleared: true };
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

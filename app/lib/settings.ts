import { storage } from '@wxt-dev/storage';
import type { Journey } from './journey';

/**
 * The OpenRouter key lives in extension storage and is read *only* by the
 * background service worker. It must never be sent to a content script.
 */
export const apiKeyItem = storage.defineItem<string | null>('local:openrouter_api_key', {
  fallback: null,
});

/**
 * A `~...-latest` alias rather than a pinned id: aliases keep working as
 * OpenRouter rotates model versions, so a fresh install never lands on a 404.
 */
export const DEFAULT_MODEL = '~anthropic/claude-sonnet-latest';

export const modelItem = storage.defineItem<string>('local:openrouter_model', {
  fallback: DEFAULT_MODEL,
});

/**
 * One session-storage key per tab, holding that tab's walkthrough.
 *
 * `session:` rather than `local:` because a journey is exactly as long-lived as
 * the browser: it is in-memory, dies on restart, and never leaves a stale plan
 * behind on disk for a task the user abandoned weeks ago.
 *
 * One key per tab rather than a single `Record<tabId, Journey>`, because a
 * shared record needs read-modify-write: two tabs saving across an `await`
 * would silently clobber each other's journey.
 */
function journeyKey(tabId: number): `session:${string}` {
  return `session:journey:${tabId}`;
}

export function readJourney(tabId: number): Promise<Journey | null> {
  return storage.getItem<Journey>(journeyKey(tabId));
}

export function writeJourney(tabId: number, journey: Journey): Promise<void> {
  return storage.setItem<Journey>(journeyKey(tabId), journey);
}

/**
 * Called both when the user stops a walkthrough and when the tab closes. There
 * is no age-based sweep: session storage dying with the browser is the rest of
 * the eviction story, and a sweep would need `storage.session.getKeys()`, which
 * `fakeBrowser` does not implement.
 */
export function deleteJourney(tabId: number): Promise<void> {
  return storage.removeItem(journeyKey(tabId));
}

import { storage } from '@wxt-dev/storage';

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

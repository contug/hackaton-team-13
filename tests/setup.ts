import '@testing-library/jest-dom/vitest';
import { beforeEach, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

/**
 * jsdom implements no layout: `getBoundingClientRect()` returns all zeros. That
 * would make `isRendered()` in `lib/snapshot.ts` reject *every* element and
 * leave the outline tests vacuous, so we stub a plausible default rect.
 *
 * A test can place an element with `data-test-rect="top,height"` to control the
 * vertical position, which is what makes `inViewport` assertions mean anything.
 * `display`/`visibility`/`opacity` filtering stays real — jsdom does implement
 * `getComputedStyle` — so only "hidden because it has zero size" is simulated.
 */
const DEFAULT_WIDTH = 200;
const DEFAULT_HEIGHT = 20;

Element.prototype.getBoundingClientRect = function getBoundingClientRect(this: Element): DOMRect {
  const spec = this.getAttribute?.('data-test-rect');
  let top = 0;
  let height = DEFAULT_HEIGHT;

  if (spec) {
    const [rawTop, rawHeight] = spec.split(',');
    top = Number(rawTop);
    if (rawHeight !== undefined) height = Number(rawHeight);
  }

  const rect = {
    x: 0,
    y: top,
    top,
    left: 0,
    right: DEFAULT_WIDTH,
    bottom: top + height,
    width: DEFAULT_WIDTH,
    height,
  };
  return { ...rect, toJSON: () => rect } as DOMRect;
};

/**
 * jsdom does not implement `innerText` at all. `lib/snapshot.ts` already falls
 * back to `textContent`, so this only changes one thing: it lets the text branch
 * of `pageIsWorthHelpingWith()` run. Unlike the real `innerText`, the stub is
 * not rendering-aware — hidden text still counts.
 */
Object.defineProperty(HTMLElement.prototype, 'innerText', {
  configurable: true,
  get(this: HTMLElement) {
    return this.textContent ?? '';
  },
});

/** WXT storage is in-memory per test; without this, state leaks between tests. */
beforeEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  document.title = '';
});

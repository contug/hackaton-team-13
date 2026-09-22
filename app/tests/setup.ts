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
 *
 * An element that pins its own size with an inline `width`/`height` in pixels
 * reports that size. `components/Spotlight.tsx` does exactly that for its
 * fixed-position sentinel, and the sentinel's measured size is the whole input
 * to `fixedFrameCorrection` — so without this the probe would read 200x20 and
 * the correction would scale every rect in the suite.
 */
const DEFAULT_WIDTH = 200;
const DEFAULT_HEIGHT = 20;

function inlinePx(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = /^(-?[\d.]+)px$/.exec(value.trim());
  return match ? Number(match[1]) : undefined;
}

Element.prototype.getBoundingClientRect = function getBoundingClientRect(this: Element): DOMRect {
  const spec = this.getAttribute?.('data-test-rect');
  const inline = (this as HTMLElement).style;

  let left = inlinePx(inline?.left) ?? 0;
  let top = inlinePx(inline?.top) ?? 0;
  let width = inlinePx(inline?.width) ?? DEFAULT_WIDTH;
  let height = inlinePx(inline?.height) ?? DEFAULT_HEIGHT;

  // The explicit test knob wins over anything the component styled itself with.
  if (spec) {
    const [rawTop, rawHeight] = spec.split(',');
    top = Number(rawTop);
    if (rawHeight !== undefined) height = Number(rawHeight);
  }

  const rect = {
    x: left,
    y: top,
    top,
    left,
    right: left + width,
    bottom: top + height,
    width,
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

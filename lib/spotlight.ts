import type { OutlineEntry } from './snapshot';

/**
 * All of the spotlight's arithmetic, as pure functions over plain rectangles.
 *
 * Nothing here touches `window`, `document` or an `Element`. That is deliberate:
 * jsdom implements no layout, so anything that measured for itself would be
 * untestable. `components/Spotlight.tsx` measures and passes the numbers in;
 * this file decides what to do with them. Keep it that way.
 *
 * `Rect` is structurally satisfied by `DOMRect`, so callers can pass
 * `el.getBoundingClientRect()` straight in.
 */
export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Size {
  w: number;
  h: number;
}

/** Breathing room left around the target inside the scrim's hole. */
export const SCRIM_PAD = 6;
/** Distance between the target's edge and the tooltip. */
export const TOOLTIP_GAP = 12;
/** Nothing is ever placed closer than this to a viewport edge. */
export const EDGE_MARGIN = 8;
/** A target bigger than this share of the viewport is not worth ringing. */
export const MAX_TARGET_AREA_RATIO = 0.6;
/** The vertical band, as a share of the viewport, that counts as "comfortably in view". */
export const SCROLL_COMFORT_BAND = 0.15;

export function padRect(r: Rect, pad: number): Rect {
  return {
    top: r.top - pad,
    left: r.left - pad,
    width: r.width + pad * 2,
    height: r.height + pad * 2,
  };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.left < b.left + b.width &&
    a.left + a.width > b.left &&
    a.top < b.top + b.height &&
    a.top + a.height > b.top
  );
}

function clampToViewport(r: Rect, vp: Size): Rect {
  const left = Math.max(0, r.left);
  const top = Math.max(0, r.top);
  return {
    top,
    left,
    width: Math.max(0, Math.min(vp.w, r.left + r.width) - left),
    height: Math.max(0, Math.min(vp.h, r.top + r.height) - top),
  };
}

function round(r: Rect): Rect {
  return {
    top: Math.round(r.top),
    left: Math.round(r.left),
    width: Math.round(r.width),
    height: Math.round(r.height),
  };
}

/**
 * The viewport minus a hole, as up to four non-overlapping bands.
 *
 * Four rectangles rather than a `box-shadow: 0 0 0 9999px` or `clip-path`
 * trick, because those move the geometry into the compositor where no test can
 * reach it — and because a 9999px spread overpaints at high browser zoom.
 */
export function scrimRects(hole: Rect, vp: Size): Rect[] {
  const h = clampToViewport(hole, vp);
  if (h.width <= 0 || h.height <= 0) {
    return [{ top: 0, left: 0, width: vp.w, height: vp.h }];
  }

  const bands: Rect[] = [
    { top: 0, left: 0, width: vp.w, height: h.top },
    { top: h.top + h.height, left: 0, width: vp.w, height: vp.h - (h.top + h.height) },
    { top: h.top, left: 0, width: h.left, height: h.height },
    { top: h.top, left: h.left + h.width, width: vp.w - (h.left + h.width), height: h.height },
  ];

  return bands.filter((b) => b.width > 0 && b.height > 0).map(round);
}

export interface Placement {
  top: number;
  left: number;
  side: 'above' | 'below';
  /**
   * True when no placement could clear `avoid`. Reported rather than hidden,
   * because silently rendering the tooltip behind our own panel is a lie.
   */
  overlapsAvoid: boolean;
}

function clampLeft(preferred: number, vp: Size, tooltip: Size): number {
  const min = EDGE_MARGIN;
  const max = vp.w - EDGE_MARGIN - tooltip.w;
  if (max < min) return min;
  return Math.round(Math.min(max, Math.max(min, preferred)));
}

function topFor(side: 'above' | 'below', target: Rect, tooltip: Size): number {
  return side === 'below'
    ? target.top + target.height + TOOLTIP_GAP
    : target.top - TOOLTIP_GAP - tooltip.h;
}

function fitsVertically(top: number, vp: Size, tooltip: Size): boolean {
  return top >= EDGE_MARGIN && top + tooltip.h <= vp.h - EDGE_MARGIN;
}

/** Where the tooltip goes: prefer below, flip above, clamp inside, dodge `avoid`. */
export function tooltipPlacement(
  target: Rect,
  vp: Size,
  tooltip: Size,
  avoid?: Rect | null,
): Placement {
  const belowTop = topFor('below', target, tooltip);
  const aboveTop = topFor('above', target, tooltip);

  let side: 'above' | 'below';
  let top: number;

  if (fitsVertically(belowTop, vp, tooltip)) {
    side = 'below';
    top = belowTop;
  } else if (fitsVertically(aboveTop, vp, tooltip)) {
    side = 'above';
    top = aboveTop;
  } else {
    // Neither side fits: take the roomier one and clamp into the viewport.
    const roomBelow = vp.h - (target.top + target.height);
    side = roomBelow >= target.top ? 'below' : 'above';
    const max = vp.h - EDGE_MARGIN - tooltip.h;
    top = max < EDGE_MARGIN ? EDGE_MARGIN : Math.min(max, Math.max(EDGE_MARGIN, side === 'below' ? belowTop : aboveTop));
  }

  const left = clampLeft(target.left + target.width / 2 - tooltip.w / 2, vp, tooltip);
  const placed: Placement = { top: Math.round(top), left, side, overlapsAvoid: false };

  if (!avoid) return placed;

  const asRect = (p: Placement): Rect => ({ ...p, width: tooltip.w, height: tooltip.h });
  if (!rectsIntersect(asRect(placed), avoid)) return placed;

  // a. the other side, same column
  const otherSide = placed.side === 'below' ? 'above' : 'below';
  const otherTop = topFor(otherSide, target, tooltip);
  const flipped: Placement = { top: Math.round(otherTop), left, side: otherSide, overlapsAvoid: false };
  if (fitsVertically(otherTop, vp, tooltip) && !rectsIntersect(asRect(flipped), avoid)) {
    return flipped;
  }

  // b. slide clear to the left of it — the panel lives bottom-right, so left is
  //    the natural escape — then c. to the right.
  for (const candidateLeft of [
    avoid.left - TOOLTIP_GAP - tooltip.w,
    avoid.left + avoid.width + TOOLTIP_GAP,
  ]) {
    if (candidateLeft < EDGE_MARGIN) continue;
    if (candidateLeft + tooltip.w > vp.w - EDGE_MARGIN) continue;
    const slid: Placement = { ...placed, left: Math.round(candidateLeft) };
    if (!rectsIntersect(asRect(slid), avoid)) return slid;
  }

  return { ...placed, overlapsAvoid: true };
}

/** Is this target worth drawing at all? */
export function isSpotlightable(r: Rect, vp: Size): boolean {
  if (r.width <= 0 || r.height <= 0) return false;
  // The outline includes landmarks, so a model can cite <main>. A hole the size
  // of the page communicates nothing, so refuse rather than mislead.
  return r.width * r.height <= MAX_TARGET_AREA_RATIO * vp.w * vp.h;
}

/**
 * Should the page move before we draw? Takes no document height on purpose:
 * `documentElement.scrollHeight` is 0 in jsdom, so clamping against document
 * extents here would be untestable. The browser clamps the scroll for us.
 */
export function needsScroll(r: Rect, vp: Size): boolean {
  const comfortTop = vp.h * SCROLL_COMFORT_BAND;
  const comfortBottom = vp.h * (1 - SCROLL_COMFORT_BAND);

  if (r.height > comfortBottom - comfortTop) {
    // Taller than the comfortable band — settle for its top edge being on screen.
    return r.top < 0 || r.top > comfortBottom;
  }
  return r.top < comfortTop || r.top + r.height > comfortBottom;
}

/**
 * The first ref the model returned that actually exists in the outline we sent.
 * Nothing else validates that — a model is free to invent `e404`, and ringing
 * whatever happens to hold that id would be worse than ringing nothing.
 */
export function pickSpotlightRef(refs: string[], outline: OutlineEntry[]): string | null {
  for (const ref of refs) {
    if (outline.some((entry) => entry.ref === ref)) return ref;
  }
  return null;
}

export interface FrameCorrection {
  dx: number;
  dy: number;
  scale: number;
  /** False when the probe came back degenerate — the caller should draw nothing. */
  trusted: boolean;
}

/**
 * `position: fixed` resolves against the viewport unless an ancestor created a
 * containing block (`transform`, `filter`, `perspective`, `contain`, …). Rather
 * than sniff for CSS properties — a list that is always one spec behind — the
 * component renders a hidden sentinel at `top: 0; left: 0` and hands its rect
 * here. If fixed positioning is honest the rect is exactly `expected` at the
 * origin; any deviation *is* the error, whatever caused it.
 */
export function fixedFrameCorrection(probe: Rect, expected: Size): FrameCorrection {
  const scale = probe.width / expected.w;
  const trusted = Number.isFinite(scale) && scale > 0.1 && scale < 10;
  if (!trusted) return { dx: 0, dy: 0, scale: 1, trusted: false };

  return {
    // `=== 0` rather than arithmetic, to avoid handing back -0.
    dx: probe.left === 0 ? 0 : -probe.left / scale,
    dy: probe.top === 0 ? 0 : -probe.top / scale,
    scale,
    trusted: true,
  };
}

export function applyCorrection(r: Rect, c: FrameCorrection): Rect {
  return {
    top: r.top / c.scale + c.dy,
    left: r.left / c.scale + c.dx,
    width: r.width / c.scale,
    height: r.height / c.scale,
  };
}

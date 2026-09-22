import { describe, expect, it } from 'vitest';
import {
  EDGE_MARGIN,
  applyCorrection,
  fixedFrameCorrection,
  isSpotlightable,
  needsScroll,
  pickSpotlightRef,
  scrimRects,
  tooltipPlacement,
  type Rect,
} from '@/lib/spotlight';
import { snapshotFixture } from './fixtures';

const VP = { w: 1000, h: 800 };

function rect(over: Partial<Rect> = {}): Rect {
  return { top: 300, left: 400, width: 200, height: 40, ...over };
}

function area(r: Rect): number {
  return Math.max(0, r.width) * Math.max(0, r.height);
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.left < b.left + b.width &&
    a.left + a.width > b.left &&
    a.top < b.top + b.height &&
    a.top + a.height > b.top
  );
}

describe('scrimRects', () => {
  it('tiles the viewport around the hole with no gaps and no overlap', () => {
    const hole = rect();
    const bands = scrimRects(hole, VP);

    // The property is what matters, not the individual coordinates: the bands
    // plus the hole must account for the viewport exactly once.
    const covered = bands.reduce((sum, band) => sum + area(band), 0);
    expect(covered).toBe(VP.w * VP.h - area(hole));

    for (const band of bands) expect(overlaps(band, hole)).toBe(false);
    for (let i = 0; i < bands.length; i++) {
      for (let j = i + 1; j < bands.length; j++) {
        expect(overlaps(bands[i]!, bands[j]!)).toBe(false);
      }
    }
  });

  it('drops bands with no area when the target touches an edge', () => {
    const bands = scrimRects({ top: 0, left: 0, width: VP.w, height: 100 }, VP);

    // No room above and none to either side: only the bottom band survives.
    expect(bands).toHaveLength(1);
    expect(bands[0]).toEqual({ top: 100, left: 0, width: 1000, height: 700 });
  });

  it('clamps a hole that hangs off the viewport', () => {
    const bands = scrimRects({ top: 700, left: 900, width: 400, height: 400 }, VP);

    const covered = bands.reduce((sum, band) => sum + area(band), 0);
    // The clamped hole is 100x100 in the bottom-right corner.
    expect(covered).toBe(VP.w * VP.h - 100 * 100);
    for (const band of bands) {
      expect(band.left).toBeGreaterThanOrEqual(0);
      expect(band.top).toBeGreaterThanOrEqual(0);
      expect(band.left + band.width).toBeLessThanOrEqual(VP.w);
      expect(band.top + band.height).toBeLessThanOrEqual(VP.h);
    }
  });

  it('covers the whole viewport when the hole is entirely outside it', () => {
    const bands = scrimRects({ top: -500, left: -500, width: 100, height: 100 }, VP);
    const covered = bands.reduce((sum, band) => sum + area(band), 0);
    expect(covered).toBe(VP.w * VP.h);
  });
});

describe('tooltipPlacement', () => {
  const TIP = { w: 280, h: 90 };

  it('places the tooltip below the target by default', () => {
    const target = rect({ top: 200, height: 40 });
    const placed = tooltipPlacement(target, VP, TIP);

    expect(placed.side).toBe('below');
    expect(placed.top).toBeGreaterThan(target.top + target.height);
    expect(placed.overlapsAvoid).toBe(false);
  });

  it('centres the tooltip on the target', () => {
    const placed = tooltipPlacement(rect({ left: 400, width: 200 }), VP, TIP);
    // Target centre is 500; a 280-wide tooltip centred on it starts at 360.
    expect(placed.left).toBe(360);
  });

  it('flips above when there is no room below', () => {
    const target = rect({ top: 760, height: 30 });
    const placed = tooltipPlacement(target, VP, TIP);

    expect(placed.side).toBe('above');
    expect(placed.top + TIP.h).toBeLessThanOrEqual(target.top);
    expect(placed.top).toBeGreaterThanOrEqual(EDGE_MARGIN);
  });

  it('clamps horizontally to stay inside the viewport', () => {
    const atLeft = tooltipPlacement(rect({ left: 0, width: 40 }), VP, TIP);
    expect(atLeft.left).toBe(EDGE_MARGIN);

    const atRight = tooltipPlacement(rect({ left: 960, width: 40 }), VP, TIP);
    expect(atRight.left).toBe(VP.w - EDGE_MARGIN - TIP.w);
  });

  it('pins a tooltip wider than the viewport to the left margin', () => {
    const placed = tooltipPlacement(rect(), { w: 200, h: 800 }, TIP);
    expect(placed.left).toBe(EDGE_MARGIN);
  });

  it('keeps the tooltip clear of the panel in the bottom-right corner', () => {
    // The real panel: 360 wide, 480 tall, 20px from the bottom-right corner.
    const panel = { top: 300, left: 620, width: 360, height: 480 };
    const target = rect({ top: 600, left: 700, width: 120, height: 40 });

    const placed = tooltipPlacement(target, VP, TIP, panel);

    expect(placed.overlapsAvoid).toBe(false);
    expect(overlaps({ ...placed, width: TIP.w, height: TIP.h }, panel)).toBe(false);
  });

  it('slides left of the panel when flipping sides is not enough', () => {
    // A target that fills the panel's vertical span: no side can clear it.
    const panel = { top: 0, left: 620, width: 360, height: 800 };
    const target = rect({ top: 380, left: 700, width: 120, height: 40 });

    const placed = tooltipPlacement(target, VP, TIP, panel);

    expect(placed.overlapsAvoid).toBe(false);
    expect(placed.left + TIP.w).toBeLessThanOrEqual(panel.left);
  });

  it('reports overlapsAvoid rather than lying when nothing clears the panel', () => {
    const panel = { top: 0, left: 0, width: 1000, height: 800 };
    const placed = tooltipPlacement(rect(), VP, TIP, panel);

    expect(placed.overlapsAvoid).toBe(true);
    // Still a usable placement — inside the viewport, just overlapping.
    expect(placed.left).toBeGreaterThanOrEqual(EDGE_MARGIN);
    expect(placed.top).toBeGreaterThanOrEqual(EDGE_MARGIN);
  });

  it('keeps a tooltip taller than the viewport at the top margin', () => {
    const placed = tooltipPlacement(rect(), VP, { w: 280, h: 900 });
    expect(placed.top).toBe(EDGE_MARGIN);
  });
});

describe('isSpotlightable', () => {
  it('rejects a target with no size', () => {
    expect(isSpotlightable(rect({ width: 0, height: 0 }), VP)).toBe(false);
  });

  it('rejects a target that covers most of the viewport', () => {
    // The outline contains landmarks, so a model can cite <main>. Ringing the
    // whole page communicates nothing.
    expect(isSpotlightable({ top: 0, left: 0, width: 1000, height: 700 }, VP)).toBe(false);
  });

  it('accepts a target below the fold, because we scroll to it', () => {
    expect(isSpotlightable(rect({ top: 4000 }), VP)).toBe(true);
  });

  it('accepts an ordinary button', () => {
    expect(isSpotlightable(rect(), VP)).toBe(true);
  });
});

describe('needsScroll', () => {
  it('asks for a scroll when the target sits below the fold', () => {
    expect(needsScroll(rect({ top: 4000 }), VP)).toBe(true);
  });

  it('asks for a scroll when the target is above the viewport', () => {
    expect(needsScroll(rect({ top: -200 }), VP)).toBe(true);
  });

  it('asks for a scroll when the target is only just on screen', () => {
    expect(needsScroll(rect({ top: 780, height: 40 }), VP)).toBe(true);
  });

  it('leaves the page alone when the target is comfortably in view', () => {
    expect(needsScroll(rect({ top: 400, height: 40 }), VP)).toBe(false);
  });
});

describe('pickSpotlightRef', () => {
  const outline = snapshotFixture().outline; // e1 heading, e2 button

  it('takes the first ref that exists in the outline', () => {
    expect(pickSpotlightRef(['e2', 'e1'], outline)).toBe('e2');
  });

  it('skips ref ids the model invented', () => {
    expect(pickSpotlightRef(['e404', 'e1'], outline)).toBe('e1');
  });

  it('returns null when nothing the model returned is real', () => {
    expect(pickSpotlightRef(['e404', 'e999'], outline)).toBeNull();
  });

  it('returns null for an empty refs array', () => {
    expect(pickSpotlightRef([], outline)).toBeNull();
  });
});

describe('fixedFrameCorrection', () => {
  const EXPECTED = { w: 100, h: 100 };

  it('is a no-op when fixed positioning resolves against the viewport', () => {
    const c = fixedFrameCorrection({ top: 0, left: 0, width: 100, height: 100 }, EXPECTED);

    expect(c).toEqual({ dx: 0, dy: 0, scale: 1, trusted: true });
    expect(applyCorrection(rect(), c)).toEqual(rect());
  });

  it('offsets coordinates for a translated ancestor', () => {
    // The probe should be at 0,0 — it is at 24,40, so that is the error.
    const c = fixedFrameCorrection({ top: 40, left: 24, width: 100, height: 100 }, EXPECTED);

    expect(c.scale).toBe(1);
    expect(c.dx).toBe(-24);
    expect(c.dy).toBe(-40);
    expect(applyCorrection(rect({ top: 300, left: 400 }), c)).toMatchObject({
      top: 260,
      left: 376,
    });
  });

  it('divides out a scaled ancestor', () => {
    const c = fixedFrameCorrection({ top: 0, left: 0, width: 50, height: 50 }, EXPECTED);

    expect(c.scale).toBe(0.5);
    expect(applyCorrection({ top: 100, left: 200, width: 60, height: 20 }, c)).toEqual({
      top: 200,
      left: 400,
      width: 120,
      height: 40,
    });
  });

  it('reports an untrusted frame when the probe has no size', () => {
    expect(fixedFrameCorrection({ top: 0, left: 0, width: 0, height: 0 }, EXPECTED).trusted).toBe(
      false,
    );
  });

  it('reports an untrusted frame for an absurd scale', () => {
    const c = fixedFrameCorrection({ top: 0, left: 0, width: 5000, height: 5000 }, EXPECTED);
    expect(c.trusted).toBe(false);
  });
});

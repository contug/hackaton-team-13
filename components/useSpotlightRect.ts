import { useEffect, useRef, useState, type RefObject } from 'react';
import { resolveRef } from '@/lib/refs';
import {
  fixedFrameCorrection,
  isSpotlightable,
  needsScroll,
  type FrameCorrection,
  type Rect,
  type Size,
} from '@/lib/spotlight';

/** The sentinel's CSS size. Its measured size is the whole frame check. */
export const PROBE_SIZE: Size = { w: 100, h: 100 };

/**
 * Frames to keep re-measuring after the highlight appears. Covers the layout
 * shift from images that finish loading after a scroll — which fires no event.
 */
const SETTLE_FRAMES = 36;

/**
 * Slow heartbeat while a highlight is up.
 *
 * Scroll and resize cover the common cases, but plenty of things move an
 * element without either: an accordion opening, a font swapping in, or an SPA
 * removing the target outright. Without this, a target that disappears leaves a
 * ring pointing at nothing until the user happens to scroll. Two rect reads a
 * second is a price worth paying to never lie about where something is — and
 * unlike `ResizeObserver`, which jsdom does not implement, a timer is something
 * a test can actually drive.
 */
const HEARTBEAT_MS = 500;

export interface SpotlightGeometry {
  /** Viewport coordinates, uncorrected — all the geometry math lives here. */
  target: Rect;
  avoid: Rect | null;
  viewport: Size;
  /**
   * Applied only when writing inline styles, never to the geometry inputs.
   * Correcting the inputs instead would leave the scrim computing bands for a
   * viewport that no longer starts at the origin — which dims nothing at all.
   */
  correction: FrameCorrection;
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (a === null || b === null) return a === b;
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

function sameGeometry(a: SpotlightGeometry | null, b: SpotlightGeometry | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    sameRect(a.target, b.target) &&
    sameRect(a.avoid, b.avoid) &&
    a.viewport.w === b.viewport.w &&
    a.viewport.h === b.viewport.h &&
    a.correction.scale === b.correction.scale &&
    a.correction.dx === b.correction.dx &&
    a.correction.dy === b.correction.dy
  );
}

function prefersReducedMotion(): boolean {
  // jsdom has no `matchMedia`; a defensive read beats another stub in setup.ts.
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
}

/**
 * Tracks where the spotlight target is, in viewport coordinates.
 *
 * Holds the **ref id**, never an `Element`: every measure goes back through
 * `resolveRef`, which already answers "is this element still real?" for us, so
 * an SPA that re-renders its DOM is handled without a MutationObserver.
 */
export function useSpotlightRect(params: {
  target: string;
  probeRef: RefObject<HTMLElement | null>;
  avoidRef?: RefObject<HTMLElement | null> | undefined;
  onLost: () => void;
}): SpotlightGeometry | null {
  const { target, probeRef, avoidRef, onLost } = params;
  const [geometry, setGeometry] = useState<SpotlightGeometry | null>(null);

  // Kept in a ref so a new callback identity does not re-subscribe the
  // listeners — and does not re-run the scroll-into-view.
  const onLostRef = useRef(onLost);
  onLostRef.current = onLost;
  const avoidRefRef = useRef(avoidRef);
  avoidRefRef.current = avoidRef;

  useEffect(() => {
    let frame = 0;
    let settle = 0;
    let scrolled = false;
    let cancelled = false;

    function schedule() {
      if (frame !== 0 || cancelled) return;
      frame = requestAnimationFrame(measure);
    }

    function measure() {
      frame = 0;
      if (cancelled) return;

      const probe = probeRef.current;
      const el = resolveRef(target);

      if (!el) {
        setGeometry(null);
        onLostRef.current();
        return;
      }

      const correction = fixedFrameCorrection(
        probe?.getBoundingClientRect() ?? { top: 0, left: 0, width: 0, height: 0 },
        PROBE_SIZE,
      );
      if (!correction.trusted) {
        // Our own coordinate frame is broken, not the target. Draw nothing and
        // leave the highlight in place — the panel still names the element.
        setGeometry(null);
        return;
      }

      const viewport = { w: window.innerWidth, h: window.innerHeight };
      const raw = el.getBoundingClientRect();

      if (!isSpotlightable(raw, viewport)) {
        setGeometry(null);
        onLostRef.current();
        return;
      }

      if (!scrolled) {
        scrolled = true;
        if (needsScroll(raw, viewport)) {
          el.scrollIntoView?.({
            block: 'center',
            inline: 'nearest',
            behavior: prefersReducedMotion() ? 'auto' : 'smooth',
          });
        }
        // Draw at the pre-scroll rect and let the settle loop correct it: the
        // first frame being right matters less than it appearing at all.
        settle = SETTLE_FRAMES;
      }

      const avoidEl = avoidRefRef.current?.current ?? null;
      const next: SpotlightGeometry = {
        target: raw,
        avoid: avoidEl?.getBoundingClientRect() ?? null,
        viewport,
        correction,
      };

      // Returning the previous object when nothing moved lets React bail out of
      // the re-render, which is what keeps the settle loop free.
      setGeometry((prev) => (sameGeometry(prev, next) ? prev : next));

      if (settle > 0) {
        settle -= 1;
        schedule();
      }
    }

    // Capture phase: `scroll` does not bubble, but it does propagate downward,
    // and dashboards scroll an inner container rather than the window.
    window.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    const heartbeat = setInterval(schedule, HEARTBEAT_MS);
    measure();

    return () => {
      cancelled = true;
      if (frame !== 0) cancelAnimationFrame(frame);
      clearInterval(heartbeat);
      window.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
    };
  }, [target, probeRef]);

  return geometry;
}

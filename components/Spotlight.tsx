import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { resolveRef } from '@/lib/refs';
import {
  SCRIM_PAD,
  applyCorrection,
  padRect,
  scrimRects,
  tooltipPlacement,
  type FrameCorrection,
  type Rect,
} from '@/lib/spotlight';
import { PROBE_SIZE, useSpotlightRect } from './useSpotlightRect';

interface Props {
  /** An outline ref id, e.g. "e7". Resolved fresh on every measure. */
  targetRef: string;
  /** The element's outline name, shown as the tooltip's heading. */
  label: string;
  /** `target_reason` — why this element is the one to go to. */
  reason: string;
  /** Our own panel or button, so the tooltip does not hide behind it. */
  avoidRef?: RefObject<HTMLElement | null>;
  onDismiss: () => void;
  /** The target is gone or undrawable; the owner should drop the highlight. */
  onLost: () => void;
}

/** One below the panel's z-[2147483000], so the scrim never dims our own UI. */
const Z_INDEX = 2147482999;
const TOOLTIP_WIDTH = 280;
/** Used for the first placement pass, before the tooltip has been measured. */
const TOOLTIP_HEIGHT_ESTIMATE = 96;
const MAX_RING_RADIUS = 24;

/**
 * Rings one element on the host page and says why, drawn entirely inside our
 * own shadow root.
 *
 * Nothing here writes to the host page — not a class, not an attribute, not a
 * style. The ring is our own box painted at the target's rect. Load-bearing
 * properties (position, geometry, z-index, pointer-events) are inline styles
 * rather than Tailwind classes, because Tailwind is not compiled in the test
 * environment and a class assertion there would prove nothing.
 */
export default function Spotlight({
  targetRef,
  label,
  reason,
  avoidRef,
  onDismiss,
  onLost,
}: Props) {
  const probeRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [tooltipHeight, setTooltipHeight] = useState(TOOLTIP_HEIGHT_ESTIMATE);

  const geometry = useSpotlightRect({ target: targetRef, probeRef, avoidRef, onLost });

  useLayoutEffect(() => {
    const measured = tooltipRef.current?.getBoundingClientRect().height;
    if (measured && measured !== tooltipHeight) setTooltipHeight(measured);
  }, [reason, label, tooltipHeight, geometry]);

  const radius = useRingRadius(targetRef, geometry !== null);

  return (
    <>
      {/*
        The frame sentinel. If `position: fixed` resolves against the viewport,
        this lands at the origin at its CSS size; any deviation is the error
        that `fixedFrameCorrection` divides back out.
      */}
      <div
        ref={probeRef}
        aria-hidden="true"
        data-testid="spotlight-probe"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: `${PROBE_SIZE.w}px`,
          height: `${PROBE_SIZE.h}px`,
          visibility: 'hidden',
          pointerEvents: 'none',
        }}
      />

      {geometry && (
        <SpotlightLayers
          hole={padRect(geometry.target, SCRIM_PAD)}
          viewport={geometry.viewport}
          correction={geometry.correction}
          avoid={geometry.avoid}
          tooltipHeight={tooltipHeight}
          tooltipRef={tooltipRef}
          radius={radius}
          label={label}
          reason={reason}
          onDismiss={onDismiss}
        />
      )}
    </>
  );
}

/** Read the target's corner radius once, so the ring follows rounded buttons. */
function useRingRadius(targetRef: string, active: boolean): number {
  const [radius, setRadius] = useState(8);

  useLayoutEffect(() => {
    if (!active) return;
    // Deliberately off the per-frame path: one read when the highlight starts.
    const el = resolveRef(targetRef);
    if (!el) return;
    const declared = Number.parseFloat(getComputedStyle(el).borderRadius);
    if (Number.isFinite(declared)) {
      setRadius(Math.min(MAX_RING_RADIUS, declared + SCRIM_PAD));
    }
  }, [targetRef, active]);

  return radius;
}

function SpotlightLayers(props: {
  hole: Rect;
  viewport: { w: number; h: number };
  correction: FrameCorrection;
  avoid: Rect | null;
  tooltipHeight: number;
  tooltipRef: RefObject<HTMLDivElement | null>;
  radius: number;
  label: string;
  reason: string;
  onDismiss: () => void;
}) {
  const { hole, viewport, correction, avoid, tooltipHeight, tooltipRef, radius, label, reason, onDismiss } =
    props;

  const placement = tooltipPlacement(
    hole,
    viewport,
    { w: TOOLTIP_WIDTH, h: tooltipHeight },
    avoid,
  );

  /**
   * Viewport coordinates in, CSS out. The correction is the last thing applied:
   * everything above this line reasons in plain viewport space, which is what
   * keeps `lib/spotlight.ts` pure and testable.
   */
  function box(r: Rect): { top: string; left: string; width: string; height: string } {
    const c = applyCorrection(r, correction);
    return {
      top: `${c.top}px`,
      left: `${c.left}px`,
      width: `${c.width}px`,
      height: `${c.height}px`,
    };
  }

  return (
    <>
      {scrimRects(hole, viewport).map((band) => (
        <div
          key={`${band.top}-${band.left}-${band.width}-${band.height}`}
          aria-hidden="true"
          data-testid="spotlight-scrim"
          className="bg-slate-950/40"
          style={{
            position: 'fixed',
            ...box(band),
            zIndex: Z_INDEX,
            pointerEvents: 'none',
          }}
        />
      ))}

      <div
        aria-hidden="true"
        data-testid="spotlight-ring"
        className="page-guide-ring border-2 border-sky-400 shadow-[0_0_0_4px_rgba(56,189,248,0.35)]"
        style={{
          position: 'fixed',
          ...box(hole),
          borderRadius: `${radius}px`,
          zIndex: Z_INDEX,
          pointerEvents: 'none',
        }}
      />

      <div
        ref={tooltipRef}
        data-testid="spotlight-tooltip"
        className="rounded-xl bg-slate-900 px-3 py-2.5 text-white shadow-2xl"
        style={{
          position: 'fixed',
          ...(({ top, left, width }) => ({ top, left, width }))(
            box({
              top: placement.top,
              left: placement.left,
              width: TOOLTIP_WIDTH,
              height: tooltipHeight,
            }),
          ),
          zIndex: Z_INDEX,
          // The only layer that takes clicks, because it carries the dismiss.
          pointerEvents: 'auto',
        }}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {/*
              Decoration: the announced copy is the `role="status"` block in the
              panel. An `aria-live` region here would double-announce it, and
              `role="tooltip"` would be a lie — it only means anything when a
              focusable element points at it with `aria-describedby`, and IDREFs
              do not cross shadow boundaries.
            */}
            <p aria-hidden="true" className="truncate text-xs font-semibold text-sky-300">
              {label}
            </p>
            <p aria-hidden="true" className="mt-0.5 text-xs leading-relaxed text-slate-100">
              {reason}
            </p>
          </div>

          <button
            type="button"
            aria-label="Hide highlight"
            onClick={onDismiss}
            className="shrink-0 rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
          >
            <svg viewBox="0 0 24 24" fill="none" className="size-3.5" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
    </>
  );
}

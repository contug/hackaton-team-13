import { useEffect, useRef } from 'react';

/**
 * Same cadence as `useSpotlightRect`'s heartbeat, for the same reason: two
 * reads a second is cheap, and it is something a test can drive.
 */
const POLL_MS = 500;

/**
 * Calls back when the page's URL changes under a live content script — an SPA
 * route change, a `pushState`, a hash change, a back button.
 *
 * **It polls `location.href`.** WXT does offer a `wxt:locationchange` event and
 * not using it is a deliberate call, backed by reading its source:
 *
 * - the event name is rewritten to
 *   `` `${browser.runtime.id}:${ENTRYPOINT}:wxt:locationchange` ``, so a plain
 *   `window.addEventListener('wxt:locationchange', …)` **never fires**. It only
 *   works through `ctx.addEventListener`, which would mean plumbing the
 *   `ContentScriptContext` from `index.tsx` down into a React component.
 * - WXT's own watcher **already polls**, at 1000ms, whenever the Navigation API
 *   is missing. So a poll is not a lesser mechanism here — it is the same
 *   mechanism, twice as responsive.
 * - jsdom has no Navigation API and does implement `history.pushState`, so a
 *   poll is what makes the re-plan path drivable from a test.
 *
 * The cost is latency: a fast SPA transition can briefly show the previous
 * page's highlight. `useSpotlightRect`'s `onLost` usually fires first and
 * clears it, but that ordering is not guaranteed and nothing asserts it.
 */
export function useUrlWatcher(onChange: (url: string) => void): void {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    // The URL at subscribe time is the baseline, so mounting never reports a
    // change. On a real page load the content script is brand new anyway, and
    // the restore path in `App.tsx` is what re-plans there.
    let last = window.location.href;

    const timer = setInterval(() => {
      const current = window.location.href;
      if (current === last) return;
      last = current;
      onChangeRef.current(current);
    }, POLL_MS);

    return () => clearInterval(timer);
  }, []);
}

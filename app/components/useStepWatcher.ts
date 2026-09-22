import { useEffect, useRef } from 'react';
import { fillSatisfied } from '@/lib/journey';
import type { Step } from '@/lib/openrouter';
import { resolveRef } from '@/lib/refs';

/**
 * Notices when the user has done the step we are pointing at, so the highlight
 * can move on by itself.
 *
 * **Both listeners are strictly read-only.** No `preventDefault`, no
 * `stopPropagation`: the user's click must reach the page exactly as if we were
 * not here, because it is the click that actually does the thing. That is worth
 * stating, because the Escape handler in `App.tsx` *does* call
 * `stopPropagation()` — a deliberate, narrow exception for a key many host
 * pages swallow, not a pattern to copy here.
 *
 * Capture phase, because a site is free to stop the click bubbling before it
 * reaches `document`. Capture runs on the way down, so we see it regardless.
 *
 * These are heuristics and they will sometimes be wrong — which is why the
 * tooltip also carries Next and Skip. The user must never be stuck.
 *
 * Known blind spots: `event.target` from inside a closed shadow root is the
 * host, and nothing inside an iframe is visible at all — but `buildSnapshot`
 * never saw those elements either, so they have no ref to be a step's target.
 */
export function useStepWatcher({
  step,
  onDone,
}: {
  step: Step | null;
  onDone: (how: 'click' | 'fill') => void;
}): void {
  // Kept in a ref so a fresh callback identity on every render does not
  // re-subscribe both listeners on every render.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const ref = step?.ref ?? '';
  const fill = step?.fill ?? '';

  useEffect(() => {
    // No step, or a step that is not about one element, registers nothing.
    // There is nothing to watch, and a listener on every page for no reason is
    // exactly the kind of cost this extension should not impose.
    if (!ref) return;

    function onClick(event: Event) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      // `contains`, not `===`: the click usually lands on a span or an svg
      // inside the button the snapshot named.
      if (resolveRef(ref)?.contains(target)) onDoneRef.current('click');
    }

    function onInput(event: Event) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (resolveRef(ref) !== target) return;

      const value = (target as HTMLInputElement | HTMLTextAreaElement).value;
      if (typeof value === 'string' && fillSatisfied({ text: '', ref, fill }, value)) {
        onDoneRef.current('fill');
      }
    }

    /**
     * Exactly one listener, chosen by the kind of step. A fill step is done by
     * typing, not by clicking — and registering both would advance it the
     * moment the user clicked into the field to start typing.
     */
    if (fill) document.addEventListener('input', onInput, true);
    else document.addEventListener('click', onClick, true);

    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('input', onInput, true);
    };
  }, [ref, fill]);
}

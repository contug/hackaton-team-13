import type { Step } from './openrouter';
import type { OutlineEntry } from './snapshot';

/**
 * The walkthrough's state, as pure functions over plain data.
 *
 * Nothing here touches `window`, `document` or an `Element`, for the same
 * reason `lib/spotlight.ts` does not: jsdom implements no layout and no
 * navigation, so anything that measured or navigated for itself would be
 * untestable. The hooks in `components/` watch; this file decides. Keep it that
 * way.
 *
 * A `Journey` is also the exact thing the background stores per tab. It is
 * plain JSON on purpose — it has to survive `structuredClone` through
 * `storage.setItem` and a cross-origin page load.
 */
export interface Journey {
  /** The user's original question. This is the thing that outlives the page. */
  goal: string;
  /** Steps for the page we are on now. */
  steps: Step[];
  index: number;
  /** Step texts already completed, across pages — the context for a re-plan. */
  done: string[];
  panelOpen: boolean;
  /** The URL the current steps were planned against. */
  url: string;
  updatedAt: number;
}

/**
 * The `done` list is capped the way `history` is capped at 6 in `App.tsx`: it
 * rides on every re-plan prompt, so unbounded growth would quietly inflate
 * every request for the rest of the task. The tail is kept — the most recent
 * steps are the ones that say where the user actually is.
 */
export const MAX_DONE = 10;

export function startJourney(goal: string, steps: Step[], url: string, now: number): Journey {
  return { goal, steps, index: 0, done: [], panelOpen: true, url, updatedAt: now };
}

export function currentStep(j: Journey | null): Step | null {
  if (!j) return null;
  return j.steps[j.index] ?? null;
}

/**
 * The user did the current step. Recorded in `done`, because that list is the
 * only memory of what happened on the pages we have already left.
 */
export function advance(j: Journey): Journey {
  const step = currentStep(j);
  return {
    ...j,
    index: Math.min(j.index + 1, j.steps.length),
    done: step ? [...j.done, step.text].slice(-MAX_DONE) : j.done,
  };
}

/**
 * Move on without recording it. `skip` exists because the watchers are
 * heuristics and will sometimes be wrong — but a skipped step must not turn up
 * in the re-plan's "already done" list, or the next page's plan is built on a
 * lie.
 */
export function skip(j: Journey): Journey {
  return { ...j, index: Math.min(j.index + 1, j.steps.length) };
}

/** Jump the highlight to a step the user picked in the panel. Records nothing. */
export function jumpTo(j: Journey, index: number): Journey {
  if (index < 0 || index >= j.steps.length) return j;
  return { ...j, index };
}

export function isFinished(j: Journey): boolean {
  return j.index >= j.steps.length;
}

/**
 * New page, same goal. The steps and the index are replaced wholesale — the old
 * page's refs resolve to nothing here — while `goal`, `done` and `panelOpen`
 * carry over. That carry-over *is* the feature.
 */
export function replan(j: Journey, steps: Step[], url: string, now: number): Journey {
  return { ...j, steps, index: 0, url, updatedAt: now };
}

function squash(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Has the user typed what the step suggested?
 *
 * "Contains", not "equals", and case-insensitive on squashed whitespace: the
 * user may type around the suggestion, and a site is free to reformat what it
 * is given (a phone field adding spaces, a search box trimming). Demanding
 * equality would leave the walkthrough stuck on a step the user had plainly
 * done.
 */
export function fillSatisfied(step: Step, value: string): boolean {
  const wanted = squash(step.fill);
  if (!wanted) return false;
  return squash(value).includes(wanted);
}

/**
 * Blank every ref the outline we sent did not actually contain.
 *
 * Same lesson as `pickSpotlightRef`: a model is free to cite `e404`, and
 * ringing or typing into whatever element happens to hold that id is worse
 * than doing nothing. The step survives with an empty ref, so the user still
 * reads what to do — they just do it themselves.
 */
export function resolvableSteps(steps: Step[], outline: OutlineEntry[]): Step[] {
  const known = new Set(outline.map((entry) => entry.ref));
  return steps.map((step) =>
    step.ref && !known.has(step.ref) ? { ...step, ref: '', fill: '' } : step,
  );
}

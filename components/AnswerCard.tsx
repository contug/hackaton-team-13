import type { Answer, Step } from '@/lib/openrouter';

export interface RefTarget {
  /** An outline ref id, e.g. "e7" — resolvable to a live element. */
  ref: string;
  /** The element's accessible name, from the snapshot outline. */
  label: string;
}

interface Props {
  question: string;
  answer: Answer;
  /**
   * The walkthrough's steps, already resolved against the snapshot outline by
   * `resolvableSteps`. Read from here rather than from `answer.steps` on
   * purpose: these are the ones whose refs are known to have existed, and their
   * indices are the ones `currentIndex` and `onPickStep` refer to.
   */
  steps: Step[];
  /** Which step the user is on, or `null` when nothing is being walked. */
  currentIndex: number | null;
  /** Jump the highlight to a step. The step list is the interactive surface. */
  onPickStep: (index: number) => void;
  /**
   * The answer's refs that resolved against the outline and are *not* already
   * a step's target — so the panel never says the same thing twice. Clicking
   * one spotlights it.
   */
  targets: RefTarget[];
  onPick: (ref: string) => void;
  /**
   * Set when the ring is on a ref the user picked from "On this page" rather
   * than on the current step. The two are mutually exclusive by construction in
   * `App.tsx`, so this block always describes exactly what is on the page.
   */
  pickedLabel?: string | undefined;
}

export default function AnswerCard({
  question,
  answer,
  steps,
  currentIndex,
  onPickStep,
  targets,
  onPick,
  pickedLabel,
}: Props) {
  const current = currentIndex !== null ? steps[currentIndex] : undefined;

  return (
    <div className="space-y-3">
      <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">{question}</p>

      <p className="text-sm leading-relaxed text-slate-900">{answer.answer}</p>

      {/*
        The announced copy. The on-page tooltip is decoration (`aria-hidden`),
        so this block is what a screen-reader or keyboard user gets, in reading
        order — which is why it names the step rather than the retired
        `target_reason`.
      */}
      {(answer.goal_reached || pickedLabel || (steps.length > 0 && currentIndex !== null)) && (
        <p role="status" className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">
          {answer.goal_reached ? (
            "That's everything — this looks done."
          ) : pickedLabel ? (
            <>
              Highlighted on the page: <span className="font-semibold">{pickedLabel}</span>
            </>
          ) : current ? (
            // The step's own text is the copy, and it names its own control —
            // which is why `target_reason` is gone rather than shown here too.
            <>
              Step {currentIndex! + 1} of {steps.length}: {current.text}
            </>
          ) : (
            'Every step on this page is done.'
          )}
        </p>
      )}

      {steps.length > 0 && (
        <ol className="space-y-1.5">
          {steps.map((step, i) => (
            // Index, not the step text: two steps on one page can legitimately
            // read the same ("Press Continue" twice), and a duplicate key makes
            // React drop one of them.
            <li key={`${i}-${step.ref}`}>
              <button
                type="button"
                onClick={() => onPickStep(i)}
                aria-current={i === currentIndex ? 'step' : undefined}
                className={`flex w-full gap-2 rounded px-1 py-0.5 text-left text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                  i === currentIndex
                    ? 'bg-sky-50 font-medium text-sky-900'
                    : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span
                  className={`flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                    currentIndex !== null && i < currentIndex
                      ? 'bg-slate-300 text-white'
                      : 'bg-slate-900 text-white'
                  }`}
                >
                  {i + 1}
                </span>
                <span>{step.text}</span>
              </button>
            </li>
          ))}
        </ol>
      )}

      {targets.length > 0 && (
        <div className="border-t border-slate-100 pt-2">
          <h3 className="mb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
            On this page
          </h3>
          <ul className="space-y-0.5">
            {targets.map((target) => (
              <li key={target.ref}>
                <button
                  type="button"
                  onClick={() => onPick(target.ref)}
                  className="w-full truncate rounded px-1 py-0.5 text-left text-xs text-sky-800 underline decoration-sky-200 underline-offset-2 transition-colors hover:bg-sky-50 hover:decoration-sky-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                >
                  {target.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

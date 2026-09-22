import type { Answer } from '@/lib/openrouter';

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
   * The answer's refs that resolved against the snapshot outline. Clicking one
   * spotlights it on the page — this is the read side of the `lib/refs` seam.
   */
  targets: RefTarget[];
  onPick: (ref: string) => void;
  /**
   * What is currently ringed on the page, if anything. The on-page tooltip is
   * decoration (`aria-hidden`); this block is the announced copy, so a
   * keyboard or screen-reader user gets the same information in reading order.
   */
  highlight?: { label: string; reason: string } | undefined;
}

export default function AnswerCard({ question, answer, targets, onPick, highlight }: Props) {
  return (
    <div className="space-y-3">
      <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">{question}</p>

      <p className="text-sm leading-relaxed text-slate-900">{answer.answer}</p>

      {highlight && (
        <p role="status" className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">
          Highlighted on the page: <span className="font-semibold">{highlight.label}</span>
          {highlight.reason && ` — ${highlight.reason}`}
        </p>
      )}

      {answer.steps.length > 0 && (
        <ol className="space-y-1.5">
          {answer.steps.map((step, i) => (
            <li key={step} className="flex gap-2 text-xs text-slate-700">
              <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-semibold text-white">
                {i + 1}
              </span>
              <span>{step}</span>
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

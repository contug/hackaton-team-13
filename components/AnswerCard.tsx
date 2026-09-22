import type { Answer } from '@/lib/openrouter';

interface Props {
  question: string;
  answer: Answer;
  /**
   * Human-readable names for `answer.refs`, resolved from the snapshot outline.
   * Rendered inertly today — acting on them is the next milestone.
   */
  refLabels: string[];
}

export default function AnswerCard({ question, answer, refLabels }: Props) {
  return (
    <div className="space-y-3">
      <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">{question}</p>

      <p className="text-sm leading-relaxed text-slate-900">{answer.answer}</p>

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

      {refLabels.length > 0 && (
        <div className="border-t border-slate-100 pt-2">
          <h3 className="mb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
            On this page
          </h3>
          <ul className="space-y-0.5">
            {refLabels.map((label) => (
              <li key={label} className="truncate text-xs text-slate-600">
                {label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

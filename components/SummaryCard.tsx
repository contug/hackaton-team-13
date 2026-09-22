import type { Summary } from '@/lib/openrouter';

export default function SummaryCard({ summary }: { summary: Summary }) {
  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed font-medium text-slate-900">{summary.tldr}</p>

      {summary.key_points.length > 0 && (
        <ul className="space-y-1">
          {summary.key_points.map((point) => (
            <li key={point} className="flex gap-2 text-xs text-slate-600">
              <span aria-hidden="true" className="mt-1.5 size-1 shrink-0 rounded-full bg-slate-400" />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      )}

      {summary.what_you_can_do_here.length > 0 && (
        <div className="rounded-lg bg-slate-50 p-3">
          <h3 className="mb-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
            What you can do here
          </h3>
          <ul className="space-y-1">
            {summary.what_you_can_do_here.map((action) => (
              <li key={action} className="text-xs text-slate-700">
                {action}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

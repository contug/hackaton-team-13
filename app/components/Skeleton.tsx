/**
 * Fixed height on purpose. A loading state that changes the panel's size makes
 * the whole thing feel unstable, which is the opposite of the goal.
 */
export default function Skeleton() {
  return (
    <div className="h-[132px] animate-pulse space-y-2.5" aria-hidden="true">
      <div className="h-3.5 w-full rounded bg-slate-200" />
      <div className="h-3.5 w-11/12 rounded bg-slate-200" />
      <div className="h-3 w-2/3 rounded bg-slate-100" />
      <div className="h-3 w-3/4 rounded bg-slate-100" />
      <div className="h-3 w-1/2 rounded bg-slate-100" />
    </div>
  );
}

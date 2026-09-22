import { useCallback, useEffect, useRef, useState } from 'react';
import AnswerCard, { type RefTarget } from '@/components/AnswerCard';
import ApiKeySetup from '@/components/ApiKeySetup';
import AskBox from '@/components/AskBox';
import Skeleton from '@/components/Skeleton';
import Spotlight, { type StepPosition } from '@/components/Spotlight';
import SuggestionChips from '@/components/SuggestionChips';
// Explicit, like every other component here. It used to ride on WXT's
// auto-imports, which only exist inside a WXT build.
import SummaryCard from '@/components/SummaryCard';
import { useStepWatcher } from '@/components/useStepWatcher';
import { useUrlWatcher } from '@/components/useUrlWatcher';
import { fillField } from '@/lib/autofill';
import {
  advance,
  currentStep,
  jumpTo,
  replan,
  resolvableSteps,
  skip,
  startJourney,
  type Journey,
} from '@/lib/journey';
import { sendToBackground, type SettingsView } from '@/lib/messaging';
import type { Answer, Step, Summary, Turn } from '@/lib/openrouter';
import { resolveRef } from '@/lib/refs';
import { buildSnapshot, type PageSnapshot } from '@/lib/snapshot';
import { DEFAULT_MODEL } from '@/lib/settings';
import { pickSpotlightRef } from '@/lib/spotlight';

/**
 * One result on screen at a time. A new result REPLACES the previous one —
 * there is no scrollback and there must not be one. That is the main structural
 * defense against cognitive overload; a message log would undo the whole point.
 */
type Result =
  | { kind: 'summary'; data: Summary }
  | { kind: 'answer'; question: string; data: Answer };

type View = 'loading' | 'setup' | 'assistant';

/**
 * A ref the user picked from "On this page", which is not a walkthrough step.
 * It takes precedence over the step-derived highlight while it is set, and one
 * of the two is always null — never both — so the panel's `role="status"` block
 * always describes exactly what is on the page.
 */
type Picked = { ref: string; label: string; text: string };

const PANEL_BASE =
  'fixed right-5 bottom-5 z-[2147483000] flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl transition-[width,max-height] duration-200 focus:outline-none';

/**
 * Both variants are written out in full: Tailwind scans source text, so a
 * composed `w-[${n}px]` would never be generated. The clamps on `large` are
 * load-bearing — the panel is anchored `bottom-5` and grows upward, so on a
 * short viewport an unguarded 720px would push the header, and with it these
 * very buttons, off the top of the screen.
 */
const PANEL_SIZE = {
  normal: 'w-[360px] max-h-[480px]',
  large: 'w-[540px] max-w-[calc(100vw_-_2.5rem)] max-h-[min(720px,calc(100vh_-_2.5rem))]',
} as const;

export default function App() {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [enlarged, setEnlarged] = useState(false);

  const [view, setView] = useState<View>('loading');
  const [settings, setSettings] = useState<SettingsView>({ hasApiKey: false, model: DEFAULT_MODEL });

  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // The transcript still lives here, in this tab's content script, and still
  // dies with the page. Only the journey is mirrored to the background.
  const [history, setHistory] = useState<Turn[]>([]);

  /**
   * The walkthrough. The on-page highlight is *derived* from this rather than
   * being its own slot: advancing a step is what re-points the spotlight, and
   * because `useSpotlightRect`'s effect keys on the target ref, the new target
   * scrolls itself into view for free.
   */
  const [journey, setJourney] = useState<Journey | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const snapshotRef = useRef<PageSnapshot | null>(null);

  // Read by callbacks that must not re-subscribe on every journey change.
  const journeyRef = useRef<Journey | null>(null);
  journeyRef.current = journey;

  /** True once the background has answered "is there a journey for this tab?". */
  const [restored, setRestored] = useState(false);
  const bootstrappedRef = useRef(false);

  const fabRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  /**
   * Every journey change is mirrored to the background immediately, because
   * there is no "about to navigate, save now" hook to lean on: `ctx.onInvalidated`
   * does not fire on navigation and there is no reliable async write during
   * `pagehide`. Saving on change means the step the user just clicked is
   * already stored by the time the page starts unloading.
   */
  const persist = useCallback((next: Journey | null) => {
    setJourney(next);
    // A journey change is always the authoritative highlight, so a stale pick
    // never survives one.
    setPicked(null);
    void sendToBackground(
      next ? { type: 'saveJourney', journey: next } : { type: 'clearJourney' },
    );
  }, []);

  const runSummary = useCallback(async () => {
    setBusy(true);
    setError(null);

    const snapshot = buildSnapshot();
    snapshotRef.current = snapshot;

    const res = await sendToBackground({ type: 'summarize', snapshot });
    setBusy(false);

    if (!res.ok) {
      setError(res.error);
      return;
    }
    setResult({ kind: 'summary', data: res.data });
  }, []);

  /**
   * Same goal, new page. This is the whole point of the feature: the user acted
   * on a step, the page navigated and destroyed everything, and what they see
   * next is the next rungs of the same ladder rather than a blank panel.
   */
  const replanFor = useCallback(
    async (j: Journey) => {
      setBusy(true);
      setError(null);

      const snapshot = buildSnapshot();
      snapshotRef.current = snapshot;

      const res = await sendToBackground({
        type: 'nextSteps',
        snapshot,
        goal: j.goal,
        done: j.done,
      });
      setBusy(false);

      if (!res.ok) {
        setError(res.error);
        return;
      }

      // The goal is the question: this card was never a reply to anything the
      // user typed on *this* page.
      setResult({ kind: 'answer', question: j.goal, data: res.data });

      if (res.data.goal_reached) {
        persist(null);
        return;
      }
      const steps = resolvableSteps(res.data.steps, snapshot.outline);
      persist(replan(j, steps, snapshot.meta.url, Date.now()));
    },
    [persist],
  );

  /**
   * Settings, then either the first summary or a re-plan of a restored journey.
   * Guarded by a ref rather than by `view`, because both triggers below can
   * land in the same tick.
   */
  const bootstrap = useCallback(
    async (pending: Journey | null) => {
      if (bootstrappedRef.current) return;
      bootstrappedRef.current = true;

      const res = await sendToBackground({ type: 'getSettings' });
      if (!res.ok) {
        setError(res.error);
        setView('setup');
        return;
      }
      setSettings(res.data);
      setView(res.data.hasApiKey ? 'assistant' : 'setup');
      if (!res.data.hasApiKey) return;

      if (pending) await replanFor(pending);
      else await runSummary();
    },
    [runSummary, replanFor],
  );

  /**
   * On mount, ask whether this tab was part-way through a walkthrough. This is
   * the only thing that runs before the user touches anything, and it is not
   * network — it is a local message that reads one session-storage key. No
   * OpenRouter traffic and no DOM walk happen unless it comes back with a
   * journey.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await sendToBackground({ type: 'getJourney' });
      if (cancelled) return;
      if (res.ok && res.data) {
        setJourney(res.data);
        // Restoring `panelOpen` is what makes a full page load invisible to the
        // user: the panel comes back exactly as they left it.
        if (res.data.panelOpen) setOpen(true);
      }
      setRestored(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Network and the DOM walk stay deferred until there is a reason: the user
   * opened the panel, or a journey survived a page load. A restored journey
   * bootstraps even with the panel collapsed, because the highlight outlives
   * the panel and it is the highlight the user went off to act on.
   */
  useEffect(() => {
    if (!restored || view !== 'loading') return;
    if (!open && journey === null) return;
    void bootstrap(journey);
  }, [restored, open, view, journey, bootstrap]);

  // Registered only while there is something to dismiss. Capture-phase
  // `stopPropagation` is invasive — the host page should keep its own Escape
  // when we have nothing on screen.
  useEffect(() => {
    if (!open && !journey && !picked) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      // Capture phase: many host pages swallow keydown before it bubbles. This
      // is the one deliberate exception to the read-only rule the step watcher
      // follows — Escape is a key host pages routinely eat.
      e.stopPropagation();
      persist(null);
      if (open) close();
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, journey, picked, persist]);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  /**
   * Keep the stored `panelOpen` honest, so the next page comes back the way the
   * user left this one. Converges in one pass: after the write the flags match
   * and the effect bails.
   */
  useEffect(() => {
    const j = journeyRef.current;
    if (!j || j.panelOpen === open) return;
    persist({ ...j, panelOpen: open });
  }, [open, journey, persist]);

  const step = currentStep(journey);

  // The user did the step we were pointing at. Advancing records it in `done`,
  // which is the only memory of the pages we have already left.
  useStepWatcher({
    step,
    onDone: useCallback(() => {
      const j = journeyRef.current;
      if (j) persist(advance(j));
    }, [persist]),
  });

  // An SPA route change is a new page as far as the plan is concerned. A full
  // page load is handled by the mount-time restore instead.
  useUrlWatcher(
    useCallback(
      (url: string) => {
        const j = journeyRef.current;
        if (!j || j.url === url) return;
        void replanFor({ ...j, url });
      },
      [replanFor],
    ),
  );

  function close() {
    setOpen(false);
    fabRef.current?.focus();
  }

  async function ask(question: string) {
    setBusy(true);
    setError(null);
    // A new question is a new goal, so the old walkthrough is gone. Cleared
    // before the request, not after it: a highlight that outlived its answer
    // would point at the last question's target while this one loads.
    persist(null);

    // Re-snapshot per question: SPAs mutate constantly, and a stale outline
    // would have us pointing at controls that are no longer there.
    const snapshot = buildSnapshot();
    snapshotRef.current = snapshot;

    const res = await sendToBackground({ type: 'ask', snapshot, question, history });
    setBusy(false);

    if (!res.ok) {
      setError(res.error);
      return;
    }

    setResult({ kind: 'answer', question, data: res.data });
    setHistory((prev) => [...prev, { question, answer: res.data.answer }].slice(-6));

    if (res.data.goal_reached) return;

    const steps = resolvableSteps(res.data.steps, snapshot.outline);
    if (steps.length > 0) {
      // The question IS the goal — `AskBox`'s framing asks for one.
      persist(startJourney(question, steps, snapshot.meta.url, Date.now()));
      return;
    }

    // No steps to walk, but the answer may still point at one control. Fall
    // back to the single highlight, which is all this used to do.
    const ref = pickSpotlightRef(res.data.refs, snapshot.outline);
    const entry = ref ? snapshot.outline.find((e) => e.ref === ref) : undefined;
    if (ref && entry) setPicked({ ref, label: entry.name, text: res.data.answer });
  }

  /**
   * The answer's refs that exist in the outline and are *not* already a step's
   * target, so the panel does not say the same thing twice.
   */
  function refTargets(answer: Answer): RefTarget[] {
    const outline = snapshotRef.current?.outline ?? [];
    const covered = new Set((journey?.steps ?? []).map((s) => s.ref).filter(Boolean));

    return answer.refs
      .filter((ref) => !covered.has(ref))
      .map((ref) => {
        const entry = outline.find((e) => e.ref === ref);
        return entry ? { ref, label: entry.name } : null;
      })
      .filter((target): target is RefTarget => target !== null);
  }

  function pickRef(ref: string, answer: Answer) {
    const entry = snapshotRef.current?.outline.find((e) => e.ref === ref);
    if (!entry) return;
    setPicked({ ref, label: entry.name, text: answer.answer });
  }

  /**
   * The confirmation gate for `lib/autofill.ts`, in one place: this is the only
   * caller, and it only runs from a press on the tooltip's button. The step is
   * then treated as done — the watcher's own `input` listener would also catch
   * our synthetic event, but relying on that would make the fill's effect
   * depend on a listener the user may have skipped past.
   */
  function fillCurrentStep() {
    const j = journeyRef.current;
    const target = currentStep(j);
    if (!j || !target) return;

    const outcome = fillField(resolveRef(target.ref), target.fill);
    if (outcome !== 'filled') {
      setNote("Couldn't type that in — you'll need to do it yourself.");
      return;
    }
    setNote(null);
    persist(advance(j));
  }

  if (dismissed) return null;

  const suggestions =
    result?.kind === 'summary'
      ? result.data.suggestions
      : result?.kind === 'answer'
        ? result.data.suggestions
        : [];

  /**
   * What is ringed, as one value. `picked` and the current step are mutually
   * exclusive by construction — a pick always clears with the journey and a
   * journey change always clears the pick — so this is never ambiguous.
   *
   * A pick carries `fill: ''` whatever the current step suggests: the ring is
   * not on that step's field, so offering to type into it would be a lie.
   */
  const highlight: { label: string; step: Step; position: StepPosition | null } | null =
    picked !== null
      ? { label: picked.label, step: { text: picked.text, ref: picked.ref, fill: '' }, position: null }
      : journey && step && step.ref
        ? {
            label: snapshotRef.current?.outline.find((e) => e.ref === step.ref)?.name ?? step.text,
            step,
            position: { index: journey.index, total: journey.steps.length },
          }
        : null;

  const fab = (
      <button
        ref={fabRef}
        type="button"
        aria-label="Open Page Guide"
        onClick={() => setOpen(true)}
        className="fixed right-5 bottom-5 z-[2147483000] flex size-12 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
      >
        <svg viewBox="0 0 24 24" fill="none" className="size-6" aria-hidden="true">
          <path
            d="M12 17.5v.01M12 14c0-2 2.5-2.2 2.5-4.5A2.5 2.5 0 0 0 12 7a2.5 2.5 0 0 0-2.5 2.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      </button>
  );

  const panel = (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-label="Page Guide"
      className={`${PANEL_BASE} ${PANEL_SIZE[enlarged ? 'large' : 'normal']}`}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-slate-100 px-4 py-3">
        <h2 className="flex-1 text-sm font-semibold text-slate-900">Page Guide</h2>

        {view === 'assistant' && (
          <button
            type="button"
            aria-label="Settings"
            onClick={() => {
              persist(null);
              setView('setup');
            }}
            className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          >
            <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden="true">
              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
              <path
                d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
                stroke="currentColor"
                strokeWidth="1.4"
              />
            </svg>
          </button>
        )}

        {/* Unconditional, unlike Settings: the extra room helps just as much on
            the setup form, and a control that comes and goes is a worse
            affordance than one that stays put. */}
        <button
          type="button"
          aria-label={enlarged ? 'Restore panel size' : 'Enlarge panel'}
          onClick={() => setEnlarged((v) => !v)}
          className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        >
          <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden="true">
            <path
              d={
                enlarged
                  ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5'
                  : 'M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5'
              }
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>

        <button
          type="button"
          aria-label="Close"
          onClick={close}
          className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        >
          <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {view === 'loading' && <Skeleton />}

        {view === 'setup' && (
          <ApiKeySetup
            currentModel={settings.model}
            isEditing={settings.hasApiKey}
            onSaved={(savedNote) => {
              setNote(savedNote ?? null);
              setView('loading');
              setResult(null);
              setHistory([]);
              persist(null);
              bootstrappedRef.current = false;
              void bootstrap(null);
            }}
            onCancel={settings.hasApiKey ? () => setView('assistant') : undefined}
          />
        )}

        {view === 'assistant' && (
          <>
            {busy && <Skeleton />}

            {!busy && error && (
              <div className="space-y-2">
                <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                  {error}
                </p>
                <button
                  type="button"
                  onClick={() => void runSummary()}
                  className="text-xs font-medium text-sky-700 underline underline-offset-2 hover:text-sky-900"
                >
                  Try again
                </button>
              </div>
            )}

            {!busy && !error && result?.kind === 'summary' && <SummaryCard summary={result.data} />}

            {!busy && !error && result?.kind === 'answer' && (
              <AnswerCard
                question={result.question}
                answer={result.data}
                steps={journey?.steps ?? []}
                currentIndex={journey && !picked ? journey.index : null}
                onPickStep={(index) => {
                  const j = journeyRef.current;
                  if (j) persist(jumpTo(j, index));
                }}
                targets={refTargets(result.data)}
                onPick={(ref) => pickRef(ref, (result as { data: Answer }).data)}
                pickedLabel={picked?.label}
              />
            )}
          </>
        )}
      </div>

      {view === 'assistant' && (
        <footer className="shrink-0 space-y-2 border-t border-slate-100 px-4 py-3">
          {note && <p className="text-[11px] text-amber-700">{note}</p>}
          <SuggestionChips suggestions={suggestions} disabled={busy} onPick={(s) => void ask(s)} />
          <AskBox disabled={busy} autoFocus onSubmit={(q) => void ask(q)} />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="text-[11px] text-slate-400 underline underline-offset-2 hover:text-slate-600"
            >
              Hide on this page
            </button>
            {journey && (
              <button
                type="button"
                onClick={() => persist(null)}
                className="text-[11px] text-slate-400 underline underline-offset-2 hover:text-slate-600"
              >
                Stop guiding me
              </button>
            )}
          </div>
        </footer>
      )}
    </div>
  );

  return (
    <>
      {/*
        Rendered inside this tree, never through a portal to `document.body`:
        "Hide on this page" unmounts everything here, and a portal would leave
        the overlay behind on the host page forever. It also has to sit outside
        the open/closed branch, because the highlight outlives the panel — the
        user closes the panel precisely to go and touch the thing.
      */}
      {highlight && (
        <Spotlight
          targetRef={highlight.step.ref}
          label={highlight.label}
          step={highlight.step}
          position={highlight.position}
          avoidRef={open ? panelRef : fabRef}
          onDismiss={() => {
            setPicked(null);
            if (journeyRef.current) persist(null);
          }}
          onNext={() => {
            const j = journeyRef.current;
            if (j) persist(advance(j));
          }}
          onSkip={() => {
            const j = journeyRef.current;
            if (j) persist(skip(j));
          }}
          onFill={fillCurrentStep}
          /**
           * The target is undrawable — gone, or too big to ring. Only a picked
           * ref is dropped; a step is left alone, because a step whose element
           * an SPA re-renders comes back on the next measure, and the panel's
           * step list is how the user moves on if it does not.
           */
          onLost={() => setPicked(null)}
        />
      )}
      {open ? panel : fab}
    </>
  );
}

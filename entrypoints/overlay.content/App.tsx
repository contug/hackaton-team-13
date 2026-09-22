import { useCallback, useEffect, useRef, useState } from 'react';
import AnswerCard from '@/components/AnswerCard';
import ApiKeySetup from '@/components/ApiKeySetup';
import AskBox from '@/components/AskBox';
import Skeleton from '@/components/Skeleton';
import SuggestionChips from '@/components/SuggestionChips';
import { sendToBackground, type SettingsView } from '@/lib/messaging';
import type { Answer, Summary, Turn } from '@/lib/openrouter';
import { buildSnapshot, type PageSnapshot } from '@/lib/snapshot';
import { DEFAULT_MODEL } from '@/lib/settings';

/**
 * One result on screen at a time. A new result REPLACES the previous one —
 * there is no scrollback and there must not be one. That is the main structural
 * defense against cognitive overload; a message log would undo the whole point.
 */
type Result =
  | { kind: 'summary'; data: Summary }
  | { kind: 'answer'; question: string; data: Answer };

type View = 'loading' | 'setup' | 'assistant';

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

  // Conversation state lives here, in this tab's content script, and dies with
  // the page. Nothing is shared with other tabs or kept in the background.
  const [history, setHistory] = useState<Turn[]>([]);
  const snapshotRef = useRef<PageSnapshot | null>(null);

  const fabRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

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

  const loadSettings = useCallback(async () => {
    const res = await sendToBackground({ type: 'getSettings' });
    if (!res.ok) {
      setError(res.error);
      setView('setup');
      return;
    }
    setSettings(res.data);
    setView(res.data.hasApiKey ? 'assistant' : 'setup');
    if (res.data.hasApiKey) void runSummary();
  }, [runSummary]);

  // Settings load and the first summary are deferred until the panel opens —
  // no network and no DOM walk for a user who never asks for help.
  useEffect(() => {
    if (!open || view !== 'loading') return;
    void loadSettings();
  }, [open, view, loadSettings]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    }
    // Capture phase: many host pages swallow keydown before it bubbles.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open]);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    fabRef.current?.focus();
  }

  async function ask(question: string) {
    setBusy(true);
    setError(null);

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
  }

  function refLabels(refs: string[]): string[] {
    const outline = snapshotRef.current?.outline ?? [];
    return refs
      .map((ref) => outline.find((entry) => entry.ref === ref)?.name)
      .filter((name): name is string => Boolean(name));
  }

  if (dismissed) return null;

  if (!open) {
    return (
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
  }

  const suggestions =
    result?.kind === 'summary'
      ? result.data.suggestions
      : result?.kind === 'answer'
        ? result.data.suggestions
        : [];

  return (
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
            onClick={() => setView('setup')}
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
              void loadSettings();
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
                refLabels={refLabels(result.data.refs)}
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
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="text-[11px] text-slate-400 underline underline-offset-2 hover:text-slate-600"
          >
            Hide on this page
          </button>
        </footer>
      )}
    </div>
  );
}

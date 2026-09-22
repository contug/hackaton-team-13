import { useEffect, useRef, useState } from 'react';

interface Props {
  disabled?: boolean;
  autoFocus?: boolean;
  onSubmit: (question: string) => void;
}

const MAX_ROWS = 3;

/**
 * Deliberately not a chat composer: it grows to three rows and stops, and it
 * submits on Enter. The framing question ("What are you trying to do here?")
 * asks for a goal, not a prompt.
 */
export default function AskBox({ disabled, autoFocus, onSubmit }: Props) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineHeight = 20;
    el.style.height = `${Math.min(el.scrollHeight, lineHeight * MAX_ROWS + 16)}px`;
  }, [value]);

  function submit() {
    const question = value.trim();
    if (!question || disabled) return;
    setValue('');
    onSubmit(question);
  }

  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        ref={ref}
        rows={1}
        value={value}
        disabled={disabled}
        placeholder="What are you trying to do here?"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        className="min-h-9 flex-1 resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-slate-50 disabled:text-slate-400"
      />
      <button
        type="submit"
        disabled={disabled || value.trim() === ''}
        className="h-9 shrink-0 rounded-lg bg-slate-900 px-3 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        Ask
      </button>
    </form>
  );
}

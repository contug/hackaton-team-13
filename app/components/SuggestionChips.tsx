interface Props {
  suggestions: string[];
  disabled?: boolean;
  onPick: (suggestion: string) => void;
}

/**
 * At most three, always phrased in the user's voice. These exist so the user
 * never has to compose a question from a blank page — the hardest moment when
 * you are already overloaded.
 */
export default function SuggestionChips({ suggestions, disabled, onPick }: Props) {
  if (suggestions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {suggestions.slice(0, 3).map((suggestion) => (
        <button
          key={suggestion}
          type="button"
          disabled={disabled}
          onClick={() => onPick(suggestion)}
          className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-left text-xs font-medium text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {suggestion}
        </button>
      ))}
    </div>
  );
}

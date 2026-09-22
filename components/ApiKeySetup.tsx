import { useEffect, useId, useState } from 'react';
import { sendToBackground } from '@/lib/messaging';
import type { ModelOption } from '@/lib/openrouter';

interface Props {
  currentModel: string;
  /** True when a key already exists — i.e. reached via the settings gear. */
  isEditing: boolean;
  onSaved: (note?: string) => void;
  onCancel?: () => void;
}

export default function ApiKeySetup({ currentModel, isEditing, onSaved, onCancel }: Props) {
  const keyId = useId();
  const modelId = useId();
  const listId = useId();

  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(currentModel);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only possible once a key is stored; on first run the datalist stays empty
  // and the field is plain free text, which is fine.
  useEffect(() => {
    if (!isEditing) return;
    let cancelled = false;
    void sendToBackground({ type: 'listModels' }).then((res) => {
      if (!cancelled && res.ok) setModels(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [isEditing]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const res = await sendToBackground({ type: 'saveSettings', apiKey, model });
    setSaving(false);

    if (!res.ok) {
      setError(res.error);
      return;
    }
    onSaved(res.data.note);
  }

  return (
    <form className="space-y-3" onSubmit={save}>
      <p className="text-xs leading-relaxed text-slate-600">
        {isEditing
          ? 'Update your OpenRouter key or switch models.'
          : 'Paste an OpenRouter API key to get started. It is stored in this browser only and is never sent anywhere except OpenRouter.'}
      </p>

      <div className="space-y-1">
        <label htmlFor={keyId} className="block text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
          OpenRouter API key
        </label>
        <input
          id={keyId}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-or-v1-..."
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor={modelId} className="block text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
          Model
        </label>
        <input
          id={modelId}
          list={listId}
          value={model}
          spellCheck={false}
          onChange={(e) => setModel(e.target.value)}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
        />
        <datalist id={listId}>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </datalist>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving || apiKey.trim() === ''}
          className="flex-1 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {saving ? 'Checking…' : 'Save'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

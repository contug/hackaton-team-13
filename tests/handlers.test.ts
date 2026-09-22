import { describe, expect, it } from 'vitest';
import { handle } from '@/lib/handlers';
import { DEFAULT_MODEL, apiKeyItem, modelItem } from '@/lib/settings';
import { completion, jsonResponse, mockFetch } from './helpers';
import { snapshotFixture } from './fixtures';

const KEY = 'sk-or-v1-supersecret-key-value';

const SUMMARY_JSON = JSON.stringify({
  tldr: 'A pricing page.',
  key_points: ['Three plans'],
  what_you_can_do_here: ['Upgrade'],
  suggestions: ['How do I upgrade?'],
});

describe('getSettings', () => {
  it('reports no key on a fresh install, with the default model', async () => {
    const res = await handle({ type: 'getSettings' });

    expect(res).toEqual({ ok: true, data: { hasApiKey: false, model: DEFAULT_MODEL } });
  });

  it('never leaks the key — not the whole thing and not a fragment of it', async () => {
    await apiKeyItem.setValue(KEY);

    const res = await handle({ type: 'getSettings' });
    expect(res).toEqual({ ok: true, data: { hasApiKey: true, model: DEFAULT_MODEL } });

    // The content script must be able to render settings without ever holding
    // the key. This is the containment rule, asserted on the wire format.
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain(KEY);
    for (const fragment of ['supersecret', 'sk-or-v1', 'key-value']) {
      expect(serialized).not.toContain(fragment);
    }
  });
});

describe('saveSettings', () => {
  it('rejects an empty key without calling OpenRouter', async () => {
    const fetchStub = mockFetch();

    const res = await handle({ type: 'saveSettings', apiKey: '   ', model: 'a/b' });

    expect(res).toEqual({ ok: false, error: 'Enter an API key.' });
    expect(fetchStub.calls).toHaveLength(0);
  });

  it('leaves storage untouched when OpenRouter rejects the key', async () => {
    const fetchStub = mockFetch();
    fetchStub.queue.push(() => jsonResponse({ error: 'invalid key' }, 401));

    const res = await handle({ type: 'saveSettings', apiKey: 'bad-key', model: 'a/b' });

    expect(res).toEqual({ ok: false, error: 'That API key was rejected by OpenRouter.' });
    await expect(apiKeyItem.getValue()).resolves.toBeNull();
    await expect(modelItem.getValue()).resolves.toBe(DEFAULT_MODEL);
  });

  it('persists the key and the model once the key checks out', async () => {
    const fetchStub = mockFetch();
    fetchStub.queue.push(() => jsonResponse({ data: { label: 'ok' } }));

    const res = await handle({ type: 'saveSettings', apiKey: `  ${KEY}  `, model: 'vendor/model' });

    expect(res).toEqual({ ok: true, data: { saved: true, note: undefined } });
    await expect(apiKeyItem.getValue()).resolves.toBe(KEY);
    await expect(modelItem.getValue()).resolves.toBe('vendor/model');
  });

  it('keeps the current model when the model field is left blank', async () => {
    await modelItem.setValue('kept/model');
    const fetchStub = mockFetch();
    fetchStub.queue.push(() => jsonResponse({}));

    await handle({ type: 'saveSettings', apiKey: KEY, model: '  ' });

    await expect(modelItem.getValue()).resolves.toBe('kept/model');
  });

  it('saves with a note when the key could not be verified', async () => {
    const fetchStub = mockFetch();
    fetchStub.queue.push(() => jsonResponse({}, 500));

    const res = await handle({ type: 'saveSettings', apiKey: KEY, model: 'a/b' });

    expect(res.ok).toBe(true);
    expect((res as { data: { note?: string } }).data.note).toMatch(/verify/i);
    await expect(apiKeyItem.getValue()).resolves.toBe(KEY);
  });
});

describe('with no key stored', () => {
  it('answers summarize with a friendly error instead of throwing', async () => {
    const fetchStub = mockFetch();

    await expect(handle({ type: 'summarize', snapshot: snapshotFixture() })).resolves.toEqual({
      ok: false,
      error: 'No API key set yet.',
    });
    expect(fetchStub.calls).toHaveLength(0);
  });

  it('answers ask with a friendly error instead of throwing', async () => {
    await expect(
      handle({ type: 'ask', snapshot: snapshotFixture(), question: 'help', history: [] }),
    ).resolves.toEqual({ ok: false, error: 'No API key set yet.' });
  });

  it('answers listModels with a friendly error instead of throwing', async () => {
    await expect(handle({ type: 'listModels' })).resolves.toEqual({
      ok: false,
      error: 'No API key set yet.',
    });
  });
});

describe('with a key stored', () => {
  it('summarizes using the stored key and model', async () => {
    await apiKeyItem.setValue(KEY);
    await modelItem.setValue('vendor/chosen');
    const fetchStub = mockFetch();
    fetchStub.queue.push(() => completion(SUMMARY_JSON));

    const res = await handle({ type: 'summarize', snapshot: snapshotFixture() });

    expect(res).toMatchObject({ ok: true, data: { tldr: 'A pricing page.' } });
    const call = fetchStub.calls[0]!;
    expect((call.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(call.body.model).toBe('vendor/chosen');
  });

  it('forwards the question and the history it was handed', async () => {
    await apiKeyItem.setValue(KEY);
    const fetchStub = mockFetch();
    fetchStub.queue.push(() =>
      completion(JSON.stringify({ answer: 'Click Upgrade.', steps: [], refs: [], suggestions: [] })),
    );

    const res = await handle({
      type: 'ask',
      snapshot: snapshotFixture(),
      question: 'how do I upgrade?',
      history: [{ question: 'what is this?', answer: 'A pricing page.' }],
    });

    expect(res).toMatchObject({ ok: true, data: { answer: 'Click Upgrade.' } });
    const messages = fetchStub.calls[0]!.body.messages as Array<{ content: string }>;
    expect(messages[1]!.content).toBe('what is this?');
    expect(messages.at(-1)!.content).toContain('how do I upgrade?');
  });

  it('maps an OpenRouter failure to the friendly message', async () => {
    await apiKeyItem.setValue(KEY);
    const fetchStub = mockFetch();
    fetchStub.queue.push(() => jsonResponse({ error: { message: 'no credits' } }, 402));

    await expect(handle({ type: 'summarize', snapshot: snapshotFixture() })).resolves.toEqual({
      ok: false,
      error: 'Your OpenRouter account is out of credits.',
    });
  });

  it('lists models', async () => {
    await apiKeyItem.setValue(KEY);
    const fetchStub = mockFetch();
    fetchStub.queue.push(() => jsonResponse({ data: [{ id: 'a/b', name: 'A B' }] }));

    await expect(handle({ type: 'listModels' })).resolves.toEqual({
      ok: true,
      data: [{ id: 'a/b', name: 'A B' }],
    });
  });
});

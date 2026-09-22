import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { handle } from '@/lib/handlers';
import background from '@/entrypoints/background';
import { DEFAULT_MODEL, apiKeyItem, modelItem, readJourney } from '@/lib/settings';
import { startJourney, type Journey } from '@/lib/journey';
import type { BgRequest, BgResponse } from '@/lib/messaging';
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

  it('answers nextSteps with a friendly error instead of throwing', async () => {
    await expect(
      handle({ type: 'nextSteps', snapshot: snapshotFixture(), goal: 'g', done: [] }),
    ).resolves.toEqual({ ok: false, error: 'No API key set yet.' });
  });
});

/**
 * The journey is the one piece of state the background is allowed to keep, so
 * these are the tests that replace the "no background-side conversation map"
 * doc rule that used to sit in `lib/messaging.ts`.
 */
describe('the per-tab journey', () => {
  const TAB = { tab: { id: 7 } };

  function journeyFor(goal: string): Journey {
    return startJourney(goal, [{ text: 'Press Search', ref: 'e2', fill: '' }], 'https://a/', 1000);
  }

  it('round-trips a journey for the sender\'s tab', async () => {
    const journey = journeyFor('buy wool socks');

    await expect(handle({ type: 'saveJourney', journey }, TAB)).resolves.toEqual({
      ok: true,
      data: { saved: true },
    });
    await expect(handle({ type: 'getJourney' }, TAB)).resolves.toEqual({
      ok: true,
      data: journey,
    });
  });

  it('reports no journey for a tab that has none', async () => {
    await expect(handle({ type: 'getJourney' }, { tab: { id: 99 } })).resolves.toEqual({
      ok: true,
      data: null,
    });
  });

  it('keeps two tabs completely independent', async () => {
    const one = { tab: { id: 1 } };
    const two = { tab: { id: 2 } };

    await handle({ type: 'saveJourney', journey: journeyFor('buy socks') }, one);
    await handle({ type: 'saveJourney', journey: journeyFor('cancel my plan') }, two);

    // The invariant, executable at last. One key per tab rather than a shared
    // record is also why neither save could clobber the other across an await.
    const first = await handle({ type: 'getJourney' }, one);
    const second = await handle({ type: 'getJourney' }, two);
    expect((first as { data: Journey }).data.goal).toBe('buy socks');
    expect((second as { data: Journey }).data.goal).toBe('cancel my plan');

    await handle({ type: 'clearJourney' }, one);

    await expect(handle({ type: 'getJourney' }, one)).resolves.toEqual({ ok: true, data: null });
    expect(((await handle({ type: 'getJourney' }, two)) as { data: Journey }).data.goal).toBe(
      'cancel my plan',
    );
  });

  it('clears a journey without complaining when there was none', async () => {
    await expect(handle({ type: 'clearJourney' }, TAB)).resolves.toEqual({
      ok: true,
      data: { cleared: true },
    });
  });

  it('stores it in session storage, which dies with the browser', async () => {
    await handle({ type: 'saveJourney', journey: journeyFor('g') }, TAB);

    // `local:` would leave a stale plan on disk for a task abandoned weeks ago.
    await expect(fakeBrowser.storage.session.get('journey:7')).resolves.toEqual({
      'journey:7': expect.objectContaining({ goal: 'g' }),
    });
    await expect(fakeBrowser.storage.local.get('journey:7')).resolves.toEqual({});
  });

  for (const type of ['saveJourney', 'getJourney', 'clearJourney'] as const) {
    it(`answers ${type} with a friendly error when there is no tab`, async () => {
      const request = (
        type === 'saveJourney' ? { type, journey: journeyFor('g') } : { type }
      ) as BgRequest;

      // There is no such thing as a tab-less journey. A friendly error, not a
      // throw — and notably this is also what `runtime.sendMessage` from an
      // extension page (options, popup) would get.
      await expect(handle(request)).resolves.toEqual({
        ok: false,
        error: 'This page has no tab, so it cannot be guided.',
      });
    });
  }
});

/**
 * Everything above calls `handle` directly. This drives the **real** listener in
 * `entrypoints/background.ts`, which is the only way to exercise the sender
 * plumbing — `fakeBrowser.runtime.sendMessage` hands listeners an *empty*
 * sender, so it cannot.
 */
describe('the background listener', () => {
  /** `main` takes a `ContentScriptContext` the background entry never reads. */
  function startBackground(): void {
    (background.main as () => void)();
  }

  async function trigger(message: BgRequest, tabId: number): Promise<BgResponse<unknown>> {
    startBackground();

    return new Promise((resolve) => {
      fakeBrowser.runtime.onMessage.trigger(
        message,
        // Only `tab.id` is read; a full `Tab` would be eleven fields of noise.
        { tab: { id: tabId } } as Parameters<typeof fakeBrowser.runtime.onMessage.trigger>[1],
        resolve as (response: unknown) => void,
      );
    });
  }

  it('takes the tab id from the sender the browser attached', async () => {
    const journey = startJourney('buy socks', [], 'https://a/', 1000);

    await expect(trigger({ type: 'saveJourney', journey }, 42)).resolves.toEqual({
      ok: true,
      data: { saved: true },
    });

    // Saved under 42 because that is what the browser said, not because the
    // message claimed it — the message carries no tab id at all.
    await expect(readJourney(42)).resolves.toEqual(journey);
    await expect(readJourney(43)).resolves.toBeNull();
  });

  it('evicts a journey when its tab closes', async () => {
    startBackground();
    await handle({ type: 'saveJourney', journey: startJourney('g', [], 'u', 1) }, { tab: { id: 5 } });
    // Guard against the eviction assertion passing because nothing was stored.
    await expect(readJourney(5)).resolves.not.toBeNull();

    fakeBrowser.tabs.onRemoved.trigger(5, { windowId: 1, isWindowClosing: false });
    await vi.waitFor(async () => {
      await expect(readJourney(5)).resolves.toBeNull();
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

  it('re-plans from the goal and the done list on nextSteps', async () => {
    await apiKeyItem.setValue(KEY);
    const fetchStub = mockFetch();
    fetchStub.queue.push(() =>
      completion(
        JSON.stringify({
          answer: 'Nearly there.',
          steps: [{ text: 'Press Add to cart', ref: 'e2', fill: '' }],
          refs: ['e2'],
          suggestions: [],
          goal_reached: false,
        }),
      ),
    );

    const res = await handle({
      type: 'nextSteps',
      snapshot: snapshotFixture(),
      goal: 'buy wool socks',
      done: ['Press Search'],
    });

    expect(res).toMatchObject({
      ok: true,
      data: { steps: [{ text: 'Press Add to cart', ref: 'e2', fill: '' }] },
    });
    const messages = fetchStub.calls[0]!.body.messages as Array<{ content: string }>;
    expect(messages).toHaveLength(2);
    expect(messages[1]!.content).toContain("The user's goal: buy wool socks");
    expect(messages[1]!.content).toContain('1. Press Search');
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

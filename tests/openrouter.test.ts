import { describe, expect, it } from 'vitest';
import {
  OpenRouterError,
  askAboutPage,
  friendlyError,
  listModels,
  nextSteps,
  stepArray,
  summarizePage,
  validateKey,
} from '@/lib/openrouter';
import { completion, jsonResponse, mockFetch } from './helpers';
import { snapshotFixture } from './fixtures';

const CHAT = 'https://openrouter.ai/api/v1/chat/completions';

const GOOD_SUMMARY = {
  tldr: 'This page lists the plans you can buy.',
  key_points: ['Three plans', 'Monthly or yearly'],
  what_you_can_do_here: ['Upgrade your plan'],
  suggestions: ['How do I upgrade?'],
};

const GOOD_ANSWER = {
  answer: 'Click Upgrade.',
  steps: [{ text: 'Press Upgrade', ref: 'e2', fill: '' }],
  refs: ['e2'],
  suggestions: ['What does it cost?'],
  goal_reached: false,
};

/** A 400 whose message names `response_format` — the schema-unsupported signal. */
function schemaRejection(): Response {
  return jsonResponse(
    { error: { message: 'Provider does not support response_format=json_schema' } },
    400,
  );
}

describe('summarizePage — happy path', () => {
  it('posts to the chat endpoint with the bearer key and a strict schema', async () => {
    const fetchStub = mockFetch();
    fetchStub.queue.push(() => completion(JSON.stringify(GOOD_SUMMARY)));

    const summary = await summarizePage('sk-or-test', 'some/model', snapshotFixture());

    expect(summary.tldr).toBe(GOOD_SUMMARY.tldr);
    expect(fetchStub.calls).toHaveLength(1);

    const call = fetchStub.calls[0]!;
    expect(call.url).toBe(CHAT);
    expect((call.init.headers as Record<string, string>).Authorization).toBe('Bearer sk-or-test');
    expect(call.body.model).toBe('some/model');
    expect(call.body.response_format.type).toBe('json_schema');
    expect(call.body.response_format.json_schema.strict).toBe(true);
    expect(call.body.response_format.json_schema.name).toBe('page_summary');
    // The system prompt leads; the snapshot rides on a user message.
    expect(call.body.messages[0].role).toBe('system');
    expect(call.body.messages[1].content).toContain('https://example.com/pricing');
  });
});

describe('summarizePage — step 2: schema unsupported', () => {
  it('retries exactly once without response_format, with the schema inlined in the prompt', async () => {
    const fetchStub = mockFetch();
    fetchStub.queue.push(() => schemaRejection());
    fetchStub.queue.push(() => completion(JSON.stringify(GOOD_SUMMARY)));

    const summary = await summarizePage('k', 'm', snapshotFixture());

    expect(summary.tldr).toBe(GOOD_SUMMARY.tldr);
    expect(fetchStub.calls).toHaveLength(2);

    const retry = fetchStub.calls[1]!;
    expect(retry.body.response_format).toBeUndefined();
    expect(retry.body.messages[0].content).toContain('single JSON object');
    expect(retry.body.messages[0].content).toContain('"tldr"');
  });

  it('does not retry when the failure is unrelated to the schema', async () => {
    const fetchStub = mockFetch();
    fetchStub.queue.push(() => jsonResponse({ error: { message: 'Rate limited.' } }, 429));

    await expect(summarizePage('k', 'm', snapshotFixture())).rejects.toBeInstanceOf(OpenRouterError);
    expect(fetchStub.calls).toHaveLength(1);
  });
});

describe('summarizePage — step 3: unparseable content', () => {
  it('retries once, then hands back the raw text instead of throwing', async () => {
    const fetchStub = mockFetch();
    fetchStub.queue.push(() => completion('I cannot do that.'));
    fetchStub.queue.push(() => completion('Still just prose, sorry.'));

    const summary = await summarizePage('k', 'm', snapshotFixture());

    expect(fetchStub.calls).toHaveLength(2);
    expect(summary).toEqual({
      tldr: 'Still just prose, sorry.',
      key_points: [],
      what_you_can_do_here: [],
      suggestions: [],
    });
  });
});

/**
 * `extractJson` is module-private, so it is exercised through `summarizePage`:
 * a single fetch call means the first response parsed, two means it did not.
 */
describe('JSON extraction from model output', () => {
  const shapes: Array<[string, string, number]> = [
    ['bare JSON', JSON.stringify(GOOD_SUMMARY), 1],
    ['```json fenced', `\`\`\`json\n${JSON.stringify(GOOD_SUMMARY)}\n\`\`\``, 1],
    ['bare fenced', `\`\`\`\n${JSON.stringify(GOOD_SUMMARY)}\n\`\`\``, 1],
    [
      'prose-wrapped',
      `Sure! Here you go:\n${JSON.stringify(GOOD_SUMMARY)}\nHope that helps.`,
      1,
    ],
  ];

  for (const [label, content, expectedCalls] of shapes) {
    it(`parses ${label}`, async () => {
      const fetchStub = mockFetch();
      fetchStub.queue.push(() => completion(content));

      const summary = await summarizePage('k', 'm', snapshotFixture());

      expect(fetchStub.calls).toHaveLength(expectedCalls);
      expect(summary.tldr).toBe(GOOD_SUMMARY.tldr);
    });
  }

  it('gives up on pure garbage and falls through to the raw-text path', async () => {
    const fetchStub = mockFetch();
    fetchStub.queue.push(() => completion('%%% not json at all %%%'));
    fetchStub.queue.push(() => completion('{ still not: valid json'));

    const summary = await summarizePage('k', 'm', snapshotFixture());

    expect(summary.tldr).toBe('{ still not: valid json');
    expect(summary.key_points).toEqual([]);
  });
});

describe('error reporting', () => {
  it('throws OpenRouterError for an error field inside a 200 response', async () => {
    const fetchStub = mockFetch();
    fetchStub.queue.push(() =>
      jsonResponse({ error: { message: 'The upstream provider is down.' } }),
    );

    await expect(summarizePage('k', 'm', snapshotFixture())).rejects.toThrow(
      'The upstream provider is down.',
    );
    expect(fetchStub.calls).toHaveLength(1);
  });

  it('throws when the model returns empty content', async () => {
    const fetchStub = mockFetch();
    fetchStub.queue.push(() => completion('   '));

    await expect(summarizePage('k', 'm', snapshotFixture())).rejects.toThrow(
      'The model returned an empty response.',
    );
  });
});

describe('clamping', () => {
  it('cuts the lists to their documented limits, drops non-strings and trims', async () => {
    const fetchStub = mockFetch();
    fetchStub.queue.push(() =>
      completion(
        JSON.stringify({
          tldr: '  Padded tldr.  ',
          key_points: ['a', 'b', 'c', 'd', 'e', 'f'],
          what_you_can_do_here: ['  one  ', 2, null, 'two', 'three', 'four'],
          suggestions: ['s1', 's2', 's3', 's4', 's5', 's6', 's7'],
        }),
      ),
    );

    const summary = await summarizePage('k', 'm', snapshotFixture());

    expect(summary.tldr).toBe('Padded tldr.');
    expect(summary.key_points).toHaveLength(4);
    expect(summary.what_you_can_do_here).toEqual(['one', 'two', 'three']);
    expect(summary.suggestions).toEqual(['s1', 's2', 's3']);
  });

  it('clamps the answer shape too, and survives a missing field', async () => {
    const fetchStub = mockFetch();
    fetchStub.queue.push(() =>
      completion(
        JSON.stringify({
          answer: ' Do this. ',
          steps: [1, 2, 3, 4, 5, 6].map((n) => ({ text: `step ${n}`, ref: '', fill: '' })),
          refs: ['e1', 'e2', 'e3', 'e4'],
        }),
      ),
    );

    const answer = await askAboutPage('k', 'm', snapshotFixture(), 'how?', []);

    expect(answer.answer).toBe('Do this.');
    // Five, not three: a walkthrough needs more rungs than a one-shot answer.
    expect(answer.steps).toHaveLength(5);
    expect(answer.refs).toEqual(['e1', 'e2', 'e3']);
    expect(answer.suggestions).toEqual([]);
    expect(answer.goal_reached).toBe(false);
  });
});

describe('friendlyError', () => {
  const cases: Array<[number, string]> = [
    [401, 'That API key was rejected. Check it in settings.'],
    [403, 'That API key was rejected. Check it in settings.'],
    [402, 'Your OpenRouter account is out of credits.'],
    [404, 'That model was not found. Pick another one in settings.'],
    [429, 'Rate limited. Wait a moment and try again.'],
    [500, 'OpenRouter had a problem. Try again in a moment.'],
    [503, 'OpenRouter had a problem. Try again in a moment.'],
  ];

  for (const [status, expected] of cases) {
    it(`maps ${status}`, () => {
      expect(friendlyError(new OpenRouterError('raw message', status))).toBe(expected);
    });
  }

  it('passes an unmapped status through as the raw message', () => {
    expect(friendlyError(new OpenRouterError('Weird thing.', 418))).toBe('Weird thing.');
  });

  it('reads a TypeError as being offline', () => {
    expect(friendlyError(new TypeError('Failed to fetch'))).toBe(
      "Couldn't reach OpenRouter. Check your connection.",
    );
  });

  it('falls back for a non-Error throw', () => {
    expect(friendlyError('nope')).toBe('Something went wrong.');
  });
});

describe('validateKey', () => {
  it('rejects a key on 401', async () => {
    const fetchStub = mockFetch();
    fetchStub.queue.push(() => jsonResponse({ error: 'no' }, 401));

    await expect(validateKey('bad')).resolves.toEqual({ valid: false });
    expect(fetchStub.calls[0]!.url).toBe('https://openrouter.ai/api/v1/key');
  });

  it('accepts the key with a note when the check itself failed (500)', async () => {
    const fetchStub = mockFetch();
    fetchStub.queue.push(() => jsonResponse({}, 500));

    const result = await validateKey('unknown');
    expect(result.valid).toBe(true);
    expect(result.note).toMatch(/verify/i);
  });

  it('accepts the key with a note when the network throws', async () => {
    const fetchStub = mockFetch();
    fetchStub.queue.push(() => {
      throw new TypeError('Failed to fetch');
    });

    const result = await validateKey('unknown');
    expect(result.valid).toBe(true);
    expect(result.note).toMatch(/verify/i);
  });

  it('accepts a key the endpoint confirms, with no note', async () => {
    const fetchStub = mockFetch();
    fetchStub.queue.push(() => jsonResponse({ data: { label: 'test' } }));

    await expect(validateKey('good')).resolves.toEqual({ valid: true });
  });
});

describe('askAboutPage history', () => {
  it('replays prior turns as alternating messages and sends the snapshot only on the last one', async () => {
    const fetchStub = mockFetch();
    fetchStub.queue.push(() => completion(JSON.stringify(GOOD_ANSWER)));

    await askAboutPage('k', 'm', snapshotFixture(), 'and now?', [
      { question: 'what is this?', answer: 'A pricing page.' },
      { question: 'is it monthly?', answer: 'Yes.' },
    ]);

    const messages = fetchStub.calls[0]!.body.messages as Array<{ role: string; content: string }>;
    expect(messages.map((m) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
    ]);
    expect(messages[1]!.content).toBe('what is this?');
    expect(messages[2]!.content).toBe('A pricing page.');

    // The snapshot is expensive; it must ride on the final user message only.
    for (const message of messages.slice(1, 5)) {
      expect(message.content).not.toContain('https://example.com/pricing');
    }
    const last = messages.at(-1)!;
    expect(last.content).toContain('https://example.com/pricing');
    expect(last.content).toContain('and now?');
  });
});

describe('listModels', () => {
  it('maps the model list and falls back to the id when a name is missing', async () => {
    const fetchStub = mockFetch();
    fetchStub.queue.push(() =>
      jsonResponse({ data: [{ id: 'a/b', name: 'A B' }, { id: 'c/d' }, { nope: true }] }),
    );

    await expect(listModels('k')).resolves.toEqual([
      { id: 'a/b', name: 'A B' },
      { id: 'c/d', name: 'c/d' },
    ]);
    expect(fetchStub.calls[0]!.url).toBe('https://openrouter.ai/api/v1/models');
  });

  it('throws an OpenRouterError carrying the status', async () => {
    const fetchStub = mockFetch();
    fetchStub.queue.push(() => jsonResponse({}, 401));

    await expect(listModels('k')).rejects.toMatchObject({ name: 'OpenRouterError', status: 401 });
  });
});

describe('steps — the walkthrough contract', () => {
  it('asks for step objects in the schema, with all three keys required', async () => {
    const fetchStub = mockFetch();
    fetchStub.queue.push(() => completion(JSON.stringify(GOOD_ANSWER)));

    await askAboutPage('k', 'm', snapshotFixture(), 'how?', []);

    const schema = fetchStub.calls[0]!.body.response_format.json_schema.schema;
    const step = schema.properties.steps.items;

    expect(step.type).toBe('object');
    expect(step.additionalProperties).toBe(false);
    // Strict mode rejects a property that is not also in `required`, which is
    // why "no ref" and "no fill" are empty strings and not missing keys.
    expect(step.required).toEqual(['text', 'ref', 'fill']);
    expect(Object.keys(step.properties).sort()).toEqual(['fill', 'ref', 'text']);
    expect(schema.required).toContain('goal_reached');
    expect(schema.properties.goal_reached.type).toBe('boolean');
    expect(schema.properties.target_reason).toBeUndefined();
  });

  it('carries text, ref and fill through, squashed and trimmed', async () => {
    const fetchStub = mockFetch();
    fetchStub.queue.push(() =>
      completion(
        JSON.stringify({
          ...GOOD_ANSWER,
          steps: [
            { text: '  Type   the\n product name  ', ref: 'e8', fill: '  wool   socks ' },
            { text: 'Press Search', ref: 'e9', fill: '' },
          ],
        }),
      ),
    );

    const answer = await askAboutPage('k', 'm', snapshotFixture(), 'how?', []);

    expect(answer.steps).toEqual([
      { text: 'Type the product name', ref: 'e8', fill: 'wool socks' },
      { text: 'Press Search', ref: 'e9', fill: '' },
    ]);
  });

  it('reports goal_reached when the model says the goal is already met', async () => {
    const fetchStub = mockFetch();
    fetchStub.queue.push(() =>
      completion(JSON.stringify({ ...GOOD_ANSWER, steps: [], goal_reached: true })),
    );

    const answer = await askAboutPage('k', 'm', snapshotFixture(), 'am I done?', []);

    expect(answer.goal_reached).toBe(true);
  });

  it('treats a non-boolean goal_reached as false rather than truthy', async () => {
    const fetchStub = mockFetch();
    fetchStub.queue.push(() =>
      completion(JSON.stringify({ ...GOOD_ANSWER, goal_reached: 'yes' })),
    );

    const answer = await askAboutPage('k', 'm', snapshotFixture(), 'how?', []);

    // A truthy string would silently end a walkthrough that had barely started.
    expect(answer.goal_reached).toBe(false);
  });

  it('is empty on the raw-text fallback, so the chain gains no new branch', async () => {
    const fetchStub = mockFetch();
    fetchStub.queue.push(() => completion('I cannot produce JSON today.'));
    fetchStub.queue.push(() => completion('Still no JSON.'));

    const answer = await askAboutPage('k', 'm', snapshotFixture(), 'how?', []);

    expect(answer.answer).toBe('Still no JSON.');
    expect(answer.steps).toEqual([]);
    expect(answer.goal_reached).toBe(false);
  });
});

/**
 * `stepArray` is exported rather than exercised only through `askAboutPage`
 * because it is the one guard between a model's imagination and the element the
 * extension is about to ring or type into.
 */
describe('stepArray', () => {
  it('returns [] for anything that is not an array', () => {
    for (const value of [undefined, null, 'steps', 42, { text: 'a' }]) {
      expect(stepArray(value, 5)).toEqual([]);
    }
  });

  it('drops entries that are not plain objects', () => {
    const steps = stepArray(
      ['Press Search', null, 42, ['nested'], { text: 'Press Search', ref: 'e1', fill: '' }],
      5,
    );

    // The old `strArray` would have returned [] for the whole list, which is
    // how this feature would have failed closed and silently.
    expect(steps).toEqual([{ text: 'Press Search', ref: 'e1', fill: '' }]);
  });

  it('drops a step with no usable text', () => {
    const steps = stepArray(
      [{ text: '   ', ref: 'e1', fill: '' }, { text: 'Real step', ref: '', fill: '' }, { ref: 'e2' }],
      5,
    );

    expect(steps).toEqual([{ text: 'Real step', ref: '', fill: '' }]);
  });

  it('blanks a ref that is not in the shape we mint', () => {
    const steps = stepArray(
      [
        { text: 'a', ref: 'e12', fill: '' },
        { text: 'b', ref: '#search-box', fill: '' },
        { text: 'c', ref: 'button.submit', fill: '' },
        { text: 'd', ref: 'E4', fill: '' },
        { text: 'e', ref: 7, fill: '' },
      ],
      5,
    );

    expect(steps.map((step) => step.ref)).toEqual(['e12', '', '', '', '']);
  });

  it('caps the list and the fill length', () => {
    const steps = stepArray(
      Array.from({ length: 9 }, (_, i) => ({ text: `step ${i}`, ref: '', fill: 'x '.repeat(300) })),
      5,
    );

    expect(steps).toHaveLength(5);
    expect(steps[0]!.fill.length).toBeLessThanOrEqual(200);
    expect(steps[0]!.fill).not.toMatch(/\s$/);
  });
});

describe('nextSteps — the re-plan after a navigation', () => {
  it('sends the goal and the done list, and no transcript', async () => {
    const fetchStub = mockFetch();
    fetchStub.queue.push(() => completion(JSON.stringify(GOOD_ANSWER)));

    await nextSteps('k', 'm', snapshotFixture(), 'buy wool socks', [
      'Type the product name',
      'Press Search',
    ]);

    const messages = fetchStub.calls[0]!.body.messages as Array<{ role: string; content: string }>;
    // One system message and one user message: the transcript is deliberately
    // not what survives a page load — the goal and the progress are.
    expect(messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(messages[1]!.content).toContain("The user's goal: buy wool socks");
    expect(messages[1]!.content).toContain('1. Type the product name');
    expect(messages[1]!.content).toContain('2. Press Search');
    expect(messages[1]!.content).toContain('https://example.com/pricing');
  });

  it('clamps its answer through the same path as ask', async () => {
    const fetchStub = mockFetch();
    fetchStub.queue.push(() =>
      completion(
        JSON.stringify({
          answer: 'Nearly there.',
          steps: [{ text: 'Press Add to cart', ref: 'e404', fill: '' }, 'junk'],
          refs: [],
          suggestions: [],
          goal_reached: false,
        }),
      ),
    );

    const answer = await nextSteps('k', 'm', snapshotFixture(), 'buy socks', []);

    expect(answer.steps).toEqual([{ text: 'Press Add to cart', ref: 'e404', fill: '' }]);
  });

  it('falls back to raw text with no steps, like ask does', async () => {
    const fetchStub = mockFetch();
    fetchStub.queue.push(() => completion('no json'));
    fetchStub.queue.push(() => completion('still no json'));

    const answer = await nextSteps('k', 'm', snapshotFixture(), 'buy socks', []);

    expect(answer).toEqual({
      answer: 'still no json',
      steps: [],
      refs: [],
      suggestions: [],
      goal_reached: false,
    });
  });
});

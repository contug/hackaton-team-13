import { vi } from 'vitest';

/**
 * Queue of `fetch` responses. Each call shifts one off, so a test states the
 * exact sequence the three-step fallback chain should walk through.
 */
export interface FetchStub {
  calls: Array<{ url: string; init: RequestInit; body: any }>;
  queue: Array<() => Promise<Response> | Response>;
}

export function mockFetch(): FetchStub {
  const stub: FetchStub = { calls: [], queue: [] };

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      let body: unknown;
      try {
        body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      } catch {
        body = undefined;
      }
      stub.calls.push({ url: String(url), init, body });

      const next = stub.queue.shift();
      if (!next) throw new Error(`Unexpected fetch call #${stub.calls.length} to ${url}`);
      return next();
    }),
  );

  return stub;
}

/** A 200 response carrying an OpenRouter-shaped chat completion. */
export function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Shorthand for a successful completion whose message content is `content`. */
export function completion(content: string): Response {
  return jsonResponse({ choices: [{ message: { content } }] });
}

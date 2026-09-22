import type { PageSnapshot } from './snapshot';
import {
  ASK_SYSTEM,
  SUMMARIZE_SYSTEM,
  askUserMessage,
  summarizeUserMessage,
} from './prompts';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const KEY_ENDPOINT = 'https://openrouter.ai/api/v1/key';
const MODELS_ENDPOINT = 'https://openrouter.ai/api/v1/models';

/** Attribution headers — optional for OpenRouter, but good manners. */
const ATTRIBUTION = {
  'HTTP-Referer': 'https://github.com/hackaton-team-13/page-guide',
  'X-OpenRouter-Title': 'Page Guide',
};

export interface Summary {
  tldr: string;
  key_points: string[];
  what_you_can_do_here: string[];
  suggestions: string[];
}

export interface Answer {
  answer: string;
  steps: string[];
  refs: string[];
  suggestions: string[];
  /**
   * One sentence saying why `refs[0]` is the thing to go to, which is what the
   * on-page spotlight puts next to the element. Empty string means "no single
   * element matters here" — a sentinel rather than a nullable field, because
   * `strict: true` requires every property to be listed in `required`.
   */
  target_reason: string;
}

export interface Turn {
  question: string;
  answer: string;
}

export interface ModelOption {
  id: string;
  name: string;
}

/**
 * Schemas are deliberately free of `maxItems`/`minItems`. OpenAI-family models
 * reject those keywords under `strict: true`, and "any model" is a requirement
 * here — so the limits are stated in the prompt and clamped client-side in
 * `clampSummary` / `clampAnswer` instead.
 */
const SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tldr', 'key_points', 'what_you_can_do_here', 'suggestions'],
  properties: {
    tldr: { type: 'string', description: 'One sentence, max 25 words.' },
    key_points: { type: 'array', items: { type: 'string' }, description: 'At most 4 short phrases.' },
    what_you_can_do_here: { type: 'array', items: { type: 'string' }, description: 'At most 3 actions.' },
    suggestions: { type: 'array', items: { type: 'string' }, description: "At most 3 follow-up questions in the user's voice." },
  },
} as const;

const ANSWER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'steps', 'refs', 'suggestions', 'target_reason'],
  properties: {
    answer: { type: 'string', description: 'At most 3 sentences.' },
    steps: { type: 'array', items: { type: 'string' }, description: 'At most 3 steps, or empty.' },
    refs: { type: 'array', items: { type: 'string' }, description: 'At most 3 outline ref ids, or empty.' },
    suggestions: { type: 'array', items: { type: 'string' }, description: "At most 3 follow-up questions in the user's voice." },
    target_reason: {
      type: 'string',
      description: 'One short sentence, max 20 words, saying what the first ref is for. Empty string if no single element matters.',
    },
  },
} as const;

export class OpenRouterError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'OpenRouterError';
  }
}

/** Short, non-technical text for the panel. The user is already overloaded. */
export function friendlyError(err: unknown): string {
  if (err instanceof OpenRouterError) {
    switch (err.status) {
      case 401:
      case 403:
        return 'That API key was rejected. Check it in settings.';
      case 402:
        return 'Your OpenRouter account is out of credits.';
      case 404:
        return 'That model was not found. Pick another one in settings.';
      case 429:
        return 'Rate limited. Wait a moment and try again.';
      default:
        if (err.status !== undefined && err.status >= 500) {
          return 'OpenRouter had a problem. Try again in a moment.';
        }
        return err.message;
    }
  }
  if (err instanceof TypeError) return "Couldn't reach OpenRouter. Check your connection.";
  return err instanceof Error ? err.message : 'Something went wrong.';
}

interface ChatParams {
  apiKey: string;
  model: string;
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  schema: Record<string, unknown>;
  schemaName: string;
  signal?: AbortSignal;
}

async function postChat(
  params: ChatParams,
  useSchema: boolean,
): Promise<string> {
  const body: Record<string, unknown> = {
    model: params.model,
    messages: [
      { role: 'system', content: params.system },
      ...params.messages,
    ],
  };

  if (useSchema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: params.schemaName, strict: true, schema: params.schema },
    };
  }

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      ...ATTRIBUTION,
    },
    body: JSON.stringify(body),
    signal: params.signal,
  });

  const payload: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    throw new OpenRouterError(readErrorMessage(payload) ?? `Request failed (${res.status}).`, res.status);
  }

  // OpenRouter can also report failures inside a 200 response.
  const inlineError = readErrorMessage(payload);
  if (inlineError) throw new OpenRouterError(inlineError);

  const content = (payload as any)?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.trim() === '') {
    throw new OpenRouterError('The model returned an empty response.');
  }
  return content;
}

function readErrorMessage(payload: unknown): string | null {
  const err = (payload as any)?.error;
  if (!err) return null;
  if (typeof err === 'string') return err;
  if (typeof err.message === 'string') return err.message;
  return 'OpenRouter returned an error.';
}

/** Pull a JSON object out of a response that may be fenced or prose-wrapped. */
function extractJson(text: string): unknown | null {
  const unfenced = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');

  const candidates = [unfenced, text];
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // fall through to brace-slicing
    }
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        // try the next candidate
      }
    }
  }
  return null;
}

function schemaIsUnsupported(err: unknown): boolean {
  if (!(err instanceof OpenRouterError)) return false;
  if (err.status !== undefined && err.status !== 400 && err.status !== 404 && err.status !== 422) {
    return false;
  }
  return /response_format|json_schema|schema|structured output/i.test(err.message);
}

/**
 * Three-step degradation, because the user can pick any model and not all of
 * them support `response_format`:
 *   1. ask with the JSON schema
 *   2. retry once with the schema inlined in the prompt
 *   3. hand back the raw text so the caller can still show something
 * Never hangs, never throws a parse error.
 */
async function chatStructured(params: ChatParams): Promise<
  { ok: true; data: Record<string, unknown> } | { ok: false; raw: string }
> {
  let text: string;

  try {
    text = await postChat(params, true);
  } catch (err) {
    if (!schemaIsUnsupported(err)) throw err;
    text = await postChat(
      {
        ...params,
        system: `${params.system}\n\nReply with a single JSON object and nothing else — no prose, no code fences. It must match this JSON Schema:\n${JSON.stringify(params.schema)}`,
      },
      false,
    );
  }

  let parsed = extractJson(text);

  if (parsed === null || typeof parsed !== 'object') {
    const retryText = await postChat(
      {
        ...params,
        system: `${params.system}\n\nReply with a single JSON object and nothing else — no prose, no code fences. It must match this JSON Schema:\n${JSON.stringify(params.schema)}`,
      },
      false,
    );
    parsed = extractJson(retryText);
    if (parsed === null || typeof parsed !== 'object') return { ok: false, raw: retryText };
  }

  return { ok: true, data: parsed as Record<string, unknown> };
}

function strArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, max);
}

function clampSummary(data: Record<string, unknown>): Summary {
  return {
    tldr: typeof data.tldr === 'string' ? data.tldr.trim() : '',
    key_points: strArray(data.key_points, 4),
    what_you_can_do_here: strArray(data.what_you_can_do_here, 3),
    suggestions: strArray(data.suggestions, 3),
  };
}

const MAX_REASON_CHARS = 140;

/** One short sentence: whitespace squashed, hard-capped. Brevity twice over. */
function shortSentence(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_REASON_CHARS).trim();
}

function clampAnswer(data: Record<string, unknown>): Answer {
  const refs = strArray(data.refs, 3);
  return {
    answer: typeof data.answer === 'string' ? data.answer.trim() : '',
    steps: strArray(data.steps, 3),
    refs,
    suggestions: strArray(data.suggestions, 3),
    // A reason with no ref to attach to points at nothing. Whether the ref is
    // one we actually sent is checked later, against the outline, in
    // `pickSpotlightRef` — this module has no snapshot to check against.
    target_reason: refs.length > 0 ? shortSentence(data.target_reason) : '',
  };
}

export async function summarizePage(
  apiKey: string,
  model: string,
  snapshot: PageSnapshot,
  signal?: AbortSignal,
): Promise<Summary> {
  const result = await chatStructured({
    apiKey,
    model,
    system: SUMMARIZE_SYSTEM,
    messages: [{ role: 'user', content: summarizeUserMessage(snapshot) }],
    schema: SUMMARY_SCHEMA as unknown as Record<string, unknown>,
    schemaName: 'page_summary',
    signal,
  });

  if (!result.ok) {
    return { tldr: result.raw.trim(), key_points: [], what_you_can_do_here: [], suggestions: [] };
  }
  return clampSummary(result.data);
}

export async function askAboutPage(
  apiKey: string,
  model: string,
  snapshot: PageSnapshot,
  question: string,
  history: Turn[],
  signal?: AbortSignal,
): Promise<Answer> {
  // History is replayed as plain turns. The full snapshot rides on the latest
  // user message only — resending it per turn would blow up the payload.
  const priorTurns = history.flatMap((turn) => [
    { role: 'user' as const, content: turn.question },
    { role: 'assistant' as const, content: turn.answer },
  ]);

  const result = await chatStructured({
    apiKey,
    model,
    system: ASK_SYSTEM,
    messages: [...priorTurns, { role: 'user', content: askUserMessage(snapshot, question) }],
    schema: ANSWER_SCHEMA as unknown as Record<string, unknown>,
    schemaName: 'page_answer',
    signal,
  });

  if (!result.ok) {
    return { answer: result.raw.trim(), steps: [], refs: [], suggestions: [], target_reason: '' };
  }
  return clampAnswer(result.data);
}

/**
 * Validate a key before storing it. A non-401 failure means we could not check
 * (endpoint moved, network blip) — accept the key rather than block the user on
 * our own uncertainty.
 */
export async function validateKey(apiKey: string): Promise<{ valid: boolean; note?: string }> {
  let res: Response;
  try {
    res = await fetch(KEY_ENDPOINT, {
      headers: { Authorization: `Bearer ${apiKey}`, ...ATTRIBUTION },
    });
  } catch {
    return { valid: true, note: "Couldn't verify the key — saved anyway." };
  }

  if (res.status === 401 || res.status === 403) return { valid: false };
  if (!res.ok) return { valid: true, note: "Couldn't verify the key — saved anyway." };
  return { valid: true };
}

export async function listModels(apiKey: string): Promise<ModelOption[]> {
  const res = await fetch(MODELS_ENDPOINT, {
    headers: { Authorization: `Bearer ${apiKey}`, ...ATTRIBUTION },
  });
  if (!res.ok) throw new OpenRouterError(`Could not load models (${res.status}).`, res.status);

  const payload: unknown = await res.json();
  const data = (payload as any)?.data;
  if (!Array.isArray(data)) return [];

  return data
    .filter((m: any) => typeof m?.id === 'string')
    .map((m: any) => ({ id: m.id as string, name: typeof m.name === 'string' ? m.name : m.id }));
}

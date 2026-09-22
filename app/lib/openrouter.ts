import type { PageSnapshot } from './snapshot';
import {
  ASK_SYSTEM,
  NEXT_STEPS_SYSTEM,
  SUMMARIZE_SYSTEM,
  askUserMessage,
  nextStepsUserMessage,
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

/**
 * One rung of the walkthrough.
 *
 * A step is *addressable*: it carries the ref it acts on, so the spotlight can
 * ring it and the step watcher can tell when the user has done it. The empty
 * string is the "not applicable" sentinel for both `ref` and `fill`, rather
 * than a nullable field, because `strict: true` requires every property to be
 * listed in `required`.
 *
 * `text` is also the tooltip copy. That is why the old `target_reason` is gone:
 * one sentence, one source of truth.
 */
export interface Step {
  /** What to do, in the user's terms. One short imperative sentence. */
  text: string;
  /** The outline ref to act on, or '' when the step is not about one element. */
  ref: string;
  /** Text to type into `ref`, or '' when the step is not a fill. */
  fill: string;
}

export interface Answer {
  answer: string;
  steps: Step[];
  refs: string[];
  suggestions: string[];
  /**
   * The model's own verdict that the goal is already met, so the walkthrough
   * can end instead of inventing another rung. A boolean rather than an absent
   * `steps` array: "nothing left to do" and "I could not find anything to do"
   * are different answers and must not collapse into one.
   */
  goal_reached: boolean;
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

/**
 * Every property is in `required`, including the two that are usually empty.
 * That is the same strict-mode rule that forced the empty-string sentinel on
 * the retired `target_reason`: under `strict: true` an optional property is not
 * a thing, so "no ref" and "no fill" have to be expressible as values.
 */
const STEP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'ref', 'fill'],
  properties: {
    text: {
      type: 'string',
      description: 'One short imperative sentence, max 20 words. What to do, in the user\'s terms.',
    },
    ref: {
      type: 'string',
      description:
        'The outline ref id this step acts on, like "e42". Only ids from the outline. Empty string when the step is not about one element.',
    },
    fill: {
      type: 'string',
      description:
        'The exact text to type into `ref`. Empty string unless this step is typing into a field.',
    },
  },
} as const;

const ANSWER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'steps', 'refs', 'suggestions', 'goal_reached'],
  properties: {
    answer: { type: 'string', description: 'At most 3 sentences.' },
    steps: { type: 'array', items: STEP_SCHEMA, description: 'At most 5 steps, in order, or empty.' },
    refs: { type: 'array', items: { type: 'string' }, description: 'At most 3 outline ref ids, or empty.' },
    suggestions: { type: 'array', items: { type: 'string' }, description: "At most 3 follow-up questions in the user's voice." },
    goal_reached: {
      type: 'boolean',
      description: 'True only when this page shows the goal is already met, so there is nothing left to do.',
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

const MAX_STEP_CHARS = 140;
/** A fill is a search term or a short form value, never a paragraph. */
const MAX_FILL_CHARS = 200;
/**
 * A walkthrough needs more rungs than the old "at most 3" answer did — but not
 * many more, or the panel becomes the wall of text it exists to replace.
 */
const MAX_STEPS = 5;

/** One short sentence: whitespace squashed, hard-capped. Brevity twice over. */
function shortSentence(value: unknown, max = MAX_STEP_CHARS): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

/**
 * The step-object counterpart to `strArray`.
 *
 * This exists because `strArray` silently returns `[]` for an array of objects:
 * without it the whole walkthrough would fail closed and say nothing about why.
 * A step with no text is dropped; a `ref` the model made up in a shape we never
 * mint is blanked rather than kept, so it can never resolve to a live element.
 */
export function stepArray(value: unknown, max: number): Step[] {
  if (!Array.isArray(value)) return [];

  const steps: Step[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
    const candidate = raw as Record<string, unknown>;

    const text = shortSentence(candidate.text);
    if (!text) continue;

    const ref = typeof candidate.ref === 'string' ? candidate.ref.trim() : '';
    steps.push({
      text,
      ref: /^e\d+$/.test(ref) ? ref : '',
      fill: shortSentence(candidate.fill, MAX_FILL_CHARS),
    });
    if (steps.length === max) break;
  }
  return steps;
}

function clampAnswer(data: Record<string, unknown>): Answer {
  return {
    answer: typeof data.answer === 'string' ? data.answer.trim() : '',
    steps: stepArray(data.steps, MAX_STEPS),
    // Whether a ref is one we actually sent is checked later, against the
    // outline, by `pickSpotlightRef`/`resolvableSteps` — this module has no
    // snapshot to check against.
    refs: strArray(data.refs, 3),
    suggestions: strArray(data.suggestions, 3),
    goal_reached: data.goal_reached === true,
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
    return { answer: result.raw.trim(), steps: [], refs: [], suggestions: [], goal_reached: false };
  }
  return clampAnswer(result.data);
}

/**
 * Re-plan an in-flight journey against the page the user has just landed on.
 *
 * No `history`: the transcript is not what survives a navigation. The goal and
 * the list of completed step texts are, and they are the whole context — which
 * is also why they are the only two things the background stores per tab.
 */
export async function nextSteps(
  apiKey: string,
  model: string,
  snapshot: PageSnapshot,
  goal: string,
  done: string[],
  signal?: AbortSignal,
): Promise<Answer> {
  const result = await chatStructured({
    apiKey,
    model,
    system: NEXT_STEPS_SYSTEM,
    messages: [{ role: 'user', content: nextStepsUserMessage(snapshot, goal, done) }],
    schema: ANSWER_SCHEMA as unknown as Record<string, unknown>,
    schemaName: 'page_answer',
    signal,
  });

  if (!result.ok) {
    return { answer: result.raw.trim(), steps: [], refs: [], suggestions: [], goal_reached: false };
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

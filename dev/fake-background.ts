import type { BgRequest, BgResponse, BgResponseMap } from '@/lib/messaging';
import type { Journey } from '@/lib/journey';
import type { Step } from '@/lib/openrouter';
import type { OutlineEntry } from '@/lib/snapshot';

/**
 * Stands in for `lib/messaging` in the dev harness only, through an alias in
 * `dev/vite.config.ts` — the same substitution `vi.mock` makes in the test
 * suite. No production file knows this exists, and nothing here ships.
 *
 * The point of the harness is real layout: `buildSnapshot()` and `refFor()` run
 * against the harness DOM, so the refs are real and the spotlight has a real
 * element to ring. Only the model is fake.
 */

const SUMMARY = {
  tldr: 'This is your billing page: plan, payment method, invoices and cancellation.',
  key_points: ['Pro plan, billed yearly', 'Card ending 4242', 'Next charge 12 March'],
  what_you_can_do_here: ['Change your plan', 'Update your card', 'Cancel your subscription'],
  suggestions: ['How do I cancel my plan?', 'Where do I change my card?', 'When am I next charged?'],
};

/** Crude word overlap, which is all a stand-in model needs to be deterministic. */
function score(entry: OutlineEntry, question: string): number {
  const words = question.toLowerCase().match(/[a-z]{3,}/g) ?? [];
  const name = entry.name.toLowerCase();
  return words.filter((word) => name.includes(word)).length;
}

function answerFrom(outline: OutlineEntry[], question: string) {
  const ranked = outline
    .filter((entry) => entry.kind === 'button' || entry.kind === 'link' || entry.kind === 'field')
    .map((entry) => ({ entry, score: score(entry, question) }))
    .sort((a, b) => b.score - a.score)
    .filter((candidate) => candidate.score > 0);

  const refs = ranked.slice(0, 3).map((candidate) => candidate.entry.ref);
  const best = ranked[0]?.entry;

  // A two-rung walkthrough, so the harness can exercise advancing: the first
  // step is a fill when the best match is a field, which is what puts the
  // "Fill this in" button on screen.
  const steps: Step[] = best
    ? [
        {
          text: best.kind === 'field' ? `Type what you want into "${best.name}"` : `Press "${best.name}"`,
          ref: best.ref,
          fill: best.kind === 'field' ? question : '',
        },
        { text: 'Confirm when asked', ref: ranked[1]?.entry.ref ?? '', fill: '' },
      ]
    : [];

  return {
    answer: best
      ? `Use "${best.name}". It is the only control on this page that does that.`
      : 'Nothing on this page does that.',
    steps,
    refs,
    suggestions: ['What happens after that?', 'Can I undo it?'],
    goal_reached: false,
  };
}

/** One journey, in module scope: the harness is one page, so one tab. */
let harnessJourney: Journey | null = null;

/** Narrowed on the concrete union; the generic signature is the boundary. */
function reply(request: BgRequest): BgResponse<unknown> {
  switch (request.type) {
    case 'getSettings':
      return { ok: true, data: { hasApiKey: true, model: 'fake/harness' } };
    case 'saveSettings':
      return { ok: true, data: { saved: true } };
    case 'listModels':
      return { ok: true, data: [{ id: 'fake/harness', name: 'Harness stand-in' }] };
    case 'summarize':
      return { ok: true, data: SUMMARY };
    case 'ask':
      return { ok: true, data: answerFrom(request.snapshot.outline, request.question) };
    case 'nextSteps':
      return { ok: true, data: answerFrom(request.snapshot.outline, request.goal) };
    case 'saveJourney':
      harnessJourney = request.journey;
      return { ok: true, data: { saved: true } };
    case 'getJourney':
      return { ok: true, data: harnessJourney };
    case 'clearJourney':
      harnessJourney = null;
      return { ok: true, data: { cleared: true } };
  }
}

export async function sendToBackground<K extends BgRequest['type']>(
  request: Extract<BgRequest, { type: K }>,
): Promise<BgResponse<BgResponseMap[K]>> {
  // A beat of latency, so the harness shows the same loading states as the
  // real thing rather than resolving inside the same tick.
  await new Promise((resolve) => setTimeout(resolve, 120));
  return reply(request) as BgResponse<BgResponseMap[K]>;
}
